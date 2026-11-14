#!/usr/bin/env python3
"""Run the actual WLED state machine/payload/parser and connection UI on the host."""
import argparse
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--arduinojson', type=Path)
parser.add_argument('--require-protocol', action='store_true')
args = parser.parse_args()
include = args.arduinojson or ROOT / 'firmware/.pio/libdeps/m5stack-nanoc6/ArduinoJson/src'

with tempfile.TemporaryDirectory(prefix='anderson-wled-test-') as directory:
    folder = Path(directory)
    source = folder / 'wled.cpp'
    source.write_text(r'''
#include "WledState.h"
#include <cassert>
#include <string>
#include <iostream>
#ifdef TEST_PROTOCOL
#include "WledProtocol.h"
#endif
int main(){
 for(const char* h:{"192.168.68.51","10.0.0.2","172.16.0.2","house.local","wled-garage"})assert(validWledHost(h));
 for(const char* h:{"","http://192.168.68.1","host/path","host:80","user@host","host?x=1","host#x","x\r\nX: x",".local","a..b","a.","-a.local","a-.local","999.1.1.1","0.0.0.0","127.0.0.1","224.1.1.1","192.168.1"})assert(!validWledHost(h));
 assert(!validWledHost(std::string(64,'a').c_str()));
 WledDeliveryState a,b;
 assert(!a.enabled&&!a.ready&&!a.needsProbe(0)&&!a.needsWrite(0));
 a.configure(true,"192.168.68.51",0);b.configure(true,"192.168.68.52",0);
 assert(a.needsProbe(0)&&b.needsProbe(0)&&!a.needsWrite(0));
 a.power(true);a.color(0xFF0000);a.brightness(50);
 assert(a.desired.on&&a.desired.color==0xFF0000&&a.desired.brightness==128);
 assert(!b.ready);a.success(1,true);assert(a.needsWrite(1));
 const auto red=a.revision;
 a.color(0x0000FF);a.brightness(25);a.power(false);
 a.success(2,false,red);assert(!a.needsWrite(56)&&a.needsWrite(57));
 assert(!a.desired.on&&a.desired.color==0x0000FF&&a.desired.brightness==64);
 const auto off=a.revision;a.success(60,false,off);assert(!a.needsWrite(120));
 // A lost controller retains the newest complete state; B has independent delivery.
 a.failure(100);assert(!a.online&&!a.needsProbe(1099)&&a.needsProbe(1100));
 a.power(true);a.color(0x12AB34);a.brightness(100);
 assert(!a.needsWrite(200));b.power(false);b.success(201,true);assert(b.needsWrite(201));
 b.success(202,false,b.revision);assert(!b.desired.on&&!b.needsWrite(1000));
 a.success(1101,true);assert(a.needsWrite(1101)&&a.desired.on&&a.desired.color==0x12AB34);
 a.success(1102,false,a.revision);assert(!a.needsWrite(1200));
 auto generation=a.generation;a.configure(true,"garage.local",1201);
 assert(!a.accept(generation)&&a.accept(generation+1)&&!a.online&&a.needsProbe(1201));
 a.configure(false,"garage.local",1202);assert(!a.accept(generation+1)&&!a.needsProbe(50000)&&!a.needsWrite(50000));
 a.configure(true,"garage.local",0);a.failure(0);a.failure(1000);a.failure(3000);a.failure(7000);a.failure(15000);
 assert(a.nextAttempt==30000);a.failure(30000);assert(a.nextAttempt==45000);
 a.retry(UINT32_MAX-20);assert(a.needsProbe(UINT32_MAX-20));a.failure(UINT32_MAX-20);
 assert(!a.needsProbe(978)&&a.needsProbe(979));
 a.success(UINT32_MAX-10,true);a.success(UINT32_MAX-10,false,a.revision);
 a.color(0xFF00FF);assert(!a.needsWrite(43)&&a.needsWrite(44));
 // Repeated effect frames collapse into the latest revision instead of forming a backlog.
 auto previous=a.revision;for(unsigned i=0;i<10000;i++)a.color(i);
 assert(a.desired.color==9999&&a.revision==previous+10000);
 a.power(false);assert(!a.desired.on);a.color(0xFFFFFF);assert(!a.desired.on);
 a.brightness(0);assert(a.desired.brightness==0);
 char payload[4608];uint8_t ids[]={0,3};
 assert(buildWledStateJson(payload,sizeof(payload),a.desired,ids,2));
 const std::string json=payload;assert(json.find("\"on\":false")!=std::string::npos);
 assert(json.find("\"id\":0")!=std::string::npos&&json.find("\"id\":3")!=std::string::npos);
 assert(json.find("\"col\":[[255,255,255]")!=std::string::npos);
 assert(json.find("\"tt\":0")!=std::string::npos);
 for(const char* key:{"\"start\"","\"stop\"","\"cfg\"","\"leds\"","\"psave\"","\"rb\""})assert(json.find(key)==std::string::npos);
 uint8_t many[32];for(unsigned i=0;i<32;i++)many[i]=i;
 assert(buildWledStateJson(payload,sizeof(payload),a.desired,many,32));
 assert(!buildWledStateJson(payload,20,a.desired,ids,2));
 assert(!buildWledStateJson(payload,sizeof(payload),a.desired,ids,0));
#ifdef TEST_PROTOCOL
 const char* response=R"({"info":{"brand":"WLED","ver":"0.15.0","name":"House","leds":{"count":200}},"state":{"on":true,"seg":[{"id":0,"start":0,"stop":100},{"id":3,"start":100,"stop":200}]}})";
 WledPeerInfo peer;assert(parseWledPeer(response,strlen(response),peer));
 assert(peer.pixels==200&&peer.segmentCount==2&&peer.segments[1]==3&&std::string(peer.name)=="House");
 for(const char* bad:{"{}","null","[]","{","<html>router login</html>",R"({"info":{"brand":"Other","ver":"1","leds":{"count":100}},"state":{"seg":[]}})",R"({"info":{"brand":"WLED","ver":"1","leds":{"count":100}},"state":{"seg":[{"id":0,"start":0,"stop":101}]}})",R"({"info":{"brand":"WLED","ver":"1","leds":{"count":100}},"state":{"seg":[{"id":0,"start":0,"stop":50},{"id":0,"start":50,"stop":100}]}})"})assert(!parseWledPeer(bad,strlen(bad),peer));
 const char* ack="{\"success\":true}";assert(parseWledAck(ack,strlen(ack)));
 for(const char* bad:{"{}","[]","true","{\"success\":false}","{\"success\":1}","{\"success\":\"true\"}"})assert(!parseWledAck(bad,strlen(bad)));
 assert(buildWledStateJson(payload,sizeof(payload),a.desired,ids,2));
 JsonDocument sent;assert(!deserializeJson(sent,payload));assert(sent["on"].as<bool>()==false);
 assert(sent["seg"].size()==2&&sent["seg"][1]["id"].as<int>()==3);
 assert(sent["seg"][0]["fx"].as<int>()==0&&sent["seg"][0]["bri"].as<int>()==255);
 std::cout<<"PASS: real ArduinoJson WLED peer validation, segment coverage, payloads and acknowledgements\n";
#endif
 std::cout<<"PASS: real WLED state machine: defaults, independent slots, coalescing, OFF priority, stale replies, reconnection, backoff and clock rollover\n";
}
''')
    command = ['g++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-I'+str(ROOT/'firmware/include')]
    if (include/'ArduinoJson.h').exists():
        command += ['-DTEST_PROTOCOL=1', '-I'+str(include)]
    elif args.require_protocol:
        raise SystemExit('ArduinoJson headers required for the protocol regression')
    subprocess.run([*command, str(source), '-o', str(folder/'wled')], check=True)
    subprocess.run([str(folder/'wled')], check=True)

# Exercise the actual panel router: renamed controller headings must stay in tab 6.
layout = (ROOT/'firmware/web/v3_mockup.js').read_text()
routing = layout.split('n.forEach(e=>i.get((', 1)[1].split(')(e)).appendChild(e))', 1)[0]
import json
settings = layout.split('function settingsSubTabs(){', 1)[1]
tabs = json.loads(settings.split(',s=', 1)[1].split(',o=el(', 1)[0])
assert tabs[5] == ['controllers', 'Controllers'], tabs
subprocess.run(['node'], input='const assert=require("node:assert/strict");const q=(_,node)=>({textContent:node.heading||""});const route='+routing+';'+r'''
const panel=(id,heading)=>({id,heading,classList:{contains:()=>false}});
assert.equal(route(panel('v3Controllers','Light Controllers')),'controllers');
assert.equal(route(panel('v3Controllers','House and Garage')),'controllers');
assert.equal(route(panel('systemMonitorPanel','System Monitor')),'general');
assert.equal(route(panel('liveColorTunerPanel','Live Color Tuning')),'preview');
console.log('PASS: Bluetooth and WLED setup route to Settings tab 6 using stable panel identity');
''', text=True, check=True)

html = (ROOT/'firmware/web/index.html').read_text()
javascript = html.split('// ANDERSON_WLED_CONNECTIONS:', 1)[1].split('function applyState(', 1)[0]
javascript = '// ANDERSON_WLED_CONNECTIONS:' + javascript
subprocess.run(['node'], input=r'''
const assert=require('node:assert/strict');
const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,textContent:'',events:{},addEventListener(event,fn){this.events[event]=fn;}});return nodes.get(id);};
const window={andersonAuthEpoch:1,addEventListener(){}};
let posts=[],fail=false,applied=0,messages=[];
const status=message=>messages.push(message);const loadState=async()=>{};
const applyState=state=>{applied++;applyWledSetupState(state.wled)};
const post=async(url,body)=>{posts.push({url,body});if(fail)throw new Error('storage unavailable');return {wled:[{slot:body.slot,enabled:body.enabled,host:body.host}]};};
'''+javascript+r'''
(async()=>{
 applyWledSetupState([{slot:0,enabled:false,host:'',name:'House'},{slot:1,enabled:false,host:'',name:'Garage'}]);
 assert.equal($('wledMode0').value,'ble');assert.equal($('wledHost0').value,'');assert.equal($('retryWled0').disabled,true);
 $('wledHost0').value='192.168.68.51';$('wledHost0').events.input();$('wledMode0').value='wled';
 applyWledSetupState([{slot:0,enabled:false,host:''}]);assert.equal($('wledHost0').value,'192.168.68.51');assert.equal($('wledMode0').value,'wled');
 await $('saveWled0').events.click();assert.deepEqual(posts.at(-1),{url:'/api/wled/config',body:{slot:0,enabled:true,host:'192.168.68.51'}});assert.equal(applied,1);
 assert.equal($('wledMode1').value,'ble');
 applyWledSetupState([{slot:0,enabled:true,host:'192.168.68.51',connected:true,version:'0.15.0',pixels:200,lastCommandSeconds:2}]);
 assert.match($('wledStatus0').textContent,/acknowledged 2s ago/);
 $('wledHost1').value='';$('wledMode1').value='wled';let count=posts.length;
 await $('saveWled1').events.click();assert.equal(posts.length,count);assert.equal($('saveWled1').disabled,false);
 $('wledHost1').value='192.168.68.52';$('wledHost1').events.input();fail=true;
 await $('saveWled1').events.click();applyWledSetupState([{slot:1,enabled:false,host:''}]);
 assert.equal($('wledHost1').value,'192.168.68.52');assert.equal($('saveWled1').disabled,false);assert.match(messages.at(-1),/storage unavailable/);
 console.log('PASS: actual WLED connection UI preserves edits, defaults to BLE, saves explicit assignments and recovers from failed saves');
})().catch(error=>{console.error(error);process.exitCode=1});
''', text=True, check=True)

store = (ROOT/'firmware/src/SettingsStore.cpp').read_text()
main = (ROOT/'firmware/src/main.cpp').read_text()
wled_save = store.split('bool SettingsStore::saveWled(', 1)[1].split('bool SettingsStore::saveAll(', 1)[0]
assert '"wledcfg"' in wled_save and '"bleaddr"' not in wled_save and '"blename"' not in wled_save
for field in ('wledHost1','wledHost2','wledEnabled1','wledEnabled2'):
    assert main.count('x["'+field+'"]') >= 2, field
for route in ('config','retry'):
    endpoint = main.split('server.on("/api/wled/'+route+'"', 1)[1].split('\n  });', 1)[0]
    assert 'requireAdmin()' in endpoint
print('PASS: separate WLED persistence, backward-compatible backup fields and admin-only setup')
