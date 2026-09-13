from pathlib import Path

OLD = "4.0.4"
NEW = "4.0.5"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


ver = Path("FIRMWARE_VERSION.txt")
if ver.read_text().strip() != OLD:
    raise SystemExit(f"expected {OLD} in FIRMWARE_VERSION.txt")
ver.write_text(NEW + "\n")

main_path = Path("firmware/src/main.cpp")
main = main_path.read_text()
main = replace_once(
    main,
    f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{OLD}";',
    f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{NEW}";',
    "main runtime version",
)
main_path.write_text(main)

sdk_path = Path("firmware/sdkconfig.defaults")
sdk = sdk_path.read_text()
sdk = replace_once(
    sdk,
    f'CONFIG_APP_PROJECT_VER="{OLD}"',
    f'CONFIG_APP_PROJECT_VER="{NEW}"',
    "sdk app version",
)
sdk_path.write_text(sdk)

ui_path = Path("firmware/web/index.html")
ui = ui_path.read_text()
if 'id="loginEmergencyRecovery"' in ui:
    raise SystemExit("login emergency recovery already exists unexpectedly")

panel = '''
    <div id="loginEmergencyRecovery" class="pinPanel" style="margin-top:14px">
      <strong>Emergency Firmware Recovery</strong>
      <div class="sub" style="margin-top:4px">Available before login if the normal Anderson interface is damaged. Requires Jason’s four-digit PIN and writes only an APP-only BIN to the inactive OTA slot.</div>
      <div class="label">Jason PIN</div><input id="loginRecoveryPin" class="field pinDigits" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" aria-label="Jason recovery PIN">
      <div class="label">APP-only firmware BIN</div><input id="loginRecoveryFile" class="field" type="file" accept=".bin,application/octet-stream">
      <button id="loginRecoveryFlash" class="btn danger" type="button" style="width:100%;margin-top:10px">Emergency Flash &amp; Reboot</button>
      <progress id="loginRecoveryProgress" max="100" value="0" style="width:100%;height:14px;margin-top:9px"></progress>
      <div id="loginRecoveryStatus" class="sub" style="margin-top:6px" aria-live="polite">Use only a verified Anderson Home APP-only .bin image.</div>
    </div>'''

needle = '''    </form>
  </div>
</main>'''
if needle not in ui:
    raise SystemExit("profile gate insertion point not found")
ui = ui.replace(needle, '    </form>\n' + panel + '\n  </div>\n</main>', 1)

recovery_script = '''
<script id="anderson-login-emergency-recovery">
(function(){
  const byId=id=>document.getElementById(id),pin=byId('loginRecoveryPin'),file=byId('loginRecoveryFile'),button=byId('loginRecoveryFlash'),progress=byId('loginRecoveryProgress'),out=byId('loginRecoveryStatus');
  if(!pin||!file||!button)return;
  pin.addEventListener('input',()=>pin.value=pin.value.replace(/\\D/g,'').slice(0,4));

  async function firmwareSnapshot(timeoutMs=5000){
    try{
      const {response,text}=await controllerRequest('/api/firmware?recoveryProbe='+Date.now(),{cache:'no-store'},timeoutMs);
      if(!response.ok)return null;
      return JSON.parse(text);
    }catch(e){return null}
  }

  async function verifyBootAfterDisconnect(targetPartition,previousVersion){
    const deadline=Date.now()+30000;
    out.textContent='Upload connection closed. Checking whether the NanoC6 accepted the firmware and rebooted…';
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const f=await firmwareSnapshot(4000);
      if(!f)continue;
      const changedSlot=targetPartition&&f.runningPartition===targetPartition;
      const changedVersion=previousVersion&&f.version&&f.version!==previousVersion;
      if(changedSlot||changedVersion){
        progress.value=100;
        out.textContent=`Recovery succeeded. Anderson Home ${f.version||''} is running on ${f.runningPartition||'the new OTA slot'}. Reloading…`;
        setTimeout(()=>location.reload(),900);
        return true;
      }
    }
    return false;
  }

  button.addEventListener('click',async()=>{
    const p=pin.value,f=file.files&&file.files[0];
    if(!/^\\d{4}$/.test(p)){out.textContent='Enter Jason’s four-digit PIN.';return;}
    if(!f){out.textContent='Choose an Anderson APP-only .bin file first.';return;}
    if(!/\\.bin$/i.test(f.name)){out.textContent='Firmware file must end in .bin.';return;}
    if(f.size<4096||f.size>=0x1E0000){out.textContent='That file does not fit the Anderson APP-only OTA slot.';return;}
    try{const first=new Uint8Array(await f.slice(0,1).arrayBuffer());if(first.length!==1||first[0]!==0xE9){out.textContent='Invalid ESP application image: missing 0xE9 header.';return;}}catch(e){out.textContent='Could not inspect the selected firmware file.';return;}
    if(!confirm('Emergency flash this APP-only firmware to the inactive slot and reboot?'))return;

    button.disabled=true;progress.value=0;
    const before=await firmwareSnapshot();
    const targetPartition=before?.nextPartition||'';
    const previousVersion=before?.version||before?.appVersion||'';
    out.textContent='Opening emergency recovery path…';

    const x=new XMLHttpRequest();
    x.open('POST','/api/update?recovery=1');
    x.setRequestHeader('Content-Type','application/octet-stream');
    x.setRequestHeader('X-Anderson-Recovery-PIN',p);
    x.setRequestHeader('X-Anderson-Filename',f.name);
    x.upload.onprogress=e=>{
      if(e.lengthComputable){
        const pct=Math.round(e.loaded*100/e.total);
        progress.value=pct;
        out.textContent=pct<100?`Emergency upload ${pct}%…`:'Upload complete. Validating APP image and boot slot…';
      }
    };
    x.onload=()=>{
      if(x.status>=200&&x.status<300){
        progress.value=100;
        out.textContent='Firmware accepted. NanoC6 is rebooting…';
        setTimeout(()=>location.reload(),6500);
      }else{
        button.disabled=false;
        out.textContent=x.responseText||'Emergency firmware recovery failed.';
      }
    };
    x.onerror=async()=>{
      const booted=await verifyBootAfterDisconnect(targetPartition,previousVersion);
      if(!booted){
        button.disabled=false;
        out.textContent='Emergency upload connection failed before the NanoC6 could be verified. For recovery over a remote/cellular link, retry on local Wi-Fi/LAN if possible.';
      }
    };
    x.send(f);
  });
})();
</script>'''

script_needle = '''})();
</script>

<div class="wrap">'''
if script_needle not in ui:
    raise SystemExit("profile gate script insertion point not found")
ui = ui.replace(script_needle, '})();\n</script>\n' + recovery_script + '\n\n<div class="wrap">', 1)
ui_path.write_text(ui)

ws_path = Path("firmware/src/WebServer.cpp")
ws = ws_path.read_text()
if "kUploadMaxConsecutiveReceiveTimeouts" in ws:
    raise SystemExit("upload timeout hardening already present unexpectedly")
const_needle = "constexpr uint8_t kMaxConsecutiveReceiveTimeouts = 3;"
if const_needle not in ws:
    raise SystemExit("receive timeout constant not found")
ws = ws.replace(
    const_needle,
    const_needle + "\nconstexpr uint8_t kUploadMaxConsecutiveReceiveTimeouts = 9;",
    1,
)
timeout_needle = "if(++consecutiveTimeouts>=kMaxConsecutiveReceiveTimeouts){aborted=true;timedOut=true;break;}"
if timeout_needle not in ws:
    raise SystemExit("upload receive timeout guard not found")
ws = ws.replace(
    timeout_needle,
    "if(++consecutiveTimeouts>=kUploadMaxConsecutiveReceiveTimeouts){aborted=true;timedOut=true;break;}",
    1,
)
ws_path.write_text(ws)

test_path = Path("tools/test_regressions.py")
test = test_path.read_text()
old_block = '''# Native-IDF v4 hardware regressions; v4.0.3 keeps emergency flashing off the front login screen.
compat=t('firmware/src/ArduinoCompat.cpp')
assert 'if(ticks==0)ticks=1' in compat
assert 'esp_image_verify' in compat and 'meta.image_len' in compat
assert 'id="loginEmergencyRecovery"' not in web
assert 'loginRecoveryFile' not in web and 'loginRecoveryFlash' not in web
assert 'anderson-login-emergency-recovery' not in web
assert 'X-Anderson-Recovery-PIN' not in web and '/api/update?recovery=1' not in web
assert 'Emergency Firmware Recovery' not in web and 'Emergency Flash &amp; Reboot' not in web
assert 'X-Anderson-Recovery-PIN' in main and 'otaRecoveryRequest' in main
assert '/api/update' in t('firmware/web/recovery.html')
assert 'Emergency Firmware Flash' not in mock
assert not Path('firmware/web/v4_home_recovery.js').exists()
assert 'V4_HOME_JS' not in release
assert 'loading the new firmware interface' in web and 'setTimeout(()=>location.reload(),700)' in web
'''
new_block = '''# Native-IDF v4 hardware regressions: emergency APP-only flashing must remain
# available before login, survive a dropped HTTP response, and tolerate long stalls.
compat=t('firmware/src/ArduinoCompat.cpp')
webserver=t('firmware/src/WebServer.cpp')
assert 'if(ticks==0)ticks=1' in compat
assert 'esp_image_verify' in compat and 'meta.image_len' in compat
assert 'id="loginEmergencyRecovery"' in web
assert 'loginRecoveryFile' in web and 'loginRecoveryFlash' in web
assert 'anderson-login-emergency-recovery' in web
assert 'X-Anderson-Recovery-PIN' in web and '/api/update?recovery=1' in web
assert 'Emergency Firmware Recovery' in web and 'Emergency Flash &amp; Reboot' in web
assert 'verifyBootAfterDisconnect' in web and 'recoveryProbe=' in web
assert 'X-Anderson-Recovery-PIN' in main and 'otaRecoveryRequest' in main
assert '/api/update' in t('firmware/web/recovery.html')
assert 'kUploadMaxConsecutiveReceiveTimeouts = 9' in webserver
assert '>=kUploadMaxConsecutiveReceiveTimeouts' in webserver
assert 'Emergency Firmware Flash' not in mock
assert not Path('firmware/web/v4_home_recovery.js').exists()
assert 'V4_HOME_JS' not in release
assert 'loading the new firmware interface' in web and 'setTimeout(()=>location.reload(),700)' in web
'''
if old_block not in test:
    raise SystemExit("expected v4 emergency recovery regression block not found")
test = test.replace(old_block, new_block, 1)
test_path.write_text(test)

readme = Path("README.md")
if readme.exists():
    text = readme.read_text()
    text = text.replace(f"**v{OLD}**", f"**v{NEW}**")
    readme.write_text(text)

print("Prepared Anderson Home", NEW)
