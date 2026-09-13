#pragma once
#include "Arduino.h"
#include <ArduinoJson.h>
namespace ArduinoJson {
template<> struct Converter<String> {
  static void toJson(const String& src,JsonVariant dst){dst.set(src.c_str());}
  static String fromJson(JsonVariantConst src){const char* s=src.as<const char*>();return String(s?s:"");}
  static bool checkJson(JsonVariantConst src){return src.is<const char*>();}
};
}
