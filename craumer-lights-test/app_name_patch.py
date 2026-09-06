from pathlib import Path
import re, time

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')
manifest = root / 'android/app/src/main/AndroidManifest.xml'
s = manifest.read_text()
s = s.replace('android:label="Craumer Lights Test v6"', 'android:label="Craumer Light Control"')
s = s.replace('android:label="Craumer Lights Eufy Test v6"', 'android:label="Craumer Light Control"')
s = s.replace('android:label="Craumer Lights Eufy Test"', 'android:label="Craumer Light Control"')
manifest.write_text(s)

# Always give each build a higher Android versionCode.
gradle = root / 'android/app/build.gradle.kts'
g = gradle.read_text()
version_code = int(time.time())
g, count = re.subn(r'versionCode\s*=\s*\d+', f'versionCode = {version_code}', g, count=1)
if count != 1:
    raise SystemExit('Could not update Android versionCode')
gradle.write_text(g)

# Keep the user-entered Eufy login fields on this phone across app updates.
for rel in ['web/index.html', 'android/app/src/main/assets/index.html']:
    p = root / rel
    t = p.read_text()
    for label in ['TEST v12', 'TEST v11', 'TEST v10', 'TEST v9', 'TEST v8', 'TEST v7', 'TEST v6']:
        t = t.replace(label, 'Craumer Light Control')
    t = t.replace(
        'Your password is used only for the login request and is not saved by this app.',
        'Your login is saved only in this app on this phone so you do not have to re-enter it after updates.'
    )
    needle = "  const password=$('eufyPassword').value;\n"
    if needle in t and "craumerEufyEmail" not in t:
        t = t.replace(needle, needle + "  localStorage.setItem('craumerEufyEmail',email);\n  localStorage.setItem('craumerEufyPassword',password);\n", 1)
    listener = "if($('eufyConnect')) $('eufyConnect').addEventListener('click',eufyConnectAndDiscover);"
    if listener in t and "craumerEufyPassword" in t and "Saved login restore" not in t:
        restore = """// Saved login restore\nif($('eufyEmail')) $('eufyEmail').value=localStorage.getItem('craumerEufyEmail')||'';\nif($('eufyPassword')) $('eufyPassword').value=localStorage.getItem('craumerEufyPassword')||'';\nif($('eufyForget')) $('eufyForget').addEventListener('click',()=>{\n  localStorage.removeItem('craumerEufyEmail');\n  localStorage.removeItem('craumerEufyPassword');\n  if($('eufyEmail')) $('eufyEmail').value='';\n  if($('eufyPassword')) $('eufyPassword').value='';\n});\n"""
        t = t.replace(listener, restore + listener, 1)
    p.write_text(t)
print(f'Applied Craumer Light Control app name/login persistence; Android versionCode={version_code}')
