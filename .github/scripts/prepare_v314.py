from pathlib import Path
import re

root = Path('.')

def read(path):
    return (root / path).read_text()

def write(path, text):
    (root / path).write_text(text)

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)

# Committed version metadata must exactly match the runtime source.
write('FIRMWARE_VERSION.txt', '3.1.4\n')
main = read('firmware/src/main.cpp')
main, count = re.subn(
    r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="\d+\.\d+\.\d+[a-z]?";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.4";',
    main,
    count=1,
)
if count != 1:
    raise SystemExit('main.cpp firmware version marker not found exactly once')
write('firmware/src/main.cpp', main)
write('README.md', read('README.md').replace('**v3.1.3**', '**v3.1.4**'))

# OTA: bypass raw.githubusercontent.com mutable-file caching and retry transient
# failures quickly with bounded backoff rather than waiting the normal interval.
p = Path('firmware/src/RemoteUpdate.cpp')
r = p.read_text()
r = replace_once(
    r,
    '#include <mbedtls/sha256.h>\n#include "LoopWatchdog.h"',
    '#include <mbedtls/sha256.h>\n#include <esp_system.h>\n#include "LoopWatchdog.h"',
    'esp_random include',
)
r = replace_once(
    r,
    'static constexpr uint32_t OTA_AUTO_FIRST_CHECK_MS=60UL*1000UL;\nstatic constexpr uint32_t OTA_AUTO_INTERVAL_MS=60UL*60UL*1000UL;',
    'static constexpr uint32_t OTA_AUTO_FIRST_CHECK_MS=20UL*1000UL;\n'
    'static constexpr uint32_t OTA_AUTO_INTERVAL_MS=5UL*60UL*1000UL;\n'
    'static constexpr uint32_t OTA_AUTO_RETRY_BASE_MS=30UL*1000UL;\n'
    'static constexpr uint32_t OTA_AUTO_RETRY_MAX_MS=5UL*60UL*1000UL;',
    'OTA timing constants',
)
r = replace_once(
    r,
    'static uint32_t autoNextCheckAt=0;',
    'static uint32_t autoNextCheckAt=0;\nstatic uint8_t autoFailureCount=0;',
    'OTA failure counter',
)
old_countdown = '''static uint32_t autoCheckSecondsRemaining(){
  if(!autoTimerStarted)return (OTA_AUTO_FIRST_CHECK_MS+999UL)/1000UL;
  int32_t remaining=(int32_t)(autoNextCheckAt-millis());
  return remaining>0?(uint32_t)(remaining+999)/1000UL:0UL;
}

'''
new_countdown = '''static uint32_t autoCheckSecondsRemaining(){
  if(!autoTimerStarted)return (OTA_AUTO_FIRST_CHECK_MS+999UL)/1000UL;
  int32_t remaining=(int32_t)(autoNextCheckAt-millis());
  return remaining>0?(uint32_t)(remaining+999)/1000UL:0UL;
}
static void scheduleAutoRetry(uint32_t now){
  uint8_t shift=autoFailureCount<4?autoFailureCount:4;
  uint32_t retry=OTA_AUTO_RETRY_BASE_MS<<shift;
  if(retry>OTA_AUTO_RETRY_MAX_MS)retry=OTA_AUTO_RETRY_MAX_MS;
  if(autoFailureCount<255)autoFailureCount++;
  autoNextCheckAt=now+retry;
}

'''
r = replace_once(r, old_countdown, new_countdown, 'OTA retry helper')
old_begin = 'HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(8000);if(!http.begin(client,OTA_MANIFEST_URL)){last.message="Could not open the remote manifest URL";return false;}last.httpStatus=http.GET();'
new_begin = 'HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(8000);String requestUrl=String(OTA_MANIFEST_URL)+"?cb="+String((uint32_t)esp_random(),HEX)+"-"+String((uint32_t)millis(),HEX);if(!http.begin(client,requestUrl)){last.message="Could not open the remote manifest URL";return false;}http.addHeader("Cache-Control","no-cache, no-store, max-age=0");http.addHeader("Pragma","no-cache");last.httpStatus=http.GET();'
r = replace_once(r, old_begin, new_begin, 'cache-busted manifest request')
old_loop = '''void remoteUpdateAutoLoop(const char*current){
  if(rebootRequested||last.installing)return;
  uint32_t now=millis();
  if(!autoTimerStarted){autoTimerStarted=true;autoNextCheckAt=now+OTA_AUTO_FIRST_CHECK_MS;return;}
  if((int32_t)(now-autoNextCheckAt)<0)return;
  autoNextCheckAt=now+OTA_AUTO_INTERVAL_MS;
  if(WiFi.status()!=WL_CONNECTED){autoNextCheckAt=now+60000UL;return;}
  if(!fetchVerifiedManifest(current))return;
  if(last.updateAvailable)downloadAndStage();
}
'''
new_loop = '''void remoteUpdateAutoLoop(const char*current){
  if(rebootRequested||last.installing)return;
  uint32_t now=millis();
  if(!autoTimerStarted){autoTimerStarted=true;autoNextCheckAt=now+OTA_AUTO_FIRST_CHECK_MS;return;}
  if((int32_t)(now-autoNextCheckAt)<0)return;
  if(WiFi.status()!=WL_CONNECTED){scheduleAutoRetry(now);return;}
  if(!fetchVerifiedManifest(current)){scheduleAutoRetry(now);return;}
  autoFailureCount=0;
  if(last.updateAvailable){if(!downloadAndStage())scheduleAutoRetry(now);else autoNextCheckAt=now+OTA_AUTO_INTERVAL_MS;return;}
  autoNextCheckAt=now+OTA_AUTO_INTERVAL_MS;
}
'''
r = replace_once(r, old_loop, new_loop, 'OTA automatic loop')
p.write_text(r)

# Release tooling: stop changing source during CI and reduce extreme Zopfli work.
p = Path('tools/release.py')
s = p.read_text()
s = replace_once(s, 'SLOT = 0x1E0000\n', 'SLOT = 0x1E0000\nZOPFLI_ITERATIONS = 50\n', 'compression constant')
old_sync = s[s.index('def sync_runtime_version():'):s.index('def render_ui():')]
new_sync = '''def validate_runtime_version():
    """Require committed source and FIRMWARE_VERSION.txt to describe the same image."""
    ver = version()
    source = MAIN.read_text()
    match = re.search(r'static constexpr const char\\* ANDERSON_FIRMWARE_VERSION="(\\d+\\.\\d+\\.\\d+[a-z]?)";', source)
    if not match:
        raise ValueError('Expected one ANDERSON_FIRMWARE_VERSION marker in firmware/src/main.cpp')
    if match.group(1) != ver:
        raise ValueError(f'Committed runtime version {match.group(1)} does not match FIRMWARE_VERSION.txt {ver}')


'''
s = s.replace(old_sync, new_sync)
old_bump = "    (ROOT / 'FIRMWARE_VERSION.txt').write_text(new + '\\n')\n    readme = ROOT / 'README.md'\n"
new_bump = "    (ROOT / 'FIRMWARE_VERSION.txt').write_text(new + '\\n')\n    source = MAIN.read_text()\n    source, count = re.subn(r'static constexpr const char\\* ANDERSON_FIRMWARE_VERSION=\"\\d+\\.\\d+\\.\\d+[a-z]?\";', f'static constexpr const char* ANDERSON_FIRMWARE_VERSION=\"{new}\";', source, count=1)\n    if count != 1:\n        raise ValueError('Expected one ANDERSON_FIRMWARE_VERSION marker in firmware/src/main.cpp')\n    MAIN.write_text(source)\n    readme = ROOT / 'README.md'\n"
s = replace_once(s, old_bump, new_bump, 'release bump alignment')
s = s.replace(
    'packed = zopfli.gzip.compress(rendered, numiterations=500, blocksplittingmax=0)',
    'packed = zopfli.gzip.compress(rendered, numiterations=ZOPFLI_ITERATIONS, blocksplittingmax=0)',
)
s = s.replace(
    "print(f'{name}: {len(rendered)} bytes -> {len(packed)} bytes (Zopfli gzip, 500 iterations)')",
    "print(f'{name}: {len(rendered)} bytes -> {len(packed)} bytes (Zopfli gzip, {ZOPFLI_ITERATIONS} iterations)')",
)
s = s.replace(
    "manifest['web_compression'] = 'zopfli-0.2.3.post1-gzip-500-unlimited-blocks'",
    "manifest['web_compression'] = f'zopfli-0.2.3.post1-gzip-{ZOPFLI_ITERATIONS}-unlimited-blocks'",
)
s = replace_once(s, '    sync_runtime_version()\n    check()', '    validate_runtime_version()\n    check()', 'prepare runtime validation')
old_check = "    if not re.search(r'ANDERSON_FIRMWARE_VERSION=\"\\d+\\.\\d+\\.\\d+[a-z]?\"', source):\n        raise ValueError('Firmware version marker missing from main.cpp')\n"
new_check = "    runtime = re.search(r'ANDERSON_FIRMWARE_VERSION=\"(\\d+\\.\\d+\\.\\d+[a-z]?)\"', source)\n    if not runtime:\n        raise ValueError('Firmware version marker missing from main.cpp')\n    if runtime.group(1) != ver:\n        raise ValueError(f'Firmware source version {runtime.group(1)} does not match {ver}')\n"
s = replace_once(s, old_check, new_check, 'release version validation')
p.write_text(s)

# Replace stale OTA timing harness with the new timing/backoff semantics.
p = Path('tools/test_maintenance.py')
t = p.read_text()
start = t.index('# Test the actual automatic-update loop')
end = t.index('# Focused failure regressions')
replacement = r'''# Test the actual automatic-update loop and monitor countdown with simulated time.
remote=(Path(__file__).resolve().parents[1]/'firmware/src/RemoteUpdate.cpp').read_text()
constants='\n'.join(re.findall(r'static constexpr uint32_t OTA_AUTO_\w+=.*?;',remote))
countdown=remote[remote.index('static uint32_t autoCheckSecondsRemaining(){'):remote.index('static bool allHex')]
auto_loop=remote[remote.index('void remoteUpdateAutoLoop('):remote.index('bool remoteUpdateConsumeRebootRequest()')]
remote_stubs=r'''
#include <cstdint>
#include <cassert>
#include <iostream>
uint32_t tick=0;uint32_t millis(){return tick;}
constexpr int WL_CONNECTED=3;
struct {int state=WL_CONNECTED;int status(){return state;}} WiFi;
bool rebootRequested=false,autoTimerStarted=false,manifestValid=true,stageOk=true;
uint32_t autoNextCheckAt=0;uint8_t autoFailureCount=0;
struct {bool installing=false,updateAvailable=false;} last;
int checks=0,installs=0;
bool fetchVerifiedManifest(const char*){++checks;return manifestValid;}
bool downloadAndStage(){++installs;return stageOk;}
'''
remote_tests=r'''
int main(){
 tick=0;assert(autoCheckSecondsRemaining()==20);remoteUpdateAutoLoop("test");
 tick=19999;remoteUpdateAutoLoop("test");assert(checks==0&&autoCheckSecondsRemaining()==1);
 tick=20000;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==300&&autoFailureCount==0);
 manifestValid=false;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==2&&autoCheckSecondsRemaining()==30&&autoFailureCount==1);
 tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==3&&autoCheckSecondsRemaining()==60&&autoFailureCount==2);
 manifestValid=true;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==4&&autoCheckSecondsRemaining()==300&&autoFailureCount==0);
 last.updateAvailable=true;stageOk=false;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==5&&installs==1&&autoCheckSecondsRemaining()==30&&autoFailureCount==1);
 stageOk=true;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==6&&installs==2&&autoFailureCount==0);
 last.updateAvailable=false;
 WiFi.state=0;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==6&&autoCheckSecondsRemaining()==30&&autoFailureCount==1);
 WiFi.state=WL_CONNECTED;tick=autoNextCheckAt;remoteUpdateAutoLoop("test");assert(checks==7&&autoCheckSecondsRemaining()==300&&autoFailureCount==0);
 autoTimerStarted=false;checks=0;tick=UINT32_MAX-1000;remoteUpdateAutoLoop("test");
 tick=18998;remoteUpdateAutoLoop("test");assert(checks==0&&autoCheckSecondsRemaining()==1);
 tick=18999;remoteUpdateAutoLoop("test");assert(checks==1&&autoCheckSecondsRemaining()==300);
 std::cout<<"PASS: 20-second first OTA check, five-minute normal cadence, bounded failure retry, stage retry, offline retry, and timer rollover\n";
}
'''
with tempfile.TemporaryDirectory() as directory:
    p=Path(directory)/'remote_timing.cpp'
    p.write_text(remote_stubs+constants+countdown+auto_loop+remote_tests)
    subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror',str(p),'-o',str(p.with_suffix(''))],check=True)
    subprocess.run([str(p.with_suffix(''))],check=True)

'''
p.write_text(t[:start] + replacement + t[end:])

# Rename and activate the useful source regressions instead of leaving a stale v3.1.0 test.
old = Path('tools/test_v310_regressions.py')
reg = old.read_text()
reg = reg.replace(
    "assert t('FIRMWARE_VERSION.txt').strip()=='3.1.0'",
    "version=t('FIRMWARE_VERSION.txt').strip(); assert f'ANDERSON_FIRMWARE_VERSION=\"{version}\"' in main",
)
reg = reg.replace(
    "print('v3.1.0 regression source checks passed')",
    "remote=t('firmware/src/RemoteUpdate.cpp'); assert '?cb=' in remote and 'esp_random()' in remote and 'OTA_AUTO_RETRY_BASE_MS' in remote; print('Anderson regression source checks passed')",
)
Path('tools/test_regressions.py').write_text(reg)
old.unlink()
wf = Path('.github/workflows/compile-anderson-home-multi.yml')
w = wf.read_text()
marker = "      - name: Check maintenance, Wi-Fi recovery, and update timing\n        run: python tools/test_maintenance.py\n"
insert = marker + "      - name: Check Anderson source regressions\n        run: python tools/test_regressions.py\n"
w = replace_once(w, marker, insert, 'CI regression step')
wf.write_text(w)

# Proven-unused historical prose/version markers: release tags and git history retain them.
obsolete = [
    'docs/ANDERSON_SIX_COLOR_BASELINE.md',
    'firmware/MASTER_CALENDAR_VERSION.txt',
    'firmware/web/THEME_VERSION.txt',
    'firmware/RELEASE_NOTES_v3.0.21.md',
    'firmware/RELEASE_NOTES_v3.0.22.md',
    'firmware/RELEASE_NOTES_v3.0.23.md',
    'firmware/RELEASE_NOTES_v3.0.24.md',
    'firmware/RELEASE_NOTES_v3.0.25.md',
    'firmware/RELEASE_NOTES_v3.0.26.md',
    'firmware/RELEASE_NOTES_v3.0.27.md',
    'firmware/RELEASE_NOTES_v3.0.28.md',
    'firmware/RELEASE_NOTES_v3.0.29.md',
    'firmware/RELEASE_NOTES_v3.1.0.md',
    'firmware/RELEASE_NOTES_v3.1.1.md',
]
for name in obsolete:
    q = Path(name)
    if q.exists():
        q.unlink()

# Last temporary migration helper: future work uses permanent pipeline.
Path('.github/scripts/prepare_v314.py').unlink()
Path('.github/workflows/prepare-v3.1.4-audit.yml').unlink()
