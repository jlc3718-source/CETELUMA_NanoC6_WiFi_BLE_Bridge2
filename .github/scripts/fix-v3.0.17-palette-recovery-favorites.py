from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=ROOT/'firmware/src/PaletteMigration.cpp'
s=p.read_text()
old='''static bool applyFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets,colors;if(!transformPresetJson(backup["presets"].as<String>(),presets)||!transformFavoriteJson(backup["favoriteColors"].as<String>(),colors))return false;
  if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writePrefStringVerified("anderson-colors","saved",colors))return false;if(!writeEvents(backup["events"].as<JsonObject>(),true))return false;return setMigrationState(STATE_APPLIED,true);
}
static bool restoreFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets=backup["presets"].as<String>(),colors=backup["favoriteColors"].as<String>();if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writePrefStringVerified("anderson-colors","saved",colors))return false;if(!writeEvents(backup["events"].as<JsonObject>(),false))return false;return setMigrationState(STATE_RESTORED,true);
}'''
new='''static bool applyFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets;if(!transformPresetJson(backup["presets"].as<String>(),presets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writeEvents(backup["events"].as<JsonObject>(),true))return false;return setMigrationState(STATE_APPLIED,true);
}
static bool restoreFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets=backup["presets"].as<String>();if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writeEvents(backup["events"].as<JsonObject>(),false))return false;return setMigrationState(STATE_RESTORED,true);
}'''
assert old in s
s=s.replace(old,new,1)
p.write_text(s)
# No palette operation may write the Favorite Colors namespace.
for fn in ('canonicalizeCurrentStoredPalette','applyFromBackup','restoreFromBackup','runPaletteColorMigration'):
    part=p.read_text().split('static bool '+fn+'(){',1)[1].split('\n}',1)[0] if fn!='runPaletteColorMigration' else p.read_text().split('bool '+fn+'(){',1)[1].split('\n}',1)[0]
    assert 'writePrefStringVerified("anderson-colors"' not in part
print('Manual and automatic palette operations preserve Favorite Colors')
