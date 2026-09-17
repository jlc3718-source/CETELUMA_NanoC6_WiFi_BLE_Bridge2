#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MAIN=ROOT/'firmware/src/main.cpp'
REL=ROOT/'tools/release.py'
VER=ROOT/'FIRMWARE_VERSION.txt'


def once(text,old,new,label):
    count=text.count(old)
    if count!=1: raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old,new,1)


def exact_count(text,old,new,count,label):
    found=text.count(old)
    if found!=count: raise SystemExit(f'{label}: expected {count} anchors, found {found}')
    return text.replace(old,new)

if VER.read_text().strip()!='3.1.48': raise SystemExit('Expected 3.1.48 source baseline')
main=MAIN.read_text()
main=once(main,'#include "EventColorThemes.h"\n#include "EventState.h"','#include "EventColorThemes.h"\n#include "EventCategories.h"\n#include "EventState.h"','category include')
main=once(main,'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.48";','static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.49";','runtime version')
main=once(main,'bool eventAllowedInActiveSchedule(size_t i){return i<EVENT_COUNT&&eventColorThemeIncludesEvent(activeEventColorTheme,i);}',
'''bool eventAllowedInActiveSchedule(size_t i){
  if(i>=EVENT_COUNT||!eventColorThemeIncludesEvent(activeEventColorTheme,i))return false;
  return activeEventColorTheme==EventColorTheme::MajorUS||eventCategoryAllowsEvent(i);
}''','active category filter')
main=exact_count(main,'e["kind"]=kindName(EVENTS[i].kind);e["when"]=',
'e["kind"]=kindName(EVENTS[i].kind);const auto& cat=eventCategoryDef(eventCategoryIndex(i));e["categoryId"]=cat.id;e["categoryName"]=cat.name;e["categoryColor"]=cat.color;e["when"]=',2,'event category response fields')
main=once(main,'String hay=String(EVENTS[i].name)+" "+when+" "+kindName(EVENTS[i].kind);',
'String hay=String(EVENTS[i].name)+" "+when+" "+kindName(EVENTS[i].kind)+" "+eventCategoryDef(eventCategoryIndex(i)).name;','category search text')
route_anchor='''  server.on("/api/favorites",HTTP_GET,[]{'''
category_routes='''  server.on("/api/event-categories",HTTP_GET,[]{
    if(!requireUser())return;JsonDocument d;d["mask"]=eventCategoryMask();d["expanded"]=activeEventColorTheme!=EventColorTheme::MajorUS;JsonArray arr=d["categories"].to<JsonArray>();
    for(uint8_t c=0;c<EVENT_CATEGORY_COUNT;c++){const auto& def=eventCategoryDef(c);JsonObject o=arr.add<JsonObject>();o["index"]=c;o["id"]=def.id;o["name"]=def.name;o["color"]=def.color;o["enabled"]=eventCategoryEnabled(c);uint16_t count=0;for(size_t i=0;i<EVENT_COUNT;i++)if(eventCategoryIndex(i)==c)count++;o["count"]=count;}
    String out;serializeJson(d,out);sendJson(out);
  });
  server.on("/api/event-categories",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;int index=d["index"]|-1;if(index<0||index>=EVENT_CATEGORY_COUNT||d["enabled"].isNull()){server.send(400,"application/json","{\\"ok\\":false,\\"error\\":\\"Choose a valid event category and enabled state\\"}");return;}bool enabled=d["enabled"].as<bool>();if(!eventCategorySetEnabled((uint8_t)index,enabled)){server.send(500,"application/json","{\\"ok\\":false,\\"error\\":\\"Event category setting could not be saved\\"}");return;}evaluateSchedule(true);const auto& def=eventCategoryDef((uint8_t)index);JsonDocument out;out["ok"]=true;out["index"]=index;out["id"]=def.id;out["name"]=def.name;out["color"]=def.color;out["enabled"]=eventCategoryEnabled((uint8_t)index);out["mask"]=eventCategoryMask();String json;serializeJson(out,json);sendJson(json);
  });

'''
main=once(main,route_anchor,category_routes+route_anchor,'category API routes')
main=once(main,'store.begin();eventStateBegin();loadPinAuthConfig();','store.begin();eventStateBegin();eventCategoriesBegin();loadPinAuthConfig();','category initialization')

# Include category switches in future Events backups while remaining compatible with older snapshots.
main=once(main,'for(const char* key:{"enabled","favorites"})if(e[key].is<JsonArray>())for(JsonVariant v:e[key].as<JsonArray>())h=settingsBackupFnvAdd(h,v.as<String>());JsonObject overrides=e["overrides"].as<JsonObject>();',
'for(const char* key:{"enabled","favorites"})if(e[key].is<JsonArray>())for(JsonVariant v:e[key].as<JsonArray>())h=settingsBackupFnvAdd(h,v.as<String>());if(e["categories"].is<String>())h=settingsBackupFnvAdd(h,e["categories"].as<String>());JsonObject overrides=e["overrides"].as<JsonObject>();','backup checksum categories')
main=once(main,'for(JsonVariant v:fav)if(!settingsBackupParseU64Hex(v.as<String>(),scratch))return false;if(!e["overrides"].is<JsonObject>())return false;',
'for(JsonVariant v:fav)if(!settingsBackupParseU64Hex(v.as<String>(),scratch))return false;if(!e["categories"].isNull()&&(!e["categories"].is<String>()||!settingsBackupParseU64Hex(e["categories"].as<String>(),scratch)))return false;if(!e["overrides"].is<JsonObject>())return false;','backup validation categories')
main=once(main,'for(size_t w=0;w<EVENT_STATE_WORDS;w++){en.add(settingsBackupU64Hex(ew[w]));fav.add(settingsBackupU64Hex(fw[w]));}JsonObject ov=e["overrides"].to<JsonObject>();',
'for(size_t w=0;w<EVENT_STATE_WORDS;w++){en.add(settingsBackupU64Hex(ew[w]));fav.add(settingsBackupU64Hex(fw[w]));}e["categories"]=settingsBackupU64Hex(eventCategoryMask());JsonObject ov=e["overrides"].to<JsonObject>();','backup capture categories')
main=once(main,'for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++){bool wantEn=(en[i/64]>>(i%64))&1ULL,wantFav=(fav[i/64]>>(i%64))&1ULL;if(!eventStateSetEnabled(i,wantEn)||!eventStateSetFavorite(i,wantFav))return false;}Preferences p;',
'for(size_t i=0;i<MAX_BUILTIN_EVENTS;i++){bool wantEn=(en[i/64]>>(i%64))&1ULL,wantFav=(fav[i/64]>>(i%64))&1ULL;if(!eventStateSetEnabled(i,wantEn)||!eventStateSetFavorite(i,wantFav))return false;}if(e["categories"].is<String>()){uint64_t cm=0;if(!settingsBackupParseU64Hex(e["categories"].as<String>(),cm))return false;for(uint8_t c=0;c<EVENT_CATEGORY_COUNT;c++)if(!eventCategorySetEnabled(c,(cm&(1ULL<<c))!=0))return false;}Preferences p;','backup restore categories')
MAIN.write_text(main)
VER.write_text('3.1.49\n')

rel=REL.read_text()
rel=once(rel,"V3_JS = ROOT / 'firmware/web/v3_mockup.js'\nRECOVERY_UI = ROOT / 'firmware/web/recovery.html'",
"V3_JS = ROOT / 'firmware/web/v3_mockup.js'\nEVENT_CATEGORY_CSS = ROOT / 'firmware/web/event_categories.css'\nEVENT_CATEGORY_JS = ROOT / 'firmware/web/event_categories.js'\nRECOVERY_UI = ROOT / 'firmware/web/recovery.html'",'release asset paths')
old='''    if not V3_CSS.exists() or not V3_JS.exists():
        raise ValueError('Anderson v3 reference layout assets are missing')

    css = V3_CSS.read_text()
    js = V3_JS.read_text()
    style_tag = '\\n<style id="anderson-v3-reference-layout">\\n' + css + '\\n</style>\\n'
    script_tag = '\\n<script id="anderson-v3-reference-layout-runtime">\\n' + js + '\\n</script>\\n'
'''
new='''    if not V3_CSS.exists() or not V3_JS.exists() or not EVENT_CATEGORY_CSS.exists() or not EVENT_CATEGORY_JS.exists():
        raise ValueError('Anderson web layout assets are missing')

    css = V3_CSS.read_text() + '\\n' + EVENT_CATEGORY_CSS.read_text()
    js = V3_JS.read_text() + '\\n' + EVENT_CATEGORY_JS.read_text()
    style_tag = '\\n<style id="anderson-v3-reference-layout">\\n' + css + '\\n</style>\\n'
    script_tag = '\\n<script id="anderson-v3-reference-layout-runtime">\\n' + js + '\\n</script>\\n'
'''
rel=once(rel,old,new,'release category injection')
REL.write_text(rel)
print('Prepared Anderson Home 3.1.49 event-category source changes')
