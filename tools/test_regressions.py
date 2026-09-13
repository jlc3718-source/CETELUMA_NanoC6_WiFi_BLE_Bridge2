# Anderson Home regression contract: legacy behavior plus native ESP-IDF v4 safeguards
from pathlib import Path
import re

def t(p): return Path(p).read_text()
main=t('firmware/src/main.cpp'); web=t('firmware/web/index.html'); backup=t('firmware/src/CustomizedBackup.cpp'); mock=t('firmware/web/v3_mockup.js'); ev=t('firmware/src/EventCatalog.cpp'); sched=t('firmware/src/Scheduler.cpp'); types=t('firmware/include/Types.h'); ble=t('firmware/src/BleController.cpp'); boot_health=t('firmware/src/BootHealth.cpp'); idf_entry=t('firmware/src/IdfEntry.cpp'); release=t('tools/release.py')
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
assert '/api/event-color-theme' not in main+web and 'eventColorsOriginal' not in web and 'eventColorsModern' not in web
assert 'EventColorTheme' not in main and 'eventColorThemeGeneration' not in main
assert '0xE0B400' in ev and '0xFFFF44' not in ev
assert '{0xE0B400,0xE0B400}, // Yellow' in t('firmware/src/ColorCorrection.cpp')
assert "{name:'Yellow',reference:'#FFFF00',output:'#E0B400'}" in web
assert "let running={name:'Yellow',colors:['#E0B400']" in web
assert "'#FFFF44':'#E0B400'" in web
for value in ['0x00BD4C','0x00B4B4','0x0096FF','0xFFA000','0xB464FF','0x87002D','0xA0A5AF']: assert value not in ev
assert "{name:'Navy Blue',reference:'#000080',output:'#001478'}" in web
palette_block=re.search(r'const NAMED_COLOR_PALETTE=\[(.*?)\];',web,re.S); assert palette_block and palette_block.group(1).count("{name:'")==9
assert 'PALETTE_MIGRATION_REVISION=8' in t('firmware/src/PaletteMigration.cpp')
assert 'CUSTOM_BACKUP_PATH="/cust-backup.json"' in backup
assert 'CUSTOM_BACKUP_TMP="/cust-backup.tmp"' in backup
assert len('/cust-backup.json')<=31 and len('/cust-backup.tmp')<=31
assert 'LEGACY_BACKUP_TMP="/customized-settings-backup.tmp"' in backup
assert 'SPIFFS.rename(candidate,CUSTOM_BACKUP_PATH)' in backup
assert 'CUSTOM_BACKUP_INTERVAL_SECONDS=7UL*24UL*60UL*60UL' in backup
assert 'anderson-preset' in backup and 'anderson-csched' in backup and 'anderson-event' in backup
assert 'anderson-auth' not in backup and 'anderson-remote' not in backup
assert 'data["customLights"]' in backup and 'data["customSchedules"]' in backup and 'data["eventOverrides"]' in backup
assert 'server.on("/api/customized-backup/status"' in main and 'server.on("/api/customized-backup/create"' in main and 'server.on("/api/customized-backup/restore"' in main
assert 'customizedSettingsBackupAutoLoop(store.get(),ANDERSON_FIRMWARE_VERSION)' in main
assert 'id="settingsCustomizedTab"' in web and 'id="customBackupNow"' in web and 'id="customRestoreNow"' in web
assert "['customized','Customized Settings']" in mock
assert "const controllerNodes=generalHost?[...generalHost.children]:[]" in mock
assert "controllerNodes.forEach(node=>panes.get(category(node)).appendChild(node))" in mock
assert "window.andersonActivateSettingsTab=activate" in mock
assert "primarySettings.addEventListener('click',()=>activate('general'))" in mock
assert 'only one customized-settings backup is retained' in web
assert 'Wi-Fi passwords, profile PINs, firmware/OTA state' in web

# Native v4 rollback safety: do not bless a new OTA slot until the controller can
# serve a correct gzip Home response and its public firmware API from real sockets.
assert 'bootHealthBegin();' in idf_entry and 'bootHealthLoop();' in idf_entry
assert 'ESP_OTA_IMG_PENDING_VERIFY' in boot_health
assert 'esp_ota_mark_app_valid_cancel_rollback()' in boot_health
assert 'Content-Encoding: gzip' in boot_health
assert 'rootProbe()' in boot_health and 'firmwareProbe()' in boot_health
assert 'ROLLBACK_DEADLINE_US=45LL*1000000LL' in boot_health
assert 'esp_restart();' in boot_health

# Native-IDF v4 hardware regressions: emergency APP-only flashing must remain
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

assert 'saveSettings(next)' in main and 'Event override write failed' in main
assert 'if(tries>=8)' not in web and 'otaOperation' in web and 'expectedCommit' in web and 'versionOk&&commitOk' in web
assert 'PinAttemptState pinAttempts[6]' in main
assert 'store.clearWiFi()' in main and 'saveWiFi("","")' in t('firmware/src/SettingsStore.cpp')
for row in ['{"evt028",2037,2,15}','{"evt030",2037,10,11}','{"evt047",2037,11,9}','{"evt096",2037,1,27}','{"evt177",2037,10,18}','{"evt192",2037,11,7}']: assert row in ev,row
assert 'anderson-cache-cleanup.sh' not in build
assert 'anderson-cache-cleanup.sh' in retention and 'anderson-cache-cleanup.sh' in publisher
assert 'anderson-branch-cleanup.sh' in retention and 'anderson-branch-cleanup.sh' in publisher
assert "BRANCH_MAX_AGE_HOURS: '2'" in retention and "BRANCH_MAX_AGE_HOURS: '2'" in publisher
assert 'BRANCH_MAX_AGE_HOURS:-2' in branch_cleanup
assert 'verify_ota_manifest.py' in publisher and 'remote-update/pending/$VERSION.json' in publisher and 'remote-update/releases/$VERSION.json' in publisher
assert "cp publish-input/latest.json ../anderson-ota/latest.json" in publisher
assert 'git add latest.json remote-update' in publisher
assert 'setInterval(()=>qa(\'select[data-v3-effect-preview="1"]\')' not in mock
assert "const color=palette[Math.floor(now/360)%palette.length]" in mock
assert "const phase=Math.floor(now/240),on=phase%2===0,color=palette[Math.floor(phase/2)%palette.length]" in mock
assert "const active=Math.floor(now/360)%dots.length" not in mock
assert "dot.style.background='#f3fbff'" not in mock
assert 'v3HomeName">My Home' not in mock
assert "badge.style.display = 'none'" in mock and "profile.style.display = 'none'" in mock
