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

# The custom-light route transformer historically replaced everything up to /api/wifi/scan,
# which also removed the OTA routes. Reinsert a complete OTA block here as the final transform.
route_anchor='  server.on("/api/wifi/scan",HTTP_GET,[]{\n'
if route_anchor not in s: raise SystemExit('Wi-Fi route anchor missing for OTA restore')
start=s.find('  server.on("/api/firmware",HTTP_GET,[]{')
end=s.find(route_anchor)
if start>=0 and start<end:
    s=s[:start]+s[end:]

ota_routes=r'''  server.on("/api/firmware",HTTP_GET,[]{sendJson(firmwareJson());});
  server.on("/api/update",HTTP_POST,[]{
    if(!otaUploadAllowed){server.send(403,"text/plain",otaUploadError.length()?otaUploadError:"Firmware upload was not accepted");return;}
    if(!otaUploadOk){server.send(500,"text/plain",otaUploadError.length()?otaUploadError:"Firmware update failed");return;}
    JsonDocument d;d["ok"]=true;d["message"]="Firmware verified. NanoC6 will reboot automatically into the new firmware.";String out;serializeJson(d,out);sendJson(out);otaAutoRebootPending=true;otaAutoRebootAt=millis()+1400;
  },[]{
    HTTPUpload& u=server.upload();
    if(u.status==UPLOAD_FILE_START){
      otaUploadAllowed=true;otaUploadOk=false;otaUploadError="";String fn=u.filename;fn.toLowerCase();
      if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadError="Select an app-only .bin firmware file";return;}
      if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){otaUploadAllowed=false;otaUploadError=String("Unable to open OTA slot. Error ")+String(Update.getError());return;}
    }else if(u.status==UPLOAD_FILE_WRITE){
      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();}
    }else if(u.status==UPLOAD_FILE_END){
      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk)otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}
    }else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();otaUploadOk=false;otaUploadError="Firmware upload aborted";}
  });
  server.on("/api/reboot",HTTP_POST,[]{sendJson("{\"ok\":true,\"message\":\"Rebooting NanoC6\"}");otaAutoRebootPending=true;otaAutoRebootAt=millis()+700;});
  server.on("/api/rollback",HTTP_POST,[]{
    const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* other=esp_ota_get_next_update_partition(running);
    if(!otaPartitionValid(other)){server.send(404,"text/plain","No valid previous firmware is available in the other OTA slot");return;}
    if(esp_ota_set_boot_partition(other)!=ESP_OK){server.send(500,"text/plain","Could not select the previous firmware slot");return;}
    sendJson("{\"ok\":true,\"message\":\"Previous firmware selected. Press Reboot NanoC6.\"}");
  });

'''
s=s.replace(route_anchor,ota_routes+route_anchor,1)

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
s=s.replace('Firmware verified and staged. Press Reboot NanoC6 when ready.','Firmware verified. Rebooting NanoC6 automatically…')

info_start=s.find('async function loadFirmwareInfo(){')
stage_start=s.find('function stageFirmware(){',info_start)
if info_start<0 or stage_start<0: raise SystemExit('firmware UI function anchors missing')
new_info="""let otaBeforePartition='';async function loadFirmwareInfo(){try{const f=await api('/api/firmware');otaBeforePartition=f.runningPartition||otaBeforePartition;const mb=f.slotSize?(f.slotSize/1048576).toFixed(2):'—';$('fwMeta').innerHTML=`<strong>Running:</strong> ${f.runningPartition||'—'}${f.version?' • '+f.version:''}<br><span class=\"sub\">Update slot: ${f.nextPartition||'—'} • ${mb} MB maximum app size</span>`;$('rollbackFirmware').disabled=!f.previousAvailable}catch(e){$('fwMeta').textContent=API_MODE?'Firmware information unavailable.':'Connect to the NanoC6 to manage firmware.'}}
async function waitForFirmwareReturn(){let tries=0;const poll=async()=>{tries++;try{const r=await fetch('/api/firmware?ts='+Date.now(),{cache:'no-store'});if(r.ok){const f=await r.json();if(!otaBeforePartition||f.runningPartition!==otaBeforePartition||tries>=8){$('fwStatus').textContent='NanoC6 is back online. Refreshing…';setTimeout(()=>location.reload(),700);return}}}catch(e){}if(tries<45){setTimeout(poll,1000)}else{$('fwStatus').textContent='Update completed, but automatic reconnect timed out. Reopen Anderson Home.';$('uploadFirmware').disabled=false}};setTimeout(poll,3500)}
"""
s=s[:info_start]+new_info+s[stage_start:]

stage_start=s.find('function stageFirmware(){')
stage_end=s.find("\n$('uploadFirmware').addEventListener",stage_start)
if stage_start<0 or stage_end<0: raise SystemExit('stageFirmware replacement anchors missing')
new_stage="""function stageFirmware(){const file=$('firmwareFile').files&&$('firmwareFile').files[0];if(!file)return status('Choose an app-only .bin firmware file first.');if(!/\\.bin$/i.test(file.name))return status('Firmware file must end in .bin.');const fd=new FormData();fd.append('firmware',file,file.name);const x=new XMLHttpRequest();x.open('POST','/api/update');$('uploadFirmware').disabled=true;$('fwProgress').value=0;$('fwStatus').textContent='Uploading '+file.name+'…';x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded*100/e.total);$('fwProgress').value=p;$('fwStatus').textContent='Uploading… '+p+'%'}};x.onload=()=>{if(x.status>=200&&x.status<300){$('fwProgress').value=100;$('fwStatus').textContent='Firmware verified. Rebooting NanoC6 automatically…';status('Firmware installed. NanoC6 is rebooting.');waitForFirmwareReturn()}else{$('uploadFirmware').disabled=false;$('fwStatus').textContent=x.responseText||'Firmware update failed.';status('Firmware update failed.')}};x.onerror=()=>{$('uploadFirmware').disabled=false;$('fwStatus').textContent='Upload connection failed.';status('Firmware upload failed.')};x.send(fd)}"""
s=s[:stage_start]+new_stage+s[stage_end:]
web.write_text(s)
print('Restored OTA routes and made update/reboot/reconnect automatic')
