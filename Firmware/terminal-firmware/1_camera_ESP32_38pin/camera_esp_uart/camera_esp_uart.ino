// camera_esp_uart.ino - camera ESP32 (38-pin) for the attendance terminal: OV7670 (18-pin, no FIFO), greyscale QVGA.
// This board never talks to the server. The main ESP32 asks for a picture over UART2; this board takes it and sends it back.
// The full chain: admin (enrol/verify) or lecturer (verify) asks on the dashboard -> server -> main ESP32 -> 'C' to this board
//                 -> picture back to the main ESP32 -> main ESP32 uploads it to the server for face matching.
// Capture driver: the I2S code from mudassar-tamboli/ESP32-OV7670-WebSocket-Camera (based on bitluni's ESP32 I2S Camera and
// igrr's esp32-cam-demo), ported to the ESP32 core 3.x - the version proven on the bench (camera_esp_i2s.ino).
// Commands (one byte), accepted from the main ESP32 (UART2) or the laptop (USB); the reply goes back to whoever asked:
//   C = capture and send one picture   P = ping ("PONG OK" / "PONG NOCAM")   B = test bars on/off   I = info to the log
// Picture packet: "FRM1" | width u16 | height u16 | length u32 | pixels (1 byte each) | checksum u16 (little-endian)
//                 If no picture can be taken the reply is just "ERR!" (4 bytes).
// Log text always goes out of USB at 921600, so view_frame.py on the laptop still works without reflashing.
// Wiring (38-pin positions, antenna up): D0 R13, D1 R10, D2 R9, D3 R8, D4 L3, D5 L4, D6 L5, D7 L6, VS L9, HS R2, PLK R3, XLK R6,
//         SDA L10, SCL L11 (10k pull-ups to 3V3), 3.3V and RET -> 3V3 (L1), GND and PWDN -> GND (L14)
// Link to the main ESP32: this board's GPIO16 RX2 (R12) <- main GPIO21, GPIO17 TX2 (R11) -> main GPIO22, shared GND
// Arduino IDE: board "ESP32 Dev Module", PSRAM "Disabled"

#include <Wire.h>                         // settings bus (SCCB) talks like I2C
#include "esp_attr.h"                     // IRAM_ATTR, for code that must run from internal RAM
#include "esp_intr_alloc.h"               // esp_intr_alloc(): hook the I2S interrupt
#include "esp_rom_gpio.h"                 // esp_rom_gpio_connect_in_signal(): route pins to I2S (was gpio_matrix_in)
#include "esp_private/periph_ctrl.h"      // periph_module_enable() (moved here in the 3.x core)
#include "soc/i2s_struct.h"               // I2S0 register block
#include "soc/i2s_reg.h"                  // I2S reset bit masks
#include "soc/gpio_sig_map.h"             // I2S0 input signal numbers
#include "soc/interrupts.h"               // ETS_I2S0_INTR_SOURCE
#include "rom/lldesc.h"                   // lldesc_t: DMA descriptor
#include "driver/gpio.h"                  // gpio_config(), gpio_get_level()

const int CAM_D0 = 4;      // OV7670 D0
const int CAM_D1 = 5;      // OV7670 D1
const int CAM_D2 = 18;     // OV7670 D2
const int CAM_D3 = 19;     // OV7670 D3
const int CAM_D4 = 36;     // OV7670 D4 (VP, input-only)
const int CAM_D5 = 39;     // OV7670 D5 (VN, input-only)
const int CAM_D6 = 34;     // OV7670 D6 (input-only)
const int CAM_D7 = 35;     // OV7670 D7 (input-only)
const int CAM_VSYNC = 25;  // OV7670 VS
const int CAM_HREF = 23;   // OV7670 HS
const int CAM_PCLK = 22;   // OV7670 PLK
const int CAM_XCLK = 21;   // OV7670 XLK
const int CAM_SDA = 26;    // OV7670 SDA
const int CAM_SCL = 27;    // OV7670 SCL
const uint32_t XCLK_HZ = 10000000;  // camera clock; the repo used 20 MHz, 10 MHz is kinder to jumper wires

const int LINK_RX_PIN = 16;  // UART2 RX <- main ESP32 TX (GPIO21)
const int LINK_TX_PIN = 17;  // UART2 TX -> main ESP32 RX (GPIO22)
const uint32_t LINK_BAUD = 921600;  // link speed
const uint32_t USB_BAUD = 921600;  // USB speed: log text, and pictures when the laptop asks

const uint8_t CAM_ADDR = 0x21;  // OV7670 settings-bus address (0x42 in 8-bit form, as the repo writes it)
const int XRES = 320;  // picture width (QVGA)
const int YRES = 240;  // picture height (QVGA)
const int Y_BYTE = 2;  // which byte of each 4-byte DMA word holds brightness; try 0 if the picture looks flat and ghostly
const uint32_t FRAME_TIMEOUT_MS = 2000;  // give up on a picture after this long
const int SETTLE_FRAMES = 5;  // pictures thrown away at start-up so exposure can settle
const int CAPTURE_TRIES = 3;  // attempts per request before replying ERR! (one bad frame shouldn't fail an enrolment)
const bool MIRROR_IMAGE = false;  // set true if faces come out left-right swapped in the enclosure
const bool FLIP_IMAGE = false;  // set true if the camera is mounted upside down in the enclosure
const uint8_t REG_MVFP = 0x1E;  // mirror / vertical-flip register

// ---------- OV7670 registers used (names from the repo's OV7670.h) ----------
const uint8_t REG_PID = 0x0A, REG_VER = 0x0B;  // chip ID: 0x76, 0x73
const uint8_t REG_COM3 = 0x0C, REG_CLKRC = 0x11, REG_COM7 = 0x12, REG_COM8 = 0x13;  // control registers
const uint8_t REG_HSTART = 0x17, REG_HSTOP = 0x18, REG_VSTART = 0x19, REG_VSTOP = 0x1A;  // picture window
const uint8_t REG_HREF = 0x32, REG_VREF = 0x03, REG_TSLB = 0x3A, REG_COM11 = 0x3B;  // window low bits, byte order, night mode
const uint8_t REG_COM13 = 0x3D, REG_COM14 = 0x3E, REG_COM15 = 0x40;  // byte order, scaling, output range
const uint8_t REG_XSC = 0x70, REG_YSC = 0x71, REG_DCWCTR = 0x72, REG_PCLK_DIV = 0x73, REG_PCLK_DELAY = 0xA2;  // scaler

// ---------- capture state shared with the interrupt ----------
static uint8_t *frame = nullptr;  // finished picture, XRES*YRES bytes
static DRAM_ATTR uint8_t dmaBuf[2][XRES * 4] __attribute__((aligned(4)));  // two one-line DMA buffers (4 bytes per pixel)
static DRAM_ATTR lldesc_t dmaDesc[2];  // their DMA descriptors, linked in a ring
static intr_handle_t i2sHandle = nullptr;  // I2S interrupt handle
static volatile int linesDone = 0;  // lines copied so far in this picture
static volatile int activeBuf = 0;  // which DMA buffer the hardware just finished
static volatile bool frameDone = false;  // set by the interrupt when all lines are in

HardwareSerial mainLink(2);  // UART2 for the main ESP32
uint32_t picturesSent = 0;  // count since start-up, shown in the log
bool cameraOk = false;  // camera answered and was set up
bool barsOn = false;  // test bars state

void logLine(const String &text) {  // log text always goes out of USB
  Serial.println(text);  // one line
}

// ---------- settings bus ----------
bool camWrite(uint8_t reg, uint8_t value) {  // write one camera register
  Wire.beginTransmission(CAM_ADDR);  // address the camera
  Wire.write(reg);  // register number
  Wire.write(value);  // new value
  bool ok = Wire.endTransmission() == 0;  // 0 = acknowledged
  delay(1);  // the repo's bit-banged bus was slow; give the camera a moment
  return ok;  // report
}

int camRead(uint8_t reg) {  // read one camera register, -1 on failure
  Wire.beginTransmission(CAM_ADDR);  // address the camera
  Wire.write(reg);  // register number
  if (Wire.endTransmission(true) != 0) return -1;  // SCCB needs a full stop before the read
  if (Wire.requestFrom(CAM_ADDR, (uint8_t)1) != 1) return -1;  // ask for one byte
  return Wire.read();  // the value
}

void frameControl(int hStart, int hStop, int vStart, int vStop) {  // picture window (copied from the repo)
  camWrite(REG_HSTART, hStart >> 3);  // horizontal start, high bits
  camWrite(REG_HSTOP, hStop >> 3);  // horizontal stop, high bits
  camWrite(REG_HREF, ((hStop & 0b111) << 3) | (hStart & 0b111));  // horizontal low bits
  camWrite(REG_VSTART, vStart >> 2);  // vertical start, high bits
  camWrite(REG_VSTOP, vStop >> 2);  // vertical stop, high bits
  camWrite(REG_VREF, ((vStop & 0b11) << 2) | (vStart & 0b11));  // vertical low bits
}

void setupQVGAGrey() {  // the repo's QVGARGB565() settings, switched to YUV so we can keep brightness only
  camWrite(REG_COM7, 0x80);  // reset all registers to default
  delay(100);  // wait for the reset
  camWrite(REG_CLKRC, 0x80);  // clock setting as in the repo
  camWrite(REG_COM11, 0b1000 | 0b10);  // auto 50/60 Hz detect (repo)
  camWrite(REG_COM7, 0x00);  // YUV output (the repo used 0x04 = RGB)
  camWrite(REG_COM15, 0xC0);  // full 0-255 output range, no RGB565 bit
  camWrite(REG_TSLB, 0x04);  // byte order Y U Y V, so brightness comes first
  camWrite(REG_COM13, 0x88);  // gamma on, byte order bit 0 = 0
  camWrite(REG_COM3, 0x04);  // QVGA(): enable down-sampling
  camWrite(REG_COM14, 0x19);  // QVGA(): manual scaling, PCLK divided
  camWrite(REG_XSC, 0x3A);  // QVGA(): horizontal scale (bit 7 = test bars, off)
  camWrite(REG_YSC, 0x35);  // QVGA(): vertical scale (bit 7 = test bars, off)
  camWrite(REG_DCWCTR, 0x11);  // QVGA(): down-sample by 2
  camWrite(REG_PCLK_DIV, 0xF1);  // QVGA(): pixel clock divided by 2
  camWrite(REG_PCLK_DELAY, 0x02);  // QVGA(): pixel clock delay
  frameControl(168, 24, 12, 492);  // window values from the repo
  camWrite(0xB0, 0x84);  // undocumented value the repo found important
  camWrite(REG_COM8, 0xE7);  // automatic gain, white balance and exposure on
  camWrite(0x6F, 0x9F);  // simple white balance (repo)
  camWrite(REG_MVFP, (MIRROR_IMAGE ? 0x20 : 0) | (FLIP_IMAGE ? 0x10 : 0));  // mirror bit 5, flip bit 4
}

// ---------- I2S capture (ported from the repo's I2SCamera.cpp) ----------
static void IRAM_ATTR i2sInterrupt(void *arg) {  // runs once per finished line
  I2S0.int_clr.val = I2S0.int_raw.val;  // clear the interrupt
  const uint8_t *buf = dmaBuf[activeBuf];  // line the DMA just filled
  activeBuf ^= 1;  // the next line goes into the other buffer
  if (linesDone < YRES) {  // still collecting
    uint8_t *out = frame + linesDone * XRES;  // where this line goes
    for (int i = 0; i < XRES; i++) out[i] = buf[i * 4 + Y_BYTE];  // keep only the brightness byte of each pixel
    linesDone = linesDone + 1;  // one more line
  }
  if (linesDone >= YRES && !frameDone) {  // whole picture in
    I2S0.conf.rx_start = 0;  // stop sampling
    I2S0.int_ena.val = 0;  // no more interrupts
    frameDone = true;  // tell the main code
  }
}

static void i2sReset() {  // pulse the I2S reset bits (repo's i2sConfReset)
  const uint32_t lcFlags = I2S_IN_RST_M | I2S_AHBM_RST_M | I2S_AHBM_FIFO_RST_M;  // DMA side
  I2S0.lc_conf.val |= lcFlags;  // set
  I2S0.lc_conf.val &= ~lcFlags;  // clear
  const uint32_t confFlags = I2S_RX_RESET_M | I2S_RX_FIFO_RESET_M | I2S_TX_RESET_M | I2S_TX_FIFO_RESET_M;  // FIFO side
  I2S0.conf.val |= confFlags;  // set
  I2S0.conf.val &= ~confFlags;  // clear
  while (I2S0.state.rx_fifo_reset_back) {}  // wait until the FIFO reset is done
}

bool i2sInit() {  // route the camera pins into I2S0 and set it up as a parallel camera input
  const int inputs[] = {CAM_VSYNC, CAM_HREF, CAM_PCLK, CAM_D0, CAM_D1, CAM_D2, CAM_D3, CAM_D4, CAM_D5, CAM_D6, CAM_D7};  // all camera outputs
  for (int pin : inputs) {  // make each one a plain input
    gpio_config_t conf = {};  // start blank
    conf.pin_bit_mask = 1ULL << pin;  // this pin
    conf.mode = GPIO_MODE_INPUT;  // input
    gpio_config(&conf);  // apply
  }
  const int dataPins[8] = {CAM_D0, CAM_D1, CAM_D2, CAM_D3, CAM_D4, CAM_D5, CAM_D6, CAM_D7};  // D0..D7 in order
  for (int i = 0; i < 8; i++) esp_rom_gpio_connect_in_signal(dataPins[i], I2S0I_DATA_IN0_IDX + i, false);  // D0..D7 -> I2S data 0..7
  for (int i = 8; i < 16; i++) esp_rom_gpio_connect_in_signal(0x30, I2S0I_DATA_IN0_IDX + i, false);  // unused data bits held at 0
  esp_rom_gpio_connect_in_signal(CAM_VSYNC, I2S0I_V_SYNC_IDX, true);  // VSYNC, inverted as in the repo
  esp_rom_gpio_connect_in_signal(0x38, I2S0I_H_SYNC_IDX, false);  // HSYNC held at 1
  esp_rom_gpio_connect_in_signal(CAM_HREF, I2S0I_H_ENABLE_IDX, false);  // HREF gates sampling
  esp_rom_gpio_connect_in_signal(CAM_PCLK, I2S0I_WS_IN_IDX, false);  // PCLK is the sample clock

  periph_module_enable(PERIPH_I2S0_MODULE);  // power the I2S block
  i2sReset();  // clean start
  I2S0.conf.rx_slave_mod = 1;  // clock comes from outside (PCLK)
  I2S0.conf2.lcd_en = 1;  // parallel mode
  I2S0.conf2.camera_en = 1;  // use VSYNC/HREF to control sampling
  I2S0.clkm_conf.clkm_div_a = 1;  // clock divider (repo values)
  I2S0.clkm_conf.clkm_div_b = 0;  // clock divider
  I2S0.clkm_conf.clkm_div_num = 2;  // clock divider
  I2S0.fifo_conf.dscr_en = 1;  // FIFO feeds the DMA
  I2S0.fifo_conf.rx_fifo_mod = 1;  // two camera bytes per 32-bit word
  I2S0.fifo_conf.rx_fifo_mod_force_en = 1;  // apply that mode
  I2S0.conf_chan.rx_chan_mod = 1;  // channel mode used by the repo
  I2S0.sample_rate_conf.rx_bits_mod = 0;  // serial-mode settings off
  I2S0.conf.rx_right_first = 0;  // serial-mode settings off
  I2S0.conf.rx_msb_right = 0;  // serial-mode settings off
  I2S0.conf.rx_msb_shift = 0;  // serial-mode settings off
  I2S0.conf.rx_mono = 0;  // serial-mode settings off
  I2S0.conf.rx_short_sync = 0;  // serial-mode settings off
  I2S0.timing.val = 0;  // no extra delays

  for (int i = 0; i < 2; i++) {  // set up the two-line DMA ring
    dmaDesc[i].size = sizeof(dmaBuf[i]);  // buffer size
    dmaDesc[i].length = sizeof(dmaBuf[i]);  // bytes per line
    dmaDesc[i].owner = 1;  // DMA owns it
    dmaDesc[i].sosf = 1;  // as in the repo
    dmaDesc[i].eof = 1;  // interrupt at the end of each line
    dmaDesc[i].offset = 0;  // start of buffer
    dmaDesc[i].empty = 0;  // no next-pointer quirks
    dmaDesc[i].buf = dmaBuf[i];  // the buffer
    dmaDesc[i].qe.stqe_next = &dmaDesc[i ^ 1];  // point at the other one
  }
  return esp_intr_alloc(ETS_I2S0_INTR_SOURCE, ESP_INTR_FLAG_INTRDISABLED | ESP_INTR_FLAG_LEVEL1 | ESP_INTR_FLAG_IRAM,
                        &i2sInterrupt, nullptr, &i2sHandle) == ESP_OK;  // hook the interrupt, keep it off for now
}

bool waitLevel(int pin, int level, uint32_t until) {  // wait for a pin level, false on timeout
  while (gpio_get_level((gpio_num_t)pin) != level) {  // not there yet
    if (millis() > until) return false;  // took too long
  }
  return true;  // reached
}

String captureFrame() {  // take one picture into `frame`; returns "" on success, or what went wrong
  uint32_t until = millis() + FRAME_TIMEOUT_MS;  // deadline
  if (!waitLevel(CAM_VSYNC, 1, until)) return "no VSYNC pulses (check the VS wire and XLK)";  // wait for the gap between pictures
  if (!waitLevel(CAM_VSYNC, 0, until)) return "VSYNC stuck high (check the VS wire)";  // and for the next picture to begin
  esp_intr_disable(i2sHandle);  // quiet while we set up
  i2sReset();  // clean start
  linesDone = 0;  // nothing collected yet
  activeBuf = 0;  // DMA starts on buffer 0
  frameDone = false;  // not finished
  I2S0.rx_eof_num = XRES;  // one interrupt per line (counted in 32-bit words)
  I2S0.in_link.addr = (uint32_t)&dmaDesc[0];  // first descriptor
  I2S0.in_link.start = 1;  // start the DMA
  I2S0.int_clr.val = I2S0.int_raw.val;  // clear old flags
  I2S0.int_ena.val = 0;  // all off...
  I2S0.int_ena.in_done = 1;  // ...except "line finished"
  esp_intr_enable(i2sHandle);  // allow the interrupt
  I2S0.conf.rx_start = 1;  // go
  while (!frameDone) {  // wait for the interrupt to collect every line
    if (millis() > until) {  // too slow
      I2S0.conf.rx_start = 0;  // stop sampling
      esp_intr_disable(i2sHandle);  // stop interrupts
      return "only " + String(linesDone) + " of " + String(YRES) + " lines arrived (check PLK and HS)";  // diagnosis
    }
    delay(1);  // let other tasks run
  }
  esp_intr_disable(i2sHandle);  // done
  return "";  // success
}

// ---------- same commands and packet as camera_esp.ino ----------
void put16(uint8_t *at, uint16_t value) {  // write 16 bits, low byte first
  at[0] = value & 0xFF;  // low
  at[1] = value >> 8;  // high
}

void put32(uint8_t *at, uint32_t value) {  // write 32 bits, low byte first
  put16(at, value & 0xFFFF);  // low half
  put16(at + 2, value >> 16);  // high half
}

bool startCamera() {  // clock, settings bus, registers, I2S
  frame = (uint8_t *)malloc(XRES * YRES);  // 76 800-byte picture buffer
  if (!frame) {  // no room
    logLine("Not enough RAM for the picture buffer");  // say so
    return false;  // stop
  }
  if (!ledcAttach(CAM_XCLK, XCLK_HZ, 1)) {  // 50% square wave on XLK (replaces the repo's XClk.cpp)
    logLine("Could not start the 10 MHz clock on GPIO21");  // say so
    return false;  // stop
  }
  ledcWrite(CAM_XCLK, 1);  // duty 1 of 2 = 50%
  delay(50);  // the camera needs its clock before it will answer
  Wire.begin(CAM_SDA, CAM_SCL, 100000);  // settings bus at 100 kHz
  int pid = camRead(REG_PID), ver = camRead(REG_VER);  // ask the camera who it is
  if (pid < 0) {  // nothing answered
    logLine("Camera did not answer on SDA/SCL. Check SDA=26 / SCL=27, the pull-ups, 3.3V, RET, PWDN and XLK.");  // hint
    return false;  // stop
  }
  logLine("Camera ID 0x" + String(pid, HEX) + String(ver, HEX) + " (OV7670 = 0x7673)");  // who answered
  setupQVGAGrey();  // load the repo's QVGA settings
  if (!i2sInit()) {  // I2S set-up failed
    logLine("Could not set up I2S");  // say so
    return false;  // stop
  }
  for (int i = 0; i < SETTLE_FRAMES; i++) captureFrame();  // let exposure settle
  return true;  // ready
}

void printInfo() {  // describe the setup
  logLine("camera_esp_uart: QVGA greyscale, main ESP32 on UART2 (GPIO16/17) and laptop on USB, both at " + String(LINK_BAUD));  // mode
  logLine("Pictures sent since start-up: " + String(picturesSent));  // activity
  logLine("Free RAM " + String(ESP.getFreeHeap()) + " bytes");  // memory left
}

void sendPicture(Stream *port, const char *who) {  // capture and send one packet to whoever asked
  if (!cameraOk) {  // never started
    port->write((const uint8_t *)"ERR!", 4);  // fail fast
    logLine("No picture: the camera did not start");  // why
    return;  // done
  }
  String problem;  // reason for the last failed attempt
  for (int attempt = 1; attempt <= CAPTURE_TRIES; attempt++) {  // a few tries before giving up
    problem = captureFrame();  // take it
    if (!problem.length()) break;  // got one
    logLine("Attempt " + String(attempt) + " failed: " + problem);  // record each failure
  }
  if (problem.length()) {  // every attempt failed
    port->write((const uint8_t *)"ERR!", 4);  // tell the asker
    logLine("No picture for the " + String(who) + ": " + problem);  // why
    return;  // done
  }
  const uint32_t len = XRES * YRES;  // bytes of pixels
  uint16_t sum = 0;  // checksum
  for (uint32_t i = 0; i < len; i++) sum += frame[i];  // add every pixel
  uint8_t header[12];  // "FRM1" + width + height + length
  memcpy(header, "FRM1", 4);  // marker
  put16(header + 4, XRES);  // width
  put16(header + 6, YRES);  // height
  put32(header + 8, len);  // length
  uint8_t tail[2];  // checksum bytes
  put16(tail, sum);  // fill
  port->write(header, sizeof(header));  // header
  port->write(frame, len);  // pixels
  port->write(tail, sizeof(tail));  // checksum
  port->flush();  // wait until sent
  while (port->available()) port->read();  // drop repeat requests that arrived while we were busy
  picturesSent++;  // count it
  logLine("Sent " + String(XRES) + "x" + String(YRES) + ", " + String(len) + " bytes, checksum " + String(sum) + " to the " + String(who));  // record
}

void toggleBars() {  // camera's built-in test pattern (scaler registers, bit 7)
  if (!cameraOk) {  // never started
    logLine("Test bars: the camera did not start");  // can't
    return;  // done
  }
  barsOn = !barsOn;  // flip
  int xsc = camRead(REG_XSC), ysc = camRead(REG_YSC);  // current values
  camWrite(REG_XSC, xsc & 0x7F);  // bit 7 of XSC = 0
  camWrite(REG_YSC, barsOn ? (ysc | 0x80) : (ysc & 0x7F));  // bit 7 of YSC = bars on/off
  logLine(barsOn ? "Test bars ON" : "Test bars OFF");  // confirm
}

void handle(Stream *port, const char *who) {  // run one command from this port, reply on the same port
  char cmd = port->read();  // take the command byte
  if (cmd == 'C') sendPicture(port, who);  // capture and send
  else if (cmd == 'P') port->print(cameraOk ? "PONG OK\n" : "PONG NOCAM\n");  // alive check
  else if (cmd == 'B') toggleBars();  // bars on/off (log only)
  else if (cmd == 'I') printInfo();  // describe (log only)
}

void setup() {
  Serial.begin(USB_BAUD);  // USB: log text, and the laptop viewer
  mainLink.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);  // UART2 to the main ESP32
  delay(300);  // let the ports settle
  cameraOk = startCamera();  // set everything up
  printInfo();  // describe
  logLine(cameraOk ? "READY" : "CAMERA FAILED");  // last start-up line (USB only, so the main ESP32 isn't confused)
  while (mainLink.available()) mainLink.read();  // forget anything the main ESP32 sent while we were starting
}

void loop() {
  if (mainLink.available()) handle(&mainLink, "main ESP32");  // request from the main board
  if (Serial.available()) handle(&Serial, "laptop");  // request from view_frame.py
}
