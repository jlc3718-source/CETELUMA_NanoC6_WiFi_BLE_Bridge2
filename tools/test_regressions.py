# v3.1.6 event fairness and bottom-menu logout
from pathlib import Path
import re

def t(p): return Path(p).read_text()
main=t('firmware/src/main.cpp'); web=t('firmware/web/index.html'); mock=t('firmware/web/v3_mockup.js'); ev=t('firmware/src/EventCatalog.cpp'); sched=t('firmware/src/Scheduler.cpp'); types=t('firmware/include/Types.h'); ble=t('firmware/src/BleController.cpp')
build=t('.github/workflows/compile-anderson-home-multi.yml'); retention=t('.github/workflows/anderson-retention.yml'); publisher=t('.github/workflows/publish-anderson-home.yml'); branch_cleanup=t('.github/scripts/anderson-branch-cleanup.sh')
assert 'Effect::Gradient' not in ev+ble+sched+types
assert 'Gradient</option>' not in web and "effect:'Gradient'" not in web
assert 'v3FxGradient' not in mock and 'data-effect="Gradient"' not in mock
assert 'ANDERSON_COLOR_PALETTE_COUNT' in main and 'server.on("/api/colors"' in main
assert '/api/events/bulk' not in main+web and 'enableMonth' not in web and 'clearMonth' not in web
assert 'eventsSchedule1Toggle' not in web and 'eventsSchedule2Toggle' not in web
assert 'eventWindowActiveOn(i,l,cfg->leadDays,cfg->trailDays)' in sched
assert 't.effect=Effect::Breath' in sched
assert 'Custom-light capacity reached (12)' in main and 'Schedule capacity reached (32)' in main
assert 'server.on("/api/events/search"' in main and 'eventRequestGeneration' in web
assert 'server.on("/api/event-color-theme"' in main and 'eventColorsOriginal' in web and 'eventColorsModern' in web
assert 'eventColorThemeGeneration' in main and 'colorGeneration' in main
assert 'saveSettings(next)' in main and 'Event override write failed' in main
assert 'if(tries>=8)' not in web and 'otaExpectedPartition' in web
assert 'PinAttemptState pinAttempts[6]' in main
assert 'store.clearWiFi()' in main and 'saveWiFi("","")' in t('firmware/src/SettingsStore.cpp')
for row in ['{"evt028",2037,2,15}','{"evt030",2037,10,11}','{"evt047",2037,11,9}','{"evt096",2037,1,27}','{"evt177",2037,10,18}','{"evt192",2037,11,7}']: assert row in ev,row
assert 'anderson-cache-cleanup.sh' not in build
assert 'anderson-cache-cleanup.sh' in retention and 'anderson-cache-cleanup.sh' in publisher
assert 'anderson-branch-cleanup.sh' in retention and 'anderson-branch-cleanup.sh' in publisher
assert "BRANCH_MAX_AGE_HOURS: '2'" in retention and "BRANCH_MAX_AGE_HOURS: '2'" in publisher
assert 'BRANCH_MAX_AGE_HOURS:-2' in branch_cleanup
assert 'verify_ota_manifest.py' in publisher and 'remote-update/pending/$VERSION.json' in publisher
assert "cp publish-input/latest.json ../anderson-ota/latest.json" in publisher
assert "git add latest.json remote-update/latest.json remote-update/pending" in publisher
assert 'setInterval(()=>qa(\'select[data-v3-effect-preview="1"]\')' not in mock
assert "const color=palette[Math.floor(now/360)%palette.length]" in mock
assert "const phase=Math.floor(now/240),on=phase%2===0,color=palette[Math.floor(phase/2)%palette.length]" in mock
assert "const active=Math.floor(now/360)%dots.length" not in mock
assert "dot.style.background='#f3fbff'" not in mock
assert 'v3HomeName">My Home' not in mock
assert "badge.style.display = 'none'" in mock and "profile.style.display = 'none'" in mock
assert 'Basic Scheme v 3.0.28' in web and 'v3.0.28 event palette' not in web
assert 'Advanced Scheme v 3.0.29' in web and 'v3.0.29 revised palette' not in web
assert 'id=\"homeSpeed\"' in mock and 'Effect Speed' in mock and "bindSpeedControl('homeSpeed')" in mock
assert "icon('logout') + '<span>Logout</span>'" in mock and 'nav.appendChild(switcher)' in mock
assert 'actions.replaceChildren(badge, profile, switcher)' not in mock and "'Logout'" in mock
assert 'Specific holiday / awareness / seasonal day' in web and 'Coverage guarantee:' in web and '<div>6. Normal preset</div>' in web
assert 'timedTierPick' in sched and 'monthlyEligiblePosition' in sched and 'MAX_ACTIVE_TIER_EVENTS=64' in sched
assert 'Holiday, awareness, and seasonal dates all share the specific-event tier.' in sched
assert 'forcedMonthlyCoverage' in sched and 'first third of the least-conflicted' in sched
assert 'if(specificCount)' in sched and 'if(holidayWindowCount)' in sched
assert 'python tools/audit_event_coverage.py --start-year 2026 --end-year 2037 --require-full' in build
version=t('FIRMWARE_VERSION.txt').strip(); assert f'ANDERSON_FIRMWARE_VERSION="{version}"' in main
remote=t('firmware/src/RemoteUpdate.cpp')
assert 'OTA_MANIFEST_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json"' in remote
assert '?cb=' in remote and 'esp_random()' in remote and 'OTA_AUTO_RETRY_BASE_MS' in remote
print('Anderson regression source checks passed')
