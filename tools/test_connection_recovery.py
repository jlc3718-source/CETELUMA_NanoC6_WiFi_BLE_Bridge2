"""Run production recovery functions against interrupted clocks and failed I/O."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ble = (ROOT / 'firmware/src/BleController.cpp').read_text()


def cpp_test(name, content):
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / (name + '.cpp')
        source.write_text(content)
        binary = source.with_suffix('')
        subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                        str(source), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)


# Compile the exact production write function in MOCK_BLE mode. This keeps the
# 18 ms inter-write guard under direct rollover/preemption coverage without
# depending on any controller-specific BLE implementation details.
write = ble[ble.index('bool BleController::writeSlot('):ble.index('void BleController::writeReliableToTargets(')]
cpp_test('write_gap', r'''
#include <cstdint>
#include <cstddef>
#include <cassert>
#include <algorithm>
#include <iostream>
#define MOCK_BLE
uint32_t times[3],requestedDelay;unsigned clockRead=0;
uint32_t millis(){return times[std::min(clockRead++,2U)];}
void delay(uint32_t value){requestedDelay=value;}
class BleController{public:uint32_t lastWrite=100;bool slotConnected(uint8_t){return true;}bool writeSlot(uint8_t,const uint8_t*,size_t);};
''' + write + r'''
void check(uint32_t last,uint32_t before,uint32_t after,uint32_t expected){
 BleController b;b.lastWrite=last;times[0]=before;times[1]=after;times[2]=after;
 requestedDelay=0;clockRead=0;uint8_t value=0;b.writeSlot(0,&value,1);
 assert(requestedDelay==expected&&requestedDelay<=18);
}
int main(){
 check(100,117,119,1); // formerly requested UINT32_MAX milliseconds
 check(100,100,150,18);check(100,118,119,0);check(100,200,250,0);
 check(UINT32_MAX-10,5,19,2);
 std::cout<<"PASS: BLE output delay stays bounded across task preemption and clock rollover\n";
}
''')

# Keep this harness limited to the asynchronous connection state machine. The
# v3.1.9 reliability layer intentionally removed the temporary FFF4 diagnostics.
request_start = ble.index('bool BleController::requestConnection(')
request_end = ble.index('#endif\n\nbool BleController::selectAndConnect', request_start)
request = ble[request_start:request_end]
loop = ble[ble.index('void BleController::loop(){'):]
# The production source is size-compressed; split this statement in the synthetic
# -Werror harness so a formatting-only misleading-indentation warning cannot mask behavior.
loop = loop.replace('if(!connectTask)return;ConnectResult result{};', 'if(!connectTask)return;\n  ConnectResult result{};', 1)
cpp_test('connection_queue', r'''
#include <cstdint>
#include <string>
#include <cstring>
#include <cassert>
#include <iostream>
uint32_t tick=0;uint32_t millis(){return tick;}
constexpr int pdTRUE=1;
struct Text:std::string{using std::string::string;using std::string::operator=;void toCharArray(char* p,size_t n)const{assert(size()<n);std::strcpy(p,c_str());}};
struct Client{bool alive=true;};struct Characteristic{};
struct Request{char address[18];};struct Result{Client* client;Characteristic* chr;};
int requests=0,deleted=0;bool resultReady=false;Result nextResult{};
bool xQueueSend(int,const Request*,uint32_t wait){assert(wait==0);++requests;return true;}
bool xQueueReceive(int,Result* result,uint32_t wait){assert(wait==0);if(!resultReady)return false;*result=nextResult;resultReady=false;return true;}
struct NimBLEDevice{static void deleteClient(Client*){++deleted;}};
class BleController{
public:
 using ConnectRequest=Request;using ConnectResult=Result;
 struct Slot{Text address;uint32_t generation=0,nextConnectAt=0;Client* client=nullptr;Characteristic* chr=nullptr;}slots[2];
 int connectTask=1,connectRequests=1,connectResults=2;
 bool connectPending=false,activeValid=true,connectionChanged=false;
 uint8_t pendingSlot=0;uint32_t pendingGeneration=0,startedAt=0;
 bool slotConnected(uint8_t i){return slots[i].client&&slots[i].client->alive&&slots[i].chr;}
 void disconnectSlot(uint8_t i){slots[i].client=nullptr;slots[i].chr=nullptr;}
 bool requestConnection(uint8_t);void loop();
};
''' + request + loop + r'''
int main(){
 BleController b;b.slots[0].address="00:11:22:33:44:55";
 tick=1000;b.loop();assert(b.connectPending&&requests==1);
 tick=600000;b.loop();assert(tick==600000&&requests==1); // main loop never waits for worker
 resultReady=true;nextResult={nullptr,nullptr};b.loop();assert(!b.connectPending&&requests==1);
 tick=629999;b.loop();assert(requests==1);
 tick=630000;b.loop();assert(b.connectPending&&requests==2); // cooldown starts at completion
 Client client;Characteristic chr;nextResult={&client,&chr};resultReady=true;b.loop();
 assert(b.slotConnected(0)&&b.connectionChanged&&!b.activeValid);
 // Removing/replacing a selected device while it connects must discard its late result.
 b.slots[0].client=nullptr;tick=630001;b.loop();assert(b.connectPending&&requests==3);
 ++b.slots[0].generation;b.slots[0].address="";nextResult={&client,&chr};resultReady=true;b.loop();
 assert(!b.slotConnected(0)&&deleted==1&&!b.connectPending);
 // Two missing controllers are attempted serially, without starving either slot.
 b.slots[0].address="00:11:22:33:44:55";b.slots[1].address="00:11:22:33:44:66";
 b.slots[0].nextConnectAt=tick;b.loop();assert(b.pendingSlot==0&&requests==4);
 nextResult={nullptr,nullptr};resultReady=true;b.loop();assert(b.pendingSlot==1&&requests==5);
 nextResult={nullptr,nullptr};resultReady=true;b.loop();assert(!b.connectPending&&requests==5);
 // Cooldown crosses the 32-bit millis rollover.
 tick=UINT32_MAX-1000;b.slots[0].nextConnectAt=tick;b.loop();assert(b.connectPending);
 nextResult={nullptr,nullptr};resultReady=true;b.loop();b.slots[1].address="";
 int before=requests;tick=28998;b.loop();assert(requests==before);
 tick=28999;b.loop();assert(requests==before+1);
 std::cout<<"PASS: asynchronous BLE handoff, failed-device cooldown, cancellation, fairness, and rollover\n";
}
''')

html = (ROOT / 'firmware/web/index.html').read_text()
helper = html[html.index('async function controllerRequest('):html.index('/* ANDERSON_LOCKOUT_SAFE_PROFILE_GATE */')]
javascript = helper + r'''
const assert=require('node:assert/strict');
function stalled(signal){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}
(async()=>{
 global.fetch=(_,options)=>stalled(options.signal);
 await assert.rejects(controllerRequest('/test',{},5),/timed out/);
 global.fetch=async(_,options)=>({ok:true,text:()=>stalled(options.signal)});
 await assert.rejects(controllerRequest('/test',{},5),/timed out/); // headers arrived, body stalled
 global.fetch=async()=>({ok:true,text:async()=>'{"ok":true}'});
 const result=await controllerRequest('/test',{},50);assert.equal(JSON.parse(result.text).ok,true);
 console.log('PASS: timed-out requests and stalled bodies release the UI for a successful retry');
})().catch(error=>{console.error(error);process.exitCode=1});
'''
subprocess.run(['node'], input=javascript, text=True, check=True)
