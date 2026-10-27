// lcd_test.ino - bench test for the ACM1602K 16x2 character LCD (SPLC780D1 = HD44780-compatible) on an ESP32
// 4-bit parallel mode, write-only (R/W tied to GND). Wiring table: see the chat / docs/hardware notes.
// If the screen shows a row of solid blocks or nothing: turn the contrast potentiometer slowly.

#include <LiquidCrystal.h>  // built-in Arduino library for HD44780-style LCDs (works on ESP32)

const int LCD_RS = 23;  // GPIO23 -> LCD pin 4 (RS, register select)
const int LCD_E  = 19;  // GPIO19 -> LCD pin 6 (E, enable)
const int LCD_D4 = 18;  // GPIO18 -> LCD pin 11 (DB4)
const int LCD_D5 = 4;   // GPIO4  -> LCD pin 12 (DB5)
const int LCD_D6 = 32;  // GPIO32 -> LCD pin 13 (DB6)
const int LCD_D7 = 13;  // GPIO13 -> LCD pin 14 (DB7)

LiquidCrystal lcd(LCD_RS, LCD_E, LCD_D4, LCD_D5, LCD_D6, LCD_D7);  // 4-bit mode: only DB4-DB7 are used

unsigned long counter = 0;  // seconds since boot, shown on line 2

void setup() {  // runs once at power-up
  Serial.begin(115200);  // USB serial monitor
  lcd.begin(16, 2);  // tell the library the display is 16 columns x 2 rows
  lcd.clear();  // blank the screen and move the cursor home
  lcd.setCursor(0, 0);  // column 0, row 0 (top line)
  lcd.print("Biometric Att.");  // 14 chars fits the 16-char line
  lcd.setCursor(0, 1);  // column 0, row 1 (bottom line)
  lcd.print("LCD test OK");  // proves writing works
  Serial.println("LCD initialised - check the screen");  // serial confirmation
  delay(2000);  // leave the message up for 2 s
}

void loop() {  // runs forever
  lcd.setCursor(0, 1);  // bottom line, first column
  lcd.print("Uptime: ");  // label
  lcd.print(counter);  // number of seconds
  lcd.print("s      ");  // trailing spaces wipe leftover digits
  counter++;  // next second
  delay(1000);  // wait one second
}
