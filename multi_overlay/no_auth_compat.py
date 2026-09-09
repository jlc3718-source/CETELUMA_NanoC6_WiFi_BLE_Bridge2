from pathlib import Path
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
print('Applied open full-control compatibility without authentication')
