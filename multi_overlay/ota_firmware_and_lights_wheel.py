from pathlib import Path
import re, sys

root = Path(sys.argv[1])
main = root/'src/main.cpp'
web = root/'include/WebUI.h'

# ---------- NanoC6 OTA firmware update API ----------
s = main.read_text()
inc_anchor = '#include <ArduinoJson.h>\n'
if inc_anchor not in s:
    raise SystemExit('ArduinoJson include anchor not found')
s = s.replace(inc_anchor, inc_anchor + '#include <Update.h>\n#include <esp_ota_ops.h>\n#include <esp_app_desc.h>\n', 1)

state_anchor = 'bool setupAP=false;\n'
if state_anchor not in s:
    raise SystemExit('setupAP anchor not found')
s = s.replace(state_anchor, state_anchor + 'bool otaUploadAllowed=false,otaUploadOk=false;String otaUploadError;\n', 1)

helper_anchor = 'static bool timeValid(){return time(nullptr)>1700000000;}\n'
helpers = r'''
static bool localFirmwareClient(){
  IPAddress ip=server.client().remoteIP();
  return ip[0]==10 || (ip[0]==172 && ip[1]>=16 && ip[1]<=31) || (ip[0]==192 && ip[1]==168) || (ip[0]==169 && ip[1]==254) || ip[0]==127;
}
static bool otaPartitionValid(const esp_partition_t* p){
  if(!p)return false;esp_app_desc_t desc{};return esp_ota_get_partition_description(p,&desc)==ESP_OK;
}
static String firmwareJson(){
  JsonDocument d;const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* next=esp_ota_get_next_update_partition(running);
  d["runningPartition"]=running?running->label:"";d["nextPartition"]=next?next->label:"";d["slotSize"]=next?(uint32_t)next->size:0;d["localOnly"]=true;d["previousAvailable"]=otaPartitionValid(next);
  esp_app_desc_t desc{};if(running&&esp_ota_get_partition_description(running,&desc)==ESP_OK){d["version"]=desc.version;d["project"]=desc.project_name;d["buildDate"]=desc.date;d["buildTime"]=desc.time;}
  String out;serializeJson(d,out);return out;
}
'''
if helper_anchor not in s:
    raise SystemExit('timeValid helper anchor not found')
s = s.replace(helper_anchor, helper_anchor + helpers, 1)

route_anchor = '  server.on("/api/wifi/scan",HTTP_GET,[]{\n'
ota_routes = r'''  server.on("/api/firmware",HTTP_GET,[]{sendJson(firmwareJson());});
  server.on("/api/update",HTTP_POST,[]{
    if(!otaUploadAllowed){server.send(403,"text/plain",otaUploadError.length()?otaUploadError:"Firmware updates are local Wi-Fi only");return;}
    if(!otaUploadOk){server.send(500,"text/plain",otaUploadError.length()?otaUploadError:"Firmware update failed");return;}
    JsonDocument d;d["ok"]=true;d["message"]="Firmware verified and staged. Press Reboot NanoC6 to start the new firmware.";String out;serializeJson(d,out);sendJson(out);
  },[]{
    HTTPUpload& u=server.upload();
    if(u.status==UPLOAD_FILE_START){
      otaUploadAllowed=localFirmwareClient();otaUploadOk=false;otaUploadError="";
      if(!otaUploadAllowed){otaUploadError="Firmware updates are allowed only from the local Wi-Fi network";return;}
      String fn=u.filename;fn.toLowerCase();if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadError="Select an app-only .bin firmware file";return;}
      if(!Update.begin(UPDATE_SIZE_UNKNOWN,U_FLASH)){otaUploadAllowed=false;otaUploadError=String("Unable to open OTA slot. Error ")+String(Update.getError());return;}
    }else if(u.status==UPLOAD_FILE_WRITE){
      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();}
    }else if(u.status==UPLOAD_FILE_END){
      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk)otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}
    }else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();otaUploadOk=false;otaUploadError="Firmware upload aborted";}
  });
  server.on("/api/reboot",HTTP_POST,[]{
    if(!localFirmwareClient()){server.send(403,"text/plain","Reboot is local Wi-Fi only");return;}sendJson("{\"ok\":true,\"message\":\"Rebooting NanoC6\"}");delay(350);ESP.restart();
  });
  server.on("/api/rollback",HTTP_POST,[]{
    if(!localFirmwareClient()){server.send(403,"text/plain","Rollback is local Wi-Fi only");return;}
    const esp_partition_t* running=esp_ota_get_running_partition();const esp_partition_t* other=esp_ota_get_next_update_partition(running);
    if(!otaPartitionValid(other)){server.send(404,"text/plain","No valid previous firmware is available in the other OTA slot");return;}
    if(esp_ota_set_boot_partition(other)!=ESP_OK){server.send(500,"text/plain","Could not select the previous firmware slot");return;}
    sendJson("{\"ok\":true,\"message\":\"Previous firmware selected. Press Reboot NanoC6.\"}");
  });

'''
if route_anchor not in s:
    raise SystemExit('Wi-Fi route anchor not found')
s = s.replace(route_anchor, ota_routes + route_anchor, 1)
main.write_text(s)

# ---------- Lights page RGB wheel + firmware update UI ----------
s = web.read_text()

# Put the persistent saved-color palette directly in Build Your Lights.
quick_anchor = '      <div class="label">Quick colors</div>\n      <div class="quick" id="quickColors" style="margin-top:8px"></div>\n'
quick_new = quick_anchor + '      <div class="label">Saved Colors</div><div id="lightSavedColorGrid" class="savedColorGrid"></div>\n      <div class="sub" style="margin-top:5px">Tap a saved color to add it to this custom light setup. Tap any color slot above to open the RGB wheel.</div>\n'
if quick_anchor not in s:
    raise SystemExit('Quick colors HTML anchor not found')
s = s.replace(quick_anchor, quick_new, 1)

# Replace native browser color inputs in the Lights builder with the same RGB-wheel chips used by event editing.
old_picker = r'''    const picker=document.createElement('input');
    picker.type='color';
    picker.value=/^#[0-9a-f]{6}$/i.test(color)?color:'#25a7ff';
    picker.setAttribute('aria-label','Color '+(index+1));
    picker.addEventListener('input',e=>{
      builderColors[index]=e.target.value;
      preview={name:'Custom Multi-Color',colors:[...builderColors],effect:$('effectSelect').value};
    });
    picker.addEventListener('change',()=>sendBuilderLook());
'''
new_picker = r'''    const picker=document.createElement('button');
    picker.type='button';picker.className='colorChip';picker.style.width='48px';picker.style.height='44px';
    setChipColor(picker,/^#[0-9a-f]{6}$/i.test(color)?color:'#25a7ff');picker.dataset.builderIndex=index;
    picker.setAttribute('aria-label','Color '+(index+1));picker.title='Color '+(index+1)+' — tap for RGB wheel';
    picker.addEventListener('click',()=>openRgbWheel(picker));
'''
if old_picker not in s:
    raise SystemExit('Lights native color picker block not found')
s = s.replace(old_picker,new_picker,1)

# Extend the shared color-chip function so RGB-wheel changes update the live Lights builder too.
old_set = "function setChipColor(chip,h){if(!chip)return;h=normHex(h);chip.dataset.color=h;chip.style.background=h;chip.title=h+' — tap to edit';}"
new_set = "let builderWheelTimer=null;function setChipColor(chip,h){if(!chip)return;h=normHex(h);chip.dataset.color=h;chip.style.background=h;chip.title=h+' — tap to edit';if(chip.dataset.builderIndex!==undefined){const i=+chip.dataset.builderIndex;if(Number.isInteger(i)&&i>=0&&i<builderColors.length){builderColors[i]=h;preview={name:builderColors.length>1?'Custom Multi-Color':'Custom Color',colors:[...builderColors],effect:$('effectSelect').value};clearTimeout(builderWheelTimer);builderWheelTimer=setTimeout(sendBuilderLook,160);}}}"
if old_set not in s:
    raise SystemExit('setChipColor function not found')
s = s.replace(old_set,new_set,1)

# Render the saved palette both inside the wheel and directly on the Lights page.
old_render = "function renderSavedColors(){const g=$('savedColorGrid');if(!g)return;g.innerHTML='';if(!savedColors.length){const t=document.createElement('span');t.className='sub';t.textContent='No custom colors saved yet.';g.appendChild(t);return}savedColors.forEach(c=>{const b=document.createElement('button');b.className='savedSwatch';b.style.background=c;b.title='Use '+c;b.onclick=()=>setPickerHex(c);const x=document.createElement('button');x.className='x';x.textContent='×';x.title='Delete saved color';x.onclick=e=>{e.stopPropagation();removeSavedColor(c)};b.appendChild(x);g.appendChild(b)})}"
new_render = r'''function fillSavedColors(g,forLights){if(!g)return;g.innerHTML='';if(!savedColors.length){const t=document.createElement('span');t.className='sub';t.textContent='No custom colors saved yet.';g.appendChild(t);return}savedColors.forEach(c=>{const b=document.createElement('button');b.className='savedSwatch';b.style.background=c;b.title=(forLights?'Add ':'Use ')+c;b.onclick=()=>{if(forLights){if(builderColors.length===1&&builderColors[0]==='#25a7ff')builderColors[0]=c;else if(builderColors.length<8)builderColors.push(c);else builderColors[builderColors.length-1]=c;renderColorBuilder();sendBuilderLook()}else setPickerHex(c)};const x=document.createElement('button');x.className='x';x.textContent='×';x.title='Delete saved color';x.onclick=e=>{e.stopPropagation();removeSavedColor(c)};b.appendChild(x);g.appendChild(b)})}
function renderSavedColors(){fillSavedColors($('savedColorGrid'),false);fillSavedColors($('lightSavedColorGrid'),true)}'''
if old_render not in s:
    raise SystemExit('renderSavedColors function not found')
s = s.replace(old_render,new_render,1)

# Add a firmware updater to Settings. This interface is served by the NanoC6 and appears in both browser and APK.
settings_anchor = '    <div class="panel"><strong>Priority</strong>'
firmware_panel = r'''    <div class="panel">
      <strong>Firmware Update</strong><div class="sub">Routine updates can be installed here over local Wi-Fi. Select the app-only BIN; the NanoC6 writes it to the inactive OTA slot and keeps the current firmware available as the previous slot.</div>
      <div id="fwMeta" class="card small" style="margin-top:10px">Loading firmware information…</div>
      <div class="label">App-only firmware BIN</div><input id="firmwareFile" class="field" type="file" accept=".bin,application/octet-stream">
      <button id="uploadFirmware" class="btn primary" style="width:100%;margin-top:9px">Upload & Stage Update</button>
      <progress id="fwProgress" max="100" value="0" style="width:100%;height:14px;margin-top:9px"></progress>
      <div id="fwStatus" class="sub" style="margin-top:6px">Local Wi-Fi only. The device will not reboot until you press Reboot NanoC6.</div>
      <div class="grid2" style="margin-top:10px"><button id="rebootNano" class="btn">Reboot NanoC6</button><button id="rollbackFirmware" class="btn">Boot Previous Firmware</button></div>
    </div>

'''
if settings_anchor not in s:
    raise SystemExit('Settings Priority panel anchor not found')
s = s.replace(settings_anchor,firmware_panel+settings_anchor,1)

fw_js = r'''
async function loadFirmwareInfo(){try{const f=await api('/api/firmware');const mb=f.slotSize?(f.slotSize/1048576).toFixed(2):'—';$('fwMeta').innerHTML=`<strong>Running:</strong> ${f.runningPartition||'—'}${f.version?' • '+f.version:''}<br><span class="sub">Update slot: ${f.nextPartition||'—'} • ${mb} MB maximum app size</span>`;$('rollbackFirmware').disabled=!f.previousAvailable}catch(e){$('fwMeta').textContent=API_MODE?'Firmware information unavailable.':'Connect to the NanoC6 to manage firmware.'}}
function stageFirmware(){const file=$('firmwareFile').files&&$('firmwareFile').files[0];if(!file)return status('Choose an app-only .bin firmware file first.');if(!/\.bin$/i.test(file.name))return status('Firmware file must end in .bin.');const fd=new FormData();fd.append('firmware',file,file.name);const x=new XMLHttpRequest();x.open('POST','/api/update');$('uploadFirmware').disabled=true;$('fwProgress').value=0;$('fwStatus').textContent='Uploading '+file.name+'…';x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded*100/e.total);$('fwProgress').value=p;$('fwStatus').textContent='Uploading… '+p+'%'}};x.onload=()=>{$('uploadFirmware').disabled=false;if(x.status>=200&&x.status<300){$('fwProgress').value=100;$('fwStatus').textContent='Firmware verified and staged. Press Reboot NanoC6 when ready.';status('Firmware staged successfully.');loadFirmwareInfo()}else{$('fwStatus').textContent=x.responseText||'Firmware update failed.';status('Firmware update failed.')}};x.onerror=()=>{$('uploadFirmware').disabled=false;$('fwStatus').textContent='Upload connection failed.';status('Firmware upload failed.')};x.send(fd)}
$('uploadFirmware').addEventListener('click',stageFirmware);
$('rebootNano').addEventListener('click',async()=>{if(!confirm('Reboot the NanoC6 now?'))return;$('fwStatus').textContent='Rebooting NanoC6…';try{await post('/api/reboot',{})}catch(e){}setTimeout(()=>{loadState();loadFirmwareInfo()},6500)});
$('rollbackFirmware').addEventListener('click',async()=>{if(!confirm('Select the previous firmware slot for the next reboot?'))return;try{await post('/api/rollback',{});$('fwStatus').textContent='Previous firmware selected. Press Reboot NanoC6 to boot it.';status('Previous firmware selected for next boot.')}catch(e){$('fwStatus').textContent='Rollback selection failed: '+e.message}});
setTimeout(loadFirmwareInfo,100);
'''
if 'loadState();loadEvents();setInterval' not in s:
    raise SystemExit('final loadState anchor not found')
s = s.replace('loadState();loadEvents();setInterval', fw_js+'\nloadState();loadEvents();setInterval',1)

web.write_text(s)
print('Added dual-slot OTA firmware updater and RGB wheel to Lights custom builder')
