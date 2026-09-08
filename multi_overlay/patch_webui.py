from pathlib import Path
import re, sys

p=Path(sys.argv[1])
s=p.read_text()

# Add three-column controller target button layout.
s=s.replace(
    '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}.label{font-size:13px;margin:11px 0 6px}',
    '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:9px}.grid3{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:8px}.label{font-size:13px;margin:11px 0 6px}',1)

old_panel='''      <strong>Bluetooth Light Controller</strong><div class="sub">The NanoC6 scans for the existing LED BLE controller and bridges commands to it.</div>
      <div class="card" style="margin-top:10px"><div id="bleStatus" class="small">Not connected</div><div id="bleMeta" class="sub">Protocol: Auto</div></div>
      <div class="label">Protocol</div><select id="bleProtocol" class="field"><option value="0">Auto detect</option><option value="1">LEDBLE (7E…EF)</option><option value="2">RGBIC/SPI (7B…BF)</option><option value="3">RGBIC/SPI shifted</option></select>'''
new_panel='''      <strong>Bluetooth Light Controllers</strong><div class="sub">Add up to two controllers. Schedules and events always control both; manual control can target All, A, or B.</div>
      <div class="card" style="margin-top:10px"><div id="bleStatus" class="small">Not connected</div><div id="bleMeta" class="sub">Protocol: Auto</div><div id="selectedControllers" class="bleList" style="margin-top:8px"></div><div class="grid3" style="margin-top:8px"><button id="targetAll" class="btn primary">All Lights</button><button id="targetA" class="btn">A</button><button id="targetB" class="btn">B</button></div></div>
      <div class="label">Protocol</div><select id="bleProtocol" class="field"><option value="0">Auto detect</option><option value="1">LEDBLE (7E…EF)</option><option value="2">RGBIC/SPI (7B…BF)</option><option value="3">RGBIC/SPI shifted</option><option value="4">ELK-BLEDDM / Lotus Lantern</option></select>'''
if old_panel not in s:
    raise SystemExit('Original Bluetooth panel not found')
s=s.replace(old_panel,new_panel,1)

new_apply="""function applyState(s){if(!s)return;power=s.power??power;brightness=s.brightness??brightness;speed=s.speed??speed;$('masterPower').checked=power;$('brightness').value=brightness;$('homeBrightness').value=brightness;$('brightVal').textContent=brightness+'%';$('homeBrightVal').textContent=brightness+'%';$('speed').value=speed;$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1]||'Normal';if(s.running)setRunning(s.running.name,s.running.colors,s.running.effect);$('scheduleWindow').textContent=s.scheduleWindow||$('scheduleWindow').textContent;$('nextEvent').textContent=s.nextEvent||'—';if(s.wifi){$('currentSsid').textContent=s.wifi.ssid||'Not connected';$('wifiMeta').textContent=`Signal: ${s.wifi.rssi??'—'} dBm • IP: ${s.wifi.ip||'—'}`}
const bc=s.ble?.connectedCount||0;$('bleStatus').textContent=bc?`Connected: ${bc} controller${bc===1?'':'s'}`:'Not connected';$('bleMeta').textContent=`Protocol: ${s.ble?.protocol||'Auto'} • Manual target: ${['All','A','B'][s.ble?.target||0]}`;const sc=$('selectedControllers');sc.innerHTML='';(s.ble?.controllers||[]).forEach(c=>{const r=document.createElement('div');r.className='card bleDevice';r.innerHTML=`<div><div class=\"small\"><strong>${c.slot===0?'A':'B'} • ${c.name||c.address}</strong></div><div class=\"sub\">${c.connected?'Connected':'Saved / reconnecting'} • ${c.address}</div></div>`;const x=document.createElement('button');x.className='btn';x.textContent='Remove';x.onclick=()=>post('/api/ble/remove',{slot:c.slot}).then(loadState);r.appendChild(x);sc.appendChild(r)});['targetAll','targetA','targetB'].forEach((id,i)=>$(id).classList.toggle('primary',(s.ble?.target||0)===i));}
"""
s,n=re.subn(r"function applyState\(s\)\{.*?\}\n(?=async function loadState)",new_apply,s,count=1,flags=re.S)
if n!=1:
    raise SystemExit('applyState function not found')

lines=s.splitlines()
for i,line in enumerate(lines):
    if line.startswith("$('scanBle').addEventListener"):
        lines[i]=line.replace("b.textContent='Use'","b.textContent='Add / Use'")
        lines.insert(i+1,"$('targetAll').addEventListener('click',()=>post('/api/ble/target',{target:0}).then(loadState));$('targetA').addEventListener('click',()=>post('/api/ble/target',{target:1}).then(loadState));$('targetB').addEventListener('click',()=>post('/api/ble/target',{target:2}).then(loadState));")
        break
else:
    raise SystemExit('BLE scan handler not found')
s='\n'.join(lines)+'\n'

p.write_text(s)
print('Patched Anderson Home UI for two BLE controllers')
