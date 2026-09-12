#!/usr/bin/env python3
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text()
def write(path,text): (ROOT/path).write_text(text)
def one(text,old,new,label):
    if text.count(old)!=1: raise SystemExit(f'{label}: expected 1 exact match, got {text.count(old)}')
    return text.replace(old,new,1)
def sub1(text,pat,repl,label,flags=0):
    out,n=re.subn(pat,repl,text,count=1,flags=flags)
    if n!=1: raise SystemExit(f'{label}: expected 1 regex match, got {n}')
    return out

# Version metadata.
write('FIRMWARE_VERSION.txt','3.1.1\n')
readme=read('README.md').replace('v3.1.0','v3.1.1')
write('README.md',readme)

# Palette-specific event override persistence. Keep the currently active palette in the
# existing RAM cache, but persist Original and Modern into separate NVS keys.
p=Path(ROOT/'firmware/src/main.cpp'); s=p.read_text()
s=one(s,
'''struct EventOverrideCfg{bool valid=false;Effect effect=Effect::Jump;uint32_t colors[8]={0};uint8_t colorCount=0;uint8_t speed=1;uint32_t colorGeneration=1;};
static EventOverrideCfg eventOverrides[MAX_BUILTIN_EVENTS];
static String eventOverrideKey(size_t i){return String("e")+String((unsigned)i);}
static uint8_t scheduledEventSpeedHint=1;''',
'''struct EventOverrideCfg{bool valid=false;Effect effect=Effect::Jump;uint32_t colors[8]={0};uint8_t colorCount=0;uint8_t speed=1;uint32_t colorGeneration=1;};
static EventOverrideCfg eventOverrides[MAX_BUILTIN_EVENTS];
static String eventOverrideKey(size_t i,EventColorTheme theme){return String(theme==EventColorTheme::Original?"o":"m")+String((unsigned)i);}
static String legacyEventOverrideKey(size_t i){return String("e")+String((unsigned)i);}
static EventColorTheme legacyOverrideTheme(const String& raw){
  int sep=raw.indexOf(';');if(sep>0){String head=raw.substring(0,sep);if(head.startsWith("v2|")){int b1=head.indexOf('|',3),b2=b1<0?-1:head.indexOf('|',b1+1);if(b2>=0){uint32_t g=max((uint32_t)1,(uint32_t)head.substring(b2+1).toInt());return (g&1U)?EventColorTheme::Modern:EventColorTheme::Original;}}}
  return EventColorTheme::Modern;
}
static bool migrateLegacyEventOverrides(){
  Preferences p;if(!p.begin("anderson-event",false))return false;bool ok=true;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){
    String oldKey=legacyEventOverrideKey(i),raw=p.getString(oldKey.c_str(),"");if(!raw.length())continue;String newKey=eventOverrideKey(i,legacyOverrideTheme(raw));
    if(!p.isKey(newKey.c_str())){size_t wrote=p.putString(newKey.c_str(),raw);if(wrote!=raw.length()||p.getString(newKey.c_str(),"")!=raw){ok=false;continue;}}
    if(p.isKey(newKey.c_str())&&!p.remove(oldKey.c_str())&&p.isKey(oldKey.c_str()))ok=false;
  }
  p.end();return ok;
}
static uint8_t scheduledEventSpeedHint=1;''', 'override key block')

s=one(s,
'''Theme applyEventOverrideByIndex(size_t i,const Theme& base){Theme t=base;if(i<EVENT_COUNT&&activeEventColorTheme==EventColorTheme::Original)applyOriginalEventColors(i,t);scheduledEventSpeedHint=eventSpeed(i);if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS||!eventOverrides[i].valid)return t;const auto&o=eventOverrides[i];scheduledEventSpeedHint=constrain(o.speed,1,5);t.effect=o.effect;if(o.colorCount&&o.colorGeneration==eventColorThemeGeneration){t.colorCount=o.colorCount;for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=o.colors[c];}return t;}''',
'''Theme applyEventOverrideByIndex(size_t i,const Theme& base){Theme t=base;if(i<EVENT_COUNT&&activeEventColorTheme==EventColorTheme::Original)applyOriginalEventColors(i,t);scheduledEventSpeedHint=eventSpeed(i);if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS||!eventOverrides[i].valid)return t;const auto&o=eventOverrides[i];scheduledEventSpeedHint=constrain(o.speed,1,5);t.effect=o.effect;if(o.colorCount){t.colorCount=o.colorCount;for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=o.colors[c];}return t;}''', 'override apply generation')

s=sub1(s,
r'''static void loadEventOverrides\(\)\{Preferences p;if\(!p\.begin\("anderson-event",true\)\)return;for\(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i\+\+\)\{String raw=p\.getString\(eventOverrideKey\(i\)\.c_str\(\),""\);if\(!raw\.length\(\)\)continue;(.*?)eventOverrides\[i\]=o;\}p\.end\(\);\}''',
'''static void loadEventOverrides(){
  for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++)eventOverrides[i]=EventOverrideCfg();
  Preferences p;if(!p.begin("anderson-event",true))return;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){
    String raw=p.getString(eventOverrideKey(i,activeEventColorTheme).c_str(),"");
    if(!raw.length()){String legacy=p.getString(legacyEventOverrideKey(i).c_str(),"");if(legacy.length()&&legacyOverrideTheme(legacy)==activeEventColorTheme)raw=legacy;}
    if(!raw.length())continue;int sep=raw.indexOf(';');if(sep<1)continue;String head=raw.substring(0,sep);EventOverrideCfg o;o.valid=true;o.colorGeneration=eventColorThemeGeneration;if(head.startsWith("v2|")){int b1=head.indexOf('|',3),b2=b1<0?-1:head.indexOf('|',b1+1);if(b1<0||b2<0)continue;o.effect=effectFromString(head.substring(3,b1));o.speed=constrain(head.substring(b1+1,b2).toInt(),1,5);o.colorGeneration=max((uint32_t)1,(uint32_t)head.substring(b2+1).toInt());}else{int bar=head.indexOf('|');if(bar>0){o.effect=effectFromString(head.substring(0,bar));o.speed=constrain(head.substring(bar+1).toInt(),1,5);}else{o.effect=effectFromString(head);o.speed=1;}}String list=raw.substring(sep+1);int pos=0;while(pos<(int)list.length()&&o.colorCount<8){int comma=list.indexOf(',',pos);String v=comma<0?list.substring(pos):list.substring(pos,comma);v.trim();if(v.startsWith("#"))v.remove(0,1);if(v.length())o.colors[o.colorCount++]=strtoul(v.c_str(),nullptr,16);if(comma<0)break;pos=comma+1;}eventOverrides[i]=o;
  }
  p.end();
}''','loadEventOverrides',flags=re.S)

s=s.replace('String key=eventOverrideKey(i);size_t wrote=p.putString(key.c_str(),raw);','String key=eventOverrideKey(i,activeEventColorTheme);size_t wrote=p.putString(key.c_str(),raw);')
s=s.replace('String key=eventOverrideKey(i);Preferences p;if(!p.begin("anderson-event",false))return false;','String key=eventOverrideKey(i,activeEventColorTheme);Preferences p;if(!p.begin("anderson-event",false))return false;')
if 'eventOverrideKey(i);' in s: raise SystemExit('unscoped eventOverrideKey call remains')

s=one(s,
'''if(!setEventColorTheme(next)){server.send(500,"text/plain","Event color theme write failed");return;}evaluateSchedule(true);''',
'''if(!setEventColorTheme(next)){server.send(500,"text/plain","Event color theme write failed");return;}loadEventOverrides();evaluateSchedule(true);''','theme switch reload')

s=one(s,
'''store.begin();eventStateBegin();remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION);loadPinAuthConfig();customFsReady=storageHealthCheck();if(customFsReady){migrateLegacyCustomStorage();runPaletteColorMigration();migrateMasterCalendarV1();}seedMasterSceneFavoritesV4();loadEventColorTheme();loadEventOverrides();connectWiFi();''',
'''store.begin();eventStateBegin();remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION);loadPinAuthConfig();customFsReady=storageHealthCheck();if(customFsReady){migrateLegacyCustomStorage();runPaletteColorMigration();migrateMasterCalendarV1();}seedMasterSceneFavoritesV4();loadEventColorTheme();migrateLegacyEventOverrides();loadEventOverrides();connectWiFi();''','setup override migration')

s=one(s,
'''e["id"]=EVENTS[i].id;e["name"]=label?label:EVENTS[i].name;e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);''',
'''e["id"]=EVENTS[i].id;e["name"]=label?label:EVENTS[i].name;e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);e["favorite"]=true;e["custom"]=false;''','favorite api metadata')
p.write_text(s)

# Favorites UI: checked Favorite control beside every scene for fast removal.
p=Path(ROOT/'firmware/web/index.html'); s=p.read_text()
old=re.search(r'async function loadFavorites\(\)\{.*?\}\n\nfunction customLightSummary',s,re.S)
if not old: raise SystemExit('loadFavorites function not found')
new='''async function loadFavorites(){let favs=[];try{favs=(await api('/api/favorites')).events||[]}catch(e){return}const grid=$('favoriteGrid');grid.innerHTML='';if(!favs.length){grid.innerHTML='<div class="emptyFav" style="grid-column:1/-1">No favorite scenes selected. Use a Favorites checkbox on the Schedules tab.</div>';return}favs.forEach(ev=>{const item=document.createElement('div');item.className='card';const top=document.createElement('div');top.className='row between';const b=document.createElement('button');b.className='btn';b.style.flex='1';b.textContent=ev.name;b.addEventListener('click',()=>manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:ev.brightness||100,speed:ev.speed||1}));const label=document.createElement('label');label.className='row small';label.style.whiteSpace='nowrap';const fav=document.createElement('input');fav.type='checkbox';fav.checked=true;fav.setAttribute('aria-label','Favorite '+ev.name);label.append(fav,document.createTextNode('Favorite'));fav.addEventListener('change',async()=>{if(fav.checked)return;fav.disabled=true;try{if(ev.custom)await post('/api/preset',{id:ev.id,favorite:false});else await post('/api/event',{id:ev.id,favorite:false});await Promise.all([loadFavorites(),loadEvents(),loadHomeCustomLights()]);status((ev.name||'Favorite')+' removed from Favorites.')}catch(e){fav.checked=true;fav.disabled=false;status('Favorite change failed: '+e.message)}});top.append(b,label);item.appendChild(top);grid.appendChild(item)})}

function customLightSummary'''
s=s[:old.start()]+new+s[old.end():]
# Remove now-unused top hero element and base CSS.
s=s.replace('    <div class="andersonHero" role="img" aria-label="Anderson Home multicolor house-light logo"></div>\n','')
s=re.sub(r'\.andersonHero\{[^}]*\}\.andersonHero:after\{[^}]*\}\n','',s,count=1)
s=re.sub(r'@media\(max-width:520px\)\{\.andersonHero\{[^}]*\}\.header\{padding:10px\}\}','@media(max-width:520px){.header{padding:10px}}',s,count=1)
p.write_text(s)

# Remove the sprite dependency and the cropped rainbow Current Effect artwork.
p=Path(ROOT/'firmware/web/v3_mockup.js'); s=p.read_text()
s=one(s,
'''    q('.andersonHero',home).classList.add('v3Scene');
    q('.andersonHero',home).setAttribute('aria-label','Anderson Home rainbow roof logo above the illuminated house');
''','', 'composeHome hero')
s=one(s,
'''const features=el('div','v3FeatureGrid'), fx=el('div','v3EffectCard',`<div class="v3CardKicker">${icon('spark')}<span>Current Effect</span></div><div class="v3EffectArt" aria-hidden="true"></div>`);''',
'''const features=el('div','v3FeatureGrid'), fx=el('div','v3EffectCard',`<div class="v3CardKicker">${icon('spark')}<span>Current Effect</span></div>`);''','current effect art')
p.write_text(s)

p=Path(ROOT/'firmware/web/v3_mockup.css'); s=p.read_text()
s=s.replace("--v3-art:url('__V3_HERO_DATA_URI__');",'')
s=re.sub(r'/\* CSS crops keep the original art intact, while excluding every mockup control\. \*/\n\.v3Scene\{.*?\}\n\.v3Scene:before\{.*?\}\n\.v3Scene:after\{.*?\}\n','',s,count=1,flags=re.S)
s=re.sub(r'\.v3EffectArt\{[^}]*\}\n','',s,count=1)
if '__V3_HERO_DATA_URI__' in s or 'var(--v3-art)' in s or '.v3EffectArt' in s: raise SystemExit('hero sprite references remain in CSS')
p.write_text(s)

# release.py no longer packages or validates the deleted hero image.
p=Path(ROOT/'tools/release.py'); s=p.read_text()
s=s.replace('import base64\n','')
s=s.replace("V3_HERO_B64 = ROOT / 'firmware/web/v3_hero.b64'\n",'')
s=sub1(s,r'''    if not V3_CSS\.exists\(\) or not V3_JS\.exists\(\) or not V3_HERO_B64\.exists\(\):\n        raise ValueError\('Anderson v3 reference layout assets are missing'\)\n\n    hero_b64 = .*?    css = V3_CSS\.read_text\(\)\.replace\('__V3_HERO_DATA_URI__', 'data:image/webp;base64,' \+ hero_b64\)\n    if '__V3_HERO_DATA_URI__' in css:\n        raise ValueError\('Anderson v3 hero placeholder was not resolved'\)\n''',
'''    if not V3_CSS.exists() or not V3_JS.exists():\n        raise ValueError('Anderson v3 reference layout assets are missing')\n\n    css = V3_CSS.read_text()\n''','release hero dependency',flags=re.S)
if 'V3_HERO' in s or 'hero_b64' in s or '__V3_HERO_DATA_URI__' in s: raise SystemExit('release hero dependency remains')
p.write_text(s)

hero=ROOT/'firmware/web/v3_hero.b64'
if hero.exists(): hero.unlink()

# Keep the standing project instructions aligned with the shipped behavior.
p=Path(ROOT/'AGENTS.md'); s=p.read_text()
s=s.replace('illuminated nighttime house/RGB hero, integrated Anderson Home branding, dark translucent glass controls, prominent green ON control, rainbow brightness bar, effect/schedule cards, circular favorite colors, feature tiles, and floating bottom navigation.','integrated Anderson Home branding, dark translucent glass controls, prominent ON/OFF controls, monochrome brightness bar, effect/schedule cards, square dimensional favorite-color tiles, feature tiles, and floating bottom navigation. Do not restore the retired v3 hero/rainbow sprite.')
s=s.replace('Effect IDs `Jump=0, Breath=1, Strobe=2, Gradient=3, Solid=4`.','Supported user effects are Jump, Breath, Strobe, and Solid/Static. Legacy Gradient ID 3 may remain reserved for backward compatibility but must never be offered or assigned; legacy Gradient assignments migrate to Breath.')
s=s.replace('v3.0.21 and later Favorite Colors are the firmware-locked nine-color master palette in this exact order: Red `#FF0000`, Orange `#FF0D00`, Pink `#FF0024`, Yellow `#FFFF44`, Green `#28FF00`, Cyan `#00BD4C`, Blue `#0D00FF`, Purple `#5B00E6`, White `#FFFFFA`.','v3.0.29 and later Favorite Colors are the firmware-locked 16-color master palette: Red `#FF0000`, Orange `#FF0D00`, Pink `#FF0024`, Yellow `#FFFF44`, Green `#28FF00`, Cyan `#00BD4C`, Blue `#0D00FF`, Purple `#5B00E6`, White `#FFFFFA`, Teal `#00B4B4`, Sky Blue `#0096FF`, Amber Gold `#FFA000`, Lavender `#B464FF`, Navy Blue `#001478`, Burgundy `#87002D`, Silver Gray `#A0A5AF`.')
insert='''\n- Original Colors and Modern Colors must each retain their own per-event overrides in NVS. Switching palettes must never discard or invalidate the other palette's custom colors/effect/speed, and routine firmware upgrades must preserve both sets. Legacy single-slot event overrides must be migrated non-destructively.\n- The Favorites page must show a checked Favorite control beside every favorite scene so it can be removed directly from that page.\n'''
needle='- Built-in event palettes are editable through saved per-event overrides. The UI must\n  allow visible removal as well as addition of colors while keeping at least one color;\n  preserve event identity, ordering, schedules, and unrelated event settings.\n'
if insert.strip() not in s:
    s=one(s,needle,needle+insert,'AGENTS persistence insertion')
p.write_text(s)

notes=ROOT/'firmware/RELEASE_NOTES_v3.1.1.md'
notes.write_text('''# Anderson Home v3.1.1\n\n- Fixed built-in event customization persistence across firmware updates and Original/Modern palette switching.\n- Original Colors and Modern Colors now keep independent per-event override records in NVS; switching palettes restores that palette's saved colors, effect, and speed.\n- Added a non-destructive migration for the v3.1.0 single-slot event override format.\n- Added checked Favorite controls beside scenes on the Favorites page for one-step removal.\n- Removed the rainbow artwork from the Home Current Effect card.\n- Deleted the retired v3 hero/rainbow sprite and removed it from the firmware UI build pipeline.\n- Preserved schedules, event identity, PIN/auth data, Wi-Fi/BLE behavior, custom shows, and OTA partition compatibility.\n''')

print('v3.1.1 persistence/UI patch applied')
