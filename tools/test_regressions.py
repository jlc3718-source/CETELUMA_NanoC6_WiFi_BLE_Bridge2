# v3.1.23 stable-release OTA discovery, v3 backup UI, event fairness, and recovery hardening
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
assert 't.effect=Effect::Breath' not in sched
assert 'Effect::Breath' not in ev
assert 'if(syncTheme.effect==Effect::Breath)' in ble
assert 'normalized.effect==Effect::Breath' not in ble
assert 'case Effect::Breath: return "Breath";' in types
assert 'if (s=="Breath" || s=="Pulse") return Effect::Breath;' in types
assert '<option value="Breath">Breath</option>' in web
assert ('const e=["Jump","Breath","Strobe","Solid"]' in mock or "const e=['Jump','Breath','Strobe','Solid']" in mock)
assert 'v3EffectPicker' in mock and 'v3EffectButton' in mock and 'v3EffectNative' in mock
assert 'EFFECT_BUTTON_VALUES' not in web and 'enhanceEffectSelect' not in web and 'enhanceEffectButtons' not in web
assert 'const SEMANTIC_COLOR_VISUAL=' in web and 'semanticColorName' in web and 'semanticColorVisual' in web
assert re.search(r'Yellow[\"\']?:[\"\']#FFD400',web) and re.search(r'Orange[\"\']?:[\"\']#FF7A00',web)
assert 'colorNamePill' in web and re.search(r'<span class="colorNamePill"[^>]*>\$\{semanticColorName\([^)]+\)\}</span>', web)
assert re.search(r'\$\(["\']liveColorCode["\']\)\.textContent=', web)
assert re.search(r'\.title=[A-Za-z_$][\w$]*\+" "\+[A-Za-z_$][\w$]*', web) and "preset '+hex" not in web
speed_block=re.search(r'static const uint8_t EVENT_SPEEDS\[\]\s*=\s*\{(.*?)\};',ev,re.S); assert speed_block
speed_values=[int(x) for x in re.findall(r'\b\d+\b',speed_block.group(1))]; assert len(speed_values)==210 and max(speed_values)<=2
assert 'EVENT_SPEEDS[index]>2?2:EVENT_SPEEDS[index]' in ev
assert 'scheduledEventSpeedHint=constrain(o.speed,1,2)' in main and 'next.speed=constrain(sp,1,2)' in main
assert 'sp=min((uint8_t)2,qs)' in main
assert 'String raw=String("v4|")+effectName(next.effect)' in main and '!head.startsWith("v4|")&&o.effect==Effect::Breath' in main
assert re.search(r'\.max=["\']2["\']', web) and 'id="eventsSpeed" type="range" min="1" max="2"' in web
assert 'savedColorLabels' in web and re.search(r'\.name\|\|NAMED_COLOR_PALETTE\[[^\]]+\]\?\.name', web)

assert web.index('let savedColors=[],savedColorLabels=[];') < web.index('function semanticColorName') < web.index('function renderColorBuilder')
assert re.search(r'\._syncEffectButtons=\(\)=>sync\(', mock) and re.search(r'setAttribute\(["\']aria-pressed["\']', mock)
assert '$("effectSelect")._syncEffectButtons?.()' in web and '$("homeEffect")._syncEffectButtons?.()' in web
assert re.search(r'\._addEventColor=addColor', web) and re.search(r'["\']function["\']==typeof [A-Za-z_$][\w$]*\._addEventColor', web)
assert "customLightSummary" in web and re.search(r'\.className=["\']colorNamePill["\']', web)
assert 'static bool firmwareOperationBusy()' in main and 'if(otaExternalClaimed){Update.abort();remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}' in main
assert 'settingsBackupRetryAfter' in main and 'delaySeconds>21600ULL' in main

assert 'ANDERSON_SETTINGS_BACKUP_V3_1_21_TRANSACTIONAL' in main
assert 'SETTINGS_BACKUP_FILE0' in main and 'SETTINGS_BACKUP_FILE1' in main and 'SETTINGS_RESTORE_ROLLBACK' in main
assert 'settingsBackupValidateDocument' in main and 'settingsBackupCommitActive' in main
assert 'settingsBackupSetRestorePending(true)' in main and 'settingsBackupRecoverPendingRestore' in main
assert 'settingsBackupMigrateLegacy' in main and 'SPIFFS dual-generation' in main
assert 'id="settingsSubnav"' not in web and 'id="backupSettingsPanel"' not in web and 'settingsSubtab=' not in web
assert 'Backup & Restore' in mock and 'function buildBackupPane' in mock and '/api/backup/status' in mock
assert 'class="profileRecoveryButton" href="/recovery"' in web and 'profileRecoveryWrap' in web
assert 'server.on("/recovery",HTTP_GET' in main
assert all(x in mock for x in ['/api/backup/settings','/api/backup/manual','/api/backup/restore','backupMaskFromUi'])
assert '/api/backup/config' not in web+mock and '/api/backup/now' not in web+mock
assert 'server.on("/api/backup/status"' in main and 'server.on("/api/backup/settings"' in main and 'server.on("/api/backup/manual"' in main and 'server.on("/api/backup/restore"' in main
assert 'maybeWeeklySettingsBackup();' in main and 'SETTINGS_BACKUP_WEEK_SECONDS=7UL*24UL*60UL*60UL' in main
assert ("const values=['Jump','Breath','Strobe','Solid'];" in mock or '["Jump","Breath","Strobe","Solid"]' in mock)
assert re.search(r'("Breath"===|==="Breath"|effect===\'Breath\')', mock) and '__REMOVED_BREATH__' not in mock
assert '.anderson-no-plain-effect-buttons' not in web and 'enhanceEffectButtons' not in web

assert 'd["scheduledEvent"].to<JsonObject>()' in main and 'scheduled["toggleable"]=true' in main
assert 'eventStateEnabled(i)&&eventAllowedInActiveSchedule(i)&&scheduledTheme.name==EVENTS[i].name' in main
assert 'if(!eventStateEnabled(i)||!eventAllowedInActiveSchedule(i)||EVENTS[i].rule==RuleType::Month)continue' in main
assert 'scheduled["upcoming"]=scheduledUpcoming' in main and 'No enabled scheduled event' in main
assert 'window.andersonScheduledEvent=e.scheduledEvent||null' in web and 'anderson-scheduled-event' in web
assert 'scheduledEventName' in mock and 'tonightEventEnabled' in mock and 'v3TonightToggleLabel","ENABLE"' in mock
assert 'Next Enabled Event' in mock and 'post("/api/event",{id:e.id,enabled:t})' in mock
assert 'syncTonight' not in mock and 'z.textContent=byId("nowTheme")' not in mock
assert 'Custom-light capacity reached (12)' in main and 'Schedule capacity reached (32)' in main
assert 'server.on("/api/events/search"' in main and 'eventRequestGeneration' in web
assert '/api/event-color-theme' in main+web and 'eventColors1' in web and 'eventColors3028' in web and 'eventColors3029' in web
assert 'EventColorTheme' in main and 'eventColorThemeGeneration' in main and 'applyOriginalEventColors' in main
assert '0xE08700' in ev and '0xFFFF44' not in ev and '0xE0B400' not in ev
assert '{0xE08700,0xE08700}, // Yellow' in t('firmware/src/ColorCorrection.cpp')
assert re.search(r'\{name:[\"\']Yellow[\"\'],reference:[\"\']#E08700[\"\'],output:[\"\']#E08700[\"\']\}',web)
assert '#E08700' in web
assert 'liveColorHex' in web and 'liveColorR' in web and 'liveColorSavePreset' in web
for value in ['0x00B4B4','0x0096FF','0xFFA000','0xB464FF','0x001478','0x87002D','0xA0A5AF']: assert value in ev
original=t('firmware/src/EventColorThemes.cpp')
assert '0x00BD4C' in original and 'ORIGINAL_EVENT_COLOR_INDEX[210][6]' in original and 'ORIGINAL_EVENT_COLOR_COUNT[210]' in original
assert re.search(r'\{name:[\"\']Navy Blue[\"\'],reference:[\"\']#001478[\"\'],output:[\"\']#001478[\"\']\}',web)
palette_block=re.search(r'const NAMED_COLOR_PALETTE=\[(.*?)\];',web,re.S); assert palette_block and len(re.findall(r'\{name:[\"\']',palette_block.group(1)))==16
assert 'PALETTE_MIGRATION_REVISION=9' in t('firmware/src/PaletteMigration.cpp')

assert 'saveSettings(next)' in main and 'Event override write failed' in main
assert 'if(tries>=8)' not in web and 'otaOperation' in web and 'expectedCommit' in web and ('versionOk&&commitOk' in web or '!e.localUnknown&&a&&s&&r' in web)
assert 'PinAttemptState pinAttempts[6]' in main
assert 'store.clearWiFi()' in main and 'saveWiFi("","")' in t('firmware/src/SettingsStore.cpp')
for row in ['{"evt028",2037,2,15}','{"evt030",2037,10,11}','{"evt047",2037,11,9}','{"evt096",2037,1,27}','{"evt177",2037,10,18}','{"evt192",2037,11,7}']: assert row in ev,row
assert 'anderson-cache-cleanup.sh' not in build
assert 'anderson-cache-cleanup.sh' in retention and 'anderson-cache-cleanup.sh' in publisher
assert 'anderson-branch-cleanup.sh' in retention and 'anderson-branch-cleanup.sh' in publisher
assert "BRANCH_MAX_AGE_HOURS: '2'" in retention and "BRANCH_MAX_AGE_HOURS: '2'" in publisher
assert 'BRANCH_MAX_AGE_HOURS:-2' in branch_cleanup
assert 'verify_ota_manifest.py' in publisher and 'ANDERSON_OTA_SIGNING_KEY_B64' in publisher and 'remote-update/pending/$VERSION.json' in publisher
assert "cp publish-input/latest.json ../anderson-ota/latest.json" in publisher
assert 'git add latest.json remote-update' in publisher
assert 'setInterval(()=>qa(\'select[data-v3-effect-preview="1"]\')' not in mock
assert '/360' in mock and 'Math.floor' in mock and 'length' in mock
assert '/240' in mock and '%2==0' in mock and 'Math.floor' in mock
assert "const active=Math.floor(now/360)%dots.length" not in mock
assert "dot.style.background='#f3fbff'" not in mock
assert 'v3HomeName">My Home' not in mock
assert 'connectionBadge' in mock and 'activeProfile' in mock and mock.count('style.display="none"')>=2
assert '<strong>Major U.S. Government Holidays</strong>' in web
assert '<span class="eventColorThemeLetter">1</span>' in web and '<span class="eventColorThemeLetter">9</span>' in web and '<span class="eventColorThemeLetter">16</span>' in web
assert '<strong>Expanded Holidays — Basic Colors</strong>' in web and '<strong>Expanded Holidays — Expanded Colors</strong>' in web
assert 'Specific holiday / awareness / seasonal day' in web and 'Coverage guarantee:' in web and '<div>6. Normal preset</div>' in web
assert 'timedTierPick' in sched and 'monthlyEligiblePosition' in sched and 'MAX_ACTIVE_TIER_EVENTS=64' in sched
assert 'Holiday, awareness, and seasonal dates all share the specific-event tier.' in sched
assert 'forcedMonthlyCoverage' in sched and 'first third of the least-conflicted' in sched
assert 'if(specificCount)' in sched and 'if(holidayWindowCount)' in sched
assert 'normal.name="Off";normal.effect=Effect::Solid;normal.colors[0]=0x000000;normal.colorCount=1' in sched
assert 'normal.name="Warm White"' not in sched
assert 'python tools/audit_event_coverage.py --start-year 2026 --end-year 2037 --require-full' in build
assert 'EventColorTheme::MajorUS' in main and 'EventColorTheme::MajorUS' in original
assert 'eventAllowedInActiveSchedule' in main and 'eventAllowedInActiveSchedule' in sched
assert 'MAJOR_US_EVENT_INDEX[]={' in original and '5,10,25,24,26,45,60,64,86,94,104,108,105,117,' in original and '143,134,133,144,145,146,172,178,192,196,201,207,208,209' in original
assert 'MAJOR_US_FEDERAL_EVENT_INDEX[]={5,10,25,94,105,117,143,172,192,196,207}' in original
assert 'favorite holiday event count' in original and 'applyOriginalEventColors(index,theme);' in original
assert 'MAJOR_US_EVENT_COLOR_INDEX' in original and 'eventColorPresetCount(EventColorTheme theme){return theme==EventColorTheme::V3029?16U:9U;}' in original
for name in ["New Year's Day","Martin Luther King Jr. Day","Presidents' Day / Washington's Birthday","Memorial Day","Juneteenth","Independence Day","Labor Day","Indigenous Peoples' Day / Columbus Day","Veterans Day","Thanksgiving","Christmas Day"]: assert name in ev,name
major_colors=re.search(r'static constexpr uint8_t MAJOR_US_EVENT_COLOR_INDEX\[\]\[4\]=\{(.*?)\};',original,re.S); assert major_colors
assert max(int(x) for x in re.findall(r'\b\d+\b',major_colors.group(1)))<=8
assert 'applyMajorUsEventColors' in original and 'resolvedPresetColor(PRESET_DEFAULTS[' in original
assert 'Choose Major U.S., 9-color expanded, or 16-color expanded holidays' in main
version=t('FIRMWARE_VERSION.txt').strip(); assert f'ANDERSON_FIRMWARE_VERSION="{version}"' in main
remote=t('firmware/src/RemoteUpdate.cpp')
assert 'OTA_RELEASE_API_URL="https://api.github.com/repos/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/latest"' in remote
assert 'OTA_RELEASE_MANIFEST_ASSET="ota-manifest.json"' in remote and 'discoverLatestReleaseManifest' in remote
assert 'OTA_MANIFEST_FALLBACK_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json"' in remote
assert '?cb=' in remote and 'esp_random()' in remote and 'OTA_AUTO_RETRY_BASE_MS' in remote
assert 'publish-input/ota-manifest.json' in publisher and '--pattern ota-manifest.json' in publisher
assert 'id="profileSolarTimes"' in web and web.index('id="profileSolarTimes"') < web.index('class="profileChoices"')
assert 'id="homeSolarTimes"' in web and web.index('id="nextEvent"') < web.index('id="homeSolarTimes"')
assert 'd["dawn"]=fmtDisplayTime(scheduler.civilDawnMinutes(l))' in main
assert 'd["dusk"]=fmtDisplayTime(scheduler.civilDuskMinutes(l))' in main
assert 'static String fmtDisplayTime(uint16_t m)' in main and 'pm?"PM":"AM"' in main
assert 'cfg["on"]=fmtTime(s.onMinutes)' in main and 'cfg["off"]=fmtTime(s.offMinutes)' in main
assert 'formatClockTime(e)' in web and 'formatClockTime(e.settings.off)' in web and 'formatClockTime(e.settings.schedule2End)' in web
assert 'Dusk ${n.dusk||"—"} • Dawn ${n.dawn||"—"}' in web
assert 'Dusk ${e.settings?.dusk||"—"} • Dawn ${e.settings?.dawn||"—"}' in web
assert 'p.every(e=>"#000000"===normHex(e))' in web and 'if(g)return{c:"#000000",a:0,s:1}' in web
print('Anderson regression source checks passed')
