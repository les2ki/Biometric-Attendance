// secrets.example.h - copy this file to secrets.h (same folder) and fill in your values.
// secrets.h is listed in .gitignore: it must NEVER be pushed to GitHub.

#pragma once  // include this file only once

#define WIFI_SSID     "YOUR_HOTSPOT_NAME"       // 2.4 GHz network (iPhone: turn on "Maximize Compatibility")
#define WIFI_PASS     "YOUR_HOTSPOT_PASSWORD"   // its password
#define API_HOST      "biometric-api-fogc.onrender.com"  // the Render server, without https:// and without a / at the end
#define DEVICE_ID     1                          // terminal number from the dashboard (Admin > Terminals) or the seed log
#define DEVICE_SECRET "PASTE_THE_64_CHARACTER_DEVICE_SECRET_HERE"  // shown once when the terminal was created
