from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
main=ROOT/'firmware/src/main.cpp'
ui=ROOT/'firmware/web/v3_mockup.js'
version=ROOT/'FIRMWARE_VERSION.txt'

text=main.read_text()
old='static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.6";'
new='static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.7";'
if old not in text and new not in text:
    raise SystemExit('firmware version marker not found')
text=text.replace(old,new,1)
anchor='  server.on("/api/system",HTTP_GET,[]{if(!requireAdmin())return;sendJson(systemJson());});\n'
route='  server.on("/api/ble/diagnostics",HTTP_GET,[]{if(!requireAdmin())return;sendJson(ble.diagnosticsJson(true));});\n'
if route not in text:
    if anchor not in text: raise SystemExit('system route anchor not found')
    text=text.replace(anchor,anchor+route,1)
main.write_text(text)
version.write_text('3.1.7\n')

js=ui.read_text()
defs_old="    const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['security','Users & Security'],['firmware','Firmware']];"
defs_new="    const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['testing','Testing'],['security','Users & Security'],['firmware','Firmware']];"
if defs_old in js: js=js.replace(defs_old,defs_new,1)
elif defs_new not in js: raise SystemExit('settings defs anchor not found')

insert_anchor='  function syncRole() {\n'
feature=r'''  function bleDiagnosticsPanel() {
    const pane=byId('v3SettingsPane-testing');
    if(!pane || byId('v3BleDiagnosticsPanel'))return;
    const style=document.createElement('style');style.id='v3BleDiagnosticsStyle';style.textContent=`
.v3BleDiagGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.v3BleDiagCard{border:1px solid rgba(84,192,255,.3);border-radius:15px;padding:12px;background:rgba(3,16,29,.78)}.v3BleDiagHead{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.v3BleDiagState{font-size:10px;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:4px 7px;color:#b7c9da;white-space:nowrap}.v3BleDiagState.good{color:#70ffad;border-color:#36d98166}.v3BleDiagState.warn{color:#ffd272;border-color:#e6a93b66}.v3BleDiagState.bad{color:#ff8f8f;border-color:#f15f5f66}.v3BleChecks{display:grid;gap:6px;margin-top:10px}.v3BleCheck{display:grid;grid-template-columns:19px 1fr;gap:7px;align-items:start;font-size:11px;color:#c8d7e6}.v3BleCheck i{font-style:normal;text-align:center}.v3BleCheck small{display:block;color:#8296aa;margin-top:1px}.v3BleRaw{margin-top:9px;padding:8px;border-radius:9px;background:#020914;border:1px solid rgba(95,180,235,.18);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#9ec9e7;overflow-wrap:anywhere}.v3BleRaw b{color:#d8efff}.v3BleLegend{margin-top:10px;font-size:11px;line-height:1.5;color:#8fa2b5}@media(max-width:600px){.v3BleDiagGrid{grid-template-columns:1fr}}
`;document.head.appendChild(style);
    const panel=el('div','panel');panel.id='v3BleDiagnosticsPanel';
    const top=el('div','row between',`<div><strong>BLE Command Verification</strong><div class="sub">Jason-only live diagnostics • checks each light controller independently</div></div>`);
    const refresh=el('button','btn','Refresh');refresh.type='button';top.appendChild(refresh);panel.appendChild(top);
    const note=el('div','note','<strong>What “confirmed” means:</strong> GATT acknowledgement proves the controller accepted the BLE write. A controller-state confirmation is shown only when the controller returns readable/notification data that matches the requested power, color, or brightness. It does not optically sense the LEDs.');panel.appendChild(note);
    const grid=el('div','v3BleDiagGrid');panel.appendChild(grid);
    const footer=el('div','v3BleLegend','Waiting for controller telemetry…');panel.appendChild(footer);pane.appendChild(panel);
    const checkpoint=(ok,label,detail,neutral=false)=>`<div class="v3BleCheck"><i>${neutral?'•':ok?'✓':'○'}</i><span>${label}<small>${detail||''}</small></span></div>`;
    const age=ms=>!ms?'—':ms<1000?`${ms} ms ago`:`${Math.round(ms/100)/10} s ago`;
    const render=d=>{
      grid.replaceChildren();const controllers=Array.isArray(d.controllers)?d.controllers:[];
      controllers.forEach(c=>{
        const card=el('div','v3BleDiagCard'),head=el('div','v3BleDiagHead'),title=el('div','',`<strong>${c.label||('Controller '+((c.slot||0)+1))}</strong><div class="sub"></div>`),meta=q('.sub',title);meta.textContent=[c.name||'Not named',c.address||'No saved address'].join(' • ');
        const state=el('span','v3BleDiagState',c.connected?'CONNECTED':(c.address?'RECONNECTING':'NOT SET'));state.classList.add(c.connected?'good':(c.address?'warn':'bad'));head.append(title,state);card.appendChild(head);
        const checks=el('div','v3BleChecks');
        const hasResponse=!!(c.responseReadSupported||c.responseNotifySupported||c.responseIndicateSupported),gotResponse=!!c.lastRxHex,writeAck=!!c.lastWriteAcknowledged,writeQueued=!!c.lastWriteQueued;
        checks.innerHTML=
          checkpoint(!!c.connected,'BLE connected',c.connected?'Active GATT connection':'No active connection')+
          checkpoint(!!c.writeWithResponseSupported,'Write-with-response',c.writeWithResponseSupported?'Supported by controller characteristic':'Not advertised; writes may be unacknowledged')+
          checkpoint(!!c.lastWriteOk,'Command sent',c.lastCommand?`${c.lastCommand} • ${age(c.lastWriteAgeMs)}`:'No command captured yet',!c.lastCommand)+
          checkpoint(writeAck,'GATT write acknowledged',writeAck?'Peripheral acknowledged the write':(writeQueued?'Write queued without peripheral acknowledgement':'No acknowledgement captured'),!c.lastCommand)+
          checkpoint(hasResponse,'State response channel',hasResponse?`${c.responseCharacteristic||'Characteristic'} • ${c.responseSubscribed?'notifications subscribed':c.responseReadSupported?'readable':'available'}`:'No readable/notify response characteristic found')+
          checkpoint(gotResponse,'Controller response received',gotResponse?`${age(c.lastResponseAgeMs)} • ${c.responseParsed?'recognized frame':'raw/unrecognized frame'}`:'No response data received yet')+
          checkpoint(!!c.powerConfirmed,'Power state confirmed',c.requestedPower===undefined?'No power command captured':c.powerConfirmed?`Controller reports ${c.requestedPower?'ON':'OFF'}`:`Requested ${c.requestedPower?'ON':'OFF'}; not confirmed`,c.requestedPower===undefined)+
          checkpoint(!!c.colorConfirmed,'Color confirmed',!c.requestedColor?'No color command captured':c.colorConfirmed?`Controller reports ${c.requestedColor}`:`Requested ${c.requestedColor}; not confirmed`,!c.requestedColor)+
          checkpoint(!!c.brightnessConfirmed,'Brightness confirmed',c.requestedBrightness===undefined?'No brightness command captured':c.brightnessConfirmed?`Controller reports ${c.requestedBrightness}%`:`Requested ${c.requestedBrightness}%; not confirmed`,c.requestedBrightness===undefined);
        card.appendChild(checks);
        const raw=el('div','v3BleRaw');raw.innerHTML='<b>TX</b> '+(c.lastTxHex||'—')+'<br><b>RX</b> '+(c.lastRxHex||'—')+'<br><b>Status</b> ';raw.appendChild(document.createTextNode(c.status||'Idle'));card.appendChild(raw);grid.appendChild(card);
      });
      footer.textContent=`${Number(d.connectedCount)||0} controller${Number(d.connectedCount)===1?'':'s'} connected • target ${['All','A','B'][Number(d.target)||0]||'All'} • ${d.protocol||'BLE'}`;
    };
    let busy=false;async function load(){const admin=window.andersonProfile?.role==='admin'&&window.andersonProfile?.id==='jason';if(!admin||pane.hidden||busy)return;busy=true;try{render(await api('/api/ble/diagnostics?ts='+Date.now()));}catch(error){footer.textContent='Diagnostics unavailable: '+error.message;}finally{busy=false}}
    refresh.addEventListener('click',load);setInterval(load,2000);window.addEventListener('anderson-profile-selected',()=>setTimeout(load,100));
  }
'''
if feature not in js:
    if insert_anchor not in js: raise SystemExit('syncRole anchor not found')
    js=js.replace(insert_anchor,feature+insert_anchor,1)

sync_old="    byId('switchProfile').setAttribute('aria-label',window.andersonProfile ? `Logout ${window.andersonProfile.name}`:'Logout'); syncPage();"
sync_new="    const testingButton=q('[data-settings-tab=\"testing\"]'),testingPane=byId('v3SettingsPane-testing');if(testingButton)testingButton.hidden=!admin;if(testingPane){if(!admin&&testingPane.classList.contains('active'))q('[data-settings-tab=\"general\"]')?.click();testingPane.hidden=!admin||!testingPane.classList.contains('active');}byId('switchProfile').setAttribute('aria-label',window.andersonProfile ? `Logout ${window.andersonProfile.name}`:'Logout'); syncPage();"
if sync_old in js: js=js.replace(sync_old,sync_new,1)
elif sync_new not in js: raise SystemExit('syncRole body anchor not found')

init_old="  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }"
init_new="  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();bleDiagnosticsPanel();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }"
if init_old in js: js=js.replace(init_old,init_new,1)
elif init_new not in js: raise SystemExit('init anchor not found')
ui.write_text(js)
print('BLE diagnostics patch applied')
