from pathlib import Path
import sys

root=Path(sys.argv[1])
version=sys.argv[2].strip()
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

s=main.read_text()
anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
if anchor not in s: raise SystemExit('timeValid anchor missing for firmware version')
if 'ANDERSON_FIRMWARE_VERSION' not in s:
    s=s.replace(anchor,anchor+f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{version}";\n',1)
state='JsonDocument d;d["power"]=power;'
if state in s:
    s=s.replace(state,'JsonDocument d;d["firmwareVersion"]=ANDERSON_FIRMWARE_VERSION;d["power"]=power;',1)
else:
    raise SystemExit('stateJson anchor missing for firmware version')
main.write_text(s)

w=web.read_text()
panel=f'''    <div class="panel"><strong>Firmware Revision</strong><div class="sub">Current NanoC6 firmware</div><div class="card small" style="margin-top:10px"><strong>v{version}</strong></div></div>\n\n'''
anchor='<div class="panel"><strong>Persistent Configuration</strong>'
if 'Firmware Revision' not in w:
    if anchor not in w: raise SystemExit('Persistent Configuration panel missing for version display')
    w=w.replace(anchor,panel+anchor,1)
web.write_text(w)
print(f'Embedded Anderson Home firmware revision v{version}')
