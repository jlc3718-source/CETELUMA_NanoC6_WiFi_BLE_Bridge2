from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()
anchor = 'notes += "Craumer LAN local-service hits: ${lanHits.size}"'
replacement = '''notes += "Craumer LAN local-service hits: ${lanHits.size}"
            notes += "Known Craumer light LAN targets (Ring bridge excluded):"
            notes += "Front House Lights | 10-2C-B1-AD-C3-0C | 192.168.68.81"
            notes += "Garage Lights | 10-2C-B1-9D-F5-F8 | 192.168.68.108"
            notes += "Pool Side Lights | 10-2C-B1-0E-CB-76 | 192.168.68.64"
            notes += "Shed Lights | 10-2C-B1-EE-6D-9A | 192.168.68.59"'''
if anchor not in s:
    raise SystemExit('v10 LAN anchor not found')
s = s.replace(anchor, replacement, 1)
p.write_text(s)
print('Applied known Craumer LAN light targets; Ring Light Bridge excluded')
