from pathlib import Path
import re

ROOT = Path('.')

def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one literal match, found {text.count(old)}')
    return text.replace(old, new, 1)

def regex_once(text, pattern, repl, label, flags=0):
    out, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return out

# AppSettings.
p = ROOT / 'firmware/include/Types.h'
t = p.read_text()
t = replace_once(
    t,
    '  bool schedule2Enabled = true;\n',
    '  bool schedule2Enabled = true;\n'
    '  bool schedule1StartAtDusk = false;\n'
    '  uint16_t schedule2EndMinutes = 6 * 60;\n'
    '  bool schedule2EndAtDawn = true;\n'
    '  uint8_t schedule2Brightness = 10;\n',
    'Types.h schedule settings')
p.write_text(t)

# NVS load/save.
p = ROOT / 'firmware/src/SettingsStore.cpp'
t = p.read_text()
t = replace_once(
    t,
    '  s.schedulerEnabled=prefs.getBool("sched",true);s.schedule2Enabled=prefs.getBool("sched2",true);s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);s.favoriteMask=prefs.getULong64("favorite",(1ULL<<26)|(1ULL<<27)|(1ULL<<29));\n',
    '  s.schedulerEnabled=prefs.getBool("sched",true);s.schedule2Enabled=prefs.getBool("sched2",true);s.schedule1StartAtDusk=prefs.getBool("s1dusk",false);s.schedule2EndMinutes=prefs.getUShort("s2end",6*60);s.schedule2EndAtDawn=prefs.getBool("s2dawn",true);s.schedule2Brightness=prefs.getUChar("s2bright",10);if(s.schedule2EndMinutes>=1440)s.schedule2EndMinutes=6*60;if(s.schedule2Brightness<1||s.schedule2Brightness>100)s.schedule2Brightness=10;s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);s.favoriteMask=prefs.getULong64("favorite",(1ULL<<26)|(1ULL<<27)|(1ULL<<29));\n',
    'SettingsStore load')
t = replace_once(
    t,
    'bool SettingsStore::writeSettings(const AppSettings& v){return putStringChecked(prefs,"tz",v.tz)&&putUShortChecked(prefs,"on",v.onMinutes)&&putUShortChecked(prefs,"off",v.offMinutes)&&putUCharChecked(prefs,"lead",v.leadDays)&&putUCharChecked(prefs,"trail",v.trailDays)&&putUCharChecked(prefs,"overlap",v.overlap)&&putBoolChecked(prefs,"sched",v.schedulerEnabled)&&putBoolChecked(prefs,"sched2",v.schedule2Enabled);}\n',
    'bool SettingsStore::writeSettings(const AppSettings& v){return putStringChecked(prefs,"tz",v.tz)&&putUShortChecked(prefs,"on",v.onMinutes)&&putUShortChecked(prefs,"off",v.offMinutes)&&putUCharChecked(prefs,"lead",v.leadDays)&&putUCharChecked(prefs,"trail",v.trailDays)&&putUCharChecked(prefs,"overlap",v.overlap)&&putBoolChecked(prefs,"sched",v.schedulerEnabled)&&putBoolChecked(prefs,"sched2",v.schedule2Enabled)&&putBoolChecked(prefs,"s1dusk",v.schedule1StartAtDusk)&&putUShortChecked(prefs,"s2end",v.schedule2EndMinutes)&&putBoolChecked(prefs,"s2dawn",v.schedule2EndAtDawn)&&putUCharChecked(prefs,"s2bright",v.schedule2Brightness);}\n',
    'SettingsStore save')
p.write_text(t)

# Scheduler header.
p = ROOT / 'firmware/include/Scheduler.h'
t = p.read_text()
t = replace_once(
    t,
    '  uint16_t civilDawnMinutes(const tm& local) const;\n',
    '  uint16_t civilDawnMinutes(const tm& local) const;\n  uint16_t civilDuskMinutes(const tm& local) const;\n',
    'Scheduler.h civil dusk')
p.write_text(t)

# Scheduler behavior.
p = ROOT / 'firmware/src/Scheduler.cpp'
t = p.read_text()
t = replace_once(
    t,
    'static constexpr double ANDERSON_LATITUDE_DEG=42.16;\nstatic constexpr double ANDERSON_LONGITUDE_DEG=-78.97;\n',
    'static constexpr double ANDERSON_LATITUDE_DEG=42.0529; // ZIP 14738 (Frewsburg, NY) center\nstatic constexpr double ANDERSON_LONGITUDE_DEG=-79.0576;\n',
    'Scheduler ZIP coordinates')
anchor = 'static int localDaysInMonth(int y,int m){static const uint8_t days[]={31,28,31,30,31,30,31,31,30,31,30,31};return m==2?days[1]+(localLeapYear(y)?1:0):days[m-1];}\n'
helper = r'''static uint16_t civilSolarEventMinutes(const tm& l,bool dawn){
  const int year=l.tm_year+1900,yday=l.tm_yday,offset=localUtcOffsetMinutes(l);
  struct SolarCache{int year=-1,yday=-1,offset=99999;uint16_t minutes=0;};
  static SolarCache cache[2];
  SolarCache& c=cache[dawn?0:1];
  if(c.year==year&&c.yday==yday&&c.offset==offset)return c.minutes;
  const int n=l.tm_yday+1;const double lngHour=ANDERSON_LONGITUDE_DEG/15.0,approxHour=dawn?6.0:18.0,t=n+((approxHour-lngHour)/24.0),M=0.9856*t-3.289;
  double L=normalizeDegrees(M+1.916*sin(M*RAD_PER_DEG)+0.020*sin(2.0*M*RAD_PER_DEG)+282.634),RA=normalizeDegrees(atan(0.91764*tan(L*RAD_PER_DEG))/RAD_PER_DEG);
  const double lq=floor(L/90.0)*90.0,rq=floor(RA/90.0)*90.0;RA=(RA+(lq-rq))/15.0;
  const double sd=0.39782*sin(L*RAD_PER_DEG),cd=cos(asin(sd)),ch=(cos(CIVIL_DAWN_ZENITH_DEG*RAD_PER_DEG)-sd*sin(ANDERSON_LATITUDE_DEG*RAD_PER_DEG))/(cd*cos(ANDERSON_LATITUDE_DEG*RAD_PER_DEG));
  uint16_t minutes=dawn?360:18*60;
  if(ch<=1.0&&ch>=-1.0){
    const double hDeg=dawn?360.0-(acos(ch)/RAD_PER_DEG):(acos(ch)/RAD_PER_DEG),H=hDeg/15.0,lh=normalizeHours(H+RA-(0.06571*t)-6.622-lngHour+(offset/60.0));
    int m=(int)lround(lh*60.0);if(m>=1440)m-=1440;if(m<0)m+=1440;minutes=(uint16_t)m;
  }
  c.year=year;c.yday=yday;c.offset=offset;c.minutes=minutes;return minutes;
}
static uint16_t schedule1StartMinutes(const tm& l,const AppSettings* cfg){return cfg->schedule1StartAtDusk?civilSolarEventMinutes(l,false):cfg->onMinutes;}
'''
t = replace_once(t, anchor, anchor + helper, 'Scheduler solar helper')
t = replace_once(t, 'onSec=(int)cfg->onMinutes*60', 'onSec=(int)schedule1StartMinutes(l,cfg)*60', 'Scheduler schedulePosition start')
t = t.replace(
    'Schedule 2 clamps\n// to the final Schedule-1 slot, preserving the last scene overnight at 30%.',
    'Schedule 2 clamps\n// to the final Schedule-1 slot, preserving the last scene at the configured overnight brightness.')
t = replace_once(
    t,
    'int m=l.tm_hour*60+l.tm_min,a=cfg->onMinutes,b=cfg->offMinutes;',
    'int m=l.tm_hour*60+l.tm_min,a=schedule1StartMinutes(l,cfg),b=cfg->offMinutes;',
    'Scheduler run window start')
t = regex_once(
    t,
    r'uint16_t Scheduler::civilDawnMinutes\(const tm& l\) const\{.*?\}\nbool Scheduler::inSchedule2Window',
    'uint16_t Scheduler::civilDawnMinutes(const tm& l) const{return civilSolarEventMinutes(l,true);}\n'
    'uint16_t Scheduler::civilDuskMinutes(const tm& l) const{return civilSolarEventMinutes(l,false);}\n'
    'bool Scheduler::inSchedule2Window',
    'Scheduler civil dawn/dusk implementation',
    re.S)
t = replace_once(
    t,
    'int m=l.tm_hour*60+l.tm_min,a=cfg->offMinutes,b=civilDawnMinutes(l);',
    'int m=l.tm_hour*60+l.tm_min,a=cfg->offMinutes,b=cfg->schedule2EndAtDawn?civilDawnMinutes(l):cfg->schedule2EndMinutes;',
    'Scheduler Schedule 2 end')
p.write_text(t)

# Backend state, API, persistence backup, runtime.
p = ROOT / 'firmware/src/main.cpp'
t = p.read_text()
state_pattern = r'  auto&s=store\.get\(\);JsonObject cfg=d\["settings"\]\.to<JsonObject>\(\);.*?\n  JsonObject w='
state_repl = r'''  auto&s=store.get();JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;cfg["scheduler2"]=s.schedule2Enabled;cfg["schedule1StartAtDusk"]=s.schedule1StartAtDusk;cfg["schedule2End"]=fmtTime(s.schedule2EndMinutes);cfg["schedule2EndAtDawn"]=s.schedule2EndAtDawn;cfg["schedule2Brightness"]=s.schedule2Brightness;
  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);uint16_t dawn=scheduler.civilDawnMinutes(l),dusk=scheduler.civilDuskMinutes(l);cfg["dawn"]=fmtTime(dawn);cfg["dusk"]=fmtTime(dusk);String s1Start=s.schedule1StartAtDusk?(String("dusk (")+fmtTime(dusk)+")"):fmtTime(s.onMinutes),s2End=s.schedule2EndAtDawn?(String("dawn (")+fmtTime(dawn)+")"):fmtTime(s.schedule2EndMinutes);d["scheduleWindow"]=String("Schedule 1 ")+s1Start+" - "+fmtTime(s.offMinutes)+" • Schedule 2 "+fmtTime(s.offMinutes)+" - "+s2End+" at "+String(s.schedule2Brightness)+"%";d["nextEvent"]=scheduler.nextEventLabel(l);}else{String s1Start=s.schedule1StartAtDusk?"dusk":fmtTime(s.onMinutes),s2End=s.schedule2EndAtDawn?"dawn":fmtTime(s.schedule2EndMinutes);d["scheduleWindow"]=String("Schedule 1 ")+s1Start+" - "+fmtTime(s.offMinutes)+" • Schedule 2 "+fmtTime(s.offMinutes)+" - "+s2End+" at "+String(s.schedule2Brightness)+"%";d["nextEvent"]="Waiting for time sync";}
  JsonObject w='''
t = regex_once(t, state_pattern, state_repl, 'main stateJson schedule block', re.S)
t = replace_once(
    t,
    '  tm themeLocal=l;if(schedule2Active&&!schedule1Active){uint16_t dawn=scheduler.civilDawnMinutes(l);int mins=l.tm_hour*60+l.tm_min;if(mins<dawn){themeLocal.tm_mday-=1;themeLocal.tm_isdst=-1;mktime(&themeLocal);}}\n',
    '  tm themeLocal=l;if(schedule2Active&&!schedule1Active){int mins=l.tm_hour*60+l.tm_min;uint16_t schedule1Start=s.schedule1StartAtDusk?scheduler.civilDuskMinutes(l):s.onMinutes;if(mins<schedule1Start){themeLocal.tm_mday-=1;themeLocal.tm_isdst=-1;mktime(&themeLocal);}}\n',
    'main Schedule 2 prior-day theme')
t = replace_once(
    t,
    'if(schedule2Active&&!schedule1Active)brightness=10;',
    'if(schedule2Active&&!schedule1Active)brightness=s.schedule2Brightness;',
    'main Schedule 2 brightness')

validate_pattern = r'static bool settingsBackupValidateSchedule\(const String& raw\)\{.*?\}\nstatic bool settingsBackupValidateControllers'
validate_repl = r'''static bool settingsBackupValidateSchedule(const String& raw){JsonDocument d;if(deserializeJson(d,raw)||!d.is<JsonObject>())return false;String tz=d["tz"]|String("");int on=d["on"]|-1,off=d["off"]|-1,lead=d["lead"]|-1,trail=d["trail"]|-1,overlap=d["overlap"]|-1,s2end=d["schedule2End"]|360,s2bright=d["schedule2Brightness"]|10;String theme=d["eventColorTheme"]|String("");return tz.length()>0&&tz.length()<=80&&on>=0&&on<1440&&off>=0&&off<1440&&lead>=0&&lead<=14&&trail>=0&&trail<=7&&overlap>=0&&overlap<=2&&s2end>=0&&s2end<1440&&s2bright>=1&&s2bright<=100&&!d["scheduler"].isNull()&&!d["scheduler2"].isNull()&&settingsBackupKnownTheme(theme);}
static bool settingsBackupValidateControllers'''
t = regex_once(t, validate_pattern, validate_repl, 'backup schedule validation', re.S)
t = replace_once(
    t,
    'x["scheduler"]=a.schedulerEnabled;x["scheduler2"]=a.schedule2Enabled;x["eventColorTheme"]=eventColorThemeId(activeEventColorTheme);',
    'x["scheduler"]=a.schedulerEnabled;x["scheduler2"]=a.schedule2Enabled;x["schedule1StartAtDusk"]=a.schedule1StartAtDusk;x["schedule2End"]=a.schedule2EndMinutes;x["schedule2EndAtDawn"]=a.schedule2EndAtDawn;x["schedule2Brightness"]=a.schedule2Brightness;x["eventColorTheme"]=eventColorThemeId(activeEventColorTheme);',
    'backup schedule capture')
t = replace_once(
    t,
    'a.schedulerEnabled=x["scheduler"]|a.schedulerEnabled;a.schedule2Enabled=x["scheduler2"]|a.schedule2Enabled;String theme=x["eventColorTheme"]|String("");',
    'a.schedulerEnabled=x["scheduler"]|a.schedulerEnabled;a.schedule2Enabled=x["scheduler2"]|a.schedule2Enabled;a.schedule1StartAtDusk=x["schedule1StartAtDusk"]|a.schedule1StartAtDusk;a.schedule2EndMinutes=x["schedule2End"]|a.schedule2EndMinutes;a.schedule2EndAtDawn=x["schedule2EndAtDawn"]|a.schedule2EndAtDawn;a.schedule2Brightness=x["schedule2Brightness"]|a.schedule2Brightness;String theme=x["eventColorTheme"]|String("");',
    'backup schedule restore')
t = replace_once(
    t,
    'bool adminChange=!d["overlap"].isNull()||!d["on"].isNull()||!d["off"].isNull()||!d["lead"].isNull()||!d["trail"].isNull()||!d["tz"].isNull();',
    'bool adminChange=!d["overlap"].isNull()||!d["on"].isNull()||!d["off"].isNull()||!d["lead"].isNull()||!d["trail"].isNull()||!d["tz"].isNull()||!d["schedule1Dusk"].isNull()||!d["schedule2End"].isNull()||!d["schedule2Dawn"].isNull()||!d["schedule2Brightness"].isNull();',
    'settings API admin guard')
t = replace_once(
    t,
    'if(!d["tz"].isNull())next.tz=d["tz"].as<String>();if(!d["scheduler"].isNull())next.schedulerEnabled=d["scheduler"].as<bool>();if(!d["scheduler2"].isNull())next.schedule2Enabled=d["scheduler2"].as<bool>();',
    'if(!d["tz"].isNull())next.tz=d["tz"].as<String>();if(!d["scheduler"].isNull())next.schedulerEnabled=d["scheduler"].as<bool>();if(!d["scheduler2"].isNull())next.schedule2Enabled=d["scheduler2"].as<bool>();if(!d["schedule1Dusk"].isNull())next.schedule1StartAtDusk=d["schedule1Dusk"].as<bool>();if(!d["schedule2End"].isNull())next.schedule2EndMinutes=parseTime(d["schedule2End"].as<String>(),next.schedule2EndMinutes);if(!d["schedule2Dawn"].isNull())next.schedule2EndAtDawn=d["schedule2Dawn"].as<bool>();if(!d["schedule2Brightness"].isNull())next.schedule2Brightness=constrain(d["schedule2Brightness"].as<int>(),1,100);',
    'settings API new fields')
p.write_text(t)

# Web UI.
p = ROOT / 'firmware/web/index.html'
t = p.read_text()
block_start = '    <div class="panel">\n      <strong>Scheduling Rules</strong>'
block_tail = '      <div class="grid2"><div><div class="label">Holiday starts before</div>'
start = t.index(block_start)
tail = t.index(block_tail, start)
new_prefix = '''    <div class="panel">
      <strong>Scheduling Rules</strong>
      <div class="note"><strong>Schedule 1</strong> can start at a fixed time or automatically at civil dusk for ZIP 14738. <strong>Schedule 2</strong> starts at Schedule 1's END time, keeps the same scheduled scene at its own brightness, and can end at a fixed time or automatically at civil dawn for ZIP 14738.</div>
      <div class="grid2" style="margin-top:10px"><label class="card row between" style="cursor:pointer"><span><strong>Schedule 1</strong><br><span class="sub">Normal evening schedule</span></span><input id="eventsMaster" type="checkbox" checked aria-label="Enable Schedule 1"></label><label class="card row between" style="cursor:pointer"><span><strong>Schedule 2</strong><br><span class="sub">Overnight continuation</span></span><input id="schedule2Master" type="checkbox" checked aria-label="Enable Schedule 2"></label></div>
      <div class="grid2" style="margin-top:10px"><div><div class="label">Schedule 1 START mode</div><select id="schedule1StartMode" class="field"><option value="fixed">Fixed time</option><option value="dusk">Dusk — automatic for 14738</option></select></div><div><div class="label">Schedule 1 fixed START</div><input id="onTime" type="time" value="17:00" class="field"></div></div>
      <div><div class="label">Schedule 1 END / Schedule 2 START</div><input id="offTime" type="time" value="23:00" class="field"></div>
      <div class="grid2" style="margin-top:10px"><div><div class="label">Schedule 2 END mode</div><select id="schedule2EndMode" class="field"><option value="dawn">Dawn — automatic for 14738</option><option value="fixed">Fixed time</option></select></div><div><div class="label">Schedule 2 fixed END</div><input id="schedule2EndTime" type="time" value="06:00" class="field"></div></div>
      <div class="label">Schedule 2 brightness <span id="schedule2BrightnessVal" class="muted">10%</span></div><input id="schedule2Brightness" type="range" min="1" max="100" step="1" value="10">
      <div class="card small" style="margin-top:9px"><strong>Schedule 2:</strong> <span id="schedule2Summary">Starts at Schedule 1 end • 10% • ends at dawn</span><br><span class="sub">Automatic dawn/dusk location: ZIP 14738 (Frewsburg, NY).</span></div>
'''
t = t[:start] + new_prefix + t[tail:]

t = replace_once(
    t,
    'const settingsDirty=new Set,trackedSettings=["onTime","offTime","leadDays","trailDays","overlapMode","tz"];',
    'const settingsDirty=new Set,trackedSettings=["schedule1StartMode","onTime","offTime","schedule2EndMode","schedule2EndTime","schedule2Brightness","leadDays","trailDays","overlapMode","tz"];',
    'UI tracked settings')

apply_anchor = 'function setSettingIfClean(e,t){const n=$(e);n&&!settingsDirty.has(e)&&null!=t&&(n.value=String(t))}function applyState(e){if(!e)return;'
apply_insert = '''function setSettingIfClean(e,t){const n=$(e);n&&!settingsDirty.has(e)&&null!=t&&(n.value=String(t))}function updateScheduleModeUi(){const e=$("schedule1StartMode"),t=$("schedule2EndMode"),n=$("schedule2Brightness");$("onTime")&&e&&($("onTime").disabled="dusk"===e.value),$("schedule2EndTime")&&t&&($("schedule2EndTime").disabled="dawn"===t.value),$("schedule2BrightnessVal")&&n&&($("schedule2BrightnessVal").textContent=n.value+"%")}function applyState(e){if(!e)return;'''
t = replace_once(t, apply_anchor, apply_insert, 'UI schedule mode helper')

settings_pattern = r'e\.settings&&\("boolean"==typeof e\.settings\.scheduler.*?overlapHelp\(\)\),power='
settings_repl = '''e.settings&&("boolean"==typeof e.settings.scheduler&&($("eventsMaster").checked=e.settings.scheduler),"boolean"==typeof e.settings.scheduler2&&($("schedule2Master").checked=e.settings.scheduler2),setSettingIfClean("schedule1StartMode",e.settings.schedule1StartAtDusk?"dusk":"fixed"),setSettingIfClean("onTime",e.settings.on),setSettingIfClean("offTime",e.settings.off),setSettingIfClean("schedule2EndMode",e.settings.schedule2EndAtDawn?"dawn":"fixed"),setSettingIfClean("schedule2EndTime",e.settings.schedule2End),setSettingIfClean("schedule2Brightness",e.settings.schedule2Brightness??10),setSettingIfClean("leadDays",e.settings.lead),setSettingIfClean("trailDays",e.settings.trail),setSettingIfClean("overlapMode",["rotate","split","combine"][Number(e.settings.overlap)]||"rotate"),setSettingIfClean("tz",e.settings.tz),updateScheduleModeUi(),$("schedule2Summary")&&($("schedule2Summary").textContent=`Starts ${e.settings.off||"at Schedule 1 end"} • ${e.settings.schedule2Brightness??10}% • ends ${e.settings.schedule2EndAtDawn?`dawn${e.settings.dawn?" ("+e.settings.dawn+")":""}`:e.settings.schedule2End||"fixed time"}`),overlapHelp()),power='''
t = regex_once(t, settings_pattern, settings_repl, 'UI applyState settings', re.S)

t = replace_once(
    t,
    '$("overlapMode").addEventListener("change",overlapHelp),overlapHelp(),$("saveSettings").addEventListener',
    '$("overlapMode").addEventListener("change",overlapHelp),["schedule1StartMode","schedule2EndMode"].forEach(e=>$(e).addEventListener("change",updateScheduleModeUi)),$("schedule2Brightness").addEventListener("input",updateScheduleModeUi),overlapHelp(),updateScheduleModeUi(),$("saveSettings").addEventListener',
    'UI schedule listeners')

save_pattern = r'\$\("saveSettings"\)\.addEventListener\("click",async\(\)=>\{.*?\}\),\$\("eventsMaster"\)'
save_repl = '''$("saveSettings").addEventListener("click",async()=>{const e={overlap:$("overlapMode").value,schedule1StartMode:$("schedule1StartMode").value,on:$("onTime").value,off:$("offTime").value,schedule2EndMode:$("schedule2EndMode").value,schedule2End:$("schedule2EndTime").value,schedule2Brightness:$("schedule2Brightness").value,lead:$("leadDays").value,trail:$("trailDays").value,tz:$("tz").value},t={overlap:e.overlap,on:e.on,off:e.off,lead:+e.lead,trail:+e.trail,tz:e.tz,scheduler:$("eventsMaster").checked,scheduler2:$("schedule2Master").checked,schedule1Dusk:"dusk"===e.schedule1StartMode,schedule2End:e.schedule2End,schedule2Dawn:"dawn"===e.schedule2EndMode,schedule2Brightness:+e.schedule2Brightness};try{const n=await post("/api/settings",t),o={overlapMode:"overlap",schedule1StartMode:"schedule1StartMode",onTime:"on",offTime:"off",schedule2EndMode:"schedule2EndMode",schedule2EndTime:"schedule2End",schedule2Brightness:"schedule2Brightness",leadDays:"lead",trailDays:"trail",tz:"tz"};Object.entries(o).forEach(([t,n])=>{String($(t).value)===String(e[n])&&settingsDirty.delete(t)}),applyState(n),status("Schedule 1 and Schedule 2 settings saved and confirmed by the NanoC6.")}catch(e){status(API_MODE?"Settings failed: "+e.message:"Preview mode — settings simulated.")}}),$("eventsMaster")'''
t = regex_once(t, save_pattern, save_repl, 'UI save settings handler', re.S)
p.write_text(t)

# Version bump.
(ROOT / 'FIRMWARE_VERSION.txt').write_text('3.1.42\n')
p = ROOT / 'firmware/src/main.cpp'
t = p.read_text()
t = regex_once(
    t,
    r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="\d+\.\d+\.\d+[a-z]?";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.42";',
    'runtime version')
p.write_text(t)

# Focused validation.
types = (ROOT/'firmware/include/Types.h').read_text()
sched = (ROOT/'firmware/src/Scheduler.cpp').read_text()
main = (ROOT/'firmware/src/main.cpp').read_text()
ui = (ROOT/'firmware/web/index.html').read_text()
store = (ROOT/'firmware/src/SettingsStore.cpp').read_text()
assert 'schedule2Brightness = 10' in types
assert 's2bright' in store and 's2dawn' in store and 's1dusk' in store
assert '42.0529' in sched and '-79.0576' in sched and 'civilDuskMinutes' in sched
assert 'brightness=s.schedule2Brightness' in main
assert 'schedule2EndAtDawn' in main and 'schedule1StartAtDusk' in main
for token in ('schedule1StartMode','schedule2EndMode','schedule2EndTime','schedule2Brightness'):
    assert token in ui, token
assert 'ZIP 14738' in ui
assert (ROOT/'FIRMWARE_VERSION.txt').read_text().strip() == '3.1.42'
print('Focused Schedule 1/2 patch validation passed.')
