#pragma once
#include <ArduinoJson.h>
#include "WledState.h"

struct WledPeerInfo {
  char name[49]{},version[25]{};
  uint16_t pixels=0;
  uint8_t segmentCount=0,segments[32]{};
};

inline bool parseWledPeer(const char* data,size_t size,WledPeerInfo& peer){
  JsonDocument filter;
  filter["info"]["brand"]=true;filter["info"]["ver"]=true;
  filter["info"]["name"]=true;filter["info"]["leds"]["count"]=true;
  filter["state"]["seg"][0]["id"]=true;
  filter["state"]["seg"][0]["start"]=true;
  filter["state"]["seg"][0]["stop"]=true;
  JsonDocument doc;
  if(deserializeJson(doc,data,size,DeserializationOption::Filter(filter)))return false;
  const char* brand=doc["info"]["brand"]|"";
  const char* version=doc["info"]["ver"]|"";
  const int pixels=doc["info"]["leds"]["count"]|0;
  if(strcmp(brand,"WLED")||!version[0]||pixels<1||pixels>65535||!doc["state"]["seg"].is<JsonArray>())return false;
  WledPeerInfo result{};
  JsonArray segments=doc["state"]["seg"].as<JsonArray>();
  for(JsonObject segment:segments){
    const int id=segment["id"]|-1,start=segment["start"]|-1,stop=segment["stop"]|-1;
    if(id<0||id>255||start<0||stop<=start||stop>pixels||result.segmentCount>=32)return false;
    for(uint8_t i=0;i<result.segmentCount;i++)if(result.segments[i]==id)return false;
    result.segments[result.segmentCount++]=(uint8_t)id;
  }
  if(!result.segmentCount)return false;
  snprintf(result.name,sizeof(result.name),"%s",doc["info"]["name"]|"WLED");
  snprintf(result.version,sizeof(result.version),"%s",version);
  result.pixels=(uint16_t)pixels;peer=result;return true;
}

inline bool parseWledAck(const char* data,size_t size){
  JsonDocument doc;
  return !deserializeJson(doc,data,size)&&doc.is<JsonObject>()&&doc["success"].is<bool>()&&doc["success"].as<bool>();
}
