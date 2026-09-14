from pathlib import Path
import re

VERSION='3.1.23'
repo='jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2'

Path('FIRMWARE_VERSION.txt').write_text(VERSION+'\n')

# Firmware version.
mainp=Path('firmware/src/main.cpp')
main=mainp.read_text()
old='static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.22";'
new=f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{VERSION}";'
if old not in main:
    raise SystemExit('main firmware version anchor missing')
main=main.replace(old,new,1)
mainp.write_text(main)

# Restore the working v3.1.19-era Backup & Restore presentation. 3.1.21/22
# accidentally added a second static panel with the same backupSettingsPanel id;
# v3_mockup.js therefore skipped building the real independent Backup & Restore tab.
webp=Path('firmware/web/index.html')
web=webp.read_text()
start=web.find('  <div id="settingsSubnav"')
end=web.find('    <div id="systemMonitorPanel"',start)
if start<0 or end<0:
    raise SystemExit('duplicate backup settings panel anchors missing')
web=web[:start]+web[end:]

js_start=web.find("let currentRole='none',wifiScanBusy=false;\nlet settingsSubtab=")
js_end=web.find('\n\nconst API_MODE',js_start)
if js_start<0 or js_end<0:
    raise SystemExit('duplicate backup JavaScript anchors missing')
web=web[:js_start]+"let currentRole='none',wifiScanBusy=false;"+web[js_end:]

remove_tokens=(
    "$('settingsGeneralTab')?.addEventListener",
    "$('backupSettingsTab')?.addEventListener",
    "$('saveBackupSelection')?.addEventListener",
    "$('backupNow')?.addEventListener",
    "$('restoreBackup')?.addEventListener",
)
lines=[]
for line in web.splitlines():
    if any(token in line for token in remove_tokens):
        continue
    lines.append(line)
web='\n'.join(lines)+'\n'
web=web.replace(";if(settingsSubtab==='backup')loadSettingsBackupStatus()",'')
if '<strong>v3.1.22</strong>' not in web:
    raise SystemExit('visible version anchor missing')
web=web.replace('<strong>v3.1.22</strong>',f'<strong>v{VERSION}</strong>',1)
if 'id="settingsSubnav"' in web or 'id="backupSettingsPanel"' in web or 'settingsSubtab=' in web:
    raise SystemExit('duplicate backup UI was not fully removed')
webp.write_text(web)

# Switch OTA discovery to the GitHub stable Release API and the signed manifest
# attached to that exact release. The raw ota branch remains a fallback only.
rp=Path('firmware/src/RemoteUpdate.cpp')
remote=rp.read_text()
old_const='static constexpr const char* OTA_MANIFEST_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json";\nstatic constexpr const char* OTA_RELEASE_PREFIX="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v";'
new_const='static constexpr const char* OTA_MANIFEST_FALLBACK_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json";\nstatic constexpr const char* OTA_RELEASE_API_URL="https://api.github.com/repos/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/latest";\nstatic constexpr const char* OTA_RELEASE_MANIFEST_ASSET="ota-manifest.json";\nstatic constexpr const char* OTA_RELEASE_PREFIX="https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v";'
if old_const not in remote:
    raise SystemExit('OTA manifest constant anchor missing')
remote=remote.replace(old_const,new_const,1)
remote=remote.replace('static constexpr size_t OTA_MANIFEST_MAX_BYTES=4096;','static constexpr size_t OTA_MANIFEST_MAX_BYTES=4096;\nstatic constexpr size_t OTA_RELEASE_API_MAX_BYTES=32768;',1)

block_start=remote.find('static bool readHttpBodyCapped(')
block_end=remote.find('static bool downloadAndStage(',block_start)
if block_start<0 or block_end<0:
    raise SystemExit('remote manifest function block anchors missing')
new_block=r'''static bool readHttpBodyCapped(HTTPClient&http,String&body,String&failure,size_t maxBytes=OTA_MANIFEST_MAX_BYTES,uint32_t deadlineMs=OTA_MANIFEST_DEADLINE_MS){int announced=http.getSize();if(announced>(int)maxBytes){failure="Remote response exceeds the maximum allowed size";return false;}NetworkClient*stream=http.getStreamPtr();body="";body.reserve(announced>0?announced:512);uint8_t buffer[512];size_t total=0;uint32_t started=millis(),lastData=started;for(;;){if((uint32_t)(millis()-started)>deadlineMs){failure="Remote request exceeded its absolute deadline";return false;}int available=stream->available();if(available>0){size_t want=min((size_t)available,sizeof(buffer));if(total+want>maxBytes){failure="Remote response exceeds the maximum allowed size";return false;}int got=stream->read(buffer,want);if(got>0){body.concat((const char*)buffer,(unsigned int)got);total+=(size_t)got;lastData=millis();continue;}}if(announced>=0&&total>=(size_t)announced)break;if(!stream->connected()&&!stream->available())break;if((uint32_t)(millis()-lastData)>OTA_MANIFEST_IDLE_MS){failure="Remote request stalled";return false;}vTaskDelay(pdMS_TO_TICKS(2));}if(!total){failure="Remote response is empty";return false;}return true;}
static bool httpGetCapped(const String&url,size_t maxBytes,String&body,int&httpStatus,String&failure,bool githubApi=false){WiFiClientSecure client;client.setInsecure();client.setHandshakeTimeout(12);HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);if(!http.begin(client,url)){failure="Could not open remote URL";return false;}http.addHeader("Cache-Control","no-cache, no-store, max-age=0");http.addHeader("Pragma","no-cache");if(githubApi){http.addHeader("Accept","application/vnd.github+json");http.addHeader("X-GitHub-Api-Version","2022-11-28");http.addHeader("User-Agent","AndersonHome-NanoC6");}httpStatus=http.GET();if(httpStatus!=HTTP_CODE_OK){failure=String("HTTP ")+String(httpStatus);http.end();return false;}bool ok=readHttpBodyCapped(http,body,failure,maxBytes,OTA_MANIFEST_DEADLINE_MS);http.end();return ok;}
static bool discoverLatestReleaseManifest(String&manifestUrl,String&releaseVersion,int&httpStatus,String&failure){String body;String requestUrl=String(OTA_RELEASE_API_URL)+"?cb="+String((uint32_t)esp_random(),HEX)+"-"+String((uint32_t)millis(),HEX);if(!httpGetCapped(requestUrl,OTA_RELEASE_API_MAX_BYTES,body,httpStatus,failure,true))return false;JsonDocument d;if(deserializeJson(d,body)||!d.is<JsonObject>()){failure="GitHub latest-release response is invalid";return false;}String tag=d["tag_name"]|String("");const String prefix="anderson-v";if(!tag.startsWith(prefix)){failure="Latest stable release is not an Anderson firmware release";return false;}releaseVersion=tag.substring(prefix.length());if(!parseVersion(releaseVersion).valid){failure="Latest release version is invalid";return false;}if(!d["assets"].is<JsonArray>()){failure="Latest release has no asset list";return false;}for(JsonObject asset:d["assets"].as<JsonArray>()){String name=asset["name"]|String("");if(name!=OTA_RELEASE_MANIFEST_ASSET)continue;manifestUrl=asset["browser_download_url"]|String("");break;}String expected=String(OTA_RELEASE_PREFIX)+releaseVersion+"/"+OTA_RELEASE_MANIFEST_ASSET;if(manifestUrl!=expected){failure="Latest release is missing the exact signed OTA manifest asset";return false;}return true;}
static bool fetchVerifiedManifest(const char*current,RemoteStatus&st){st.checked=true;st.phase="checking latest stable release";publish(st);if(WiFi.status()!=WL_CONNECTED){st.message="Wi-Fi is not connected";return false;}String body,manifestUrl,releaseVersion,primaryFailure,fallbackFailure;int code=0;bool primary=discoverLatestReleaseManifest(manifestUrl,releaseVersion,code,primaryFailure);if(primary&&!httpGetCapped(manifestUrl,OTA_MANIFEST_MAX_BYTES,body,code,primaryFailure,false))primary=false;if(!primary){String fallbackUrl=String(OTA_MANIFEST_FALLBACK_URL)+"?cb="+String((uint32_t)esp_random(),HEX)+"-"+String((uint32_t)millis(),HEX);if(!httpGetCapped(fallbackUrl,OTA_MANIFEST_MAX_BYTES,body,code,fallbackFailure,false)){st.httpStatus=code;st.message=String("Release API failed (")+primaryFailure+"); raw fallback failed ("+fallbackFailure+")";return false;}releaseVersion="";}st.httpStatus=code;JsonDocument d;if(deserializeJson(d,body)||!d.is<JsonObject>()||(d["schema"]|0)!=1){st.message="Remote manifest format is invalid";return false;}String payload=d["payload"]|String(""),sig=d["signature"]|String("");if(!payload.length()||!sig.length()){st.message="Remote manifest is missing its signed payload";return false;}st.signatureValid=verifySignature(payload,sig);if(!st.signatureValid){st.message="Remote manifest signature is invalid";return false;}if(!parsePayload(payload,st)){st.message="Signed manifest payload is invalid";return false;}if(releaseVersion.length()&&st.availableVersion!=releaseVersion){st.message="Release API version does not match the signed manifest";return false;}int cmp=compareVersion(st.availableVersion,String(current));String rejected;st.updateHold=readHold(rejected);st.rejectedVersion=rejected;st.ok=true;st.updateAvailable=cmp>0;if(st.updateHold&&st.updateAvailable&&compareVersion(st.availableVersion,rejected)<=0){st.updateAvailable=false;st.message=String("Update hold is active for rejected release ")+rejected+". Resume updates or wait for a newer fixed release.";}else if(st.updateHold&&st.updateAvailable){st.message=String("Verified newer recovery update ")+st.availableVersion+" is available beyond held release "+rejected+".";}else if(cmp>0)st.message=String("Verified update available: ")+st.availableVersion;else if(cmp==0)st.message=String("Signed stable-release manifest verified. Anderson Home ")+current+" is current.";else st.message=String("Signed stable-release manifest advertises older firmware ")+st.availableVersion+"; downgrade is blocked.";return true;}

'''
remote=remote[:block_start]+new_block+remote[block_end:]
if 'OTA_RELEASE_API_URL' not in remote or 'discoverLatestReleaseManifest' not in remote or 'OTA_MANIFEST_FALLBACK_URL' not in remote:
    raise SystemExit('release API OTA patch failed')
rp.write_text(remote)

# Regression gates.
tp=Path('tools/test_regressions.py')
t=t=tp.read_text()
t=t.replace('# v3.1.22 major U.S. holiday profile, expanded calendars, Breath UI, backup/recovery hardening','# v3.1.23 stable-release OTA discovery, v3 backup UI, event fairness, and recovery hardening',1)
old_backup="assert 'id=\"backupSettingsTab\"' in web and 'id=\"backupSettingsPanel\"' in web\nassert 'class=\"profileRecoveryButton\" href=\"/recovery\"' in web and 'profileRecoveryWrap' in web\nassert 'server.on(\"/recovery\",HTTP_GET' in main\nassert \"post('/api/backup/settings',{mask})\" in web and \"post('/api/backup/manual',{mask})\" in web and \"post('/api/backup/restore',{})\" in web\nassert '/api/backup/config' not in web and '/api/backup/now' not in web\nassert '/api/backup/status' in web and '/api/backup/settings' in web and '/api/backup/manual' in web and '/api/backup/restore' in web\n"
new_backup="assert 'id=\"settingsSubnav\"' not in web and 'id=\"backupSettingsPanel\"' not in web and 'settingsSubtab=' not in web\nassert 'ANDERSON_BACKUP_RESTORE_UI_V3_1_13' in mock and \"['backup','Backup & Restore']\" in mock and 'function buildBackupPane' in mock\nassert 'class=\"profileRecoveryButton\" href=\"/recovery\"' in web and 'profileRecoveryWrap' in web\nassert 'server.on(\"/recovery\",HTTP_GET' in main\nassert \"post('/api/backup/settings',{mask:backupMaskFromUi()})\" in mock and \"post('/api/backup/manual',{mask:backupMaskFromUi()})\" in mock and \"post('/api/backup/restore',{})\" in mock\nassert '/api/backup/config' not in web+mock and '/api/backup/now' not in web+mock\nassert 'server.on(\"/api/backup/status\"' in main and 'server.on(\"/api/backup/settings\"' in main and 'server.on(\"/api/backup/manual\"' in main and 'server.on(\"/api/backup/restore\"' in main\nassert 'maybeWeeklySettingsBackup();' in main and 'SETTINGS_BACKUP_WEEK_SECONDS=7UL*24UL*60UL*60UL' in main\n"
if old_backup not in t:
    raise SystemExit('backup regression block anchor missing')
t=t.replace(old_backup,new_backup,1)
old_remote='assert \'OTA_MANIFEST_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json"\' in remote\nassert \'?cb=\' in remote and \'esp_random()\' in remote and \'OTA_AUTO_RETRY_BASE_MS\' in remote\n'
new_remote='assert \'OTA_RELEASE_API_URL="https://api.github.com/repos/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/latest"\' in remote\nassert \'OTA_RELEASE_MANIFEST_ASSET="ota-manifest.json"\' in remote and \'discoverLatestReleaseManifest\' in remote\nassert \'OTA_MANIFEST_FALLBACK_URL="https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/ota/latest.json"\' in remote\nassert \'?cb=\' in remote and \'esp_random()\' in remote and \'OTA_AUTO_RETRY_BASE_MS\' in remote\nassert \'publish-input/ota-manifest.json\' in publisher and \'--pattern ota-manifest.json\' in publisher\n'
if old_remote not in t:
    raise SystemExit('remote regression block anchor missing')
t=t.replace(old_remote,new_remote,1)
tp.write_text(t)

mp=Path('tools/test_maintenance.py')
mt=mp.read_text()
anchor="assert 'OTA_MANIFEST_MAX_BYTES=4096' in remote and 'OTA_DOWNLOAD_DEADLINE_MS=180000UL' in remote\n"
repl=anchor+"assert 'OTA_RELEASE_API_MAX_BYTES=32768' in remote and 'OTA_RELEASE_API_URL=' in remote and 'OTA_MANIFEST_FALLBACK_URL=' in remote\n"
if anchor not in mt:
    raise SystemExit('maintenance OTA anchor missing')
mt=mt.replace(anchor,repl,1)
mp.write_text(mt)

Path('firmware/RELEASE_NOTES_v3.1.23.md').write_text('''# Anderson Home v3.1.23\n\n- Makes fast OTA discovery permanent: the NanoC6 now checks GitHub's latest stable Release API first and downloads the exact signed `ota-manifest.json` asset attached to that release. The existing signed raw `ota` manifest remains a fallback only.\n- Keeps all signature, version, SHA-256, byte-count, commit, downgrade, rollback-hold, and inactive-slot protections.\n- Restores the working v3.1.19-style independent **Settings → Backup & Restore** tab. Removes the duplicate v3.1.21/3.1.22 static backup panel that prevented the real tab from being built.\n- Backup & Restore again lets Jason select Scheduling & timezone, Light controllers, Custom shows & schedules, Favorite colors, and Events & favorites; save the selection; run a manual backup; and restore the last verified backup. Wi-Fi passwords and profile PINs remain intentionally excluded.\n- Weekly automatic backup remains enabled for the selected categories, using the transactional dual-generation backup backend and restore rollback protection introduced in v3.1.21.\n- Preserves the v3.1.22 recovery button, four animated effect buttons including Breath, semantic color names, schedules, favorites, event fairness, and protected OTA layout.\n''')

print('Anderson Home v3.1.23 release API OTA and backup UI fixes applied')
