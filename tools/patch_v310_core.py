from pathlib import Path
import re, subprocess

ROOT=Path('.')

def read(p): return (ROOT/p).read_text()
def write(p,s): (ROOT/p).write_text(s)
def rep(s,old,new,label):
    if old not in s: raise AssertionError(f'{label}: target not found')
    if s.count(old)!=1: raise AssertionError(f'{label}: target count {s.count(old)}')
    return s.replace(old,new,1)

def parse_event_colors(text):
    out={}
    rx=re.compile(r'^\{"evt(\d{3})".*?,Effect::[A-Za-z]+,C([1-6])\(([^)]*)\),(\d+)\s*\},\s*$',re.M)
    for m in rx.finditer(text):
        n=int(m.group(1)); c=int(m.group(2)); tail=int(m.group(4))
        vals=[int(x.strip(),16) for x in m.group(3).split(',') if x.strip()]
        assert c==tail==len(vals),(n,c,tail,vals)
        out[n]=vals
    assert len(out)==210, len(out)
    assert set(out)==set(range(1,211))
    return out

# --- Generate compact exact v3.0.28 Original Colors table ---
original_path=Path('/tmp/EventCatalog_v3028.cpp')
if not original_path.exists():
    raise AssertionError('workflow must provide /tmp/EventCatalog_v3028.cpp')
orig=parse_event_colors(original_path.read_text())
modern=parse_event_colors(read('firmware/src/EventCatalog.cpp'))

hdr='''#pragma once\n#include <Arduino.h>\n#include "Types.h"\n\nenum class EventColorTheme : uint8_t { Original=0, Modern=1 };\nconst char* eventColorThemeName(EventColorTheme theme);\nvoid applyOriginalEventColors(size_t index, Theme& theme);\n'''
write('firmware/include/EventColorThemes.h',hdr)

unique=[]
for n in range(1,211):
    for c in orig[n]:
        if c not in unique: unique.append(c)
assert len(unique)<256
idx={c:i for i,c in enumerate(unique)}
rows=[]; counts=[]
for n in range(1,211):
    vals=[idx[c] for c in orig[n]]; counts.append(len(vals)); vals += [0]*(6-len(vals))
    rows.append('  {'+','.join(str(v) for v in vals)+'}')
src='''#include "EventColorThemes.h"\n\nstatic constexpr uint32_t ORIGINAL_COLOR_DICTIONARY[] = {\n  %s\n};\nstatic constexpr uint8_t ORIGINAL_EVENT_COLOR_INDEX[210][6] = {\n%s\n};\nstatic constexpr uint8_t ORIGINAL_EVENT_COLOR_COUNT[210] = {\n  %s\n};\n\nconst char* eventColorThemeName(EventColorTheme theme){return theme==EventColorTheme::Original?"Original Colors":"Modern Colors";}\nvoid applyOriginalEventColors(size_t index, Theme& theme){\n  if(index>=210)return;uint8_t count=ORIGINAL_EVENT_COLOR_COUNT[index];theme.colorCount=count;\n  for(uint8_t i=0;i<count;i++)theme.colors[i]=ORIGINAL_COLOR_DICTIONARY[ORIGINAL_EVENT_COLOR_INDEX[index][i]];\n}\n''' % (','.join(f'0x{c:06X}' for c in unique), ',\n'.join(rows), ','.join(map(str,counts)))
write('firmware/src/EventColorThemes.cpp',src)

# --- Types: retire Gradient while preserving Solid numeric value ---
p='firmware/include/Types.h'; s=read(p)
s=rep(s,'enum class Effect : uint8_t { Jump, Breath, Strobe, Gradient, Solid };','enum class Effect : uint8_t { Jump=0, Breath=1, Strobe=2, Solid=4 };','Effect enum')
s=s.replace('    case Effect::Gradient: return "Gradient";\n','')
s=rep(s,'  if (s=="Gradient" || s=="Fade" || s=="Rainbow" || s=="Fire" || s=="Water") return Effect::Gradient;','  if (s=="Gradient" || s=="Fade" || s=="Rainbow" || s=="Fire" || s=="Water") return Effect::Breath;','legacy Gradient map')
write(p,s)

# --- Built-in events: all former Gradient effects become Breath; extend variable dates ---
p='firmware/src/EventCatalog.cpp'; s=read(p)
s=s.replace('Effect::Gradient','Effect::Breath')
# add missing authoritative/validated dates through scheduler look-ahead year 2037
additions={
28:[(2037,2,15)],
30:[(2037,10,11)],
47:[(2037,11,9)],
63:[(2027,4,21),(2028,4,10),(2029,3,30),(2030,4,17),(2031,4,7),(2032,3,26),(2033,4,13),(2034,4,3),(2035,4,23),(2036,4,11),(2037,3,30)],
69:[(2033,4,26),(2034,4,17),(2035,5,7),(2036,4,24),(2037,4,13)],
96:[(2037,1,27)],
148:[(2027,10,2),(2028,9,21),(2029,9,10),(2030,9,28),(2031,9,18),(2032,9,6),(2033,9,24),(2034,9,14),(2035,10,4),(2036,9,22),(2037,9,10)],
153:[(2027,10,11),(2028,9,30),(2029,9,19),(2030,10,7),(2031,9,27),(2032,9,15),(2033,10,3),(2034,9,23),(2035,10,13),(2036,10,1),(2037,9,19)],
177:[(2031,10,25),(2032,10,14),(2033,10,3),(2034,10,22),(2035,10,11),(2036,9,29),(2037,10,18)],
192:[(2031,11,14),(2032,11,2),(2033,10,22),(2034,11,10),(2035,10,30),(2036,10,18),(2037,11,7)],
}
anchor='  {"evt202",2045,12,5},\n};'
if anchor not in s: raise AssertionError('SPECIAL_DATES anchor not found')
extra=[]
for eid,items in additions.items():
    for y,m,d in items:
        row=f'  {{"evt{eid:03d}",{y},{m},{d}}},'
        if row not in s: extra.append(row)
s=s.replace(anchor,'  {"evt202",2045,12,5},\n'+'\n'.join(extra)+'\n};',1)

# Civil-date helpers replace 86400-second date stepping so DST boundaries are safe.
rx=re.compile(r'bool eventOccursInMonth\(size_t i,int year,int month\)\{.*?\n\}\n\nbool eventActiveOn\(size_t i,const tm& local\)\{.*?\n\}\n\nbool eventWindowActiveOn\(size_t i,const tm& local,uint8_t lead,uint8_t trail\)\{.*?\n\}\n',re.S)
new='''static bool shiftedLocalDate(time_t start,int offset,int& year,int& month,int& day){\n  if(!start)return false;tm t{};localtime_r(&start,&t);t.tm_mday+=offset;t.tm_hour=12;t.tm_min=0;t.tm_sec=0;t.tm_isdst=-1;if(mktime(&t)==(time_t)-1)return false;year=t.tm_year+1900;month=t.tm_mon+1;day=t.tm_mday;return true;\n}\nstatic bool shiftedDateEquals(time_t start,int offset,int year,int month,int day){int y=0,m=0,d=0;return shiftedLocalDate(start,offset,y,m,d)&&y==year&&m==month&&d==day;}\n\nbool eventOccursInMonth(size_t i,int year,int month){\n  if(i>=EVENT_COUNT)return false;const auto&e=EVENTS[i];if(e.rule==RuleType::Month)return e.month==month;\n  for(int sy=year-1;sy<=year;sy++){time_t start=eventStartEpoch(i,sy);if(!start)continue;for(int k=0;k<max(1,(int)e.durationDays);k++){int y=0,m=0,d=0;if(shiftedLocalDate(start,k,y,m,d)&&y==year&&m==month)return true;}}return false;\n}\n\nbool eventActiveOn(size_t i,const tm& local){\n  if(i>=EVENT_COUNT)return false;const auto&e=EVENTS[i];int y=local.tm_year+1900,m=local.tm_mon+1,d=local.tm_mday;if(e.rule==RuleType::Month)return e.month==m;\n  for(int sy=y-1;sy<=y;sy++){time_t start=eventStartEpoch(i,sy);if(!start)continue;for(int k=0;k<max(1,(int)e.durationDays);k++)if(shiftedDateEquals(start,k,y,m,d))return true;}return false;\n}\n\nbool eventWindowActiveOn(size_t i,const tm& local,uint8_t lead,uint8_t trail){\n  if(i>=EVENT_COUNT||EVENTS[i].kind!=EventKind::Holiday||EVENTS[i].rule==RuleType::Month)return false;\n  int y=local.tm_year+1900,m=local.tm_mon+1,d=local.tm_mday,duration=max(1,(int)EVENTS[i].durationDays);\n  if(eventActiveOn(i,local))return false;\n  for(int sy=y-1;sy<=y+1;sy++){time_t start=eventStartEpoch(i,sy);if(!start)continue;for(int k=-(int)lead;k<duration+(int)trail;k++){if(k>=0&&k<duration)continue;if(shiftedDateEquals(start,k,y,m,d))return true;}}return false;\n}\n'''
s,n=rx.subn(new,s,count=1); assert n==1,'event date functions replacement failed'
write(p,s)

# --- Scheduler: priority-correct, bounded storage, no Gradient combine ---
p='firmware/src/Scheduler.cpp'; s=read(p)
s=s.replace('#include <vector>\n','')
start=s.index('Theme Scheduler::resolve(const tm& l){')
end=s.index('\nString Scheduler::nextEventLabel',start)
new_resolve='''Theme Scheduler::resolve(const tm& l){\n  Theme normal;normal.name="Warm White";normal.effect=Effect::Solid;normal.colors[0]=0xFFFFFA;normal.colorCount=1;\n  int exactHoliday=-1,exactOther=-1,holidayWindow=-1,seasonal=-1;size_t monthly[64];size_t monthlyCount=0;\n  for(size_t i=0;i<EVENT_COUNT;i++){\n    if(i>=MAX_BUILTIN_EVENTS||!eventStateEnabled(i))continue;const auto&e=EVENTS[i];bool active=eventActiveOn(i,l);\n    if(active){\n      if(e.kind==EventKind::Seasonal){if(seasonal<0)seasonal=(int)i;continue;}\n      if(e.rule==RuleType::Month){if(monthlyCount<64)monthly[monthlyCount++]=i;continue;}\n      if(e.kind==EventKind::Holiday){if(exactHoliday<0)exactHoliday=(int)i;}else if(exactOther<0)exactOther=(int)i;continue;\n    }\n    if(e.kind==EventKind::Holiday&&(cfg->leadDays||cfg->trailDays)&&eventWindowActiveOn(i,l,cfg->leadDays,cfg->trailDays)&&holidayWindow<0)holidayWindow=(int)i;\n  }\n  if(exactHoliday>=0)return applyEventOverrideByIndex((size_t)exactHoliday,themeFromEvent((size_t)exactHoliday));\n  if(exactOther>=0)return applyEventOverrideByIndex((size_t)exactOther,themeFromEvent((size_t)exactOther));\n  if(holidayWindow>=0)return applyEventOverrideByIndex((size_t)holidayWindow,themeFromEvent((size_t)holidayWindow));\n  if(monthlyCount){\n    if(cfg->overlap==0){size_t pick=monthly[(l.tm_yday+(l.tm_year+1900))%monthlyCount];return applyEventOverrideByIndex(pick,themeFromEvent(pick));}\n    if(cfg->overlap==1){int mins=l.tm_hour*60+l.tm_min;uint16_t on=cfg->onMinutes,off=cfg->offMinutes;int elapsed=mins-on;if(elapsed<0)elapsed+=1440;int span=off-on;if(span<=0)span+=1440;size_t slot=min(monthlyCount-1,(size_t)((elapsed*monthlyCount)/max(1,span)));return applyEventOverrideByIndex(monthly[slot],themeFromEvent(monthly[slot]));}\n    Theme t;t.name="Combined monthly events";t.effect=Effect::Breath;t.colorCount=0;for(size_t n=0;n<monthlyCount&&t.colorCount<8;n++){Theme q=applyEventOverrideByIndex(monthly[n],themeFromEvent(monthly[n]));for(uint8_t c=0;c<q.colorCount&&t.colorCount<8;c++)t.colors[t.colorCount++]=q.colors[c];}if(!t.colorCount){t.colors[0]=0xFFFFFA;t.colorCount=1;}return t;\n  }\n  if(seasonal>=0)return applyEventOverrideByIndex((size_t)seasonal,themeFromEvent((size_t)seasonal));\n  return normal;\n}\n'''
s=s[:start]+new_resolve+s[end:]
write(p,s)

# --- BLE animation engine: delete unsupported Gradient path ---
p='firmware/src/BleController.cpp'; s=read(p)
rx=re.compile(r'  // Breath and Gradient use interval-derived frames.*?  // Gradient: continuously blend through the event/preset colors at the selected speed\.\n  setColor\(color\);\n  if\(force\|\|changed\)setBrightness\(bright\);\n\}',re.S)
new='''  if(t.effect==Effect::Breath){\n    uint32_t frame=max((uint32_t)55,interval/5);if(!force && nowMs-lastEffect<frame)return;lastEffect=nowMs;\n    float cycleMs=(float)(interval*8UL),phase=fmodf((float)nowMs,cycleMs)/cycleMs;int idx=(int)(phase*count)%count,nxt=(idx+1)%count;float local=fmodf(phase*count,1.0f);\n    uint32_t a=t.colors[idx],z=t.colors[nxt];uint8_t R=(uint8_t)(r8(a)+(r8(z)-r8(a))*local),G=(uint8_t)(g8(a)+(g8(z)-g8(a))*local),B=(uint8_t)(b8(a)+(b8(z)-b8(a))*local);uint32_t color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;\n    float wave=0.5f-0.5f*cosf(phase*2.0f*PI);uint8_t level=(uint8_t)max(1.0f,bright*(0.10f+0.90f*wave));setColor(count>1?color:t.colors[0]);setBrightness(level);return;\n  }\n}'''
s,n=rx.subn(new,s,count=1); assert n==1,'BLE Gradient block replacement failed'
write(p,s)

# --- Checked/staged settings persistence; explicit empty Wi-Fi survives reboot ---
write('firmware/include/SettingsStore.h','''#pragma once\n#include <Preferences.h>\n#include "Types.h"\nclass SettingsStore {\n public:\n  void begin();\n  AppSettings& get(){return s;}\n  bool saveAll();\n  bool saveSettings(const AppSettings& next);\n  bool saveBle();\n  bool saveWiFi(const String& ssid,const String& pass);\n  bool clearWiFi();\n private:\n  Preferences prefs;\n  AppSettings s;\n  bool writeSettings(const AppSettings& value);\n};\n''')
write('firmware/src/SettingsStore.cpp','''#include "SettingsStore.h"\n\nstatic bool putStringChecked(Preferences& p,const char* key,const String& value){String old=p.getString(key,"__ANDERSON_MISSING__");if(old==value)return true;p.putString(key,value);return p.getString(key,"__ANDERSON_VERIFY__")==value;}\nstatic bool putUShortChecked(Preferences& p,const char* key,uint16_t value){if(p.getUShort(key,(uint16_t)(value^0xFFFF))==value)return true;return p.putUShort(key,value)>0&&p.getUShort(key,(uint16_t)(value^0xFFFF))==value;}\nstatic bool putUCharChecked(Preferences& p,const char* key,uint8_t value){if(p.getUChar(key,(uint8_t)(value^0xFF))==value)return true;return p.putUChar(key,value)>0&&p.getUChar(key,(uint8_t)(value^0xFF))==value;}\nstatic bool putBoolChecked(Preferences& p,const char* key,bool value){if(p.getBool(key,!value)==value)return true;return p.putBool(key,value)>0&&p.getBool(key,!value)==value;}\nstatic bool putU64Checked(Preferences& p,const char* key,uint64_t value){if(p.getULong64(key,~value)==value)return true;return p.putULong64(key,value)>0&&p.getULong64(key,~value)==value;}\n\nvoid SettingsStore::begin(){\n  prefs.begin("anderson",false);s.ssid=prefs.getString("ssid","Anderson");s.password=prefs.getString("pass","HarleyD5");s.tz=prefs.getString("tz","EST5EDT,M3.2.0,M11.1.0");\n  s.onMinutes=prefs.getUShort("on",17*60);s.offMinutes=prefs.getUShort("off",23*60);s.leadDays=prefs.getUChar("lead",2);s.trailDays=prefs.getUChar("trail",0);s.overlap=prefs.getUChar("overlap",0);\n  s.schedulerEnabled=prefs.getBool("sched",true);s.schedule2Enabled=prefs.getBool("sched2",true);s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);s.favoriteMask=prefs.getULong64("favorite",(1ULL<<26)|(1ULL<<27)|(1ULL<<29));\n  s.bleAddress=prefs.getString("bleaddr","");s.bleProtocol=prefs.getUChar("bleproto",0);s.bleAddress2=prefs.getString("bleaddr2","");s.bleProtocol2=prefs.getUChar("bleproto2",0);s.bleName=prefs.getString("blename","");s.bleName2=prefs.getString("blename2","");s.pixelCount=prefs.getUShort("pixels",100);\n}\nbool SettingsStore::writeSettings(const AppSettings& v){return putStringChecked(prefs,"tz",v.tz)&&putUShortChecked(prefs,"on",v.onMinutes)&&putUShortChecked(prefs,"off",v.offMinutes)&&putUCharChecked(prefs,"lead",v.leadDays)&&putUCharChecked(prefs,"trail",v.trailDays)&&putUCharChecked(prefs,"overlap",v.overlap)&&putBoolChecked(prefs,"sched",v.schedulerEnabled)&&putBoolChecked(prefs,"sched2",v.schedule2Enabled);}\nbool SettingsStore::saveSettings(const AppSettings& next){AppSettings previous=s;if(!writeSettings(next)){writeSettings(previous);return false;}s=next;return true;}\nbool SettingsStore::saveBle(){return putStringChecked(prefs,"bleaddr",s.bleAddress)&&putUCharChecked(prefs,"bleproto",s.bleProtocol)&&putStringChecked(prefs,"bleaddr2",s.bleAddress2)&&putUCharChecked(prefs,"bleproto2",s.bleProtocol2)&&putStringChecked(prefs,"blename",s.bleName)&&putStringChecked(prefs,"blename2",s.bleName2)&&putUShortChecked(prefs,"pixels",s.pixelCount);}\nbool SettingsStore::saveAll(){return writeSettings(s)&&putU64Checked(prefs,"enabled",s.enabledMask)&&putU64Checked(prefs,"favorite",s.favoriteMask)&&saveBle();}\nbool SettingsStore::saveWiFi(const String& ssid,const String& pass){String oldSsid=s.ssid,oldPass=s.password;if(!putStringChecked(prefs,"ssid",ssid)||!putStringChecked(prefs,"pass",pass)){putStringChecked(prefs,"ssid",oldSsid);putStringChecked(prefs,"pass",oldPass);return false;}s.ssid=ssid;s.password=pass;return true;}\nbool SettingsStore::clearWiFi(){return saveWiFi("","");}\n''')

# --- Main firmware: auth fixes, 16-color API, A/B event colors, checked persistence, capacity ---
p='firmware/src/main.cpp'; s=read(p)
s=rep(s,'#include "EventCatalog.h"\n','#include "EventCatalog.h"\n#include "EventColorThemes.h"\n','theme include')
s=s.replace('static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.26";','static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.0";')

old='static IPAddress pinAttemptIp;static bool pinAttemptIpSet=false;static uint8_t pinFailureCount=0;static uint32_t pinBlockedUntil=0;'
new='struct PinAttemptState{IPAddress ip;bool used=false;uint8_t failures=0;uint32_t blockedUntil=0;uint32_t lastSeen=0;};\nstatic PinAttemptState pinAttempts[6];'
s=rep(s,old,new,'PIN attempt globals')
old='static String issueAuthSession(uint8_t role,const String& profile){uint32_t now=millis();size_t slot=0;uint32_t oldestAge=0;bool found=false;for(size_t i=0;i<4;i++){uint32_t age=(uint32_t)(now-authSessions[i].lastSeen);if(!authSessions[i].token.length()||age>AUTH_SESSION_TTL_MS){slot=i;found=true;break;}if(!found||age>oldestAge){oldestAge=age;slot=i;}}authSessions[slot].token=randomHex(32);authSessions[slot].profile=profile;authSessions[slot].role=role;authSessions[slot].lastSeen=now;return authSessions[slot].token;}'
new='static String issueAuthSession(uint8_t role,const String& profile){uint32_t now=millis();size_t slot=0;uint32_t oldestAge=0;for(size_t i=0;i<4;i++){uint32_t age=(uint32_t)(now-authSessions[i].lastSeen);if(!authSessions[i].token.length()||age>AUTH_SESSION_TTL_MS){slot=i;break;}if(i==0||age>oldestAge){oldestAge=age;slot=i;}}authSessions[slot].token=randomHex(32);authSessions[slot].profile=profile;authSessions[slot].role=role;authSessions[slot].lastSeen=now;return authSessions[slot].token;}'
s=rep(s,old,new,'session eviction')
rx=re.compile(r'static void syncPinAttemptClient\(\)\{.*?static void clearPinFailures\(\)\{.*?\}',re.S)
new='''static PinAttemptState& currentPinAttempt(){IPAddress ip=server.client().remoteIP();uint32_t now=millis();size_t slot=0;uint32_t oldestAge=0;for(size_t i=0;i<6;i++){if(pinAttempts[i].used&&pinAttempts[i].ip==ip){pinAttempts[i].lastSeen=now;return pinAttempts[i];}if(!pinAttempts[i].used){slot=i;oldestAge=UINT32_MAX;break;}uint32_t age=(uint32_t)(now-pinAttempts[i].lastSeen);if(i==0||age>oldestAge){oldestAge=age;slot=i;}}PinAttemptState& a=pinAttempts[slot];a=PinAttemptState();a.used=true;a.ip=ip;a.lastSeen=now;return a;}\nstatic uint32_t pinRetryAfter(){auto&a=currentPinAttempt();int32_t remaining=(int32_t)(a.blockedUntil-millis());return remaining>0?(uint32_t)(remaining+999)/1000:0;}\nstatic void notePinFailure(){auto&a=currentPinAttempt();if(++a.failures>=5){a.failures=0;a.blockedUntil=millis()+60000UL;}}\nstatic void clearPinFailures(){auto&a=currentPinAttempt();a.failures=0;a.blockedUntil=0;}'''
s,n=rx.subn(new,s,count=1); assert n==1,'PIN tracking functions replacement failed'

# 16-color shared persisted master palette
rx=re.compile(r'static bool writeMasterFavoriteColors\(\)\{.*?\n\}',re.S)
new='''static bool writeMasterFavoriteColors(){JsonDocument d;JsonArray a=d.to<JsonArray>();for(size_t i=0;i<ANDERSON_COLOR_PALETTE_COUNT;i++)a.add(colorHex(ANDERSON_COLOR_PALETTE[i].output));String raw;serializeJson(d,raw);Preferences p;if(!p.begin("anderson-colors",false))return false;size_t wrote=p.putString("saved",raw);bool ok=wrote==raw.length()&&p.getString("saved","")==raw;p.end();return ok;}'''
s,n=rx.subn(new,s,count=1); assert n==1,'master colors replacement failed'
# do not ignore seed persistence check
s=s.replace('auto& settings=store.get();settings.favoriteMask=0;store.saveAll();','auto& settings=store.get();settings.favoriteMask=0;if(!store.saveAll())return false;')

# Optimize preset lookup by parsing once where possible.
old='''static bool loadPresetTheme(const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr,bool activeOnly=false){\n  JsonDocument list;if(deserializeJson(list,presetStoreRaw()))return false;\n  for(JsonObject o:list.as<JsonArray>()){\n    if(o["id"].as<String>()!=id)continue;if(activeOnly&&!(o["enabled"]|true))return false;t.name=o["name"].as<String>();if(outName)*outName=t.name;t.effect=effectFromString(o["effect"].as<String>());t.colorCount=0;\n    for(JsonVariant v:o["colors"].as<JsonArray>()){if(t.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())t.colors[t.colorCount++]=strtoul(cs.c_str(),nullptr,16);}\n    if(!t.colorCount){t.colors[0]=0xFFFF44;t.colorCount=1;}br=constrain(o["brightness"]|100,1,100);sp=constrain(o["speed"]|1,1,5);return true;\n  }return false;\n}\nstatic bool resolveCustomSchedule(const tm& l,Theme& t,uint8_t& br,uint8_t& sp){\n  JsonDocument list;if(deserializeJson(list,scheduleStoreRaw()))return false;bool found=false;\n  for(JsonObject o:list.as<JsonArray>()){\n    if(!(o["enabled"]|true))continue;int m=o["month"]|0,d=o["day"]|0,y=o["year"]|0;bool annual=o["annual"]|true;\n    if(m!=l.tm_mon+1||d!=l.tm_mday)continue;if(!annual&&y!=l.tm_year+1900)continue;Theme q;uint8_t qb=100,qs=1;if(loadPresetTheme(o["presetId"].as<String>(),q,qb,qs,nullptr,true)){t=q;br=qb;sp=qs;found=true;}\n  }return found;\n}\nstatic bool removeSchedulesForPreset(const String& presetId){\n  String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);bool ok=customFileWrite("/custom_schedules.json",out);return ok;\n}\n'''
new='''static bool loadPresetThemeFromArray(JsonArray presets,const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr,bool activeOnly=false){for(JsonObject o:presets){if(o["id"].as<String>()!=id)continue;if(activeOnly&&!(o["enabled"]|true))return false;t.name=o["name"].as<String>();if(outName)*outName=t.name;t.effect=effectFromString(o["effect"].as<String>());t.colorCount=0;for(JsonVariant v:o["colors"].as<JsonArray>()){if(t.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())t.colors[t.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!t.colorCount){t.colors[0]=0xFFFF44;t.colorCount=1;}br=constrain(o["brightness"]|100,1,100);sp=constrain(o["speed"]|1,1,5);return true;}return false;}\nstatic bool loadPresetTheme(const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr,bool activeOnly=false){JsonDocument list;if(deserializeJson(list,presetStoreRaw())||!list.is<JsonArray>())return false;return loadPresetThemeFromArray(list.as<JsonArray>(),id,t,br,sp,outName,activeOnly);}\nstatic bool resolveCustomSchedule(const tm& l,Theme& t,uint8_t& br,uint8_t& sp){JsonDocument schedules,presets;if(deserializeJson(schedules,scheduleStoreRaw())||!schedules.is<JsonArray>()||deserializeJson(presets,presetStoreRaw())||!presets.is<JsonArray>())return false;bool found=false;for(JsonObject o:schedules.as<JsonArray>()){if(!(o["enabled"]|true))continue;int m=o["month"]|0,d=o["day"]|0,y=o["year"]|0;bool annual=o["annual"]|true;if(m!=l.tm_mon+1||d!=l.tm_mday||(!annual&&y!=l.tm_year+1900))continue;Theme q;uint8_t qb=100,qs=1;if(loadPresetThemeFromArray(presets.as<JsonArray>(),o["presetId"].as<String>(),q,qb,qs,nullptr,true)){t=q;br=qb;sp=qs;found=true;}}return found;}\n'''
s=rep(s,old,new,'preset parse optimization')

# Global event color theme + generation-aware color overrides.
start=s.index('struct EventOverrideCfg {')
end=s.index('\nvoid addTheme(',start)
newblock='''enum class EventColorThemeStore : uint8_t { Original=0, Modern=1 };\nstatic EventColorTheme activeEventColorTheme=EventColorTheme::Modern;\nstatic uint32_t eventColorThemeGeneration=1;\nstatic bool loadEventColorTheme(){Preferences p;if(!p.begin("anderson-evpal",true))return false;uint8_t t=p.getUChar("theme",1);uint32_t g=p.getUInt("gen",1);p.end();activeEventColorTheme=t==0?EventColorTheme::Original:EventColorTheme::Modern;eventColorThemeGeneration=max((uint32_t)1,g);return true;}\nstatic bool setEventColorTheme(EventColorTheme next){if(next==activeEventColorTheme)return true;uint32_t nextGen=eventColorThemeGeneration+1;if(nextGen==0)nextGen=1;Preferences p;if(!p.begin("anderson-evpal",false))return false;size_t wt=p.putUChar("theme",next==EventColorTheme::Original?0:1),wg=p.putUInt("gen",nextGen);bool ok=wt>0&&wg>0&&p.getUChar("theme",255)==(next==EventColorTheme::Original?0:1)&&p.getUInt("gen",0)==nextGen;p.end();if(!ok)return false;activeEventColorTheme=next;eventColorThemeGeneration=nextGen;return true;}\n\nstruct EventOverrideCfg{bool valid=false;Effect effect=Effect::Jump;uint32_t colors[8]={0};uint8_t colorCount=0;uint8_t speed=1;uint32_t colorGeneration=1;};\nstatic EventOverrideCfg eventOverrides[MAX_BUILTIN_EVENTS];\nstatic String eventOverrideKey(size_t i){return String("e")+String((unsigned)i);}\nstatic uint8_t scheduledEventSpeedHint=1;\nTheme applyEventOverrideByIndex(size_t i,const Theme& base){Theme t=base;if(i<EVENT_COUNT&&activeEventColorTheme==EventColorTheme::Original)applyOriginalEventColors(i,t);scheduledEventSpeedHint=eventSpeed(i);if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS||!eventOverrides[i].valid)return t;const auto&o=eventOverrides[i];scheduledEventSpeedHint=constrain(o.speed,1,5);t.effect=o.effect;if(o.colorCount&&o.colorGeneration==eventColorThemeGeneration){t.colorCount=o.colorCount;for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=o.colors[c];}return t;}\nstatic Theme effectiveEventTheme(size_t i){return applyEventOverrideByIndex(i,themeFromEvent(i));}\nstatic void loadEventOverrides(){Preferences p;if(!p.begin("anderson-event",true))return;for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){String raw=p.getString(eventOverrideKey(i).c_str(),"");if(!raw.length())continue;int sep=raw.indexOf(';');if(sep<1)continue;String head=raw.substring(0,sep);EventOverrideCfg o;o.valid=true;o.colorGeneration=eventColorThemeGeneration;if(head.startsWith("v2|")){int b1=head.indexOf('|',3),b2=b1<0?-1:head.indexOf('|',b1+1);if(b1<0||b2<0)continue;o.effect=effectFromString(head.substring(3,b1));o.speed=constrain(head.substring(b1+1,b2).toInt(),1,5);o.colorGeneration=max((uint32_t)1,(uint32_t)head.substring(b2+1).toInt());}else{int bar=head.indexOf('|');if(bar>0){o.effect=effectFromString(head.substring(0,bar));o.speed=constrain(head.substring(bar+1).toInt(),1,5);}else{o.effect=effectFromString(head);o.speed=1;}}String list=raw.substring(sep+1);int pos=0;while(pos<(int)list.length()&&o.colorCount<8){int comma=list.indexOf(',',pos);String v=comma<0?list.substring(pos):list.substring(pos,comma);v.trim();if(v.startsWith("#"))v.remove(0,1);if(v.length())o.colors[o.colorCount++]=strtoul(v.c_str(),nullptr,16);if(comma<0)break;pos=comma+1;}eventOverrides[i]=o;}p.end();}\nstatic bool saveEventOverride(size_t i,const Theme& t,uint8_t sp=1){if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS)return false;EventOverrideCfg next;next.valid=true;next.effect=t.effect;next.speed=constrain(sp,1,5);next.colorGeneration=eventColorThemeGeneration;next.colorCount=min((uint8_t)8,t.colorCount);for(uint8_t c=0;c<next.colorCount;c++)next.colors[c]=andersonCorrectColor(t.colors[c]);String raw=String("v2|")+effectName(next.effect)+"|"+String(next.speed)+"|"+String(next.colorGeneration)+";";for(uint8_t c=0;c<next.colorCount;c++){if(c)raw+=",";raw+=colorHex(next.colors[c]);}Preferences p;if(!p.begin("anderson-event",false))return false;String key=eventOverrideKey(i);size_t wrote=p.putString(key.c_str(),raw);String verify=p.getString(key.c_str(),"");p.end();if(wrote!=raw.length()||verify!=raw)return false;eventOverrides[i]=next;return true;}\nstatic bool clearEventOverride(size_t i){if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS)return false;String key=eventOverrideKey(i);Preferences p;if(!p.begin("anderson-event",false))return false;String old=p.getString(key.c_str(),"");bool ok=!old.length()||p.remove(key.c_str());bool gone=!p.getString(key.c_str(),"").length();p.end();if(!ok||!gone)return false;eventOverrides[i]=EventOverrideCfg();return true;}\n'''
s=s[:start]+newblock+s[end:]

# API event: checked override writes; remove dead bulk endpoint and unrelated saveAll.
old='''    if(d["reset"]|false){clearEventOverride(i);}\n    else if(!d["effect"].isNull()||!d["speed"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);uint8_t esp=eventOverrides[i].valid?eventOverrides[i].speed:1;if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(!d["speed"].isNull())esp=constrain(d["speed"].as<int>(),1,5);if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){et.colors[0]=0xFFFF44;et.colorCount=1;}}saveEventOverride(i,et,esp);}\n    store.saveAll();evaluateSchedule(true);sendJson(stateJson());\n  });\n  server.on("/api/events/bulk",HTTP_POST,[]{\n    if(!requireUser())return;JsonDocument d;if(!body(d))return;int y=d["year"]|2026,m=d["month"]|1;bool en=d["enabled"]|false;auto&s=store.get();for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++)if(eventOccursInMonth(i,y,m))eventStateSetEnabled(i,en);store.saveAll();server.send(204);\n  });\n'''
new='''    if(d["reset"]|false){if(!clearEventOverride(i)){server.send(500,"text/plain","Event override reset failed");return;}}\n    else if(!d["effect"].isNull()||!d["speed"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);uint8_t esp=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(!d["speed"].isNull())esp=constrain(d["speed"].as<int>(),1,5);if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length()==6)et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){server.send(400,"text/plain","Event must contain at least one valid color");return;}}if(!saveEventOverride(i,et,esp)){server.send(500,"text/plain","Event override write failed");return;}}\n    evaluateSchedule(true);sendJson(stateJson());\n  });\n'''
s=rep(s,old,new,'event API / bulk removal')

# Settings: stage in copy and commit only after verified persistence.
rx=re.compile(r'  server\.on\("/api/settings",HTTP_POST,\[\]\{.*?\n  \}\);\n\n  server\.on\("/api/colors",HTTP_GET',re.S)
new='''  server.on("/api/settings",HTTP_POST,[]{\n    if(!requireUser())return;uint8_t role=requestRole();JsonDocument d;if(!body(d))return;bool adminChange=!d["overlap"].isNull()||!d["on"].isNull()||!d["off"].isNull()||!d["lead"].isNull()||!d["trail"].isNull()||!d["tz"].isNull();if(role<ROLE_ADMIN&&adminChange){server.send(403,"application/json","{\\"ok\\":false,\\"error\\":\\"Only Jason can change controller settings\\"}");return;}AppSettings next=store.get();\n    if(!d["overlap"].isNull()){String v=d["overlap"].as<String>();next.overlap=v=="split"?1:(v=="combine"?2:0);}if(!d["on"].isNull())next.onMinutes=parseTime(d["on"].as<String>(),next.onMinutes);if(!d["off"].isNull())next.offMinutes=parseTime(d["off"].as<String>(),next.offMinutes);if(!d["lead"].isNull())next.leadDays=constrain(d["lead"].as<int>(),0,14);if(!d["trail"].isNull())next.trailDays=constrain(d["trail"].as<int>(),0,7);if(!d["tz"].isNull())next.tz=d["tz"].as<String>();if(!d["scheduler"].isNull())next.schedulerEnabled=d["scheduler"].as<bool>();if(!d["scheduler2"].isNull())next.schedule2Enabled=d["scheduler2"].as<bool>();\n    if(!store.saveSettings(next)){server.send(500,"application/json","{\\"ok\\":false,\\"error\\":\\"Schedule settings write failed; previous settings were retained\\"}");return;}if(!d["tz"].isNull())configTzTime(store.get().tz.c_str(),"pool.ntp.org","time.nist.gov");evaluateSchedule(true);sendJson(stateJson());\n  });\n\n  server.on("/api/colors",HTTP_GET'''
s,n=rx.subn(new,s,count=1); assert n==1,'settings API replacement failed'
# 16-color API body
old='''    if(!requireUser())return;JsonDocument d;d["locked"]=true;d["requiresFirmware"]=true;JsonArray out=d["colors"].to<JsonArray>();\n    out.add("#FF0000");out.add("#FF0D00");out.add("#FF0024");out.add("#FFFF44");out.add("#28FF00");out.add("#00BD4C");out.add("#0D00FF");out.add("#5B00E6");out.add("#FFFFFA");\n    String json;serializeJson(d,json);sendJson(json);'''
new='''    if(!requireUser())return;JsonDocument d;d["locked"]=true;d["requiresFirmware"]=true;JsonArray out=d["colors"].to<JsonArray>();for(size_t i=0;i<ANDERSON_COLOR_PALETTE_COUNT;i++)out.add(colorHex(ANDERSON_COLOR_PALETTE[i].output));String json;serializeJson(d,json);sendJson(json);'''
s=rep(s,old,new,'colors API')

# Add A/B color-theme API before presets.
needle='  // ANDERSON_HOME_CUSTOM_LIGHTS: all profiles may preview and change Enabled/Favorite; only Jason may create or delete.\n'
insert='''  server.on("/api/event-color-theme",HTTP_GET,[]{if(!requireUser())return;JsonDocument d;d["theme"]=activeEventColorTheme==EventColorTheme::Original?"original":"modern";d["name"]=eventColorThemeName(activeEventColorTheme);d["generation"]=eventColorThemeGeneration;String out;serializeJson(d,out);sendJson(out);});\n  server.on("/api/event-color-theme",HTTP_POST,[]{if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String name=d["theme"]|String("");EventColorTheme next=name=="original"?EventColorTheme::Original:(name=="modern"?EventColorTheme::Modern:activeEventColorTheme);if(name!="original"&&name!="modern"){server.send(400,"text/plain","Choose original or modern colors");return;}if(!setEventColorTheme(next)){server.send(500,"text/plain","Event color theme write failed");return;}evaluateSchedule(true);JsonDocument out;out["ok"]=true;out["theme"]=name;out["name"]=eventColorThemeName(activeEventColorTheme);out["generation"]=eventColorThemeGeneration;String json;serializeJson(out,json);sendJson(json);});\n\n'''
s=rep(s,needle,insert+needle,'color theme API insertion')

# Preset capacity and safe linked deletion transaction.
s=s.replace('if(arr.size()>=12)arr.remove(0);uint32_t seq=nextStoredId(arr,\'p\');','if(arr.size()>=12){server.send(409,"text/plain","Custom-light capacity reached (12). Delete one before adding another.");return;}uint32_t seq=nextStoredId(arr,\'p\');')
old='''    if(deleteId.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);String out;serializeJson(list,out);if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light file write failed");return;}removeSchedulesForPreset(deleteId);sendJson("{\\"ok\\":true}");customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;return;}'''
new='''    if(deleteId.length()){String oldPresets=raw,oldSchedules=scheduleStoreRaw();JsonDocument sched;if(deserializeJson(sched,oldSchedules)||!sched.is<JsonArray>())sched.to<JsonArray>();JsonArray sa=sched.as<JsonArray>();bool found=false;for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId){arr.remove(i);found=true;}if(!found){server.send(404,"text/plain","Custom light not found");return;}for(int i=(int)sa.size()-1;i>=0;i--)if(sa[i]["presetId"].as<String>()==deleteId)sa.remove(i);String newPresets,newSchedules;serializeJson(list,newPresets);serializeJson(sched,newSchedules);if(!customFileWrite("/custom_schedules.json",newSchedules)){server.send(500,"text/plain","Dependent schedule update failed; custom light was not deleted");return;}if(!customFileWrite("/custom_lights.json",newPresets)){bool rolledBack=customFileWrite("/custom_schedules.json",oldSchedules);server.send(500,"text/plain",rolledBack?"Custom light delete failed; previous schedules were restored":"Custom light delete failed and schedule rollback needs review");return;}sendJson("{\\"ok\\":true}");customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;return;}'''
s=rep(s,old,new,'linked preset deletion')
# schedule capacity: reject 33rd before add, remove silent eviction
s=s.replace('else{int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,\'s\');','else{if(arr.size()>=32){server.send(409,"text/plain","Schedule capacity reached (32). Delete one before adding another.");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,\'s\');')
s=s.replace('    while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);','    String out;serializeJson(list,out);')

# custom schedule GET parses presets once, not once per row.
old='Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n))'
new='Theme t;uint8_t br=100,sp=1;String n;if(loadPresetThemeFromArray(presets.as<JsonArray>(),o["presetId"].as<String>(),t,br,sp,&n))'
# insert presets doc into GET lambda if marker present
marker='int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonDocument d;'
repl='int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list,presets;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();if(deserializeJson(presets,presetStoreRaw())||!presets.is<JsonArray>())presets.to<JsonArray>();JsonDocument d;'
s=rep(s,marker,repl,'schedule GET preset cache')
s=s.replace(old,new,1)

# Server-side bounded full-year event search endpoint.
needle='  server.on("/api/event",HTTP_POST,[]{\n'
search_api='''  server.on("/api/events/search",HTTP_GET,[]{if(!requireUser())return;int year=server.arg("year").toInt();String query=server.arg("q");query.trim();query.toLowerCase();if(year<2020||year>2037||!query.length()){server.send(400,"text/plain","Choose a supported year and search term");return;}JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();bool truncated=false;for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){String when=eventWhen(i,year);if(when.startsWith("No scheduled"))continue;String hay=String(EVENTS[i].name)+" "+when+" "+kindName(EVENTS[i].kind);hay.toLowerCase();if(hay.indexOf(query)<0)continue;if(arr.size()>=96){truncated=true;break;}Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["when"]=when;e["kind"]=kindName(EVENTS[i].kind);e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);e["enabled"]=eventStateEnabled(i);e["favorite"]=eventStateFavorite(i);e["customized"]=eventOverrides[i].valid;JsonArray c=e["colors"].to<JsonArray>();for(uint8_t k=0;k<et.colorCount;k++)c.add(colorHex(et.colors[k]));}d["truncated"]=truncated;String out;serializeJson(d,out);sendJson(out);});\n'''
s=rep(s,needle,search_api+needle,'event search API insertion')

# Wi-Fi route must verify persistence before restart.
s=s.replace('store.saveWiFi(ssid,pass);sendJson("{\\"ok\\":true}");delay(250);ESP.restart();','if(!store.saveWiFi(ssid,pass)){server.send(500,"text/plain","Wi-Fi settings could not be saved");return;}sendJson("{\\"ok\\":true}");delay(250);ESP.restart();')
# Hardware reset only reboots after explicit empty credentials persisted.
s=s.replace('if(buttonDown && millis()-buttonDown>5000){buttonDown=0;store.clearWiFi();digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}','if(buttonDown && millis()-buttonDown>5000){buttonDown=0;if(store.clearWiFi()){digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}}')
# load event color theme before override migration.
s=s.replace('seedMasterSceneFavoritesV4();loadEventOverrides();connectWiFi();','seedMasterSceneFavoritesV4();loadEventColorTheme();loadEventOverrides();connectWiFi();')
write(p,s)

# basic source invariants
for path in ['firmware/src/EventCatalog.cpp','firmware/src/BleController.cpp','firmware/include/Types.h']:
    text=read(path)
    assert 'Effect::Gradient' not in text,path
assert 'api/events/bulk' not in read('firmware/src/main.cpp')
assert 'ANDERSON_COLOR_PALETTE_COUNT' in read('firmware/src/main.cpp')
print('v3.1.0 core patch applied')
