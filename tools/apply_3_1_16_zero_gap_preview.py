#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
cpp=ROOT/'firmware/src/BleController.cpp'
hdr=ROOT/'firmware/include/BleController.h'
main=ROOT/'firmware/src/main.cpp'
html=ROOT/'firmware/web/index.html'
test=ROOT/'tools/test_connection_recovery.py'

# 1) BLE: zero intentional inter-controller pacing and service A+B in the same pass.
c=cpp.read_text()
c=c.replace('static constexpr uint32_t WRITE_GAP_MS=18UL;\n','',1)
c=c.replace('bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;slots[i].lastWriteAt=millis();',
'''bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;''',1)
old='''void BleController::servicePendingWrites(uint32_t now){for(uint8_t pass=0;pass<2;pass++){uint8_t i=(uint8_t)((nextServiceSlot+pass)%2);if(!slotConnected(i)){clearPending(i);continue;}if((uint32_t)(now-slots[i].lastWriteAt)<WRITE_GAP_MS)continue;PendingFrame* choices[3]={&slots[i].power,&slots[i].brightness,&slots[i].color};for(auto* p:choices){if(!p->pending||(int32_t)(now-p->dueAt)<0)continue;uint32_t generation=p->generation;bool ok=writeSlot(i,p->data,p->len);if(!p->pending||p->generation!=generation)return;if(ok){p->failures=0;if(p->sendsRemaining>0)--p->sendsRemaining;if(!p->sendsRemaining)p->pending=false;else p->dueAt=millis()+RELIABLE_RETRY_DELAY_MS;}else{if(p->failures<255)++p->failures;p->dueAt=millis()+failureRetryMs(p->failures);}nextServiceSlot=(uint8_t)((i+1)%2);return;}}}'''
new='''void BleController::servicePendingWrites(uint32_t now){bool serviced=false;for(uint8_t pass=0;pass<2;pass++){uint8_t i=(uint8_t)((nextServiceSlot+pass)%2);if(!slotConnected(i)){clearPending(i);continue;}PendingFrame* choices[3]={&slots[i].power,&slots[i].brightness,&slots[i].color};for(auto* p:choices){if(!p->pending||(int32_t)(now-p->dueAt)<0)continue;uint32_t generation=p->generation;bool ok=writeSlot(i,p->data,p->len);if(!p->pending||p->generation!=generation)break;if(ok){p->failures=0;if(p->sendsRemaining>0)--p->sendsRemaining;if(!p->sendsRemaining)p->pending=false;else p->dueAt=millis()+RELIABLE_RETRY_DELAY_MS;}else{if(p->failures<255)++p->failures;p->dueAt=millis()+failureRetryMs(p->failures);}serviced=true;break;}}if(serviced)nextServiceSlot=(uint8_t)((nextServiceSlot+1)%2);}'''
if old not in c: raise SystemExit('3.1.15 servicePendingWrites baseline not found')
c=c.replace(old,new,1)
cpp.write_text(c)

h=hdr.read_text()
oldh='uint32_t generation=0,nextConnectAt=0,commandGeneration=0,lastWriteAt=0;'
if oldh not in h: raise SystemExit('3.1.15 lastWriteAt field not found')
h=h.replace(oldh,'uint32_t generation=0,nextConnectAt=0,commandGeneration=0;',1)
hdr.write_text(h)

# 2) Schedule 2: fixed brightness from 30% to 10%, including API/status text.
m=main.read_text()
for old,newv in [
    ('cfg["schedule2Brightness"]=30;','cfg["schedule2Brightness"]=10;'),
    (' at 30%";',' at 10%";'),
    (' - dawn at 30%";',' - dawn at 10%";'),
    ('if(schedule2Active&&!schedule1Active)brightness=30;','if(schedule2Active&&!schedule1Active)brightness=10;')
]:
    if old not in m: raise SystemExit(f'main schedule-2 baseline not found: {old}')
    m=m.replace(old,newv,1)
main.write_text(m)

# 3) Live Preview: approved preset colors; selecting one also moves wheel marker/value.
x=html.read_text()
x=x.replace('same scheduled scene at 30% brightness','same scheduled scene at 10% brightness',1)
x=x.replace('30% from Schedule 1 end until dawn','10% from Schedule 1 end until dawn',1)
x=x.replace('Starts at Schedule 1 end • 30% • ends at dawn','Starts at Schedule 1 end • 10% • ends at dawn',1)
x=x.replace("s.settings.schedule2Brightness||30","s.settings.schedule2Brightness??10",1)
needle='''      <div id="liveColorPreview" class="liveColorPreview" style="background:#FFFFFF"></div>\n      <div class="label row between"><span>RGB value</span><span id="liveColorValueText" class="muted">100%</span></div>'''
replacement='''      <div id="liveColorPreview" class="liveColorPreview" style="background:#FFFFFF"></div>\n      <div class="label">Preset colors</div><div id="liveColorPresets" class="savedColorGrid"></div>\n      <div class="label row between"><span>RGB value</span><span id="liveColorValueText" class="muted">100%</span></div>'''
if needle not in x: raise SystemExit('live preview HTML insertion point not found')
x=x.replace(needle,replacement,1)
old_js='''let liveTuneH=0,liveTuneS=0,liveTuneV=1,liveTuneTimer=null,liveTuneSending=false,liveTuneQueued=false;\nfunction liveTuneHex(){const q=hsvRgb(liveTuneH,liveTuneS,liveTuneV);return rgbHex(q[0],q[1],q[2])}'''
new_js='''const LIVE_COLOR_PRESETS=[['Red','#FF0000'],['Orange','#FF0D00'],['Pink','#FF0024'],['Yellow','#E0B400'],['Green','#28FF00'],['Blue','#0D00FF'],['Purple','#5B00E6'],['White','#FFFFFA'],['Navy Blue','#001478']];\nlet liveTuneH=0,liveTuneS=0,liveTuneV=1,liveTuneTimer=null,liveTuneSending=false,liveTuneQueued=false;\nfunction liveTuneHex(){const q=hsvRgb(liveTuneH,liveTuneS,liveTuneV);return rgbHex(q[0],q[1],q[2])}\nfunction setLiveTuneHex(hex,sendLive=true){const q=hexRgb(hex),v=rgbHsv(q[0],q[1],q[2]);liveTuneH=v[0];liveTuneS=v[1];liveTuneV=v[2];renderLiveColorTune(sendLive)}\nfunction renderLiveColorPresets(){const g=$('liveColorPresets');if(!g)return;g.replaceChildren();LIVE_COLOR_PRESETS.forEach(([name,hex])=>{const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=hex;b.style.color=(name==='White'||name==='Yellow'||name==='Green')?'#06111d':'#FFFFFF';b.textContent=name;b.title=name+' '+hex;b.setAttribute('aria-label','Preview '+name+' '+hex);b.addEventListener('click',()=>setLiveTuneHex(hex,true));g.appendChild(b)})}'''
if old_js not in x: raise SystemExit('live preview JS baseline not found')
x=x.replace(old_js,new_js,1)
old_bind="function bindLiveColorTuner(){const w=$('liveColorWheel');if(!w)return;let drag=false;"
new_bind="function bindLiveColorTuner(){const w=$('liveColorWheel');if(!w)return;renderLiveColorPresets();let drag=false;"
if old_bind not in x: raise SystemExit('bindLiveColorTuner baseline not found')
x=x.replace(old_bind,new_bind,1)
html.write_text(x)

# Update focused regression checks.
t=test.read_text()
old_assert="assert 'WRITE_GAP_MS=18UL' in ble and '(uint32_t)(now-slots[i].lastWriteAt)<WRITE_GAP_MS' in ble\nassert 'lastWrite=0' not in hdr"
new_assert="assert 'WRITE_GAP_MS' not in ble and 'lastWriteAt' not in ble and 'lastWriteAt' not in hdr\nassert 'bool serviced=false' in ble and 'serviced=true;break;' in ble\nassert 'if(serviced)nextServiceSlot=' in ble"
if old_assert not in t: raise SystemExit('3.1.15 sync regression baseline not found')
t=t.replace(old_assert,new_assert,1)
t=t.replace('PASS: BLE delivery uses per-controller pacing, back-to-back dual-controller dispatch, no-response fast writes where supported, and retry/convergence semantics',
            'PASS: BLE delivery has zero intentional A/B write gap, services both controllers in one pass, uses no-response fast writes where supported, and preserves retry/convergence semantics',1)
test.write_text(t)

# Bump 3.1.15 -> 3.1.16 after source edits.
subprocess.run(['python','tools/release.py','bump'],cwd=ROOT,check=True)
(ROOT/'firmware/RELEASE_NOTES_v3.1.16.md').write_text('''# Anderson Home v3.1.16\n\n- Removes the 18 ms BLE write gap entirely.\n- Services controller A and controller B in the same BLE service pass with no intentional firmware delay between paired frames.\n- Keeps no-response fast writes plus retry/reassert convergence behavior.\n- Changes Schedule 2 brightness from 30% to 10%.\n- Adds approved preset colors to Live Preview; tapping a preset moves the wheel marker/value to that exact color and previews it on the lights.\n''')
print('Applied Anderson Home v3.1.16 zero-gap + schedule2 + live-preview presets')
