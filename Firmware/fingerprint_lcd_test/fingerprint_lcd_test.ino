// fingerprint_lcd_test.ino - DY50 fingerprint sensor + ACM1602K 16x2 LCD together on an ESP32
// Behaves like a mini terminal: LCD shows "Place finger", then the match result. Serial commands still work.
// Serial Monitor: 115200 baud, line ending "Newline". Commands:
//   i        sensor info          a  toggle auto-scan (ON at start)
//   s        scan once            e<slot>  enrol, e.g. e1
//   d<slot>  delete one slot      x  delete ALL slots (asks YES)
// Wiring: fingerprint VCC->VIN, GND->GND, TX(green)->GPIO16, RX(white)->GPIO17
//         LCD RS->23, E->19, D4->18, D5->4, D6->32, D7->13, R/W->GND, Vo->10k pot wiper

#include <Adafruit_Fingerprint.h>  // DY50 / FPM10A / R307 driver (Library Manager: "Adafruit Fingerprint Sensor Library")
#include <LiquidCrystal.h>  // built-in HD44780 LCD library

const int FP_RX_PIN = 16;  // ESP32 UART2 RX <- sensor TX (green)
const int FP_TX_PIN = 17;  // ESP32 UART2 TX -> sensor RX (white)
const uint32_t FP_BAUD = 57600;  // sensor default baud rate
const uint16_t FINGER_TIMEOUT_MS = 10000;  // max wait for a finger during prompts
const unsigned long RESULT_SHOW_MS = 2000;  // how long a result stays on the LCD

const int LCD_RS = 23;  // LCD pin 4
const int LCD_E  = 19;  // LCD pin 6
const int LCD_D4 = 18;  // LCD pin 11
const int LCD_D5 = 4;   // LCD pin 12
const int LCD_D6 = 32;  // LCD pin 13
const int LCD_D7 = 13;  // LCD pin 14

HardwareSerial fingerSerial(2);  // ESP32 hardware UART 2 for the sensor
Adafruit_Fingerprint finger(&fingerSerial);  // sensor object on UART2
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);  // LCD in 4-bit write-only mode

bool autoScan = true;  // start in terminal mode: keep scanning automatically

const int LCD_COLS = 16;  // characters visible per line (hardware limit of a 16x2 display)
const unsigned long SCROLL_STEP_MS = 350;  // time between one-character scroll steps (lower = faster)
const unsigned long SCROLL_START_DELAY_MS = 1000;  // pause before a long line starts scrolling, so the start can be read
const char *SCROLL_GAP = "    ";  // spaces shown between the end of a message and its repeat
String lcdLine[2];  // full text of each line (may be longer than 16 characters)
int lcdOffset[2] = {0, 0};  // current scroll position of each line
unsigned long lcdNextScroll = 0;  // millis() time of the next scroll step

void lcdDrawLine(int row) {  // draw the visible 16-character window of one line
  String text = lcdLine[row];  // full message for this row
  String window = "";  // the 16 characters we will actually print
  if ((int)text.length() <= LCD_COLS) {  // short message: fits, no scrolling
    window = text;  // show it as is
  } else {  // long message: show a moving window over "text + gap", wrapping round
    String loopText = text + SCROLL_GAP;  // add the gap so the end and the repeat don't touch
    for (int i = 0; i < LCD_COLS; i++) window += loopText.charAt((lcdOffset[row] + i) % loopText.length());  // pick 16 chars starting at the offset
  }
  while ((int)window.length() < LCD_COLS) window += ' ';  // pad with spaces so old characters are overwritten
  lcd.setCursor(0, row);  // start of the row
  lcd.print(window);  // print exactly 16 characters
}

void lcdShow(const String &line1, const String &line2) {  // set two lines; long ones will scroll automatically
  lcdLine[0] = line1;  // remember the full top line
  lcdLine[1] = line2;  // remember the full bottom line
  lcdOffset[0] = 0;  // start both lines at the beginning
  lcdOffset[1] = 0;  // start both lines at the beginning
  lcdNextScroll = millis() + SCROLL_START_DELAY_MS;  // wait a moment before scrolling starts
  lcd.clear();  // wipe the screen
  lcdDrawLine(0);  // draw the top line
  lcdDrawLine(1);  // draw the bottom line
}

void lcdTick() {  // call often: moves long lines one step when it's time
  if ((long)(millis() - lcdNextScroll) < 0) return;  // not time yet (this form is safe when millis() wraps around)
  lcdNextScroll = millis() + SCROLL_STEP_MS;  // schedule the next step
  for (int row = 0; row < 2; row++) {  // both lines
    int len = lcdLine[row].length();  // message length
    if (len <= LCD_COLS) continue;  // short lines never scroll
    lcdOffset[row] = (lcdOffset[row] + 1) % (len + strlen(SCROLL_GAP));  // advance one character, wrapping round
    lcdDrawLine(row);  // redraw just this line
  }
}

void lcdWait(unsigned long minMs) {  // like delay(), but keeps scrolling and waits long enough to read a long message once
  int longest = max(lcdLine[0].length(), lcdLine[1].length());  // longest line on screen
  unsigned long readMs = SCROLL_START_DELAY_MS;  // time needed to read everything once
  if (longest > LCD_COLS) readMs += (unsigned long)(longest - LCD_COLS + 2) * SCROLL_STEP_MS;  // time to scroll until the end is visible
  unsigned long waitMs = max(minMs, readMs);  // never shorter than requested
  unsigned long start = millis();  // when we started waiting
  while (millis() - start < waitMs) {  // until the time is up
    lcdTick();  // keep scrolling
    delay(20);  // small pause
  }
}

void showIdle() {  // the "waiting for a student" screen
  if (autoScan) lcdShow("Ready", "Place your finger on the sensor");  // terminal mode
  else lcdShow("Ready (manual mode)", "Type s in the Serial Monitor to scan");  // auto-scan off
}

void printHelp() {  // list the commands on the serial monitor
  Serial.println("Commands: i=info  s=scan  a=auto-scan on/off  e<slot>=enrol  d<slot>=delete  x=delete all");  // one-line help
}

bool waitForFinger(uint16_t timeoutMs) {  // wait until a finger image is captured, or time out
  unsigned long start = millis();  // when we started waiting
  while (millis() - start < timeoutMs) {  // keep trying until the timeout
    uint8_t r = finger.getImage();  // ask the sensor for a picture
    if (r == FINGERPRINT_OK) return true;  // got one
    lcdTick();  // keep long LCD messages scrolling while we wait
    delay(50);  // short pause between attempts
  }
  return false;  // nobody placed a finger
}

void waitForRemoval() {  // wait until the finger is lifted
  while (finger.getImage() != FINGERPRINT_NOFINGER) { lcdTick(); delay(50); }  // keep checking until the glass is empty (and keep scrolling)
}

void showInfo() {  // print sensor parameters (serial + LCD)
  finger.getParameters();  // read capacity, security level, etc.
  finger.getTemplateCount();  // count stored fingerprints
  Serial.print("Capacity: "); Serial.println(finger.capacity);  // max templates
  Serial.print("Security level: "); Serial.println(finger.security_level);  // design targets level 3
  Serial.print("Stored templates: "); Serial.println(finger.templateCount);  // slots in use
  lcdShow("Stored: " + String(finger.templateCount) + "/" + String(finger.capacity), "Security lvl " + String(finger.security_level));  // same info on the LCD
  lcdWait(RESULT_SHOW_MS);  // let it be read
  showIdle();  // back to the idle screen
}

bool scanOnce(uint16_t timeoutMs, bool quiet) {  // capture a finger and search all templates (1:N)
  if (!quiet) { Serial.println("Place finger on the sensor..."); lcdShow("Scanning...", "Place your finger on the sensor"); }  // prompt (manual scans only)
  if (!waitForFinger(timeoutMs)) {  // nothing placed in time
    if (!quiet) { Serial.println("  no finger detected"); showIdle(); }  // tell the user
    return false;  // give up
  }
  lcdShow("Reading...", "Hold still");  // finger detected
  if (finger.image2Tz(1) != FINGERPRINT_OK) {  // convert image to features
    Serial.println("  unclear image, try again");  // usual cause: dry/dirty finger or light touch
    lcdShow("Unclear print", "Press firmly with a clean, dry finger and try again");  // feedback
    waitForRemoval();  // wait for lift
    lcdWait(RESULT_SHOW_MS);  // show the message
    showIdle();  // back to idle
    return false;  // no result
  }
  uint8_t r = finger.fingerSearch();  // compare against every stored template
  if (r == FINGERPRINT_OK) {  // matched
    Serial.print("  MATCH  slot="); Serial.print(finger.fingerID);  // which slot (backend maps slot -> student)
    Serial.print("  confidence="); Serial.println(finger.confidence);  // match score 0-255
    lcdShow("Match! Slot " + String(finger.fingerID), "Confidence score: " + String(finger.confidence));  // result on the LCD
  } else if (r == FINGERPRINT_NOTFOUND) {  // valid print, not enrolled
    Serial.println("  NO MATCH (finger not enrolled)");  // serial feedback
    lcdShow("Not recognised", "Please see your lecturer for manual sign-in");  // the real terminal will offer the fallback here
  } else {  // communication problem
    Serial.println("  search error (check wiring)");  // usually a loose wire
    lcdShow("Sensor error", "Check the fingerprint sensor wiring");  // feedback
  }
  waitForRemoval();  // don't scan the same touch twice
  lcdWait(RESULT_SHOW_MS);  // keep the result visible
  showIdle();  // back to idle
  return r == FINGERPRINT_OK;  // true only on a match
}

bool enrol(uint16_t slot) {  // capture the same finger twice and store it in a slot
  Serial.print("Enrolling into slot "); Serial.println(slot);  // confirm the slot
  lcdShow("Enrol slot " + String(slot), "Place finger");  // first prompt
  if (!waitForFinger(FINGER_TIMEOUT_MS)) { Serial.println("  timed out"); lcdShow("Enrol failed", "Timed out"); lcdWait(RESULT_SHOW_MS); showIdle(); return false; }  // no finger
  if (finger.image2Tz(1) != FINGERPRINT_OK) { Serial.println("  unclear image"); lcdShow("Enrol failed", "Unclear print"); lcdWait(RESULT_SHOW_MS); showIdle(); return false; }  // bad first image
  Serial.println("  OK. Remove finger.");  // ask to lift
  lcdShow("OK", "Remove finger");  // LCD prompt
  lcdWait(500);  // give the user time to react
  waitForRemoval();  // wait until lifted
  Serial.println("Place the SAME finger again...");  // second capture
  lcdShow("Same finger", "again please");  // LCD prompt
  if (!waitForFinger(FINGER_TIMEOUT_MS)) { Serial.println("  timed out"); lcdShow("Enrol failed", "Timed out"); lcdWait(RESULT_SHOW_MS); showIdle(); return false; }  // no finger
  if (finger.image2Tz(2) != FINGERPRINT_OK) { Serial.println("  unclear image"); lcdShow("Enrol failed", "Unclear print"); lcdWait(RESULT_SHOW_MS); showIdle(); return false; }  // bad second image
  uint8_t r = finger.createModel();  // merge the two captures into one template
  if (r != FINGERPRINT_OK) { Serial.println("  captures didn't match"); lcdShow("Enrol failed", "Prints differ"); waitForRemoval(); lcdWait(RESULT_SHOW_MS); showIdle(); return false; }  // different finger / bad placement
  r = finger.storeModel(slot);  // save the template in the sensor's flash
  if (r != FINGERPRINT_OK) { Serial.println("  could not store (slot out of range?)"); lcdShow("Enrol failed", "Store error"); lcdWait(RESULT_SHOW_MS); showIdle(); return false; }  // e.g. slot > capacity
  Serial.println("  STORED. Enrolment complete.");  // success
  lcdShow("Enrolled!", "Slot " + String(slot));  // success on the LCD
  waitForRemoval();  // tidy up
  lcdWait(RESULT_SHOW_MS);  // show the result
  showIdle();  // back to idle
  return true;  // done
}

void setup() {  // runs once at power-up
  Serial.begin(115200);  // USB serial monitor
  lcd.begin(16, 2);  // 16 columns x 2 rows
  lcdShow("Biometric Attendance", "Starting...");  // boot screen
  fingerSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);  // UART2 on our pins
  delay(500);  // let the sensor power up
  if (finger.verifyPassword()) {  // handshake with the default password
    Serial.println("DY50 found.");  // serial confirmation
    lcdShow("Sensor OK", "DY50 found");  // LCD confirmation
  } else {  // no reply
    Serial.println("DY50 NOT found. Check VIN/GND, green->GPIO16, white->GPIO17 (try swapping).");  // common fixes
    lcdShow("Sensor NOT found", "Check wiring: green to GPIO16, white to GPIO17");  // LCD error
    while (true) lcdWait(1000);  // stop here until reset (message keeps scrolling)
  }
  lcdWait(1000);  // show the OK message
  showInfo();  // capacity + stored templates (also goes back to idle)
  printHelp();  // command list
}

void loop() {  // runs forever
  if (Serial.available()) {  // a command was typed
    String line = Serial.readStringUntil('\n');  // read the line
    line.trim();  // strip spaces and \r
    if (line.length() == 0) return;  // ignore empty lines
    char cmd = line.charAt(0);  // first character = command
    int arg = line.substring(1).toInt();  // rest = slot number (0 if none)
    if (cmd == 'i') showInfo();  // info
    else if (cmd == 's') scanOnce(FINGER_TIMEOUT_MS, false);  // single scan
    else if (cmd == 'a') { autoScan = !autoScan; Serial.println(autoScan ? "Auto-scan ON" : "Auto-scan OFF"); showIdle(); }  // toggle auto mode
    else if (cmd == 'e' && arg >= 1) enrol(arg);  // enrol into slot
    else if (cmd == 'd' && arg >= 1) {  // delete one slot
      bool ok = finger.deleteModel(arg) == FINGERPRINT_OK;  // ask the sensor to delete it
      Serial.println(ok ? "Deleted." : "Delete failed.");  // serial result
      lcdShow(ok ? "Deleted" : "Delete failed", "Slot " + String(arg));  // LCD result
      lcdWait(RESULT_SHOW_MS);  // show it
      showIdle();  // back to idle
    }
    else if (cmd == 'x') {  // wipe everything
      Serial.println("Type YES to delete all templates:");  // safety prompt
      lcdShow("Delete ALL?", "Confirm in PC");  // LCD hint
      while (!Serial.available()) { lcdTick(); delay(10); }  // wait for the answer (keep scrolling)
      String confirm = Serial.readStringUntil('\n'); confirm.trim();  // read it
      bool ok = confirm == "YES" && finger.emptyDatabase() == FINGERPRINT_OK;  // only on exact YES
      Serial.println(ok ? "All templates deleted." : "Cancelled.");  // serial result
      lcdShow(ok ? "All deleted" : "Cancelled", "");  // LCD result
      lcdWait(RESULT_SHOW_MS);  // show it
      showIdle();  // back to idle
    }
    else printHelp();  // unknown command
  }
  lcdTick();  // keep long idle messages scrolling
  if (autoScan) scanOnce(200, true);  // terminal mode: look for a finger briefly each loop
}
