#!/usr/bin/env python3
"""Compile real scheduler/HTTP/runtime code with host clock and allocation faults."""
from pathlib import Path
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[1]

def run():
    with tempfile.TemporaryDirectory(prefix='anderson-runtime-') as directory:
        d=Path(directory)
        def test(name,source,extra=()):
            path=d/(name+'.cpp');path.write_text(source)
            subprocess.run(['g++','-std=c++17','-O2','-I'+str(d),'-I'+str(ROOT/'firmware/include'),str(path),*[str(ROOT/x) for x in extra],'-o',str(d/name)],check=True)
            subprocess.run([str(d/name)],check=True)
        (d/'Arduino.h').write_text('''#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
using std::min;using std::max;
struct String:std::string{using std::string::string;String(const std::string&s):std::string(s){}String(int n):std::string(std::to_string(n)){}};
template<class T>T constrain(T x,T a,T b){return x<a?a:(x>b?b:x);}
''')
        test('solar',r'''
#include "Scheduler.h"
#include "EventCatalog.h"
#include <cassert>
#include <cstdlib>
static time_t now;
extern "C" time_t time(time_t*p) noexcept{if(p)*p=now;return now;}
bool eventStateEnabled(size_t){return true;}bool eventAllowedInActiveSchedule(size_t){return true;}
Theme applyEventOverrideByIndex(size_t,const Theme&t){return t;}
tm date(int month,int day,int hour){tm t{};t.tm_year=126;t.tm_mon=month-1;t.tm_mday=day;t.tm_hour=hour;t.tm_isdst=-1;mktime(&t);return t;}
int main(){setenv("TZ","EST5EDT,M3.2.0,M11.1.0",1);tzset();AppSettings cfg;Scheduler s(&cfg);
 for(auto md:{std::pair<int,int>{9,24},{3,8},{11,1},{1,1},{12,31}}){
  tm noon=date(md.first,md.second,12);now=mktime(&noon);auto dawn=s.civilDawnMinutes(noon),dusk=s.civilDuskMinutes(noon);
  for(int hour:{0,1,3,12,19,23}){tm target=date(md.first,md.second,hour);assert(s.civilDawnMinutes(target)==dawn);assert(s.civilDuskMinutes(target)==dusk);}
  now+=86400;assert(s.civilDawnMinutes(noon)==dawn);assert(s.civilDuskMinutes(noon)==dusk);
 }
 tm september=date(9,24,19);now=0;assert(s.civilDuskMinutes(september)==19*60+38);
 puts("PASS: solar previews, prior dates, DST transition dates and year boundaries");}
''',('firmware/src/Scheduler.cpp','firmware/src/EventCatalog.cpp'))
        test('http',r'''
#include "BoundedHttpBody.h"
#include <algorithm>
#include <cassert>
#include <cstring>
#include <cstdio>
#include <string>
struct Client{std::string data;size_t at=0;bool keep=false;size_t fragment=3;int available(){return std::min(fragment,data.size()-at);}bool connected(){return keep||at<data.size();}int read(uint8_t*out,size_t n){n=std::min(n,data.size()-at);memcpy(out,data.data()+at,n);at+=n;return n;}};
bool read(std::string wire,int length,bool chunked,size_t cap,std::string&body,const char*&error,bool keep=false,uint32_t start=0,bool slow=false){Client client{wire,0,keep};uint32_t now=start;body.clear();return readBoundedHttpBody(client,length,chunked,cap,[&](const uint8_t*p,size_t n){body.append((const char*)p,n);return true;},[&](){uint32_t result=now;now+=slow?2:1;return result;},[&](){now++;},10,slow?18:1000,error);}
int main(){std::string body;const char*error=nullptr;
 assert(read("hello",5,false,5,body,error)&&body=="hello");
 assert(read("hello",-1,false,5,body,error)&&body=="hello");
 assert(read("2;ext=yes\r\nhe\r\n3\r\nllo\r\n0\r\nX-Test: yes\r\n\r\n",-1,true,5,body,error,true)&&body=="hello");
 assert(read("0\r\n\r\n",-1,true,0,body,error)&&body.empty());
 assert(!read("hello",6,false,6,body,error));
 assert(!read("hello!",-1,false,5,body,error));
 assert(!read("6\r\nhello!\r\n0\r\n\r\n",-1,true,5,body,error));
 assert(!read("z\r\n",-1,true,50,body,error));
 assert(!read("1\r\naXX",-1,true,50,body,error));
 assert(!read(std::string(96,'f')+"\r\n",-1,true,50,body,error));
 assert(!read("ffffffffffffffffffffffff\r\n",-1,true,50,body,error));
 assert(!read("1\r\na\r\n",-1,true,50,body,error));
 assert(!read("",1,false,5,body,error,true));assert(std::string(error).find("stalled")!=std::string::npos);
 assert(!read("",1,false,5,body,error,true,UINT32_MAX-4));
 assert(!read("1\r\na\r\n1\r\nb\r\n0\r\n\r\n",-1,true,50,body,error,true,0,true));assert(std::string(error).find("deadline")!=std::string::npos);
 puts("PASS: content length, chunk decoding/extensions/trailers, truncation, caps, malformed framing, idle/absolute deadlines and clock rollover");}
''')
        remote=(ROOT/'firmware/src/RemoteUpdate.cpp').read_text()
        runtime=remote.split('static bool ensureRuntime(){',1)[1].split('\n}',1)[0]
        queue=next(x for x in remote.splitlines() if x.startswith('static String queueJob('))
        test('worker',r'''
#include <atomic>
#include <string>
#include <cassert>
#include <cstring>
#include <cstdio>
using String=std::string;using Handle=void*;
Handle statusMutex=nullptr,jobQueue=nullptr,workerTask=nullptr;
int fault=0,sends=0,retries=0;constexpr int pdPASS=1,pdTRUE=1,JOB_AUTO=3,OWNER_NONE=0,OWNER_REMOTE=1;
std::atomic<uint8_t> operationOwner{OWNER_NONE};std::atomic<uint32_t> operationSequence{0};
struct RemoteJob{uint8_t kind;uint32_t id;char currentVersion[20];};
struct RemoteStatus{bool checked=false,ok=false,operationComplete=true,updateHold=false;uint32_t operationId=0;String phase,message,rejectedVersion;}last;
Handle xSemaphoreCreateMutex(){return fault==1?nullptr:(Handle)1;}Handle xQueueCreate(int,size_t){return fault==2?nullptr:(Handle)2;}
void worker(void*){}int xTaskCreate(void(*)(void*),const char*,int,void*,int,Handle*out){if(fault==3)return 0;*out=(Handle)3;return pdPASS;}
int xQueueSend(Handle,const RemoteJob*,int){sends++;return pdTRUE;}
void publish(const RemoteStatus&s){last=s;}RemoteStatus snapshot(){return last;}String statusJson(const char*){return last.phase;}
bool readHold(String&){return false;}uint32_t millis(){return 123;}void scheduleAutoRetry(uint32_t){retries++;}
size_t strlcpy(char*d,const char*s,size_t n){snprintf(d,n,"%s",s);return strlen(s);}
'''+ 'static bool ensureRuntime(){'+runtime+'\n}\n'+queue+r'''
int main(){for(int f:{1,2,3}){statusMutex=jobQueue=workerTask=nullptr;operationOwner=OWNER_NONE;sends=retries=0;fault=f;
 assert(queueJob(JOB_AUTO,"3.1.54")=="failed");assert(operationOwner==OWNER_NONE&&sends==0&&retries==1&&last.operationComplete);
 fault=0;assert(queueJob(JOB_AUTO,"3.1.54")=="queued");assert(workerTask&&sends==1&&operationOwner==OWNER_REMOTE);
 }puts("PASS: mutex/queue/task allocation failure leaves OTA unlocked and subsequent retry queues successfully");}
''')

if __name__=='__main__':run()
