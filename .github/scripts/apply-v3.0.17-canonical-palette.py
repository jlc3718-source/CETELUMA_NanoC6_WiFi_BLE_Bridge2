from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
EVENT=ROOT/'firmware/src/EventCatalog.cpp'
CORR=ROOT/'firmware/src/ColorCorrection.cpp'
MIG=ROOT/'firmware/src/PaletteMigration.cpp'
MAIN=ROOT/'firmware/src/main.cpp'
WEB=ROOT/'firmware/web/index.html'
VER=ROOT/'FIRMWARE_VERSION.txt'
README=ROOT/'README.md'
AGENTS=ROOT/'AGENTS.md'

# User-calibrated canonical LED outputs.
CANON={
 'red':'FF0000','purple':'23018C','blue':'05008A','cyan':'00BD4C',
 'pink':'BF0005','orange':'FF2900','yellow':'FF6E00','green':'4DFF00'
}
legacy={
 'F18900':'FF6E00','FFFF00':'FF6E00','E44300':'FF6E00','FFDA7F':'FF6E00',
 'FF3000':'FF2900',
 '00FF00':'4DFF00','2AD555':'4DFF00',
 '0000FF':'05008A','004BC6':'05008A','377CF9':'05008A','A7C8FC':'05008A',
 '00FFFF':'00BD4C','00664D':'00BD4C',
 '7A62F9':'23018C',
 'FF020C':'BF0005','FF1560':'BF0005','EF4F98':'BF0005','FF00FF':'BF0005'
}

# Built-in events: collapse every legacy shade to the requested basic event family.
event=EVENT.read_text()
for old,new in legacy.items(): event=event.replace('0x'+old,'0x'+new)
EVENT.write_text(event)

# Color correction / nearest-family mapper. Reference colors keep their semantic
# family, while every output is one of the user's calibrated codes (plus white/brown/black).
corr=CORR.read_text()
palette='''const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE[] = {
  {0xFF0000,0xFF0000},
  {0xFF9500,0xFF2900},
  {0xFFFF00,0xFF6E00},
  {0xFACC15,0xFF6E00},
  {0xF59E0B,0xFF6E00},
  {0x22C55E,0x4DFF00},
  {0x86EFAC,0x4DFF00},
  {0x2563EB,0x05008A},
  {0x0EA5E9,0x05008A},
  {0x93C5FD,0x05008A},
  {0x32D7D5,0x00BD4C},
  {0x14B8A6,0x00BD4C},
  {0x7E22CE,0x23018C},
  {0xC4B5FD,0x23018C},
  {0xFF00FF,0xBF0005},
  {0xFF2D55,0xBF0005},
  {0xFF69B4,0xBF0005},
  {0xF9A8D4,0xBF0005},
  {0xFFFFFF,0xFFFFFF},
  {0xFFF1C7,0xFF6E00},
  {0xDBEAFE,0x05008A},
  {0x92400E,0x360500},
  {0x7C2D12,0x220200},
  {0x000000,0x000000}
};'''
corr,n=re.subn(r'const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE\[\] = \{.*?\n\};',palette,corr,count=1,flags=re.S)
assert n==1

direct='''static constexpr DirectMap DIRECT_MAP[] = {
  // Canonical outputs are idempotent.
  {0xFF0000,0xFF0000},{0x23018C,0x23018C},{0x05008A,0x05008A},{0x00BD4C,0x00BD4C},
  {0xBF0005,0xBF0005},{0xFF2900,0xFF2900},{0xFF6E00,0xFF6E00},{0x4DFF00,0x4DFF00},
  {0xFFFFFF,0xFFFFFF},{0x360500,0x360500},{0x220200,0x220200},{0x000000,0x000000},
  // Red family.
  {0xFF3B30,0xFF0000},{0xEF4444,0xFF0000},{0xDC2626,0xFF0000},{0xEF233C,0xFF0000},{0xFF1744,0xFF0000},{0xE11D48,0xFF0000},
  // Orange family, including the previous Anderson orange output.
  {0xFF9500,0xFF2900},{0xFF7A00,0xFF2900},{0xF97316,0xFF2900},{0xFF6B35,0xFF2900},{0xFF3000,0xFF2900},
  // Yellow / gold / amber family, including previous corrected outputs.
  {0xFFFF00,0xFF6E00},{0xFACC15,0xFF6E00},{0xF5D76E,0xFF6E00},{0xFBBF24,0xFF6E00},{0xF59E0B,0xFF6E00},{0xFDE68A,0xFF6E00},
  {0xF18900,0xFF6E00},{0xE44300,0xFF6E00},{0xFFDA7F,0xFF6E00},{0xFFF1C7,0xFF6E00},
  // Green family.
  {0x34C759,0x4DFF00},{0x22C55E,0x4DFF00},{0x16A34A,0x4DFF00},{0x86EFAC,0x4DFF00},{0x00FF00,0x4DFF00},{0x2AD555,0x4DFF00},
  // Blue family, including sky/light/icy variants and previous corrected outputs.
  {0x0A84FF,0x05008A},{0x2563EB,0x05008A},{0x3B82F6,0x05008A},{0x0EA5E9,0x05008A},{0x5BC0EB,0x05008A},{0x38BDF8,0x05008A},
  {0x93C5FD,0x05008A},{0x60A5FA,0x05008A},{0xDBEAFE,0x05008A},{0x0000FF,0x05008A},{0x004BC6,0x05008A},{0x377CF9,0x05008A},{0xA7C8FC,0x05008A},
  // Cyan / teal family.
  {0x32D7D5,0x00BD4C},{0x14B8A6,0x00BD4C},{0x2DD4BF,0x00BD4C},{0x00FFFF,0x00BD4C},{0x00664D,0x00BD4C},
  // Purple / lavender family.
  {0x7E22CE,0x23018C},{0xA855F7,0x23018C},{0xBF5AF2,0x23018C},{0xC4B5FD,0x23018C},{0x7A62F9,0x23018C},
  // Pink / rose / magenta family.
  {0xFF00FF,0xBF0005},{0xFF4D6D,0xBF0005},{0xFF2D55,0xBF0005},{0xFF69B4,0xBF0005},{0xEC4899,0xBF0005},{0xFF2D92,0xBF0005},{0xF9A8D4,0xBF0005},
  {0xFF020C,0xBF0005},{0xFF1560,0xBF0005},{0xEF4F98,0xBF0005},
  // White / brown / black stay intentional non-palette neutrals.
  {0x92400E,0x360500},{0xB45309,0x360500},{0x7C2D12,0x220200},{0x111111,0x000000}
};'''
corr,n=re.subn(r'static constexpr DirectMap DIRECT_MAP\[\] = \{.*?\n\};',direct,corr,count=1,flags=re.S)
assert n==1
CORR.write_text(corr)

# v3 migration operates on the CURRENT saved/custom lights and event overrides.
# It intentionally does not read or write anderson-colors/saved (Favorite Colors).
mig=MIG.read_text().replace('PALETTE_MIGRATION_REVISION=2','PALETTE_MIGRATION_REVISION=3',1)
anchor='''static bool writeEvents(JsonObject events,bool corrected){
  Preferences p;if(!p.begin("anderson-event",false))return false;
  for(size_t i=0;i<64;i++){
    String key=eventKey(i);if(events[key].isNull()){p.remove(key.c_str());if(p.isKey(key.c_str())){p.end();return false;}continue;}
    String value=events[key].as<String>();if(corrected)value=transformEventRaw(value);size_t wrote=p.putString(key.c_str(),value);if(wrote!=value.length()||p.getString(key.c_str(),"")!=value){p.end();return false;}
  }
  p.end();return true;
}
'''
insert=anchor+'''static bool canonicalizeCurrentStoredPalette(){
  String originalPresets=readPrefString("anderson-preset","custom","[]"),correctedPresets;
  if(!transformPresetJson(originalPresets,correctedPresets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",correctedPresets))return false;
  JsonDocument current;JsonObject events=current["events"].to<JsonObject>();
  for(size_t i=0;i<64;i++){String key=eventKey(i),raw=readPrefString("anderson-event",key.c_str(),"");if(raw.length())events[key]=raw;}
  if(!writeEvents(events,true))return false;
  return setMigrationState(STATE_APPLIED,true);
}
'''
assert anchor in mig
mig=mig.replace(anchor,insert,1)
old_run=re.search(r'bool runPaletteColorMigration\(\)\{.*?\n\}',mig,re.S)
assert old_run
new_run='''bool runPaletteColorMigration(){
  uint8_t state=migrationState(),revision=migrationRevision();
  if(revision>=PALETTE_MIGRATION_REVISION&&(state==STATE_APPLIED||state==STATE_RESTORED))return true;
  // v3+ canonicalizes the device's CURRENT custom/scheduled palette in place.
  // Favorite Colors are deliberately excluded from this migration.
  if(revision>=2){if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return canonicalizeCurrentStoredPalette();}
  if(state==STATE_RESTORE_PENDING)return restoreFromBackup();if(state==STATE_APPLY_PENDING)return applyFromBackup();
  if(revision>0&&state==STATE_RESTORED)return setMigrationState(STATE_RESTORED,true);
  if(revision>0&&state==STATE_APPLIED){JsonDocument backup;if(!loadBackup(backup))return false;if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return applyFromBackup();}
  if(!createBackup())return false;if(!setMigrationState(STATE_APPLY_PENDING,false))return false;return applyFromBackup();
}'''
mig=mig[:old_run.start()]+new_run+mig[old_run.end():]
mig=mig.replace('out["provisionalCorrection"]=true;out["physicallyCalibrated"]=false;','out["provisionalCorrection"]=false;out["physicallyCalibrated"]=true;',1)
MIG.write_text(mig)

# Normalize future saved custom lights and event overrides server-side, but leave
# the Favorite Colors API untouched so existing favorites remain exact.
main=MAIN.read_text()
main=main.replace('#include "PaletteMigration.h"','#include "PaletteMigration.h"\n#include "ColorCorrection.h"',1)
main=main.replace('ANDERSON_FIRMWARE_VERSION="3.0.16"','ANDERSON_FIRMWARE_VERSION="3.0.17"',1)
main=main.replace('for(uint8_t c=0;c<o.colorCount;c++)o.colors[c]=t.colors[c];','for(uint8_t c=0;c<o.colorCount;c++)o.colors[c]=andersonCorrectColor(t.colors[c]);',1)
old='String color=v.as<String>();if(color.length())c.add(color);'
assert old in main
main=main.replace(old,'String color=v.as<String>();if(color.length())c.add(andersonCorrectHex(color));',1)
MAIN.write_text(main)

# Web palette: canonical outputs for all new event/custom saves, with legacy
# display aliases so untouched Favorite Colors continue to look and behave as saved.
web=WEB.read_text()
start=web.index('const NAMED_COLOR_PALETTE=[')
end=web.index('function displayLabel(c)',start)
end=web.index('\n',end)+1
new_web='''const NAMED_COLOR_PALETTE=[
  {name:'Red',reference:'#FF0000',output:'#FF0000'},{name:'Purple',reference:'#7E22CE',output:'#23018C'},{name:'Blue',reference:'#2563EB',output:'#05008A'},{name:'Cyan',reference:'#32D7D5',output:'#00BD4C'},
  {name:'Pink',reference:'#FF69B4',output:'#BF0005'},{name:'Orange',reference:'#FF9500',output:'#FF2900'},{name:'Yellow',reference:'#FFFF00',output:'#FF6E00'},{name:'Green',reference:'#22C55E',output:'#4DFF00'},
  {name:'White',reference:'#FFFFFF',output:'#FFFFFF'},{name:'Brown',reference:'#92400E',output:'#360500'},{name:'Dark brown',reference:'#7C2D12',output:'#220200'},{name:'Black / unlit',reference:'#000000',output:'#000000'}
];
const LED_REFERENCE=Object.fromEntries(NAMED_COLOR_PALETTE.map(x=>[x.output,x.reference])),LED_COLOR_NAME=Object.fromEntries(NAMED_COLOR_PALETTE.map(x=>[x.output,x.name]));
const REFERENCE_LED={'#FF0000':'#FF0000','#7E22CE':'#23018C','#C4B5FD':'#23018C','#2563EB':'#05008A','#0EA5E9':'#05008A','#93C5FD':'#05008A','#DBEAFE':'#05008A','#32D7D5':'#00BD4C','#14B8A6':'#00BD4C','#FF69B4':'#BF0005','#FF2D55':'#BF0005','#F9A8D4':'#BF0005','#FF00FF':'#BF0005','#FF9500':'#FF2900','#FFFF00':'#FF6E00','#FACC15':'#FF6E00','#F59E0B':'#FF6E00','#FFF1C7':'#FF6E00','#22C55E':'#4DFF00','#86EFAC':'#4DFF00','#FFFFFF':'#FFFFFF','#92400E':'#360500','#7C2D12':'#220200','#000000':'#000000'};
const EXPLICIT_LED={'#FF3B30':'#FF0000','#EF4444':'#FF0000','#DC2626':'#FF0000','#EF233C':'#FF0000','#FF1744':'#FF0000','#E11D48':'#FF0000','#FF3000':'#FF2900','#FF7A00':'#FF2900','#F97316':'#FF2900','#FF6B35':'#FF2900','#F18900':'#FF6E00','#E44300':'#FF6E00','#FFDA7F':'#FF6E00','#00FF00':'#4DFF00','#2AD555':'#4DFF00','#34C759':'#4DFF00','#16A34A':'#4DFF00','#0000FF':'#05008A','#004BC6':'#05008A','#377CF9':'#05008A','#A7C8FC':'#05008A','#0A84FF':'#05008A','#3B82F6':'#05008A','#00FFFF':'#00BD4C','#00664D':'#00BD4C','#7A62F9':'#23018C','#FF020C':'#BF0005','#FF1560':'#BF0005','#EF4F98':'#BF0005','#FF00FF':'#BF0005'};
const LEGACY_DISPLAY={'#FF3000':'#FF9500','#F18900':'#FACC15','#E44300':'#F59E0B','#FFFF00':'#FFFF00','#FFDA7F':'#FFF1C7','#00FF00':'#22C55E','#2AD555':'#86EFAC','#0000FF':'#2563EB','#004BC6':'#0EA5E9','#377CF9':'#93C5FD','#A7C8FC':'#DBEAFE','#00FFFF':'#32D7D5','#00664D':'#14B8A6','#7A62F9':'#C4B5FD','#FF00FF':'#FF00FF','#FF020C':'#FF2D55','#FF1560':'#FF69B4','#EF4F98':'#F9A8D4'};
function normalizeLedColor(c){const k=normHex(c);return REFERENCE_LED[k]||EXPLICIT_LED[k]||k}
function displayColor(c){const k=String(c||'').toUpperCase();return LED_REFERENCE[k]||LEGACY_DISPLAY[k]||c}
function displayLabel(c){const k=String(c||'').toUpperCase(),n=LED_COLOR_NAME[k],r=LED_REFERENCE[k];return n&&r?`${n} ${r} • LED ${k}`:c}
'''
web=web[:start]+new_web+web[end:]
# New-builder/event suggestions use exact canonical codes. Existing Favorite Colors are not changed.
web=web.replace("let builderColors=['#004BC6'];","let builderColors=['#05008A'];",1)
web=web.replace("colors&&colors.length?colors.slice(0,8):['#004BC6']","colors&&colors.length?colors.slice(0,8):['#05008A']",1)
web=web.replace("?color:'#004BC6'","?color:'#05008A'",1)
web=web.replace("const suggestions=['#FFFFFF','#FF0000','#00FF00','#0000FF','#23018C','#FF3000','#F18900'];","const suggestions=['#FFFFFF','#FF0000','#4DFF00','#05008A','#23018C','#FF2900','#FF6E00','#00BD4C','#BF0005'];",1)
web=web.replace("builderColors[0]||'#004BC6'","builderColors[0]||'#05008A'",1)
oldquick="const quick=['#FFDA7F','#FFFFFF','#FF0000','#FF3000','#F18900','#00FF00','#00FFFF','#0000FF','#23018C','#FF1560','#E44300','#004BC6'];"
assert oldquick in web
web=web.replace(oldquick,"const quick=['#FF0000','#23018C','#05008A','#00BD4C','#BF0005','#FF2900','#FF6E00','#4DFF00','#FFFFFF'];",1)
web=web.replace("builderColors[0]==='#004BC6'","builderColors[0]==='#05008A'")
web=web.replace("state.colors&&state.colors.length?state.colors:['#004BC6']","state.colors&&state.colors.length?state.colors:['#05008A']",1)
web=web.replace("colors:['#004BC6','#23018C','#FFFFFF']","colors:['#05008A','#23018C','#FFFFFF']",1)
# Canonicalize colors when saving a custom light or event override; Favorite Color storage remains raw/exact.
web=web.replace("const preset={name,colors:[...builderColors],effect:","const preset={name,colors:builderColors.map(normalizeLedColor),effect:",1)
web=web.replace("const vals=[...colors.querySelectorAll('.colorChip')].map(x=>x.dataset.color);await eventChange", "const vals=[...colors.querySelectorAll('.colorChip')].map(x=>normalizeLedColor(x.dataset.color));await eventChange",1)
WEB.write_text(web)

# Version/docs.
assert VER.read_text().strip()=='3.0.16';VER.write_text('3.0.17\n')
rd=README.read_text();rd=rd.replace('Current firmware: **v3.0.16**.','Current firmware: **v3.0.17**.',1);README.write_text(rd)
ag=AGENTS.read_text();ag += '''\n- v3.0.17 canonical calibrated event palette (exact LED RGB): Red #FF0000; Purple #23018C; Blue #05008A; Cyan #00BD4C; Pink #BF0005; Orange #FF2900; Yellow #FF6E00; Green #4DFF00. Built-in events, event overrides, custom saved lights, and schedules that reference those saved lights use these family codes. Existing Favorite Colors must remain untouched by palette migration. White, black, and intentional autumn browns remain distinct.\n''';AGENTS.write_text(ag)

# Static validation.
allowed={'FF0000','23018C','05008A','00BD4C','BF0005','FF2900','FF6E00','4DFF00','FFFFFF','360500','220200','000000'}
vals=set(re.findall(r'0x([0-9A-Fa-f]{6})',EVENT.read_text()))
assert vals<=allowed, sorted(vals-allowed)
assert 'PALETTE_MIGRATION_REVISION=3' in MIG.read_text()
seg=MIG.read_text().split('static bool canonicalizeCurrentStoredPalette(){',1)[1].split('\n}',1)[0]
assert 'anderson-colors' not in seg and 'favoriteColors' not in seg
for code in CANON.values():
 assert ('0x'+code) in EVENT.read_text() or code=='00BD4C' or code=='BF0005'
 assert ('#'+code) in WEB.read_text()
assert "savedColors=r.colors||savedColors" in WEB.read_text()
print('Applied v3.0.17 canonical calibrated palette')
