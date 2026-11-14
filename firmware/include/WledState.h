#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

// Shared by the real Wi-Fi worker and the host regression tests.
inline bool validWledHost(const char* host){
  if(!host)return false;
  const size_t length=strlen(host);
  if(!length||length>63)return false;
  bool numeric=true;size_t label=0;
  for(size_t i=0;i<length;i++){
    const char c=host[i];
    if(c=='.'){
      if(!label||host[i-1]=='-')return false;
      label=0;continue;
    }
    if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'))return false;
    if(!label&&c=='-')return false;
    if(c<'0'||c>'9')numeric=false;
    if(++label>63)return false;
  }
  if(!label||host[length-1]=='-')return false;
  if(numeric){
    unsigned value=0,part=0,first=0;
    for(size_t i=0;i<=length;i++){
      if(host[i]=='.'||!host[i]){
        if(value>255)return false;
        if(!part)first=value;
        ++part;value=0;
      }else value=value*10+(unsigned)(host[i]-'0');
      if(value>255)return false;
    }
    if(part!=4||!first||first==127||first>=224)return false;
  }
  return true;
}

struct WledDesiredState {
  bool on=false;
  uint8_t brightness=255;
  uint32_t color=0xFFFFFF;
};

struct WledDeliveryState {
  bool enabled=false,online=false,ready=false;
  char host[64]{};
  WledDesiredState desired;
  uint32_t generation=0,revision=0,acknowledged=0;
  uint32_t nextAttempt=0,lastProbe=0,lastSeen=0,lastSent=0;
  uint32_t attempts=0,failures=0;
  uint8_t consecutiveFailures=0;

  void configure(bool use,const char* address,uint32_t now){
    enabled=use;online=false;++generation;
    snprintf(host,sizeof(host),"%s",address?address:"");
    nextAttempt=now;lastProbe=lastSeen=lastSent=0;
    consecutiveFailures=0;attempts=failures=0;acknowledged=0;
    if(ready)++revision;
  }
  void change(){ready=true;++revision;}
  void power(bool value){if(!ready||desired.on!=value){desired.on=value;change();}}
  void brightness(uint8_t percent){
    if(percent>100)percent=100;
    const uint8_t value=(uint16_t(percent)*255U+50U)/100U;
    if(!ready||desired.brightness!=value){desired.brightness=value;change();}
  }
  void color(uint32_t value){value&=0xFFFFFF;if(!ready||desired.color!=value){desired.color=value;change();}}
  bool due(uint32_t now)const{return (int32_t)(now-nextAttempt)>=0;}
  bool needsProbe(uint32_t now)const{return enabled&&due(now)&&(!online||(uint32_t)(now-lastProbe)>=15000UL);}
  bool needsWrite(uint32_t now)const{return enabled&&online&&ready&&revision!=acknowledged&&due(now);}
  bool accept(uint32_t requestGeneration)const{return enabled&&generation==requestGeneration;}
  void success(uint32_t now,bool probe,uint32_t sentRevision=0){
    online=true;lastSeen=now;consecutiveFailures=0;
    if(probe){lastProbe=now;if(ready)++revision;nextAttempt=now;}
    else{acknowledged=sentRevision;lastSent=now;nextAttempt=now+55UL;}
  }
  void failure(uint32_t now){
    online=false;++failures;if(consecutiveFailures<5)++consecutiveFailures;
    uint32_t delay=1000UL<<(consecutiveFailures?consecutiveFailures-1:0);
    nextAttempt=now+(delay>15000UL?15000UL:delay);
  }
  void retry(uint32_t now){online=false;nextAttempt=now;consecutiveFailures=0;}
};

// Apply the same RGB to every existing active segment, without changing LED type,
// LED count, output pins, segment bounds, presets, or the controller's power limit.
inline bool buildWledStateJson(char* out,size_t capacity,const WledDesiredState& state,
                               const uint8_t* segments,uint8_t count){
  if(!out||!capacity||!segments||!count||count>32)return false;
  int written=snprintf(out,capacity,"{\"on\":%s,\"bri\":%u,\"tt\":0,\"live\":false,\"udpn\":{\"nn\":true},\"seg\":[",
      state.on&&state.brightness?"true":"false",state.brightness?state.brightness:1);
  if(written<0||(size_t)written>=capacity)return false;
  size_t used=(size_t)written;
  for(uint8_t i=0;i<count;i++){
    written=snprintf(out+used,capacity-used,"%s{\"id\":%u,\"on\":true,\"bri\":255,\"fx\":0,\"pal\":0,\"frz\":false,\"col\":[[%u,%u,%u],[0,0,0],[0,0,0]]}",
        i?",":"",segments[i],(unsigned)((state.color>>16)&255),(unsigned)((state.color>>8)&255),(unsigned)(state.color&255));
    if(written<0||(size_t)written>=capacity-used)return false;
    used+=(size_t)written;
  }
  written=snprintf(out+used,capacity-used,"]}");
  return written>=0&&(size_t)written<capacity-used;
}
