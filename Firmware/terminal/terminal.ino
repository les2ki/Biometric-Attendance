// terminal.ino - main ESP32 (30-pin) of the Biometric Student Attendance and Verification System terminal
// Talks to the backend with HMAC-signed requests (same signing as Backend/app/security.py and scripts/fake_terminal.py):
//   GET  /device/session                  which lecture session is open on this terminal (every 30 s)
//   POST /device/attendance               one fingerprint scan (offline scans are queued in flash and sent later)
//   GET  /device/commands/next            work queued from the dashboard (every 3 s)
//   POST /device/commands/{id}/result     how that work went
//   POST /device/commands/{id}/face       raw 320x240 greyscale picture for face_enrol / face_verify (NEW - backend must add it)
// Command types handled: enrol (finger into a slot), delete_slot (POPIA wipe),
//   face_enrol (admin) and face_verify (admin or lecturer): ask the camera ESP32 for a picture, upload it, report the result.
// Wiring: DY50 TX(green)->GPIO16, RX(white)<-GPIO17, VCC->VIN, GND
//         LCD RS->23, E->19, D4->18, D5->4, D6->32, D7->13, RW->GND, V0->pot wiper
//         LEDs (220 ohm): green GPIO25, yellow GPIO26, red GPIO27. Buzzer: GPIO33 -> 1k -> NPN base
//         Camera ESP32 link: GPIO21 TX1 -> camera GPIO16, GPIO22 RX1 <- camera GPIO17, shared GND
// Libraries (Library Manager): "Adafruit Fingerprint Sensor Library", "ArduinoJson" (v7), "LiquidCrystal"
// Arduino IDE: board "ESP32 Dev Module", PSRAM "Disabled". Fill in secrets.h first.

#include <WiFi.h>                  // Wi-Fi
#include <HTTPClient.h>            // HTTP requests
#include <WiFiClientSecure.h>      // HTTPS
#include <Preferences.h>           // flash storage for the offline queue
#include <ArduinoJson.h>           // build and read JSON
#include <Adafruit_Fingerprint.h>  // DY50 driver
#include <LiquidCrystal.h>         // HD44780 LCD
#include <time.h>                  // clock from NTP
#include "mbedtls/md.h"            // HMAC-SHA256
#include "secrets.h"               // Wi-Fi, server and device secret

// ---------- pins ----------
const int FP_RX_PIN = 16;   // UART2 RX <- sensor TX (green)
const int FP_TX_PIN = 17;   // UART2 TX -> sensor RX (white)
const int CAM_RX_PIN = 22;  // UART1 RX <- camera ESP32 TX2 (GPIO17)
const int CAM_TX_PIN = 21;  // UART1 TX -> camera ESP32 RX2 (GPIO16)
const int LCD_RS = 23;      // LCD pin 4
const int LCD_E  = 19;      // LCD pin 6
const int LCD_D4 = 18;      // LCD pin 11
const int LCD_D5 = 4;       // LCD pin 12
const int LCD_D6 = 32;      // LCD pin 13
const int LCD_D7 = 13;      // LCD pin 14
const int LED_GREEN = 25;   // recorded / success
const int LED_YELLOW = 26;  // busy, offline, or "ask the lecturer"
const int LED_RED = 27;     // rejected / error
const int BUZZER = 33;      // through the NPN transistor

// ---------- settings ----------
const uint32_t FP_BAUD = 57600;              // sensor default
const uint32_t CAM_BAUD = 921600;            // must match the camera sketch
const uint16_t FINGER_TIMEOUT_MS = 15000;    // wait for a finger during enrolment prompts
const unsigned long RESULT_SHOW_MS = 2500;   // how long a result stays on the LCD
const unsigned long COMMAND_POLL_MS = 3000;  // how often to ask for dashboard work
const unsigned long SESSION_POLL_MS = 30000; // how often to re-check the open session
const unsigned long QUEUE_FLUSH_MS = 10000;  // how often to retry offline scans
const unsigned long WIFI_RETRY_MS = 15000;   // how often to retry Wi-Fi when it drops
const uint16_t HTTP_TIMEOUT_MS = 15000;      // per request (picture uploads take a few seconds)
const unsigned long CAMERA_TIMEOUT_MS = 8000;// 3 camera attempts + ~1 s transfer
const int FACE_TRIES = 3;                    // pictures per face command before giving up
const int FRAME_W = 320, FRAME_H = 240;      // picture size from the camera
const uint32_t FRAME_LEN = FRAME_W * FRAME_H; // 76 800 bytes
const int QUEUE_MAX = 40;                    // offline scans kept in flash

// ---------- objects ----------
HardwareSerial fingerSerial(2);                                   // UART2 for the sensor
HardwareSerial camSerial(1);                                      // UART1 for the camera ESP32
Adafruit_Fingerprint finger(&fingerSerial);                       // sensor driver
LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7); // LCD, 4-bit write-only
Preferences queueStore;                                           // flash namespace for the offline queue
WiFiClientSecure secureClient;                                    // one TLS connection, reused between requests
WiFiClient plainClient;                                           // for http:// during local testing
uint8_t *frame = nullptr;                                         // picture buffer, allocated once at start-up

// ---------- state ----------
bool fingerOk = false;        // sensor answered at start-up
bool cameraOk = false;        // camera ESP32 answered PONG OK
bool clockOk = false;         // NTP time is set (needed for signatures)
bool sessionOpen = false;     // a lecture session is open on this terminal
int sessionId = 0;            // id from GET /device/session
String sessionCourse = "";    // course code for the LCD
String sessionVenue = "";     // venue for the LCD
unsigned long nextCommandPoll = 0;  // millis() of the next command poll
unsigned long nextSessionPoll = 0;  // millis() of the next session check
unsigned long nextQueueFlush = 0;   // millis() of the next offline-queue retry
unsigned long nextWifiRetry = 0;    // millis() of the next Wi-Fi retry
String idleShown = "";              // which idle screen is showing (avoids redrawing every loop)

// ---------- LCD with scrolling (from fingerprint_lcd_test.ino) ----------
const int LCD_COLS = 16;                         // characters per line
const unsigned long SCROLL_STEP_MS = 350;        // time between scroll steps
const unsigned long SCROLL_START_DELAY_MS = 1000;// pause before a long line scrolls
const char *SCROLL_GAP = "    ";                 // gap between a message and its repeat
String lcdLine[2];                               // full text of each line
int lcdOffset[2] = {0, 0};                       // scroll position of each line
unsigned long lcdNextScroll = 0;                 // millis() of the next scroll step

void lcdDrawLine(int row) {  // draw the visible 16 characters of one line
  String text = lcdLine[row];  // full message
  String window = "";  // what gets printed
  if ((int)text.length() <= LCD_COLS) {  // fits
    window = text;  // as is
  } else {  // too long: moving window
    String loopText = text + SCROLL_GAP;  // message plus gap
    for (int i = 0; i < LCD_COLS; i++) window += loopText.charAt((lcdOffset[row] + i) % loopText.length());  // 16 chars from the offset
  }
  while ((int)window.length() < LCD_COLS) window += ' ';  // pad to clear old text
  lcd.setCursor(0, row);  // start of the row
  lcd.print(window);  // print it
}

void lcdShow(const String &line1, const String &line2) {  // set both lines (long ones scroll)
  lcdLine[0] = line1;  // top
  lcdLine[1] = line2;  // bottom
  lcdOffset[0] = 0;  // from the start
  lcdOffset[1] = 0;  // from the start
  lcdNextScroll = millis() + SCROLL_START_DELAY_MS;  // pause before scrolling
  lcd.clear();  // wipe
  lcdDrawLine(0);  // draw top
  lcdDrawLine(1);  // draw bottom
  idleShown = "";  // the idle screen must be redrawn later
}

void lcdTick() {  // call often: scrolls long lines
  if ((long)(millis() - lcdNextScroll) < 0) return;  // not yet
  lcdNextScroll = millis() + SCROLL_STEP_MS;  // next step
  for (int row = 0; row < 2; row++) {  // both lines
    int len = lcdLine[row].length();  // length
    if (len <= LCD_COLS) continue;  // short lines stay still
    lcdOffset[row] = (lcdOffset[row] + 1) % (len + strlen(SCROLL_GAP));  // one step
    lcdDrawLine(row);  // redraw
  }
}

void lcdWait(unsigned long minMs) {  // wait, keep scrolling, long enough to read the message once
  int longest = max(lcdLine[0].length(), lcdLine[1].length());  // longest line
  unsigned long readMs = SCROLL_START_DELAY_MS;  // time to read it all
  if (longest > LCD_COLS) readMs += (unsigned long)(longest - LCD_COLS + 2) * SCROLL_STEP_MS;  // time to scroll to the end
  unsigned long waitMs = max(minMs, readMs);  // never shorter than asked
  unsigned long start = millis();  // start
  while (millis() - start < waitMs) { lcdTick(); delay(20); }  // wait
}

// ---------- LEDs and buzzer ----------
void leds(bool g, bool y, bool r) {  // set all three LEDs
  digitalWrite(LED_GREEN, g);  // green
  digitalWrite(LED_YELLOW, y);  // yellow
  digitalWrite(LED_RED, r);  // red
}

void beep(int count, int onMs, int offMs) {  // short buzzer pattern
  for (int i = 0; i < count; i++) {  // each beep
    digitalWrite(BUZZER, HIGH);  // on
    delay(onMs);  // length
    digitalWrite(BUZZER, LOW);  // off
    if (i < count - 1) delay(offMs);  // gap
  }
}

void feedback(char kind, const String &line1, const String &line2) {  // result screen: 'g' success, 'y' warning, 'r' error
  leds(kind == 'g', kind == 'y', kind == 'r');  // matching LED
  lcdShow(line1, line2);  // message
  if (kind == 'g') beep(1, 120, 0);  // one short beep
  else if (kind == 'y') beep(2, 80, 80);  // two quick beeps
  else beep(1, 600, 0);  // one long beep
  lcdWait(RESULT_SHOW_MS);  // let it be read
  leds(false, false, false);  // LEDs off
}

// ---------- clock and signatures ----------
void syncClock() {  // get UTC time from the internet (needed for X-Timestamp)
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // UTC, two servers
  for (int i = 0; i < 20 && time(nullptr) < 1700000000; i++) delay(500);  // wait up to 10 s
  clockOk = time(nullptr) >= 1700000000;  // set once the year is sensible
  Serial.println(clockOk ? "Clock set from NTP" : "Clock NOT set (signatures will fail)");  // log
}

String isoNow() {  // current UTC time as 2026-11-02T10:15:30+00:00
  time_t t = time(nullptr);  // seconds since 1970
  struct tm utc;  // broken-down time
  gmtime_r(&t, &utc);  // to UTC fields
  char buf[32];  // text buffer
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S+00:00", &utc);  // ISO 8601 with timezone (the server needs one)
  return String(buf);  // done
}

String randomHex(int bytes) {  // random hex string (nonces and idempotency keys)
  String out = "";  // result
  for (int i = 0; i < bytes; i++) {  // each byte
    uint8_t b = esp_random() & 0xFF;  // hardware random
    if (b < 16) out += '0';  // leading zero
    out += String(b, HEX);  // two hex digits
  }
  return out;  // e.g. 32 hex chars for 16 bytes
}

String signRequest(const String &method, const String &path, uint32_t ts, const String &nonce, const uint8_t *body, size_t len) {  // same as compute_signature() in security.py
  String head = method + "\n" + path + "\n" + String(ts) + "\n" + nonce + "\n";  // method, path, timestamp, nonce, each followed by a newline
  uint8_t mac[32];  // HMAC-SHA256 output
  mbedtls_md_context_t ctx;  // hashing context
  mbedtls_md_init(&ctx);  // reset
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);  // SHA-256, HMAC mode
  mbedtls_md_hmac_starts(&ctx, (const unsigned char *)DEVICE_SECRET, strlen(DEVICE_SECRET));  // key = device secret
  mbedtls_md_hmac_update(&ctx, (const unsigned char *)head.c_str(), head.length());  // the header part
  if (len) mbedtls_md_hmac_update(&ctx, body, len);  // then the exact body bytes
  mbedtls_md_hmac_finish(&ctx, mac);  // result
  mbedtls_md_free(&ctx);  // clean up
  String hex = "";  // lowercase hex
  for (int i = 0; i < 32; i++) { if (mac[i] < 16) hex += '0'; hex += String(mac[i], HEX); }  // 64 hex chars
  return hex;  // signature
}

// ---------- HTTP ----------
struct ApiResponse {  // what came back
  int code;     // HTTP status, or negative for a network failure
  String body;  // response text
};

ApiResponse api(const char *method, const String &path, const uint8_t *body, size_t len, const char *contentType) {  // one signed request
  ApiResponse res = {-1, ""};  // assume failure
  if (WiFi.status() != WL_CONNECTED) return res;  // offline
  if (!clockOk) syncClock();  // signatures need the time
  if (!clockOk) return res;  // still no clock
  uint32_t ts = (uint32_t)time(nullptr);  // X-Timestamp
  String nonce = randomHex(16);  // X-Nonce, 32 hex chars, single use
  String sig = signRequest(method, path, ts, nonce, body, len);  // X-Signature
  String url = String(API_BASE_URL) + path;  // full address
  HTTPClient http;  // request object
  http.setReuse(true);  // keep the connection open between requests (saves a TLS handshake each poll)
  http.setTimeout(HTTP_TIMEOUT_MS);  // give up after this
  bool started = url.startsWith("https") ? http.begin(secureClient, url) : http.begin(plainClient, url);  // HTTPS or plain HTTP
  if (!started) return res;  // bad URL
  http.addHeader("X-Device-Id", String(DEVICE_ID));  // who we are
  http.addHeader("X-Timestamp", String(ts));  // when
  http.addHeader("X-Nonce", nonce);  // single-use random
  http.addHeader("X-Signature", sig);  // proof we know the secret
  if (contentType) http.addHeader("Content-Type", contentType);  // body type
  res.code = http.sendRequest(method, (uint8_t *)body, len);  // send exactly the signed bytes
  if (res.code > 0) res.body = http.getString();  // read the answer
  http.end();  // done (connection kept for reuse)
  Serial.printf("%s %s -> %d %s\n", method, path.c_str(), res.code, res.body.substring(0, 120).c_str());  // log
  return res;  // to the caller
}

ApiResponse apiJson(const char *method, const String &path, const String &json) {  // signed request with a JSON body
  return api(method, path, (const uint8_t *)json.c_str(), json.length(), "application/json");  // body as bytes
}

String errorDetail(const ApiResponse &r) {  // FastAPI errors look like {"detail": "unknown_slot"}
  JsonDocument doc;  // parsed body
  if (deserializeJson(doc, r.body)) return "";  // not JSON
  return String(doc["detail"] | "");  // the reason, or empty
}

// ---------- session ----------
void refreshSession() {  // ask which session is open on this terminal
  ApiResponse r = api("GET", "/device/session", nullptr, 0, nullptr);  // no body
  if (r.code == 200) {  // a session is open
    JsonDocument doc;  // parsed body
    if (deserializeJson(doc, r.body)) return;  // garbled, keep what we had
    sessionOpen = true;  // remember
    sessionId = doc["session_id"] | 0;  // id sent with every scan
    sessionCourse = String(doc["course_code"] | "");  // for the LCD
    sessionVenue = String(doc["venue"] | "");  // for the LCD
  } else if (r.code == 404) {  // no_open_session
    sessionOpen = false;  // stop taking scans
  } else if (r.code == 401) {  // signature rejected
    Serial.println("Session check rejected: " + errorDetail(r));  // usually clock or secret
  }  // network errors: keep the last known session so scans can be queued offline
}

void showIdle() {  // waiting screen, redrawn only when it changes
  String want;  // which screen
  if (WiFi.status() != WL_CONNECTED && !sessionOpen) want = "offline";  // no network, no session
  else if (!sessionOpen) want = "nosession";  // waiting for a lecturer
  else want = "session" + String(sessionId) + (WiFi.status() == WL_CONNECTED ? "" : "off");  // taking scans
  if (want == idleShown) return;  // already showing
  if (want == "offline") lcdShow("Offline", "Connecting to Wi-Fi...");  // no network
  else if (want == "nosession") lcdShow("No session open", "Waiting for the lecturer to open a session");  // idle
  else lcdShow(sessionCourse + " " + sessionVenue, WiFi.status() == WL_CONNECTED ? "Place your finger" : "Offline: place finger, saved for later");  // ready
  digitalWrite(LED_YELLOW, WiFi.status() != WL_CONNECTED);  // yellow while offline
  idleShown = want;  // remember
}

// ---------- offline queue (flash) ----------
int queueHead() { return queueStore.getInt("head", 0); }    // index of the oldest entry
int queueCount() { return queueStore.getInt("count", 0); }  // entries waiting

bool queuePush(const String &json) {  // keep a scan for later
  int count = queueCount();  // how many waiting
  if (count >= QUEUE_MAX) return false;  // full
  int slot = (queueHead() + count) % QUEUE_MAX;  // next free position (ring)
  queueStore.putString(("q" + String(slot)).c_str(), json);  // save the exact body (same idempotency key on resend)
  queueStore.putInt("count", count + 1);  // one more
  return true;  // saved
}

void queuePop() {  // drop the oldest entry
  int count = queueCount();  // how many
  if (count == 0) return;  // nothing
  queueStore.remove(("q" + String(queueHead())).c_str());  // delete it
  queueStore.putInt("head", (queueHead() + 1) % QUEUE_MAX);  // advance
  queueStore.putInt("count", count - 1);  // one fewer
}

void flushQueue() {  // send offline scans, oldest first, while the network works
  while (queueCount() > 0 && WiFi.status() == WL_CONNECTED) {  // something waiting and online
    String json = queueStore.getString(("q" + String(queueHead())).c_str(), "");  // oldest body
    if (json.length() == 0) { queuePop(); continue; }  // damaged entry
    ApiResponse r = apiJson("POST", "/device/attendance", json);  // resend (the server ignores repeats)
    if (r.code < 0 || r.code >= 500 || r.code == 401) return;  // network, server or clock problem: try later
    Serial.println("Synced offline scan: " + String(r.code) + " " + r.body);  // 200, or 404/409 the lecturer resolves
    queuePop();  // done with it either way
  }
}

// ---------- fingerprint ----------
bool waitForFinger(uint16_t timeoutMs) {  // wait for a finger image
  unsigned long start = millis();  // start
  while (millis() - start < timeoutMs) {  // until timeout
    if (finger.getImage() == FINGERPRINT_OK) return true;  // got one
    lcdTick();  // keep scrolling
    delay(50);  // pause
  }
  return false;  // none
}

void waitForRemoval() {  // wait until the finger is lifted (max 5 s)
  unsigned long start = millis();  // start
  while (finger.getImage() != FINGERPRINT_NOFINGER && millis() - start < 5000) { lcdTick(); delay(50); }  // still on the glass
}

void recordScan(uint16_t slot, uint16_t confidence) {  // send a match to the server and show the decision
  JsonDocument doc;  // request body
  doc["idempotency_key"] = randomHex(16);  // made once per scan, reused if queued
  doc["session_id"] = sessionId;  // the open session
  doc["slot_number"] = slot;  // matched slot
  doc["confidence"] = confidence;  // match score
  if (clockOk) doc["device_time"] = isoNow();  // scan time (needed if it syncs after the session closes)
  String json;  // body text
  serializeJson(doc, json);  // build it
  leds(false, true, false);  // yellow while checking
  lcdShow("Checking...", "Please wait");  // feedback
  ApiResponse r = apiJson("POST", "/device/attendance", json);  // send
  if (r.code == 200) {  // a decision
    JsonDocument res;  // response
    deserializeJson(res, r.body);  // parse
    String status = String(res["status"] | "");  // recorded / duplicate / low_confidence / not_in_course
    String name = String(res["full_name"] | "");  // student name
    if (status == "recorded") feedback('g', "Present", name);  // saved
    else if (status == "duplicate") feedback('y', "Already marked", name);  // second scan
    else if (status == "low_confidence") feedback('y', "Not sure it's you", "Ask the lecturer to verify your face");  // fallback path
    else if (status == "not_in_course") feedback('r', "Not in course", name + " is not on this class list");  // wrong class
    else feedback('r', "Unknown reply", status);  // unexpected
  } else if (r.code == 404) {  // unknown_slot or unknown_session
    String d = errorDetail(r);  // reason
    if (d == "unknown_session") { refreshSession(); feedback('r', "Session ended", "Scan not recorded"); }  // session changed
    else feedback('r', "Not registered", "See the admin to enrol your fingerprint");  // finger on the sensor, not in the database
  } else if (r.code == 409) {  // session_closed
    refreshSession();  // update the screen
    feedback('r', "Session closed", "Scan not recorded");  // too late
  } else if (r.code == 401) {  // bad signature / stale time / unknown device
    syncClock();  // the usual cause is the clock
    feedback('r', "Terminal error", "Not authorised: " + errorDetail(r));  // show the reason
  } else if (r.code < 0 || r.code >= 500) {  // offline or server down
    if (queuePush(json)) feedback('y', "Saved offline", "Will sync when the network is back");  // keep it
    else feedback('r', "Offline, queue full", "Please see the lecturer");  // no room
  } else {  // 422 or anything else
    feedback('r', "Error " + String(r.code), errorDetail(r));  // show it
  }
}

void scanForFinger() {  // quick look for a finger; full flow if there is one
  if (!fingerOk || finger.getImage() != FINGERPRINT_OK) return;  // nobody there
  if (!sessionOpen) {  // nothing to record against
    feedback('r', "No session open", "Wait for the lecturer to open the session");  // tell them
    waitForRemoval();  // one message per touch
    return;  // done
  }
  lcdShow("Reading...", "Hold still");  // finger detected
  if (finger.image2Tz(1) != FINGERPRINT_OK) {  // unreadable
    feedback('y', "Unclear print", "Press firmly with a clean, dry finger");  // retry hint
    waitForRemoval();  // lift
    return;  // done
  }
  uint8_t r = finger.fingerSearch();  // 1:N search
  if (r == FINGERPRINT_OK) recordScan(finger.fingerID, finger.confidence);  // matched: ask the server
  else if (r == FINGERPRINT_NOTFOUND) feedback('r', "Not recognised", "Please see your lecturer");  // not enrolled
  else feedback('r', "Sensor error", "Try again");  // comms problem
  waitForRemoval();  // one result per touch
}

bool enrolFinger(uint16_t slot, const String &name, String &detail) {  // capture the same finger twice into a slot
  lcdShow("Enrol: " + name, "Place finger");  // first prompt
  leds(false, true, false);  // yellow while enrolling
  if (!waitForFinger(FINGER_TIMEOUT_MS)) { detail = "timeout"; return false; }  // nobody came
  if (finger.image2Tz(1) != FINGERPRINT_OK) { detail = "unclear_print"; return false; }  // bad first image
  lcdShow("OK", "Remove finger");  // lift
  beep(1, 60, 0);  // tick
  waitForRemoval();  // wait for lift
  lcdShow("Same finger", "again please");  // second prompt
  if (!waitForFinger(FINGER_TIMEOUT_MS)) { detail = "timeout"; return false; }  // nobody came back
  if (finger.image2Tz(2) != FINGERPRINT_OK) { detail = "unclear_print"; return false; }  // bad second image
  if (finger.createModel() != FINGERPRINT_OK) { detail = "prints_differ"; return false; }  // two different fingers
  if (finger.storeModel(slot) != FINGERPRINT_OK) { detail = "store_failed"; return false; }  // slot out of range or flash error
  waitForRemoval();  // tidy up
  return true;  // stored
}

// ---------- camera ESP32 link ----------
bool pingCamera() {  // "P" -> "PONG OK" means the camera board and camera are ready
  while (camSerial.available()) camSerial.read();  // clear old bytes
  camSerial.write('P');  // ask
  String reply = "";  // answer text
  unsigned long start = millis();  // start
  while (millis() - start < 1000) {  // 1 s
    while (camSerial.available()) reply += (char)camSerial.read();  // collect
    if (reply.indexOf("PONG OK") >= 0) return true;  // ready
    if (reply.indexOf("PONG NOCAM") >= 0) return false;  // board up, camera not
    delay(10);  // wait
  }
  return false;  // no answer
}

bool requestPicture(String &detail) {  // "C" -> FRM1 packet into frame[], checksum verified
  while (camSerial.available()) camSerial.read();  // drop stale bytes
  camSerial.write('C');  // ask for a picture
  uint8_t win[4] = {0, 0, 0, 0};  // last 4 bytes seen, to find the marker
  unsigned long deadline = millis() + CAMERA_TIMEOUT_MS;  // give up after this
  bool found = false;  // marker seen
  while (millis() < deadline && !found) {  // until marker or timeout
    if (!camSerial.available()) { delay(1); continue; }  // nothing yet
    win[0] = win[1]; win[1] = win[2]; win[2] = win[3]; win[3] = camSerial.read();  // shift in one byte
    if (memcmp(win, "ERR!", 4) == 0) { detail = "camera_error"; return false; }  // camera couldn't take one
    found = memcmp(win, "FRM1", 4) == 0;  // start of a picture
  }
  if (!found) { detail = "camera_timeout"; return false; }  // no answer
  camSerial.setTimeout(3000);  // per-read limit for the rest
  uint8_t header[8];  // width, height, length
  if (camSerial.readBytes(header, 8) != 8) { detail = "camera_short_header"; return false; }  // cut off
  uint16_t w = header[0] | (header[1] << 8);  // width
  uint16_t h = header[2] | (header[3] << 8);  // height
  uint32_t len = header[4] | (header[5] << 8) | ((uint32_t)header[6] << 16) | ((uint32_t)header[7] << 24);  // pixel bytes
  if (w != FRAME_W || h != FRAME_H || len != FRAME_LEN) { detail = "camera_bad_size"; return false; }  // not what we expect
  if (camSerial.readBytes(frame, len) != len) { detail = "camera_short_picture"; return false; }  // cut off
  uint8_t tail[2];  // checksum
  if (camSerial.readBytes(tail, 2) != 2) { detail = "camera_no_checksum"; return false; }  // cut off
  uint16_t want = tail[0] | (tail[1] << 8);  // sent checksum
  uint16_t sum = 0;  // our checksum
  for (uint32_t i = 0; i < len; i++) sum += frame[i];  // add every pixel
  if (sum != want) { detail = "camera_checksum"; return false; }  // corrupted on the wire
  return true;  // good picture in frame[]
}

// ---------- dashboard commands ----------
void postResult(int commandId, bool success, const String &detail) {  // tell the server how a command went
  JsonDocument doc;  // body
  doc["success"] = success;  // done or failed
  if (detail.length()) doc["detail"] = detail;  // reason
  String json;  // text
  serializeJson(doc, json);  // build
  for (int i = 0; i < 3; i++) {  // a few tries
    ApiResponse r = apiJson("POST", "/device/commands/" + String(commandId) + "/result", json);  // send
    if (r.code > 0) return;  // the server got it (even a 4xx means it's been dealt with)
    delay(1000);  // wait before retrying
  }
}

String faceMessage(const String &status) {  // LCD text for a face result
  if (status == "no_face") return "No face found. Look straight at the camera";  // empty picture
  if (status == "multiple_faces") return "More than one face. Only one person please";  // crowded
  if (status == "poor_quality") return "Picture unclear. Hold still in good light";  // blurry or dark
  if (status == "no_match") return "Face does not match the student";  // wrong person
  return status;  // anything else as sent
}

void runFaceCommand(int commandId, bool enrol, const String &name) {  // face_enrol / face_verify
  String title = enrol ? "Face enrol" : "Face verify";  // LCD heading
  if (!cameraOk) cameraOk = pingCamera();  // maybe it came up late
  if (!cameraOk) {  // still nothing
    feedback('r', title, "Camera not responding");  // tell the room
    postResult(commandId, false, "camera_offline");  // tell the dashboard
    return;  // stop
  }
  String detail = "";  // last failure reason
  for (int attempt = 1; attempt <= FACE_TRIES; attempt++) {  // a few pictures if needed
    leds(false, true, false);  // yellow: busy
    for (int n = 3; n >= 1; n--) {  // countdown so the student is ready
      lcdShow(title + ": " + name, "Look at the camera  " + String(n));  // prompt
      beep(1, 40, 0);  // tick
      delay(1000);  // one second
    }
    lcdShow(title, "Taking picture...");  // capturing
    if (!requestPicture(detail)) {  // camera or link failed
      Serial.println("Picture failed: " + detail);  // log
      continue;  // next attempt
    }
    beep(1, 150, 0);  // shutter sound
    lcdShow(title, "Checking face...");  // uploading
    ApiResponse r = api("POST", "/device/commands/" + String(commandId) + "/face", frame, FRAME_LEN, "application/octet-stream");  // raw picture, signed
    if (r.code != 200) {  // upload failed
      detail = r.code < 0 ? "upload_failed" : "server_" + String(r.code) + " " + errorDetail(r);  // reason
      Serial.println("Upload failed: " + detail);  // log
      if (r.code == 404 || r.code == 409) break;  // command no longer valid: stop
      continue;  // try again
    }
    JsonDocument res;  // {"status": "...", "full_name": "..."}
    deserializeJson(res, r.body);  // parse
    String status = String(res["status"] | "");  // ok / no_match / no_face / multiple_faces / poor_quality
    String who = String(res["full_name"] | name.c_str());  // name to show
    if (status == "ok") {  // saved (enrol) or matched (verify)
      feedback('g', enrol ? "Face saved" : "Verified", who);  // success
      postResult(commandId, true, enrol ? "face_enrolled" : "face_verified");  // close the command
      return;  // done
    }
    detail = status;  // remember why
    if (status == "no_match") break;  // a different person: retaking won't help
    feedback('y', "Try again", faceMessage(status));  // retake hint
  }
  feedback('r', title + " failed", faceMessage(detail));  // gave up
  postResult(commandId, false, detail);  // tell the dashboard
}

void pollCommands() {  // ask the server for queued work
  ApiResponse r = api("GET", "/device/commands/next", nullptr, 0, nullptr);  // no body
  if (r.code != 200) return;  // 204 = nothing to do, or offline
  JsonDocument doc;  // the command
  if (deserializeJson(doc, r.body)) return;  // garbled
  int id = doc["command_id"] | 0;  // echo back in the result
  String type = String(doc["type"] | "");  // what to do
  int slot = doc["slot_number"] | 0;  // sensor slot
  String name = String(doc["full_name"] | "");  // student name (enrol / face)
  Serial.printf("Command %d: %s slot %d %s\n", id, type.c_str(), slot, name.c_str());  // log
  if (type == "enrol") {  // add a fingerprint
    String detail = "";  // failure reason
    bool ok = fingerOk && enrolFinger(slot, name, detail);  // do it
    if (!fingerOk) detail = "sensor_offline";  // sensor missing
    if (ok) feedback('g', "Enrolled", name);  // success
    else feedback('r', "Enrol failed", detail);  // failure
    postResult(id, ok, detail);  // report
  } else if (type == "delete_slot") {  // POPIA wipe
    uint8_t res = fingerOk ? finger.deleteModel(slot) : FINGERPRINT_PACKETRECIEVEERR;  // remove the template
    bool ok = res == FINGERPRINT_OK;  // deleted (an empty slot also reports OK)
    lcdShow(ok ? "Fingerprint" : "Delete failed", ok ? "deleted from slot " + String(slot) : "Slot " + String(slot));  // brief note
    lcdWait(1500);  // show it
    postResult(id, ok, ok ? "" : "delete_failed_" + String(res));  // report
  } else if (type == "face_enrol" || type == "face_verify") {  // face picture from the camera ESP32
    runFaceCommand(id, type == "face_enrol", name);  // capture, upload, report
  } else {  // a type this firmware doesn't know
    postResult(id, false, "unsupported_command");  // the dashboard sees it failed
  }
}

// ---------- Wi-Fi ----------
void connectWifi(unsigned long waitMs) {  // join the network (non-fatal if it fails)
  WiFi.mode(WIFI_STA);  // station
  WiFi.setAutoReconnect(true);  // rejoin after drops
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  // start
  unsigned long start = millis();  // start time
  while (WiFi.status() != WL_CONNECTED && millis() - start < waitMs) { lcdTick(); delay(200); }  // wait
  Serial.println(WiFi.status() == WL_CONNECTED ? "Wi-Fi connected, IP " + WiFi.localIP().toString() : "Wi-Fi not connected yet");  // log
}

// ---------- start-up ----------
void setup() {
  Serial.begin(115200);  // USB log
  pinMode(LED_GREEN, OUTPUT);  // LEDs
  pinMode(LED_YELLOW, OUTPUT);  // LEDs
  pinMode(LED_RED, OUTPUT);  // LEDs
  pinMode(BUZZER, OUTPUT);  // buzzer
  leds(true, true, true);  // lamp test
  beep(1, 80, 0);  // buzzer test
  lcd.begin(16, 2);  // 16 x 2 LCD
  lcdShow("Attendance", "Starting...");  // boot screen
  frame = (uint8_t *)malloc(FRAME_LEN);  // picture buffer first, before Wi-Fi splits the RAM up
  if (!frame) Serial.println("No RAM for the picture buffer: face commands will fail");  // unlikely
  leds(false, false, false);  // lamp test over

  fingerSerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);  // sensor UART
  delay(300);  // sensor power-up
  fingerOk = finger.verifyPassword();  // handshake
  lcdShow(fingerOk ? "Sensor OK" : "Sensor NOT found", fingerOk ? "DY50 ready" : "Check green->16, white->17");  // result
  lcdWait(1000);  // show it

  camSerial.setRxBufferSize(8192);  // room for bursts while a picture streams in at 921 600 baud
  camSerial.begin(CAM_BAUD, SERIAL_8N1, CAM_RX_PIN, CAM_TX_PIN);  // camera link
  for (int i = 0; i < 10 && !cameraOk; i++) { cameraOk = pingCamera(); if (!cameraOk) delay(500); }  // the camera board may still be starting
  lcdShow(cameraOk ? "Camera OK" : "Camera NOT found", cameraOk ? "Face checks ready" : "Check link wires and GND");  // result
  lcdWait(1000);  // show it

  secureClient.setInsecure();  // encrypt without checking the server certificate (demo); requests are still HMAC-signed
  lcdShow("Connecting", WIFI_SSID);  // Wi-Fi
  connectWifi(20000);  // up to 20 s
  if (WiFi.status() == WL_CONNECTED) syncClock();  // NTP time for signatures
  queueStore.begin("offq", false);  // offline queue in flash
  if (WiFi.status() == WL_CONNECTED) { refreshSession(); flushQueue(); }  // first look at the server
  nextCommandPoll = millis();  // poll straight away
  nextSessionPoll = millis() + SESSION_POLL_MS;  // then every 30 s
  idleShown = "";  // force the idle screen
  showIdle();  // ready
}

// ---------- main loop ----------
void loop() {
  lcdTick();  // keep long lines moving
  unsigned long now = millis();  // current time
  bool online = WiFi.status() == WL_CONNECTED;  // network up?
  if (!online && (long)(now - nextWifiRetry) >= 0) {  // dropped
    WiFi.reconnect();  // try again
    nextWifiRetry = now + WIFI_RETRY_MS;  // not too often
  }
  if (online && !clockOk) syncClock();  // got online after a cold start
  if (online && (long)(now - nextCommandPoll) >= 0) {  // dashboard work?
    pollCommands();  // handle at most one command
    nextCommandPoll = millis() + COMMAND_POLL_MS;  // next poll
  }
  if (online && (long)(now - nextSessionPoll) >= 0) {  // session changed?
    refreshSession();  // ask
    nextSessionPoll = millis() + SESSION_POLL_MS;  // next check
  }
  if (online && queueCount() > 0 && (long)(now - nextQueueFlush) >= 0) {  // offline scans waiting
    flushQueue();  // send them
    nextQueueFlush = millis() + QUEUE_FLUSH_MS;  // next try
  }
  showIdle();  // correct waiting screen
  scanForFinger();  // student at the sensor?
  delay(30);  // breathe
}
