from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
s=main.read_text()

# -----------------------------------------------------------------------------
# BASIC PROFILE MODE
# There is intentionally NO server-side authentication in this build.
# Jason/Shirley are UI profiles only, selected and remembered by JavaScript.
#
# Keep these compatibility helpers because later feature overlays use them when
# adding custom-light/schedule and OTA routes.  They deliberately allow access.
# -----------------------------------------------------------------------------
anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
helpers=r'''

// Open controller mode. UI profile separation is handled in WebUI JavaScript.
static uint8_t requestRole(){return 2;}
static bool requireUser(){return true;}
static bool requireAdmin(){return true;}
'''
if anchor not in s:
    raise SystemExit('timeValid anchor not found')
s=s.replace(anchor,anchor+helpers,1)

main.write_text(s)
print('Authentication removed; controller routes are open and roles are UI-only profiles')
