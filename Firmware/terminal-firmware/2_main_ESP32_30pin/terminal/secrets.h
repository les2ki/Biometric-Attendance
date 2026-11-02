// secrets.h - private settings for this terminal. Never commit real values (keep this file in .gitignore).
#pragma once  // include this file only once

#define WIFI_SSID "your-wifi-name"                         // Wi-Fi network (phone hotspot works)
#define WIFI_PASSWORD "your-wifi-password"                 // Wi-Fi password
#define API_BASE_URL "https://your-api.onrender.com"       // backend address, no trailing slash
#define DEVICE_ID 1                                        // this terminal's id (from seed.py / the admin Devices page)
#define DEVICE_SECRET "paste-the-device-hmac-secret-here"  // this terminal's HMAC secret (shown once when the device is created)
