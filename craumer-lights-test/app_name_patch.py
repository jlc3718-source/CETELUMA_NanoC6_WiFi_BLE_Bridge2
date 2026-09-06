from pathlib import Path
import re, time

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
manifest = root / 'android/app/src/main/AndroidManifest.xml'
s = manifest.read_text()
s = s.replace('android:label="Craumer Lights Test v6"', 'android:label="Craumer Light Control"')
s = s.replace('android:label="Craumer Lights Eufy Test v6"', 'android:label="Craumer Light Control"')
s = s.replace('android:label="Craumer Lights Eufy Test"', 'android:label="Craumer Light Control"')
manifest.write_text(s)

# Always give each build a higher Android versionCode so it installs over the prior APK.
gradle = root / 'android/app/build.gradle.kts'
g = gradle.read_text()
version_code = int(time.time())
g, count = re.subn(r'versionCode\s*=\s*\d+', f'versionCode = {version_code}', g, count=1)
if count != 1:
    raise SystemExit('Could not update Android versionCode')
gradle.write_text(g)

# Remove visible test-version branding from the embedded UI.
for rel in ['web/index.html', 'android/app/src/main/assets/index.html']:
    p = root / rel
    t = p.read_text()
    for label in ['TEST v11', 'TEST v10', 'TEST v9', 'TEST v8', 'TEST v7', 'TEST v6']:
        t = t.replace(label, 'Craumer Light Control')
    p.write_text(t)
print(f'Applied Craumer Light Control app name; Android versionCode={version_code}')
