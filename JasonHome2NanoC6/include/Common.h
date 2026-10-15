#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <vector>
#include <time.h>

using Bytes=std::vector<uint8_t>;
extern WebServer web;
extern JsonDocument state, secrets;
extern String apiToken,lastError;
extern bool activationEnabled;
extern const char* VERSION;
extern const char* BUILD_SHA;
void startNetwork();
void networkLoop();
bool saveJson(const char* path, JsonVariantConst value);
bool loadJson(const char* path, JsonDocument& doc);
void reply(int code,JsonVariantConst value);
void replyError(int code,const String& message);
bool authorized();
String hexBytes(const uint8_t* p,size_t len);
Bytes fromHex(const String& value);
String to64(const uint8_t* p,size_t len);
Bytes from64(const String& value);
bool readHttpText(HTTPClient& http,String& text,size_t limit=65536);
bool httpsJson(const String& url,const String* body,JsonDocument& out,const std::vector<std::pair<String,String>>& headers={});
void trust(WiFiClientSecure& client);
String randomHex(size_t bytes=16);
void registerSetup();
bool timeValid();
