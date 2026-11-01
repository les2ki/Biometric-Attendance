// camera_test.ino - bench test for the OV7670 camera (18-pin, no FIFO) on a bare ESP32-WROOM-32
// What it does:
//   1. Starts the camera: makes XCLK itself (like camera_diag), then tries two ways of opening the settings bus
//   2. Takes a photo and draws a rough preview with letters in the Serial Monitor (works even without Wi-Fi)
//   3. Joins your hotspot and shows the live picture in a web browser
// Board: "ESP32 Dev Module". Serial Monitor: 115200 baud. Unplug the LCD and fingerprint sensor for this test.
//
// Wiring (camera label -> ESP32):
//   3.3V -> 3V3      GND -> GND      SCL -> 27      SDA -> 26      VS -> 25      HS -> 23
//   PLK  -> 22       XLK -> 21       D7 -> 35       D6 -> 34       D5 -> 39 (VN) D4 -> 36 (VP)
//   D3   -> 19       D2  -> 18       D1 -> 5        D0 -> 4        RET -> 3V3    PWDN -> GND
//   Pull-ups: 10k (or two 10k in parallel) from SDA to 3V3 and from SCL to 3V3

#include "esp_camera.h"     // camera driver that ships with the ESP32 Arduino core
#include <WiFi.h>           // Wi-Fi, so the picture can be viewed on your phone
#include <WebServer.h>      // tiny web server built into the ESP32 core
#include <Wire.h>           // Arduino I2C library (it read the camera ID 50/50 times in camera_diag)

// ---- your hotspot (iPhone: turn ON "Maximize Compatibility" so it uses 2.4 GHz) ----
const char *WIFI_SSID = "YOUR_HOTSPOT_NAME";      // hotspot name, exactly as shown on the phone
const char *WIFI_PASS = "YOUR_HOTSPOT_PASSWORD";  // hotspot password (remove before pushing to GitHub)

// ---- camera pins ----
const int CAM_PIN_D0 = 4;     // D0
const int CAM_PIN_D1 = 5;     // D1
const int CAM_PIN_D2 = 18;    // D2
const int CAM_PIN_D3 = 19;    // D3
const int CAM_PIN_D4 = 36;    // D4 (VP, input-only pin)
const int CAM_PIN_D5 = 39;    // D5 (VN, input-only pin)
const int CAM_PIN_D6 = 34;    // D6 (input-only pin)
const int CAM_PIN_D7 = 35;    // D7 (input-only pin)
const int CAM_PIN_VSYNC = 25; // VS: start of a new frame
const int CAM_PIN_HREF = 23;  // HS: a line of pixels is valid
const int CAM_PIN_PCLK = 22;  // PLK: pixel clock coming from the camera
const int CAM_PIN_XCLK = 21;  // XLK: 10 MHz clock the ESP32 gives the camera
const int CAM_PIN_SDA = 26;   // SDA (SIOD): settings bus data
const int CAM_PIN_SCL = 27;   // SCL (SIOC): settings bus clock

WebServer server(80);         // web server on the normal web port

void startOwnXclk() {  // makes the 10 MHz camera clock ourselves, exactly like camera_diag did (that worked)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(CAM_PIN_XCLK, 10000000, 1);     // core 3.x: XLK pin, 10 MHz, 1-bit resolution
  ledcWrite(CAM_PIN_XCLK, 1);                // 50% duty cycle = square wave
#else
  ledcSetup(0, 10000000, 1);                 // core 2.x: channel 0, 10 MHz, 1-bit resolution
  ledcAttachPin(CAM_PIN_XCLK, 0);            // connect channel 0 to the XLK pin
  ledcWrite(0, 1);                           // 50% duty cycle
#endif
  delay(50);                                 // give the camera time to wake up on the new clock
}
bool cameraReady = false;     // becomes true once the camera has started

void fillCommonSettings(camera_config_t &c) {  // settings that are the same for both start-up methods
  c.pin_d0 = CAM_PIN_D0;                     // data bit 0
  c.pin_d1 = CAM_PIN_D1;                     // data bit 1
  c.pin_d2 = CAM_PIN_D2;                     // data bit 2
  c.pin_d3 = CAM_PIN_D3;                     // data bit 3
  c.pin_d4 = CAM_PIN_D4;                     // data bit 4
  c.pin_d5 = CAM_PIN_D5;                     // data bit 5
  c.pin_d6 = CAM_PIN_D6;                     // data bit 6
  c.pin_d7 = CAM_PIN_D7;                     // data bit 7
  c.pin_vsync = CAM_PIN_VSYNC;               // frame sync
  c.pin_href = CAM_PIN_HREF;                 // line valid
  c.pin_pclk = CAM_PIN_PCLK;                 // pixel clock
  c.pin_xclk = -1;                           // -1 = we make XCLK ourselves (startOwnXclk), the driver must not touch it
  c.pin_pwdn = -1;                           // PWDN is wired to GND, so the ESP32 doesn't control it
  c.pin_reset = -1;                          // RET is wired to 3V3, so the ESP32 doesn't control it
  c.xclk_freq_hz = 10000000;                 // 10 MHz: reliable on jumper wires
  c.ledc_timer = LEDC_TIMER_3;               // spare timer, so the driver can't disturb our XCLK on timer 0
  c.ledc_channel = LEDC_CHANNEL_7;           // spare channel, for the same reason
  c.pixel_format = PIXFORMAT_RGB565;         // OV7670 has no JPEG; RGB565 = 2 bytes per pixel
  c.frame_size = FRAMESIZE_QQVGA;            // 160 x 120 = 38 400 bytes, fits in the ESP32's own RAM
  c.fb_count = 1;                            // one frame buffer (no PSRAM on this board)
  c.fb_location = CAMERA_FB_IN_DRAM;         // keep the frame in internal RAM
  c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;      // only capture when we ask
}

// The fix found by camera_fix.ino: the driver's picture window is a few lines too short,
// so every frame arrived 20% small (30720 instead of 38400 bytes). Making the window taller
// (VSTOP + 24) gives a complete frame; the driver keeps exactly 160x120 and ignores the extra lines.
const uint8_t OV7670_ADDR = 0x21;            // camera bus address
const uint8_t REG_VSTOP = 0x1A;              // "vertical window end" register
const int VSTOP_EXTRA = 24;                  // how much later the window ends (worked 2/2 in camera_fix)

void applyWindowFix() {  // reads VSTOP, adds VSTOP_EXTRA, writes it back
  Wire.beginTransmission(OV7670_ADDR);       // talk to the camera
  Wire.write(REG_VSTOP);                     // which register
  Wire.endTransmission(true);                // full STOP (the OV7670 dislikes a repeated start)
  Wire.requestFrom(OV7670_ADDR, (uint8_t)1); // read one byte
  uint8_t vstop = Wire.available() ? Wire.read() : 0x7A;  // current value (0x7A if the read failed)
  uint8_t fixed = (uint8_t)min(255, vstop + VSTOP_EXTRA);  // new, later window end
  Wire.beginTransmission(OV7670_ADDR);       // talk to the camera again
  Wire.write(REG_VSTOP);                     // which register
  Wire.write(fixed);                         // new value
  Wire.endTransmission(true);                // send it
  Serial.printf("Window fix: VSTOP 0x%02X -> 0x%02X\n", vstop, fixed);  // report
  delay(300);                                // let a full frame pass with the new window
}

bool startCamera() {  // tries method A, then method B; returns true when one of them works
  camera_config_t config = {};               // zero every setting first
  fillCommonSettings(config);                // pins, clock, format, size
  startOwnXclk();                            // start the camera clock the way that worked in camera_diag

  // Method A: open the settings bus with Wire, then let the camera driver borrow it
  Serial.println("Method A: camera driver borrows the Wire bus...");  // progress
  Wire.begin(CAM_PIN_SDA, CAM_PIN_SCL, 100000);  // I2C port 0 on SDA=26, SCL=27 at 100 kHz
  config.pin_sccb_sda = -1;                  // -1 = don't open your own bus...
  config.pin_sccb_scl = -1;                  // ...for data or clock...
  config.sccb_i2c_port = 0;                  // ...use I2C port 0, the one Wire just opened
  esp_err_t err = esp_camera_init(&config);  // start the camera
  if (err == ESP_OK) return true;            // worked first time
  Serial.printf("  method A failed (error 0x%x)\n", err);  // report and fall through to method B

  // Method B: let the camera driver open the settings bus by itself
  esp_camera_deinit();                       // undo anything method A half-started
  Wire.end();                                // close the Wire bus so the driver can take the pins
  delay(100);                                // let the pins settle
  Serial.println("Method B: camera driver opens its own bus...");  // progress
  config.pin_sccb_sda = CAM_PIN_SDA;         // the driver uses SDA itself
  config.pin_sccb_scl = CAM_PIN_SCL;         // the driver uses SCL itself
  err = esp_camera_init(&config);            // start the camera
  if (err == ESP_OK) {                       // worked
    Wire.begin(CAM_PIN_SDA, CAM_PIN_SCL, 100000);  // take the pins back so applyWindowFix() can write registers
    return true;                             // camera is running
  }
  Serial.printf("  method B failed (error 0x%x)\n", err);  // report
  return false;                              // neither method worked
}

uint8_t brightness(camera_fb_t *fb, int x, int y) {  // brightness (0-255) of one pixel in an RGB565 frame
  int i = (y * fb->width + x) * 2;           // each pixel takes 2 bytes
  uint16_t p = (fb->buf[i] << 8) | fb->buf[i + 1];  // the 16-bit colour value (camera sends high byte first)
  uint8_t r = (p >> 11) & 0x1F;              // 5 bits of red
  uint8_t g = (p >> 5) & 0x3F;               // 6 bits of green
  uint8_t b = p & 0x1F;                      // 5 bits of blue
  return (r * 8 * 30 + g * 4 * 59 + b * 8 * 11) / 100;  // standard brightness mix, scaled to 0-255
}

void serialPreview() {  // takes one photo and draws it with letters in the Serial Monitor
  camera_fb_t *fb = esp_camera_fb_get();     // capture one frame
  if (!fb) {                                 // no frame = data wiring problem
    Serial.println("Capture FAILED: check PLK->22, VS->25, HS->23 and D0-D7");  // hint
    return;                                  // stop
  }
  Serial.printf("Captured %ux%u, %u bytes\n", fb->width, fb->height, (unsigned)fb->len);  // frame info
  const char *shades = " .:-=+*#%@";        // dark to bright
  for (int y = 0; y < fb->height; y += 6) {  // every 6th row (20 rows of text)
    for (int x = 0; x < fb->width; x += 3) { // every 3rd column (53 characters wide)
      Serial.print(shades[brightness(fb, x, y) * 9 / 255]);  // pick a character by brightness
    }
    Serial.println();                        // next text row
  }
  esp_camera_fb_return(fb);                  // give the frame buffer back to the driver
  Serial.println("(Wave your hand in front of the camera and press EN: the picture should change.)");  // tip
}

void handleRoot() {  // web page at http://<ip>/ : shows the picture and refreshes it every 2 s
  server.send(200, "text/html",
    "<html><body style='font-family:sans-serif;text-align:center'>"
    "<h2>BSAVS camera test</h2>"
    "<img id='p' src='/capture' style='width:480px;image-rendering:pixelated'>"
    "<p>Refreshes every 2 s</p>"
    "<script>setInterval(()=>{p.src='/capture?t='+Date.now()},2000)</script>"
    "</body></html>");                       // the whole page in one go
}

void put32(uint8_t *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }  // write a 4-byte number (little-endian) into the BMP header
void put16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }  // write a 2-byte number into the BMP header

void handleCapture() {  // http://<ip>/capture : one photo, sent as a BMP one row at a time (needs almost no RAM)
  camera_fb_t *fb = esp_camera_fb_get();     // capture one frame
  if (!fb) {                                 // the frame was incomplete
    Serial.println("Web capture: frame incomplete (still FB-SIZE errors?)");  // tell the Serial Monitor
    server.send(500, "text/plain", "Capture failed: frame incomplete");  // tell the browser
    return;                                  // stop
  }
  int w = fb->width, h = fb->height;         // picture size (160 x 120)
  uint32_t rowBytes = w * 3;                 // 3 bytes (blue, green, red) per pixel in a 24-bit BMP
  uint32_t pad = (4 - (rowBytes % 4)) % 4;   // BMP rows must be a multiple of 4 bytes
  uint32_t dataSize = (rowBytes + pad) * h;  // all the pixel bytes
  uint8_t hdr[54] = {0};                     // standard BMP header: 14-byte file header + 40-byte info header
  hdr[0] = 'B'; hdr[1] = 'M';                // "BM" = this is a BMP
  put32(hdr + 2, 54 + dataSize);             // total file size
  put32(hdr + 10, 54);                       // where the pixels start
  put32(hdr + 14, 40);                       // info header size
  put32(hdr + 18, w);                        // width
  put32(hdr + 22, (uint32_t)(-h));           // negative height = rows go top to bottom
  put16(hdr + 26, 1);                        // one colour plane
  put16(hdr + 28, 24);                       // 24 bits per pixel
  put32(hdr + 34, dataSize);                 // pixel data size
  server.setContentLength(54 + dataSize);    // tell the browser how many bytes are coming
  server.send(200, "image/bmp", "");         // send the HTTP headers
  server.sendContent((const char *)hdr, 54); // send the BMP header
  static uint8_t row[320 * 3 + 4];           // one row of pixels (big enough for up to 320 wide)
  for (int y = 0; y < h; y++) {              // each row
    for (int x = 0; x < w; x++) {            // each pixel in the row
      int i = (y * w + x) * 2;               // where this pixel is in the camera frame
      uint16_t p = (fb->buf[i] << 8) | fb->buf[i + 1];  // 16-bit colour (high byte first)
      row[x * 3 + 0] = (p & 0x1F) << 3;      // blue  (5 bits -> 8 bits)
      row[x * 3 + 1] = ((p >> 5) & 0x3F) << 2;  // green (6 bits -> 8 bits)
      row[x * 3 + 2] = ((p >> 11) & 0x1F) << 3; // red   (5 bits -> 8 bits)
    }
    for (uint32_t k = 0; k < pad; k++) row[rowBytes + k] = 0;  // padding bytes
    server.sendContent((const char *)row, rowBytes + pad);  // send this row
  }
  esp_camera_fb_return(fb);                  // give the frame back to the driver
  Serial.println("Web capture: picture sent");  // confirmation in the Serial Monitor
}

void setup() {  // runs once at power-up
  Serial.begin(115200);                      // USB serial monitor
  delay(800);                                // let the monitor connect
  Serial.println("\n=== BSAVS OV7670 camera test ===");  // banner
  Serial.printf("ESP32 board package: %d.%d.%d\n", ESP_ARDUINO_VERSION_MAJOR, ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);  // useful when asking for help

  cameraReady = startCamera();               // try both start-up methods
  if (!cameraReady) {                        // still not working
    Serial.println("Camera did NOT start. Send this whole Serial Monitor output to Claude.");  // next step
    return;                                  // nothing else to do
  }
  sensor_t *s = esp_camera_sensor_get();     // handle to the camera's settings
  Serial.printf("Camera started! Sensor PID = 0x%02X (OV7670 = 0x76)\n", s->id.PID);  // success
  applyWindowFix();                          // make the frames complete (see the note above applyWindowFix)
  serialPreview();                           // first photo, shown as letters (no Wi-Fi needed)

  WiFi.mode(WIFI_STA);                       // join an existing network
  WiFi.begin(WIFI_SSID, WIFI_PASS);          // your hotspot
  Serial.print("Connecting to Wi-Fi");       // progress
  unsigned long start = millis();            // remember when we started
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {  // wait up to 20 s
    delay(500);                              // check twice a second
    Serial.print(".");                       // progress dot
  }
  Serial.println();                          // new line
  if (WiFi.status() != WL_CONNECTED) {       // gave up
    Serial.println("Wi-Fi not connected (check name/password, 2.4 GHz / Maximize Compatibility). The serial preview above still proves the camera works.");  // hint
    return;                                  // no web page without Wi-Fi
  }
  Serial.print("Open on your phone (same hotspot): http://");  // instruction
  Serial.println(WiFi.localIP());            // e.g. 172.20.10.2 on an iPhone hotspot
  server.on("/", handleRoot);                // page with the live picture
  server.on("/capture", handleCapture);      // one picture
  server.begin();                            // start answering browsers
}

void loop() {  // runs forever
  if (cameraReady && WiFi.status() == WL_CONNECTED) server.handleClient();  // answer browser requests
}
