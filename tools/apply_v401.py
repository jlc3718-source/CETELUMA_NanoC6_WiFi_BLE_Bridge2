from pathlib import Path
import re

ROOT=Path('.')

def read(p): return (ROOT/p).read_text()
def write(p,s): (ROOT/p).write_text(s)
def repl_once(text, old, new, label):
    if text.count(old)!=1:
        raise SystemExit(f'{label}: expected exactly one match, found {text.count(old)}')
    return text.replace(old,new,1)

# Version identity: every delivered firmware gets its own monotonically increasing version.
write('FIRMWARE_VERSION.txt','4.0.1\n')
main=read('firmware/src/main.cpp')
main=re.sub(r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="4\.0\.0";',
            'static constexpr const char* ANDERSON_FIRMWARE_VERSION="4.0.1";',main,count=1)
if 'ANDERSON_FIRMWARE_VERSION="4.0.1"' not in main:
    raise SystemExit('main firmware version replacement failed')
write('firmware/src/main.cpp',main)

sdk=read('firmware/sdkconfig.defaults')
sdk=re.sub(r'CONFIG_APP_PROJECT_VER="4\.0\.0"','CONFIG_APP_PROJECT_VER="4.0.1"',sdk,count=1)
if 'CONFIG_COMPILER_OPTIMIZATION_SIZE=y' not in sdk:
    sdk += '\n# Keep all ESP-IDF components optimized for the constrained dual-OTA layout.\nCONFIG_COMPILER_OPTIMIZATION_SIZE=y\n'
write('firmware/sdkconfig.defaults',sdk)

# Native compatibility fixes: 2 ms rounded to zero RTOS ticks at 100 Hz, creating a hot loop.
# Guarantee at least one tick. Also report the real image length instead of the OTA partition size.
compat=read('firmware/src/ArduinoCompat.cpp')
compat=repl_once(compat,
    '#include "sdkconfig.h"\n',
    '#include "sdkconfig.h"\n#include "esp_flash_partitions.h"\n#include "esp_image_format.h"\n',
    'native image metadata includes')
compat=repl_once(compat,
    'void delay(uint32_t ms){if(ms==0){taskYIELD();return;}vTaskDelay(pdMS_TO_TICKS(ms));}',
    'void delay(uint32_t ms){if(ms==0){taskYIELD();return;}TickType_t ticks=pdMS_TO_TICKS(ms);if(ticks==0)ticks=1;vTaskDelay(ticks);}',
    'delay tick floor')
compat=repl_once(compat,
    'uint32_t ESPClass::getSketchSize() const{const esp_partition_t* p=esp_ota_get_running_partition();return p?(uint32_t)p->size:0;}',
    'uint32_t ESPClass::getSketchSize() const{const esp_partition_t* p=esp_ota_get_running_partition();if(!p)return 0;esp_partition_pos_t pos{};pos.offset=p->address;pos.size=p->size;esp_image_metadata_t meta{};return esp_image_get_metadata(&pos,&meta)==ESP_OK?(uint32_t)meta.image_len:0;}',
    'real app image size')
write('firmware/src/ArduinoCompat.cpp',compat)

# Move Emergency Firmware Recovery off Home. The login copy is static and works before authentication.
mock=read('firmware/web/v3_mockup.js')
start=mock.find('  function syncEmergencyFirmwareVisibility() {')
end=mock.find('  function init() {',start)
if start<0 or end<0:
    raise SystemExit('Home emergency firmware block not found')
mock=mock[:start]+mock[end:]
old_init="  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();emergencyFirmwarePanel();syncRole();syncEmergencyFirmwareVisibility();window.addEventListener('anderson-profile-selected',()=>{syncRole();syncEmergencyFirmwareVisibility();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',()=>{syncRole();syncEmergencyFirmwareVisibility();}); }"
new_init="  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',()=>{syncRole();}); }"
mock=repl_once(mock,old_init,new_init,'v3 init emergency removal')
if 'emergencyFirmwarePanel' in mock or 'Emergency Firmware Flash' in mock:
    raise SystemExit('Home emergency firmware code still present')
write('firmware/web/v3_mockup.js',mock)

web=read('firmware/web/index.html')
login_panel='''\n    <div id="loginEmergencyRecovery" class="pinPanel" style="margin-top:14px">\n      <strong>Emergency Firmware Recovery</strong>\n      <div class="sub" style="margin-top:4px">Available before login if the normal Anderson interface is damaged. Requires Jason’s four-digit PIN and writes only an APP-only BIN to the inactive OTA slot.</div>\n      <div class="label">Jason PIN</div><input id="loginRecoveryPin" class="field pinDigits" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" aria-label="Jason recovery PIN">\n      <div class="label">APP-only firmware BIN</div><input id="loginRecoveryFile" class="field" type="file" accept=".bin,application/octet-stream">\n      <button id="loginRecoveryFlash" class="btn danger" type="button" style="width:100%;margin-top:10px">Emergency Flash &amp; Reboot</button>\n      <progress id="loginRecoveryProgress" max="100" value="0" style="width:100%;height:14px;margin-top:9px"></progress>\n      <div id="loginRecoveryStatus" class="sub" style="margin-top:6px" aria-live="polite">Use only a verified Anderson Home APP-only .bin image.</div>\n    </div>\n'''
anchor='''    </form>\n  </div>\n</main>'''
web=repl_once(web,anchor,'    </form>'+login_panel+'  </div>\n</main>','login recovery panel')

recovery_script=r'''\n<script id="anderson-login-emergency-recovery">\n(function(){\n  const byId=id=>document.getElementById(id),pin=byId('loginRecoveryPin'),file=byId('loginRecoveryFile'),button=byId('loginRecoveryFlash'),progress=byId('loginRecoveryProgress'),out=byId('loginRecoveryStatus');\n  if(!pin||!file||!button)return;\n  pin.addEventListener('input',()=>pin.value=pin.value.replace(/\\D/g,'').slice(0,4));\n  button.addEventListener('click',async()=>{\n    const p=pin.value,f=file.files&&file.files[0];\n    if(!/^\\d{4}$/.test(p)){out.textContent='Enter Jason’s four-digit PIN.';return;}\n    if(!f){out.textContent='Choose an Anderson APP-only .bin file first.';return;}\n    if(!/\\.bin$/i.test(f.name)){out.textContent='Firmware file must end in .bin.';return;}\n    if(f.size<4096||f.size>=0x1E0000){out.textContent='That file does not fit the Anderson APP-only OTA slot.';return;}\n    try{const first=new Uint8Array(await f.slice(0,1).arrayBuffer());if(first.length!==1||first[0]!==0xE9){out.textContent='Invalid ESP application image: missing 0xE9 header.';return;}}catch(e){out.textContent='Could not inspect the selected firmware file.';return;}\n    if(!confirm('Emergency flash this APP-only firmware to the inactive slot and reboot?'))return;\n    button.disabled=true;progress.value=0;out.textContent='Opening emergency recovery path…';\n    const x=new XMLHttpRequest();x.open('POST','/api/update?recovery=1');x.setRequestHeader('Content-Type','application/octet-stream');x.setRequestHeader('X-Anderson-Recovery-PIN',p);x.setRequestHeader('X-Anderson-Filename',f.name);\n    x.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round(e.loaded*100/e.total);progress.value=pct;out.textContent=pct<100?`Emergency upload ${pct}%…`:'Upload complete. Validating APP image and boot slot…';}};\n    x.onload=()=>{if(x.status>=200&&x.status<300){progress.value=100;out.textContent='Firmware accepted. NanoC6 is rebooting…';setTimeout(()=>location.reload(),6500);}else{button.disabled=false;out.textContent=x.responseText||'Emergency firmware recovery failed.';}};\n    x.onerror=()=>{button.disabled=false;out.textContent='Emergency firmware upload connection failed.';};\n    x.send(f);\n  });\n})();\n</script>\n'''
web=repl_once(web,'\n<div class="wrap">',recovery_script+'\n<div class="wrap">','login recovery script')

# A successful local flash must load the new image's document, not leave stale DOM/version controls behind.
old="if(op.localUnknown&&op.targetPartition&&f.runningPartition===op.targetPartition){$('fwStatus').textContent=`Boot slot changed to ${f.runningPartition}; image identity unverified because local BIN metadata was not known.`;clearFirmwareOperation();loadFirmwareInfo();return}"
new="if(op.localUnknown&&op.targetPartition&&f.runningPartition===op.targetPartition){$('fwStatus').textContent=`Boot slot changed to ${f.runningPartition}; loading the new firmware interface…`;clearFirmwareOperation();setTimeout(()=>location.reload(),700);return}"
web=repl_once(web,old,new,'local firmware reload')
write('firmware/web/index.html',web)

# release.py bump must keep the IDF app descriptor version in lockstep too.
release=read('tools/release.py')
needle="    MAIN.write_text(source)\n    readme = ROOT / 'README.md'\n"
replacement="    MAIN.write_text(source)\n    sdkconfig = ROOT / 'firmware/sdkconfig.defaults'\n    sdk = sdkconfig.read_text()\n    sdk, count = re.subn(r'CONFIG_APP_PROJECT_VER=\"\\d+\\.\\d+\\.\\d+[a-z]?\"', f'CONFIG_APP_PROJECT_VER=\"{new}\"', sdk, count=1)\n    if count != 1:\n        raise ValueError('Expected one CONFIG_APP_PROJECT_VER marker in firmware/sdkconfig.defaults')\n    sdkconfig.write_text(sdk)\n    readme = ROOT / 'README.md'\n"
release=repl_once(release,needle,replacement,'release bump sdkconfig')
write('tools/release.py',release)

# Dynamic native migration gate: no hard-coded 4.0.0 identity.
wf=read('.github/workflows/native-idf-migration.yml')
old='''          test "$(cat FIRMWARE_VERSION.txt)" = "4.0.0"\n          grep -q 'ANDERSON_FIRMWARE_VERSION="4.0.0"' firmware/src/main.cpp\n          grep -q '^CONFIG_APP_PROJECT_VER_FROM_CONFIG=y$' firmware/sdkconfig.defaults\n          grep -q '^CONFIG_APP_PROJECT_VER="4.0.0"$' firmware/sdkconfig.defaults\n'''
new='''          VERSION="$(cat FIRMWARE_VERSION.txt)"\n          printf '%s\\n' "$VERSION" | grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+[a-z]?$'\n          grep -Fq "ANDERSON_FIRMWARE_VERSION=\\\"$VERSION\\\"" firmware/src/main.cpp\n          grep -q '^CONFIG_APP_PROJECT_VER_FROM_CONFIG=y$' firmware/sdkconfig.defaults\n          grep -Fq "CONFIG_APP_PROJECT_VER=\\\"$VERSION\\\"" firmware/sdkconfig.defaults\n'''
wf=repl_once(wf,old,new,'dynamic workflow version')
wf=wf.replace("          grep -q 'Emergency Firmware Flash' firmware/web/v3_mockup.js\n",
              "          grep -q 'id=\"loginEmergencyRecovery\"' firmware/web/index.html\n          grep -q 'X-Anderson-Recovery-PIN' firmware/web/index.html\n          ! grep -q 'Emergency Firmware Flash' firmware/web/v3_mockup.js\n          grep -q 'if(ticks==0)ticks=1' firmware/src/ArduinoCompat.cpp\n          grep -q 'esp_image_get_metadata' firmware/src/ArduinoCompat.cpp\n")
write('.github/workflows/native-idf-migration.yml',wf)

# Regression guards for the two hardware-observed monitor bugs and pre-login recovery placement.
test=read('tools/test_regressions.py')
extra='''\n# v4.0.1 hardware-observed native-IDF regressions\ncompat=t('firmware/src/ArduinoCompat.cpp')\nassert 'if(ticks==0)ticks=1' in compat\nassert 'esp_image_get_metadata' in compat and 'meta.image_len' in compat\nassert 'id="loginEmergencyRecovery"' in web and 'X-Anderson-Recovery-PIN' in web\nassert 'Emergency Firmware Flash' not in mock\nassert 'loading the new firmware interface' in web and 'setTimeout(()=>location.reload(),700)' in web\n'''
if '# v4.0.1 hardware-observed native-IDF regressions' not in test:
    test += extra
write('tools/test_regressions.py',test)

print('v4.0.1 patch applied')
