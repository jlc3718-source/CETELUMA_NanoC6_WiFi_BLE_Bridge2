#!/usr/bin/env python3
"""Exercise the actual setup routes with native ArduinoJson and simulated flash.

Usage: python3 tests/setup-save-regression.py --arduino-json .pio/libdeps/runtime/ArduinoJson/src
No device, network credentials, or filesystem formatting is required.
"""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--arduino-json', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = (root / 'src/Common.cpp').read_text()
mount = re.search(r'LittleFS\.begin\([^;\n]+?\)', source).group()
routes = source[source.index('void registerSetup(){'):]
partition = next(line for line in (root / 'partitions.csv').read_text().splitlines()
                 if line.startswith('storage,'))
assert partition.split(',')[0] == 'storage'
support = r'''
#include <ArduinoJson.h>
#include <cassert>
#include <cstdint>
#include <functional>
#include <iostream>
#include <map>
#include <string>
using String=std::string;
using namespace ArduinoJson;
constexpr int HTTP_GET=0,HTTP_POST=1;
struct Server {
  std::map<std::pair<String,int>,std::function<void()>> routes;
  std::map<String,String> args;
  int status=0;String response;
  void on(const char*p,int m,std::function<void()> fn){routes[{p,m}]=fn;}
  String arg(const char*key){return args[key];}
  void send(int s,const char* type="",const char* text=""){status=s;response=text;}
  void sendHeader(const char*,const String&){}
} web;
struct Flash {
  bool begin(bool format=false,const char* path="/littlefs",uint8_t count=10,const char* label="spiffs"){
    assert(!format);return String(label)=="storage";
  }
} LittleFS;
struct Device{int restarts=0;void restart(){++restarts;}} ESP;
JsonDocument secrets;
String apiToken="test-session",disk;
const char* SETUP="setup form";
bool signedIn=false,writeSucceeds=true;
int writes=0;
uint32_t millis(){return 10000;}
void delay(int){}
bool authorized(){return signedIn;}
void replyError(int status,const String& error){web.status=status;web.response=error;}
bool saveJson(const char*,JsonVariantConst value){
  ++writes;if(!writeSucceeds)return false;
  disk.clear();serializeJson(value,disk);return true;
}
void reset(){secrets.clear();secrets["adminToken"]="keep-token";disk.clear();signedIn=false;
 writeSucceeds=true;writes=0;ESP.restarts=0;web.status=0;web.response.clear();
 web.args={{"ssid","Home 2.4"},{"password","test-password"},{"pin","7788"}};}
void submit(){web.routes.at({"/setup",HTTP_POST})();}
'''
checks = r'''
int main(){
  assert(MOUNT_CALL);
  registerSetup();
  reset();submit();assert(web.status==200&&ESP.restarts==1&&writes==1);
  secrets.clear();assert(!deserializeJson(secrets,disk));
  assert(String(secrets["ssid"]|"")=="Home 2.4");
  assert(String(secrets["wifiPassword"]|"")=="test-password");
  assert(String(secrets["pin"]|"")=="7788");
  assert(String(secrets["adminToken"]|"")=="keep-token");
  reset();writeSucceeds=false;submit();assert(web.status==500&&ESP.restarts==0);
  assert(secrets["ssid"].isNull()&&secrets["pin"].isNull());
  writeSucceeds=true;submit();assert(web.status==200&&ESP.restarts==1);
  reset();secrets["ssid"]="Original";secrets["pin"]="1234";signedIn=true;
  writeSucceeds=false;submit();assert(web.status==500&&ESP.restarts==0);
  assert(String(secrets["ssid"]|"")=="Original"&&String(secrets["pin"]|"")=="1234");
  writeSucceeds=true;submit();assert(web.status==200&&ESP.restarts==1);
  reset();secrets["ssid"]="Original";submit();assert(web.status==401&&writes==0);
  for(const String& pin:{"123","1234567890123","77a8"}){
    reset();web.args["pin"]=pin;submit();assert(web.status==400&&writes==0&&ESP.restarts==0);
  }
  for(const String& ssid:{String(""),String(33,'s')}){
    reset();web.args["ssid"]=ssid;submit();assert(web.status==400&&writes==0&&ESP.restarts==0);
  }
  std::cout<<"PASS: storage mount, reboot persistence, failed-save retry, existing credentials, auth and input validation\n";
}
'''.replace('MOUNT_CALL', mount)
with tempfile.TemporaryDirectory(prefix='jh2-setup-') as tmp:
    cpp = Path(tmp) / 'setup.cpp'
    cpp.write_text(support + routes + checks)
    binary = Path(tmp) / 'setup'
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Wno-unused-parameter',
                    '-I',str(args.arduino_json.resolve()),str(cpp),'-o',str(binary)],check=True)
    subprocess.run([str(binary)],check=True)
