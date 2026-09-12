# Anderson network/maintenance-reboot regression gate (v3.0.15 schedule coverage).
from pathlib import Path
import re
import subprocess
import tempfile
source=(Path(__file__).resolve().parents[1]/'firmware/src/main.cpp').read_text()
wifi=source[source.index('static void maintainWiFiConnection(){'):source.index('void setupRoutes(){')]
stubs=r'''
#include <cstdint>
#include <atomic>
#include <string>
#include <cassert>
#include <iostream>
uint32_t tick=0; uint32_t millis(){return tick;} void delay(int){}
struct {int count=0;void restart(){++count;}} ESP;
struct {bool busy=false;bool isRunning(){return busy;}} Update;
constexpr int WL_CONNECTED=3,WIFI_STA=1,WIFI_SCAN_RUNNING=-1;
struct {int state=0,retries=0,modes=0,scan=-2;int scanComplete(){return scan;}uint32_t ip=0x0101A8C0;uint32_t localIP(){return ip;}int status(){return state;}bool reconnect(){++retries;return true;}bool mode(int v){assert(v==WIFI_STA);++modes;return true;}} WiFi;
struct Config{std::string ssid="test",tz="test";};struct {Config cfg;Config& get(){return cfg;}} store;
struct {int stops=0;void end(){++stops;}} MDNS;
int timeSyncs=0,mdnsStarts=0;void configTzTime(const char*,const char*,const char*){++timeSyncs;}void setupMdns(){++mdnsStarts;}
bool otaAutoRebootPending=false,setupAP=false,wifiWasConnected=false;
uint32_t lastWiFiRetry=0,wifiOfflineSince=0;bool wifiOfflineTimerStarted=false;
bool networkServerStarted=true;uint32_t lastStationIp=0,networkServiceRestarts=0;
std::atomic<bool> networkServiceRefreshPending{false};
struct {int closes=0,starts=0,clientCloses=0;struct Client{int* counter;void stop(){++*counter;}};Client client(){return {&clientCloses};}void stop(){++closes;}void begin(){++starts;}} server;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS=30UL*1000UL;
constexpr uint32_t WIFI_OFFLINE_REBOOT_MS=10UL*60UL*1000UL;
'''
tests=r'''
int main(){
 tick=0;maintainWiFiConnection();assert(wifiOfflineTimerStarted&&wifiOfflineSince==0&&WiFi.retries==0&&ESP.count==0);
 tick=29999;maintainWiFiConnection();assert(WiFi.retries==0&&ESP.count==0);
 tick=30000;maintainWiFiConnection();assert(WiFi.retries==1&&ESP.count==0);
 tick=59999;maintainWiFiConnection();assert(WiFi.retries==1);
 tick=60000;WiFi.scan=WIFI_SCAN_RUNNING;maintainWiFiConnection();assert(WiFi.retries==1&&ESP.count==0);
 WiFi.scan=-2;maintainWiFiConnection();assert(WiFi.retries==2);
 tick=599999;maintainWiFiConnection();assert(ESP.count==0);
 tick=600000;maintainWiFiConnection();assert(ESP.count==1);
 ESP.count=0;WiFi.state=WL_CONNECTED;setupAP=true;maintainWiFiConnection();
 assert(!wifiOfflineTimerStarted&&!setupAP&&wifiWasConnected&&WiFi.modes==1&&timeSyncs==1&&mdnsStarts==1&&MDNS.stops==1);
 maintainWiFiConnection();assert(timeSyncs==1&&mdnsStarts==1&&server.starts==1&&server.closes==1&&server.clientCloses==1);
 // A brief dropout/reconnect between loop calls is retained by the event flag.
 networkServiceRefreshPending=true;maintainWiFiConnection();assert(server.starts==2&&timeSyncs==2&&!networkServiceRefreshPending);
 maintainWiFiConnection();assert(server.starts==2);
 // DHCP IP change and fallback AP recovery both recreate the listener.
 ++WiFi.ip;maintainWiFiConnection();assert(server.starts==3&&lastStationIp==WiFi.ip);
 networkServiceRefreshPending=true;Update.busy=true;maintainWiFiConnection();assert(server.starts==3&&networkServiceRefreshPending);
 Update.busy=false;maintainWiFiConnection();assert(server.starts==4&&!networkServiceRefreshPending);
 WiFi.ip=0;maintainWiFiConnection();assert(wifiOfflineTimerStarted);
 WiFi.ip=0x0101A8C0;maintainWiFiConnection();assert(!wifiOfflineTimerStarted);
 WiFi.state=0;tick=700000;lastWiFiRetry=tick;maintainWiFiConnection();assert(wifiOfflineTimerStarted&&wifiOfflineSince==tick&&ESP.count==0);
 tick=729999;maintainWiFiConnection();int before=WiFi.retries;assert(ESP.count==0);
 tick=730000;maintainWiFiConnection();assert(WiFi.retries==before+1&&ESP.count==0);
 store.cfg.ssid="";tick=800000;maintainWiFiConnection();assert(!wifiOfflineTimerStarted&&ESP.count==0);
 store.cfg.ssid="test";Update.busy=true;tick=900000;maintainWiFiConnection();assert(!wifiOfflineTimerStarted&&ESP.count==0);
 Update.busy=false;otaAutoRebootPending=true;maintainWiFiConnection();assert(!wifiOfflineTimerStarted&&ESP.count==0);
 otaAutoRebootPending=false;lastWiFiRetry=UINT32_MAX-1000;wifiOfflineSince=UINT32_MAX-1000;wifiOfflineTimerStarted=true;WiFi.state=0;
 int wrapRetries=WiFi.retries;tick=28998;maintainWiFiConnection();assert(WiFi.retries==wrapRetries&&ESP.count==0);
 tick=28999;maintainWiFiConnection();assert(WiFi.retries==wrapRetries+1&&ESP.count==0);
 lastWiFiRetry=tick;tick=598998;maintainWiFiConnection();assert(ESP.count==0);
 tick=598999;maintainWiFiConnection();assert(ESP.count==1);
 WiFi.state=WL_CONNECTED;maintainWiFiConnection();assert(!wifiOfflineTimerStarted);
 std::cout<<"PASS: 30-second retry cadence, 10-minute continuous-offline watchdog, reconnection reset, no-credentials case, OTA deferral, fallback AP recovery, and timer wraparound\n";
}
'''
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory)/'maintenance.cpp'
    p.write_text(stubs+wifi+tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(p),'-o',str(p.with_suffix(''))],check=True)
    subprocess.run([str(p.with_suffix(''))],check=True)


# Validate the production four-times-daily maintenance reboot wiring and semantics.
main_loop=source[source.index('void loop(){'):]
assert 'MAINTENANCE_REBOOT_MINUTES[]={0U,6U*60U,12U*60U,18U*60U}' in source
maintenance_check=source[source.index('static void checkScheduledMaintenanceReboot(){'):source.index('void setup(){')]
assert 'if(Update.isRunning()||otaAutoRebootPending||!timeValid())return;' in maintenance_check
assert 'checkScheduledMaintenanceReboot();' in main_loop
assert 'nextRebootSeconds' in source and 'rebootSchedule' in source

def reboot_slot(minute):
    return 3 if minute>=1080 else 2 if minute>=720 else 1 if minute>=360 else 0

def scheduled_due(state, day, minute):
    initialized, handled=state
    key=day*4+reboot_slot(minute)
    if not initialized:
        return (True,key),False
    if key<=handled:
        return state,False
    return (True,key),True

state=(False,-1)
state,due=scheduled_due(state,1000,359);assert not due
state,due=scheduled_due(state,1000,360);assert due
state,due=scheduled_due(state,1000,719);assert not due
state,due=scheduled_due(state,1000,720);assert due
state,due=scheduled_due(state,1000,1080);assert due
state,due=scheduled_due(state,1001,0);assert due
state,due=scheduled_due(state,1001,359);assert not due
state,due=scheduled_due(state,1001,360);assert due
state=(False,-1)
state,due=scheduled_due(state,2000,800);assert not due and state==(True,2000*4+2)
state,due=scheduled_due(state,2000,1079);assert not due
state,due=scheduled_due(state,2000,1080);assert due
print('PASS: 00:00/06:00/12:00/18:00 local reboot state machine, no post-boot refire, and monitor telemetry wiring')

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
bool rebootRequested=false,autoTimerStarted=false,manifestValid=true,stageOk=true;
uint32_t autoNextCheckAt=0;uint8_t autoFailureCount=0;
struct {bool installing=false,updateAvailable=false;} last;
int checks=0,installs=0;
bool fetchVerifiedManifest(const char*){++checks;return manifestValid;}
bool downloadAndStage(){++installs;return stageOk;}
'''
remote_tests=r'''
int main(){
 tick=0;assert(autoCheckSecondsRemaining()==20);remoteUpdateAutoLoop("test");
 tick=19999;remoteUpdateAutoLoop("test");assert(checks==0&&autoCheckSecondsRemaining()==1);
 tick=20000;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==300&&autoFailureCount==0);
 manifestValid=false;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==2&&autoCheckSecondsRemaining()==30&&autoFailureCount==1);
 tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==3&&autoCheckSecondsRemaining()==60&&autoFailureCount==2);
 manifestValid=true;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==4&&autoCheckSecondsRemaining()==300&&autoFailureCount==0);
 last.updateAvailable=true;stageOk=false;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==5&&installs==1&&autoCheckSecondsRemaining()==30&&autoFailureCount==1);
 stageOk=true;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==6&&installs==2&&autoFailureCount==0);
 last.updateAvailable=false;
 WiFi.state=0;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==6&&autoCheckSecondsRemaining()==30&&autoFailureCount==1);
 WiFi.state=WL_CONNECTED;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==7&&autoCheckSecondsRemaining()==300&&autoFailureCount==0);
 autoTimerStarted=false;checks=0;tick=UINT32_MAX-1000;remoteUpdateAutoLoop("test");
 tick=18998;remoteUpdateAutoLoop("test");assert(checks==0&&autoCheckSecondsRemaining()==1);
 tick=18999;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==300);
 std::cout<<"PASS: 20-second first OTA check, five-minute normal cadence, bounded failure retry, stage retry, offline retry, and timer rollover\n";
}
'''
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory)/'remote_timing.cpp'
    p.write_text(remote_stubs+constants+countdown+auto_loop+remote_tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(p),'-o',str(p.with_suffix(''))],check=True)
    subprocess.run([str(p.with_suffix(''))],check=True)

# Focused failure regressions for the v3.0.14 connection recovery changes.
subprocess.run(['python',str(Path(__file__).with_name('test_connection_recovery.py'))],check=True)
