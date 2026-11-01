// camera_diag.ino - finds out WHY the OV7670 does not answer on its settings bus (SCL/SDA)
// Same wiring as camera_test. Open the Serial Monitor at 115200 and read the report.

#include <Wire.h>  // I2C library; the OV7670 settings bus (SCCB) is I2C-compatible

const int PIN_SDA = 26;   // camera SDA (SIOD)
const int PIN_SCL = 27;   // camera SCL (SIOC)
const int PIN_XCLK = 21;  // camera XLK (XCLK): the camera's brain only runs while this clock is present
const uint8_t OV7670_ADDR = 0x21;  // the OV7670's fixed 7-bit bus address

void startXclk() {  // makes a 10 MHz square wave on XLK so the camera wakes up
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_XCLK, 10000000, 1);  // core 3.x: attach pin, 10 MHz, 1-bit resolution
  ledcWrite(PIN_XCLK, 1);             // 50% duty cycle (1 of 2 steps high)
#else
  ledcSetup(0, 10000000, 1);          // core 2.x: channel 0, 10 MHz, 1-bit resolution
  ledcAttachPin(PIN_XCLK, 0);         // connect the channel to the XLK pin
  ledcWrite(0, 1);                    // 50% duty cycle
#endif
}

bool readReg(uint8_t reg, uint8_t &value) {  // reads one camera register; false if the camera did not answer
  Wire.beginTransmission(OV7670_ADDR);       // talk to the camera
  Wire.write(reg);                           // say which register we want
  if (Wire.endTransmission(true) != 0) return false;  // full STOP (the OV7670 dislikes a repeated start)
  if (Wire.requestFrom(OV7670_ADDR, (uint8_t)1) != 1) return false;  // ask for one byte back
  value = Wire.read();                       // the register value
  return true;                               // success
}

void setup() {  // runs once
  Serial.begin(115200);                      // USB serial monitor
  delay(800);                                // let the monitor connect
  Serial.println("\n=== OV7670 settings-bus diagnostic ===");  // banner

  // Test 1: are SDA/SCL pulled HIGH when idle? (they must be, for I2C to work)
  pinMode(PIN_SDA, INPUT);                   // plain input: shows only EXTERNAL pull-up resistors
  pinMode(PIN_SCL, INPUT);                   // same for the clock line
  delay(10);                                 // let the lines settle
  Serial.printf("1) Without ESP pull-ups: SDA=%d SCL=%d (1 = has external pull-up, 0/random = none)\n", digitalRead(PIN_SDA), digitalRead(PIN_SCL));  // report
  pinMode(PIN_SDA, INPUT_PULLUP);            // now switch on the ESP32's weak internal pull-up
  pinMode(PIN_SCL, INPUT_PULLUP);            // same for the clock line
  delay(10);                                 // let the lines settle
  int sda = digitalRead(PIN_SDA);            // read data line
  int scl = digitalRead(PIN_SCL);            // read clock line
  Serial.printf("2) With ESP pull-ups:    SDA=%d SCL=%d (must both be 1)\n", sda, scl);  // report
  if (!sda || !scl) Serial.println("   -> A line is stuck LOW: wire on the wrong pin, shorted to GND, or camera not powered.");  // hint

  // Test 2: start the camera clock, then look for the camera on the bus
  startXclk();                               // the OV7670 cannot answer without XCLK
  delay(50);                                 // give the camera time to wake up
  Wire.begin(PIN_SDA, PIN_SCL, 50000);       // start I2C on SDA=26, SCL=27 at a slow, safe 50 kHz
  Serial.println("3) Scanning the bus with XCLK running...");  // progress
  int found = 0;                             // how many devices answered
  for (uint8_t a = 1; a < 127; a++) {        // try every possible address
    Wire.beginTransmission(a);               // knock on the door
    if (Wire.endTransmission() == 0) {       // 0 = someone answered
      Serial.printf("   device at 0x%02X%s\n", a, a == OV7670_ADDR ? "  <-- OV7670!" : "");  // report it
      found++;                               // count it
    }
  }
  if (!found) Serial.println("   nothing answered.");  // nobody home

  // Test 3: read the chip ID registers
  uint8_t pid = 0, ver = 0;                  // product ID and version
  if (readReg(0x0A, pid) && readReg(0x0B, ver)) {  // both registers read OK
    Serial.printf("4) Chip ID: PID=0x%02X VER=0x%02X (OV7670 = 0x76 0x73)\n", pid, ver);  // report
    Serial.println("=> Settings bus WORKS at 50 kHz.");  // good news
    // Test 3b: the camera driver talks at 100 kHz, so check how reliable each speed is
    const uint32_t speeds[] = {50000, 100000};  // the two bus speeds to compare
    for (uint32_t hz : speeds) {               // try each speed in turn
      Wire.setClock(hz);                       // change the bus speed
      int ok = 0;                              // successful reads at this speed
      for (int i = 0; i < 50; i++) {           // 50 attempts
        uint8_t v = 0;                         // value read back
        if (readReg(0x0A, v) && v == 0x76) ok++;  // count only correct answers
      }
      Serial.printf("   %3lu kHz: %d / 50 reads correct\n", (unsigned long)(hz / 1000), ok);  // report
    }
    Serial.println("   If 100 kHz is below 50/50, the bus is too weak/noisy for the camera driver:");  // explanation
    Serial.println("   use stronger pull-ups (2x 10k in parallel or 4.7k), shorter SDA/SCL wires, XLK wire away from them.");  // fix
    return;                                  // nothing more to test
  }
  Serial.println("4) Could not read the chip ID.");  // bad news

  // Test 4: maybe SDA and SCL are swapped (some boards print the labels the other way round)
  Wire.end();                                // stop the bus
  Wire.begin(PIN_SCL, PIN_SDA, 50000);       // restart with the two pins swapped
  Serial.println("5) Trying again with SDA/SCL swapped...");  // progress
  Wire.beginTransmission(OV7670_ADDR);       // knock on the camera's door
  if (Wire.endTransmission() == 0) {         // it answered this time
    Serial.println("   -> FOUND with swapped pins! Swap the SDA and SCL wires (or the numbers in the code).");  // diagnosis
  } else {
    Serial.println("   -> still nothing. So it is power, PWDN, RET or XLK (see checklist).");  // diagnosis
  }
  Serial.println("Measure with a multimeter (black on GND): camera 3.3V pin ~3.3V, RET ~3.3V, PWDN 0V,");  // checklist 1
  Serial.println("XLK (GPIO21) ~1.6V while this sketch runs (that proves the 10 MHz clock is there).");    // checklist 2
}

void loop() {}  // nothing to repeat
