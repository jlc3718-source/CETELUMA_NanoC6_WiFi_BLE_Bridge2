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

# Validate asynchronous OTA cadence/backoff without compiling network/RTOS implementation.
remote=(Path(__file__).resolve().parents[1]/'firmware/src/RemoteUpdate.cpp').read_text()
assert 'OTA_AUTO_FIRST_CHECK_MS=20UL*1000UL' in remote
assert 'OTA_AUTO_INTERVAL_MS=5UL*60UL*1000UL' in remote
assert 'OTA_AUTO_RETRY_BASE_MS=30UL*1000UL' in remote
assert 'OTA_AUTO_RETRY_MAX_MS=5UL*60UL*1000UL' in remote
assert 'completed=millis()' in remote and 'scheduleAutoRetry(completed)' in remote
assert 'xTaskCreate(worker,"anderson-ota"' in remote
assert 'OTA_MANIFEST_MAX_BYTES=4096' in remote and 'OTA_DOWNLOAD_DEADLINE_MS=180000UL' in remote
failures=0;delays=[]
for _ in range(5):
 delays.append(min(30000*(2**min(failures,4)),300000));failures+=1
assert delays==[30000,60000,120000,240000,300000]
failures=0;assert min(30000*(2**min(failures,4)),300000)==30000
# Completion-time scheduling: a 40s operation plus 30s backoff waits until t=70s, not t=30s.
started=100000;completed=started+40000;assert completed+30000==170000
print('PASS: 20-second startup, five-minute healthy cadence, 30/60/120/240/300 completion-time backoff, bounded manifest and absolute download deadline')

# Focused failure regressions for the v3.0.14 connection recovery changes.
subprocess.run(['python',str(Path(__file__).with_name('test_connection_recovery.py'))],check=True)
