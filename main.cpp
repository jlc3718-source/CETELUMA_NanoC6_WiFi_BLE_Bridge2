#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEClient.h>
#include <BLERemoteService.h>
#include <BLERemoteCharacteristic.h>

// CETELUMA Light Bridge for M5Stack NanoC6 / ESP32-C6
// Local-only Wi-Fi -> BLE bridge for LEDBLE/LEDCAR/LEDDMX controllers.
// FFE0 service, FFE1 write characteristic.

static constexpr uint8_t PIN_SETUP_BUTTON = 9;       // NanoC6 button, active LOW
static constexpr char AP_SSID[] = "CETELUMA-Bridge-Setup";
static constexpr char AP_PASS[] = "ceteluma24";
static constexpr char HOSTNAME[] = "ceteluma";
static constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000;
static constexpr uint32_t BLE_RESCAN_MS = 15000;
static constexpr uint32_t BLE_MIN_WRITE_GAP_MS = 50;

WebServer server(80);
DNSServer dnsServer;
Preferences prefs;

BLEClient *bleClient = nullptr;
BLERemoteCharacteristic *bleWriteChar = nullptr;
BLEUUID serviceUUID("0000ffe0-0000-1000-8000-00805f9b34fb");
BLEUUID charUUID("0000ffe1-0000-1000-8000-00805f9b34fb");

String targetBleName;
String targetBleAddress;
uint8_t targetBleAddressType = 0xFF;
bool bleConnected = false;
bool setupApActive = false;
bool setupApForced = false;
bool pendingWifiReconnect = false;
bool pendingWifiForget = false;
uint32_t pendingWifiActionAt = 0;
uint32_t lastBleScanAt = 0;
uint32_t lastBleWriteAt = 0;
uint32_t buttonDownAt = 0;
bool buttonLongHandled = false;

uint8_t currentR = 255, currentG = 255, currentB = 255;
uint8_t currentBrightness = 70;
uint8_t currentSpeed = 50;
uint8_t currentEffect = 0; // 0 solid, 1 fade, 2 pulse, 3 rainbow, 4 chase, 5 twinkle, 6 meteor, 7 candy, 8 fire, 9 water
bool currentPower = true;
bool stateDirty = false;

struct SavedPreset {
  bool used = false;
  String name;
  uint8_t r = 255, g = 255, b = 255;
  uint8_t brightness = 70;
  uint8_t effect = 0;
  uint8_t speed = 50;
};
static constexpr int MAX_CUSTOM_PRESETS = 10;
SavedPreset customPresets[MAX_CUSTOM_PRESETS];

static const char INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>CETELUMA Light Bridge</title>
<style>
:root{--bg:#08131f;--bg2:#0b1927;--card:#0f2031;--card2:#12273a;--line:#263b4f;--text:#f7fbff;--muted:#a9bdd0;--blue:#1684ff;--blue2:#036ee9;--green:#08ad58;--danger:#df4b56}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#112c47 0,#08131f 34%,#06101a 100%);color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;min-height:100vh}
.wrap{max-width:1500px;margin:auto;padding:26px 32px 20px}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:22px}.brand{display:flex;gap:16px;align-items:center}.logo{font-size:48px;color:var(--blue);line-height:1}.brand h1{font-size:48px;line-height:.95;margin:0;letter-spacing:1px}.brand small{display:block;color:#91b9ea;font-size:23px;margin-top:8px}.righthead{text-align:right}.conn{display:inline-flex;align-items:center;gap:9px;background:#079249;border:1px solid #14bd65;padding:12px 22px;border-radius:18px;font-size:18px}.dot{width:14px;height:14px;background:#d7ffe6;border-radius:50%}.settingsBtn{margin-left:12px}.tag{color:#9bb9dc;font-size:19px;margin-top:10px}
.grid4{display:grid;grid-template-columns:1fr 1.35fr 1fr 1fr;gap:14px}.card{background:linear-gradient(145deg,var(--card),#0b1a29);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 12px 30px #0003}.topcard{height:195px;display:flex;flex-direction:column;align-items:center;justify-content:center}.title{font-weight:750;font-size:21px;margin-bottom:12px}.power{height:88px;width:88px;border:0;border-radius:50%;background:linear-gradient(145deg,#2997ff,#056be8);color:white;font-size:46px;cursor:pointer;box-shadow:0 7px 20px #087cff55}.power.off{background:#35465a}.label{font-weight:700;font-size:19px;margin-top:7px}.slider{width:100%;accent-color:var(--blue)}input[type=range]{height:35px}.value{font-size:22px;margin-top:2px}.colorPick{width:105px;height:105px;padding:0;border:0;border-radius:50%;overflow:hidden;background:conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red);cursor:pointer}.colorPick::-webkit-color-swatch-wrapper{padding:0}.colorPick::-webkit-color-swatch{border:5px solid #fff;border-radius:50%}.effectSelect,.select,.pass{width:100%;padding:14px 15px;border-radius:10px;border:1px solid #334a60;background:#132437;color:white;font-size:17px}
.section{margin-top:14px}.sectionHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:13px}.sectionHead h2{font-size:22px;margin:0}.sectionHead p{color:var(--muted);margin:3px 0 0}.btn{border:1px solid #35516d;background:#263a50;color:#fff;padding:12px 18px;border-radius:10px;font-size:16px;cursor:pointer}.btn.primary{background:linear-gradient(145deg,#218eff,#0873eb);border-color:#248fff}.btn.danger{background:#4a2630;border-color:#8b3d4b}.presetGrid{display:grid;grid-template-columns:repeat(10,minmax(88px,1fr));gap:10px}.preset{position:relative;background:#142537;border:1px solid #344b61;border-radius:11px;padding:10px 6px 8px;text-align:center;cursor:pointer;min-height:91px}.swatch{width:47px;height:47px;border-radius:50%;margin:0 auto 7px;border:1px solid #ffffff66;box-shadow:inset 0 0 0 1px #0003}.presetName{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.deletePreset{display:none;position:absolute;right:4px;top:4px;width:25px;height:25px;border:0;border-radius:50%;background:var(--danger);color:white;cursor:pointer}.editMode .custom .deletePreset{display:block}
.patternGrid{display:grid;grid-template-columns:repeat(10,1fr);gap:9px}.pattern{min-height:76px;border:1px solid #324b62;background:#142537;color:#fff;border-radius:10px;cursor:pointer;padding:8px}.pattern.active{border:2px solid var(--blue);background:#123154}.patternIcon{font-size:28px;display:block;margin-bottom:3px}.speedrow{display:grid;grid-template-columns:95px 1fr 90px;gap:12px;align-items:center;margin-top:14px}.wifiGrid{display:grid;grid-template-columns:1fr 370px;gap:14px}.wifiRow{margin:9px 0}.wifiRow label{display:block;margin-bottom:6px;color:#dce9f4}.wifiButtons{display:flex;gap:10px;margin-top:12px}.wifiButtons .btn{flex:1}.statusline{font-size:14px;color:var(--muted);margin-top:10px}.footer{display:flex;justify-content:space-between;color:#9db0c2;font-size:14px;padding:17px 3px 0}.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);opacity:0;background:#172b3e;border:1px solid #3e5b74;padding:12px 18px;border-radius:10px;transition:.2s;z-index:50}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
@media(max-width:1050px){.presetGrid{grid-template-columns:repeat(5,1fr)}.patternGrid{grid-template-columns:repeat(5,1fr)}.grid4{grid-template-columns:1fr 1fr}.wifiGrid{grid-template-columns:1fr}.brand h1{font-size:37px}.logo{font-size:40px}}
@media(max-width:650px){.wrap{padding:17px 13px}.header{align-items:center}.brand h1{font-size:28px}.brand small{font-size:16px}.logo{font-size:32px}.tag{display:none}.righthead .settingsBtn{display:none}.conn{font-size:14px;padding:8px 11px}.grid4{grid-template-columns:1fr 1fr;gap:9px}.topcard{height:160px;padding:12px}.presetGrid{grid-template-columns:repeat(4,1fr)}.patternGrid{grid-template-columns:repeat(3,1fr)}.sectionHead{align-items:flex-start;flex-direction:column}.sectionHead>div:last-child{display:flex;width:100%;gap:7px}.sectionHead .btn{flex:1;padding:10px 8px}.speedrow{grid-template-columns:70px 1fr 58px}.footer{font-size:12px}.wifiButtons{flex-direction:column}.colorPick{width:90px;height:90px}}
</style>
</head>
<body>
<div class="wrap">
  <header class="header">
    <div class="brand"><div class="logo">◖◉◗</div><div><h1>CETELUMA</h1><small>Light Bridge</small></div></div>
    <div class="righthead"><span id="connBadge" class="conn"><span class="dot"></span><span id="connText">Connecting…</span></span><button class="btn settingsBtn" onclick="document.getElementById('wifi').scrollIntoView({behavior:'smooth'})">⚙ Settings</button><div class="tag">Simple Control. Bright Possibilities.</div></div>
  </header>

  <div class="grid4">
    <div class="card topcard"><div class="title">Power</div><button id="powerBtn" class="power" onclick="togglePower()">⏻</button><div id="powerLabel" class="label">ON</div></div>
    <div class="card topcard"><div class="title">Brightness</div><div style="font-size:34px">☀</div><input id="brightness" class="slider" type="range" min="1" max="100" value="70"><div id="brightnessVal" class="value">70%</div></div>
    <div class="card topcard"><div class="title">Color</div><input id="color" class="colorPick" type="color" value="#ffffff"></div>
    <div class="card topcard"><div class="title">Effect</div><select id="effectSelect" class="effectSelect"><option value="solid">〰 Solid</option><option value="fade">〰 Fade</option><option value="pulse">◉ Pulse</option><option value="rainbow">🌈 Rainbow</option><option value="chase">••• Chase</option><option value="twinkle">✦ Twinkle</option><option value="meteor">☄ Meteor</option><option value="candy">🍬 Candy Cane</option><option value="fire">🔥 Fire</option><option value="water">≋ Water</option></select></div>
  </div>

  <section id="presetsSection" class="card section">
    <div class="sectionHead"><div><h2>★ &nbsp;Presets</h2><p>Tap a preset to apply</p></div><div><button class="btn primary" onclick="saveCurrentPreset()">＋ Save Current as Preset</button><button id="editBtn" class="btn" onclick="toggleEdit()">✎ Edit Presets</button></div></div>
    <div id="presetGrid" class="presetGrid"></div>
  </section>

  <section class="card section">
    <div class="sectionHead"><div><h2>〰 &nbsp;Patterns / Effects</h2><p>Select a pattern and adjust speed if needed</p></div></div>
    <div id="patternGrid" class="patternGrid"></div>
    <div class="speedrow"><b>Speed</b><input id="speed" class="slider" type="range" min="1" max="100" value="50"><span id="speedVal">Normal</span></div>
  </section>

  <section id="wifi" class="card section">
    <div class="sectionHead"><div><h2>⌁ &nbsp;Wi‑Fi</h2><p>Change your Wi‑Fi without reflashing</p></div><button class="btn" onclick="scanWifi()">Scan Networks</button></div>
    <div class="wifiGrid"><div>
      <div class="wifiRow"><label>Network (SSID)</label><select id="ssid" class="select"><option value="">Scan for networks…</option></select></div>
      <div class="wifiRow"><label>Password</label><input id="wifiPass" class="pass" type="password" placeholder="Wi‑Fi password"></div>
      <div class="wifiButtons"><button class="btn primary" onclick="saveWifi()">Save & Connect</button><button class="btn" onclick="forgetWifi()">Forget Wi‑Fi</button></div>
      <div id="wifiStatus" class="statusline"></div>
    </div><div>
      <div class="wifiRow"><label>Bridge / BLE status</label><div id="bleStatus" class="select" style="min-height:51px">Searching for CETELUMA controller…</div></div>
      <div class="wifiButtons"><button class="btn" onclick="rescanBle()">Rescan Lights</button><button class="btn" onclick="restartBridge()">Restart Bridge</button></div>
      <div class="statusline">Recovery: hold the NanoC6 button for 5 seconds to start <b>CETELUMA-Bridge-Setup</b>.</div>
    </div></div>
  </section>

  <footer class="footer"><span>CETELUMA Light Bridge</span><span>v1.0 &nbsp;|&nbsp; NanoC6</span></footer>
</div>
<div id="toast" class="toast"></div>
<script>
const effects=[
 {id:'solid',icon:'〰',name:'Solid'},{id:'fade',icon:'〰',name:'Fade'},{id:'pulse',icon:'◉',name:'Pulse'},
 {id:'rainbow',icon:'🌈',name:'Rainbow'},{id:'chase',icon:'•••',name:'Chase'},{id:'twinkle',icon:'✦',name:'Twinkle'},
 {id:'meteor',icon:'☄',name:'Meteor'},{id:'candy',icon:'🍬',name:'Candy Cane'},{id:'fire',icon:'🔥',name:'Fire'},{id:'water',icon:'≋',name:'Water'}];
const defaults=[
 {n:'Warm White',c:'#ffdca0',fx:'solid'},{n:'Cool White',c:'#eef8ff',fx:'solid'},{n:'Red',c:'#ff2020',fx:'solid'},
 {n:'Orange',c:'#ff8a19',fx:'solid'},{n:'Yellow',c:'#fff02b',fx:'solid'},{n:'Green',c:'#1cf04b',fx:'solid'},
 {n:'Cyan',c:'#24dce7',fx:'solid'},{n:'Blue',c:'#1856ff',fx:'solid'},{n:'Purple',c:'#a33af0',fx:'solid'},{n:'Pink',c:'#ff2ccd',fx:'solid'},
 {n:'Sunset',c:'#ff5b32',fx:'fade'},{n:'Ocean',c:'#159fff',fx:'water'},{n:'Forest',c:'#19bd54',fx:'fade'},{n:'Party',c:'#ff26c8',fx:'rainbow'},
 {n:'Christmas',c:'#ff2020',fx:'candy'},{n:'Halloween',c:'#ff7b00',fx:'pulse'},{n:'Valentine',c:'#ff4b91',fx:'fade'},
 {n:'Patriotic',c:'#1a58ff',fx:'twinkle'},{n:'Relax',c:'#805cff',fx:'fade'}];
let power=true, editMode=false, custom=[];
const $=id=>document.getElementById(id);
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800)}
async function post(path,data={}){try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});const tx=await r.text();if(!r.ok) throw new Error(tx);return tx}catch(e){toast('Bridge not responding');throw e}}
function hexRgb(h){return {r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)}}
function rgbHex(r,g,b){return '#'+[r,g,b].map(v=>Number(v).toString(16).padStart(2,'0')).join('')}
function effectIndex(id){return effects.findIndex(x=>x.id===id)}
function setEffectUI(id){$('effectSelect').value=id;document.querySelectorAll('.pattern').forEach(x=>x.classList.toggle('active',x.dataset.id===id))}
function applyEffect(id){setEffectUI(id);post('/api/light/effect',{effect:effectIndex(id)}).then(()=>toast(id==='solid'?'Solid color':'Pattern: '+effects[effectIndex(id)].name))}
function buildPatterns(){const g=$('patternGrid');g.innerHTML='';effects.forEach(e=>{const b=document.createElement('button');b.className='pattern'+(e.id==='solid'?' active':'');b.dataset.id=e.id;b.innerHTML=`<span class="patternIcon">${e.icon}</span>${e.name}`;b.onclick=()=>applyEffect(e.id);g.appendChild(b)})}
function presetTile(p,isCustom=false){const d=document.createElement('div');d.className='preset '+(isCustom?'custom':'');let bg=p.c||rgbHex(p.r,p.g,p.b);let fancy=p.fx&&p.fx!=='solid'?`conic-gradient(${bg},#22dfff,#843cff,#ff4d32,${bg})`:bg;d.innerHTML=`<button class="deletePreset">×</button><div class="swatch" style="background:${fancy}"></div><div class="presetName"></div>`;d.querySelector('.presetName').textContent=p.n||p.name;d.onclick=e=>{if(e.target.classList.contains('deletePreset'))return;applyPreset(p)};if(isCustom)d.querySelector('.deletePreset').onclick=e=>{e.stopPropagation();deletePreset(p.slot)};return d}
function renderPresets(){const g=$('presetGrid');g.innerHTML='';defaults.forEach(p=>g.appendChild(presetTile(p)));custom.forEach(p=>g.appendChild(presetTile(p,true)));$('presetsSection').classList.toggle('editMode',editMode)}
function applyPreset(p){let c=p.c||rgbHex(p.r,p.g,p.b),rgb=hexRgb(c),br=p.brightness??70,sp=p.speed??50,fx=p.fx||effects[p.effect??0].id;$('color').value=c;$('brightness').value=br;$('brightnessVal').textContent=br+'%';$('speed').value=sp;updateSpeedLabel(sp);setEffectUI(fx);post('/api/light/preset',{r:rgb.r,g:rgb.g,b:rgb.b,brightness:br,speed:sp,effect:effectIndex(fx)}).then(()=>toast('Preset applied'))}
async function loadPresets(){try{custom=await (await fetch('/api/presets')).json();renderPresets()}catch(e){renderPresets()}}
async function saveCurrentPreset(){const name=prompt('Name this preset:','Custom '+(custom.length+1));if(!name)return;const rgb=hexRgb($('color').value);const fx=$('effectSelect').value;try{await post('/api/preset/save',{name,r:rgb.r,g:rgb.g,b:rgb.b,brightness:$('brightness').value,speed:$('speed').value,effect:effectIndex(fx)});await loadPresets();toast('Preset saved')}catch(e){}}
async function deletePreset(slot){if(!confirm('Delete this preset?'))return;try{await post('/api/preset/delete',{slot});await loadPresets();toast('Preset deleted')}catch(e){}}
function toggleEdit(){editMode=!editMode;$('editBtn').textContent=editMode?'✓ Done':'✎ Edit Presets';renderPresets()}
async function togglePower(){power=!power;$('powerBtn').classList.toggle('off',!power);$('powerLabel').textContent=power?'ON':'OFF';try{await post('/api/light/power',{on:power?1:0})}catch(e){}}
let colorTimer; $('color').oninput=()=>{clearTimeout(colorTimer);colorTimer=setTimeout(()=>{const c=hexRgb($('color').value);setEffectUI('solid');post('/api/light/color',c)},80)};
let brTimer;$('brightness').oninput=()=>{$('brightnessVal').textContent=$('brightness').value+'%';clearTimeout(brTimer);brTimer=setTimeout(()=>post('/api/light/brightness',{value:$('brightness').value}),80)};
function updateSpeedLabel(v){$('speedVal').textContent=v<34?'Slow':v>67?'Fast':'Normal'}
let spTimer;$('speed').oninput=()=>{updateSpeedLabel(+$('speed').value);clearTimeout(spTimer);spTimer=setTimeout(()=>post('/api/light/speed',{value:$('speed').value}),80)};
$('effectSelect').onchange=()=>applyEffect($('effectSelect').value);
async function scanWifi(){toast('Scanning Wi‑Fi…');try{const a=await (await fetch('/api/wifi/scan')).json();const s=$('ssid');const old=s.value;s.innerHTML='';a.forEach(n=>{const o=document.createElement('option');o.value=n.ssid;o.textContent=`${n.ssid}  (${n.rssi} dBm${n.open?' · open':''})`;s.appendChild(o)});if([...s.options].some(o=>o.value===old))s.value=old;if(!a.length)s.innerHTML='<option>No networks found</option>';toast('Wi‑Fi scan complete')}catch(e){toast('Wi‑Fi scan failed')}}
async function saveWifi(){const ssid=$('ssid').value,pass=$('wifiPass').value;if(!ssid){toast('Choose a Wi‑Fi network');return}try{await post('/api/wifi/save',{ssid,pass});toast('Saved — bridge is reconnecting')}catch(e){}}
async function forgetWifi(){if(!confirm('Forget saved Wi‑Fi and return to setup mode?'))return;try{await post('/api/wifi/forget');toast('Wi‑Fi forgotten')}catch(e){}}
async function rescanBle(){try{await post('/api/ble/rescan');toast('Searching for lights…')}catch(e){}}
async function restartBridge(){try{await post('/api/restart');toast('Restarting…')}catch(e){}}
async function status(){try{const s=await (await fetch('/api/status',{cache:'no-store'})).json();$('connText').textContent=s.ble?'Connected':(s.wifi?'Wi‑Fi Connected':'Setup Mode');$('bleStatus').textContent=s.ble?`${s.bleName} · Connected`:s.bleName?`${s.bleName} · Reconnecting…`:'Searching for LED controller…';$('wifiStatus').textContent=s.wifi?`Connected to ${s.ssid} · ${s.ip} · ${s.rssi} dBm`:`Setup network active · open http://192.168.4.1`;if(s.ssid){let sel=$('ssid');if(![...sel.options].some(o=>o.value===s.ssid)){let o=document.createElement('option');o.value=s.ssid;o.textContent=s.ssid;sel.prepend(o)}sel.value=s.ssid}}catch(e){} }
buildPatterns();renderPresets();loadPresets();scanWifi();status();setInterval(status,4000);updateSpeedLabel(50);
</script>
</body></html>
)HTML";

static String jsonEscape(const String &s) {
  String out; out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c == '\n') out += "\\n";
    else if ((uint8_t)c >= 0x20) out += c;
  }
  return out;
}

static uint8_t clampByteArg(const String &v, int lo = 0, int hi = 255) {
  int n = v.toInt();
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return (uint8_t)n;
}

static bool isDialectB() {
  return targetBleName.startsWith("LEDCAR-01") || targetBleName.startsWith("LEDCAR-02") || targetBleName.startsWith("LEDDMX");
}

static bool isShiftedDialectB() {
  return targetBleName.startsWith("LEDCAR-02") || targetBleName.startsWith("LEDDMX-02") || targetBleName.startsWith("LEDDMX-04");
}

static bool ensureBleConnected();

static bool writeFrame(uint8_t frame[9]) {
  if (!ensureBleConnected() || bleWriteChar == nullptr) return false;
  uint32_t now = millis();
  uint32_t elapsed = now - lastBleWriteAt;
  if (elapsed < BLE_MIN_WRITE_GAP_MS) delay(BLE_MIN_WRITE_GAP_MS - elapsed);
  bool ok = bleWriteChar->writeValue(frame, 9, false);
  lastBleWriteAt = millis();
  if (!ok) bleConnected = false;
  return ok;
}

static bool sendPower(bool on) {
  uint8_t f[9];
  if (!isDialectB()) {
    uint8_t x[9] = {0x7E,0xFF,0x04,(uint8_t)(on?0x01:0x00),0xFF,0xFF,0xFF,0xFF,0xEF}; memcpy(f,x,9);
  } else if (isShiftedDialectB()) {
    uint8_t x[9] = {0x7B,0x04,(uint8_t)(on?0x01:0x00),0xFF,0xFF,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  } else {
    uint8_t x[9] = {0x7B,0xFF,0x04,(uint8_t)(on?0x01:0x00),0xFF,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  }
  currentPower = on; stateDirty = true;
  return writeFrame(f);
}

static bool sendColor(uint8_t r, uint8_t g, uint8_t b) {
  uint8_t f[9];
  if (!isDialectB()) {
    uint8_t x[9] = {0x7E,0xFF,0x05,0x03,r,g,b,0xFF,0xEF}; memcpy(f,x,9);
  } else if (isShiftedDialectB()) {
    uint8_t x[9] = {0x7B,0x07,r,g,b,0x00,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  } else {
    uint8_t x[9] = {0x7B,0xFF,0x07,r,g,b,0x00,0xFF,0xBF}; memcpy(f,x,9);
  }
  currentR=r; currentG=g; currentB=b; currentEffect=0; stateDirty = true;
  return writeFrame(f);
}

static bool sendBrightness(uint8_t b) {
  b = constrain(b, 1, 100);
  uint8_t f[9];
  if (!isDialectB()) {
    uint8_t x[9] = {0x7E,0xFF,0x01,b,0x00,0xFF,0xFF,0xFF,0xEF}; memcpy(f,x,9);
  } else if (isShiftedDialectB()) {
    uint8_t x[9] = {0x7B,0x01,b,0x01,0xFF,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  } else {
    uint8_t fine = (uint8_t)((b * 32) / 100);
    uint8_t x[9] = {0x7B,0xFF,0x01,fine,b,0x01,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  }
  currentBrightness=b; stateDirty = true;
  return writeFrame(f);
}

static bool sendSpeed(uint8_t s) {
  s = constrain(s, 1, 100);
  uint8_t f[9];
  if (!isDialectB()) {
    uint8_t x[9] = {0x7E,0xFF,0x02,s,0x00,0xFF,0xFF,0xFF,0xEF}; memcpy(f,x,9);
  } else if (isShiftedDialectB()) {
    uint8_t x[9] = {0x7B,0x02,s,0x00,0xFF,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  } else {
    uint8_t x[9] = {0x7B,0xFF,0x02,s,0x00,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  }
  currentSpeed=s; stateDirty = true;
  return writeFrame(f);
}

static uint8_t effectModeForController(uint8_t effect) {
  // UI: 1 Fade, 2 Pulse, 3 Rainbow, 4 Chase, 5 Twinkle, 6 Meteor, 7 Candy Cane, 8 Fire, 9 Water.
  // Dialect A offers a smaller effect table, so a few names map to the closest built-in effect.
  static const uint8_t mapA[10] = {0,0x8A,0x9D,0x8A,0x88,0x95,0x95,0x92,0x8B,0x8D};
  // Dialect B RGBIC effect IDs are from the controller's built-in table.
  static const uint8_t mapB[10] = {0,81,81,3,39,78,23,75,1,4};
  if (effect > 9) effect = 0;
  return isDialectB() ? mapB[effect] : mapA[effect];
}

static bool sendEffect(uint8_t effect) {
  if (effect == 0) return sendColor(currentR,currentG,currentB);
  uint8_t mode = effectModeForController(effect);
  uint8_t f[9];
  if (!isDialectB()) {
    uint8_t x[9] = {0x7E,0xFF,0x03,mode,0x03,0xFF,0xFF,0xFF,0xEF}; memcpy(f,x,9);
  } else if (isShiftedDialectB()) {
    uint8_t x[9] = {0x7B,0x03,mode,0xFF,0xFF,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  } else {
    uint8_t x[9] = {0x7B,0xFF,0x03,mode,0xFF,0xFF,0xFF,0xFF,0xBF}; memcpy(f,x,9);
  }
  currentEffect=effect; stateDirty = true;
  return writeFrame(f);
}

class BridgeClientCallbacks : public BLEClientCallbacks {
  void onConnect(BLEClient *pclient) override { bleConnected = true; }
  void onDisconnect(BLEClient *pclient) override { bleConnected = false; bleWriteChar = nullptr; }
};

static bool compatibleBleName(const String &n) {
  return n.startsWith("LEDBLE") || n.startsWith("LEDCAR") || n.startsWith("LEDDMX");
}

static bool scanAndPickBle() {
  BLEScan *scan = BLEDevice::getScan();
  if (!scan) return false;
  scan->setActiveScan(true);
  scan->setInterval(100);
  scan->setWindow(80);
  BLEScanResults *results = scan->start(4, false);
  if (!results) return false;

  int bestRssi = -1000;
  String bestName, bestAddr;
  uint8_t bestType = 0xFF;
  for (int i=0; i<results->getCount(); ++i) {
    BLEAdvertisedDevice dev = results->getDevice(i);
    String name = dev.getName();
    if (!compatibleBleName(name)) continue;
    int rssi = dev.getRSSI();
    if (rssi > bestRssi) {
      bestRssi = rssi;
      bestName = name;
      bestAddr = dev.getAddress().toString();
      bestType = dev.getAddressType();
    }
  }
  scan->clearResults();
  if (bestAddr.length() == 0) return false;
  targetBleName = bestName;
  targetBleAddress = bestAddr;
  targetBleAddressType = bestType;
  prefs.putString("bleName", targetBleName);
  prefs.putString("bleAddr", targetBleAddress);
  prefs.putUChar("bleType", targetBleAddressType);
  return true;
}

static bool connectBleTarget() {
  if (targetBleAddress.length() == 0) return false;
  if (bleClient && bleClient->isConnected()) bleClient->disconnect();
  if (bleClient) { delete bleClient; bleClient = nullptr; }
  bleWriteChar = nullptr;

  bleClient = BLEDevice::createClient();
  if (!bleClient) return false;
  static BridgeClientCallbacks bridgeCallbacks;
  bleClient->setClientCallbacks(&bridgeCallbacks);
  BLEAddress addr(targetBleAddress, targetBleAddressType);
  if (!bleClient->connect(addr, targetBleAddressType, 10000)) {
    bleConnected = false;
    return false;
  }
  BLERemoteService *svc = bleClient->getService(serviceUUID);
  if (!svc) { bleClient->disconnect(); bleConnected=false; return false; }
  bleWriteChar = svc->getCharacteristic(charUUID);
  if (!bleWriteChar || !(bleWriteChar->canWrite() || bleWriteChar->canWriteNoResponse())) {
    bleClient->disconnect(); bleWriteChar=nullptr; bleConnected=false; return false;
  }
  bleConnected = true;
  // Restore last visible state once connected.
  sendPower(currentPower);
  if (currentEffect == 0) sendColor(currentR,currentG,currentB); else sendEffect(currentEffect);
  sendBrightness(currentBrightness);
  sendSpeed(currentSpeed);
  return true;
}

static bool ensureBleConnected() {
  if (bleClient && bleClient->isConnected() && bleWriteChar) { bleConnected=true; return true; }
  bleConnected=false;
  if (targetBleAddress.length() && connectBleTarget()) return true;
  if (scanAndPickBle()) return connectBleTarget();
  return false;
}

static void startSetupAP(bool forced = false) {
  setupApForced = forced;
  WiFi.mode(WIFI_AP_STA);
  if (!setupApActive) {
    WiFi.softAP(AP_SSID, AP_PASS);
    delay(100);
    dnsServer.start(53, "*", WiFi.softAPIP());
    setupApActive = true;
  }
}

static void stopSetupAPIfAllowed() {
  if (setupApActive && !setupApForced && WiFi.status() == WL_CONNECTED) {
    dnsServer.stop();
    WiFi.softAPdisconnect(true);
    setupApActive=false;
    WiFi.mode(WIFI_STA);
  }
}

static bool connectSavedWifi() {
  String ssid = prefs.getString("ssid", "");
  String pass = prefs.getString("pass", "");
  if (ssid.isEmpty()) { startSetupAP(false); return false; }
  WiFi.mode(setupApActive ? WIFI_AP_STA : WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis()-start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(150);
    server.handleClient();
    if (setupApActive) dnsServer.processNextRequest();
  }
  if (WiFi.status() == WL_CONNECTED) {
    if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", 80);
    stopSetupAPIfAllowed();
    return true;
  }
  startSetupAP(false);
  return false;
}

static void loadPresets() {
  for (int i=0;i<MAX_CUSTOM_PRESETS;++i) {
    String pfx = "p" + String(i);
    customPresets[i].used = prefs.getBool((pfx+"u").c_str(), false);
    if (!customPresets[i].used) continue;
    customPresets[i].name = prefs.getString((pfx+"n").c_str(), "Custom");
    customPresets[i].r = prefs.getUChar((pfx+"r").c_str(),255);
    customPresets[i].g = prefs.getUChar((pfx+"g").c_str(),255);
    customPresets[i].b = prefs.getUChar((pfx+"b").c_str(),255);
    customPresets[i].brightness = prefs.getUChar((pfx+"v").c_str(),70);
    customPresets[i].effect = prefs.getUChar((pfx+"e").c_str(),0);
    customPresets[i].speed = prefs.getUChar((pfx+"s").c_str(),50);
  }
}

static void persistPreset(int i) {
  String pfx="p"+String(i); SavedPreset &p=customPresets[i];
  prefs.putBool((pfx+"u").c_str(),p.used);
  if (!p.used) return;
  prefs.putString((pfx+"n").c_str(),p.name);
  prefs.putUChar((pfx+"r").c_str(),p.r); prefs.putUChar((pfx+"g").c_str(),p.g); prefs.putUChar((pfx+"b").c_str(),p.b);
  prefs.putUChar((pfx+"v").c_str(),p.brightness); prefs.putUChar((pfx+"e").c_str(),p.effect); prefs.putUChar((pfx+"s").c_str(),p.speed);
}

static void registerWebRoutes() {
  server.on("/", HTTP_GET, [](){ server.send_P(200,"text/html",INDEX_HTML); });
  server.on("/generate_204", HTTP_ANY, [](){ server.sendHeader("Location","http://192.168.4.1",true);server.send(302,"text/plain",""); });
  server.on("/hotspot-detect.html", HTTP_ANY, [](){ server.sendHeader("Location","http://192.168.4.1",true);server.send(302,"text/plain",""); });
  server.on("/connecttest.txt", HTTP_ANY, [](){ server.sendHeader("Location","http://192.168.4.1",true);server.send(302,"text/plain",""); });

  server.on("/api/status", HTTP_GET, [](){
    bool wifi=WiFi.status()==WL_CONNECTED;
    String j="{\"wifi\":"+String(wifi?"true":"false")+",\"ssid\":\""+jsonEscape(wifi?WiFi.SSID():String(""))+"\",\"ip\":\""+String(wifi?WiFi.localIP().toString():WiFi.softAPIP().toString())+"\",\"rssi\":"+String(wifi?WiFi.RSSI():0)+",\"ble\":"+String(bleConnected?"true":"false")+",\"bleName\":\""+jsonEscape(targetBleName)+"\",\"ap\":"+String(setupApActive?"true":"false")+"}";
    server.send(200,"application/json",j);
  });

  server.on("/api/wifi/scan", HTTP_GET, [](){
    int n=WiFi.scanNetworks(false,true);
    String j="[";
    for(int i=0;i<n;i++){
      if(i)j+=',';
      j+="{\"ssid\":\""+jsonEscape(WiFi.SSID(i))+"\",\"rssi\":"+String(WiFi.RSSI(i))+",\"open\":"+String(WiFi.encryptionType(i)==WIFI_AUTH_OPEN?"true":"false")+"}";
    }
    j+="]"; WiFi.scanDelete(); server.send(200,"application/json",j);
  });

  server.on("/api/wifi/save", HTTP_POST, [](){
    String ssid=server.arg("ssid"),pass=server.arg("pass");
    if(ssid.isEmpty()){server.send(400,"text/plain","SSID required");return;}
    String oldSsid=prefs.getString("ssid","");
    if(pass.isEmpty() && ssid==oldSsid) pass=prefs.getString("pass","");
    prefs.putString("ssid",ssid); prefs.putString("pass",pass);
    server.send(200,"text/plain","saved"); pendingWifiReconnect=true; pendingWifiActionAt=millis()+500;
  });
  server.on("/api/wifi/forget", HTTP_POST, [](){
    prefs.remove("ssid");prefs.remove("pass");server.send(200,"text/plain","forgotten");pendingWifiForget=true;pendingWifiActionAt=millis()+500;
  });

  server.on("/api/light/power", HTTP_POST, [](){ bool ok=sendPower(server.arg("on")=="1");server.send(ok?200:503,"text/plain",ok?"ok":"BLE controller unavailable"); });
  server.on("/api/light/color", HTTP_POST, [](){ uint8_t r=clampByteArg(server.arg("r")),g=clampByteArg(server.arg("g")),b=clampByteArg(server.arg("b"));bool ok=sendColor(r,g,b);server.send(ok?200:503,"text/plain",ok?"ok":"BLE controller unavailable"); });
  server.on("/api/light/brightness", HTTP_POST, [](){ bool ok=sendBrightness(clampByteArg(server.arg("value"),1,100));server.send(ok?200:503,"text/plain",ok?"ok":"BLE controller unavailable"); });
  server.on("/api/light/speed", HTTP_POST, [](){ bool ok=sendSpeed(clampByteArg(server.arg("value"),1,100));server.send(ok?200:503,"text/plain",ok?"ok":"BLE controller unavailable"); });
  server.on("/api/light/effect", HTTP_POST, [](){ bool ok=sendEffect(clampByteArg(server.arg("effect"),0,9));server.send(ok?200:503,"text/plain",ok?"ok":"BLE controller unavailable"); });
  server.on("/api/light/preset", HTTP_POST, [](){
    uint8_t r=clampByteArg(server.arg("r")),g=clampByteArg(server.arg("g")),b=clampByteArg(server.arg("b"));
    uint8_t br=clampByteArg(server.arg("brightness"),1,100),sp=clampByteArg(server.arg("speed"),1,100),fx=clampByteArg(server.arg("effect"),0,9);
    bool ok=sendPower(true); if(ok){ if(fx==0)ok=sendColor(r,g,b);else{currentR=r;currentG=g;currentB=b;ok=sendEffect(fx);} } if(ok)ok=sendBrightness(br); if(ok)ok=sendSpeed(sp);
    server.send(ok?200:503,"text/plain",ok?"ok":"BLE controller unavailable");
  });

  server.on("/api/presets", HTTP_GET, [](){
    String j="[";bool first=true;
    for(int i=0;i<MAX_CUSTOM_PRESETS;i++)if(customPresets[i].used){if(!first)j+=',';first=false;SavedPreset&p=customPresets[i];j+="{\"slot\":"+String(i)+",\"name\":\""+jsonEscape(p.name)+"\",\"r\":"+String(p.r)+",\"g\":"+String(p.g)+",\"b\":"+String(p.b)+",\"brightness\":"+String(p.brightness)+",\"effect\":"+String(p.effect)+",\"speed\":"+String(p.speed)+"}";}
    j+="]";server.send(200,"application/json",j);
  });
  server.on("/api/preset/save", HTTP_POST, [](){
    int slot=-1;for(int i=0;i<MAX_CUSTOM_PRESETS;i++)if(!customPresets[i].used){slot=i;break;} if(slot<0){server.send(409,"text/plain","Preset slots full; delete one first");return;}
    SavedPreset&p=customPresets[slot];p.used=true;p.name=server.arg("name");if(p.name.isEmpty())p.name="Custom "+String(slot+1);if(p.name.length()>24)p.name=p.name.substring(0,24);
    p.r=clampByteArg(server.arg("r"));p.g=clampByteArg(server.arg("g"));p.b=clampByteArg(server.arg("b"));p.brightness=clampByteArg(server.arg("brightness"),1,100);p.effect=clampByteArg(server.arg("effect"),0,9);p.speed=clampByteArg(server.arg("speed"),1,100);persistPreset(slot);server.send(200,"text/plain","saved");
  });
  server.on("/api/preset/delete", HTTP_POST, [](){int slot=server.arg("slot").toInt();if(slot<0||slot>=MAX_CUSTOM_PRESETS){server.send(400,"text/plain","bad slot");return;}customPresets[slot].used=false;customPresets[slot].name="";persistPreset(slot);server.send(200,"text/plain","deleted");});
  server.on("/api/ble/rescan", HTTP_POST, [](){targetBleAddress="";targetBleName="";bleConnected=false;if(bleClient&&bleClient->isConnected())bleClient->disconnect();server.send(200,"text/plain","rescanning");lastBleScanAt=0;});
  server.on("/api/restart", HTTP_POST, [](){server.send(200,"text/plain","restarting");delay(250);ESP.restart();});
  server.onNotFound([](){ if(setupApActive){server.sendHeader("Location","http://192.168.4.1",true);server.send(302,"text/plain","");}else server.send(404,"text/plain","Not found"); });
}

void setup() {
  pinMode(PIN_SETUP_BUTTON, INPUT_PULLUP);
  Serial.begin(115200);
  delay(250);
  prefs.begin("ceteluma", false);
  loadPresets();
  currentR=prefs.getUChar("lastR",255);currentG=prefs.getUChar("lastG",255);currentB=prefs.getUChar("lastB",255);
  currentBrightness=prefs.getUChar("lastBr",70);currentSpeed=prefs.getUChar("lastSp",50);currentEffect=prefs.getUChar("lastFx",0);currentPower=prefs.getBool("lastOn",true);
  targetBleName=prefs.getString("bleName","");targetBleAddress=prefs.getString("bleAddr","");targetBleAddressType=prefs.getUChar("bleType",0xFF);

  WiFi.mode(WIFI_STA);
  registerWebRoutes();
  server.begin();
  connectSavedWifi();

  BLEDevice::init("CETELUMA-NanoC6-Bridge");
  lastBleScanAt=0;
}

void loop() {
  server.handleClient();
  if(setupApActive)dnsServer.processNextRequest();

  if(pendingWifiActionAt && (int32_t)(millis()-pendingWifiActionAt)>=0){
    pendingWifiActionAt=0;
    if(pendingWifiForget){pendingWifiForget=false;WiFi.disconnect(true,true);setupApForced=false;startSetupAP(false);}
    if(pendingWifiReconnect){pendingWifiReconnect=false;WiFi.disconnect(false,false);delay(100);setupApForced=false;connectSavedWifi();}
  }

  bool pressed=digitalRead(PIN_SETUP_BUTTON)==LOW;
  if(pressed){
    if(buttonDownAt==0)buttonDownAt=millis();
    if(!buttonLongHandled && millis()-buttonDownAt>=5000){setupApForced=true;startSetupAP(true);buttonLongHandled=true;}
  }else{buttonDownAt=0;buttonLongHandled=false;}

  if(bleClient && !bleClient->isConnected()){bleConnected=false;bleWriteChar=nullptr;}
  if(!bleConnected && millis()-lastBleScanAt>=BLE_RESCAN_MS){lastBleScanAt=millis();ensureBleConnected();}

  static uint32_t lastSave=0;
  if(stateDirty && millis()-lastSave>3000){
    lastSave=millis();
    prefs.putUChar("lastR",currentR);prefs.putUChar("lastG",currentG);prefs.putUChar("lastB",currentB);prefs.putUChar("lastBr",currentBrightness);prefs.putUChar("lastSp",currentSpeed);prefs.putUChar("lastFx",currentEffect);prefs.putBool("lastOn",currentPower);
    stateDirty=false;
  }
  delay(2);
}
