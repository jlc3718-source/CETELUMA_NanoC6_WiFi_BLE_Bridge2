from pathlib import Path

p=Path('firmware/web/index.html')
s=p.read_text()
old="const fd=new FormData();fd.append('firmware',file,file.name);const x=new XMLHttpRequest();x.open('POST','/api/update');if(window.andersonAuthToken)x.setRequestHeader('X-Anderson-Session',window.andersonAuthToken);"
new="const x=new XMLHttpRequest();x.open('POST','/api/update');x.setRequestHeader('Content-Type','application/octet-stream');x.setRequestHeader('X-Anderson-Filename',file.name);if(window.andersonAuthToken)x.setRequestHeader('X-Anderson-Session',window.andersonAuthToken);"
assert s.count(old)==1, 'expected one routine firmware FormData transport'
s=s.replace(old,new,1)
assert s.count('x.send(fd)')==1, 'expected one routine FormData send'
s=s.replace('x.send(fd)','x.send(file)',1)
p.write_text(s)

p=Path('firmware/web/recovery.html')
s=p.read_text()
old="const data=new FormData();\n        data.append('firmware',file,file.name);\n        const request=new XMLHttpRequest();\n        request.open('POST','/api/update?recovery=1');\n        if(pin)request.setRequestHeader('X-Anderson-Recovery-PIN',pin);"
new="const request=new XMLHttpRequest();\n        request.open('POST','/api/update?recovery=1');\n        request.setRequestHeader('Content-Type','application/octet-stream');\n        request.setRequestHeader('X-Anderson-Filename',file.name);\n        if(pin)request.setRequestHeader('X-Anderson-Recovery-PIN',pin);"
assert s.count(old)==1, 'expected one recovery firmware FormData transport'
s=s.replace(old,new,1)
assert s.count('request.send(data);')==1, 'expected one recovery FormData send'
s=s.replace('request.send(data);','request.send(file);',1)
p.write_text(s)

p=Path('firmware/web/v3_mockup.js')
s=p.read_text()
marker="  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }"
assert s.count(marker)==1, 'expected one v3 init marker'
block=r'''  function syncEmergencyFirmwareVisibility() {
    const panel=byId('emergencyFirmwarePanel');
    if(panel) panel.hidden=!window.andersonProfile || window.andersonProfile.role!=='admin';
  }
  function emergencyFirmwarePanel() {
    const home=q('.page[data-page="home"]');
    if(!home || byId('emergencyFirmwarePanel'))return;
    const panel=el('div','panel v3EmergencyFirmware',`<strong>Emergency Firmware Flash</strong><div class="sub" style="margin-top:6px">Jason-only APP firmware fallback. It writes only the inactive application slot and leaves Wi-Fi, PINs, schedules, customized settings, backup storage, and the partition table untouched.</div><div class="row" style="align-items:end;margin-top:12px;gap:10px;flex-wrap:wrap"><label style="flex:1;min-width:200px"><span class="label">Anderson APP-only BIN</span><input id="emergencyFirmwareFile" type="file" accept=".bin,application/octet-stream"></label><button id="emergencyFirmwareFlash" type="button" class="danger">Flash APP Firmware</button></div><progress id="emergencyFirmwareProgress" max="100" value="0" style="width:100%;margin-top:10px"></progress><div id="emergencyFirmwareStatus" class="sub" style="margin-top:6px">Use only a verified Anderson Home APP-only .bin image.</div>`);
    panel.id='emergencyFirmwarePanel';panel.hidden=true;home.appendChild(panel);
    const input=byId('emergencyFirmwareFile'),button=byId('emergencyFirmwareFlash'),progress=byId('emergencyFirmwareProgress'),out=byId('emergencyFirmwareStatus');
    button.addEventListener('click',async()=>{
      if(!window.andersonProfile || window.andersonProfile.role!=='admin'){out.textContent='Jason administrator access is required.';return;}
      const file=input.files&&input.files[0];
      if(!file){out.textContent='Choose an APP-only .bin firmware file first.';return;}
      if(!/\.bin$/i.test(file.name)){out.textContent='Firmware file must end in .bin.';return;}
      if(file.size<4096){out.textContent='That file is too small to be a valid Anderson firmware image.';return;}
      if(!confirm('Emergency flash this APP-only firmware to the inactive OTA slot? Saved settings and backup data will be preserved.'))return;
      button.disabled=true;progress.value=0;out.textContent='Checking the inactive OTA slot…';
      try{
        const snapshot=await api('/api/firmware?ts='+Date.now());
        if(snapshot.slotSize && file.size>=Number(snapshot.slotSize))throw new Error(`BIN is ${file.size} bytes, larger than the ${snapshot.slotSize}-byte APP slot`);
        beginFirmwareOperation(snapshot,{localUnknown:true});
        const x=new XMLHttpRequest();x.open('POST','/api/update');x.setRequestHeader('Content-Type','application/octet-stream');x.setRequestHeader('X-Anderson-Filename',file.name);if(window.andersonAuthToken)x.setRequestHeader('X-Anderson-Session',window.andersonAuthToken);
        x.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round(e.loaded*100/e.total);progress.value=pct;out.textContent=pct<100?`Emergency firmware upload ${pct}%…`:'Upload complete. Validating APP image and boot slot…';}};
        x.onload=()=>{if(x.status>=200&&x.status<300){progress.value=100;out.textContent='APP image validated. NanoC6 is rebooting into the inactive slot…';waitForFirmwareReturn();}else{button.disabled=false;out.textContent=x.responseText||'Emergency firmware flash failed.';clearFirmwareOperation();if(x.status===401)window.dispatchEvent(new Event('anderson-auth-required'));}};
        x.onerror=()=>{button.disabled=false;out.textContent='Emergency firmware upload connection failed.';clearFirmwareOperation();};
        x.send(file);
      }catch(error){button.disabled=false;clearFirmwareOperation();out.textContent='Emergency firmware flash could not start: '+error.message;}
    });
    syncEmergencyFirmwareVisibility();
  }
'''
newinit="  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();emergencyFirmwarePanel();syncRole();syncEmergencyFirmwareVisibility();window.addEventListener('anderson-profile-selected',()=>{syncRole();syncEmergencyFirmwareVisibility();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',()=>{syncRole();syncEmergencyFirmwareVisibility();}); }"
s=s.replace(marker,block+newinit,1)
p.write_text(s)
