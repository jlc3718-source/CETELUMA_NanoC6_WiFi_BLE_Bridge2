/*
 * Jason Home 2 native recovery web and Wi-Fi provisioning.
 * Web UI is intentionally separate from Oracle/BLE tasks; even if the
 * transport fails the user can update from the original factory updater.
 * ONLY private LAN or the Jason-Home-2-Setup AP may initiate changes.
 * No direct in-place runtime flashing, no hidden auto updates.
 */
#include "web_recovery.h"
#include "native_recovery.h"
#include "bridge.h"
#include "native_ble.h"
#include "native_commands.h"
#include "native_sequence.h"
#include "nvs.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_littlefs.h"
#include "esp_partition.h"
#include "mbedtls/sha256.h"
#include "mdns.h"
#include "lwip/sockets.h"
#include "lwip/apps/sntp.h"
#include "cJSON.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <arpa/inet.h>
#define WEB_WIFI_READY BIT0
static const char *TAG="JH2_WEB_RECOVERY";
static EventGroupHandle_t net_event=NULL;
static esp_netif_t *sta_netif=NULL,*ap_netif=NULL;
static bool creds_ready=false,fs_ready=false,ap_enabled=false;
static volatile bool recovery_request=false;
static httpd_handle_t web_server=NULL;
static char saved_ssid[33]={0},saved_pass[65]={0};
static char saved_oracle_endpoint[176]={0};
static int64_t wifi_down_since=0;
static bool sntp_started=false,mdns_started=false;

static const char *HOME_HTML=
"<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Jason Home 2 Nano</title>\n<style>\n"
":root{color-scheme:dark}*{box-sizing:border-box}\nbody{font:16px system-ui,-apple-system,sans-serif;max-width:500px;margin:28px auto;padding:0 16px;background:#091624;colo"
"r:#eef6ff}\nh1{font-size:1.65rem;margin-bottom:4px}h2{font-size:1.12rem;margin:0 0 15px}\np{line-height:1.45}.muted{color:#b9cbdc}.panel{background:#14273b;border:1px solid"
" #35506a;border-radius:16px;padding:20px;margin:16px 0}\n.status{display:flex;justify-content:space-between;gap:12px;margin:12px 0}.status strong{text-align:right}\n.good{c"
"olor:#7be4b6}.bad{color:#ffbaac}\n.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}\nbutton,a.action{border:1px solid #48718a;border-radius:12px;padding:14px 10"
"px;background:#1d4d65;color:white;font:inherit;text-align:center;text-decoration:none;cursor:pointer}\nbutton:disabled{opacity:.45;cursor:not-allowed}\nbutton.primary{backg"
"round:#0d756b;border-color:#0c8d80}\na.action{display:block;margin-top:10px}#bleResult,#result,#updateResult{min-height:23px;font-size:.91rem}\n</style></head><body>\n<h1>Ja"
"son Home 2</h1><p class=\"muted\">SmartDawn curtain controller</p>\n<a class=\"action\" href=\"/status\">View Nano Live Status</a>\n<section class=\"panel\"><h2>Controller</h2>\n<div class=\"status\"><span>Firmware</span><strong id=\"version\">"
"Checking...</strong></div>\n<div class=\"status\"><span>Bluetooth</span><strong id=\"ble\">Checking...</strong></div>\n<div class=\"actions\"><button id=\"bleConnect\" class=\"prima"
"ry\" onclick=\"bluetooth('connect')\" disabled>Connect Bluetooth</button>\n<button id=\"bleDisconnect\" onclick=\"bluetooth('disconnect')\" disabled>Disconnect Bluetooth</button>"
"</div>\n<p id=\"bleResult\" class=\"muted\" role=\"status\"></p>\n</section>\n<section class=\"panel\"><h2>Curtain power</h2>\n<div class=\"actions\"><button id=\"on\" class=\"primary\" on"
"click=\"power('powerOn')\" disabled>ON</button>\n<button id=\"off\" onclick=\"power('powerOff')\" disabled>OFF</button></div>\n<button id=\"curtainRebootMain\" onclick=\"curtainReboot()\" disabled>Curtain Reboot</button>\n<p id=\"curtainRebootMessage\" class=\"muted\" role=\"status\"></p>\n<p id=\"result\" class=\"muted\" role=\"status\"></p></se"
"ction>\n<section class=\"panel\"><h2>Firmware updates</h2>\n<div class=\"actions\"><button id=\"check\" onclick=\"checkUpdate()\">Check OTA</button>\n<button id=\"install\" class=\"pri"
"mary\" onclick=\"installUpdate()\" disabled>Install OTA</button></div>\n<label><input type='checkbox' id='autoUpdate' onchange='setAutoUpdate(this.checked)'> Enable automatic signed updates</label>\n<a class=\"action\" href=\"/firmware\">Firmware recovery &amp; diagnostics</a>\n<p id=\"updateResult\" class=\"muted\""
" role=\"status\">Signed automatic updates are off by default in recovery firmware.</p>\n<details class='panel'><summary>Recovery / rollback to 1.1.67</summary><p class='muted'>Download the verified 1.1.67 runtime BIN before updating. To roll back, open firmware recovery, start the manual uploader, and upload the saved BIN. Wi-Fi and pairing settings are preserved. This is not instant A/B rollback.</p><a class='action' href='https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/jason-home-2-nanoc6-v1.1.67/jh2-runtime-1.1.67.bin' target='_blank' rel='noopener noreferrer'>Download verified 1.1.67 backup</a><a class='action' href='/firmware'>Open Nano firmware recovery</a></details></section>\n<script>\nconst $=id=>document.getElementById(id);\nlet nanoStatusRefreshing=false;\nasync function refresh(){\n  if(nanoStatusRefreshing)return;\n  nanoStatusRefreshing=true;\n  try{\n    const r=await fetch('/api/s"
"tatus',{cache:'no-store'});\n    if(!r.ok)throw Error('Controller status unavailable');\n    const d=await r.json(),c=d.curtain||{},connected=!!c.connected;\n    $('autoUpdate').checked=d.signedAutoUpdate===true;\n    $('version'"
").textContent=d.version||'Unknown';\n    const paused=c.nativeReconnectPaused===true;\n    $('ble').textContent=connected?'Connected':paused?'Disconnected (paused)':'Discon"
"nected / searching';\n    $('ble').className=connected?'good':'bad';\n    $('bleConnect').disabled=connected;\n    $('bleDisconnect').disabled=paused;\n    $('curtainRebootMain').disabled=!connected;\n    $('on').disabled=$"
"('off').disabled=!connected;\n  }catch(e){\n    $('version').textContent='Unavailable';\n    $('ble').textContent='Disconnected';\n    $('ble').className='bad';\n    $('bleCon"
"nect').disabled=$('bleDisconnect').disabled=true;\n    $('on').disabled=$('off').disabled=true;\n    $('curtainRebootMain').disabled=true;\n  }finally{nanoStatusRefreshing=false;}\n}\nasync function curtainReboot(){\n if(!confirm('Reboot the SmartDawn curtain controller? The curtain will briefly disconnect from Bluetooth. The Nano will NOT restart.'))return;\n const b=$('curtainRebootMain');b.disabled=true;\n $('curtainRebootMessage').textContent='Sending manufacturer reboot request to SmartDawn...';\n try{\n  const r=await fetch('/api/ble/local',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'curtainReboot'})});\n  const d=await r.json();\n  if(!r.ok||!d.ok||!d.gattAccepted)throw Error(d.message||'Bluetooth reboot request failed');\n  $('curtainRebootMessage').textContent='SmartDawn reboot command accepted by GATT. Reconnection may take a moment; actual reboot not yet verified.';\n }catch(e){$('curtainRebootMessage').textContent=e.message;}\n await refresh();\n}\nasync function bluetooth(action){\n  $('bleConnect').disabled=$('bleDi"
"sconnect').disabled=true;\n  $('bleResult').textContent=action==='connect'?'Looking for saved SmartDawn controller...':'Disconnecting Bluetooth...';\n  try{\n    const r=awa"
"it fetch('/api/ble/'+action,{method:'POST'});\n    const d=await r.json();\n    if(!r.ok||!d.ok)throw Error(d.message||'Bluetooth request rejected');\n    $('bleResult').tex"
"tContent=d.message||'Request accepted; checking Bluetooth status';\n  }catch(e){$('bleResult').textContent=e.message;}\n  await refresh();\n}\nasync function power(action){\n "
" $('on').disabled=$('off').disabled=true;\n  $('result').textContent='Sending command...';\n  try{\n    const r=await fetch('/api/ble/local',{method:'POST',\n      headers:{'"
"Content-Type':'application/x-www-form-urlencoded'},\n      body:new URLSearchParams({action})});\n    const d=await r.json();\n    if(!r.ok||!d.ok||!d.gattAccepted)throw Err"
"or(d.message||'Controller did not accept command');\n    $('result').textContent=action==='powerOn'?'ON command accepted':'OFF command accepted';\n  }catch(e){$('result').t"
"extContent=e.message}\n  await refresh();\n}\nasync function checkUpdate(){\n  $('install').disabled=true;$('updateResult').textContent='Checking signed OTA...';\n  try{\n    c"
"onst r=await fetch('/api/firmware/check',{cache:'no-store'}),d=await r.json();\n    if(!r.ok||!d.available)throw Error(d.message||'No update available');\n    $('install')."
"disabled=false;\n    $('install').textContent='Install '+d.version;\n    $('updateResult').textContent='Signed update '+d.version+' available.';\n  }catch(e){$('updateResult"
"').textContent=e.message}\n}\nasync function installUpdate(){\n  if($('install').disabled||!confirm('Install verified firmware and restart Nano now?'))return;\n  $('install')"
".disabled=true;$('updateResult').textContent='Starting verified OTA...';\n  try{\n    const r=await fetch('/api/firmware/install',{method:'POST'}),d=await r.json();\n    if("
"!r.ok||!d.ok)throw Error(d.message||'OTA request failed');\n    $('updateResult').textContent='Update queued. Nano will restart into verified updater.';\n  }catch(e){$('upd"
"ateResult').textContent=e.message}\n}\n\nasync function setAutoUpdate(enabled){\n  try{const r=await fetch('/api/firmware/auto',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'enabled='+(enabled?1:0)});\n  const d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||'Save failed');\n  $('updateResult').textContent=enabled?'Automatic signed updates ON':'Automatic signed updates OFF';\n  await refresh();\n  }catch(e){$('updateResult').textContent=e.message;await refresh();}\n}\nrefresh();setInterval(refresh,3500);\n</script></body></html>\n";

// Independent local Nano diagnostic UI; never passes through Oracle.
static const char *STATUS_HTML =
"<!doctype html>\n"
"<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
"<title>Nano C6 - Direct Curtain Status</title>\n"
"<style>\n"
":root{color-scheme:dark}*{box-sizing:border-box}body{font:16px system-ui,-apple-system,sans-serif;background:#091624;color:#eef6ff;margin:0 auto;padding:20px;max-width:660px}\n"
"h1{font-size:1.55rem;margin:0 0 5px}h2{font-size:1rem;margin:0 0 12px;color:#bfd3e8}\n"
"p{line-height:1.5}.muted{color:#afc3d8}.panel{background:#14273b;border:1px solid #34506d;border-radius:16px;padding:18px;margin:14px 0}\n"
".big{font-size:1.8rem;font-weight:700}.row{display:flex;justify-content:space-between;gap:12px;margin:10px 0}.row strong{text-align:right;overflow-wrap:anywhere}\n"
".good{color:#7be4b6}.bad{color:#ffb2a6}.warn{color:#e4c489}\n"
"a{color:#7be4b6}small{color:#bdcbd9}code{font-size:.85rem}button{font:inherit;border:1px solid #4b7a91;border-radius:10px;padding:10px 15px;background:#1b4761;color:white;cursor:pointer}\n"
"</style></head><body>\n"
"<h1>Nano C6 - Live Curtain Status</h1>\n"
"<p class=\"muted\">Direct Nano Wi-Fi to Bluetooth data. This page does not contact Oracle or send lighting commands.</p>\n"
"<div class=\"panel\"><h2>Actual power report</h2><div id=\"power\" class=\"big warn\">Checking...</div>\n"
"<div id=\"powerDetail\" class=\"muted\">Waiting for controller data</div></div>\n"
"<div class=\"panel\"><h2>What the curtain is displaying</h2><div id=\"effect\" class=\"big\">Checking...</div>\n"
"<p id=\"effectDetail\" class=\"muted\"></p><div class=\"row\"><span>Last identified</span><strong id=\"lastEffect\">Unknown</strong></div></div>\n"
"<div class=\"panel\"><h2>Bluetooth diagnostics</h2>\n"
"<div class=\"row\"><span>Connection</span><strong id=\"ble\">Checking...</strong></div>\n"
"<div class=\"row\"><span>Firmware</span><strong id=\"firmware\">...</strong></div>\n"
"<div class=\"row\"><span>Power opcode 2103 received</span><strong id=\"rx2103\">...</strong></div>\n"
"<div class=\"row\"><span>Power opcode 2105 received</span><strong id=\"rx2105\">...</strong></div>\n"
"<div class=\"row\"><span>Playback opcode 2630 received</span><strong id=\"rx2630\">...</strong></div>\n"
"<div class=\"row\"><span>Other notifications received</span><strong id=\"total\">...</strong></div>\n"
"<div class=\"row\"><span>Notification drops</span><strong id=\"drops\">...</strong></div>\n"
"<div class=\"row\"><span>Last checked</span><strong id=\"checked\">...</strong></div></div>\n"
"<p><button type=\"button\" onclick=\"refresh()\">Refresh now</button> &nbsp; <a href=\"/settings/nano\">Nano controls</a> &nbsp; <a href=\"/api/status\">Raw JSON</a></p>\n"
"<p class=\"muted\"><small>Auto-refreshes every 3 seconds. Counts apply to the current Nano Bluetooth session. UNKNOWN means there is no fresh controller confirmation; it does not mean OFF. This page is available on the local Wi-Fi network only if the router keeps Nano port 80 private.</small></p>\n"
"<script>\n"
"'use strict';\n"
"const el=id=>document.getElementById(id);\n"
"const set=(id,value)=>{el(id).textContent=String(value)};\n"
"const age=value=>Number.isFinite(Number(value))&&Number(value)>=0?Math.round(Number(value)/1000)+'s ago':'age unknown';\n"
"function labelEffect(p){\n"
" if(!p||p.state==='unknown')return 'Not reported';\n"
" const kind=p.mode||'Effect',title=p.title||'';\n"
" const slot=Number.isInteger(p.slot)?'slot '+p.slot:'';\n"
" const cid=Number.isInteger(p.cid)?'CID '+p.cid:'';\n"
" return [title||kind,slot,cid].filter(Boolean).join(' / ');\n"
"}\n"
"let busy=false;\n"
"async function refresh(){\n"
" if(busy)return;busy=true;\n"
" try{\n"
"  const res=await fetch('/api/status',{cache:'no-store'});\n"
"  if(!res.ok)throw Error('HTTP '+res.status);\n"
"  const d=await res.json(),c=d.curtain||{},p=d.controllerPower||{},x=d.controllerPlayback||{},last=d.controllerLastIdentified||{};\n"
"  const connected=c.connected===true;\n"
"  set('firmware',d.version||'Unknown');set('ble',connected?'Connected':c.nativeReconnectPaused?'Disconnected (paused)':'Disconnected / searching');\n"
"  el('ble').className=connected?'good':'bad';\n"
"  const seconds=Number(p.ageMs);\n"
"  const fresh=connected&&typeof p.on==='boolean'&&Number.isFinite(seconds)&&seconds>=0&&seconds<=60000&&[2103,2105].includes(Number(p.opcode));\n"
"  set('power',fresh?(p.on?'ON - CONFIRMED':'OFF - CONFIRMED'):'UNKNOWN / STALE');\n"
"  el('power').className='big '+(fresh?'good':'warn');\n"
"  set('powerDetail',typeof p.on==='boolean'?'Last real report: '+(p.on?'ON':'OFF')+', opcode '+p.opcode+', '+age(p.ageMs)+(fresh?'':' (not current)'):'No 2103/2105 power report received in this session');\n"
"  const current=connected&&x.state==='current'&&Number(x.ageMs)<=30000;\n"
"  set('effect',current?labelEffect(x):'Current display not verified');\n"
"  set('effectDetail',x.noticeId?'Last playback notification: '+age(x.ageMs)+', type '+(x.type?? 'unknown')+(current?' (recent)':' (stale)'):'No playback notification yet');\n"
"  set('lastEffect',last.noticeId?labelEffect(last)+' ('+age(last.ageMs)+')':'Unknown');\n"
"  set('rx2103',c.nativeRawPower2103Seen?? 'N/A');set('rx2105',c.nativeRawPower2105Seen?? 'N/A');\n"
"  set('rx2630',c.nativeRawPlayback2630Seen?? 'N/A');\n"
"  set('total',c.nativeNotificationsSeen?? 'N/A');set('drops',c.nativeNoticeDrops?? 'N/A');\n"
"  set('checked',new Date().toLocaleTimeString());\n"
" }catch(e){set('power','NANO NOT REACHABLE');el('power').className='big bad';set('powerDetail',String(e.message||e));set('ble','Unavailable');set('checked',new Date().toLocaleTimeString())}\n"
" finally{busy=false}\n"
"}\n"
"refresh();setInterval(refresh,3000);\n"
"</script></body></html>\n"
;

static const char *SETUP_HTML=
"<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
"<meta charset='UTF-8'><title>Jason Home 2 Setup</title>"
"<style>body{font:16px system-ui;margin:24px auto;max-width:560px;padding:16px;background:#081321;color:#eef5ff}"
"a{color:#71ded2}input,button{display:block;box-sizing:border-box;width:100%;padding:12px;margin:10px 0;border-radius:9px}"
"button{background:#69dec6;border:0;font-weight:700}small{color:#c1d5e5}</style></head><body>"
"<h1>Jason Home 2 NanoC6</h1><p>Native RX2 &bull; permanent browser firmware recovery</p>"
"<p><a href='/firmware'>Open firmware updater</a> &nbsp; <a href='/api/status'>Diagnostics</a></p>"
"<h2>Wi-Fi &amp; Oracle pairing</h2>"
"<p>Leave any already-configured value blank to keep it unchanged.</p>"
"<form action='/setup' method='POST'>"
"<label>2.4 GHz Wi-Fi name<input name='ssid' maxlength='32'></label>"
"<label>Wi-Fi password<input type='password' name='password' maxlength='64'></label>"
"<label>Oracle HTTPS base URL<input name='oracleEndpoint' placeholder='https://server/jason-home-2' maxlength='175'></label>"
"<label>Oracle bridge ID<input name='oracleBridgeId' maxlength='63'></label>"
"<label>Oracle bridge token (64 hex digits)<input type='password' name='oracleBridgeToken' maxlength='64'></label>"
"<button type='submit'>Save settings and restart</button></form>"
"<small>Connect to the Jason-Home-2-Setup Wi-Fi if the home network is unavailable. "
"This page never displays saved passwords or bridge tokens.</small>"
"</body></html>";
static const char *FIRMWARE_HTML=
"<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
"<meta charset='UTF-8'><title>Jason Home 2 Firmware</title>"
"<style>body{font:16px system-ui;max-width:560px;padding:16px;margin:24px auto;background:#081321;color:white}"
"button{padding:14px;border-radius:10px;background:#69dec6;border:0;font-weight:bold;width:100%}"
"a{color:#71ded2}small{color:#c1d5e5}</style></head><body><h1>Firmware recovery</h1>"
"<p>The original permanent updater is preserved in the factory partition. "
"The updater verifies the product identity, image, and runtime size before installing.</p>"
"<section style='margin:18px 0;padding:15px;border:1px solid #355b74;border-radius:12px;background:#14273b'>"
"<h2>Curtain Reboot</h2>"
"<p>Restart the SmartDawn curtain controller only. This will NOT restart the Nano or erase effects.</p>"
"<button id='curtainRebootFirmware' onclick='curtainReboot()'>Curtain Reboot</button>"
"<p id='curtainRebootMessage' role='status' style='color:#c1d5e5'></p></section>"
"<p>Update online directly from Oracle. No BIN download or file upload required.</p>"
"<button onclick='checkUpdate()'>Check for updates</button>"
"<button id='install' onclick='installUpdate()' disabled>Install verified update and restart</button>"
"<label><input type='checkbox' id='otaAuto' onchange='setAutoUpdate(this.checked)'> Automatically install newer signed firmware</label>"
"<p id='autoState' role='status'>Reading signed OTA preference...</p>"
"<p id='result' role='status'>Manual signed check and recovery remain available.</p>"
"<details><summary>Manual recovery (backup method)</summary>"
"<p><b>Use the runtime-only BIN, not a 4 MB full-flash image.</b></p>"
"<button onclick='go()'>Open manual firmware upload mode</button></details>"
"<p id='state'></p><p><a href='/settings/nano'>Nano settings</a> &nbsp; <a href='/setup?edit=1'>Edit settings</a></p>"
"<small>The Nano reboots into its original updater. If your home connection drops, "
"join Jason-Home-2-Setup Wi-Fi and open http://192.168.4.1/firmware .</small>"
"<script>async function go(){const s=document.getElementById('state');s.textContent='Selecting factory updater...';"
"try{const r=await fetch('/firmware/recovery',{method:'POST'});if(!r.ok)throw Error(await r.text());"
"s.textContent='Restarting to factory upload mode. Reconnect to http://192.168.4.1/firmware or use the home IP /firmware.';"
"}catch(e){s.textContent=e.message}}"
"const result=document.getElementById('result'),btn=document.getElementById('install');"
"async function refreshAuto(){try{const r=await fetch('/api/status',{cache:'no-store'});const d=await r.json();document.getElementById('otaAuto').checked=d.signedAutoUpdate===true;document.getElementById('autoState').textContent=d.signedAutoUpdate?'Automatic signed updates ON':'Automatic signed updates OFF';}catch(e){document.getElementById('autoState').textContent='Cannot read update setting';}}"
"async function setAutoUpdate(enabled){try{const r=await fetch('/api/firmware/auto',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'enabled='+(enabled?1:0)});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.message||'Save failed');}catch(e){result.textContent=e.message;}await refreshAuto();}"
"async function checkUpdate(){btn.disabled=true;result.textContent='Checking signed firmware via Oracle...';"
"try{const r=await fetch('/api/firmware/check',{cache:'no-store'}),d=await r.json();"
"if(!r.ok||!d.available)throw Error(d.message||'No newer signed update is available');"
"btn.disabled=false;btn.textContent='Install '+d.version+' and restart';"
"result.textContent='Verified signed update '+d.version+' is available. No files needed.';"
"}catch(e){result.textContent=e.message;}}"
"async function installUpdate(){if(btn.disabled)return;"
"if(!confirm('Install newer signed firmware from Oracle and restart the Nano now?'))return;"
"btn.disabled=true;result.textContent='Checking signature and scheduling permanent updater...';"
"try{const r=await fetch('/api/firmware/install',{method:'POST'}),d=await r.json();"
"if(!r.ok||!d.ok)throw Error(d.message||'Installation could not be scheduled');"
"result.textContent='Verified update '+d.version+' queued. The Nano will download, verify SHA-256, and reboot; reconnect here after restart.';"
"}catch(e){result.textContent=e.message;}}"
"async function curtainReboot(){"
" if(!confirm('Restart SmartDawn curtain only? Bluetooth will disconnect temporarily; the Nano remains running.'))return;"
" const b=document.getElementById('curtainRebootFirmware'),o=document.getElementById('curtainRebootMessage');"
" b.disabled=true;o.textContent='Sending SmartDawn reboot command...';"
" try{"
"  const r=await fetch('/api/ble/local',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:'curtainReboot'})});"
"  const d=await r.json();"
"  if(!r.ok||!d.ok||!d.gattAccepted)throw Error(d.message||'Controller reboot GATT request not accepted');"
"  o.textContent='Controller reboot command accepted. Bluetooth reconnection may take a moment; actual restart not yet verified.';"
" }catch(e){o.textContent=e.message;}"
" setTimeout(()=>{b.disabled=false},60000);"
"}"
"refreshAuto();checkUpdate();</script></body></html>";

// User-requested local-controller access policy: no client IP, subnet,
// LAN-origin, or host restrictions. The Setup AP still has its WPA2 password.
// NOTE: keep this controller's port 80 off public WAN port forwards.
static bool local_only(httpd_req_t *r){
    (void)r;
    return true;
}
static esp_err_t send_json(httpd_req_t *r,cJSON *o){
    if(!o)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"No memory");
    char *p=cJSON_PrintUnformatted(o);cJSON_Delete(o);
    if(!p)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"No memory");
    httpd_resp_set_type(r,"application/json");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    esp_err_t e=httpd_resp_send(r,p,HTTPD_RESP_USE_STRLEN);
    free(p);return e;
}
static esp_err_t denied(httpd_req_t *r){
    return httpd_resp_send_err(r,HTTPD_403_FORBIDDEN,"Only private LAN or Setup Wi-Fi may manage the Nano");
}
static esp_err_t health_get(httpd_req_t *r){
    cJSON *o=cJSON_CreateObject();
    cJSON_AddBoolToObject(o,"ok",true);
    cJSON_AddStringToObject(o,"version","1.1.77-native-upload-flow");
    cJSON_AddBoolToObject(o,"webRecoveryAvailable",true);
    return send_json(r,o);
}
// Factory image downloads must never block the Nano's single HTTP task.
// Use a bounded, one-at-a-time authenticated TLS worker with a WebP cache.
static SemaphoreHandle_t preview_lock=NULL;
static uint8_t *preview_image=NULL;
static size_t preview_length=0;
static int preview_effect=-1,preview_failed_effect=-1;
static int64_t preview_failed_us=0;
static bool preview_fetching=false;
static void preview_fetch_task(void *arg){
    const uint8_t effect=(uint8_t)((uintptr_t)arg-1U);
    uint8_t *incoming=NULL;size_t n=0;
    const bool ok=jh2_bridge_factory_preview(effect,&incoming,&n);
    if(preview_lock&&xSemaphoreTake(preview_lock,portMAX_DELAY)==pdTRUE){
        if(ok&&incoming){
            free(preview_image);preview_image=incoming;preview_length=n;
            preview_effect=(int)effect;incoming=NULL;preview_failed_effect=-1;
        }else{
            preview_failed_effect=(int)effect;preview_failed_us=esp_timer_get_time();
        }
        preview_fetching=false;
        xSemaphoreGive(preview_lock);
    }
    free(incoming);
    vTaskDelete(NULL);
}
static esp_err_t factory_preview_get(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    char query[48]={0},value[5]={0};
    if(httpd_req_get_url_query_str(r,query,sizeof(query))!=ESP_OK||
       httpd_query_key_value(query,"effect",value,sizeof(value))!=ESP_OK||
       !value[0])return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Effect required");
    for(const char *p=value;*p;p++)
        if(!isdigit((unsigned char)*p))
            return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid effect");
    const long effect=strtol(value,NULL,10);
    if(effect<0||effect>87)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid effect");
    if(!preview_lock||xSemaphoreTake(preview_lock,pdMS_TO_TICKS(80))!=pdTRUE)
        return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Preview cache unavailable");
    if(preview_effect==(int)effect&&preview_image&&preview_length){
        httpd_resp_set_type(r,"image/webp");
        httpd_resp_set_hdr(r,"Cache-Control","private, max-age=600");
        const esp_err_t result=httpd_resp_send(r,(const char *)preview_image,(ssize_t)preview_length);
        xSemaphoreGive(preview_lock);
        return result;
    }
    const int64_t t=esp_timer_get_time();
    if(!preview_fetching&&(preview_failed_effect!=(int)effect||
                           t-preview_failed_us>12000000LL)){
        preview_fetching=true;
        if(xTaskCreate(preview_fetch_task,"jh2-thumb",8192,
                       (void *)(uintptr_t)((unsigned)effect+1U),
                       tskIDLE_PRIORITY+1,NULL)!=pdPASS){
            preview_fetching=false;preview_failed_effect=(int)effect;preview_failed_us=t;
        }
    }
    xSemaphoreGive(preview_lock);
    httpd_resp_set_status(r,"202 Accepted");
    httpd_resp_set_type(r,"text/plain");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    return httpd_resp_sendstr(r,"Factory preview loading");
}
static esp_err_t status_get(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    cJSON *o=cJSON_CreateObject();
    cJSON_AddBoolToObject(o,"ok",true);
    cJSON_AddStringToObject(o,"version","1.1.73-native-upload-flow");
    cJSON_AddBoolToObject(o,"webRecoveryAvailable",true);
    cJSON_AddBoolToObject(o,"oracleConfigured",creds_ready);
    cJSON_AddBoolToObject(o,"oracleRunning",jh2_bridge_ready());
    cJSON_AddBoolToObject(o,"storageReady",fs_ready);
    cJSON_AddBoolToObject(o,"setupAP",ap_enabled);
    cJSON_AddBoolToObject(o,"wifi",net_event && (xEventGroupGetBits(net_event)&WEB_WIFI_READY));
    cJSON_AddBoolToObject(o,"signedAutoUpdate",jh2_bridge_auto_update_enabled());
    cJSON *curtain=cJSON_AddObjectToObject(o,"curtain");
    jh2_ble_status(curtain);
    jh2_ble_playback_status(o);
    return send_json(r,o);
}
// On-device manual BLE controls. Restrict target playback to a controller-
// reported slot matching 83928; never accept arbitrary CID or an unverified slot.
static bool form_value(const char *form,const char *field,char *out,size_t cap);
static esp_err_t ble_control_post(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    cJSON *o=cJSON_CreateObject();if(!o)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Memory");
    bool ok=false;const char *message="Unknown command";
    if(strcmp(r->uri,"/api/ble/connect")==0){
        ok=jh2_ble_scan_start();
        message=ok?"BLE connection requested; scanning for previously selected SmartDawn controller":"BLE reconnect unavailable";
    }else if(strcmp(r->uri,"/api/ble/scan")==0){
        ok=jh2_ble_scan_start();message=ok?"BLE scan requested; refresh device list":"Scan unavailable";
    }else if(strcmp(r->uri,"/api/ble/disconnect")==0){
        ok=jh2_ble_disconnect();message=ok?"BLE disconnected; scanning paused":"Disconnect request failed";
    }else if(strcmp(r->uri,"/api/bridge/resume")==0){
        if(!jh2_bridge_ready())jh2_bridge_start();
        ok=jh2_bridge_ready();message=ok?"Oracle receiver active; commands arrive by sync":"Oracle receiver unavailable; review saved key";
    }else if(strcmp(r->uri,"/api/ble/select")==0 || strcmp(r->uri,"/api/ble/play928")==0){
        if(r->content_len<=0 || r->content_len>100){cJSON_Delete(o);return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid request body");}
        char form[101]={0};int used=0;
        while(used<r->content_len){
            int n=httpd_req_recv(r,form+used,r->content_len-used);
            if(n<=0){cJSON_Delete(o);return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Body unavailable");}
            used+=n;
        }
        if(strcmp(r->uri,"/api/ble/select")==0){
            char mac[18]={0};
            ok=form_value(form,"mac",mac,sizeof(mac))&&jh2_ble_select_target(mac);
            message=ok?"Controller selected; reconnecting and retaining MAC":"MAC not found in BLE scan";
        }else{
            char num[8]={0};char *end=NULL;
            bool parsed=form_value(form,"slot",num,sizeof(num))&&num[0];
            unsigned long slot=parsed?strtoul(num,&end,10):999;
            ok=parsed&&end&&*end==0&&slot<=255&&jh2_ble_target_slot_seen((uint16_t)slot)&&
               jh2_native_play(83928,(uint32_t)slot);
            message=ok?"Playback requested for observed CID 83928 slot":"Slot unverified or BLE command failed";
        }
    }
    cJSON_AddBoolToObject(o,"ok",ok);
    cJSON_AddStringToObject(o,"message",message);
    return send_json(r,o);
}

// The local Nano console deliberately bypasses Oracle to separate a Nano/BLE
// defect from APK -> Oracle and Oracle -> Nano transport failures.
static uint32_t local_trace_serial=0;
static int64_t last_curtain_reboot_us=0;
static esp_err_t local_probe_post(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    if(r->content_len<=0 || r->content_len>256)
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid local command size");
    char form[257]={0};int used=0;
    while(used<r->content_len){
        int n=httpd_req_recv(r,form+used,r->content_len-used);
        if(n<=0)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Request body interrupted");
        used+=n;
    }
    char action[24]={0},num[24]={0},extra[24]={0};
    if(!form_value(form,"action",action,sizeof(action)))
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Missing action");
    cJSON *before=cJSON_CreateObject();
    jh2_ble_status(before);
    const cJSON *was=cJSON_GetObjectItemCaseSensitive(before,"connected");
    const bool connected=cJSON_IsTrue(was);
    const cJSON *oldn=cJSON_GetObjectItemCaseSensitive(before,"nativeNotificationsSeen");
    const double notice_before=cJSON_IsNumber(oldn)?oldn->valuedouble:0;
    bool ok=false,transmitted=false;const char *message="Unsupported local action";
    if(strcmp(action,"status")==0){ok=true;message="Nano diagnostics read";}
    else if(!connected){message="Nano Bluetooth disconnected: no GATT command sent";}
    else if(strcmp(action,"read205")==0 || strcmp(action,"read167")==0 ||
            strcmp(action,"read2904")==0){
        const int opcode=strcmp(action,"read205")==0?205:
                         strcmp(action,"read167")==0?167:2904;
        // Reuse the known factory manufacturer framing and shared command counter.
        // The previous fixed 0x0a 0x01 packet had mismatched sequence/tx fields.
        ok=jh2_native_read((uint16_t)opcode);
        transmitted=ok;message=ok?"Read-only GATT request accepted":"GATT read request rejected";
        if(ok && opcode==2904)vTaskDelay(pdMS_TO_TICKS(700));
    }else if(strcmp(action,"powerOn")==0||strcmp(action,"powerOff")==0){
        ok=jh2_native_power(strcmp(action,"powerOn")==0);transmitted=ok;
        message=ok?"Power GATT command accepted":"Power GATT command failed";
    }else if(strcmp(action,"brightness")==0 || strcmp(action,"speed")==0 ||
             strcmp(action,"layout")==0 || strcmp(action,"effect")==0){
        bool parsed=form_value(form,"value",num,sizeof(num));
        char *end=NULL;long value=parsed?strtol(num,&end,10):-1;
        parsed=parsed&&num[0]&&end&&*end==0;
        if(parsed && strcmp(action,"brightness")==0 && value>=0&&value<=100)
            ok=jh2_native_brightness((int)value);
        else if(parsed && strcmp(action,"speed")==0 && value>=0&&value<=255)
            ok=jh2_native_speed((int)value);
        else if(parsed && strcmp(action,"layout")==0 && (value==0||value==4||value==5||value==6))
            ok=jh2_native_layout((int)value);
        else if(parsed && strcmp(action,"effect")==0 && value>=0&&value<=87)
            ok=jh2_native_effect((int)value);
        transmitted=ok;message=ok?"Controller GATT command accepted":"Invalid value or GATT failure";
    }else if(strcmp(action,"nativePlay")==0){
        bool parsed=form_value(form,"slot",num,sizeof(num));
        char *end=NULL;long slot=parsed?strtol(num,&end,10):-1;
        if(parsed&&num[0]&&end&&*end==0&&slot>=0&&slot<=255 &&
           jh2_ble_target_slot_seen((uint16_t)slot))
            ok=jh2_native_play(83928,(uint32_t)slot);
        transmitted=ok;message=ok?"Verified CID 83928 playback requested":"Slot not verified or GATT failed";
    }else if(strcmp(action,"curtainReboot")==0){
        const int64_t time_us=esp_timer_get_time();
        // Reboot SmartDawn (APK M_REBOOT 2599), not the ESP32-C6;
        // prevent accidental repeated commands while controller reconnects.
        if(last_curtain_reboot_us>0 &&
           time_us-last_curtain_reboot_us<60000000LL){
            message="Curtain Reboot already sent; wait 60 seconds before retry";
        }else{
            ok=jh2_native_curtain_reboot();
            transmitted=ok;
            if(ok)last_curtain_reboot_us=time_us;
            message=ok?"SmartDawn reboot opcode 2599 accepted by GATT; reboot not yet confirmed":
                       "SmartDawn GATT reboot request rejected";
        }
    }else if(strcmp(action,"solid")==0){
        bool hasColor=form_value(form,"rgb",num,sizeof(num));
        bool hasBrightness=form_value(form,"value",extra,sizeof(extra));
        char *end=NULL;unsigned long rgb=hasColor?strtoul(num,&end,16):0;
        bool valid=hasColor&&num[0]&&end&&*end==0&&rgb<=0xffffff;
        char *be=NULL;long level=hasBrightness?strtol(extra,&be,10):100;
        valid=valid&&(!hasBrightness||(extra[0]&&be&&*be==0))&&level>=0&&level<=100;
        if(valid)ok=jh2_native_solid((uint32_t)rgb,(int)level);
        transmitted=ok;message=ok?"Solid GATT command accepted":"Invalid color or GATT failure";
    }else if(strcmp(action,"sequenceStop")==0){
        jh2_native_sequence_stop();ok=true;
        message="Native sequence stopped locally";
    }else if(strcmp(action,"upload")==0 || strcmp(action,"erase")==0 ||
             strcmp(action,"restore")==0){
        message="Blocked: CID 83928 has historical duplicate owners; require backed-up original and verified unique target before modifying";
    }
    cJSON *after=cJSON_CreateObject();
    jh2_ble_status(after);
    const cJSON *next=cJSON_GetObjectItemCaseSensitive(after,"nativeNotificationsSeen");
    double notice_after=cJSON_IsNumber(next)?next->valuedouble:0;
    cJSON *out=cJSON_CreateObject();
    cJSON_AddBoolToObject(out,"ok",ok);
    cJSON_AddStringToObject(out,"message",message);
    char trace[48];snprintf(trace,sizeof(trace),"nano-%lu-%lu",
        (unsigned long)(esp_timer_get_time()/1000000),(unsigned long)++local_trace_serial);
    cJSON_AddStringToObject(out,"traceId",trace);
    cJSON_AddStringToObject(out,"source","nano-local");
    cJSON_AddStringToObject(out,"action",action);
    cJSON_AddBoolToObject(out,"nanoReceived",true);
    cJSON_AddBoolToObject(out,"bleConnected",connected);
    cJSON_AddBoolToObject(out,"gattAccepted",transmitted);
    cJSON_AddNumberToObject(out,"notificationBefore",notice_before);
    cJSON_AddNumberToObject(out,"notificationAfter",notice_after);
    cJSON_AddNumberToObject(out,"notificationDelta",notice_after-notice_before);
    cJSON_AddStringToObject(out,"physicalPlayback","unverified");
    cJSON_AddItemToObject(out,"curtain",after);
    cJSON_Delete(before);
    return send_json(r,out);
}

// Distinguish Nano STA traffic from the dedicated setup/recovery AP when
// both interfaces remain enabled after Wi-Fi recovers. Never redirect AP
// visitors, even when the STA happens to be connected.
static bool request_on_sta(httpd_req_t *r){
    if(!ap_enabled)return true;
    struct sockaddr_storage local={0};
    socklen_t length=sizeof(local);
    if(getsockname(httpd_req_to_sockfd(r),(struct sockaddr *)&local,&length)!=0
       ||local.ss_family!=AF_INET)return false;
    const uint32_t ip=ntohl(((const struct sockaddr_in *)&local)->sin_addr.s_addr);
    return ip!=0xc0a80401UL; // ESP32 default setup AP 192.168.4.1
}
static esp_err_t html_get(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    const bool firmware=strstr(r->uri,"firmware")||strstr(r->uri,"recovery");
    const bool explicit_setup=strncmp(r->uri,"/setup",6)==0;
    char query[80]={0},edit[8]={0};
    const bool editing=explicit_setup &&
        httpd_req_get_url_query_str(r,query,sizeof(query))==ESP_OK &&
        httpd_query_key_value(query,"edit",edit,sizeof(edit))==ESP_OK &&
        strcmp(edit,"1")==0;
    const bool programmed=saved_ssid[0]!=0;
    // After initial Wi-Fi configuration, / is the dashboard. Visiting the
    // old /setup bookmark also returns home unless the user requests editing.
    if(explicit_setup && programmed && creds_ready && !editing){
        httpd_resp_set_status(r,"302 Found");
        httpd_resp_set_hdr(r,"Location","/");
        return httpd_resp_send(r,NULL,0);
    }
    // / remains a local, no-credential entry point into the HTTPS Oracle UI.
    // Never redirect while the setup AP is serving recovery or Wi-Fi is offline.
    // /settings/nano, /status, /setup?edit=1, and /firmware remain local.
    if(strcmp(r->uri,"/")==0 && programmed && creds_ready &&
       saved_oracle_endpoint[0] && request_on_sta(r) &&
       net_event && (xEventGroupGetBits(net_event)&WEB_WIFI_READY)){
        char target[184];
        size_t len=strlen(saved_oracle_endpoint);
        int n=snprintf(target,sizeof(target),"%s%s",saved_oracle_endpoint,
                       saved_oracle_endpoint[len-1]=='/'?"":"/");
        if(n>0 && n<(int)sizeof(target)){
            httpd_resp_set_status(r,"302 Found");
            httpd_resp_set_hdr(r,"Location",target);
            httpd_resp_set_hdr(r,"Cache-Control","no-store");
            return httpd_resp_send(r,NULL,0);
        }
    }
    const bool status_page=strcmp(r->uri,"/status")==0;
    const bool nano_settings=strcmp(r->uri,"/settings/nano")==0;
    const char *page=nano_settings?HOME_HTML:status_page?STATUS_HTML:firmware?FIRMWARE_HTML:
        (explicit_setup||(!programmed)?SETUP_HTML:HOME_HTML);
    httpd_resp_set_type(r,"text/html; charset=utf-8");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    return httpd_resp_send(r,page,HTTPD_RESP_USE_STRLEN);
}
static bool unescape(const char *start,size_t n,char *out,size_t cap){
    size_t w=0;
    for(size_t i=0;i<n;i++){
        unsigned char c=(unsigned char)start[i];
        if(c=='+')c=' ';
        else if(c=='%'){
            if(i+2>=n||!isxdigit((unsigned char)start[i+1])||!isxdigit((unsigned char)start[i+2]))return false;
            char h[3]={start[i+1],start[i+2],0};
            c=(unsigned char)strtoul(h,NULL,16);i+=2;
        }
        if(!c||c<32||w+1>=cap)return false;
        out[w++]=(char)c;
    }
    out[w]=0;return true;
}
static bool form_value(const char *form,const char *field,char *out,size_t cap){
    size_t wanted=strlen(field);
    const char *p=form;
    while(p && *p){
        const char *next=strchr(p,'&');
        size_t n=next?(size_t)(next-p):strlen(p);
        if(n>wanted&&strncmp(p,field,wanted)==0&&p[wanted]=='=')
            return unescape(p+wanted+1,n-wanted-1,out,cap);
        p=next?next+1:NULL;
    }
    return false;
}
static bool valid_https(const char *s){
    if(strncmp(s,"https://",8)!=0||strlen(s)>175)return false;
    for(const char *p=s;*p;p++)if((unsigned char)*p<33||*p=='#'||*p=='?'||*p=='@')return false;
    return true;
}
static bool valid_hex(const char *s){
    if(strlen(s)!=64)return false;
    for(const char *p=s;*p;p++)if(!isxdigit((unsigned char)*p))return false;
    return true;
}
static bool mount_store(void){
    const esp_vfs_littlefs_conf_t c={.base_path="/littlefs",.partition_label="storage",
                                     .format_if_mount_failed=false,.dont_mount=false};
    esp_err_t err=esp_vfs_littlefs_register(&c);
    if(err==ESP_OK||err==ESP_ERR_INVALID_STATE)return true;
    // A brand-new FULL FLASH leaves the new 192KB storage partition erased.
    // Format ONLY if the entire partition is demonstrably blank; never wipe
    // damaged or previously populated settings after a routine OTA update.
    const esp_partition_t *p=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,ESP_PARTITION_SUBTYPE_DATA_SPIFFS,"storage");
    if(p&&p->size==0x2f000){
        uint8_t sample[256];bool blank=true;
        for(size_t offset=0;offset<p->size;offset+=sizeof(sample)){
            if(esp_partition_read(p,offset,sample,sizeof(sample))!=ESP_OK){blank=false;break;}
            for(size_t i=0;i<sizeof(sample);i++)if(sample[i]!=0xff){blank=false;break;}
            if(!blank)break;
        }
        if(blank){
            const esp_vfs_littlefs_conf_t first={.base_path="/littlefs",.partition_label="storage",
                .format_if_mount_failed=true,.dont_mount=false};
            ESP_LOGW(TAG,"Formatting ONLY confirmed blank new 188KB LittleFS partition");
            err=esp_vfs_littlefs_register(&first);
            if(err==ESP_OK||err==ESP_ERR_INVALID_STATE)return true;
        }
    }
    ESP_LOGE(TAG,"Existing settings storage unavailable; no automatic format (%s)",esp_err_to_name(err));
    return false;
}
static cJSON *old_config(void){
    FILE *f=fopen("/littlefs/secrets.json","rb");if(!f)return cJSON_CreateObject();
    char buf[2049]={0};
    size_t n=fread(buf,1,sizeof(buf)-1,f);fclose(f);
    if(n==0||n>=sizeof(buf)-1)return cJSON_CreateObject();
    cJSON *o=cJSON_Parse(buf);
    if(!cJSON_IsObject(o)){cJSON_Delete(o);return cJSON_CreateObject();}
    return o;
}
static void setstr(cJSON *o,const char *key,const char *value){
    cJSON_DeleteItemFromObjectCaseSensitive(o,key);
    cJSON_AddStringToObject(o,key,value);
}
static void read_saved(void){
    if(!fs_ready)return;
    cJSON *d=old_config();
    const cJSON *v=cJSON_GetObjectItemCaseSensitive(d,"ssid");
    if(cJSON_IsString(v)&&v->valuestring&&strlen(v->valuestring)<=32)
        strcpy(saved_ssid,v->valuestring);
    v=cJSON_GetObjectItemCaseSensitive(d,"wifiPassword");
    if(cJSON_IsString(v)&&v->valuestring&&strlen(v->valuestring)<=64)
        strcpy(saved_pass,v->valuestring);
    const cJSON *e=cJSON_GetObjectItemCaseSensitive(d,"oracleEndpoint");
    const cJSON *t=cJSON_GetObjectItemCaseSensitive(d,"oracleBridgeToken");
    const cJSON *b=cJSON_GetObjectItemCaseSensitive(d,"oracleBridgeId");
    creds_ready=cJSON_IsString(e)&&e->valuestring&&valid_https(e->valuestring) &&
        cJSON_IsString(t)&&t->valuestring&&valid_hex(t->valuestring) &&
        cJSON_IsString(b)&&b->valuestring&&strlen(b->valuestring)>0;
    saved_oracle_endpoint[0]=0;
    if(creds_ready)snprintf(saved_oracle_endpoint,sizeof(saved_oracle_endpoint),"%s",e->valuestring);
    cJSON_Delete(d);
    if(!saved_ssid[0]){
        nvs_handle_t n;
        if(nvs_open("jh2-network",NVS_READONLY,&n)==ESP_OK){
            size_t size=sizeof(saved_ssid);
            if(nvs_get_str(n,"ssid",saved_ssid,&size)!=ESP_OK)saved_ssid[0]=0;
            size=sizeof(saved_pass);
            if(nvs_get_str(n,"password",saved_pass,&size)!=ESP_OK)saved_pass[0]=0;
            nvs_close(n);
        }
    }
}
static bool save_config(cJSON *d){
    if(!fs_ready)return false;
    char *json=cJSON_PrintUnformatted(d);if(!json)return false;
    FILE *f=fopen("/littlefs/secrets.json.tmp","wb");
    if(!f){free(json);return false;}
    size_t n=strlen(json),written=fwrite(json,1,n,f);
    int flush_rc=fflush(f);
    int close_rc=fclose(f);
    bool ok=written==n && flush_rc==0 && close_rc==0;
    free(json);
    if(!ok){unlink("/littlefs/secrets.json.tmp");return false;}
    if(rename("/littlefs/secrets.json.tmp","/littlefs/secrets.json")!=0){
        unlink("/littlefs/secrets.json.tmp");return false;
    }
    return true;
}
/*
 * User-specific full-flash credentials live in a separate 4KB provisioning
 * flash sector. Source and public CI carry NO Wi-Fi or Oracle secrets.
 * It is only read on first boot when /littlefs/secrets.json is missing.
 * Routine OTA never overwrites this sector or existing settings.
 * Wire format: 8-byte magic, LE payload bytes, SHA256, UTF-8 JSON.
 */
static bool import_factory_provision(void){
    if(!fs_ready)return false;
    struct stat existing={0};
    if(stat("/littlefs/secrets.json",&existing)==0 && existing.st_size>0)
        return true;
    const esp_partition_t *p=esp_partition_find_first(ESP_PARTITION_TYPE_DATA,0x40,"provision");
    if(!p||p->address!=0x3ff000||p->size!=0x1000){
        ESP_LOGW(TAG,"Factory provisioning partition unavailable");return false;
    }
    uint8_t header[44]={0};
    if(esp_partition_read(p,0,header,sizeof(header))!=ESP_OK ||
       memcmp(header,"JH2CFG01",8)!=0)return false;
    uint32_t bytes=(uint32_t)header[8]|((uint32_t)header[9]<<8)|
                   ((uint32_t)header[10]<<16)|((uint32_t)header[11]<<24);
    if(bytes<64||bytes>0x1000-sizeof(header)-1)return false;
    char *json=calloc((size_t)bytes+1,1);
    if(!json)return false;
    if(esp_partition_read(p,sizeof(header),json,bytes)!=ESP_OK){free(json);return false;}
    uint8_t sha[32]={0};
    if(mbedtls_sha256((const unsigned char *)json,bytes,sha,0)!=0 ||
       memcmp(sha,header+12,32)!=0){free(json);return false;}
    cJSON *cfg=cJSON_Parse(json);free(json);
    if(!cJSON_IsObject(cfg)){cJSON_Delete(cfg);return false;}
    const char *names[]={"ssid","wifiPassword","oracleEndpoint","oracleBridgeId","oracleBridgeToken"};
    const unsigned limits[]={32,63,175,63,64};
    bool ok=true;
    for(unsigned i=0;i<5;i++){
        cJSON *item=cJSON_GetObjectItemCaseSensitive(cfg,names[i]);
        if(!cJSON_IsString(item)||!item->valuestring||!item->valuestring[0]||
           strlen(item->valuestring)>limits[i]){ok=false;break;}
    }
    if(ok){
        const char *token=cJSON_GetObjectItemCaseSensitive(cfg,"oracleBridgeToken")->valuestring;
        const char *endpoint=cJSON_GetObjectItemCaseSensitive(cfg,"oracleEndpoint")->valuestring;
        ok=valid_hex(token)&&valid_https(endpoint);
    }
    if(ok)ok=save_config(cfg);
    if(ok){
        nvs_handle_t n=0;
        if(nvs_open("jh2-network",NVS_READWRITE,&n)==ESP_OK){
            const char *ssid=cJSON_GetObjectItemCaseSensitive(cfg,"ssid")->valuestring;
            const char *password=cJSON_GetObjectItemCaseSensitive(cfg,"wifiPassword")->valuestring;
            esp_err_t rc=nvs_set_str(n,"ssid",ssid);
            if(rc==ESP_OK)rc=nvs_set_str(n,"password",password);
            if(rc==ESP_OK)rc=nvs_commit(n);
            nvs_close(n);
            ok=rc==ESP_OK;
        }
    }
    cJSON_Delete(cfg);
    ESP_LOGW(TAG,ok?"Saved embedded Nano provisioning (values hidden)":
                  "Embedded provisioning could not be restored");
    return ok;
}
static esp_err_t setup_post(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    if(r->content_len<=0||r->content_len>1600)
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid setup length");
    char form[1601]={0};int consumed=0;
    while(consumed<r->content_len){
        int n=httpd_req_recv(r,form+consumed,r->content_len-consumed);
        if(n<=0)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Setup body unavailable");
        consumed+=n;
    }
    char ssid[33]={0},pass[65]={0},endpoint[176]={0},token[65]={0},bridge[64]={0};
    if(!form_value(form,"ssid",ssid,sizeof(ssid)) ||
       !form_value(form,"password",pass,sizeof(pass)) ||
       !form_value(form,"oracleEndpoint",endpoint,sizeof(endpoint)) ||
       !form_value(form,"oracleBridgeId",bridge,sizeof(bridge)) ||
       !form_value(form,"oracleBridgeToken",token,sizeof(token)))
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid characters or oversized field");
    if(strlen(pass)>63)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Wi-Fi password exceeds 63 characters");
    if(endpoint[0]&&!valid_https(endpoint))
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Oracle endpoint must use HTTPS");
    if(token[0]&&!valid_hex(token))
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Oracle bridge token must be 64 hex characters");
    cJSON *d=old_config();
    if(!d)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Insufficient memory");
    if(ssid[0])setstr(d,"ssid",ssid);
    if(pass[0])setstr(d,"wifiPassword",pass);
    if(endpoint[0])setstr(d,"oracleEndpoint",endpoint);
    if(bridge[0])setstr(d,"oracleBridgeId",bridge);
    if(token[0])setstr(d,"oracleBridgeToken",token);
    bool ok=save_config(d);
    cJSON_Delete(d);
    if(!ok)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,
        "Settings storage unavailable; do not erase partitions. Use /firmware to restore.");
    if(ssid[0]||pass[0]){
        nvs_handle_t n;
        if(nvs_open("jh2-network",NVS_READWRITE,&n)==ESP_OK){
            if(ssid[0])nvs_set_str(n,"ssid",ssid);
            if(pass[0])nvs_set_str(n,"password",pass);
            nvs_commit(n);nvs_close(n);
        }
    }
    const char *result="<html><body><h2>Settings saved.</h2><p>Restarting. Rejoin home Wi-Fi or Jason-Home-2-Setup.</p><p><a href='/'>Home</a></p></body></html>";
    httpd_resp_set_type(r,"text/html; charset=utf-8");
    httpd_resp_send(r,result,HTTPD_RESP_USE_STRLEN);
    vTaskDelay(pdMS_TO_TICKS(450));esp_restart();return ESP_OK;
}
static esp_err_t recovery_post(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    if(!httpd_req_get_hdr_value_len(r,"Origin")){ /* Local app and same-origin browser allowed */ }
    const char *message="{\"ok\":true,\"rebootingToFactoryUploader\":true}";
    httpd_resp_set_type(r,"application/json");
    httpd_resp_send(r,message,HTTPD_RESP_USE_STRLEN);
    // Must enter the ORIGINAL factory updater, not write runtime in-place.
    if(!jh2_enter_local_recovery())ESP_LOGE(TAG,"Cannot select factory updater");
    return ESP_OK;
}
// Deliberately manual signed OTA. Oracle hosts the signed manifest and
// permanent factory updater does the actual download + SHA-256 verification.
static esp_err_t firmware_auto_post(httpd_req_t *req){
    if(!local_only(req))return denied(req);
    if(req->content_len!=9)return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid setting");
    char form[12]={0};
    if(httpd_req_recv(req,form,req->content_len)!=req->content_len)
        return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid form");
    bool enabled=false;
    if(strcmp(form,"enabled=1")==0)enabled=true;
    else if(strcmp(form,"enabled=0")!=0)
        return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid setting");
    bool ok=jh2_bridge_set_auto_update_enabled(enabled);
    cJSON *out=cJSON_CreateObject();
    cJSON_AddBoolToObject(out,"ok",ok);
    cJSON_AddBoolToObject(out,"enabled",jh2_bridge_auto_update_enabled());
    cJSON_AddStringToObject(out,"message",ok?"Signed OTA preference saved":"OTA preference save failed");
    return send_json(req,out);
}
static esp_err_t firmware_check(httpd_req_t *req){
    char version[32]={0},error[170]={0};
    bool available=jh2_bridge_signed_firmware(false,version,sizeof(version),error,sizeof(error));
    cJSON *j=cJSON_CreateObject();
    cJSON_AddBoolToObject(j,"ok",true);
    cJSON_AddBoolToObject(j,"available",available);
    if(available)cJSON_AddStringToObject(j,"version",version);
    else cJSON_AddStringToObject(j,"message",error[0]?error:"No update available");
    return send_json(req,j);
}
static void update_reboot(void *unused){
    (void)unused;
    vTaskDelay(pdMS_TO_TICKS(1400));
    esp_restart();
    vTaskDelete(NULL);
}
static esp_err_t firmware_install(httpd_req_t *req){
    char version[32]={0},error[170]={0};
    const bool ready=jh2_bridge_signed_firmware(true,version,sizeof(version),error,sizeof(error));
    if(!ready){
        cJSON *j=cJSON_CreateObject();
        cJSON_AddBoolToObject(j,"ok",false);
        cJSON_AddStringToObject(j,"message",error[0]?error:"Signed update unavailable");
        return send_json(req,j);
    }
    if(xTaskCreate(update_reboot,"jh2-signed-ota-boot",3072,NULL,3,NULL)!=pdPASS){
        // NVS already has pending signed update, and factory is selected.
        // Return an explicit failure rather than claiming a restart.
        cJSON *j=cJSON_CreateObject();
        cJSON_AddBoolToObject(j,"ok",false);
        cJSON_AddStringToObject(j,"message","Signed update queued; restart the Nano to install");
        return send_json(req,j);
    }
    cJSON *j=cJSON_CreateObject();
    cJSON_AddBoolToObject(j,"ok",true);
    cJSON_AddStringToObject(j,"version",version);
    cJSON_AddStringToObject(j,"message","Factory updater selected; rebooting to install");
    return send_json(req,j);
}
static void update_time(void){
    if(sntp_started)return;
    sntp_started=true;
    sntp_setoperatingmode(SNTP_OPMODE_POLL);
    sntp_setservername(0,"pool.ntp.org");
    sntp_init();
}
static void event_handler(void *arg,esp_event_base_t event,int32_t id,void *data){
    (void)arg;(void)data;
    if(event==WIFI_EVENT&&id==WIFI_EVENT_STA_START)esp_wifi_connect();
    if(event==WIFI_EVENT&&id==WIFI_EVENT_STA_DISCONNECTED){
        if(net_event)xEventGroupClearBits(net_event,WEB_WIFI_READY);
        wifi_down_since=esp_timer_get_time();
        esp_wifi_connect();
    }
    if(event==IP_EVENT&&id==IP_EVENT_STA_GOT_IP){
        if(net_event)xEventGroupSetBits(net_event,WEB_WIFI_READY);
        wifi_down_since=0;update_time();
        if(!mdns_started){
            if(mdns_init()==ESP_OK){
                mdns_hostname_set("jason-home-2");
                mdns_instance_name_set("Jason Home 2 NanoC6");
                mdns_service_add(NULL,"_http","_tcp",80,NULL,0);
                mdns_started=true;
            }
        }
    }
}
static bool start_setup_ap(void){
    if(!ap_netif)ap_netif=esp_netif_create_default_wifi_ap();
    if(!ap_netif)return false;
    wifi_config_t cfg={0};
    strcpy((char*)cfg.ap.ssid,"Jason-Home-2-Setup");
    strcpy((char*)cfg.ap.password,"JasonHome2");
    cfg.ap.ssid_len=strlen((char*)cfg.ap.ssid);
    cfg.ap.channel=6;cfg.ap.max_connection=4;cfg.ap.authmode=WIFI_AUTH_WPA2_PSK;
    cfg.ap.pmf_cfg.required=false;
    esp_wifi_set_mode(saved_ssid[0]?WIFI_MODE_APSTA:WIFI_MODE_AP);
    if(esp_wifi_set_config(WIFI_IF_AP,&cfg)!=ESP_OK)return false;
    ap_enabled=true;
    ESP_LOGW(TAG,"Recovery AP enabled: Jason-Home-2-Setup, browse http://192.168.4.1/firmware");
    return true;
}
static void fallback_task(void *arg){
    (void)arg;
    while(true){
        vTaskDelay(pdMS_TO_TICKS(12000));
        if(saved_ssid[0]&&net_event&&!(xEventGroupGetBits(net_event)&WEB_WIFI_READY)){
            if(!wifi_down_since)wifi_down_since=esp_timer_get_time();
            if(esp_timer_get_time()-wifi_down_since>40000000LL && !ap_enabled)
                start_setup_ap();
        }
    }
}
static bool start_net(void){
    net_event=xEventGroupCreate();if(!net_event)return false;
    if(esp_netif_init()!=ESP_OK || esp_event_loop_create_default()!=ESP_OK)return false;
    sta_netif=esp_netif_create_default_wifi_sta();
    if(!sta_netif)return false;
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    if(esp_wifi_init(&init)!=ESP_OK)return false;
    esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,event_handler,NULL);
    esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,event_handler,NULL);
    if(!saved_ssid[0]){
        if(!start_setup_ap())return false;
    }else{
        wifi_config_t sta={0};
        strcpy((char*)sta.sta.ssid,saved_ssid);
        strcpy((char*)sta.sta.password,saved_pass);
        sta.sta.threshold.authmode=WIFI_AUTH_OPEN;
        sta.sta.pmf_cfg.capable=true;
        if(esp_wifi_set_mode(WIFI_MODE_STA)!=ESP_OK ||
           esp_wifi_set_config(WIFI_IF_STA,&sta)!=ESP_OK)return false;
    }
    if(esp_wifi_start()!=ESP_OK)return false;
    esp_wifi_set_ps(WIFI_PS_NONE);
    if(xTaskCreate(fallback_task,"jh2-wifi-fallback",3200,NULL,2,NULL)!=pdPASS)
        ESP_LOGW(TAG,"Wi-Fi fallback task not available");
    return true;
}
EventGroupHandle_t jh2_web_wifi_group(void){return net_event;}
bool jh2_web_has_oracle_credentials(void){return creds_ready;}
void jh2_web_request_recovery(void){recovery_request=true;}
bool jh2_web_recovery_requested(void){return recovery_request;}
bool jh2_web_start(void){
    fs_ready=mount_store();import_factory_provision();read_saved();
    if(!start_net()){ESP_LOGE(TAG,"Wi-Fi/AP setup failed");return false;}
    if(!preview_lock)preview_lock=xSemaphoreCreateMutex();
    if(!preview_lock){ESP_LOGE(TAG,"Preview mutex allocation failed");return false;}
    httpd_config_t cfg=HTTPD_DEFAULT_CONFIG();
    cfg.server_port=80;
    cfg.max_uri_handlers=24;
    cfg.stack_size=7168;
    cfg.lru_purge_enable=true;
    if(httpd_start(&web_server,&cfg)!=ESP_OK)return false;
    const httpd_uri_t routes[]={
        {.uri="/",.method=HTTP_GET,.handler=html_get},
        {.uri="/setup",.method=HTTP_GET,.handler=html_get},
        {.uri="/settings/nano",.method=HTTP_GET,.handler=html_get},
        {.uri="/setup",.method=HTTP_POST,.handler=setup_post},
        {.uri="/firmware",.method=HTTP_GET,.handler=html_get},
        {.uri="/recovery",.method=HTTP_GET,.handler=html_get},
        {.uri="/firmware/recovery",.method=HTTP_POST,.handler=recovery_post},
        {.uri="/api/firmware/check",.method=HTTP_GET,.handler=firmware_check},
        {.uri="/api/firmware/auto",.method=HTTP_POST,.handler=firmware_auto_post},
        {.uri="/api/firmware/install",.method=HTTP_POST,.handler=firmware_install},
        {.uri="/jason-home-2/firmware",.method=HTTP_GET,.handler=html_get},
        {.uri="/jason-home-2/recovery",.method=HTTP_GET,.handler=html_get},
        {.uri="/api/factory-preview",.method=HTTP_GET,.handler=factory_preview_get},
        {.uri="/status",.method=HTTP_GET,.handler=html_get},
        {.uri="/api/status",.method=HTTP_GET,.handler=status_get},
        {.uri="/api/curtain/status",.method=HTTP_GET,.handler=status_get},
        {.uri="/api/health",.method=HTTP_GET,.handler=health_get},
        {.uri="/api/ble/connect",.method=HTTP_POST,.handler=ble_control_post},
        {.uri="/api/ble/scan",.method=HTTP_POST,.handler=ble_control_post},
        {.uri="/api/ble/select",.method=HTTP_POST,.handler=ble_control_post},
        {.uri="/api/ble/disconnect",.method=HTTP_POST,.handler=ble_control_post},
        {.uri="/api/ble/play928",.method=HTTP_POST,.handler=ble_control_post},
        {.uri="/api/bridge/resume",.method=HTTP_POST,.handler=ble_control_post},
        {.uri="/api/ble/local",.method=HTTP_POST,.handler=local_probe_post}
    };
    for(size_t i=0;i<sizeof(routes)/sizeof(routes[0]);i++)
        if(httpd_register_uri_handler(web_server,&routes[i])!=ESP_OK)return false;
    ESP_LOGI(TAG,"Persistent HTTP web recovery ready on port 80, AP fallback enabled");
    return true;
}
