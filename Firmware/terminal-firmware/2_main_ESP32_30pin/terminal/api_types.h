// api_types.h - shared types for terminal.ino. Kept in a header because Arduino IDE writes function
// prototypes near the top of the sketch, before any struct written in the .ino itself.
#pragma once  // include this file only once
#include <Arduino.h>  // String

struct ApiResponse {  // what came back from the server
  int code;     // HTTP status, or negative for a network failure
  String body;  // response text
};
