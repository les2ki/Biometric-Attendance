// secrets.h - private settings for this terminal. Never commit real values (keep this file in .gitignore).
#pragma once // include this file only once

#define WIFI_SSID "iPhone (2)"                                                           // Wi-Fi network (phone hotspot works)
#define WIFI_PASSWORD "Bubblesss"                                                        // Wi-Fi password
#define API_BASE_URL "https://biometric-api-fogc.onrender.com"                           // backend address, no trailing slash
#define DEVICE_ID 1                                                                      // this terminal's id (from seed.py / the admin Devices page)
#define DEVICE_SECRET "40510fd5bc6a8d636b9dd43da22e4d50741f1f4d3c076b798da5d8021a0431bf" // this terminal's HMAC secret (shown once when the device is created)
