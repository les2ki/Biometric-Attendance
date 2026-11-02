// camera_fix.ino - last attempt: find WHY the OV7670 frames are 20% short and try to fix it automatically
// Board package 2.0.17. Same wiring as camera_test. Serial Monitor 115200. Takes about 3-4 minutes.
// Phase A: print the camera's window/clock registers (so we know how the driver set it up)
// Phase B: count how many lines each frame really has (120 expected at 160x120)
// Phase C: slow the camera's pixel clock (if the ESP32 is missing bytes because they come too fast)
// Phase D: make the picture window taller (if lines are missing)
// Phase E: make the picture window wider (if pixels per line are missing)
// At the end it prints a RESULTS table. Send that to Claude.

#include "esp_camera.h"  // camera driver
#include <Wire.h>        // I2C, to read/write camera registers ourselves (worked 50/50 in camera_diag)

const int CAM_PIN_D0 = 4, CAM_PIN_D1 = 5, CAM_PIN_D2 = 18, CAM_PIN_D3 = 19;    // data bits 0-3
const int CAM_PIN_D4 = 36, CAM_PIN_D5 = 39, CAM_PIN_D6 = 34, CAM_PIN_D7 = 35;  // data bits 4-7
const int CAM_PIN_VSYNC = 25, CAM_PIN_HREF = 23, CAM_PIN_PCLK = 22;           // VS, HS, PLK
const int CAM_PIN_XCLK = 21, CAM_PIN_SDA = 26, CAM_PIN_SCL = 27;              // XLK, SDA, SCL
const uint8_t ADDR = 0x21;                   // OV7670 bus address

// OV7670 register numbers (from the OV7670 datasheet)
const uint8_t REG_VREF = 0x03, REG_CLKRC = 0x11, REG_COM7 = 0x12, REG_HSTART = 0x17, REG_HSTOP = 0x18;  // window + clock
const uint8_t REG_VSTRT = 0x19, REG_VSTOP = 0x1A, REG_HREF = 0x32, REG_COM14 = 0x3E, REG_DBLV = 0x6B;    // window + PLL
const uint8_t REG_COM3 = 0x0C, REG_SCALE_DCW = 0x72, REG_SCALE_PCLK = 0x73;                             // scaling

String results = "";                         // the final table

void startXclk() {  // our own 10 MHz camera clock
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(CAM_PIN_XCLK, 10000000, 1);     // core 3.x API
  ledcWrite(CAM_PIN_XCLK, 1);                // 50% duty
#else
  ledcSetup(0, 10000000, 1);                 // core 2.x: channel 0, 10 MHz, 1-bit
  ledcAttachPin(CAM_PIN_XCLK, 0);            // to the XLK pin
  ledcWrite(0, 1);                           // 50% duty = square wave
#endif
  delay(50);                                 // let the camera wake up
}

uint8_t rd(uint8_t reg) {  // read one camera register (write address, STOP, then read - the way the OV7670 likes)
  Wire.beginTransmission(ADDR);              // talk to the camera
  Wire.write(reg);                           // which register
  Wire.endTransmission(true);                // full STOP
  Wire.requestFrom(ADDR, (uint8_t)1);        // ask for one byte
  return Wire.available() ? Wire.read() : 0xFF;  // the value (0xFF if nothing came back)
}

void wr(uint8_t reg, uint8_t val) {  // write one camera register
  Wire.beginTransmission(ADDR);              // talk to the camera
  Wire.write(reg);                           // which register
  Wire.write(val);                           // new value
  Wire.endTransmission(true);                // send it
  delay(5);                                  // give the camera a moment
}

bool startCam() {  // starts the driver at 160x120 RGB565, sharing the Wire bus so we can also use Wire
  camera_config_t c = {};                    // zero everything
  c.pin_d0 = CAM_PIN_D0; c.pin_d1 = CAM_PIN_D1; c.pin_d2 = CAM_PIN_D2; c.pin_d3 = CAM_PIN_D3;  // data 0-3
  c.pin_d4 = CAM_PIN_D4; c.pin_d5 = CAM_PIN_D5; c.pin_d6 = CAM_PIN_D6; c.pin_d7 = CAM_PIN_D7;  // data 4-7
  c.pin_vsync = CAM_PIN_VSYNC; c.pin_href = CAM_PIN_HREF; c.pin_pclk = CAM_PIN_PCLK;           // sync + clock in
  c.pin_xclk = -1;                           // XCLK is ours
  c.pin_pwdn = -1; c.pin_reset = -1;         // hard-wired
  c.xclk_freq_hz = 10000000;                 // what XCLK is
  c.ledc_timer = LEDC_TIMER_3; c.ledc_channel = LEDC_CHANNEL_7;  // spare (unused)
  c.pixel_format = PIXFORMAT_RGB565;         // colour
  c.frame_size = FRAMESIZE_QQVGA;            // 160 x 120
  c.fb_count = 1; c.fb_location = CAMERA_FB_IN_DRAM; c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;  // one buffer in RAM
  c.pin_sccb_sda = -1; c.pin_sccb_scl = -1; c.sccb_i2c_port = 0;  // method A: share the Wire bus
  if (esp_camera_init(&c) == ESP_OK) return true;  // worked
  esp_camera_deinit();                       // clean up
  c.pin_sccb_sda = CAM_PIN_SDA; c.pin_sccb_scl = CAM_PIN_SCL;  // method B: driver opens its own bus
  bool ok = esp_camera_init(&c) == ESP_OK;   // try again
  Wire.end();                                // the driver took the pins for its own bus...
  Wire.begin(CAM_PIN_SDA, CAM_PIN_SCL, 100000);  // ...so take them back for our own register reads/writes
  return ok;                                 // result
}

int grab(int tries) {  // tries to capture complete frames; returns how many were complete (38400 bytes)
  int ok = 0;                                // complete frames
  for (int i = 0; i < tries; i++) {          // each attempt
    camera_fb_t *fb = esp_camera_fb_get();   // NULL if the frame was the wrong size
    if (fb) { if (fb->len == 38400) ok++; esp_camera_fb_return(fb); }  // count + give back
  }
  return ok;                                 // how many worked
}

void note(const String &s) {  // prints a line now AND saves it for the final table
  Serial.println(s);                         // now
  results += s + "\n";                       // later
}

volatile uint32_t hrefCount = 0, framesSeen = 0, linesLastFrame = 0;  // counters updated by interrupts
void IRAM_ATTR onHref() { hrefCount++; }     // one more line started
void IRAM_ATTR onVsync() { linesLastFrame = hrefCount; hrefCount = 0; framesSeen++; }  // a new frame: save the line count

void setup() {
  Serial.begin(115200);                      // serial monitor
  delay(800);                                // let it connect
  Serial.println("\n=== OV7670 frame fixer (wait ~3-4 min, ignore red E (...) lines) ===");  // banner
  startXclk();                               // camera clock on
  Wire.begin(CAM_PIN_SDA, CAM_PIN_SCL, 100000);  // our I2C bus
  if (!startCam()) { Serial.println("Driver did not start. Stop here and tell Claude."); return; }  // safety

  // ---- Phase A: how did the driver set the camera up? ----
  uint8_t vref = rd(REG_VREF), hstart = rd(REG_HSTART), hstop = rd(REG_HSTOP), href = rd(REG_HREF);  // window regs
  uint8_t vstrt = rd(REG_VSTRT), vstop = rd(REG_VSTOP), clkrc = rd(REG_CLKRC), dblv = rd(REG_DBLV);  // window + clock
  note("A) COM7=" + String(rd(REG_COM7), HEX) + " COM3=" + String(rd(REG_COM3), HEX) + " COM14=" + String(rd(REG_COM14), HEX) +
       " DCW=" + String(rd(REG_SCALE_DCW), HEX) + " PCLKDIV=" + String(rd(REG_SCALE_PCLK), HEX));  // scaling setup
  note("   HSTART=" + String(hstart, HEX) + " HSTOP=" + String(hstop, HEX) + " HREF=" + String(href, HEX) +
       " VSTRT=" + String(vstrt, HEX) + " VSTOP=" + String(vstop, HEX) + " VREF=" + String(vref, HEX) +
       " CLKRC=" + String(clkrc, HEX) + " DBLV=" + String(dblv, HEX));  // window + clock

  // ---- Phase B: count real lines per frame (driver paused so we can watch VS/HS ourselves) ----
  esp_camera_deinit();                       // stop the driver; the camera keeps running on our XCLK
  Wire.end();                                // restart our bus cleanly...
  Wire.begin(CAM_PIN_SDA, CAM_PIN_SCL, 100000);  // ...so the pins are definitely ours
  attachInterrupt(CAM_PIN_HREF, onHref, RISING);    // count line starts
  attachInterrupt(CAM_PIN_VSYNC, onVsync, RISING);  // count frames
  delay(1500);                               // watch for 1.5 s
  detachInterrupt(CAM_PIN_HREF);             // stop counting
  detachInterrupt(CAM_PIN_VSYNC);            // stop counting
  unsigned long hi = pulseIn(CAM_PIN_HREF, HIGH, 100000);  // how long one line lasts (microseconds)
  note("B) frames/1.5s=" + String(framesSeen) + "  lines/frame=" + String(linesLastFrame) + " (expect 120)  line time=" + String(hi) + " us");  // result

  // ---- Phase C: slower pixel clock ----
  const uint8_t divs[] = {1, 2, 3, 5, 7};    // divide the camera's internal clock by 2, 3, 4, 6, 8
  for (uint8_t d : divs) {                   // try each
    if (!startCam()) break;                  // restart driver (it rewrites all registers)
    wr(REG_DBLV, 0x0A);                      // PLL off (no clock multiplying)
    wr(REG_CLKRC, d);                        // divide the clock
    delay(300);                              // let a few frames pass at the new speed
    int ok = grab(3);                        // try to capture
    note("C) clock /" + String(d + 1) + " : " + String(ok) + "/3 complete" + (ok ? "  <-- WORKS" : ""));  // result
    esp_camera_deinit();                     // stop for the next try
  }

  // ---- Phase D: taller window (more lines) ----
  const int addV[] = {6, 12, 18, 24, 30};    // how much to move VSTOP down
  for (int a : addV) {                       // try each
    if (!startCam()) break;                  // fresh driver setup
    wr(REG_VSTOP, (uint8_t)min(255, vstop + a));  // end the picture later = more lines
    delay(300);                              // let a frame pass
    int ok = grab(2);                        // try to capture
    note("D) VSTOP+" + String(a) + " : " + String(ok) + "/2 complete" + (ok ? "  <-- WORKS" : ""));  // result
    esp_camera_deinit();                     // stop for the next try
  }

  // ---- Phase E: wider window (more pixels per line) ----
  const int addH[] = {4, 8, 12, 16};         // how much to move HSTOP right (units of 8 sensor pixels)
  for (int a : addH) {                       // try each
    if (!startCam()) break;                  // fresh driver setup
    wr(REG_HSTOP, (uint8_t)((hstop + a) & 0xFF));  // end each line later = more pixels
    delay(300);                              // let a frame pass
    int ok = grab(2);                        // try to capture
    note("E) HSTOP+" + String(a) + " : " + String(ok) + "/2 complete" + (ok ? "  <-- WORKS" : ""));  // result
    esp_camera_deinit();                     // stop for the next try
  }

  Serial.println("\n========== RESULTS ==========");  // header
  Serial.print(results);                     // everything noted above
  Serial.println("=============================\nSend this whole table to Claude.");  // footer
}

void loop() {}  // nothing to repeat
