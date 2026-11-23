#!/usr/bin/env python3
"""Ensure Anderson's sixteen named colors drive the same sRGB in UI and BLE/WLED."""
import re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
expected=[["Red","FF0000","FF0000"],["Orange","FF0D00","FF7A00"],["Pink","FF0024","FF69B4"],["Yellow","E08700","FFFF00"],["Green","28FF00","00FF00"],["Cyan","00BD4C","00FFFF"],["Blue","0D00FF","0000FF"],["Purple","5B00E6","8000FF"],["White","FFFFFA","FFFFFF"],["Teal","00B4B4","008080"],["Sky Blue","0096FF","4DB8FF"],["Amber Gold","FFA000","FFB000"],["Lavender","B464FF","B57EDC"],["Navy Blue","001478","001F5B"],["Burgundy","87002D","800020"],["Silver Gray","A0A5AF","A7ADB5"]]
correction=(ROOT/'firmware/src/ColorCorrection.cpp').read_text()
web=(ROOT/'firmware/web/index.html').read_text()
event=(ROOT/'firmware/src/EventColorThemes.cpp').read_text()
ble=(ROOT/'firmware/src/BleController.cpp').read_text()
legacy=(ROOT/'firmware/src/PaletteMigration.cpp').read_text()
assert len(expected)==16 and len({x[0] for x in expected})==16 and len({x[2] for x in expected})==16
for name,old,new in expected:
    assert f'{{0x{new},0x{new}}}, // {name}' in correction, (name,'C++ palette')
    assert f'{{name:"{name}",reference:"#{new}",output:"#{new}"}}' in web, (name,'UI palette')
    assert f'a.add("#{new}");' in legacy, (name,'migration reset baseline')
    if old!=new:
        assert f'case 0x{old}: return 0x{new};' in correction, (name,'old RGB mapping')
        assert f'"#{old}":"{name}"' in web, (name,'old label mapping')
values=event.split('static constexpr uint32_t PRESET_DEFAULTS[]={',1)[1].split('};',1)[0]
assert re.findall(r'0x([A-F0-9]{6})',values)==[x[2] for x in expected], 'preset order/content mismatch'
assert 'c=andersonNamedOutputColor(c);' in ble, 'BLE and WLED dispatch must be corrected'
assert 'andersonNamedOutputColor(syncTheme.colors[idx])' in ble, 'breathing interpolation must use corrected RGB'
assert 'andersonNamedOutputColor((uint32_t)c)' in event, 'persisted palette defaults not translated'
print('All 16 named palettes, previews, historical inputs, and BLE/WLED outputs match')

assert 'platformio/toolchain-riscv32-esp @ 15.2.0+20251204' in (ROOT/'firmware/platformio.ini').read_text()
