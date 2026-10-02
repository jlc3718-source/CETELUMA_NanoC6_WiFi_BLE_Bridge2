"""Exercise actual profile/request code and pre-UI OTA/OFF paths."""
from pathlib import Path
import argparse
import re
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'firmware/web/index.html').read_text()
main=(ROOT/'firmware/src/main.cpp').read_text()
remote=(ROOT/'firmware/src/RemoteUpdate.cpp').read_text()
ble=(ROOT/'firmware/src/BleController.cpp').read_text()

def between(source,start,end):
    a=source.index(start)
    return source[a:source.index(end,a)]

gate=re.findall(r'<script>(.*?)</script>',html,re.S)[0]
api=between(html,'async function api(','window.addEventListener("anderson-profile-selected"')
commands=between(html,'let manualCommandSequence=','async function loadLoginPreviewState(')
state=between(html,'let stateRequest=null;','function overlapHelp()')

js=r'''
const assert=require('node:assert/strict'),vm=require('node:vm');
class CustomEvent extends Event{constructor(name,options={}){super(name);this.detail=options.detail;}}
class Node{
 constructor(){this.listeners=new Map();this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}
 addEventListener(name,fn){this.listeners.set(name,fn)}
 removeAttribute(name){if(name==='data-profile')delete this.dataset.profile}
 focus(){}
 fire(name){return this.listeners.get(name)?.({preventDefault(){}})}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
const choices=['shirley','kelly','jason'].map(id=>{const node=new Node();node.dataset.profile=id;return node});
const document={body:new Node(),getElementById:get,querySelectorAll:selector=>selector==='.profileChoice'||selector==='[data-profile]'?choices:[],addEventListener(name,fn){if(name==='DOMContentLoaded')this.ready=fn}};
const window=new EventTarget(),unlocks=[],requests=[],logouts=[],cancelled=[];
let cleared=0;window.addEventListener('anderson-profile-cleared',()=>++cleared);
function response(data,status=200){return {ok:status>=200&&status<300,status,statusText:String(status),text:async()=>JSON.stringify(data)}}
function pending(list,url,options){return new Promise(resolve=>list.push({url,options,resolve}))}
const context=vm.createContext({window,document,Event,CustomEvent,Headers,AbortController,location:{protocol:'http:'},console,setTimeout,clearTimeout:id=>{cancelled.push(id);clearTimeout(id)},Promise,fetch:async(url,options)=>{
 if(url.startsWith('/api/auth/status'))return response({pinEnabled:true,kellyConfigured:true});
 if(url==='/api/auth/unlock')return pending(unlocks,url,options);
 if(url==='/api/auth/logout'){logouts.push(options.headers['X-Anderson-Session']);return response({},204)}
 return pending(requests,url,options);
}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const choose=id=>choices.find(node=>node.dataset.profile===id).fire('click');
async function login(id,token){choose(id);get('profilePin').value='1234';const task=get('profilePinForm').fire('submit');const request=unlocks.shift();assert.equal(JSON.parse(request.options.body).profile,id);request.resolve(response({pinEnabled:true,token,role:id==='jason'?'admin':'user'}));await task;return task}
(async()=>{
 vm.runInContext(GATE,context);document.ready();await flush();
 choose('jason');get('profilePin').value='1234';const cancelledLogin=get('profilePinForm').fire('submit');
 const old=unlocks.shift();get('cancelProfilePin').fire('click');choose('kelly');
 old.resolve(response({pinEnabled:true,token:'cancelled-token',role:'admin'}));await cancelledLogin;await flush();
 assert.equal(window.andersonProfile,undefined);assert(logouts.includes('cancelled-token'));assert.equal(get('profilePinForm').hidden,false);
 await login('kelly','current-token');assert.equal(window.andersonProfile.id,'kelly');
 vm.runInContext('let currentRole="user";const API_MODE=true;const $=id=>document.getElementById(id);let applied=[],messages=[];const applyState=s=>applied.push(s);const status=s=>messages.push(s);const loadFavorites=()=>{};let speedSyncTimer=101,pendingSpeed=3,builderWheelTimer=102,liveTuneTimer=103,liveTuneQueued=true;',context);
 vm.runInContext(API+COMMANDS+STATE,context);
 const before=cleared,oldRequest=context.api('/stale');const stale=requests.shift();
 await login('jason','fresh-token');stale.resolve(response({error:'A valid profile PIN is required'},401));
 await assert.rejects(oldRequest,error=>error.staleSession===true);assert.equal(cleared,before);assert.equal(window.andersonAuthToken,'fresh-token');
 // Epoch changes also invalidate requests when PIN protection is off/token unchanged.
 const sameToken=context.api('/same-token'),same=requests.shift();++window.andersonAuthEpoch;same.resolve(response({ok:true}));
 await assert.rejects(sameToken,error=>error.staleSession===true);
 const first=context.manual({power:true,colors:['#0000FF']});await flush();const inFlight=requests.shift();
 const second=context.manual({power:true,colors:['#FF0000']});const off=context.manual({power:false});
 assert(cancelled.includes(101)&&cancelled.includes(102)&&cancelled.includes(103));assert.equal(vm.runInContext('liveTuneQueued',context),false);
 inFlight.resolve(response({power:true,name:'old blue'}));await flush();const latest=requests.shift();
 assert.equal(latest.url,'/api/control');assert.deepEqual(JSON.parse(latest.options.body),{power:false});latest.resolve(response({power:false}));
 await Promise.all([first,second,off]);assert.deepEqual(Array.from(vm.runInContext('applied',context),s=>s.power),[false]);assert.equal(requests.length,0);
 // An old state request cannot suppress the fresh request or clear its promise.
 const oldState=context.loadState(),oldStateResponse=requests.shift();
 ++window.andersonAuthEpoch;window.andersonAuthToken='newer-token';vm.runInContext('stateRequest=null',context);
 const freshState=context.loadState(),freshStateResponse=requests.shift();assert.notEqual(freshState,oldState);
 oldStateResponse.resolve(response({power:true,name:'stale state'}));await oldState;
 assert.equal(vm.runInContext('stateRequest',context),freshState);
 freshStateResponse.resolve(response({power:false,name:'fresh state'}));await freshState;
 assert.equal(vm.runInContext('applied.at(-1).name',context),'fresh state');
 const freshUnauthorized=context.api('/expired'),expired=requests.shift();expired.resolve(response({error:'A valid profile PIN is required'},401));
 await assert.rejects(freshUnauthorized,/valid profile PIN/);assert.equal(cleared,before+1);assert.equal(window.andersonAuthToken,'');
 console.log('PASS: cancelled PIN responses, stale 401/success responses, fresh-session expiry, OFF command ordering, cancelled preview timers, and state-request replacement');
})().catch(error=>{console.error(error);process.exitCode=1});
'''
js=js.replace('GATE',repr(gate)).replace('API+COMMANDS+STATE',repr(api+commands+state))
subprocess.run(['node'],input=js,text=True,check=True)

setup=between(main,'void setup(){','void loop(){')
assert setup.index('remoteUpdateBootCheck(')<setup.index('eventStateBegin()')<setup.index('ble.begin(')
assert setup.index('remoteUpdateNoteBoot(')<setup.index('remoteUpdateBootCheck(')
assert setup.index('if(bootRecoveryMode)')<setup.index('eventStateBegin()')
assert 'server.handleClient();feedControllerWatchdog();' in setup
assert 'if(bootFirmwareCheckPending||bootRecoveryMode)' in main
assert 'bootRecoveryMode=attempts>=3' in main and 'BOOT_HEALTHY_GRACE_MS=120UL*1000UL' in main
calendar=(ROOT/'firmware/web/night_calendar.js').read_text()
assert 'anderson-auth-required' not in calendar
assert 'if(!window.andersonProfile)return;' in calendar
assert 'anderson-profile-selected' in calendar and 'error?.staleSession' in calendar
print('PASS: pre-BLE/UI boot ordering, minimal recovery/status routes, repeated-boot recovery, and single auth-expiry owner')

args=argparse.ArgumentParser();args.add_argument('--javascript-only',action='store_true');opts=args.parse_args()
if opts.javascript_only:raise SystemExit(0)

boot=between(remote,'bool remoteUpdateBootCheck(','bool remoteUpdateConsumeRebootRequest(')
off=between(ble,'void BleController::setPower(','void BleController::setColor(')
cpp=r'''
#include <cstdint>
#include <cstddef>
#include <atomic>
#include <cassert>
#include <iostream>
constexpr int WL_CONNECTED=3,OWNER_NONE=0,OWNER_REMOTE=1,JOB_AUTO=3;
struct {int state=WL_CONNECTED;int status(){return state;}} WiFi;
std::atomic<int> operationOwner{OWNER_NONE};std::atomic<bool> rebootRequested{false};bool autoTimerStarted=false;
int scenario=0,queued=0,ticks=0,idles=0;
void queueJob(int kind,const char*){assert(kind==JOB_AUTO);++queued;ticks=0;operationOwner=scenario==0?OWNER_NONE:OWNER_REMOTE;}
int pdMS_TO_TICKS(int v){return v;}
void vTaskDelay(int v){assert(v==20);if(++ticks==3){if(scenario==2)rebootRequested=true;else operationOwner=OWNER_NONE;}}
void idle(){++idles;}
class BleController{
 public:
 struct Frame{bool pending=false;};struct Slot{Frame power,brightness,color;unsigned generation=0;}slots[2];
 int target=0;bool activeValid=true;uint8_t lastFrame[9]{};
 bool slotTargeted(uint8_t i){return target==0||target==i+1;}
 void clearPending(uint8_t i){slots[i].power={};slots[i].brightness={};slots[i].color={};++slots[i].generation;}
 void enqueueToTargets(int kind,const uint8_t* frame,size_t len,bool reliable){assert(kind==0&&len==9&&reliable);for(int i=0;i<9;++i)lastFrame[i]=frame[i];for(uint8_t i=0;i<2;++i)if(slotTargeted(i))slots[i].power.pending=true;}
 void setPower(bool on);
};
'''
tests=r'''
int main(){
 WiFi.state=0;assert(!remoteUpdateBootCheck("3.1.65",idle)&&queued==0);WiFi.state=WL_CONNECTED;
 scenario=0;assert(!remoteUpdateBootCheck("3.1.65",idle)&&queued==1&&idles==0&&autoTimerStarted);
 scenario=1;assert(!remoteUpdateBootCheck("3.1.65",idle)&&ticks==3&&idles==3);
 scenario=2;assert(remoteUpdateBootCheck("3.1.65",idle)&&ticks==3&&idles==6&&operationOwner==OWNER_REMOTE);
 BleController controller;for(auto& slot:controller.slots){slot.power.pending=slot.brightness.pending=slot.color.pending=true;}
 controller.setPower(false);assert(!controller.activeValid&&controller.lastFrame[3]==0&&controller.lastFrame[5]==0);
 for(auto& slot:controller.slots)assert(slot.power.pending&&!slot.brightness.pending&&!slot.color.pending&&slot.generation==1);
 controller.target=1;controller.activeValid=true;controller.slots[1].brightness.pending=controller.slots[1].color.pending=true;
 controller.setPower(false);assert(!controller.slots[0].brightness.pending&&!controller.slots[0].color.pending);
 assert(controller.slots[1].brightness.pending&&controller.slots[1].color.pending&&controller.slots[1].generation==1);
 controller.setPower(true);assert(controller.lastFrame[3]==0xF0&&controller.lastFrame[5]==1);
 std::cout<<"PASS: actual boot-check failure/current/install paths feed the idle callback; OFF clears targeted old frames and preserves untargeted controllers\n";
}
'''
with tempfile.TemporaryDirectory() as directory:
    source=Path(directory)/'boot-off.cpp';source.write_text(cpp+boot+off+tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(source),'-o',str(source.with_suffix(''))],check=True)
    subprocess.run([str(source.with_suffix(''))],check=True)
