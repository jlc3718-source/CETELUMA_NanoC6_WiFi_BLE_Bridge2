from pathlib import Path
import re

js_path=Path('firmware/web/v3_mockup.js')
js=js_path.read_text()

old_defs="const defs=[['general','General'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['security','Users & Security'],['firmware','Firmware']];"
new_defs="const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['schedules','Schedules'],['controllers','Controllers'],['security','Users & Security'],['firmware','Firmware']];"
if old_defs not in js:
    raise SystemExit('Settings tab definitions not found')
js=js.replace(old_defs,new_defs,1)

old_cat="if(node.id==='systemMonitorPanel'||node.classList.contains('v3SettingsLink'))return 'general';"
new_cat="if(node.classList.contains('v3SettingsLink'))return 'wifi';\n      if(node.id==='systemMonitorPanel')return 'general';"
if old_cat not in js:
    raise SystemExit('Settings category rule not found')
js=js.replace(old_cat,new_cat,1)
js_path.write_text(js)

Path('FIRMWARE_VERSION.txt').write_text('3.0.28\n')
readme=Path('README.md')
text=readme.read_text()
text,count=re.subn(r'Current firmware: \*\*v\d+\.\d+\.\d+[a-z]?\*\*\.', 'Current firmware: **v3.0.28**.', text, count=1)
if count!=1:
    raise SystemExit('README version marker not found')
readme.write_text(text)

Path('firmware/RELEASE_NOTES_v3.0.28.md').write_text('''# Anderson Home v3.0.28\n\n- Adds Wi-Fi as its own Settings sub-tab between General and Lighting.\n- Moves the existing Wi-Fi / Network & connection settings entry out of General and into the dedicated Wi-Fi sub-tab.\n- Keeps General focused on system/health information.\n- Preserves the v3.0.27 Settings sub-tab layout, bottom navigation, holiday search, Favorites tab, Jason/Shirley access, Schedule 1/2, event persistence, storage-health optimization, Wi-Fi/BLE/PINs, custom shows, partitions, and signed OTA trust.\n''')

assert "['general','General'],['wifi','Wi-Fi'],['lighting','Lighting']" in js
assert "classList.contains('v3SettingsLink'))return 'wifi'" in js
assert Path('FIRMWARE_VERSION.txt').read_text().strip()=='3.0.28'
print('v3.0.28 Wi-Fi sub-tab patch applied')
