from pathlib import Path
import re


def replace(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n < count:
        raise SystemExit(f"{path}: expected at least {count} matches, found {n} for {old[:100]!r}")
    p.write_text(s.replace(old, new, count))


# Version.
Path("FIRMWARE_VERSION.txt").write_text("3.0.23\n")

# Schedule 2 setting is independent of the existing Schedule 1 setting.
replace(
    "firmware/include/Types.h",
    "  bool schedulerEnabled = true;\n",
    "  bool schedulerEnabled = true;\n  bool schedule2Enabled = true;\n",
)
replace(
    "firmware/src/SettingsStore.cpp",
    '  s.schedulerEnabled=prefs.getBool("sched",true); s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);\n',
    '  s.schedulerEnabled=prefs.getBool("sched",true); s.schedule2Enabled=prefs.getBool("sched2",true); s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);\n',
)
replace(
    "firmware/src/SettingsStore.cpp",
    '  prefs.putUChar("overlap",s.overlap);prefs.putBool("sched",s.schedulerEnabled);prefs.putULong64("enabled",s.enabledMask);prefs.putULong64("favorite",s.favoriteMask);\n',
    '  prefs.putUChar("overlap",s.overlap);prefs.putBool("sched",s.schedulerEnabled);prefs.putBool("sched2",s.schedule2Enabled);prefs.putULong64("enabled",s.enabledMask);prefs.putULong64("favorite",s.favoriteMask);\n',
)

replace(
    "firmware/include/Scheduler.h",
    "  bool inRunWindow(const tm& local) const;\n  String nextEventLabel(const tm& local) const;\n",
    "  bool inRunWindow(const tm& local) const;\n  bool inSchedule2Window(const tm& local) const;\n  uint16_t civilDawnMinutes(const tm& local) const;\n  String nextEventLabel(const tm& local) const;\n",
)

# Locally calculate civil dawn for the Anderson Home installation area.
p = Path("firmware/src/Scheduler.cpp")
s = p.read_text().replace("#include <vector>\n", "#include <vector>\n#include <math.h>\n", 1)
old = '''bool Scheduler::inRunWindow(const tm& l) const{\n  int m=l.tm_hour*60+l.tm_min,a=cfg->onMinutes,b=cfg->offMinutes;\n  if(a==b)return true;if(a<b)return m>=a&&m<b;return m>=a||m<b;\n}\nTheme Scheduler::resolve(const tm& l){\n  Theme normal;normal.name="Warm White";normal.effect=Effect::Solid;normal.colors[0]=0xFFFFFA;normal.colorCount=1;\n  if(!cfg->schedulerEnabled)return normal;\n'''
new = '''static constexpr double ANDERSON_LATITUDE_DEG=42.16;\nstatic constexpr double ANDERSON_LONGITUDE_DEG=-78.97;\nstatic constexpr double CIVIL_DAWN_ZENITH_DEG=96.0;\nstatic constexpr double DEG_TO_RAD=3.14159265358979323846/180.0;\n\nstatic double normalizeDegrees(double v){while(v<0.0)v+=360.0;while(v>=360.0)v-=360.0;return v;}\nstatic double normalizeHours(double v){while(v<0.0)v+=24.0;while(v>=24.0)v-=24.0;return v;}\nstatic int localUtcOffsetMinutes(const tm& l){\n  time_t epoch=time(nullptr);tm utc{};gmtime_r(&epoch,&utc);\n  int localMin=l.tm_hour*60+l.tm_min,utcMin=utc.tm_hour*60+utc.tm_min;\n  int dayDiff=l.tm_yday-utc.tm_yday;if(dayDiff>1)dayDiff=-1;else if(dayDiff<-1)dayDiff=1;\n  return constrain(localMin-utcMin+dayDiff*1440,-840,840);\n}\n\nbool Scheduler::inRunWindow(const tm& l) const{\n  int m=l.tm_hour*60+l.tm_min,a=cfg->onMinutes,b=cfg->offMinutes;\n  if(a==b)return true;if(a<b)return m>=a&&m<b;return m>=a||m<b;\n}\nuint16_t Scheduler::civilDawnMinutes(const tm& l) const{\n  const int n=l.tm_yday+1;const double lngHour=ANDERSON_LONGITUDE_DEG/15.0;\n  const double t=n+((6.0-lngHour)/24.0),M=0.9856*t-3.289;\n  double L=normalizeDegrees(M+1.916*sin(M*DEG_TO_RAD)+0.020*sin(2.0*M*DEG_TO_RAD)+282.634);\n  double RA=normalizeDegrees(atan(0.91764*tan(L*DEG_TO_RAD))/DEG_TO_RAD);\n  const double lQuadrant=floor(L/90.0)*90.0,raQuadrant=floor(RA/90.0)*90.0;RA=(RA+(lQuadrant-raQuadrant))/15.0;\n  const double sinDec=0.39782*sin(L*DEG_TO_RAD),cosDec=cos(asin(sinDec));\n  const double cosH=(cos(CIVIL_DAWN_ZENITH_DEG*DEG_TO_RAD)-sinDec*sin(ANDERSON_LATITUDE_DEG*DEG_TO_RAD))/(cosDec*cos(ANDERSON_LATITUDE_DEG*DEG_TO_RAD));\n  if(cosH>1.0||cosH<-1.0)return 6*60;\n  const double H=(360.0-(acos(cosH)/DEG_TO_RAD))/15.0;\n  const double localHours=normalizeHours(H+RA-(0.06571*t)-6.622-lngHour+(localUtcOffsetMinutes(l)/60.0));\n  int minutes=(int)lround(localHours*60.0);if(minutes>=1440)minutes-=1440;if(minutes<0)minutes+=1440;return (uint16_t)minutes;\n}\nbool Scheduler::inSchedule2Window(const tm& l) const{\n  int m=l.tm_hour*60+l.tm_min,a=cfg->offMinutes,b=civilDawnMinutes(l);\n  if(a==b)return false;if(a<b)return m>=a&&m<b;return m>=a||m<b;\n}\nTheme Scheduler::resolve(const tm& l){\n  Theme normal;normal.name="Warm White";normal.effect=Effect::Solid;normal.colors[0]=0xFFFFFA;normal.colorCount=1;\n'''
if old not in s:
    raise SystemExit("Scheduler.cpp schedule core not found")
p.write_text(s.replace(old, new, 1))

# Firmware/API behavior.
p = Path("firmware/src/main.cpp")
s = p.read_text()
s = s.replace('static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.22";', 'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.23";', 1)

# Force one new seed pass so controllers already on v3.0.22 receive the approved 28 Home favorites.
s = s.replace('if(!marker.begin("anderson",true))return false;uint8_t rev=marker.getUChar("calendarrev",0);marker.end();if(rev>=2)return true;\n  if(!clearCustomPresetFavorites())return false;', 'if(!marker.begin("anderson",true))return false;uint8_t rev=marker.getUChar("calendarrev",0);marker.end();if(rev>=3)return true;\n  if(!clearCustomPresetFavorites())return false;', 1)
s = s.replace('marker.putUChar("calendarrev",2);bool ok=marker.getUChar("calendarrev",0)==2;', 'marker.putUChar("calendarrev",3);bool ok=marker.getUChar("calendarrev",0)==3;', 1)

old = '''  auto&s=store.get();d["scheduleWindow"]="Scheduled "+fmtTime(s.onMinutes)+" – "+fmtTime(s.offMinutes);JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;\n  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);d["nextEvent"]=scheduler.nextEventLabel(l);}else d["nextEvent"]="Waiting for time sync";\n'''
new = '''  auto&s=store.get();JsonObject cfg=d["settings"].to<JsonObject>();cfg["on"]=fmtTime(s.onMinutes);cfg["off"]=fmtTime(s.offMinutes);cfg["lead"]=s.leadDays;cfg["trail"]=s.trailDays;cfg["overlap"]=s.overlap;cfg["tz"]=s.tz;cfg["scheduler"]=s.schedulerEnabled;cfg["scheduler2"]=s.schedule2Enabled;cfg["schedule2Brightness"]=30;\n  tm l{};if(timeValid()){time_t n=time(nullptr);localtime_r(&n,&l);uint16_t dawn=scheduler.civilDawnMinutes(l);cfg["dawn"]=fmtTime(dawn);d["scheduleWindow"]=String("Schedule 1 ")+fmtTime(s.onMinutes)+" - "+fmtTime(s.offMinutes)+" • Schedule 2 "+fmtTime(s.offMinutes)+" - dawn ("+fmtTime(dawn)+") at 30%";d["nextEvent"]=scheduler.nextEventLabel(l);}else{d["scheduleWindow"]=String("Schedule 1 ")+fmtTime(s.onMinutes)+" - "+fmtTime(s.offMinutes)+" • Schedule 2 "+fmtTime(s.offMinutes)+" - dawn at 30%";d["nextEvent"]="Waiting for time sync";}\n'''
if old not in s:
    raise SystemExit("main.cpp stateJson schedule block not found")
s = s.replace(old, new, 1)

old = '''void evaluateSchedule(bool force=false){\n  if(manualOverride||!timeValid())return;tm l{};time_t n=time(nullptr);localtime_r(&n,&l);\n  ble.setTarget(0);brightness=100;speedLevel=1;bool should=scheduler.inRunWindow(l)&&store.get().schedulerEnabled;if(!should){if(power){power=false;ble.setPower(false);}return;}\n  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(l,t,cb,cs)){brightness=cb;speedLevel=cs;}else{scheduledEventSpeedHint=1;t=scheduler.resolve(l);speedLevel=scheduledEventSpeedHint;}bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);\n}\n'''
new = '''void evaluateSchedule(bool force=false){\n  if(manualOverride||!timeValid())return;tm l{};time_t n=time(nullptr);localtime_r(&n,&l);auto&s=store.get();uint8_t previousBrightness=brightness,previousSpeed=speedLevel;\n  ble.setTarget(0);brightness=100;speedLevel=1;bool schedule1Active=s.schedulerEnabled&&scheduler.inRunWindow(l);bool schedule2Active=s.schedule2Enabled&&scheduler.inSchedule2Window(l);if(!schedule1Active&&!schedule2Active){if(power){power=false;ble.setPower(false);}return;}\n  tm themeLocal=l;if(schedule2Active&&!schedule1Active){uint16_t dawn=scheduler.civilDawnMinutes(l);int mins=l.tm_hour*60+l.tm_min;if(mins<dawn){themeLocal.tm_mday-=1;themeLocal.tm_isdst=-1;mktime(&themeLocal);}}\n  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(themeLocal,t,cb,cs)){brightness=cb;speedLevel=cs;}else{scheduledEventSpeedHint=1;t=scheduler.resolve(themeLocal);speedLevel=scheduledEventSpeedHint;}if(schedule2Active&&!schedule1Active)brightness=30;bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect||previousBrightness!=brightness||previousSpeed!=speedLevel;power=true;runningTheme=t;if(changed||force)applyRunning(true);\n}\n'''
if old not in s:
    raise SystemExit("main.cpp evaluateSchedule block not found")
s = s.replace(old, new, 1)

old = '''    if(!d["tz"].isNull()){s.tz=d["tz"].as<String>();configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}\n    if(!d["scheduler"].isNull())s.schedulerEnabled=d["scheduler"].as<bool>();\n    store.saveAll();sendJson(stateJson());\n'''
new = '''    if(!d["tz"].isNull()){s.tz=d["tz"].as<String>();configTzTime(s.tz.c_str(),"pool.ntp.org","time.nist.gov");}\n    if(!d["scheduler"].isNull())s.schedulerEnabled=d["scheduler"].as<bool>();\n    if(!d["scheduler2"].isNull())s.schedule2Enabled=d["scheduler2"].as<bool>();\n    store.saveAll();sendJson(stateJson());\n'''
if old not in s:
    raise SystemExit("main.cpp settings handler block not found")
s = s.replace(old, new, 1)
p.write_text(s)

# Built-in preset defaults only: cap all current event preset speeds at Slow (2).
# Manual/custom speed controls remain 1..5 and are intentionally not clamped.
p = Path("firmware/src/EventCatalog.cpp")
s = p.read_text()
m = re.search(r"(static const uint8_t EVENT_SPEEDS\[\] = \{\n)(.*?)(\n\};)", s, re.S)
if not m:
    raise SystemExit("EVENT_SPEEDS table not found")
values = [int(x) for x in re.findall(r"\d+", m.group(2))]
if len(values) != 210:
    raise SystemExit(f"expected 210 preset speeds, found {len(values)}")
values = [min(v, 2) for v in values]
body = "  " + ", ".join(str(v) for v in values)
s = s[:m.start()] + m.group(1) + body + m.group(3) + s[m.end():]
p.write_text(s)

# UI: two independent schedule toggles and linked Schedule 2 summary.
p = Path("firmware/web/index.html")
s = p.read_text()
old = '''      <div class="row between wraprow"><div><strong>Events This Month</strong><div class="sub">Enable schedules and mark Home favorites.</div></div><label class="row"><input id="eventsMaster" type="checkbox" checked><span class="small">Scheduler on</span></label></div>'''
new = '''      <div class="row between wraprow"><div><strong>Events This Month</strong><div class="sub">Enable schedules and mark Home favorites.</div></div><div class="row wraprow"><label class="row"><input id="eventsMaster" type="checkbox" checked><span class="small">Schedule 1</span></label><label class="row"><input id="schedule2Master" type="checkbox" checked><span class="small">Schedule 2</span></label></div></div>'''
if old not in s:
    raise SystemExit("index events scheduler block not found")
s = s.replace(old, new, 1)
old = '''      <strong>Scheduling Rules</strong>\n      <div class="grid2" style="margin-top:10px"><div><div class="label">Lights ON</div><input id="onTime" type="time" value="17:00" class="field"></div><div><div class="label">Lights OFF</div><input id="offTime" type="time" value="23:00" class="field"></div></div>'''
new = '''      <strong>Scheduling Rules</strong>\n      <div class="note"><strong>Schedule 1</strong> uses the ON and END times below. <strong>Schedule 2</strong> starts automatically at Schedule 1's END time, keeps the same scheduled scene at 30% brightness, and turns off at locally calculated civil dawn. Schedule 1 and Schedule 2 can be enabled or disabled independently.</div>\n      <div class="grid2" style="margin-top:10px"><div><div class="label">Schedule 1 ON</div><input id="onTime" type="time" value="17:00" class="field"></div><div><div class="label">Schedule 1 END / Schedule 2 START</div><input id="offTime" type="time" value="23:00" class="field"></div></div>\n      <div class="card small" style="margin-top:9px"><strong>Schedule 2:</strong> <span id="schedule2Summary">Starts at Schedule 1 end • 30% • ends at dawn</span></div>'''
if old not in s:
    raise SystemExit("index Scheduling Rules block not found")
s = s.replace(old, new, 1)
old = '''function applyState(s){if(!s)return;/* ANDERSON_SETTINGS_TIME_SYNC */if(s.settings){if(typeof s.settings.scheduler==='boolean')$('eventsMaster').checked=s.settings.scheduler;const ts=document.querySelectorAll('input[type="time"]');'''
new = '''function applyState(s){if(!s)return;/* ANDERSON_SETTINGS_TIME_SYNC */if(s.settings){if(typeof s.settings.scheduler==='boolean')$('eventsMaster').checked=s.settings.scheduler;if(typeof s.settings.scheduler2==='boolean'&&$('schedule2Master'))$('schedule2Master').checked=s.settings.scheduler2;if($('schedule2Summary'))$('schedule2Summary').textContent=`Starts ${s.settings.off||'at Schedule 1 end'} • ${s.settings.schedule2Brightness||30}% • ends at dawn${s.settings.dawn?' ('+s.settings.dawn+')':''}`;const ts=document.querySelectorAll('input[type="time"]');'''
if old not in s:
    raise SystemExit("index applyState block not found")
s = s.replace(old, new, 1)
old = '''$('saveSettings').addEventListener('click',async()=>{const o={overlap:$('overlapMode').value,on:$('onTime').value,off:$('offTime').value,lead:+$('leadDays').value,trail:+$('trailDays').value,tz:$('tz').value,scheduler:$('eventsMaster').checked};try{const saved=await post('/api/settings',o);applyState(saved);status('Settings saved. Lights ON and OFF times confirmed by the NanoC6.')}catch(e){status(API_MODE?'Settings failed: '+e.message:'Preview mode — settings simulated.')}});\n$('eventsMaster').addEventListener('change',()=>post('/api/settings',{scheduler:$('eventsMaster').checked}).catch(()=>{}));\n'''
new = '''$('saveSettings').addEventListener('click',async()=>{const o={overlap:$('overlapMode').value,on:$('onTime').value,off:$('offTime').value,lead:+$('leadDays').value,trail:+$('trailDays').value,tz:$('tz').value,scheduler:$('eventsMaster').checked,scheduler2:$('schedule2Master').checked};try{const saved=await post('/api/settings',o);applyState(saved);status('Schedule 1 and Schedule 2 settings saved and confirmed by the NanoC6.')}catch(e){status(API_MODE?'Settings failed: '+e.message:'Preview mode — settings simulated.')}});\n$('eventsMaster').addEventListener('change',()=>post('/api/settings',{scheduler:$('eventsMaster').checked}).then(applyState).catch(()=>{}));\n$('schedule2Master').addEventListener('change',()=>post('/api/settings',{scheduler2:$('schedule2Master').checked}).then(applyState).catch(()=>{}));\n'''
if old not in s:
    raise SystemExit("index saveSettings block not found")
s = s.replace(old, new, 1)
p.write_text(s)

# Expand run cleanup beyond only build/publish workflows. Keep unrelated app workflows out.
p = Path(".github/scripts/anderson-retention.sh")
s = p.read_text()
old = '''is_kept_run() {\n  local id="$1" keep\n  for keep in "${KEEP_RUN_IDS[@]:-}"; do\n    [[ "$id" == "$keep" ]] && return 0\n  done\n  return 1\n}\n'''
new = '''is_kept_run() {\n  local id="$1" keep\n  [[ "$id" == "$CURRENT_RUN_ID" ]] && return 0\n  for keep in "${KEEP_RUN_IDS[@]:-}"; do\n    [[ "$id" == "$keep" ]] && return 0\n  done\n  return 1\n}\n'''
if old not in s:
    raise SystemExit("retention keep function not found")
s = s.replace(old, new, 1)
old = '''# Remove older completed production firmware runs and completed release helpers.\n# Separate Android/test workflows are outside this production retention policy.\nmapfile -t COMPLETED_RUN_IDS < <(\n  gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \\\n    --jq ".workflow_runs[] | select(.status == \\\"completed\\\" and (.name == \\\"$BUILD_WORKFLOW_NAME\\\" or .name == \\\"$LEGACY_BUILD_WORKFLOW_NAME\\\" or (.name | startswith(\\\"Publish Anderson Home\\\")))) | .id"\n)\n'''
new = '''# Remove older completed Anderson firmware runs and one-off firmware helper runs.\n# Keep unrelated Android/test/Pages workflows outside this firmware retention policy.\nmapfile -t COMPLETED_RUN_IDS < <(\n  gh api --paginate "/repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" \\\n    --jq ".workflow_runs[] | select(.status == \\\"completed\\\" and (.name == \\\"$BUILD_WORKFLOW_NAME\\\" or .name == \\\"$LEGACY_BUILD_WORKFLOW_NAME\\\" or (.name | startswith(\\\"Publish Anderson Home\\\")) or (.name | startswith(\\\"Patch Anderson Home\\\")) or (.name | startswith(\\\"Stage Anderson Home\\\")) or (.name | startswith(\\\"Cleanup Anderson\\\")) or .name == \\\"Anderson Retention\\\" or (.head_branch // \\\"\\\" | startswith(\\\"codex/v3.\\\")) or (.head_branch // \\\"\\\" | startswith(\\\"publish/v3.\\\")) or (.head_branch // \\\"\\\" | startswith(\\\"staging/v3.\\\")))) | .id"\n)\n'''
if old not in s:
    raise SystemExit("retention completed-runs block not found")
p.write_text(s.replace(old, new, 1))

# Release notes.
Path("firmware/RELEASE_NOTES_v3.0.23.md").write_text("""# Anderson Home v3.0.23\n\n- Existing automatic lighting window is named Schedule 1.\n- Adds independent Schedule 2: starts at Schedule 1 END, runs the same scheduled scene at exactly 30% brightness, and turns off at locally calculated civil dawn.\n- Schedule 1 and Schedule 2 can be enabled or disabled independently.\n- Overnight Schedule 2 continues the prior evening's scheduled event/scene through dawn.\n- Re-seeds the approved 28 Home Scene Favorites once on upgrade so v3.0.22 installations receive them.\n- All 210 built-in event preset speed defaults are Very Slow or Slow; no built-in preset ships faster than Slow. Manual/custom controls still allow all five speed levels.\n- Expands firmware GitHub Actions retention to remove old patch/stage/publish/cleanup runs while leaving unrelated workflows alone.\n- Preserves the 210-event calendar, locked 9-color master palette, Wi-Fi, BLE, PINs, custom lights/schedules, partitions, and signed OTA trust.\n""")

# Assertions.
checks = {
    "firmware/include/Types.h": ["schedule2Enabled = true"],
    "firmware/src/Scheduler.cpp": ["civilDawnMinutes", "inSchedule2Window", "CIVIL_DAWN_ZENITH_DEG=96.0"],
    "firmware/src/main.cpp": ['ANDERSON_FIRMWARE_VERSION="3.0.23"', 'rev>=3', 'calendarrev",3', "scheduler2", "brightness=30"],
    "firmware/web/index.html": ["Schedule 1 END / Schedule 2 START", "schedule2Master", "ends at dawn"],
    ".github/scripts/anderson-retention.sh": ["Patch Anderson Home", "Cleanup Anderson", "staging/v3."],
}
for path, needles in checks.items():
    txt = Path(path).read_text()
    for needle in needles:
        if needle not in txt:
            raise SystemExit(f"{path}: missing {needle}")

# Verify the preset table really is capped at 2, while UI still offers 1..5.
event_txt = Path("firmware/src/EventCatalog.cpp").read_text()
m = re.search(r"static const uint8_t EVENT_SPEEDS\[\] = \{\n(.*?)\n\};", event_txt, re.S)
vals = [int(x) for x in re.findall(r"\d+", m.group(1))]
assert len(vals) == 210 and max(vals) <= 2
ui = Path("firmware/web/index.html").read_text()
assert 'type="range" min="1" max="5"' in ui
