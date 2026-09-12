from pathlib import Path
import re

SCENES = [
    ("evt006", "New Year's Day"),
    ("evt011", "Martin Luther King Jr. Day"),
    ("evt026", "Presidents' Day"),
    ("evt025", "Valentine's Day"),
    ("evt027", "Mardi Gras"),
    ("evt046", "St. Patrick's Day"),
    ("evt061", "April Fools' Day"),
    ("evt065", "Easter"),
    ("evt087", "Mother's Day"),
    ("evt095", "Memorial Day"),
    ("evt105", "Flag Day"),
    ("evt109", "Father's Day"),
    ("evt106", "Juneteenth"),
    ("evt118", "Independence Day"),
    ("evt144", "Labor Day"),
    ("evt135", "Childhood Cancer Awareness Month"),
    ("evt134", "Suicide Prevention Awareness Month"),
    ("evt145", "988 Day"),
    ("evt146", "World Suicide Prevention Day"),
    ("evt147", "Patriot Day / 9-11 Remembrance"),
    ("evt173", "Indigenous Peoples' / Columbus Day"),
    ("evt179", "Halloween"),
    ("evt193", "Veterans Day"),
    ("evt197", "Thanksgiving"),
    ("evt202", "Hanukkah"),
    ("evt208", "Christmas Day"),
    ("evt209", "Kwanzaa"),
    ("evt210", "New Year's Eve"),
]
assert len(SCENES) == 28


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {n}")
    p.write_text(s.replace(old, new, 1))

# Add one efficient batch API to EventState so setting the 28 defaults does not
# perform hundreds of independent NVS writes during a firmware migration.
replace_once(
    'firmware/include/EventState.h',
    'bool eventStateSetFavorite(size_t index, bool favorite);\nbool eventStateResetAll();',
    'bool eventStateSetFavorite(size_t index, bool favorite);\nbool eventStateReplaceFavorites(const size_t* indices, size_t count);\nbool eventStateResetAll();'
)

p = Path('firmware/src/EventState.cpp')
s = p.read_text()
needle = 'bool eventStateSetFavorite(size_t index,bool favorite){if(index>=MAX_BUILTIN_EVENTS)return false;if(!stateLoaded)eventStateBegin();size_t w=index/64;uint64_t bit=1ULL<<(index%64),next=favorite?favoriteWords[w]|bit:favoriteWords[w]&~bit;if(next==favoriteWords[w])return true;if(!persistWord("fav",w,next))return false;favoriteWords[w]=next;return true;}\n'
if s.count(needle) != 1:
    raise SystemExit('EventState.cpp: favorite setter anchor not found exactly once')
batch = needle + '''bool eventStateReplaceFavorites(const size_t* indices,size_t count){\n  if(!stateLoaded)eventStateBegin();uint64_t next[EVENT_STATE_WORDS]={0};\n  for(size_t i=0;i<count;i++){size_t index=indices[i];if(index>=MAX_BUILTIN_EVENTS)return false;next[index/64]|=1ULL<<(index%64);}\n  Preferences p;if(!p.begin(EVENT_STATE_NS,false))return false;bool ok=true;\n  for(size_t w=0;w<EVENT_STATE_WORDS;w++){String fk=wordKey("fav",w);size_t wrote=p.putULong64(fk.c_str(),next[w]);ok=ok&&wrote>0&&p.getULong64(fk.c_str(),~next[w])==next[w];}\n  p.end();if(!ok)return false;for(size_t w=0;w<EVENT_STATE_WORDS;w++)favoriteWords[w]=next[w];return true;\n}\n'''
p.write_text(s.replace(needle, batch, 1))

p = Path('firmware/src/main.cpp')
s = p.read_text()
scene_rows = '\n'.join(f'  {{"{event_id}","{label.replace(chr(34), chr(92)+chr(34))}"}},' for event_id, label in SCENES)
insert = f'''\nstruct MasterSceneFavorite{{const char* id;const char* label;}};\nstatic constexpr MasterSceneFavorite MASTER_SCENE_FAVORITES[]={{\n{scene_rows}\n}};\nstatic constexpr size_t MASTER_SCENE_FAVORITE_COUNT=sizeof(MASTER_SCENE_FAVORITES)/sizeof(MASTER_SCENE_FAVORITES[0]);\nstatic_assert(MASTER_SCENE_FAVORITE_COUNT==28,"Scene Favorites must match the approved 28-scene list");\n\nstatic bool migrateSceneFavoritesV2(){{\n  Preferences marker;if(!marker.begin("anderson",true))return false;uint8_t rev=marker.getUChar("calendarrev",0);marker.end();if(rev>=2)return true;\n  if(!clearCustomPresetFavorites())return false;size_t indices[MASTER_SCENE_FAVORITE_COUNT];\n  for(size_t n=0;n<MASTER_SCENE_FAVORITE_COUNT;n++){{int idx=eventIndexById(MASTER_SCENE_FAVORITES[n].id);if(idx<0||idx>=(int)MAX_BUILTIN_EVENTS)return false;indices[n]=(size_t)idx;}}\n  if(!eventStateReplaceFavorites(indices,MASTER_SCENE_FAVORITE_COUNT))return false;\n  auto& settings=store.get();settings.favoriteMask=0;store.saveAll();\n  if(!marker.begin("anderson",false))return false;marker.putUChar("calendarrev",2);bool ok=marker.getUChar("calendarrev",0)==2;marker.end();return ok;\n}}\n'''
anchor = 'static bool storageSelfTest(){Preferences p;if(!p.begin("anderson-test",false))return false;'
if s.count(anchor) != 1:
    raise SystemExit('main.cpp: storageSelfTest anchor missing')
s = s.replace(anchor, insert + '\n' + anchor, 1)

old_setup = 'migrateLegacyCustomStorage();runPaletteColorMigration();migrateMasterCalendarV1();}loadEventOverrides();'
new_setup = 'migrateLegacyCustomStorage();runPaletteColorMigration();migrateMasterCalendarV1();migrateSceneFavoritesV2();}loadEventOverrides();'
if s.count(old_setup) != 1:
    raise SystemExit('main.cpp: setup migration anchor missing')
s = s.replace(old_setup, new_setup, 1)

start = s.find('  server.on("/api/favorites",HTTP_GET,[]{')
end = s.find('  server.on("/api/event",HTTP_POST,[]{', start)
if start < 0 or end < 0:
    raise SystemExit('main.cpp: favorites handler anchors missing')
new_handler = '''  server.on("/api/favorites",HTTP_GET,[]{\n    if(!requireUser())return;JsonDocument d;JsonArray arr=d["events"].to<JsonArray>();bool added[MAX_BUILTIN_EVENTS]={false};\n    auto appendFavorite=[&](size_t i,const char* label){if(i>=EVENT_COUNT||i>=MAX_BUILTIN_EVENTS)return;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=label?label:EVENTS[i].name;e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:eventSpeed(i);JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));added[i]=true;};\n    for(const auto& fav:MASTER_SCENE_FAVORITES){int idx=eventIndexById(fav.id);if(idx>=0&&eventStateFavorite((size_t)idx))appendFavorite((size_t)idx,fav.label);}\n    for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++)if(eventStateFavorite(i)&&!added[i])appendFavorite(i,EVENTS[i].name);\n    JsonDocument presets;if(!deserializeJson(presets,presetStoreRaw())&&presets.is<JsonArray>())for(JsonObject p:presets.as<JsonArray>()){if(!(p["favorite"]|false))continue;JsonObject e=arr.add<JsonObject>();e["id"]=p["id"];e["name"]=p["name"];e["effect"]=p["effect"]|String("Jump");e["brightness"]=constrain(p["brightness"]|100,1,100);e["speed"]=constrain(p["speed"]|1,1,5);e["enabled"]=p["enabled"]|true;e["custom"]=true;JsonArray c=e["colors"].to<JsonArray>();for(JsonVariant v:p["colors"].as<JsonArray>())c.add(v.as<String>());}\n    String out;serializeJson(d,out);sendJson(out);\n  });\n'''
s = s[:start] + new_handler + s[end:]
p.write_text(s)

replace_once(
    'firmware/web/index.html',
    '<div class="panel"><strong>Favorites</strong><div class="sub">Favorite built-in events and custom lighting shows appear here.</div><div id="favoriteGrid" class="favoriteGrid"></div></div>',
    '<div class="panel"><strong>Scene Favorites</strong><div class="sub">The approved built-in event scenes appear here in their fixed Home order; any custom scene favorites follow them.</div><div id="favoriteGrid" class="favoriteGrid"></div></div>'
)

# Documentation is part of the source-of-truth handoff.
p = Path('firmware/RELEASE_NOTES_v3.0.21.md')
notes = p.read_text().rstrip() + '''\n- Set the Home Scene Favorites default to the approved 28-scene list and preserve its exact display order.\n- Fix Home Scene Favorites to read the 256-event state store, so favorites above event #64 work correctly.\n'''
p.write_text(notes)

p = Path('README.md')
s = p.read_text()
line = '- Favorite Colors are the firmware-locked nine-color master palette. The UI renders them as labeled rectangular color tiles; add/delete controls are intentionally unavailable, and changing the palette requires a new firmware build.\n'
add = line + '- Home Scene Favorites default to the approved 28-scene list in the configured display order; favorites use the full 256-event state store rather than the legacy 64-bit mask.\n'
if s.count(line) != 1:
    raise SystemExit('README favorite-colors line missing')
p.write_text(s.replace(line, add, 1))

# Strong post-patch assertions.
main = Path('firmware/src/main.cpp').read_text()
ui = Path('firmware/web/index.html').read_text()
event_state = Path('firmware/src/EventState.cpp').read_text()
assert main.count('MASTER_SCENE_FAVORITES') >= 4
for event_id, label in SCENES:
    assert f'{{"{event_id}"' in main
assert 'migrateSceneFavoritesV2();' in main
assert 'eventStateReplaceFavorites(indices,MASTER_SCENE_FAVORITE_COUNT)' in main
assert 'eventStateFavorite(i)&&!added[i]' in main
handler = main[main.index('server.on("/api/favorites"'):main.index('server.on("/api/event"')]
assert 'favoriteMask>>i' not in handler
assert 'eventStateFavorite' in handler
assert 'Scene Favorites' in ui
assert 'eventStateReplaceFavorites' in event_state
print('v3.0.21 final Scene Favorites patch validated:', len(SCENES), 'scenes')
