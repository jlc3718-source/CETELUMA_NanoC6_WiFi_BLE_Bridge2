#!/usr/bin/env python3
"""Anderson named colors: screen appearance must NEVER change calibrated LED RGB."""
import json
import re
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
expected=[["Red","FF0000","FF0000"],["Orange","FF0D00","FF7A00"],["Pink","FF0024","FF3B9D"],["Yellow","E08700","FFD400"],["Green","28FF00","00C853"],["Cyan","00BD4C","00D9FF"],["Blue","0D00FF","0066FF"],["Purple","5B00E6","8A2BE2"],["White","FFFFFA","FFFFFF"],["Teal","00B4B4","00B8A9"],["Sky Blue","0096FF","4DB8FF"],["Amber Gold","FFA000","FFB000"],["Lavender","B464FF","B57EDC"],["Navy Blue","001478","001F5B"],["Burgundy","87002D","800020"],["Silver Gray","A0A5AF","A7ADB5"]]
def read(path):
    return (ROOT/path).read_text()

web=read('firmware/web/index.html')
mock=read('firmware/web/v3_mockup.js')
correction=read('firmware/src/ColorCorrection.cpp')
ble=read('firmware/src/BleController.cpp')
events=read('firmware/src/EventColorThemes.cpp')
migration=read('firmware/src/PaletteMigration.cpp')
main=read('firmware/src/main.cpp')
remote=read('firmware/src/RemoteUpdate.cpp')

assert len(expected)==16 and len({p[0] for p in expected})==16
for name,led,visual in expected:
    assert f'{{0x{led},0x{led}}}, // {name}' in correction,(name,'calibration')
    assert f'{{name:"{name}",reference:"#{led}",output:"#{led}"}}' in web,(name,'browser payload palette')
    assert f'a.add("#{led}");' in migration,(name,'original palette migration')
    key=json.dumps(name) if ' ' in name else name
    assert f'{key}:"#{visual}"' in web,(name,'named screen swatch')
defaults=events.split('static constexpr uint32_t PRESET_DEFAULTS[]={',1)[1].split('};',1)[0]
assert re.findall(r'0x([0-9A-F]{6})',defaults)==[p[1] for p in expected], 'event palette changed'
assert 'andersonNamedOutputColor' not in correction+ble+events+main, 'color payload remap survived'
assert 'void BleController::setColor(uint32_t c,bool reliable){for(' in ble
assert 'wled.setColor(i,c)' in ble and 'r8(c),g8(c),b8(c)' in ble
assert 't.colors[0]=0xE08700' in main and 'runningTheme.colors[0]=0xE08700' in main
assert 'without changing any BLE/light payload' in mock
assert 'function semanticColorVisual(e,t=""){const n=t||semanticColorName(e);return SEMANTIC_COLOR_VISUAL[n]' in web
assert 'function displayColor(e){const t=normHex(e),name=LED_COLOR_NAME[t];' in web
assert 'masterFavoriteTile(t,"Use",()=>manual({name:"Favorite "+o,colors:[t]' in web
assert 'function normalizeLedColor' in web

# Execute the actual color-rendering function against the 16 original LED
# values and 16 legacy-to-new stored cases. This reproduces the screenshot's
# bug: the button named Yellow was rendered using its orange-looking LED code.
colors='const SEMANTIC_COLOR_VISUAL='+web.split('const SEMANTIC_COLOR_VISUAL=',1)[1].split(';function semanticColorName(',1)[0]+';'
fn='function semanticColorVisual('+web.split('function semanticColorVisual(',1)[1].split('function semanticColorInk(',1)[0]
assert fn.count('function semanticColorVisual')==1
js=(
    "const assert=require('node:assert/strict');\n"
    "const savedColors="+json.dumps(['#'+p[1] for p in expected])+";\n"
    "const savedColorLabels="+json.dumps([p[0] for p in expected])+";\n"
    "const expected="+json.dumps(expected)+";\n"
    "const normHex=v=>String(v).toUpperCase();\n"
    "const semanticColorName=v=>savedColorLabels[savedColors.indexOf(normHex(v))]||'Custom Color';\n"
    +colors+"\n"+fn+"\n"+
    "for (let i=0;i<expected.length;i++){\n"
    " const [name,led,visual]=expected[i];\n"
    " assert.equal(semanticColorVisual('#'+led,name),'#'+visual,name+' display');\n"
    " assert.equal(savedColors[i],'#'+led,name+' physical RGB changed');\n"
    "}\nconsole.log('PASS: sixteen named swatches retain separate calibrated payloads');"
)
subprocess.run(['node','-e',js],check=True)

# Build security/toolchain changes are deliberately retained from v3.1.95.
workflow=read('.github/workflows/compile-anderson-home-multi.yml')
script=read('firmware/scripts/c6_toolchain_path.py')
assert 'sha256sum --check -' in workflow and 'ANDERSON_GCC_BIN_DIR' in workflow
assert 'env.Replace(CXX=str(compiler), CC=str(gcc))' in script
assert '#include <psa/crypto.h>' in remote and '#include <psa/crypto.h>' in main
assert 'psa_hash_compute(PSA_ALG_SHA_256' in remote and 'psa_hash_compute(PSA_ALG_SHA_256' in main
assert 'mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256' in remote
print('PASS: original calibrated RGB unchanged, display labels corrected, OTA cryptography preserved')
