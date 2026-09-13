#!/usr/bin/env python3
from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    p.write_text(s.replace(old, new, 1))


def regex_once(path, pattern, repl, flags=0):
    p = Path(path)
    s = p.read_text()
    s2, count = re.subn(pattern, repl, s, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: pattern did not match exactly once: {pattern[:120]!r}")
    p.write_text(s2)


# Every handed-off BIN gets its own simple semantic version.
replace_once("FIRMWARE_VERSION.txt", "4.0.0\n", "4.0.1\n")
replace_once(
    "firmware/src/main.cpp",
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="4.0.0";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="4.0.1";',
)
replace_once(
    "firmware/sdkconfig.defaults",
    'CONFIG_APP_PROJECT_VER="4.0.0"',
    'CONFIG_APP_PROJECT_VER="4.0.1"',
)

# Native timing: pdMS_TO_TICKS(2) may round to zero at a 100 Hz RTOS tick.
# Any nonzero Arduino-compatible delay must sleep at least one FreeRTOS tick.
p = Path("firmware/src/ArduinoCompat.cpp")
s = p.read_text()
if '#include "esp_image_format.h"' not in s:
    s = s.replace('#include "sdkconfig.h"\n', '#include "sdkconfig.h"\n#include "esp_image_format.h"\n', 1)
old = 'void delay(uint32_t ms){if(ms==0){taskYIELD();return;}vTaskDelay(pdMS_TO_TICKS(ms));}'
new = 'void delay(uint32_t ms){if(ms==0){taskYIELD();return;}TickType_t ticks=pdMS_TO_TICKS(ms);if(ticks==0)ticks=1;vTaskDelay(ticks);}'
if s.count(old) != 1:
    raise SystemExit("ArduinoCompat.cpp: expected old delay shim once")
s = s.replace(old, new, 1)

# Native image size: the old shim returned OTA partition capacity, falsely showing 100% full.
old = 'uint32_t ESPClass::getSketchSize() const{const esp_partition_t* p=esp_ota_get_running_partition();return p?(uint32_t)p->size:0;}'
new = 'uint32_t ESPClass::getSketchSize() const{const esp_partition_t* p=esp_ota_get_running_partition();if(!p)return 0;esp_partition_pos_t pos{};pos.offset=p->address;pos.size=p->size;esp_image_metadata_t metadata{};return esp_image_get_metadata(&pos,&metadata)==ESP_OK?(uint32_t)metadata.image_len:0;}'
if s.count(old) != 1:
    raise SystemExit("ArduinoCompat.cpp: expected old getSketchSize shim once")
s = s.replace(old, new, 1)
p.write_text(s)

# Optimize ESP-IDF components too, not only project source. Trim nonessential logging strings.
p = Path("firmware/sdkconfig.defaults")
s = p.read_text().rstrip() + "\n"
size_cfg = """
# Native v4 size policy: optimize ESP-IDF components for flash footprint too.
CONFIG_COMPILER_OPTIMIZATION_SIZE=y
# CONFIG_COMPILER_OPTIMIZATION_DEFAULT is not set
CONFIG_LOG_DEFAULT_LEVEL_WARN=y
CONFIG_LOG_DEFAULT_LEVEL=2
CONFIG_LOG_MAXIMUM_LEVEL_WARN=y
CONFIG_LOG_MAXIMUM_LEVEL=2
# CONFIG_LOG_COLORS is not set
"""
if "CONFIG_COMPILER_OPTIMIZATION_SIZE=y" not in s:
    s += size_cfg
p.write_text(s)

# Remove the authenticated-Home emergency panel. Recovery belongs before login.
p = Path("firmware/web/v3_mockup.js")
s = p.read_text()
start = s.find("  function syncEmergencyFirmwareVisibility() {")
end = s.find("  function init() {", start)
if start < 0 or end < 0:
    raise SystemExit("v3_mockup.js: Home emergency recovery block not found")
s = s[:start] + s[end:]
old_init = "  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();emergencyFirmwarePanel();syncRole();syncEmergencyFirmwareVisibility();window.addEventListener('anderson-profile-selected',()=>{syncRole();syncEmergencyFirmwareVisibility();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',()=>{syncRole();syncEmergencyFirmwareVisibility();}); }"
new_init = "  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }"
if s.count(old_init) != 1:
    raise SystemExit("v3_mockup.js: init block not found")
s = s.replace(old_init, new_init, 1)
p.write_text(s)

# Put emergency firmware recovery directly in the static login/profile gate.
p = Path("firmware/web/index.html")
s = p.read_text()
anchor = '    <div id="profileGateStatus" class="profileGateStatus" aria-live="polite">Checking PIN protection…</div>'
recovery_html = '''    <button id="openLoginRecovery" class="btn" type="button" style="width:100%;margin-top:12px">Emergency Firmware Recovery</button>
    <div id="loginRecoveryPanel" class="pinPanel" hidden>
      <div class="row between"><div><strong>Emergency Firmware Recovery</strong><div class="sub" style="margin-top:4px">Available before login. Writes an APP-only firmware image to the inactive OTA slot.</div></div><button id="closeLoginRecovery" class="btn" type="button">Close</button></div>
      <div class="label">Anderson APP-only BIN</div><input id="loginRecoveryFile" class="field" type="file" accept=".bin,application/octet-stream">
      <div class="label">Jason PIN</div><input id="loginRecoveryPin" class="field pinDigits" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" placeholder="4 digits">
      <button id="loginRecoveryFlash" class="btn danger" type="button" style="width:100%;margin-top:10px">Flash Emergency Firmware</button>
      <progress id="loginRecoveryProgress" max="100" value="0" style="width:100%;height:14px;margin-top:10px"></progress>
      <div id="loginRecoveryStatus" class="sub" style="margin-top:7px" aria-live="polite">Use a verified Anderson Home APP-only .bin. Wi-Fi, PINs, schedules, customized settings, NVS, SPIFFS, and the partition table are not erased.</div>
    </div>
'''
if anchor not in s:
    raise SystemExit("index.html: profile gate recovery insertion anchor missing")
s = s.replace(anchor, recovery_html + anchor, 1)

# Bind recovery independently of authenticated profile selection.
marker = "  document.addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('[data-profile]').forEach(button=>button.addEventListener('click',()=>requestProfile(button.dataset.profile)));"
if marker not in s:
    raise SystemExit("index.html: profile DOMContentLoaded marker missing")
recovery_js = r'''  function bindLoginRecovery(){
    const open=byId('openLoginRecovery'),panel=byId('loginRecoveryPanel'),close=byId('closeLoginRecovery'),file=byId('loginRecoveryFile'),pin=byId('loginRecoveryPin'),flash=byId('loginRecoveryFlash'),progress=byId('loginRecoveryProgress'),out=byId('loginRecoveryStatus');
    if(!open||!panel||!flash)return;
    open.addEventListener('click',()=>{panel.hidden=false;byId('profilePinForm').hidden=true;setTimeout(()=>file.focus(),0)});
    close.addEventListener('click',()=>{panel.hidden=true;progress.value=0});
    pin.addEventListener('input',event=>event.target.value=event.target.value.replace(/\D/g,'').slice(0,4));
    flash.addEventListener('click',()=>{
      const f=file.files&&file.files[0],p=pin.value;
      if(!f){out.textContent='Choose an Anderson APP-only .bin first.';return}
      if(!/\.bin$/i.test(f.name)){out.textContent='Firmware file must end in .bin.';return}
      if(f.size<4096||f.size>=0x1E0000){out.textContent='Firmware size is not valid for the APP-only OTA slot.';return}
      if(!/^\d{4}$/.test(p)){out.textContent='Enter Jason’s four-digit PIN.';pin.focus();return}
      if(!confirm('Emergency flash this APP-only firmware to the inactive OTA slot? Saved settings are preserved.'))return;
      flash.disabled=true;progress.value=0;out.textContent='Starting emergency recovery…';
      const x=new XMLHttpRequest();x.open('POST','/api/update?recovery=1');x.setRequestHeader('Content-Type','application/octet-stream');x.setRequestHeader('X-Anderson-Recovery-PIN',p);x.setRequestHeader('X-Anderson-Filename',f.name);
      x.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round(e.loaded*100/e.total);progress.value=pct;out.textContent=pct<100?`Emergency upload ${pct}%…`:'Upload complete. Validating APP image and OTA slot…'}};
      x.onload=()=>{if(x.status>=200&&x.status<300){progress.value=100;out.textContent='Firmware verified. NanoC6 is rebooting. Reloading automatically…';setTimeout(()=>location.reload(),7000)}else{flash.disabled=false;out.textContent=x.responseText||'Emergency firmware recovery failed.'}};
      x.onerror=()=>{flash.disabled=false;out.textContent='Emergency upload connection failed. The previous firmware slot remains available.'};
      x.send(f);
    });
  }
'''
s = s.replace(marker, recovery_js + marker, 1)
needle = ";loadPinStatus()});"
if needle not in s:
    raise SystemExit("index.html: loadPinStatus DOM ready tail missing")
s = s.replace(needle, ";bindLoginRecovery();loadPinStatus()});", 1)

# Local BIN flashing must reload the new firmware's document, not keep stale DOM/version text.
old = "if(op.localUnknown&&op.targetPartition&&f.runningPartition===op.targetPartition){$('fwStatus').textContent=`Boot slot changed to ${f.runningPartition}; image identity unverified because local BIN metadata was not known.`;clearFirmwareOperation();loadFirmwareInfo();return}"
new = "if(op.localUnknown&&op.targetPartition&&f.runningPartition===op.targetPartition){$('fwStatus').textContent=`Boot slot changed to ${f.runningPartition}. Reloading the new firmware UI…`;clearFirmwareOperation();setTimeout(()=>location.reload(),700);return}"
if s.count(old) != 1:
    raise SystemExit("index.html: local OTA stale-page branch missing")
s = s.replace(old, new, 1)

# This gauge measures Anderson main-loop occupancy, not total ESP32 CPU utilization.
s = s.replace('<span class="sysLabel">CPU</span>', '<span class="sysLabel">App Loop</span>', 1)
s = s.replace("$('sysCpuSub').textContent=(d.cpuMhz||0)+' MHz • app loop';", "$('sysCpuSub').textContent=(d.cpuMhz||0)+' MHz • loop occupancy';", 1)
p.write_text(s)

# Regression guards for the hardware failures found during v4.0.0 testing.
p = Path("tools/test_regressions.py")
s = p.read_text().rstrip() + "\n"
append = r'''
# v4 native-IDF hardware regression guards.
compat=t('firmware/src/ArduinoCompat.cpp')
assert 'if(ticks==0)ticks=1' in compat
assert 'esp_image_get_metadata(&pos,&metadata)' in compat
assert 'id="openLoginRecovery"' in web and 'id="loginRecoveryFile"' in web and 'id="loginRecoveryPin"' in web
assert "'/api/update?recovery=1'" in web and 'X-Anderson-Recovery-PIN' in web
assert 'emergencyFirmwarePanel' not in mock
assert 'Reloading the new firmware UI' in web and 'setTimeout(()=>location.reload(),700)' in web
assert '<span class="sysLabel">App Loop</span>' in web
'''
if "# v4 native-IDF hardware regression guards." not in s:
    s += "\n" + append
p.write_text(s)

print("v4.0.1 patch complete")
