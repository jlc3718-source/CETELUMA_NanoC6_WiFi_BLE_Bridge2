#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION = "3.1.13"

(ROOT / "FIRMWARE_VERSION.txt").write_text(VERSION + "\n")

# Runtime version + controller-side weekly settings backup/restore.
main = ROOT / "firmware/src/main.cpp"
s = main.read_text()
s, n = re.subn(
    r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="\d+\.\d+\.\d+[a-z]?";',
    f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{VERSION}";', s, count=1)
if n != 1:
    raise SystemExit("runtime version marker missing")

if "// ANDERSON_SETTINGS_BACKUP_V3_1_13" not in s:
    anchor = "void applyRunning(bool force=false){"
    if anchor not in s:
        raise SystemExit("applyRunning anchor missing")
    backup = r'''
// ANDERSON_SETTINGS_BACKUP_V3_1_13
static constexpr char SETTINGS_BACKUP_NS[]="anderson-bkup";
static constexpr uint32_t SETTINGS_BACKUP_WEEK_SECONDS=7UL*24UL*60UL*60UL;
enum : uint8_t {BACKUP_SCHEDULE=1U<<0,BACKUP_CONTROLLERS=1U<<1,BACKUP_CUSTOM=1U<<2,BACKUP_FAVORITES=1U<<3,BACKUP_EVENTS=1U<<4};
static constexpr uint8_t SETTINGS_BACKUP_DEFAULT_MASK=BACKUP_SCHEDULE|BACKUP_CONTROLLERS|BACKUP_CUSTOM|BACKUP_FAVORITES|BACKUP_EVENTS;
static uint32_t settingsBackupLastCheckMs=0;
static uint8_t settingsBackupMask(){Preferences p;if(!p.begin(SETTINGS_BACKUP_NS,true))return SETTINGS_BACKUP_DEFAULT_MASK;uint8_t mask=p.getUChar("mask",SETTINGS_BACKUP_DEFAULT_MASK);p.end();return mask&SETTINGS_BACKUP_DEFAULT_MASK;}
static bool settingsBackupSetMask(uint8_t mask){mask&=SETTINGS_BACKUP_DEFAULT_MASK;Preferences p;if(!p.begin(SETTINGS_BACKUP_NS,false))return false;size_t wrote=p.putUChar("mask",mask);bool ok=wrote>0&&p.getUChar("mask",0)==mask;p.end();return ok;}
static bool settingsBackupPutString(Preferences& p,const char* key,const String& value){size_t wrote=p.putString(key,value);return wrote==value.length()&&p.getString(key,"__verify__")==value;}
static bool settingsBackupPutU64(Preferences& p,const char* key,uint64_t value){size_t wrote=p.putULong64(key,value);return wrote>0&&p.getULong64(key,~value)==value;}
static bool createSettingsBackup(bool automatic){const uint8_t mask=settingsBackupMask();if(!mask)return false;bool ok=true;Preferences b;if(!b.begin(SETTINGS_BACKUP_NS,false))return false;b.putUChar("schema",1);b.putUChar("snapmask",mask);if(mask&BACKUP_SCHEDULE){auto&a=store.get();JsonDocument d;d["tz"]=a.tz;d["on"]=a.onMinutes;d["off"]=a.offMinutes;d["lead"]=a.leadDays;d["trail"]=a.trailDays;d["overlap"]=a.overlap;d["scheduler"]=a.schedulerEnabled;d["scheduler2"]=a.schedule2Enabled;String raw;serializeJson(d,raw);ok=settingsBackupPutString(b,"schedule",raw)&&ok;}if(mask&BACKUP_CONTROLLERS){auto&a=store.get();JsonDocument d;d["addr1"]=a.bleAddress;d["name1"]=a.bleName;d["proto1"]=a.bleProtocol;d["addr2"]=a.bleAddress2;d["name2"]=a.bleName2;d["proto2"]=a.bleProtocol2;d["pixels"]=a.pixelCount;String raw;serializeJson(d,raw);ok=settingsBackupPutString(b,"controllers",raw)&&ok;}if(mask&BACKUP_CUSTOM){ok=settingsBackupPutString(b,"lights",presetStoreRaw())&&ok;ok=settingsBackupPutString(b,"csched",scheduleStoreRaw())&&ok;}if(mask&BACKUP_FAVORITES){Preferences p;if(p.begin("anderson-colors",true)){String raw=p.getString("saved","[]");p.end();ok=settingsBackupPutString(b,"colors",raw)&&ok;}else ok=false;}if(mask&BACKUP_EVENTS){Preferences p;if(p.begin("anderson-evst",true)){for(size_t w=0;w<EVENT_STATE_WORDS;w++){String ek=String("en")+String((unsigned)w),fk=String("fav")+String((unsigned)w),bek=String("ben")+String((unsigned)w),bfk=String("bfv")+String((unsigned)w);ok=settingsBackupPutU64(b,bek.c_str(),p.getULong64(ek.c_str(),UINT64_MAX))&&ok;ok=settingsBackupPutU64(b,bfk.c_str(),p.getULong64(fk.c_str(),0))&&ok;}p.end();}else ok=false;Preferences e;if(e.begin("anderson-event",true)){for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++){String sk=String("e")+String((unsigned)i),dk=String("be")+String((unsigned)i);String raw=e.getString(sk.c_str(),"");if(raw.length())ok=settingsBackupPutString(b,dk.c_str(),raw)&&ok;else b.remove(dk.c_str());}e.end();}else ok=false;}uint64_t now=timeValid()?(uint64_t)time(nullptr):0;if(ok){ok=settingsBackupPutU64(b,"last",now)&&ok;if(automatic)ok=settingsBackupPutU64(b,"lastauto",now)&&ok;}b.putBool("lastok",ok);b.end();return ok;}
static bool restoreSettingsBackup(){Preferences b;if(!b.begin(SETTINGS_BACKUP_NS,true))return false;if(b.getUChar("schema",0)!=1||!b.isKey("last")){b.end();return false;}uint8_t mask=b.getUChar("snapmask",0)&SETTINGS_BACKUP_DEFAULT_MASK;bool ok=true;if(mask&BACKUP_SCHEDULE){String raw=b.getString("schedule","");JsonDocument d;if(deserializeJson(d,raw)||!d.is<JsonObject>())ok=false;else{AppSettings a=store.get();a.tz=d["tz"]|a.tz;a.onMinutes=d["on"]|a.onMinutes;a.offMinutes=d["off"]|a.offMinutes;a.leadDays=d["lead"]|a.leadDays;a.trailDays=d["trail"]|a.trailDays;a.overlap=d["overlap"]|a.overlap;a.schedulerEnabled=d["scheduler"]|a.schedulerEnabled;a.schedule2Enabled=d["scheduler2"]|a.schedule2Enabled;ok=store.saveSettings(a)&&ok;}}if(mask&BACKUP_CONTROLLERS){String raw=b.getString("controllers","");JsonDocument d;if(deserializeJson(d,raw)||!d.is<JsonObject>())ok=false;else{auto&a=store.get();a.bleAddress=d["addr1"]|String("");a.bleName=d["name1"]|String("");a.bleProtocol=d["proto1"]|0;a.bleAddress2=d["addr2"]|String("");a.bleName2=d["name2"]|String("");a.bleProtocol2=d["proto2"]|0;a.pixelCount=d["pixels"]|100;ok=store.saveBle()&&ok;}}if(mask&BACKUP_CUSTOM){String l=b.getString("lights","[]"),c=b.getString("csched","[]");if(!jsonArrayValid(l)||!jsonArrayValid(c))ok=false;else{ok=customFileWrite("/custom_lights.json",l)&&ok;ok=customFileWrite("/custom_schedules.json",c)&&ok;}}if(mask&BACKUP_FAVORITES){String raw=b.getString("colors","[]");JsonDocument d;if(deserializeJson(d,raw)||!d.is<JsonArray>())ok=false;else{Preferences p;if(p.begin("anderson-colors",false)){size_t wrote=p.putString("saved",raw);ok=(wrote==raw.length()&&p.getString("saved","")==raw)&&ok;p.end();}else ok=false;}}if(mask&BACKUP_EVENTS){Preferences p;if(p.begin("anderson-evst",false)){for(size_t w=0;w<EVENT_STATE_WORDS;w++){String ek=String("en")+String((unsigned)w),fk=String("fav")+String((unsigned)w),bek=String("ben")+String((unsigned)w),bfk=String("bfv")+String((unsigned)w);uint64_t en=b.getULong64(bek.c_str(),UINT64_MAX),fav=b.getULong64(bfk.c_str(),0);p.putULong64(ek.c_str(),en);p.putULong64(fk.c_str(),fav);ok=(p.getULong64(ek.c_str(),~en)==en&&p.getULong64(fk.c_str(),~fav)==fav)&&ok;}p.putUChar("rev",1);p.end();}else ok=false;Preferences e;if(e.begin("anderson-event",false)){e.clear();for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++){String sk=String("be")+String((unsigned)i),dk=String("e")+String((unsigned)i);if(!b.isKey(sk.c_str()))continue;String raw=b.getString(sk.c_str(),"");if(raw.length()){size_t wrote=e.putString(dk.c_str(),raw);ok=(wrote==raw.length()&&e.getString(dk.c_str(),"")==raw)&&ok;}}e.end();}else ok=false;}b.end();if(mask&BACKUP_EVENTS){eventStateBegin();loadEventOverrides();}if(mask&BACKUP_SCHEDULE)configTzTime(store.get().tz.c_str(),"pool.ntp.org","time.nist.gov");customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+250;return ok;}
static String settingsBackupStatusJson(){Preferences p;uint8_t mask=SETTINGS_BACKUP_DEFAULT_MASK,snap=0;uint64_t last=0,lastauto=0;bool good=false,has=false;if(p.begin(SETTINGS_BACKUP_NS,true)){mask=p.getUChar("mask",SETTINGS_BACKUP_DEFAULT_MASK)&SETTINGS_BACKUP_DEFAULT_MASK;snap=p.getUChar("snapmask",0)&SETTINGS_BACKUP_DEFAULT_MASK;last=p.getULong64("last",0);lastauto=p.getULong64("lastauto",0);good=p.getBool("lastok",false);has=p.getUChar("schema",0)==1&&p.isKey("last");p.end();}JsonDocument d;d["mask"]=mask;d["snapshotMask"]=snap;d["hasBackup"]=has;d["lastBackup"]=last;d["lastAutomatic"]=lastauto;d["nextAutomatic"]=lastauto?lastauto+SETTINGS_BACKUP_WEEK_SECONDS:0;d["intervalDays"]=7;d["lastOk"]=good;String out;serializeJson(d,out);return out;}
static void maybeWeeklySettingsBackup(){if(!timeValid()||Update.isRunning()||remoteUpdateOperationBusy())return;uint32_t ms=millis();if(settingsBackupLastCheckMs&&(uint32_t)(ms-settingsBackupLastCheckMs)<60000UL)return;settingsBackupLastCheckMs=ms;if(!settingsBackupMask())return;Preferences p;uint64_t lastauto=0;if(p.begin(SETTINGS_BACKUP_NS,true)){lastauto=p.getULong64("lastauto",0);p.end();}uint64_t now=(uint64_t)time(nullptr);if(!lastauto||now>=lastauto+SETTINGS_BACKUP_WEEK_SECONDS)createSettingsBackup(true);}

'''
    s = s.replace(anchor, backup + anchor, 1)

route_anchor = '  server.on("/api/settings",HTTP_POST,[]{'
if 'server.on("/api/backup/status"' not in s:
    if route_anchor not in s:
        raise SystemExit("settings route anchor missing")
    routes = r'''  server.on("/api/backup/status",HTTP_GET,[]{if(!requireAdmin())return;sendJson(settingsBackupStatusJson());});
  server.on("/api/backup/settings",HTTP_POST,[]{if(!requireAdmin())return;JsonDocument d;if(!body(d))return;int raw=d["mask"]|SETTINGS_BACKUP_DEFAULT_MASK;if(raw<0||raw>SETTINGS_BACKUP_DEFAULT_MASK){server.send(400,"application/json","{\"ok\":false,\"error\":\"Invalid backup selection\"}");return;}if(!settingsBackupSetMask((uint8_t)raw)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Backup selection could not be saved\"}");return;}sendJson(settingsBackupStatusJson());});
  server.on("/api/backup/manual",HTTP_POST,[]{if(!requireAdmin())return;JsonDocument d;if(server.arg("plain").length()&&!body(d))return;if(!d["mask"].isNull()&&!settingsBackupSetMask((uint8_t)constrain(d["mask"].as<int>(),0,(int)SETTINGS_BACKUP_DEFAULT_MASK))){server.send(500,"application/json","{\"ok\":false,\"error\":\"Backup selection could not be saved\"}");return;}if(!createSettingsBackup(false)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Manual backup failed\"}");return;}sendJson(settingsBackupStatusJson());});
  server.on("/api/backup/restore",HTTP_POST,[]{if(!requireAdmin())return;if(!restoreSettingsBackup()){server.send(500,"application/json","{\"ok\":false,\"error\":\"Backup restore failed or no backup is available\"}");return;}sendJson("{\"ok\":true,\"rebooting\":true}");delay(350);ESP.restart();});

'''
    s = s.replace(route_anchor, routes + route_anchor, 1)

loop_anchor='  maintainWiFiConnection();checkScheduledMaintenanceReboot();'
if loop_anchor in s:
    s=s.replace(loop_anchor,'  maintainWiFiConnection();maybeWeeklySettingsBackup();checkScheduledMaintenanceReboot();',1)
main.write_text(s)

# Remove Breath from every exposed path. Keep the enum value only as a legacy decoder value.
types = ROOT / 'firmware/include/Types.h'
t = types.read_text()
t = t.replace('case Effect::Breath: return "Breath";', 'case Effect::Breath: return "Jump";')
t = t.replace('if (s=="Breath" || s=="Pulse") return Effect::Breath;', 'if (s=="Breath" || s=="Pulse") return Effect::Jump;')
t = t.replace('if (s=="Gradient" || s=="Fade" || s=="Rainbow" || s=="Fire" || s=="Water") return Effect::Breath;', 'if (s=="Gradient" || s=="Fade" || s=="Rainbow" || s=="Fire" || s=="Water") return Effect::Jump;')
types.write_text(t)

catalog = ROOT / 'firmware/src/EventCatalog.cpp'
if catalog.exists():
    c = catalog.read_text().replace('Effect::Breath', 'Effect::Jump')
    catalog.write_text(c)

# Tighten dual-controller synchronization: every software-effect frame is reliably
# reasserted to both connected targets, and legacy Breath is normalized to Jump.
ble = ROOT / 'firmware/src/BleController.cpp'
b = ble.read_text()
b = b.replace('  bool changed=!activeValid||activeTheme.name!=t.name||activeTheme.effect!=t.effect||activeTheme.colorCount!=t.colorCount||activeBrightness!=bright||activeSpeed!=speedLevel;', '  Theme normalized=t;if(normalized.effect==Effect::Breath)normalized.effect=Effect::Jump;const Theme& syncTheme=normalized;\n  bool changed=!activeValid||activeTheme.name!=syncTheme.name||activeTheme.effect!=syncTheme.effect||activeTheme.colorCount!=syncTheme.colorCount||activeBrightness!=bright||activeSpeed!=speedLevel;')
b = b.replace('if(!changed)for(uint8_t i=0;i<t.colorCount&&i<8;i++)if(activeTheme.colors[i]!=t.colors[i]){changed=true;break;}', 'if(!changed)for(uint8_t i=0;i<syncTheme.colorCount&&i<8;i++)if(activeTheme.colors[i]!=syncTheme.colors[i]){changed=true;break;}')
b = b.replace('if(starting){activeTheme=t;', 'if(starting){activeTheme=syncTheme;')
b = b.replace('uint8_t count=max((uint8_t)1,t.colorCount);', 'uint8_t count=max((uint8_t)1,syncTheme.colorCount);')
b = b.replace('if(t.effect==Effect::Solid)', 'if(syncTheme.effect==Effect::Solid)')
b = b.replace('setColor(t.colors[0],true);', 'setColor(syncTheme.colors[0],true);')
b = b.replace('if(t.effect==Effect::Jump&&count==1)', 'if(syncTheme.effect==Effect::Jump&&count==1)')
b = b.replace('if(t.effect!=Effect::Breath)setBrightness(bright,true);', 'setBrightness(bright,true);')
b = b.replace('if(t.effect==Effect::Jump){if(!force&&nowMs-lastEffect<interval)return;lastEffect=nowMs;uint32_t step=(nowMs/interval)%count;setColor(t.colors[step],starting);return;}', 'if(syncTheme.effect==Effect::Jump){if(!force&&nowMs-lastEffect<interval)return;lastEffect=nowMs;uint32_t step=(nowMs/interval)%count;setColor(syncTheme.colors[step],true);return;}')
b = b.replace('if(t.effect==Effect::Strobe){uint32_t half=max((uint32_t)45,interval/2);if(!force&&nowMs-lastEffect<half)return;lastEffect=nowMs;uint32_t phase=nowMs/half;if((phase&1)==0)setColor(0x000000,false);else setColor(t.colors[(phase/2)%count],starting);return;}', 'if(syncTheme.effect==Effect::Strobe){uint32_t half=max((uint32_t)45,interval/2);if(!force&&nowMs-lastEffect<half)return;lastEffect=nowMs;uint32_t phase=nowMs/half;if((phase&1)==0)setColor(0x000000,true);else setColor(syncTheme.colors[(phase/2)%count],true);return;}')
# Remove the legacy Breath renderer entirely; normalization above handles old saved values.
b = re.sub(r'\n  if\(t\.effect==Effect::Breath\)\{.*?\n\}', '\n}', b, count=1, flags=re.S)
ble.write_text(b)

# UI: dedicated Backup & Restore tab, blue background, no Breath option.
index = ROOT / 'firmware/web/index.html'
h = index.read_text()
h = re.sub(r'<option[^>]*value=["\']Breath["\'][^>]*>.*?</option>', '', h, flags=re.I|re.S)
h = h.replace("['Jump','Breath','Strobe','Solid']", "['Jump','Strobe','Solid']")
index.write_text(h)

js_path = ROOT / 'firmware/web/v3_mockup.js'
js = js_path.read_text()
js = js.replace("const values=['Jump','Breath','Strobe','Solid'];", "const values=['Jump','Strobe','Solid'];")
js = js.replace("Breath:'Breath',", "")
js = js.replace("Breath:'Gently fades in and out',", "")
js = js.replace("}else if(effect==='Breath'){", "}else if(effect==='__REMOVED_BREATH__'){")
if 'ANDERSON_BACKUP_RESTORE_UI_V3_1_13' not in js:
    helper = r'''
  /* ANDERSON_BACKUP_RESTORE_UI_V3_1_13 */
  const backupCategories=[['schedule','Scheduling & timezone',1],['controllers','Light controllers',2],['custom','Custom shows & schedules',4],['favorites','Favorite colors',8],['events','Events & favorites',16]];
  function backupMaskFromUi(){return backupCategories.reduce((m,[id,,bit])=>m+(byId('backup-'+id)?.checked?bit:0),0)}
  function backupDate(epoch){if(!epoch)return 'Not yet';try{return new Date(epoch*1000).toLocaleString()}catch(_){return 'Unknown'}}
  async function refreshBackupStatus(){const line=byId('backupStatus');if(!line)return;try{const d=await api('/api/backup/status',{cache:'no-store'});backupCategories.forEach(([id,,bit])=>{const box=byId('backup-'+id);if(box)box.checked=!!(d.mask&bit)});byId('backupLast').textContent=d.hasBackup?backupDate(d.lastBackup):'No backup saved yet';byId('backupNext').textContent=d.lastAutomatic?backupDate(d.nextAutomatic):'Will run after time sync';byId('backupRestore').disabled=!d.hasBackup;line.textContent=d.lastOk||!d.hasBackup?'Weekly automatic backup is enabled for the selected settings.':'The last backup attempt did not complete.'}catch(e){line.textContent='Backup status is available to Jason only.'}}
  function buildBackupPane(root){if(!root||byId('backupSettingsPanel'))return;const panel=el('div','panel');panel.id='backupSettingsPanel';panel.innerHTML=`<strong>Custom Settings Backup</strong><div class="sub">Choose what Anderson Home protects. The controller automatically saves these settings once a week. Wi-Fi passwords and profile PINs are intentionally excluded.</div><div class="v3BackupChoices">${backupCategories.map(([id,label])=>`<label class="v3BackupChoice"><input id="backup-${id}" type="checkbox"><span>${label}</span></label>`).join('')}</div><div class="v3BackupMeta"><div><span>Last backup</span><strong id="backupLast">Loading…</strong></div><div><span>Next automatic</span><strong id="backupNext">Loading…</strong></div></div><div class="row wraprow v3BackupActions"><button id="backupSaveSelection" class="btn" type="button">Save Selection</button><button id="backupNow" class="btn primary" type="button">Back Up Now</button><button id="backupRestore" class="btn" type="button">Restore Last Backup</button></div><div id="backupStatus" class="sub">Loading backup status…</div>`;root.appendChild(panel);byId('backupSaveSelection').addEventListener('click',async()=>{try{await post('/api/backup/settings',{mask:backupMaskFromUi()});status('Backup selection saved.');await refreshBackupStatus()}catch(e){status('Could not save backup selection: '+e.message)}});byId('backupNow').addEventListener('click',async()=>{try{byId('backupNow').disabled=true;await post('/api/backup/manual',{mask:backupMaskFromUi()});status('Custom settings backup saved.');await refreshBackupStatus()}catch(e){status('Manual backup failed: '+e.message)}finally{byId('backupNow').disabled=false}});byId('backupRestore').addEventListener('click',async()=>{if(!confirm('Restore the last saved Anderson Home settings backup? The controller will reboot after restore.'))return;try{byId('backupRestore').disabled=true;await post('/api/backup/restore',{});status('Backup restored. Anderson Home is rebooting…');setTimeout(()=>location.reload(),5000)}catch(e){status('Restore failed: '+e.message);byId('backupRestore').disabled=false}});refreshBackupStatus();}
'''
    anchor='  function settingsSubTabs() {'
    if anchor not in js: raise SystemExit('settings tab function missing')
    js=js.replace(anchor,helper+anchor,1)
    old="const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['security','Users & Security'],['firmware','Firmware']];"
    new="const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['backup','Backup & Restore'],['security','Users & Security'],['firmware','Firmware']];"
    if old not in js: raise SystemExit('settings tab list missing')
    js=js.replace(old,new,1)
    pane_anchor="    defs.forEach(([id])=>page.appendChild(panes.get(id)));"
    js=js.replace(pane_anchor,pane_anchor+"\n    buildBackupPane(panes.get('backup'));",1)
js_path.write_text(js)

css_path = ROOT / 'firmware/web/v3_mockup.css'
css = css_path.read_text()
if 'ANDERSON_BLUE_BACKGROUND_V3_1_13' not in css:
    css += '''\n/* ANDERSON_BLUE_BACKGROUND_V3_1_13 */\nhtml,body{background:#0a3f88!important;background-image:linear-gradient(160deg,#0f5fc4 0%,#0a3f88 48%,#03142b 100%)!important;background-attachment:fixed!important}.v3BackupChoices{display:grid;gap:9px;margin:16px 0}.v3BackupChoice{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid #79bde63a;border-radius:13px;background:#07142699}.v3BackupChoice input{width:18px;height:18px}.v3BackupMeta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0}.v3BackupMeta>div{padding:11px 12px;border-radius:13px;background:#06111fbd;border:1px solid #79bde62c}.v3BackupMeta span{display:block;color:#8ba7bf;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.v3BackupMeta strong{display:block;margin-top:4px;font-size:13px}.v3BackupActions{gap:8px}@media(max-width:520px){.v3BackupMeta{grid-template-columns:1fr}.v3BackupActions .btn{width:100%}}\n'''
css_path.write_text(css)

notes = ROOT / 'firmware/RELEASE_NOTES_v3.1.13.md'
notes.write_text('''# Anderson Home v3.1.13\n\n- Restores the blue Anderson Home background.\n- Adds a dedicated Backup & Restore tab with user-selectable weekly automatic backup, manual backup, and manual restore.\n- Excludes Wi-Fi passwords and profile PINs from backups.\n- Removes Breath from the user-visible effect set and maps all legacy/saved Breath effects to Jump.\n- Converts built-in Breath event effects to Jump.\n- Improves dual-controller synchronization by reliably reasserting every Jump/Strobe software-effect frame to both connected controllers.\n- Preserves signed OTA verification and APP-only update behavior.\n''')

readme = ROOT / 'README.md'
if readme.exists():
    r=readme.read_text()
    r=re.sub(r'Current firmware: \*\*v\d+\.\d+\.\d+[a-z]?\*\*\.',f'Current firmware: **v{VERSION}**.',r,count=1)
    readme.write_text(r)

print('Applied Anderson Home v3.1.13 backup/blue/no-Breath/controller-sync changes')
