"""Focused BLE delivery and request-recovery regressions."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
ble=(ROOT/'firmware/src/BleController.cpp').read_text();hdr=(ROOT/'firmware/include/BleController.h').read_text()
assert 'delay(RELIABLE_RETRY_DELAY_MS)' not in ble
assert 'writeReliableToTargets' not in ble
assert 'servicePendingWrites' in ble and 'PendingFrame' in hdr
assert 'WRITE_GAP_MS=18UL' in ble and '(uint32_t)(now-lastWrite)<WRITE_GAP_MS' in ble
assert 'p->generation!=generation' in ble
assert 'failureRetryMs' in ble
assert 'STATIC_REASSERT_INTERVAL_MS=30000UL' in ble
assert 't.effect==Effect::Jump&&count==1' in ble
# Model the fixed-size, superseding queue: failed work retries, then a newer generation cancels it.
class P:
 def __init__(s):s.gen=0;s.pending=False;s.remaining=0;s.fail=0
 def put(s,reliable=True):s.gen+=1;s.pending=True;s.remaining=2 if reliable else 1;s.fail=0;return s.gen
 def result(s,g,ok):
  if not s.pending or g!=s.gen:return
  if ok:s.remaining-=1;s.pending=s.remaining>0;s.fail=0
  else:s.fail+=1
p=P();g=p.put();p.result(g,False);assert p.pending and p.fail==1
g2=p.put();p.result(g,True);assert p.pending and p.gen==g2
p.result(g2,True);assert p.pending and p.remaining==1
p.result(g2,True);assert not p.pending
print('PASS: BLE delivery uses a bounded nonblocking superseding queue with retry/convergence semantics')
html=(ROOT/'firmware/web/index.html').read_text();helper=html[html.index('async function controllerRequest('):html.index('/* ANDERSON_LOCKOUT_SAFE_PROFILE_GATE */')]
js=helper+"""
const assert=require('node:assert/strict');function stalled(signal){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}(async()=>{global.fetch=(_,options)=>stalled(options.signal);await assert.rejects(controllerRequest('/test',{},5),/timed out/);global.fetch=async()=>({ok:true,text:async()=>'{"ok":true}'});const result=await controllerRequest('/test',{},50);assert.equal(JSON.parse(result.text).ok,true);console.log('PASS: timed-out requests release the UI for retry')})().catch(e=>{console.error(e);process.exitCode=1});
"""
subprocess.run(['node'],input=js,text=True,check=True)
