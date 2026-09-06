from pathlib import Path

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
manifest = root / 'android/app/src/main/AndroidManifest.xml'
s = manifest.read_text()
s = s.replace('android:label="Craumer Lights Test v6"', 'android:label="Craumer Light Control"')
s = s.replace('android:label="Craumer Lights Eufy Test v6"', 'android:label="Craumer Light Control"')
s = s.replace('android:label="Craumer Lights Eufy Test"', 'android:label="Craumer Light Control"')
manifest.write_text(s)

# Also remove visible test-version branding from the embedded UI.
for rel in ['web/index.html', 'android/app/src/main/assets/index.html']:
    p = root / rel
    s = p.read_text()
    for label in ['TEST v9', 'TEST v8', 'TEST v7', 'TEST v6']:
        s = s.replace(label, 'Craumer Light Control')
    p.write_text(s)
print('Applied permanent Craumer Light Control app name')
