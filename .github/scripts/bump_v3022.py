from pathlib import Path

def replace_once(path, old, new):
    p=Path(path); s=p.read_text(); n=s.count(old)
    if n!=1: raise SystemExit(f'{path}: expected one match for {old!r}, found {n}')
    p.write_text(s.replace(old,new,1))

replace_once('FIRMWARE_VERSION.txt','3.0.21\n','3.0.22\n')
replace_once('firmware/src/main.cpp','static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.21";','static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.22";')
replace_once('README.md','Current firmware: **v3.0.21**.','Current firmware: **v3.0.22**.')

assert Path('FIRMWARE_VERSION.txt').read_text().strip()=='3.0.22'
main=Path('firmware/src/main.cpp').read_text()
assert 'ANDERSON_FIRMWARE_VERSION="3.0.22"' in main
assert 'MASTER_SCENE_FAVORITE_COUNT==28' in main
assert 'eventStateReplaceFavorites(indices,MASTER_SCENE_FAVORITE_COUNT)' in main
ui=Path('firmware/web/index.html').read_text()
assert 'Scene Favorites' in ui
assert '.savedSwatch{min-width:0;min-height:48px' in ui
print('v3.0.22 version bump validated; final scene/color behavior preserved')
