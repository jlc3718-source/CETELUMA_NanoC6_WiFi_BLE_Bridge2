from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

s=main.read_text()
state='bool otaUploadAllowed=false,otaUploadOk=false;String otaUploadError;\n'
if state not in s: raise SystemExit('OTA state anchor missing')
if 'otaAutoRebootPending' not in s:
    s=s.replace(state,state+'bool otaAutoRebootPending=false;uint32_t otaAutoRebootAt=0;\n',1)

old='''    JsonDocument d;d["ok"]=true;d["message"]="Firmware verified and staged. Press Reboot NanoC6 to start the new firmware.";String out;serializeJson(d,out);sendJson(out);'''
new='''    JsonDocument d;d["ok"]=true;d["message"]="Firmware verified. NanoC6 will reboot automatically into the new firmware.";String out;serializeJson(d,out);sendJson(out);otaAutoRebootPending=true;otaAutoRebootAt=millis()+1200;'''
if old not in s: raise SystemExit('OTA completion response anchor missing')
s=s.replace(old,new,1)

loop='  server.handleClient();ble.loop();\n'
if loop not in s: raise SystemExit('loop anchor missing')
if 'otaAutoRebootPending&&' not in s:
    s=s.replace(loop,loop+'  if(otaAutoRebootPending&&(int32_t)(millis()-otaAutoRebootAt)>=0){otaAutoRebootPending=false;delay(40);ESP.restart();}\n',1)
main.write_text(s)

s=web.read_text()
s=s.replace('Routine updates can be installed here over local Wi-Fi. Select the app-only BIN; the NanoC6 writes it to the inactive OTA slot and keeps the current firmware available as the previous slot.',
            'Select the app-only BIN, then press Upload, Install & Reboot. The NanoC6 writes the update to the inactive OTA slot, reboots automatically, and this page reconnects and refreshes itself.',1)
s=s.replace('Upload & Stage Update','Upload, Install & Reboot',1)
s=s.replace('Local Wi-Fi only. The device will not reboot until you press Reboot NanoC6.','Select the app-only BIN and press Upload, Install & Reboot.',1)

old="""function stageFirmware(){const file=$('firmwareFile').files&&$('firmwareFile').files[0];if(!file)return status('Choose an app-only .bin firmware file first.');if(!/\\.bin$/i.test(file.name))return status('Firmware file must end in .bin.');const fd=new FormData();fd.append('firmware',file,file.name);const x=new XMLHttpRequest();x.open('POST','/api/update');$('uploadFirmware').disabled=true;$('fwProgress').value=0;$('fwStatus').textContent='Uploading '+file.name+'…';x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded*100/e.total);$('fwProgress').value=p;$('fwStatus').textContent='Uploading… '+p+'%'}};x.onload=()=>{$('uploadFirmware').disabled=false;if(x.status>=200&&x.status<300){$('fwProgress').value=100;$('fwStatus').textContent='Firmware verified and staged. Press Reboot NanoC6 when ready.';status('Firmware staged successfully.');loadFirmwareInfo()}else{$('fwStatus').textContent=x.responseText||'Firmware update failed.';status('Firmware update failed.')}};x.onerror=()=>{$('uploadFirmware').disabled=false;$('fwStatus').textContent='Upload connection failed.';status('Firmware upload failed.')};x.send(fd)}"""
new="""let otaBeforePartition='';async function waitForFirmwareReturn(){let tries=0;const poll=async()=>{tries++;try{const r=await fetch('/api/firmware?ts='+Date.now(),{cache:'no-store'});if(r.ok){const f=await r.json();if(!otaBeforePartition||f.runningPartition!==otaBeforePartition||tries>=8){$('fwStatus').textContent='NanoC6 is back online. Refreshing…';setTimeout(()=>location.reload(),700);return}}}catch(e){}if(tries<45){setTimeout(poll,1000)}else{$('fwStatus').textContent='Update was sent, but the page could not reconnect automatically. Reopen Anderson Home.';$('uploadFirmware').disabled=false}};setTimeout(poll,3500)}
function stageFirmware(){const file=$('firmwareFile').files&&$('firmwareFile').files[0];if(!file)return status('Choose an app-only .bin firmware file first.');if(!/\\.bin$/i.test(file.name))return status('Firmware file must end in .bin.');const fd=new FormData();fd.append('firmware',file,file.name);const x=new XMLHttpRequest();x.open('POST','/api/update');$('uploadFirmware').disabled=true;$('fwProgress').value=0;$('fwStatus').textContent='Uploading '+file.name+'…';x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded*100/e.total);$('fwProgress').value=p;$('fwStatus').textContent='Uploading… '+p+'%'}};x.onload=()=>{if(x.status>=200&&x.status<300){$('fwProgress').value=100;$('fwStatus').textContent='Firmware verified. Rebooting NanoC6 automatically…';status('Firmware installed. NanoC6 is rebooting.');waitForFirmwareReturn()}else{$('uploadFirmware').disabled=false;$('fwStatus').textContent=x.responseText||'Firmware update failed.';status('Firmware update failed.')}};x.onerror=()=>{$('uploadFirmware').disabled=false;$('fwStatus').textContent='Upload connection failed.';status('Firmware upload failed.')};x.send(fd)}"""
if old not in s: raise SystemExit('stageFirmware function anchor missing')
s=s.replace(old,new,1)

old_info="async function loadFirmwareInfo(){try{const f=await api('/api/firmware');const mb=f.slotSize?(f.slotSize/1048576).toFixed(2):'—';$('fwMeta').innerHTML=`<strong>Running:</strong> ${f.runningPartition||'—'}${f.version?' • '+f.version:''}<br><span class=\"sub\">Update slot: ${f.nextPartition||'—'} • ${mb} MB maximum app size</span>`;$('rollbackFirmware').disabled=!f.previousAvailable}catch(e){$('fwMeta').textContent=API_MODE?'Firmware information unavailable.':'Connect to the NanoC6 to manage firmware.'}}"
new_info="async function loadFirmwareInfo(){try{const f=await api('/api/firmware');otaBeforePartition=f.runningPartition||otaBeforePartition;const mb=f.slotSize?(f.slotSize/1048576).toFixed(2):'—';$('fwMeta').innerHTML=`<strong>Running:</strong> ${f.runningPartition||'—'}${f.version?' • '+f.version:''}<br><span class=\"sub\">Update slot: ${f.nextPartition||'—'} • ${mb} MB maximum app size</span>`;$('rollbackFirmware').disabled=!f.previousAvailable}catch(e){$('fwMeta').textContent=API_MODE?'Firmware information unavailable.':'Connect to the NanoC6 to manage firmware.'}}"
if old_info not in s: raise SystemExit('loadFirmwareInfo anchor missing')
s=s.replace(old_info,new_info,1)
web.write_text(s)
print('Made OTA update upload, reboot, reconnect and refresh automatic')
