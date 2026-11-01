// terminal.ino - BSAVS main terminal firmware (ESP32-WROOM-32 + DY50 fingerprint + 16x2 LCD + LEDs + buzzer)
// What it does:
//   1. Joins Wi-Fi, sets its clock from the internet (NTP), and talks to the BSAVS server over HTTPS.
//   2. Signs every request with HMAC-SHA256 using the device secret (the server rejects anything unsigned).
//   3. Asks the server which session is open, then sends every fingerprint match as an attendance event.
//   4. Polls the server for jobs from the admin dashboard: "enrol a finger into slot N" and "delete slot N".
//   5. If Wi-Fi or the server is down, saves scans in flash (LittleFS) and sends them later (offline queue).
// Libraries (Arduino IDE > Library Manager): "Adafruit Fingerprint Sensor Library", "ArduinoJson" (by Benoit Blanchon).
// Board: "ESP32 Dev Module". Works with ESP32 board package 2.0.17 and 3.x. Serial Monitor: 115200, "Newline".
// Before uploading: copy secrets.example.h to secrets.h (same folder) and fill it in. Never commit secrets.h.
// Serial commands (for the technician): i = sensor info, s = status, q = show queue size, x = wipe ALL fingerprints (asks YES)

#include <WiFi.h>                 // Wi-Fi station mode
#include <WiFiClientSecure.h>     // TLS (HTTPS) socket
#include <HTTPClient.h>           // simple HTTP requests on top of the TLS socket
#include <ArduinoJson.h>          // read the server's JSON replies
#include <Adafruit_Fingerprint.h> // DY50 / R307 / FPM10A driver
#include <LiquidCrystal.h>        // 16x2 LCD (HD44780) in 4-bit mode
#include <LittleFS.h>             // small file system in flash, for the offline queue
#include <time.h>                 // NTP clock and time formatting
#include "mbedtls/md.h"           // HMAC-SHA256 (built into the ESP32 core)
#include "secrets.h"              // WIFI_SSID, WIFI_PASS, API_HOST, DEVICE_ID, DEVICE_SECRET (not in Git)

// ---------------- pins (same as the wiring page / veroboard) ----------------
const int FP_RX_PIN = 16;         // ESP32 RX2 <- DY50 TX (green)
const int FP_TX_PIN = 17;         // ESP32 TX2 -> DY50 RX (white)
const int LCD_RS = 23, LCD_E = 19, LCD_D4 = 18, LCD_D5 = 4, LCD_D6 = 32, LCD_D7 = 13;  // LCD pins 4, 6, 11-14
const int LED_GREEN = 25;         // green LED through 220 ohm
const int LED_YELLOW = 26;        // yellow LED through 220 ohm
const int LED_RED = 27;           // red LED through 220 ohm
const int BUZZER_PIN = 33;        // buzzer (through 100 ohm, or through the NPN transistor)
#define BUZZER_IS_PASSIVE 0       // 0 = active buzzer (beeps on its own from DC). 1 = passive buzzer (needs a tone)

// ---------------- timing ----------------
const uint32_t FP_BAUD = 57600;               // DY50 default speed
const unsigned long SESSION_POLL_MS = 15000;  // ask "which session is open?" every 15 s
const unsigned long COMMAND_POLL_MS = 5000;   // ask "any enrol/delete jobs?" every 5 s
const unsigned long QUEUE_FLUSH_MS = 20000;   // try to send saved offline scans every 20 s
const unsigned long WIFI_RETRY_MS = 10000;    // reconnect attempt interval when Wi-Fi drops
const unsigned long RESULT_SHOW_MS = 2500;    // how long a result stays on the screen
const uint16_t FINGER_TIMEOUT_MS = 15000;     // max wait for a finger during enrolment
const uint16_t HTTP_TIMEOUT_MS = 60000;       // the free server can take up to ~1 min to wake up
const int QUEUE_MAX = 500;                    // design requirement: at least 500 offline events
const char *QUEUE_FILE = "/queue.txt";        // one JSON attendance event per line
const char *QUEUE_TMP = "/queue.tmp";         // used while rewriting the queue

// ---------------- hardware objects ----------------
HardwareSerial fingerSerial(2);                                  // UART2 for the sensor
Adafruit_Fingerprint finger(&fingerSerial);                      // sensor driver
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7); // LCD driver
WiFiClientSecure tls;                                            // one TLS connection, reused between requests
HTTPClient http;                                                 // one HTTP client, reused between requests

// ---------------- state ----------------
int sessionId = 0;                // open session for this terminal (0 = none)
String courseCode = "";           // shown on the idle screen
bool serverReachable = false;     // last request reached the server
int queueCount = 0;               // events waiting in the offline queue
unsigned long nextSessionPoll = 0, nextCommandPoll = 0, nextQueueFlush = 0, nextWifiRetry = 0;  // schedule

// ArduinoJson 6 and 7 name their document type differently; this macro works with both
#if ARDUINOJSON_VERSION_MAJOR >= 7
#define JSON_DOC(name) JsonDocument name
#else
#define JSON_DOC(name) DynamicJsonDocument name(1024)
#endif

// =====================================================================
// LCD with scrolling (same behaviour as fingerprint_lcd_test)
// =====================================================================
const int LCD_COLS = 16;                      // characters per line
const unsigned long SCROLL_STEP_MS = 350;     // scroll speed
const unsigned long SCROLL_START_DELAY_MS = 1000;  // pause before a long line starts moving
const char *SCROLL_GAP = "    ";              // gap between the end of a message and its repeat
String lcdLine[2];                            // full text of each line
int lcdOffset[2] = {0, 0};                    // scroll position of each line
unsigned long lcdNextScroll = 0;              // when to scroll next

void lcdDrawLine(int row) {  // prints the visible 16 characters of one line
  String text = lcdLine[row], window = "";   // full text and the part we print
  if ((int)text.length() <= LCD_COLS) window = text;  // short: print as is
  else {                                      // long: moving window over text + gap
    String loopText = text + SCROLL_GAP;      // add the gap
    for (int i = 0; i < LCD_COLS; i++) window += loopText.charAt((lcdOffset[row] + i) % loopText.length());  // 16 chars from the offset
  }
  while ((int)window.length() < LCD_COLS) window += ' ';  // pad to overwrite old text
  lcd.setCursor(0, row);                      // start of the row
  lcd.print(window);                          // print it
}

void lcdShow(const String &l1, const String &l2) {  // sets both lines (long lines scroll by themselves)
  if (l1 == lcdLine[0] && l2 == lcdLine[1]) return;  // same text already showing: don't flicker
  lcdLine[0] = l1; lcdLine[1] = l2;           // remember the text
  lcdOffset[0] = lcdOffset[1] = 0;            // start from the beginning
  lcdNextScroll = millis() + SCROLL_START_DELAY_MS;  // short pause before scrolling
  lcd.clear();                                // wipe the screen
  lcdDrawLine(0); lcdDrawLine(1);             // draw both lines
}

void lcdTick() {  // call often: scrolls long lines
  if ((long)(millis() - lcdNextScroll) < 0) return;  // not yet
  lcdNextScroll = millis() + SCROLL_STEP_MS;  // schedule the next step
  for (int row = 0; row < 2; row++) {         // both rows
    int len = lcdLine[row].length();          // message length
    if (len <= LCD_COLS) continue;            // short lines don't scroll
    lcdOffset[row] = (lcdOffset[row] + 1) % (len + strlen(SCROLL_GAP));  // one step, wrapping
    lcdDrawLine(row);                         // redraw
  }
}

void lcdWait(unsigned long ms) {  // like delay(), but keeps the LCD scrolling
  unsigned long start = millis();             // start time
  while (millis() - start < ms) { lcdTick(); delay(20); }  // wait
}

// =====================================================================
// LEDs and buzzer
// =====================================================================
void setLed(char c) {  // 'g' green, 'y' yellow, 'r' red, anything else = all off
  digitalWrite(LED_GREEN, c == 'g' ? HIGH : LOW);   // green
  digitalWrite(LED_YELLOW, c == 'y' ? HIGH : LOW);  // yellow
  digitalWrite(LED_RED, c == 'r' ? HIGH : LOW);     // red
}

void beep(int count, int onMs) {  // count beeps of onMs each, 120 ms apart
  for (int i = 0; i < count; i++) {           // each beep
#if BUZZER_IS_PASSIVE
    tone(BUZZER_PIN, 2700, onMs);             // passive buzzer: play a 2.7 kHz tone
    delay(onMs);                              // wait while it plays
#else
    digitalWrite(BUZZER_PIN, HIGH);           // active buzzer: on
    delay(onMs);                              // beep length
    digitalWrite(BUZZER_PIN, LOW);            // off
#endif
    if (i < count - 1) delay(120);            // gap between beeps
  }
}

void feedback(char led, int beeps, int beepMs, const String &l1, const String &l2) {  // one call = LCD + LED + sound
  lcdShow(l1, l2);                            // message
  setLed(led);                                // light
  if (beeps > 0) beep(beeps, beepMs);         // sound
}

// =====================================================================
// time, random strings, HMAC
// =====================================================================
bool clockValid() { return time(nullptr) > 1700000000; }  // true once NTP has set the clock (after Nov 2023)

String isoUtcNow() {  // current time as 2026-11-03T09:07:12Z (the server needs the timezone)
  time_t now = time(nullptr);                 // seconds since 1970
  struct tm t; gmtime_r(&now, &t);            // split into date/time (UTC)
  char buf[24]; strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);  // format
  return String(buf);                         // done
}

String randomHex(int bytes) {  // hardware random number as hex (bytes*2 characters)
  String s = "";                              // result
  for (int i = 0; i < bytes; i++) {           // each byte
    uint8_t b = esp_random() & 0xFF;          // true random byte from the ESP32 radio
    if (b < 16) s += '0';                     // leading zero
    s += String(b, HEX);                      // two hex digits
  }
  return s;                                   // e.g. 32 characters for 16 bytes
}

String hmacSha256Hex(const String &message) {  // HMAC-SHA256(DEVICE_SECRET, message) as lowercase hex
  uint8_t out[32];                            // 256-bit result
  mbedtls_md_context_t ctx;                   // hashing context
  mbedtls_md_init(&ctx);                      // prepare it
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);  // SHA-256 in HMAC mode
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)DEVICE_SECRET, strlen(DEVICE_SECRET));  // the secret key
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)message.c_str(), message.length());     // the message
  mbedtls_md_hmac_finish(&ctx, out);          // compute
  mbedtls_md_free(&ctx);                      // clean up
  String hex = "";                            // convert to hex text
  for (int i = 0; i < 32; i++) { if (out[i] < 16) hex += '0'; hex += String(out[i], HEX); }  // 64 characters
  return hex;                                 // signature
}

// =====================================================================
// signed request to the server
// =====================================================================
struct ApiResult { int code; String body; };  // HTTP status (negative = never reached the server) + reply text

ApiResult api(const char *method, const String &path, const String &body) {  // sends one signed request
  if (WiFi.status() != WL_CONNECTED) return {-1, ""};  // no Wi-Fi
  if (!clockValid()) return {-2, ""};          // can't sign without the right time (server allows 5 min drift)
  String ts = String((long)time(nullptr));     // X-Timestamp: Unix seconds
  String nonce = randomHex(16);                // X-Nonce: 32 random hex characters, never reused
  String toSign = String(method) + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + body;  // exactly what the server rebuilds
  String sig = hmacSha256Hex(toSign);          // X-Signature
  http.begin(tls, String("https://") + API_HOST + path);  // URL (reuses the open TLS connection when possible)
  http.setTimeout(HTTP_TIMEOUT_MS);            // wait for slow (waking) server
  http.addHeader("X-Device-Id", String(DEVICE_ID));  // which terminal
  http.addHeader("X-Timestamp", ts);           // when signed
  http.addHeader("X-Nonce", nonce);            // single-use random
  http.addHeader("X-Signature", sig);          // proof we know the secret
  int code;                                    // HTTP status
  if (strcmp(method, "GET") == 0) code = http.GET();  // GET has no body
  else { http.addHeader("Content-Type", "application/json"); code = http.POST(body); }  // POST with JSON body
  String reply = code > 0 ? http.getString() : "";  // reply text (empty on failure)
  http.end();                                  // finish (connection stays open for reuse)
  serverReachable = code > 0 && code < 500;    // 5xx / no answer = server not usable right now
  Serial.printf("%s %s -> %d %s\n", method, path.c_str(), code, reply.substring(0, 120).c_str());  // log for debugging
  return {code, reply};                        // result
}

String jsonString(const String &body, const char *key) {  // reads one text field from a JSON reply ("" if missing)
  JSON_DOC(doc);                               // JSON document
  if (deserializeJson(doc, body)) return "";   // not JSON
  return doc[key] | "";                        // the field, or ""
}

// =====================================================================
// session
// =====================================================================
void pollSession() {  // asks the server which session is open on this terminal
  ApiResult r = api("GET", "/device/session", "");  // signed GET
  if (r.code == 200) {                         // a session is open
    JSON_DOC(doc);                             // parse
    if (!deserializeJson(doc, r.body)) {       // valid JSON
      sessionId = doc["session_id"] | 0;       // remember the session
      courseCode = String((const char *)(doc["course_code"] | ""));  // for the screen
    }
  } else if (r.code == 404) {                  // no open session
    sessionId = 0; courseCode = "";            // forget the old one
  } else if (r.code == 401) {                  // signature rejected
    Serial.println("AUTH ERROR: check DEVICE_ID / DEVICE_SECRET in secrets.h, and that the clock is synced");  // hint
  }                                            // other errors: keep the last known session (offline mode)
}

void showIdle() {  // the waiting screen
  setLed(queueCount > 0 && !serverReachable ? 'y' : 0);  // yellow = scans waiting to be sent
  if (WiFi.status() != WL_CONNECTED) lcdShow("Offline", queueCount ? String(queueCount) + " scan(s) saved, will sync" : "No Wi-Fi - scans are saved");  // no Wi-Fi
  else if (sessionId == 0) lcdShow("No session", "Ask your lecturer to open a session");  // nothing to record into
  else lcdShow("Ready " + courseCode, "Place finger");  // normal
}

// =====================================================================
// offline queue (LittleFS)
// =====================================================================
int countQueue() {  // counts lines in the queue file
  File f = LittleFS.open(QUEUE_FILE, "r");     // open for reading
  if (!f) return 0;                            // no file = empty
  int n = 0;                                   // line counter
  while (f.available()) { String line = f.readStringUntil('\n'); if (line.length() > 2) n++; }  // count real lines
  f.close();                                   // done
  return n;                                    // total
}

bool queueAdd(const String &eventJson) {  // saves one scan for later
  if (queueCount >= QUEUE_MAX) return false;   // full (very unlikely: 500+ scans offline)
  File f = LittleFS.open(QUEUE_FILE, "a");     // append mode
  if (!f) return false;                        // flash problem
  f.println(eventJson);                        // one event per line
  f.close();                                   // flush to flash
  queueCount++;                                // update counter
  return true;                                 // saved
}

void flushQueue() {  // tries to send saved scans; keeps the ones that couldn't be sent
  if (queueCount == 0 || WiFi.status() != WL_CONNECTED || !clockValid()) return;  // nothing to do / can't send
  File in = LittleFS.open(QUEUE_FILE, "r");    // saved events
  if (!in) { queueCount = 0; return; }         // file gone
  File out = LittleFS.open(QUEUE_TMP, "w");    // events we still have to keep
  bool stop = false;                           // set when the server stops answering
  int kept = 0, sent = 0;                      // counters
  while (in.available()) {                     // each saved event
    String line = in.readStringUntil('\n'); line.trim();  // one JSON body
    if (line.length() < 3) continue;           // skip empty lines
    if (!stop) {                               // still online
      lcdShow("Syncing...", String(sent + 1) + " of " + String(queueCount));  // progress
      ApiResult r = api("POST", "/device/attendance", line);  // same body, fresh signature (idempotency key prevents doubles)
      if (r.code == 200 || r.code == 404 || r.code == 409 || r.code == 422) { sent++; continue; }  // final answer: drop it (lecturer resolves conflicts)
      stop = true;                             // no answer / auth problem: keep this one and the rest
    }
    out.println(line); kept++;                 // keep for next time
  }
  in.close(); out.close();                     // close both
  LittleFS.remove(QUEUE_FILE);                 // replace the old queue...
  LittleFS.rename(QUEUE_TMP, QUEUE_FILE);      // ...with what is left
  queueCount = kept;                           // update counter
  if (sent > 0) { feedback(kept ? 'y' : 'g', 1, 80, "Synced " + String(sent), kept ? String(kept) + " still waiting" : "All scans sent"); lcdWait(1500); }  // tell the room
  showIdle();                                  // back to waiting
}

// =====================================================================
// fingerprint helpers
// =====================================================================
bool waitForFinger(uint16_t timeoutMs) {  // waits for a finger image or times out
  unsigned long start = millis();              // start
  while (millis() - start < timeoutMs) {       // until timeout
    if (finger.getImage() == FINGERPRINT_OK) return true;  // got an image
    lcdTick(); delay(50);                      // keep scrolling, short pause
  }
  return false;                                // no finger
}

void waitForRemoval() {  // waits until the finger is lifted
  unsigned long start = millis();              // start
  while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - start < 8000) { lcdTick(); delay(50); }  // max 8 s
}

String firstName(const String &full) {  // "Lesiba Lucky Manala" -> "Lesiba"
  int sp = full.indexOf(' ');                  // first space
  return sp > 0 ? full.substring(0, sp) : full;  // first word
}

// =====================================================================
// one attendance scan
// =====================================================================
void handleScan() {  // called when a finger touches the sensor
  setLed('y');                                 // busy
  lcdShow("Scanning...", "Hold still");        // tell the student
  if (finger.image2Tz(1) != FINGERPRINT_OK) {  // image -> features
    feedback('r', 1, 400, "Unclear print", "Press firmly with a clean, dry finger");  // bad image
    waitForRemoval(); lcdWait(RESULT_SHOW_MS); showIdle(); return;  // try again
  }
  uint8_t r = finger.fingerSearch();           // 1:N search on the sensor
  if (r == FINGERPRINT_NOTFOUND) {             // not enrolled
    feedback('r', 1, 600, "Not recognised", "Try again or see your lecturer");  // tell the student
    waitForRemoval(); lcdWait(RESULT_SHOW_MS); showIdle(); return;  // done
  }
  if (r != FINGERPRINT_OK) {                   // talk error with the sensor
    feedback('r', 1, 600, "Sensor error", "Check fingerprint sensor wiring");  // hint
    waitForRemoval(); lcdWait(RESULT_SHOW_MS); showIdle(); return;  // done
  }
  int slot = finger.fingerID, conf = finger.confidence;  // who (slot) and how sure (score)
  Serial.printf("Match: slot %d, confidence %d\n", slot, conf);  // log
  if (sessionId == 0) {                        // nothing to record into
    feedback('r', 2, 90, "No session open", "Ask your lecturer");  // tell the student
    waitForRemoval(); lcdWait(RESULT_SHOW_MS); showIdle(); return;  // done
  }
  String body = "{\"idempotency_key\":\"" + randomHex(16) + "\",\"session_id\":" + String(sessionId) +  // made ONCE per scan
                ",\"slot_number\":" + String(slot) + ",\"confidence\":" + String(conf) +  // match details
                (clockValid() ? String(",\"device_time\":\"") + isoUtcNow() + "\"" : String("")) + "}";  // scan time (UTC)
  lcdShow("Checking...", "Please wait");       // talking to the server
  ApiResult res = api("POST", "/device/attendance", body);  // send it
  if (res.code == 200) {                       // server decided
    String status = jsonString(res.body, "status");  // recorded / duplicate / low_confidence / not_in_course
    String name = firstName(jsonString(res.body, "full_name"));  // for the greeting
    if (status == "recorded") feedback('g', 1, 140, "Welcome " + name, "Recorded");  // success
    else if (status == "duplicate") feedback('r', 2, 90, "Already recorded", name);  // already present
    else if (status == "not_in_course") feedback('r', 1, 650, "Not on class list", "See your lecturer");  // wrong course
    else if (status == "low_confidence") feedback('r', 1, 650, "Not sure it's you", "See your lecturer");  // weak match (face check comes later with the camera ESP)
    else feedback('r', 1, 650, "Unexpected reply", status);  // safety net
  } else if (res.code == 409) {                // session closed while scanning
    sessionId = 0; feedback('r', 2, 90, "Session closed", "Ask your lecturer");  // tell the student
  } else if (res.code == 404) {                // unknown slot or session
    String detail = jsonString(res.body, "detail");  // which one
    if (detail == "unknown_slot") feedback('r', 1, 650, "Not registered", "Ask admin to enrol you again");  // sensor has a finger the server doesn't know
    else { sessionId = 0; feedback('r', 2, 90, "Session ended", "Ask your lecturer"); }  // session gone
  } else if (res.code == 401) {                // our signature was rejected: don't queue (it would fail again)
    feedback('r', 1, 650, "Terminal error", "Device not authorised - call admin");  // tell the room
  } else {                                     // no answer / server error: save for later
    if (queueAdd(body)) feedback('y', 1, 140, "Saved offline", "Will sync when online");  // design rule: only say saved when it really is
    else feedback('r', 1, 650, "Not saved", "See your lecturer");  // queue full or flash error
  }
  waitForRemoval();                            // one touch = one scan
  lcdWait(RESULT_SHOW_MS);                     // keep the result visible
  showIdle();                                  // back to waiting
}

// =====================================================================
// enrol / delete jobs from the dashboard
// =====================================================================
String enrolFinger(int slot, const String &name) {  // returns "" on success, or an error text for the dashboard
  String who = firstName(name);                // short name for the LCD
  setLed('y');                                 // busy
  feedback('y', 1, 60, "Enrol " + who, "Place finger");  // first touch
  if (!waitForFinger(FINGER_TIMEOUT_MS)) return "timeout_first_finger";  // nobody came
  if (finger.image2Tz(1) != FINGERPRINT_OK) return "unclear_first_image";  // bad image
  lcdShow("OK", "Remove finger");              // lift
  waitForRemoval(); lcdWait(500);              // wait for lift
  feedback('y', 1, 60, "Place same", "finger again");  // second touch
  if (!waitForFinger(FINGER_TIMEOUT_MS)) return "timeout_second_finger";  // nobody came
  if (finger.image2Tz(2) != FINGERPRINT_OK) return "unclear_second_image";  // bad image
  if (finger.createModel() != FINGERPRINT_OK) return "prints_did_not_match";  // two different fingers / bad placement
  if (finger.storeModel(slot) != FINGERPRINT_OK) return "store_failed";  // slot out of range or flash error
  waitForRemoval();                            // tidy up
  return "";                                   // success
}

void reportResult(int commandId, bool success, const String &detail) {  // tells the server how a job went
  String body = String("{\"success\":") + (success ? "true" : "false") + (detail.length() ? String(",\"detail\":\"") + detail + "\"" : String("")) + "}";  // JSON
  for (int attempt = 0; attempt < 3; attempt++) {  // try a few times
    ApiResult r = api("POST", "/device/commands/" + String(commandId) + "/result", body);  // signed POST
    if (r.code > 0 && r.code < 500) return;    // server answered (even "already cancelled" is final)
    delay(2000);                               // wait and retry
  }
}

void pollCommands() {  // asks for the next enrol / delete job
  ApiResult r = api("GET", "/device/commands/next", "");  // signed GET
  if (r.code != 200) return;                   // 204 = nothing to do; anything else = try later
  JSON_DOC(doc);                               // parse the job
  if (deserializeJson(doc, r.body)) return;    // not JSON
  int id = doc["command_id"] | 0;              // job id
  String type = String((const char *)(doc["type"] | ""));  // enrol / delete_slot
  int slot = doc["slot_number"] | 0;           // sensor slot
  String name = String((const char *)(doc["full_name"] | ""));  // student name (enrol only)
  if (id == 0 || slot == 0) return;            // incomplete job
  if (type == "enrol") {                       // admin asked us to register a finger
    String err = enrolFinger(slot, name);      // guide the student
    if (err == "") feedback('g', 1, 140, "Enrolled!", firstName(name) + " - slot " + String(slot));  // success
    else feedback('r', 1, 650, "Enrol failed", err);  // failure (dashboard shows Try again)
    reportResult(id, err == "", err);          // tell the server
  } else if (type == "delete_slot") {          // consent withdrawn / student removed: wipe the template
    uint8_t res = finger.deleteModel(slot);    // delete on the sensor
    bool ok = res == FINGERPRINT_OK;           // success?
    Serial.printf("Delete slot %d -> %s\n", slot, ok ? "ok" : "failed");  // log
    reportResult(id, ok, ok ? "" : "sensor_delete_error");  // tell the server
    return;                                    // no screen change for wipes
  }
  lcdWait(RESULT_SHOW_MS);                     // show the enrol result
  showIdle();                                  // back to waiting
}

// =====================================================================
// Wi-Fi + clock
// =====================================================================
void connectWifi(unsigned long maxWaitMs) {  // starts Wi-Fi and waits up to maxWaitMs
  WiFi.mode(WIFI_STA);                         // join a network
  WiFi.begin(WIFI_SSID, WIFI_PASS);            // credentials from secrets.h
  unsigned long start = millis();              // start
  while (WiFi.status() != WL_CONNECTED && millis() - start < maxWaitMs) { lcdTick(); delay(250); }  // wait
}

void syncClock() {  // sets the clock from the internet (UTC)
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // NTP servers
  unsigned long start = millis();              // start
  while (!clockValid() && millis() - start < 15000) { lcdTick(); delay(250); }  // wait up to 15 s
  Serial.println(clockValid() ? "Clock synced: " + isoUtcNow() : String("Clock NOT synced yet"));  // log
}

// =====================================================================
// setup + loop
// =====================================================================
void setup() {
  Serial.begin(115200);                        // debug output
  pinMode(LED_GREEN, OUTPUT); pinMode(LED_YELLOW, OUTPUT); pinMode(LED_RED, OUTPUT); pinMode(BUZZER_PIN, OUTPUT);  // outputs
  setLed(0); digitalWrite(BUZZER_PIN, LOW);    // all off
  lcd.begin(16, 2);                            // LCD
  lcdShow("BSAVS terminal", "Starting...");    // boot screen
  setLed('g'); delay(150); setLed('y'); delay(150); setLed('r'); delay(150); setLed(0); beep(1, 60);  // quick LED + buzzer self-test

  fingerSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);  // sensor UART
  delay(300);                                  // sensor power-up
  if (!finger.verifyPassword()) {              // no reply from the sensor
    feedback('r', 3, 200, "Sensor NOT found", "Check: green to GPIO16, white to GPIO17");  // tell the technician
    while (true) lcdWait(1000);                // stop here (reset after fixing)
  }
  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed - offline queue disabled");  // true = format on first use
  queueCount = countQueue();                   // scans left from last time
  Serial.printf("Offline queue: %d event(s)\n", queueCount);  // log

  lcdShow("Connecting WiFi", WIFI_SSID);       // progress
  connectWifi(20000);                          // up to 20 s
  if (WiFi.status() == WL_CONNECTED) {         // online
    Serial.print("Wi-Fi OK, IP "); Serial.println(WiFi.localIP());  // log
    lcdShow("Setting clock", "pool.ntp.org");  // progress
    syncClock();                               // NTP
  }
  tls.setInsecure();                           // demo: don't check the server certificate (requests are still HMAC-signed). Future work: pin Render's CA.
  http.setReuse(true);                         // keep the TLS connection open between requests (much faster)
  lcdShow("Contacting server", "First start can take up to 1 min");  // the free Render server may be asleep
  pollSession();                               // which session is open?
  showIdle();                                  // ready
}

void loop() {
  lcdTick();                                   // keep long messages scrolling

  if (Serial.available()) {                    // technician commands
    String line = Serial.readStringUntil('\n'); line.trim();  // one line
    if (line == "i") { finger.getTemplateCount(); Serial.printf("Templates stored: %d\n", finger.templateCount); }  // sensor info
    else if (line == "s") Serial.printf("WiFi=%s session=%d (%s) queue=%d clock=%s\n", WiFi.status() == WL_CONNECTED ? "ok" : "down", sessionId, courseCode.c_str(), queueCount, clockValid() ? isoUtcNow().c_str() : "not set");  // status
    else if (line == "q") Serial.printf("Offline queue: %d\n", queueCount);  // queue size
    else if (line == "x") {                    // wipe the sensor (do this once before real use)
      Serial.println("Type YES to delete ALL fingerprints on the sensor:");  // confirm
      while (!Serial.available()) delay(10);   // wait for the answer
      String c = Serial.readStringUntil('\n'); c.trim();  // read it
      Serial.println(c == "YES" && finger.emptyDatabase() == FINGERPRINT_OK ? "All deleted." : "Cancelled.");  // result
    }
  }

  if (WiFi.status() != WL_CONNECTED && millis() > nextWifiRetry) {  // Wi-Fi dropped
    nextWifiRetry = millis() + WIFI_RETRY_MS;  // don't hammer it
    WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS);  // try again (non-blocking)
    showIdle();                                // show "Offline"
  }
  if (WiFi.status() == WL_CONNECTED && !clockValid()) syncClock();  // came online without a clock

  if (finger.getImage() == FINGERPRINT_OK) { handleScan(); return; }  // a finger: scanning always comes first

  unsigned long now = millis();                // current time
  if (now > nextCommandPoll) { nextCommandPoll = now + COMMAND_POLL_MS; pollCommands(); }  // enrol / delete jobs
  if (now > nextSessionPoll) { nextSessionPoll = now + SESSION_POLL_MS; int before = sessionId; pollSession(); if (sessionId != before) showIdle(); }  // session opened/closed?
  if (now > nextQueueFlush) { nextQueueFlush = now + QUEUE_FLUSH_MS; flushQueue(); }  // send saved scans
  delay(30);                                   // small pause
}
