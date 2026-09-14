from pathlib import Path
import re, subprocess

ROOT=Path(".")
OLD_DUAL="059f77136c841491b3f891f12b8b38f7383e350f"
V="3.1.17"
Y="E08700"

def read(p): return (ROOT/p).read_text()
def write(p,s): (ROOT/p).write_text(s)

vf=ROOT/"FIRMWARE_VERSION.txt"
assert vf.read_text().strip()=="3.1.16"
vf.write_text(V+"\n")

modern=subprocess.check_output(["git","show","anderson-v3.0.29:firmware/src/EventCatalog.cpp"],text=True)
modern_colors={}
for line in modern.splitlines():
    m=re.match(r'\{"evt(\d{3})".*?,Effect::[A-Za-z]+,(C[1-6]\([^)]*\)),(\d+)\s*\},', line)
    if m:
        macro=m.group(2).replace("0xFFFF44","0x"+Y)
        modern_colors[int(m.group(1))]=(macro,int(m.group(3)))
assert len(modern_colors)==210, len(modern_colors)
ep=ROOT/"firmware/src/EventCatalog.cpp"
lines=ep.read_text().splitlines()
seen=0
for n,line in enumerate(lines):
    m=re.match(r'(\{"evt(\d{3})".*?,Effect::[A-Za-z]+,)C[1-6]\([^)]*\),\d+(\s*\},)',line)
    if not m: continue
    idx=int(m.group(2)); macro,count=modern_colors[idx]
    lines[n]=m.group(1)+macro+","+str(count)+m.group(3); seen+=1
assert seen==210,seen
ep.write_text("\n".join(lines)+"\n")

old_theme=subprocess.check_output(["git","show",f"{OLD_DUAL}:firmware/src/EventColorThemes.cpp"],text=True)
table=re.search(r'(static constexpr uint32_t ORIGINAL_COLOR_DICTIONARY\[\].*?static constexpr uint8_t ORIGINAL_EVENT_COLOR_COUNT\[210\]\s*=\s*\{.*?\};)',old_theme,re.S)
assert table
table_text=table.group(1).replace("0xFFFF44","0x"+Y)

header=r'''#pragma once
#include <Arduino.h>
#include "Types.h"

enum class EventColorTheme : uint8_t { V3028=0, V3029=1 };
const char* eventColorThemeName(EventColorTheme theme);
const char* eventColorThemeId(EventColorTheme theme);
void applyOriginalEventColors(size_t index, Theme& theme);
void applyModernEventColors(Theme& theme);
void loadEventColorPresetOverrides();
size_t eventColorPresetCount(EventColorTheme theme);
const char* eventColorPresetName(size_t index);
uint32_t eventColorPresetValue(size_t index);
uint32_t eventColorPresetDefault(size_t index);
bool saveEventColorPreset(size_t index,uint32_t color);
'''
write("firmware/include/EventColorThemes.h",header)

cpp = '#include "EventColorThemes.h"\n#include <ArduinoJson.h>\n#include <Preferences.h>\n\n' + table_text + r'''

static constexpr const char* PRESET_NAMES[]={
  "Red","Orange","Pink","Yellow","Green","Cyan","Blue","Purple","White",
  "Teal","Sky Blue","Amber Gold","Lavender","Navy Blue","Burgundy","Silver Gray"
};
static constexpr uint32_t PRESET_DEFAULTS[]={
  0xFF0000,0xFF0D00,0xFF0024,0xE08700,0x28FF00,0x00BD4C,0x0D00FF,0x5B00E6,0xFFFFFA,
  0x00B4B4,0x0096FF,0xFFA000,0xB464FF,0x001478,0x87002D,0xA0A5AF
};
static_assert(sizeof(PRESET_NAMES)/sizeof(PRESET_NAMES[0])==16,"preset name count");
static_assert(sizeof(PRESET_DEFAULTS)/sizeof(PRESET_DEFAULTS[0])==16,"preset value count");
static uint32_t presetValues[16]={0};
static bool presetLoaded=false;

static int presetIndexForDefault(uint32_t c){
  c&=0xFFFFFF;
  if(c==0xFFFF44||c==0xE0B400||c==0xE08700)return 3;
  for(size_t i=0;i<16;i++)if(PRESET_DEFAULTS[i]==c)return (int)i;
  return -1;
}
static uint32_t resolvedPresetColor(uint32_t c){
  if(!presetLoaded)loadEventColorPresetOverrides();
  int i=presetIndexForDefault(c);return i>=0?presetValues[i]:(c&0xFFFFFF);
}
const char* eventColorThemeName(EventColorTheme theme){return theme==EventColorTheme::V3028?"3.0.28 Colors":"3.0.29 Colors";}
const char* eventColorThemeId(EventColorTheme theme){return theme==EventColorTheme::V3028?"3.0.28":"3.0.29";}
size_t eventColorPresetCount(EventColorTheme theme){return theme==EventColorTheme::V3028?9U:16U;}
const char* eventColorPresetName(size_t index){return index<16?PRESET_NAMES[index]:"";}
uint32_t eventColorPresetDefault(size_t index){return index<16?PRESET_DEFAULTS[index]:0;}
uint32_t eventColorPresetValue(size_t index){if(!presetLoaded)loadEventColorPresetOverrides();return index<16?presetValues[index]:0;}

void loadEventColorPresetOverrides(){
  for(size_t i=0;i<16;i++)presetValues[i]=PRESET_DEFAULTS[i];
  Preferences p;if(!p.begin("anderson-colors",true)){presetLoaded=true;return;}
  String raw=p.getString("saved","");p.end();JsonDocument d;
  if(raw.length()&&!deserializeJson(d,raw)&&d.is<JsonArray>()&&d.as<JsonArray>().size()==16){
    size_t i=0;for(JsonVariant v:d.as<JsonArray>()){String s=v.as<String>();s.trim();if(s.startsWith("#"))s.remove(0,1);
      if(s.length()==6){char* end=nullptr;unsigned long c=strtoul(s.c_str(),&end,16);if(end&&*end=='\0')presetValues[i]=(uint32_t)c&0xFFFFFF;}i++;}
  }
  presetLoaded=true;
}
bool saveEventColorPreset(size_t index,uint32_t color){
  if(index>=16)return false;if(!presetLoaded)loadEventColorPresetOverrides();uint32_t old=presetValues[index];presetValues[index]=color&0xFFFFFF;
  JsonDocument d;JsonArray a=d.to<JsonArray>();char h[8];for(size_t i=0;i<16;i++){snprintf(h,sizeof(h),"#%06lX",(unsigned long)presetValues[i]);a.add(h);}
  String raw;serializeJson(d,raw);Preferences p;if(!p.begin("anderson-colors",false)){presetValues[index]=old;return false;}
  size_t wrote=p.putString("saved",raw);String verify=p.getString("saved","");p.end();if(wrote!=raw.length()||verify!=raw){presetValues[index]=old;return false;}return true;
}
void applyOriginalEventColors(size_t index,Theme& theme){
  if(index>=210)return;uint8_t count=ORIGINAL_EVENT_COLOR_COUNT[index];theme.colorCount=count;
  for(uint8_t i=0;i<count;i++)theme.colors[i]=resolvedPresetColor(ORIGINAL_COLOR_DICTIONARY[ORIGINAL_EVENT_COLOR_INDEX[index][i]]);
}
void applyModernEventColors(Theme& theme){for(uint8_t i=0;i<theme.colorCount;i++)theme.colors[i]=resolvedPresetColor(theme.colors[i]);}
'''
write("firmware/src/EventColorThemes.cpp",cpp)

cc=subprocess.check_output(["git","show",f"{OLD_DUAL}:firmware/src/ColorCorrection.cpp"],text=True)
cc=cc.replace("0xFFFF44","0x"+Y)
needle="{0xE08700,0xE08700},"
assert needle in cc
cc=cc.replace(needle,needle+"{0xFFFF44,0xE08700},{0xE0B400,0xE08700},",1)
write("firmware/src/ColorCorrection.cpp",cc)

pm=read("firmware/src/PaletteMigration.cpp")
pm=pm.replace("PALETTE_MIGRATION_REVISION=8","PALETTE_MIGRATION_REVISION=9")
pm=re.sub(r'static bool transformFavoriteJson\(const String& original,String& corrected\)\{.*?\n\}',
'''static bool transformFavoriteJson(const String& original,String& corrected){
  (void)original;JsonDocument d;JsonArray a=d.to<JsonArray>();
  a.add("#FF0000");a.add("#FF0D00");a.add("#FF0024");a.add("#E08700");a.add("#28FF00");a.add("#00BD4C");a.add("#0D00FF");a.add("#5B00E6");a.add("#FFFFFA");
  a.add("#00B4B4");a.add("#0096FF");a.add("#FFA000");a.add("#B464FF");a.add("#001478");a.add("#87002D");a.add("#A0A5AF");
  serializeJson(d,corrected);return true;
}''',pm,count=1,flags=re.S)
pm=pm.replace('  p.end();Preferences pal;if(pal.begin("anderson-evpal",false)){pal.clear();pal.end();}return ok;','  p.end();return ok;')
pm=pm.replace("Revision 8 normalizes","Revision 9 restores the selectable 3.0.28/3.0.29 palette slots and normalizes")
pm=pm.replace("0xE0B400","0xE08700").replace("#E0B400","#E08700")
write("firmware/src/PaletteMigration.cpp",pm)

mp=ROOT/"firmware/src/main.cpp"; main=mp.read_text()
main=main.replace('#include "EventCatalog.h"\n','#include "EventCatalog.h"\n#include "EventColorThemes.h"\n',1)
main=main.replace('ANDERSON_FIRMWARE_VERSION="3.1.16"','ANDERSON_FIRMWARE_VERSION="3.1.17"')
marker='struct EventOverrideCfg{bool valid=false;Effect effect=Effect::Jump;uint32_t colors[8]={0};uint8_t colorCount=0;uint8_t speed=1;};'
assert marker in main
theme_code=r'''static EventColorTheme activeEventColorTheme=EventColorTheme::V3029;
static uint32_t eventColorThemeGeneration=1;
static bool loadEventColorTheme(){Preferences p;if(!p.begin("anderson-evpal",true))return false;String id=p.getString("scheme","3.0.29");uint32_t g=p.getUInt("gen",1);p.end();activeEventColorTheme=id=="3.0.28"?EventColorTheme::V3028:EventColorTheme::V3029;eventColorThemeGeneration=max((uint32_t)1,g);return true;}
static bool setEventColorTheme(EventColorTheme next){if(next==activeEventColorTheme)return true;uint32_t nextGen=eventColorThemeGeneration+1;if(!nextGen)nextGen=1;Preferences p;if(!p.begin("anderson-evpal",false))return false;String id=eventColorThemeId(next);size_t ws=p.putString("scheme",id),wg=p.putUInt("gen",nextGen);bool ok=ws==id.length()&&wg>0&&p.getString("scheme","")==id&&p.getUInt("gen",0)==nextGen;p.end();if(!ok)return false;activeEventColorTheme=next;eventColorThemeGeneration=nextGen;return true;}

'''
main=main.replace(marker,theme_code+marker,1)
old_apply='Theme applyEventOverrideByIndex(size_t i,const Theme& base){Theme t=base;scheduledEventSpeedHint=eventSpeed(i);'
assert old_apply in main
new_apply='Theme applyEventOverrideByIndex(size_t i,const Theme& base){Theme t=base;if(i<EVENT_COUNT){if(activeEventColorTheme==EventColorTheme::V3028)applyOriginalEventColors(i,t);else applyModernEventColors(t);}scheduledEventSpeedHint=eventSpeed(i);'
main=main.replace(old_apply,new_apply,1)

pat=r'''  server\.on\("/api/colors",HTTP_GET,\[\]\{\n.*?  server\.on\("/api/colors",HTTP_POST,\[\]\{\n.*?\n  \}\);\n'''
m=re.search(pat,main,re.S); assert m
api_block=r'''  server.on("/api/event-color-theme",HTTP_GET,[]{if(!requireUser())return;JsonDocument d;d["theme"]=eventColorThemeId(activeEventColorTheme);d["name"]=eventColorThemeName(activeEventColorTheme);d["generation"]=eventColorThemeGeneration;String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/event-color-theme",HTTP_POST,[]{if(!requireUser())return;JsonDocument d;if(!body(d))return;String id=d["theme"]|String("");EventColorTheme next=id=="3.0.28"?EventColorTheme::V3028:(id=="3.0.29"?EventColorTheme::V3029:activeEventColorTheme);if(id!="3.0.28"&&id!="3.0.29"){server.send(400,"application/json","{\"ok\":false,\"error\":\"Choose 3.0.28 or 3.0.29 colors\"}");return;}if(!setEventColorTheme(next)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Event color scheme write failed\"}");return;}evaluateSchedule(true);JsonDocument out;out["ok"]=true;out["theme"]=eventColorThemeId(activeEventColorTheme);out["name"]=eventColorThemeName(activeEventColorTheme);out["generation"]=eventColorThemeGeneration;String json;serializeJson(out,json);sendJson(json);});

  server.on("/api/colors",HTTP_GET,[]{if(!requireUser())return;JsonDocument d;d["locked"]=false;d["overwriteOnly"]=true;d["theme"]=eventColorThemeId(activeEventColorTheme);size_t count=eventColorPresetCount(activeEventColorTheme);JsonArray colors=d["colors"].to<JsonArray>();JsonArray presets=d["presets"].to<JsonArray>();for(size_t i=0;i<count;i++){uint32_t c=eventColorPresetValue(i);colors.add(colorHex(c));JsonObject p=presets.add<JsonObject>();p["index"]=(uint32_t)i;p["name"]=eventColorPresetName(i);p["color"]=colorHex(c);p["default"]=colorHex(eventColorPresetDefault(i));p["customized"]=c!=eventColorPresetDefault(i);}String json;serializeJson(d,json);sendJson(json);});
  server.on("/api/colors",HTTP_POST,[]{if(!requireAdmin())return;JsonDocument d;if(!body(d))return;if(d["index"].isNull()||d["color"].isNull()){server.send(400,"application/json","{\"ok\":false,\"error\":\"Select an existing preset and color\"}");return;}int index=d["index"].as<int>();size_t count=eventColorPresetCount(activeEventColorTheme);if(index<0||(size_t)index>=count){server.send(400,"application/json","{\"ok\":false,\"error\":\"That preset is not available in the selected event scheme\"}");return;}String s=d["color"].as<String>();s.trim();if(s.startsWith("#"))s.remove(0,1);if(s.length()!=6){server.send(400,"application/json","{\"ok\":false,\"error\":\"Use a six-digit HEX color\"}");return;}for(char c:s)if(!isxdigit((unsigned char)c)){server.send(400,"application/json","{\"ok\":false,\"error\":\"Use a valid HEX color\"}");return;}uint32_t color=strtoul(s.c_str(),nullptr,16)&0xFFFFFF;if(!saveEventColorPreset((size_t)index,color)){server.send(500,"application/json","{\"ok\":false,\"error\":\"Preset overwrite failed verification\"}");return;}evaluateSchedule(true);JsonDocument out;out["ok"]=true;out["index"]=index;out["name"]=eventColorPresetName(index);out["color"]=colorHex(eventColorPresetValue(index));String json;serializeJson(out,json);sendJson(json);});
'''
main=main[:m.start()]+api_block+main[m.end():]

main=main.replace('d["scheduler2"]=a.schedule2Enabled;String raw;serializeJson(d,raw);','d["scheduler2"]=a.schedule2Enabled;d["eventColorTheme"]=eventColorThemeId(activeEventColorTheme);String raw;serializeJson(d,raw);')
main=main.replace('a.schedule2Enabled=d["scheduler2"]|a.schedule2Enabled;ok=store.saveSettings(a)&&ok;','a.schedule2Enabled=d["scheduler2"]|a.schedule2Enabled;String ect=d["eventColorTheme"]|String(eventColorThemeId(activeEventColorTheme));if(ect=="3.0.28"||ect=="3.0.29")ok=setEventColorTheme(ect=="3.0.28"?EventColorTheme::V3028:EventColorTheme::V3029)&&ok;ok=store.saveSettings(a)&&ok;')
main=main.replace('if(mask&BACKUP_EVENTS){eventStateBegin();loadEventOverrides();}if(mask&BACKUP_SCHEDULE)','if(mask&BACKUP_EVENTS){eventStateBegin();loadEventOverrides();}if(mask&BACKUP_FAVORITES)loadEventColorPresetOverrides();if(mask&BACKUP_SCHEDULE)')
main=main.replace('seedMasterSceneFavoritesV4();loadEventOverrides();connectWiFi();','seedMasterSceneFavoritesV4();loadEventColorTheme();loadEventColorPresetOverrides();loadEventOverrides();connectWiFi();')
main=main.replace("0xE0B400","0xE08700").replace("0xFFFF44","0xE08700")
mp.write_text(main)

wp=ROOT/"firmware/web/index.html"; web=wp.read_text()
web=web.replace("#E0B400","#E08700").replace("#FFFF44","#E08700")
palette='''const NAMED_COLOR_PALETTE=[
  {name:'Red',reference:'#FF0000',output:'#FF0000'},
  {name:'Orange',reference:'#FF0D00',output:'#FF0D00'},
  {name:'Pink',reference:'#FF0024',output:'#FF0024'},
  {name:'Yellow',reference:'#E08700',output:'#E08700'},
  {name:'Green',reference:'#28FF00',output:'#28FF00'},
  {name:'Cyan',reference:'#00BD4C',output:'#00BD4C'},
  {name:'Blue',reference:'#0D00FF',output:'#0D00FF'},
  {name:'Purple',reference:'#5B00E6',output:'#5B00E6'},
  {name:'White',reference:'#FFFFFA',output:'#FFFFFA'},
  {name:'Teal',reference:'#00B4B4',output:'#00B4B4'},
  {name:'Sky Blue',reference:'#0096FF',output:'#0096FF'},
  {name:'Amber Gold',reference:'#FFA000',output:'#FFA000'},
  {name:'Lavender',reference:'#B464FF',output:'#B464FF'},
  {name:'Navy Blue',reference:'#001478',output:'#001478'},
  {name:'Burgundy',reference:'#87002D',output:'#87002D'},
  {name:'Silver Gray',reference:'#A0A5AF',output:'#A0A5AF'}
];'''
web,n=re.subn(r'const NAMED_COLOR_PALETTE=\[.*?\];',palette,web,count=1,flags=re.S); assert n==1
web,n=re.subn(r"const REFERENCE_LED=\{.*?\};","const REFERENCE_LED=Object.fromEntries(NAMED_COLOR_PALETTE.flatMap(x=>[[x.reference,x.output],[x.output,x.output]]));",web,count=1,flags=re.S); assert n==1

search_div='      <div class="row" style="margin-top:10px"><input id="eventSearch"'
assert search_div in web
selector='''      <div class="eventColorThemeBox">
        <div><strong>Event Color Scheme</strong><div class="sub">Switch all non-customized built-in scheduled events between the preserved historical color assignments.</div></div>
        <div class="eventColorThemeGrid" role="group" aria-label="Event color scheme">
          <button id="eventColors3028" class="eventColorThemeTile" type="button" data-theme="3.0.28" aria-pressed="false"><span class="eventColorThemeCheck">✓</span><span class="eventColorThemeLetter">28</span><span><strong>3.0.28 Colors</strong><small>Original 9-color event scheme</small></span></button>
          <button id="eventColors3029" class="eventColorThemeTile" type="button" data-theme="3.0.29" aria-pressed="true"><span class="eventColorThemeCheck">✓</span><span class="eventColorThemeLetter">29</span><span><strong>3.0.29 Colors</strong><small>Expanded 16-color event scheme</small></span></button>
        </div>
      </div>
'''
web=web.replace(search_div,selector+search_div,1)

old='''      <div id="liveColorCode" class="liveColorCode">#FFFFFF</div>
      <div id="liveColorRgb" class="sub liveColorRgb">RGB 255, 255, 255</div>
      <div id="liveColorPreview" class="liveColorPreview" style="background:#FFFFFF"></div>
      <div class="label">Preset colors</div><div id="liveColorPresets" class="savedColorGrid"></div>'''
assert old in web
new='''      <div id="liveColorCode" class="liveColorCode">#FFFFFF</div>
      <div id="liveColorRgb" class="sub liveColorRgb">RGB 255, 255, 255</div>
      <div id="liveColorPreview" class="liveColorPreview" style="background:#FFFFFF"></div>
      <div class="label">Exact HEX</div><input id="liveColorHex" class="rgbHex" maxlength="7" value="#FFFFFF" inputmode="text" autocomplete="off">
      <div class="label">Exact RGB</div><div class="rgbReadout"><label>R<input id="liveColorR" type="number" min="0" max="255" value="255"></label><label>G<input id="liveColorG" type="number" min="0" max="255" value="255"></label><label>B<input id="liveColorB" type="number" min="0" max="255" value="255"></label></div>
      <div class="label">Existing preset colors</div><div id="liveColorPresets" class="savedColorGrid"></div>
      <button id="liveColorSavePreset" class="btn" type="button" style="width:100%;margin-top:9px" disabled>Save Over Selected Preset</button>
      <div id="liveColorPresetHint" class="sub" style="margin-top:6px">Select an existing preset above to enable overwrite. Live Preview cannot add new preset slots.</div>'''
web=web.replace(old,new,1)
web=web.replace('This preview does not save or alter event colors.','Use the wheel, HEX, or RGB fields for exact tuning. You can overwrite an existing named preset, but you cannot add preset slots here.',1)

css=r'''
.eventColorThemeBox{margin-top:10px;padding:11px;border:1px solid rgba(70,190,255,.28);border-radius:14px;background:linear-gradient(155deg,rgba(11,35,57,.84),rgba(4,16,29,.92))}
.eventColorThemeGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:9px}.eventColorThemeTile{position:relative;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:9px;min-height:72px;padding:10px 11px;border-radius:12px;border:1px solid rgba(85,173,220,.36);background:linear-gradient(150deg,rgba(20,51,78,.78),rgba(5,18,31,.95));color:var(--text);text-align:left}.eventColorThemeTile small{display:block;margin-top:3px;color:var(--muted);font-size:10px}.eventColorThemeLetter{display:grid;place-items:center;width:31px;height:31px;border-radius:8px;border:1px solid rgba(104,217,255,.38);font-weight:900}.eventColorThemeCheck{display:none;position:absolute;right:8px;top:7px}.eventColorThemeTile[aria-pressed="true"]{border-color:#70e8ff;box-shadow:0 0 20px rgba(41,216,255,.22)}.eventColorThemeTile[aria-pressed="true"] .eventColorThemeCheck{display:block}.livePresetSelected{outline:3px solid #70e8ff!important;outline-offset:2px;box-shadow:0 0 20px rgba(41,216,255,.42)!important}
@media(max-width:430px){.eventColorThemeGrid{grid-template-columns:1fr}}
'''
web=web.replace("</head>","<style>"+css+"</style>\n</head>",1)

live_js=r'''let liveTuneH=0,liveTuneS=0,liveTuneV=1,liveTuneTimer=null,liveTuneSending=false,liveTuneQueued=false,liveTuneSelectedPreset=-1,liveColorPresetRecords=[];
function liveTuneHex(){const q=hsvRgb(liveTuneH,liveTuneS,liveTuneV);return rgbHex(q[0],q[1],q[2])}
function validLiveHex(v){v=(v||'').trim().toUpperCase();if(!v.startsWith('#'))v='#'+v;return /^#[0-9A-F]{6}$/.test(v)?v:null}
function setLiveTuneHex(hex,sendLive=true){const good=validLiveHex(hex);if(!good){status('Enter a six-digit HEX color such as #E08700.');return false}const q=hexRgb(good),v=rgbHsv(q[0],q[1],q[2]);liveTuneH=v[0];liveTuneS=v[1];liveTuneV=v[2];renderLiveColorTune(sendLive);return true}
async function loadLiveColorPresets(){let d={presets:[]};try{if(API_MODE)d=await api('/api/colors?ts='+Date.now(),{cache:'no-store'});}catch(e){}liveColorPresetRecords=Array.isArray(d.presets)&&d.presets.length?d.presets:NAMED_COLOR_PALETTE.map((x,index)=>({index,name:x.name,color:x.output,default:x.output,customized:false}));if(!liveColorPresetRecords.some(p=>+p.index===liveTuneSelectedPreset))liveTuneSelectedPreset=-1;renderLiveColorPresets()}
function renderLiveColorPresets(){const g=$('liveColorPresets');if(!g)return;g.replaceChildren();liveColorPresetRecords.forEach(p=>{const hex=normHex(p.color),b=document.createElement('button');b.type='button';b.className='savedSwatch'+(+p.index===liveTuneSelectedPreset?' livePresetSelected':'');b.style.background=hex;b.style.color=favoriteInk(hex);b.textContent=p.name;b.title=`${p.name} ${hex}${p.customized?' • overwritten':''}`;b.setAttribute('aria-label','Select '+p.name+' preset '+hex);b.addEventListener('click',()=>{liveTuneSelectedPreset=+p.index;setLiveTuneHex(hex,true);renderLiveColorPresets();$('liveColorSavePreset').disabled=false;$('liveColorPresetHint').textContent=`Selected ${p.name}. Save will overwrite this preset slot.`});g.appendChild(b)});$('liveColorSavePreset').disabled=liveTuneSelectedPreset<0}
function renderLiveColorTune(sendLive=false){const h=liveTuneHex(),q=hexRgb(h),w=$('liveColorWheel');if(!w)return;const rad=w.clientWidth/2,ang=(liveTuneH-90)*Math.PI/180,rr=liveTuneS*rad*.92;$('liveColorMarker').style.left=(rad+Math.cos(ang)*rr)+'px';$('liveColorMarker').style.top=(rad+Math.sin(ang)*rr)+'px';$('liveColorCode').textContent=h;$('liveColorRgb').textContent=`RGB ${q[0]}, ${q[1]}, ${q[2]}`;$('liveColorPreview').style.background=h;$('liveColorValue').value=Math.round(liveTuneV*100);$('liveColorValueText').textContent=Math.round(liveTuneV*100)+'%';$('liveColorHex').value=h;$('liveColorR').value=q[0];$('liveColorG').value=q[1];$('liveColorB').value=q[2];if(sendLive&&$('liveColorEnabled').checked)scheduleLiveColorTune()}
function liveColorWheelPoint(e){const w=$('liveColorWheel'),r=w.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,dist=Math.sqrt(dx*dx+dy*dy),rad=r.width/2;liveTuneS=Math.min(1,dist/(rad*.92));liveTuneH=(Math.atan2(dy,dx)*180/Math.PI+90+360)%360;renderLiveColorTune(true)}
function scheduleLiveColorTune(){clearTimeout(liveTuneTimer);liveTuneTimer=setTimeout(()=>sendLiveColorTune(false),120)}
async function sendLiveColorTune(announce=true){clearTimeout(liveTuneTimer);const color=liveTuneHex();if(liveTuneSending){liveTuneQueued=true;return}liveTuneSending=true;try{if(API_MODE){await post('/api/control',{power:true,name:'Live Color Tune '+color,colors:[color],effect:'Solid',brightness});}else{power=true;running={name:'Live Color Tune '+color,colors:[color],effect:'Solid'};}if(announce)status('Previewing '+color+' on the selected light controller.')}catch(e){if(announce)status('Color preview failed: '+e.message)}finally{liveTuneSending=false;if(liveTuneQueued){liveTuneQueued=false;scheduleLiveColorTune()}}}
async function saveOverLivePreset(){if(liveTuneSelectedPreset<0)return status('Select an existing preset first.');const record=liveColorPresetRecords.find(p=>+p.index===liveTuneSelectedPreset);if(!record)return status('Selected preset is no longer available.');const color=liveTuneHex();try{const d=await post('/api/colors',{index:liveTuneSelectedPreset,color});status(`${d.name||record.name} overwritten with ${d.color||color}.`);await Promise.all([loadLiveColorPresets(),loadSavedColors(),loadEventColorTheme(),loadEvents(eventRequestGeneration),loadFavorites()])}catch(e){status('Preset overwrite failed: '+e.message)}}
function bindLiveColorTuner(){const w=$('liveColorWheel');if(!w)return;let drag=false;w.addEventListener('pointerdown',e=>{drag=true;w.setPointerCapture(e.pointerId);liveColorWheelPoint(e)});w.addEventListener('pointermove',e=>{if(drag)liveColorWheelPoint(e)});w.addEventListener('pointerup',()=>drag=false);w.addEventListener('pointercancel',()=>drag=false);$('liveColorValue').addEventListener('input',e=>{liveTuneV=(+e.target.value)/100;renderLiveColorTune(true)});$('liveColorHex').addEventListener('change',e=>setLiveTuneHex(e.target.value,true));['liveColorR','liveColorG','liveColorB'].forEach(id=>$(id).addEventListener('change',()=>setLiveTuneHex(rgbHex($('liveColorR').value,$('liveColorG').value,$('liveColorB').value),true)));$('liveColorPreviewButton').addEventListener('click',()=>sendLiveColorTune(true));$('liveColorSavePreset').addEventListener('click',saveOverLivePreset);$('liveColorEnabled').addEventListener('change',e=>{if(e.target.checked)sendLiveColorTune(false)});renderLiveColorTune(false);loadLiveColorPresets()}

'''
web,n=re.subn(r'const LIVE_COLOR_PRESETS=.*?\nfunction bindLiveColorTuner\(\).*?\n\nfunction editEventInline',live_js+'function editEventInline',web,count=1,flags=re.S)
if n==0:
    web,n=re.subn(r'let liveTuneH=.*?\nfunction bindLiveColorTuner\(\).*?\n\nfunction editEventInline',live_js+'function editEventInline',web,count=1,flags=re.S)
assert n==1,n

theme_js=r'''let currentEventColorTheme='3.0.29';
function renderEventColorTheme(theme){currentEventColorTheme=theme==='3.0.28'?'3.0.28':'3.0.29';[['3.0.28','eventColors3028'],['3.0.29','eventColors3029']].forEach(([v,id])=>{const b=$(id);if(b)b.setAttribute('aria-pressed',String(v===currentEventColorTheme))})}
async function loadEventColorTheme(){try{const d=await api('/api/event-color-theme',{cache:'no-store'});renderEventColorTheme(d.theme);return d}catch(e){renderEventColorTheme('3.0.29');return{theme:'3.0.29'}}}
async function chooseEventColorTheme(theme){if(theme===currentEventColorTheme)return;const b=$(theme==='3.0.28'?'eventColors3028':'eventColors3029');if(b)b.disabled=true;try{const d=await post('/api/event-color-theme',{theme});renderEventColorTheme(d.theme);liveTuneSelectedPreset=-1;const gen=invalidateEventRequest();await Promise.all([loadLiveColorPresets(),loadSavedColors(),loadEvents(gen),loadFavorites()]);status((d.name||'Event color scheme')+' applied.')}catch(e){status('Event color scheme change failed: '+e.message)}finally{if(b)b.disabled=false}}
$('eventColors3028').addEventListener('click',()=>chooseEventColorTheme('3.0.28'));$('eventColors3029').addEventListener('click',()=>chooseEventColorTheme('3.0.29'));

'''
web=web.replace('function editEventInline',theme_js+'function editEventInline',1)
web=web.replace("loadState();loadEvents();loadCustomSchedules();loadHomeCustomLights();loadSavedColors();","loadState();loadEventColorTheme();loadEvents();loadCustomSchedules();loadHomeCustomLights();loadSavedColors();")
web=web.replace("if(btn.dataset.tab==='events'){loadEvents();loadCustomSchedules();}","if(btn.dataset.tab==='events'){loadEventColorTheme();loadEvents();loadCustomSchedules();}")
web=web.replace("if(btn.dataset.tab==='settings'){loadState();loadPinSettings();loadSystemMonitor();}","if(btn.dataset.tab==='settings'){loadState();loadPinSettings();loadSystemMonitor();loadLiveColorPresets();}")
wp.write_text(web)

mockp=ROOT/"firmware/web/v3_mockup.js"; mock=mockp.read_text().replace("#E0B400","#E08700").replace("#FFFF44","#E08700");mockp.write_text(mock)

tp=ROOT/"tools/test_regressions.py"; tr=tp.read_text()
tr=tr.replace("# v3.1.11 unified event palette, OTA verification, and bottom-menu logout","# v3.1.17 selectable historical event palettes, editable preset slots, OTA verification")
tr=tr.replace("assert '/api/event-color-theme' not in main+web and 'eventColorsOriginal' not in web and 'eventColorsModern' not in web\nassert 'EventColorTheme' not in main and 'eventColorThemeGeneration' not in main","assert '/api/event-color-theme' in main+web and 'eventColors3028' in web and 'eventColors3029' in web\nassert 'EventColorTheme' in main and 'eventColorThemeGeneration' in main and 'applyOriginalEventColors' in main")
tr=tr.replace("assert '0xE0B400' in ev and '0xFFFF44' not in ev","assert '0xE08700' in ev and '0xFFFF44' not in ev and '0xE0B400' not in ev")
tr=tr.replace("assert '{0xE0B400,0xE0B400}, // Yellow' in t('firmware/src/ColorCorrection.cpp')","assert '{0xE08700,0xE08700}, // Yellow' in t('firmware/src/ColorCorrection.cpp')")
tr=tr.replace("assert \"{name:'Yellow',reference:'#FFFF00',output:'#E0B400'}\" in web","assert \"{name:'Yellow',reference:'#E08700',output:'#E08700'}\" in web")
tr=tr.replace("assert \"let running={name:'Yellow',colors:['#E0B400']\" in web","assert '#E08700' in web")
tr=tr.replace("assert \"'#FFFF44':'#E0B400'\" in web","assert 'liveColorHex' in web and 'liveColorR' in web and 'liveColorSavePreset' in web")
tr=re.sub(r"for value in \['0x00BD4C'.*?assert value not in ev\n","for value in ['0x00BD4C','0x00B4B4','0x0096FF','0xFFA000','0xB464FF','0x87002D','0xA0A5AF']: assert value in ev\n",tr,count=1)
tr=tr.replace("assert \"{name:'Navy Blue',reference:'#000080',output:'#001478'}\" in web","assert \"{name:'Navy Blue',reference:'#001478',output:'#001478'}\" in web")
tr=tr.replace("palette_block=re.search(r'const NAMED_COLOR_PALETTE=\\[(.*?)\\];',web,re.S); assert palette_block and palette_block.group(1).count(\"{name:'\")==9","palette_block=re.search(r'const NAMED_COLOR_PALETTE=\\[(.*?)\\];',web,re.S); assert palette_block and palette_block.group(1).count(\"{name:'\")==16")
tr=tr.replace("assert 'PALETTE_MIGRATION_REVISION=8' in t('firmware/src/PaletteMigration.cpp')","assert 'PALETTE_MIGRATION_REVISION=9' in t('firmware/src/PaletteMigration.cpp')")
tr=tr.replace("assert 'Basic Scheme v 3.0.28' not in web and 'Advanced Scheme v 3.0.29' not in web","assert '3.0.28 Colors' in web and '3.0.29 Colors' in web")
tr=tr.replace("assert 'verify_ota_manifest.py' in publisher and 'remote-update/pending/$VERSION.json' in publisher and 'remote-update/releases/$VERSION.json' in publisher","assert 'verify_ota_manifest.py' in publisher and 'ANDERSON_OTA_SIGNING_KEY_B64' in publisher and 'remote-update/pending/$VERSION.json' in publisher")
tp.write_text(tr)

write("firmware/RELEASE_NOTES_v3.1.17.md",'''# Anderson Home v3.1.17

- Restores selectable built-in event color schemes from v3.0.28 and v3.0.29.
- Preserves the exact historical per-event color assignments while using Yellow `#E08700`.
- Restores the expanded v3.0.29 named palette (16 preset slots).
- Live Preview accepts direct HEX and RGB entry and keeps the wheel marker synchronized.
- Live Preview can overwrite an existing named preset slot; it cannot add new preset slots.
- Preset overwrites are persisted in NVS and covered by Settings Backup & Restore.
- Existing explicit per-event custom edits remain overrides on top of either historical scheme.
- Schedule 2 remains at 10% and dual-controller dispatch remains zero intentional gap.
''')

main=read("firmware/src/main.cpp"); web=read("firmware/web/index.html"); ev=read("firmware/src/EventCatalog.cpp")
assert 'ANDERSON_FIRMWARE_VERSION="3.1.17"' in main
assert '/api/event-color-theme' in main and '/api/colors' in main
assert 'eventColors3028' in web and 'eventColors3029' in web
assert 'liveColorHex' in web and 'liveColorR' in web and 'liveColorSavePreset' in web
assert 'Save Over Selected Preset' in web
assert '0xE08700' in ev and '0xFFFF44' not in ev and '0xE0B400' not in ev
assert len(re.findall(r'^\{"evt\d{3}"',ev,re.M))==210
assert '0xFFA000' in ev and '0x00B4B4' in ev and '0x0096FF' in ev
print("Applied Anderson Home v3.1.17 selectable historical palettes and Live Preview preset editing")
