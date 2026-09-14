from pathlib import Path

webp=Path('firmware/web/index.html')
web=webp.read_text()
Path('FIRMWARE_VERSION.txt').write_text('3.1.21\n')
mp=Path('firmware/src/main.cpp')
main=mp.read_text()
main=main.replace('ANDERSON_FIRMWARE_VERSION="3.1.20"','ANDERSON_FIRMWARE_VERSION="3.1.21"')

anchor="bool otaAutoRebootPending=false;uint32_t otaAutoRebootAt=0;"
if anchor not in main: raise SystemExit('OTA global anchor missing')
main=main.replace(anchor,anchor+"\nstatic bool firmwareOperationBusy(){return otaExternalClaimed||otaAutoRebootPending||Update.isRunning()||remoteUpdateOperationBusy();}",1)
main=main.replace('server.on("/api/backup/restore",HTTP_POST,[]{if(!requireAdmin())return;if(!restoreSettingsBackup())',
                  'server.on("/api/backup/restore",HTTP_POST,[]{if(!requireAdmin())return;if(firmwareOperationBusy()){server.send(409,"application/json","{\\"ok\\":false,\\"error\\":\\"A firmware operation is already active\\"}");return;}if(!restoreSettingsBackup())',1)
main=main.replace('server.on("/api/palette-migration",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;',
                  'server.on("/api/palette-migration",HTTP_POST,[]{\n    if(!requireAdmin())return;if(firmwareOperationBusy()){server.send(409,"application/json","{\\"ok\\":false,\\"error\\":\\"A firmware operation is already active\\"}");return;}JsonDocument d;',1)
main=main.replace('server.on("/api/wifi",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;',
                  'server.on("/api/wifi",HTTP_POST,[]{\n    if(!requireAdmin())return;if(firmwareOperationBusy()){server.send(409,"application/json","{\\"ok\\":false,\\"error\\":\\"A firmware operation is already active\\"}");return;}JsonDocument d;',1)
old='}else if(u.status==UPLOAD_FILE_ABORTED){Update.abort();if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}otaUploadOk=false;otaUploadResponseCode=500;otaUploadError="Firmware upload aborted";}'
new='}else if(u.status==UPLOAD_FILE_ABORTED){if(otaExternalClaimed){Update.abort();remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}otaUploadOk=false;otaUploadResponseCode=500;otaUploadError="Firmware upload aborted";}'
if old not in main: raise SystemExit('upload aborted anchor missing')
main=main.replace(old,new,1)
old='if(buttonDown && millis()-buttonDown>5000){buttonDown=0;if(store.clearWiFi()){digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}}'
new='if(buttonDown && millis()-buttonDown>5000){buttonDown=0;if(!firmwareOperationBusy()&&store.clearWiFi()){digitalWrite(BLUE_LED,HIGH);delay(500);ESP.restart();}}'
if old not in main: raise SystemExit('physical reset anchor missing')
main=main.replace(old,new,1)

anchor='static uint32_t settingsBackupLastCheckMs=0;'
if anchor not in main: raise SystemExit('backup timer anchor missing')
main=main.replace(anchor,anchor+'\nstatic uint64_t settingsBackupRetryAfter=0;static uint8_t settingsBackupFailureCount=0;',1)
old='static void maybeWeeklySettingsBackup(){if(!timeValid()||Update.isRunning()||remoteUpdateOperationBusy())return;uint32_t ms=millis();if(settingsBackupLastCheckMs&&(uint32_t)(ms-settingsBackupLastCheckMs)<60000UL)return;settingsBackupLastCheckMs=ms;if(!settingsBackupMask())return;Preferences p;uint64_t lastauto=0;if(p.begin(SETTINGS_BACKUP_NS,true)){lastauto=p.getULong64("lastauto",0);p.end();}uint64_t now=(uint64_t)time(nullptr);if(!lastauto||now>=lastauto+SETTINGS_BACKUP_WEEK_SECONDS)createSettingsBackup(true);}'
new='static void maybeWeeklySettingsBackup(){if(!timeValid()||firmwareOperationBusy())return;uint32_t ms=millis();if(settingsBackupLastCheckMs&&(uint32_t)(ms-settingsBackupLastCheckMs)<60000UL)return;settingsBackupLastCheckMs=ms;if(!settingsBackupMask())return;Preferences p;uint64_t lastauto=0;if(p.begin(SETTINGS_BACKUP_NS,true)){lastauto=p.getULong64("lastauto",0);p.end();}uint64_t now=(uint64_t)time(nullptr);if(settingsBackupRetryAfter&&now<settingsBackupRetryAfter)return;if(!lastauto||now>=lastauto+SETTINGS_BACKUP_WEEK_SECONDS){if(createSettingsBackup(true)){settingsBackupFailureCount=0;settingsBackupRetryAfter=0;}else{if(settingsBackupFailureCount<6)settingsBackupFailureCount++;uint64_t delaySeconds=300ULL<<(settingsBackupFailureCount-1);if(delaySeconds>21600ULL)delaySeconds=21600ULL;settingsBackupRetryAfter=now+delaySeconds;}}}'
if old not in main: raise SystemExit('weekly backup anchor missing')
main=main.replace(old,new,1)
mp.write_text(main)

web=web.replace('3.1.20','3.1.21')
old="let savedColors=[],savedColorLabels=[],activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;"
if old not in web: raise SystemExit('saved color declaration not found')
web=web.replace(old,"let activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;",1)
anchor="const SEMANTIC_COLOR_VISUAL={"
pos=web.find(anchor)
if pos<0: raise SystemExit('semantic visual anchor missing')
web=web[:pos]+"let savedColors=[],savedColorLabels=[];\n\n"+web[pos:]

old="  const sync=()=>buttons.forEach(b=>b.classList.toggle('active',b.dataset.effect===sel.value));"
new="  const sync=()=>buttons.forEach(b=>{const active=b.dataset.effect===sel.value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false')});\n  sel._syncEffectButtons=sync;"
if old not in web: raise SystemExit('effect sync anchor missing')
web=web.replace(old,new,1)
web=web.replace("  $('effectSelect').value=effect;\n  $('homeEffect').value=effect;","  $('effectSelect').value=effect;$('effectSelect')._syncEffectButtons?.();\n  $('homeEffect').value=effect;$('homeEffect')._syncEffectButtons?.();",1)
web=web.replace("  $('effectSelect').value=effect;\n  setBuilderColors(colors,false);","  $('effectSelect').value=effect;$('effectSelect')._syncEffectButtons?.();\n  setBuilderColors(colors,false);",1)

old="document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor'),colors=box?.querySelector('.row.wraprow');if(colors)renderEventFavoriteGrid(g,c=>{if(colors.children.length>=8)return;const b=document.createElement('button');b.type='button';b.className='colorChip';setChipColor(b,c);b.onclick=()=>openRgbWheel(b);colors.appendChild(b)})})"
new="document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor');if(box&&typeof box._addEventColor==='function')renderEventFavoriteGrid(g,c=>box._addEventColor(c))})"
if old not in web: raise SystemExit('event favorite rebuild anchor missing')
web=web.replace(old,new,1)
marker="  (ev.colors||['#E08700']).forEach(addColor);"
if marker not in web: raise SystemExit('event addColor marker missing')
web=web.replace(marker,"  box._addEventColor=addColor;\n"+marker,1)

old="(Array.isArray(p.colors)?p.colors:[]).forEach(color=>{const chip=document.createElement('span');chip.className='chip';chip.style.background=displayColor(color);chips.appendChild(chip)})"
new="(Array.isArray(p.colors)?p.colors:[]).forEach(color=>{const chip=document.createElement('span');chip.className='colorNamePill';chip.style.background=semanticColorVisual(color);chip.style.color=semanticColorInk(color);chip.textContent=semanticColorName(color);chip.title=semanticColorName(color);chips.appendChild(chip)})"
if old not in web: raise SystemExit('custom light semantic anchor missing')
web=web.replace(old,new,1)
old="(x.colors||[]).forEach(c=>{const chip=document.createElement('span');chip.className='chip';chip.style.background=/^#[0-9A-F]{6}$/i.test(c)?c:'#FFFFFA';chips.appendChild(chip)})"
new="(x.colors||[]).forEach(c=>{const chip=document.createElement('span');chip.className='colorNamePill';chip.style.background=semanticColorVisual(c);chip.style.color=semanticColorInk(c);chip.textContent=semanticColorName(c);chip.title=semanticColorName(c);chips.appendChild(chip)})"
if old not in web: raise SystemExit('custom schedule semantic anchor missing')
web=web.replace(old,new,1)
web=web.replace("$('liveColorCode').textContent=semanticColorName(h);","$('liveColorCode').textContent=h;",1)
webp.write_text(web)

tp=Path('tools/test_regressions.py')
t=tp.read_text()
t=t.replace("assert \"$('liveColorCode').textContent=semanticColorName(h)\" in web\n","assert \"$('liveColorCode').textContent=h\" in web\n",1)
insert="""
assert web.index('let savedColors=[],savedColorLabels=[];') < web.index('function semanticColorName') < web.index('renderColorBuilder();')
assert 'sel._syncEffectButtons=sync' in web and "setAttribute('aria-pressed'" in web
assert "$('effectSelect')._syncEffectButtons?.()" in web and "$('homeEffect')._syncEffectButtons?.()" in web
assert 'box._addEventColor=addColor' in web and "typeof box._addEventColor==='function'" in web
assert "customLightSummary" in web and "chip.className='colorNamePill'" in web
assert 'static bool firmwareOperationBusy()' in main and 'if(otaExternalClaimed){Update.abort();remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}' in main
assert 'settingsBackupRetryAfter' in main and 'delaySeconds>21600ULL' in main
"""
marker="assert 'savedColorLabels' in web and \"p.name||NAMED_COLOR_PALETTE[i]?.name\" in web\n"
if marker not in t: raise SystemExit('regression insertion marker missing')
t=t.replace(marker,marker+insert,1)
tp.write_text(t)

Path('firmware/RELEASE_NOTES_v3.1.21.md').write_text('''# Anderson Home v3.1.21\n\n- Emergency recovery for the v3.1.20 browser runtime failure that prevented the remainder of the UI from initializing.\n- Preserves the blue interface, four visible Jump/Breath/Strobe/Solid buttons, backup tab, schedules, favorites, calibrated LED payload values, permissions, partition map, protected updates, and Android freeze.\n- Synchronizes effect-button highlighting with incoming state without sending unintended control commands.\n- Keeps event favorite-color additions removable after the RGB picker is opened.\n- Uses semantic color names on built-in and custom schedule surfaces while preserving calibrated LED payloads.\n- Preserves exact HEX/RGB tuning values in Live Color Tuning.\n- Restricts firmware abort/reboot-sensitive paths to the owning operation and adds bounded automatic-backup failure retry backoff.\n''')
print('v3.1.21 reviewed recovery patch applied')
