Biometric Attendance terminal - which file goes where

1_camera_ESP32_38pin/camera_esp_uart/camera_esp_uart.ino
    Upload to the CAMERA ESP32 (38-pin, the one wired to the OV7670). Upload this first.
    Arduino IDE: Board "ESP32 Dev Module", PSRAM "Disabled". Open the .ino from inside its folder.
    Check: Serial Monitor at 921600, press EN -> "Camera ID 0x7673" and "READY".

2_main_ESP32_30pin/terminal/terminal.ino  (+ secrets.h in the same folder)
    Upload to the MAIN ESP32 (30-pin, the one wired to the DY50, LCD, LEDs and buzzer).
    Fill in secrets.h first (Wi-Fi, API_BASE_URL, DEVICE_ID, DEVICE_SECRET).
    Libraries: Adafruit Fingerprint Sensor Library, ArduinoJson (v7), LiquidCrystal.
    Arduino IDE: Board "ESP32 Dev Module", PSRAM "Disabled".
    Check: Serial Monitor at 115200 -> "Camera OK", Wi-Fi connected, then "Place your finger" or "No session open".

3_laptop/view_frame.py
    Not uploaded to any board. Runs on the laptop to test the camera over USB:
    python view_frame.py COM6   (camera ESP32's COM port)

Old sketches no longer used on the terminal: camera_esp.ino, camera_esp_i2s.ino.
