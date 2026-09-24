#pragma once
#include <stddef.h>
#include <stdint.h>

// Decode HTTP framing without buffering the whole response. Clock and wait are
// injected so the same deadline and malformed-input paths can run on the host.
template<class Client,class Sink,class Clock,class Wait>
bool readBoundedHttpBody(Client& client,int announced,bool chunked,size_t limit,
                         Sink sink,Clock clock,Wait wait,uint32_t idleMs,
                         uint32_t deadlineMs,const char*& error){
  error=nullptr;
  if(!chunked&&announced>=0&&(size_t)announced>limit){error="Remote response exceeds the maximum allowed size";return false;}
  const uint32_t started=clock();uint32_t lastData=started;size_t total=0;
  auto ready=[&]()->int{
    for(;;){
      uint32_t now=clock();
      if((uint32_t)(now-started)>=deadlineMs){error="Remote request exceeded its absolute deadline";return -1;}
      int available=client.available();if(available>0)return available;
      if(!client.connected())return 0;
      if((uint32_t)(now-lastData)>=idleMs){error="Remote request stalled";return -1;}
      wait();
    }
  };
  auto byte=[&](uint8_t& value)->bool{
    for(;;){int available=ready();if(available<=0){if(!error)error="Remote response ended early";return false;}
      if(client.read(&value,1)==1){lastData=clock();return true;}}
  };
  auto line=[&](char* out,size_t capacity)->bool{
    size_t n=0;uint8_t c=0;
    for(;;){if(!byte(c))return false;if(c=='\r'){if(!byte(c))return false;if(c!='\n'){error="Invalid HTTP chunk framing";return false;}out[n]=0;return true;}
      if(c=='\n'||n+1>=capacity){error="Invalid or oversized HTTP chunk header";return false;}out[n++]=(char)c;}
  };
  auto take=[&](size_t count)->bool{
    if(count>limit-total){error="Remote response exceeds the maximum allowed size";return false;}
    uint8_t buffer[512];
    while(count){int available=ready();if(available<=0){if(!error)error="Remote response ended early";return false;}
      size_t want=(size_t)available;if(want>sizeof(buffer))want=sizeof(buffer);if(want>count)want=count;
      int got=client.read(buffer,want);if(got<=0)continue;lastData=clock();
      if(!sink(buffer,(size_t)got)){error="Remote response consumer failed";return false;}
      total+=(size_t)got;count-=(size_t)got;
    }return true;
  };
  if(chunked){
    for(;;){char header[96];if(!line(header,sizeof(header)))return false;size_t count=0,digits=0;
      for(size_t i=0;header[i]&&header[i]!=';';i++){
        char c=header[i];int digit=c>='0'&&c<='9'?c-'0':(c>='a'&&c<='f'?c-'a'+10:(c>='A'&&c<='F'?c-'A'+10:-1));
        if(digit<0){error="Invalid HTTP chunk size";return false;}
        if(count>(SIZE_MAX-(size_t)digit)/16){error="HTTP chunk size overflow";return false;}count=count*16+(size_t)digit;digits++;
      }
      if(!digits){error="Missing HTTP chunk size";return false;}
      if(!count){size_t trailerBytes=0;for(;;){if(!line(header,sizeof(header)))return false;size_t n=0;while(header[n])n++;trailerBytes+=n+2;
          if(trailerBytes>1024){error="HTTP trailers are too large";return false;}if(!n)return true;}}
      if(!take(count))return false;uint8_t cr=0,lf=0;if(!byte(cr)||!byte(lf))return false;
      if(cr!='\r'||lf!='\n'){error="Invalid HTTP chunk terminator";return false;}
    }
  }
  if(announced>=0)return take((size_t)announced);
  for(;;){int available=ready();if(available<0)return false;if(!available)return true;if(!take((size_t)available))return false;}
}
