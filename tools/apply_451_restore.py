from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'firmware' / 'src' / 'main.cpp'
WEB = ROOT / 'firmware' / 'web' / 'index.html'
VERSION = ROOT / 'FIRMWARE_VERSION.txt'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'missing anchor: {label}')
    return text.replace(old, new, 1)

main = MAIN.read_text()
main = main.replace('static constexpr const char* ANDERSON_FIRMWARE_VERSION="4.5.0";', 'static constexpr const char* ANDERSON_FIRMWARE_VERSION="4.5.1";')

route_marker = '  server.on("/api/reboot",HTTP_POST,[]{'
backup_routes = r'''  server.on("/api/custom-settings-backup",HTTP_GET,[]{
    if(!requireAdmin())return;
    String lights=presetStoreRaw(),schedules=scheduleStoreRaw();
    if(!jsonArrayValid(lights)||!jsonArrayValid(schedules)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Custom settings storage is not valid JSON\"}");return;}
    String out=String("{\"format\":\"anderson-custom-settings\",\"schema\":1,\"firmware\":\"")+ANDERSON_FIRMWARE_VERSION+"\",\"customLights\":"+lights+",\"customSchedules\":"+schedules+"}";
    server.sendHeader("Cache-Control","no-store");
    server.sendHeader("Content-Disposition",String("attachment; filename=Anderson_Custom_Settings_")+ANDERSON_FIRMWARE_VERSION+".json");
    server.send(200,"application/json",out);
  });
  server.on("/api/custom-settings-backup",HTTP_POST,[]{
    if(!requireAdmin())return;
    JsonDocument d;if(!body(d))return;
    String format=d["format"].as<String>();int schema=d["schema"]|0;
    if(format!="anderson-custom-settings"||schema!=1||!d["customLights"].is<JsonArray>()||!d["customSchedules"].is<JsonArray>()){
      server.send(400,"application/json","{\"ok\":false,\"error\":\"Unsupported or invalid Anderson custom-settings backup\"}");return;
    }
    JsonArray lights=d["customLights"].as<JsonArray>(),schedules=d["customSchedules"].as<JsonArray>();
    if(lights.size()>12||schedules.size()>32){server.send(409,"application/json","{\"ok\":false,\"error\":\"Backup exceeds custom light or schedule capacity\"}");return;}
    for(JsonObject p:lights){String id=p["id"].as<String>();if(!id.startsWith("p")){server.send(400,"application/json","{\"ok\":false,\"error\":\"Backup contains an invalid custom-light ID\"}");return;}}
    for(JsonObject s:schedules){String id=s["id"].as<String>(),preset=s["presetId"].as<String>();bool found=false;for(JsonObject p:lights)if(p["id"].as<String>()==preset){found=true;break;}if(!id.startsWith("s")||!found){server.send(400,"application/json","{\"ok\":false,\"error\":\"Backup contains an invalid schedule link\"}");return;}}
    String newLights,newSchedules;serializeJson(lights,newLights);serializeJson(schedules,newSchedules);
    if(newLights.length()>3800||newSchedules.length()>3800){server.send(507,"application/json","{\"ok\":false,\"error\":\"Backup is too large for persistent custom settings storage\"}");return;}
    String oldLights=presetStoreRaw(),oldSchedules=scheduleStoreRaw();
    if(!customFileWrite("/custom_schedules.json",newSchedules)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Could not restore custom schedules\"}");return;}
    if(!customFileWrite("/custom_lights.json",newLights)){bool rolledBack=customFileWrite("/custom_schedules.json",oldSchedules);server.send(500,"application/json",rolledBack?"{\"ok\":false,\"error\":\"Custom lights restore failed; schedules were rolled back\"}":"{\"ok\":false,\"error\":\"Custom lights restore failed and schedule rollback also failed\"}");return;}
    if(!jsonArrayValid(presetStoreRaw())||!jsonArrayValid(scheduleStoreRaw())){customFileWrite("/custom_lights.json",oldLights);customFileWrite("/custom_schedules.json",oldSchedules);server.send(500,"application/json","{\"ok\":false,\"error\":\"Restore verification failed; previous settings were restored\"}");return;}
    customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;
    sendJson("{\"ok\":true,\"message\":\"Custom lights and schedules restored\"}");
  });
'''
main = replace_once(main, route_marker, backup_routes + route_marker, 'OTA route insertion')
MAIN.write_text(main)

web = WEB.read_text()
firmware_panel = '''    <div class="panel">\n      <strong>Firmware Update</strong>'''
backup_panel = '''    <div class="panel" id="customSettingsBackupPanel">\n      <strong>Save / Restore Custom Settings</strong><div class="sub">Back up your custom lights and custom schedules to a JSON file, or restore them later. Wi-Fi credentials and profile PINs are intentionally excluded.</div>\n      <button id="saveCustomSettingsBackup" class="btn primary" type="button" style="width:100%;margin-top:10px">Save Custom Settings Backup</button>\n      <div class="label">Restore backup JSON</div><input id="customSettingsRestoreFile" class="field" type="file" accept=".json,application/json">\n      <button id="restoreCustomSettingsBackup" class="btn" type="button" style="width:100%;margin-top:9px">Restore Custom Settings</button>\n      <div id="customSettingsBackupStatus" class="sub" style="margin-top:7px">Backup preserves custom-light IDs and their linked custom schedules.</div>\n    </div>\n\n'''
web = replace_once(web, firmware_panel, backup_panel + firmware_panel, 'settings backup panel')

js_anchor = "async function post(path,obj,timeoutMs=12000){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)},timeoutMs)}\n"
js_code = r'''async function saveCustomSettingsBackup(){
  const meta=$('customSettingsBackupStatus');
  try{meta.textContent='Creating backup…';const data=await api('/api/custom-settings-backup',{cache:'no-store'});const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);const stamp=new Date().toISOString().slice(0,10);a.download=`Anderson_Custom_Settings_${stamp}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500);meta.textContent=`Saved ${data.customLights?.length||0} custom lights and ${data.customSchedules?.length||0} custom schedules.`;status('Custom settings backup saved.');}catch(e){meta.textContent='Backup failed: '+e.message;status('Custom settings backup failed.');}
}
async function restoreCustomSettingsBackup(){
  const input=$('customSettingsRestoreFile'),meta=$('customSettingsBackupStatus'),file=input.files&&input.files[0];if(!file){meta.textContent='Choose an Anderson custom-settings JSON backup first.';return}
  try{const text=await file.text(),data=JSON.parse(text);if(data.format!=='anderson-custom-settings'||data.schema!==1)throw new Error('This is not a supported Anderson custom-settings backup');if(!confirm(`Restore ${data.customLights?.length||0} custom lights and ${data.customSchedules?.length||0} custom schedules? Current custom lights and schedules will be replaced.`))return;meta.textContent='Validating and restoring backup…';await post('/api/custom-settings-backup',data,20000);meta.textContent='Restore complete and verified.';status('Custom settings restored.');await Promise.all([loadCustomPresets(),loadCustomSchedules(),loadHomeCustomLights()]);}catch(e){meta.textContent='Restore failed: '+e.message;status('Custom settings restore failed.');}
}
$('saveCustomSettingsBackup').addEventListener('click',saveCustomSettingsBackup);
$('restoreCustomSettingsBackup').addEventListener('click',restoreCustomSettingsBackup);
'''
web = replace_once(web, js_anchor, js_anchor + js_code, 'backup UI javascript')
web = web.replace('<strong>v3.0.0</strong>', '<strong>v4.5.1</strong>')
WEB.write_text(web)
VERSION.write_text('4.5.1\n')
print('Applied Anderson Home 4.5.1 custom settings save/restore changes')
