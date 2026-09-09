from pathlib import Path
import subprocess
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

s=main.read_text()
anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
shim='''\n// Open full-control compatibility. There is intentionally no authentication.\nstatic uint8_t requestRole(){return 2;}\nstatic bool requireUser(){return true;}\nstatic bool requireAdmin(){return true;}\n'''
if 'static uint8_t requestRole()' not in s:
    if anchor not in s: raise SystemExit('timeValid anchor missing for no-auth shim')
    s=s.replace(anchor,anchor+shim,1)
main.write_text(s)

s=web.read_text()
if "let currentRole='admin'" not in s:
    first=s.find('<script>')
    if first<0: raise SystemExit('script tag missing for no-auth UI shim')
    first+=len('<script>')
    s=s[:first]+"\nlet currentRole='admin',currentUser='Jason';\n"+s[first:]
web.write_text(s)

here=Path(__file__).resolve().parent
subprocess.check_call([sys.executable,str(here/'littlefs_master_storage.py'),str(root)])

# The LittleFS schedule route defers scheduler refresh after the HTTP response.
s=main.read_text()
if 'static bool customScheduleRefreshPending' not in s:
    a='static bool timeValid(){return time(nullptr)>1700000000;}\n'
    decl='static bool customScheduleRefreshPending=false;\nstatic uint32_t customScheduleRefreshAt=0;\n'
    if a not in s: raise SystemExit('timeValid anchor missing for schedule refresh state')
    s=s.replace(a,a+decl,1)
main.write_text(s)

subprocess.check_call([sys.executable,str(here/'auto_ota_reboot.py'),str(root)])
subprocess.check_call([sys.executable,str(here/'legacy_guardrail_compat.py'),str(root)])
subprocess.check_call([sys.executable,str(here/'settings_time_persistence_fix.py'),str(root)])
# Theme must be applied after all other UI transforms so nothing changes it back to blue.
subprocess.check_call([sys.executable,str(here/'red_background.py'),str(web)])
print('Applied persistence, BLE restore, OTA reboot, schedule refresh, settings time persistence, and red UI')
