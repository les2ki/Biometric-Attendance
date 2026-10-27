// fingerprint_test.ino - Stage 1 bench test for the DY50 (DY50-2 v1) fingerprint sensor on an ESP32
// Biometric Student Attendance terminal. Wiring: see docs/hardware/fingerprint-wiring.png
// Serial Monitor: 115200 baud, line ending "Newline". Type a command and press Enter:
//   i        sensor info (capacity, security level, stored templates)
//   s        scan once: place a finger, prints slot + confidence (1:N search)
//   a        toggle auto-scan mode (scans continuously, like the real terminal will)
//   e<slot>  enrol a finger into a slot, e.g. e1
//   d<slot>  delete one slot, e.g. d1
//   x        delete ALL slots (asks for confirmation)

#include <Adafruit_Fingerprint.h>  // driver for DY50 / FPM10A / R307 / AS608 sensors (same protocol) (Library Manager: "Adafruit Fingerprint Sensor Library")

const int FP_RX_PIN = 16;  // ESP32 GPIO16 = UART2 RX, wired to the sensor's TX
const int FP_TX_PIN = 17;  // ESP32 GPIO17 = UART2 TX, wired to the sensor's RX
const uint32_t FP_BAUD = 57600;  // factory default baud rate of these sensors
const uint16_t FINGER_TIMEOUT_MS = 10000;  // how long we wait for a finger before giving up

HardwareSerial fingerSerial(2);  // use the ESP32's hardware UART number 2
Adafruit_Fingerprint finger(&fingerSerial);  // sensor object that talks over UART2

bool autoScan = false;  // true = keep scanning in loop() without typing 's'

void printHelp() {  // list the available commands
  Serial.println("Commands: i=info  s=scan  a=auto-scan on/off  e<slot>=enrol  d<slot>=delete  x=delete all");  // one-line help
}

bool waitForFinger(uint16_t timeoutMs) {  // wait until a finger image is captured, or time out
  unsigned long start = millis();  // remember when we started waiting
  while (millis() - start < timeoutMs) {  // keep trying until the timeout
    uint8_t r = finger.getImage();  // ask the sensor to take a picture
    if (r == FINGERPRINT_OK) return true;  // got an image
    if (r != FINGERPRINT_NOFINGER) Serial.println("  imaging error, keep finger still");  // something other than "no finger yet"
    delay(50);  // short pause between attempts
  }
  return false;  // nobody placed a finger in time
}

void waitForRemoval() {  // wait until the finger is lifted off the glass
  while (finger.getImage() != FINGERPRINT_NOFINGER) delay(50);  // keep checking until the glass is empty
}

void showInfo() {  // print the sensor's parameters
  finger.getParameters();  // read capacity, security level, etc. from the sensor
  finger.getTemplateCount();  // count stored fingerprints
  Serial.print("Capacity: "); Serial.println(finger.capacity);  // maximum templates the sensor can hold
  Serial.print("Security level: "); Serial.println(finger.security_level);  // 1 (loose) .. 5 (strict); design targets level 3
  Serial.print("Stored templates: "); Serial.println(finger.templateCount);  // how many slots are in use
}

bool scanOnce(uint16_t timeoutMs, bool quiet) {  // capture a finger and search all stored templates (1:N)
  if (!quiet) Serial.println("Place finger on the sensor...");  // prompt
  if (!waitForFinger(timeoutMs)) {  // nothing placed in time
    if (!quiet) Serial.println("  no finger detected");  // tell the user
    return false;  // give up
  }
  if (finger.image2Tz(1) != FINGERPRINT_OK) {  // convert the image to features in buffer 1
    Serial.println("  unclear image, try again (press firmly, finger dry and clean)");  // usual cause of failure
    waitForRemoval();  // wait for the finger to lift
    return false;  // try again next time
  }
  uint8_t r = finger.fingerSearch();  // compare buffer 1 against every stored template
  if (r == FINGERPRINT_OK) {  // a match was found
    Serial.print("  MATCH  slot="); Serial.print(finger.fingerID);  // which slot matched (the backend maps slot -> student)
    Serial.print("  confidence="); Serial.println(finger.confidence);  // match score (backend threshold: fp_accept_confidence)
  } else if (r == FINGERPRINT_NOTFOUND) {  // valid print but not enrolled
    Serial.println("  NO MATCH (finger not enrolled)");  // terminal would show "Not recognised"
  } else {  // communication problem
    Serial.println("  search error (check wiring)");  // usually a loose wire
  }
  waitForRemoval();  // don't scan the same touch twice
  return r == FINGERPRINT_OK;  // true only on a match
}

bool enrol(uint16_t slot) {  // capture the same finger twice and store it in a slot
  Serial.print("Enrolling into slot "); Serial.println(slot);  // confirm the target slot
  Serial.println("Place finger...");  // first capture
  if (!waitForFinger(FINGER_TIMEOUT_MS)) { Serial.println("  timed out"); return false; }  // no finger
  if (finger.image2Tz(1) != FINGERPRINT_OK) { Serial.println("  unclear image, start again"); return false; }  // bad first image
  Serial.println("  OK. Remove finger.");  // ask the user to lift
  delay(500);  // small pause so the user reacts
  waitForRemoval();  // wait until lifted
  Serial.println("Place the SAME finger again...");  // second capture
  if (!waitForFinger(FINGER_TIMEOUT_MS)) { Serial.println("  timed out"); return false; }  // no finger
  if (finger.image2Tz(2) != FINGERPRINT_OK) { Serial.println("  unclear image, start again"); return false; }  // bad second image
  uint8_t r = finger.createModel();  // combine both captures into one template
  if (r == FINGERPRINT_ENROLLMISMATCH) { Serial.println("  the two captures didn't match, start again"); return false; }  // different finger or poor placement
  if (r != FINGERPRINT_OK) { Serial.println("  could not create template"); return false; }  // other error
  r = finger.storeModel(slot);  // save the template in the sensor's flash at this slot
  if (r != FINGERPRINT_OK) { Serial.println("  could not store (slot out of range?)"); return false; }  // e.g. slot > capacity
  Serial.println("  STORED. Enrolment complete.");  // success
  waitForRemoval();  // tidy up
  return true;  // done
}

void setup() {  // runs once at power-up
  Serial.begin(115200);  // USB serial monitor
  delay(500);  // give the monitor time to attach
  fingerSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);  // start UART2 on our chosen pins
  delay(100);  // let the sensor settle
  if (finger.verifyPassword()) {  // handshake using the default password (0x00000000)
    Serial.println("DY50 found.");  // wiring and power are good
  } else {  // no reply
    Serial.println("DY50 NOT found. Check: VCC on VIN (5V), GND, sensor TX->GPIO16, sensor RX->GPIO17 (try swapping TX/RX).");  // most common fixes
    while (true) delay(1000);  // stop here until reset
  }
  showInfo();  // print capacity and current templates
  printHelp();  // show the command list
}

void loop() {  // runs forever
  if (Serial.available()) {  // a command was typed
    String line = Serial.readStringUntil('\n');  // read the whole line
    line.trim();  // remove spaces and \r
    if (line.length() == 0) return;  // ignore empty lines
    char cmd = line.charAt(0);  // first character = command
    int arg = line.substring(1).toInt();  // the rest = number (slot), 0 if none
    if (cmd == 'i') showInfo();  // info
    else if (cmd == 's') scanOnce(FINGER_TIMEOUT_MS, false);  // single scan
    else if (cmd == 'a') { autoScan = !autoScan; Serial.println(autoScan ? "Auto-scan ON" : "Auto-scan OFF"); }  // toggle auto mode
    else if (cmd == 'e' && arg >= 1) enrol(arg);  // enrol into slot arg
    else if (cmd == 'd' && arg >= 1) Serial.println(finger.deleteModel(arg) == FINGERPRINT_OK ? "Deleted." : "Delete failed.");  // delete one slot
    else if (cmd == 'x') {  // wipe everything
      Serial.println("Type YES to delete all templates:");  // safety prompt
      while (!Serial.available()) delay(10);  // wait for the answer
      String confirm = Serial.readStringUntil('\n'); confirm.trim();  // read it
      Serial.println(confirm == "YES" && finger.emptyDatabase() == FINGERPRINT_OK ? "All templates deleted." : "Cancelled.");  // only on exact YES
    }
    else printHelp();  // unknown command
  }
  if (autoScan) scanOnce(200, true);  // in auto mode, look for a finger briefly each loop (quiet when nobody touches)
}
