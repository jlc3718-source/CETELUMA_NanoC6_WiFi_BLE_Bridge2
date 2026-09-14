#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
js_path=ROOT/'firmware/web/v3_mockup.js'
js=js_path.read_text()

# Dedicated Live Preview settings tab. Reuse the existing live color tuner panel
# and its real /api/control bindings rather than duplicating preview logic.
old="const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['backup','Backup & Restore'],['security','Users & Security'],['firmware','Firmware']];"
new="const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['preview','Live Preview'],['schedules','Schedules'],['controllers','Controllers'],['backup','Backup & Restore'],['security','Users & Security'],['firmware','Firmware']];"
if old in js:
    js=js.replace(old,new,1)
elif new not in js:
    raise SystemExit('3.1.13 settings tab list not found')

old_category="if(node.id==='liveColorTunerPanel')return 'lighting';"
new_category="if(node.id==='liveColorTunerPanel')return 'preview';"
if old_category in js:
    js=js.replace(old_category,new_category,1)
elif new_category not in js:
    raise SystemExit('live color tuner category mapping not found')

js_path.write_text(js)

notes=ROOT/'firmware/RELEASE_NOTES_v3.1.13.md'
if notes.exists():
    text=notes.read_text()
    line='- Adds a dedicated Live Preview tab in Settings using the existing live controller preview controls.\n'
    if line not in text:
        text=text.replace('- Adds a dedicated Backup & Restore tab', line+'- Adds a dedicated Backup & Restore tab',1)
        notes.write_text(text)

print('Added dedicated Live Preview settings tab')
