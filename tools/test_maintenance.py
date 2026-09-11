from pathlib import Path
import re
import subprocess
import tempfile
source=(Path(__file__).resolve().parents[1]/'firmware/src/main.cpp').read_text()
# Compile the actual production routines against controllable hardware stand-ins.
wifi=source[source.index('static void maintainWiFiConnection(){'):source.index('void setupRoutes(){')]
hour=source[source.index('static constexpr uint32_t MAINTENANCE_REBOOT_INTERVAL_MS='):source.index('\nvoid setup(){')]
stubs=r'''
#include <cstdint>
#include <string>
#include <cassert>
#include <iostream>
uint32_t tick=0; uint32_t millis(){return tick;} void delay(int){}
struct {int count=0;void restart(){++count;}} ESP;
struct {bool busy=false;bool isRunning(){return busy;}} Update;
constexpr int WL_CONNECTED=3,WIFI_STA=1,WIFI_SCAN_RUNNING=-1;
struct {int state=0,retries=0,modes=0,scan=-2;int scanComplete(){return scan;}int status(){return state;}bool reconnect(){++retries;return true;}bool mode(int v){assert(v==WIFI_STA);++modes;return true;}} WiFi;
struct Config{std::string ssid="test",tz="test";};struct {Config cfg;Config& get(){return cfg;}} store;
struct {int stops=0;void end(){++stops;}} MDNS;
int timeSyncs=0,mdnsStarts=0;void configTzTime(const char*,const char*,const char*){++timeSyncs;}void setupMdns(){++mdnsStarts;}
bool otaAutoRebootPending=false,setupAP=false,wifiWasConnected=false;uint32_t lastWiFiRetry=0;
'''
tests=r'''
int main(){
 maintenanceRebootStartedAt=1000;tick=14400999;checkMaintenanceReboot();assert(ESP.count==0);
 tick=14401000;checkMaintenanceReboot();assert(ESP.count==1);
 ESP.count=0;Update.busy=true;tick=14500000;checkMaintenanceReboot();assert(ESP.count==0);
 Update.busy=false;otaAutoRebootPending=true;checkMaintenanceReboot();assert(ESP.count==0);
 otaAutoRebootPending=false;checkMaintenanceReboot();assert(ESP.count==1);
 ESP.count=0;maintenanceRebootStartedAt=UINT32_MAX-1000;tick=14398998;checkMaintenanceReboot();assert(ESP.count==0);
 tick=14398999;checkMaintenanceReboot();assert(ESP.count==1);
 tick=1799999;maintainWiFiConnection();assert(WiFi.retries==0);
 tick=1800000;maintainWiFiConnection();assert(WiFi.retries==1);
 tick=3599999;maintainWiFiConnection();assert(WiFi.retries==1);
 tick=3600000;WiFi.scan=WIFI_SCAN_RUNNING;maintainWiFiConnection();assert(WiFi.retries==1);
 WiFi.scan=-2;maintainWiFiConnection();assert(WiFi.retries==2);
 tick=5400000;store.cfg.ssid="";maintainWiFiConnection();assert(WiFi.retries==2);
 store.cfg.ssid="test";Update.busy=true;maintainWiFiConnection();assert(WiFi.retries==2);
 Update.busy=false;otaAutoRebootPending=true;maintainWiFiConnection();assert(WiFi.retries==2);
 otaAutoRebootPending=false;WiFi.state=WL_CONNECTED;setupAP=true;maintainWiFiConnection();
 assert(!setupAP&&wifiWasConnected&&WiFi.modes==1&&timeSyncs==1&&mdnsStarts==1&&MDNS.stops==1);
 maintainWiFiConnection();assert(timeSyncs==1&&mdnsStarts==1&&WiFi.retries==2);
 WiFi.state=0;maintainWiFiConnection();assert(!wifiWasConnected&&WiFi.retries==3);
 WiFi.state=WL_CONNECTED;maintainWiFiConnection();assert(timeSyncs==2&&mdnsStarts==2&&WiFi.modes==1);
 WiFi.state=0;lastWiFiRetry=UINT32_MAX-1000;tick=1798998;maintainWiFiConnection();assert(WiFi.retries==3);
 tick=1798999;maintainWiFiConnection();assert(WiFi.retries==4);
 std::cout<<"PASS: 4-hour boundaries, offline operation, OTA deferral, timer wraparound, retry cadence, no-credentials case, and fallback AP recovery\n";
}
'''
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory)/'maintenance.cpp'
    p.write_text(stubs+wifi+hour+tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(p),'-o',str(p.with_suffix(''))],check=True)
    subprocess.run([str(p.with_suffix(''))],check=True)

# Test the actual automatic-update loop and monitor countdown with simulated time.
remote=(Path(__file__).resolve().parents[1]/'firmware/src/RemoteUpdate.cpp').read_text()
constants='\n'.join(re.findall(r'static constexpr uint32_t OTA_AUTO_\w+=.*?;',remote))
countdown=remote[remote.index('static uint32_t autoCheckSecondsRemaining(){'):remote.index('static bool allHex')]
auto_loop=remote[remote.index('void remoteUpdateAutoLoop('):remote.index('bool remoteUpdateConsumeRebootRequest()')]
remote_stubs=r'''
#include <cstdint>
#include <cassert>
#include <iostream>
uint32_t tick=0;uint32_t millis(){return tick;}
constexpr int WL_CONNECTED=3;
struct {int state=WL_CONNECTED;int status(){return state;}} WiFi;
bool rebootRequested=false,autoTimerStarted=false,manifestValid=true;
uint32_t autoNextCheckAt=0;
struct {bool installing=false,updateAvailable=false;} last;
int checks=0,installs=0;
bool fetchVerifiedManifest(const char*){++checks;return manifestValid;}
void downloadAndStage(){++installs;}
'''
remote_tests=r'''
int main(){
 tick=0;assert(autoCheckSecondsRemaining()==60);remoteUpdateAutoLoop("test");
 tick=59999;remoteUpdateAutoLoop("test");assert(checks==0&&autoCheckSecondsRemaining()==1);
 tick=60000;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==3600);
 tick=3659999;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==1);
 tick=3660000;remoteUpdateAutoLoop("test");assert(checks==2&&autoCheckSecondsRemaining()==3600);
 tick=autoNextCheckAt;last.installing=true;remoteUpdateAutoLoop("test");assert(checks==2);
 last.installing=false;rebootRequested=true;remoteUpdateAutoLoop("test");assert(checks==2);
 rebootRequested=false;last.updateAvailable=true;manifestValid=false;remoteUpdateAutoLoop("test");assert(checks==3&&installs==0);
 manifestValid=true;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==4&&installs==1);
 last.updateAvailable=false;autoTimerStarted=false;checks=0;tick=UINT32_MAX-1000;remoteUpdateAutoLoop("test");
 tick=58998;remoteUpdateAutoLoop("test");assert(checks==0&&autoCheckSecondsRemaining()==1);
 tick=58999;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==3600);
 WiFi.state=0;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==60);
 WiFi.state=WL_CONNECTED;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==2&&autoCheckSecondsRemaining()==3600);
 std::cout<<"PASS: hourly update checks/countdown, initial check, offline retry, timer rollover, install deferral, and verified-manifest gate\n";
}
'''
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory)/'remote_timing.cpp'
    p.write_text(remote_stubs+constants+countdown+auto_loop+remote_tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(p),'-o',str(p.with_suffix(''))],check=True)
    subprocess.run([str(p.with_suffix(''))],check=True)
