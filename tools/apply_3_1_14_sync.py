#!/usr/bin/env python3
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
cpp=ROOT/'firmware/src/BleController.cpp'
hdr=ROOT/'firmware/include/BleController.h'
test=ROOT/'tools/test_connection_recovery.py'

c=cpp.read_text()
old='''bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i)||(uint32_t)(millis()-lastWrite)<WRITE_GAP_MS)return false;lastWrite=millis();\n#ifdef MOCK_BLE\n  (void)data;(void)len;return true;\n#else\n  const bool requestAck=slots[i].chr&&slots[i].chr->canWrite();return slots[i].chr->writeValue(data,len,requestAck);\n#endif\n}'''
new='''bool BleController::writeSlot(uint8_t i,const uint8_t* data,size_t len){if(!slotConnected(i))return false;slots[i].lastWriteAt=millis();\n#ifdef MOCK_BLE\n  (void)data;(void)len;return true;\n#else\n  auto* chr=slots[i].chr;if(!chr)return false;const bool canNoResponse=chr->canWriteNoResponse(),canResponse=chr->canWrite();if(!canNoResponse&&!canResponse)return false;const bool requestAck=!canNoResponse;return chr->writeValue(data,len,requestAck);\n#endif\n}'''
if old not in c: raise SystemExit('writeSlot baseline not found')
c=c.replace(old,new,1)
old2='''void BleController::servicePendingWrites(uint32_t now){if((uint32_t)(now-lastWrite)<WRITE_GAP_MS)return;for(uint8_t pass=0;pass<2;pass++){uint8_t i=(uint8_t)((nextServiceSlot+pass)%2);if(!slotConnected(i)){clearPending(i);continue;}PendingFrame* choices[3]={&slots[i].power,&slots[i].brightness,&slots[i].color};'''
new2='''void BleController::servicePendingWrites(uint32_t now){for(uint8_t pass=0;pass<2;pass++){uint8_t i=(uint8_t)((nextServiceSlot+pass)%2);if(!slotConnected(i)){clearPending(i);continue;}if((uint32_t)(now-slots[i].lastWriteAt)<WRITE_GAP_MS)continue;PendingFrame* choices[3]={&slots[i].power,&slots[i].brightness,&slots[i].color};'''
if old2 not in c: raise SystemExit('servicePendingWrites baseline not found')
c=c.replace(old2,new2,1)
cpp.write_text(c)

h=hdr.read_text()
oldh='''    uint32_t generation=0,nextConnectAt=0,commandGeneration=0;'''
newh='''    uint32_t generation=0,nextConnectAt=0,commandGeneration=0,lastWriteAt=0;'''
if oldh not in h: raise SystemExit('Slot timing baseline not found')
h=h.replace(oldh,newh,1)
oldh2='''  uint32_t lastWrite=0,lastEffect=0,lastStaticReassert=0,lastControlReassert=0;'''
newh2='''  uint32_t lastEffect=0,lastStaticReassert=0,lastControlReassert=0;'''
if oldh2 not in h: raise SystemExit('global write timer baseline not found')
h=h.replace(oldh2,newh2,1)
hdr.write_text(h)

t=test.read_text()
oldt="assert 'WRITE_GAP_MS=18UL' in ble and '(uint32_t)(now-lastWrite)<WRITE_GAP_MS' in ble"
newt="assert 'WRITE_GAP_MS=18UL' in ble and '(uint32_t)(now-slots[i].lastWriteAt)<WRITE_GAP_MS' in ble\nassert 'lastWrite=0' not in hdr\nassert 'canWriteNoResponse()' in ble and 'const bool requestAck=!canNoResponse' in ble"
if oldt not in t: raise SystemExit('BLE regression timing assertion baseline not found')
t=t.replace(oldt,newt,1)
t=t.replace("PASS: BLE delivery uses a bounded nonblocking superseding queue with retry/convergence semantics and synchronized software-effect frames","PASS: BLE delivery uses per-controller pacing, back-to-back dual-controller dispatch, no-response fast writes where supported, and retry/convergence semantics")
test.write_text(t)

subprocess.run(['python','tools/release.py','bump'],cwd=ROOT,check=True)
(ROOT/'firmware/RELEASE_NOTES_v3.1.14.md').write_text('''# Anderson Home v3.1.14\n\n- Removes the shared BLE write timer that forced controller B to trail controller A.\n- Preserves the 18 ms safety gap independently on each controller.\n- Prefers BLE write-without-response when supported so paired commands can be queued back-to-back.\n- Keeps reliable reassert/retry behavior for dropped frames.\n''')
print('Applied Anderson Home v3.1.14 synchronization patch')
# retrigger after workflow dependency-order correction
