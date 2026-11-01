// camera_explore.ino - finds a picture size + colour format that the OV7670 delivers COMPLETE frames in
// Why: camera_test showed "FB-SIZE: 30720 != 38400" = the camera sent 80% of the expected bytes at 160x120.
// This sketch tries several sizes/formats, grabs 5 frames each, and prints a results table. No Wi-Fi needed.
// Same wiring as camera_test. Board package 2.0.17. Serial Monitor: 115200.

#include "esp_camera.h"  // camera driver

const int CAM_PIN_D0 = 4, CAM_PIN_D1 = 5, CAM_PIN_D2 = 18, CAM_PIN_D3 = 19;    // data bits 0-3
const int CAM_PIN_D4 = 36, CAM_PIN_D5 = 39, CAM_PIN_D6 = 34, CAM_PIN_D7 = 35;  // data bits 4-7 (input-only pins)
const int CAM_PIN_VSYNC = 25, CAM_PIN_HREF = 23, CAM_PIN_PCLK = 22;           // VS, HS, PLK
const int CAM_PIN_XCLK = 21, CAM_PIN_SDA = 26, CAM_PIN_SCL = 27;              // XLK, SDA, SCL

struct Combo { framesize_t size; const char *sizeName; int w; int h; pixformat_t fmt; const char *fmtName; int bpp; };  // one thing to try
const Combo combos[] = {                                             // everything we will try, smallest first
  {FRAMESIZE_QQVGA, "QQVGA 160x120", 160, 120, PIXFORMAT_RGB565,    "RGB565",    2},  // what camera_test used
  {FRAMESIZE_QQVGA, "QQVGA 160x120", 160, 120, PIXFORMAT_YUV422,    "YUV422",    2},  // same size, other colour format
  {FRAMESIZE_QQVGA, "QQVGA 160x120", 160, 120, PIXFORMAT_GRAYSCALE, "GRAYSCALE", 1},  // black and white, half the bytes
  {FRAMESIZE_QCIF,  "QCIF 176x144",  176, 144, PIXFORMAT_RGB565,    "RGB565",    2},  // slightly bigger
  {FRAMESIZE_QVGA,  "QVGA 320x240",  320, 240, PIXFORMAT_GRAYSCALE, "GRAYSCALE", 1},  // bigger, black and white (76.8 KB)
  {FRAMESIZE_QVGA,  "QVGA 320x240",  320, 240, PIXFORMAT_YUV422,    "YUV422",    2},  // probably too big for RAM, try anyway
};

void startXclk() {  // 10 MHz camera clock made by us (the method that worked in camera_diag)
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(CAM_PIN_XCLK, 10000000, 1);     // core 3.x API
  ledcWrite(CAM_PIN_XCLK, 1);                // 50% duty
#else
  ledcSetup(0, 10000000, 1);                 // core 2.x: channel 0, 10 MHz, 1-bit
  ledcAttachPin(CAM_PIN_XCLK, 0);            // to the XLK pin
  ledcWrite(0, 1);                           // 50% duty
#endif
  delay(50);                                 // let the camera wake up
}

bool tryCombo(const Combo &c, int &goodFrames) {  // starts the camera with one combo and grabs 5 frames
  camera_config_t cfg = {};                  // zero everything
  cfg.pin_d0 = CAM_PIN_D0; cfg.pin_d1 = CAM_PIN_D1; cfg.pin_d2 = CAM_PIN_D2; cfg.pin_d3 = CAM_PIN_D3;  // data 0-3
  cfg.pin_d4 = CAM_PIN_D4; cfg.pin_d5 = CAM_PIN_D5; cfg.pin_d6 = CAM_PIN_D6; cfg.pin_d7 = CAM_PIN_D7;  // data 4-7
  cfg.pin_vsync = CAM_PIN_VSYNC; cfg.pin_href = CAM_PIN_HREF; cfg.pin_pclk = CAM_PIN_PCLK;            // sync + clock in
  cfg.pin_xclk = -1;                         // we make XCLK ourselves
  cfg.pin_sccb_sda = CAM_PIN_SDA; cfg.pin_sccb_scl = CAM_PIN_SCL;  // settings bus
  cfg.pin_pwdn = -1; cfg.pin_reset = -1;     // hard-wired
  cfg.xclk_freq_hz = 10000000;               // tell the driver what XCLK is
  cfg.ledc_timer = LEDC_TIMER_3; cfg.ledc_channel = LEDC_CHANNEL_7;  // spare timer/channel (unused, XCLK is ours)
  cfg.pixel_format = c.fmt;                  // colour format to test
  cfg.frame_size = c.size;                   // picture size to test
  cfg.fb_count = 1;                          // one buffer
  cfg.fb_location = CAMERA_FB_IN_DRAM;       // internal RAM (no PSRAM)
  cfg.grab_mode = CAMERA_GRAB_WHEN_EMPTY;    // capture on request
  if (esp_camera_init(&cfg) != ESP_OK) return false;  // driver refused (format unsupported or not enough RAM)
  goodFrames = 0;                            // count complete frames
  for (int i = 0; i < 5; i++) {              // 5 attempts
    camera_fb_t *fb = esp_camera_fb_get();   // grab one frame (NULL if the size was wrong)
    if (fb) {                                // a complete frame arrived
      if ((int)fb->len == c.w * c.h * c.bpp) goodFrames++;  // and it is exactly the right size
      esp_camera_fb_return(fb);              // give it back
    }
  }
  esp_camera_deinit();                       // stop the driver before the next combo
  return true;                               // the driver at least started
}

void setup() {  // runs once
  Serial.begin(115200);                      // serial monitor
  delay(800);                                // let it connect
  Serial.printf("\n=== OV7670 size/format explorer (board package %d.%d.%d) ===\n", ESP_ARDUINO_VERSION_MAJOR, ESP_ARDUINO_VERSION_MINOR, ESP_ARDUINO_VERSION_PATCH);  // banner
  startXclk();                               // start the camera clock once; it stays on for all tests
  Serial.println("(Ignore the red E (...) cam_hal lines while it runs - read the RESULTS table at the end.)");  // tip
  String results = "";                       // collect the table, print it at the end so it isn't lost in errors
  for (const Combo &c : combos) {            // try each combo
    int good = 0;                            // complete frames for this combo
    bool started = tryCombo(c, good);        // run the test
    char line[96];                           // one table row
    snprintf(line, sizeof(line), "%-15s %-10s : %s\n", c.sizeName, c.fmtName,
             !started ? "driver refused" : (good == 5 ? "5/5 COMPLETE  <-- USE THIS" : (String(good) + "/5 complete").c_str()));  // result text
    results += line;                         // add to the table
    delay(300);                              // short pause between tests
  }
  Serial.println("\n========== RESULTS ==========");  // header
  Serial.print(results);                     // the table
  Serial.println("=============================");    // footer
  Serial.println("Send this table to Claude.");      // next step
}

void loop() {}  // nothing to repeat
