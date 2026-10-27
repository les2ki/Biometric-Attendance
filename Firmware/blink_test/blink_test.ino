// blink_test.ino - "is the ESP32 alive?" test
// Wiring: GPIO18 -> 220 ohm resistor -> LED long leg (anode); LED short leg (cathode) -> GND
// Serial Monitor at 115200 baud also prints a heartbeat, so you know the code is running even if the LED is wired wrong.

const int LED_PIN = 18;  // GPIO18 drives the external LED
const unsigned long BLINK_MS = 500;  // half a second on, half a second off

void setup() {  // runs once at power-up
  Serial.begin(115200);  // start the USB serial monitor
  pinMode(LED_PIN, OUTPUT);  // make GPIO18 an output pin
  Serial.println("ESP32 alive - blinking LED on GPIO18");  // startup message
}

void loop() {  // runs forever
  digitalWrite(LED_PIN, HIGH);  // 3.3 V on the pin: LED on
  Serial.println("LED ON");  // heartbeat in the serial monitor
  delay(BLINK_MS);  // wait
  digitalWrite(LED_PIN, LOW);  // 0 V on the pin: LED off
  Serial.println("LED OFF");  // heartbeat in the serial monitor
  delay(BLINK_MS);  // wait
}
