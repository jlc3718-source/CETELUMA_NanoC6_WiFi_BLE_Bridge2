#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <esp_app_desc.h>

static constexpr int BLUE_LED = 7;
static constexpr int USER_BUTTON = 9;
static constexpr const char* RECOVERY_VERSION = "4.5.0-recovery";
static constexpr const char* AP_SSID = "Anderson-Recovery";
static constexpr const char* AP_PASS = "Anderson450";
static constexpr uint8_t TRIAL_BOOT_MAX_ATTEMPTS = 3;
static constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 15000UL;
static constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 30000UL;
static constexpr uint32_t WIFI_AP_FALLBACK_MS = 120000UL;

WebServer server(80);
static bool recoveryAp = false;
static bool trialBootActive = false;
static uint32_t lastWiFiRetry = 0;
static uint32_t wifiOfflineSince = 0;
static uint32_t buttonDown = 0;
static bool uploadStarted = false;
static bool uploadHeaderChecked = false;
static bool uploadOk = false;
static int uploadCode = 500;
static String uploadError;

static bool partitionLooksBootable(const esp_partition_t* p) {
  if (!p || p->type != ESP_PARTITION_TYPE_APP) return false;
  esp_app_desc_t desc{};
  return esp_ota_get_partition_description(p, &desc) == ESP_OK && desc.magic_word == ESP_APP_DESC_MAGIC_WORD;
}

static void trialBootBegin() {
  const esp_partition_t* running = esp_ota_get_running_partition();
  const esp_partition_t* fallback = running ? esp_ota_get_next_update_partition(running) : nullptr;
  if (!running || !fallback) return;
  Preferences p;
  if (!p.begin("and-trial", false)) return;
  String ver = p.getString("ver", "");
  uint32_t run = p.getUInt("run", 0);
  bool ok = p.getBool("ok", false);
  uint8_t tries = p.getUChar("tries", 0);
  if (ver != RECOVERY_VERSION || run != running->address) {
    tries = 1;
    p.putString("ver", RECOVERY_VERSION);
    p.putUInt("run", running->address);
    p.putUInt("fallback", fallback->address);
    p.putBool("ok", false);
    p.putUChar("tries", tries);
  } else if (!ok) {
    if (tries < 255) ++tries;
    p.putUChar("tries", tries);
  }
  const uint32_t fallbackAddr = p.getUInt("fallback", fallback->address);
  p.end();
  if (ok) return;
  trialBootActive = true;
  if (tries < TRIAL_BOOT_MAX_ATTEMPTS) return;
  if (fallback->address != fallbackAddr || !partitionLooksBootable(fallback)) return;
  if (esp_ota_set_boot_partition(fallback) == ESP_OK) {
    delay(80);
    ESP.restart();
  }
}

static void trialBootConfirmHealthy() {
  if (!trialBootActive || (WiFi.status() != WL_CONNECTED && !recoveryAp)) return;
  const esp_partition_t* running = esp_ota_get_running_partition();
  if (!running) return;
  Preferences p;
  if (!p.begin("and-trial", false)) return;
  if (p.getString("ver", "") == RECOVERY_VERSION && p.getUInt("run", 0) == running->address) {
    p.putBool("ok", true);
    p.putUChar("tries", 0);
    trialBootActive = false;
  }
  p.end();
  esp_ota_mark_app_valid_cancel_rollback();
}

static void loadSavedWiFi(String& ssid, String& pass) {
  Preferences p;
  if (!p.begin("anderson", true)) return;
  ssid = p.getString("ssid", "");
  pass = p.getString("pass", "");
  p.end();
}

static void clearSavedWiFi() {
  Preferences p;
  if (!p.begin("anderson", false)) return;
  p.putString("ssid", "");
  p.putString("pass", "");
  p.end();
}

static void startRecoveryAp() {
  if (recoveryAp) return;
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);
  recoveryAp = WiFi.softAP(AP_SSID, AP_PASS);
}

static void connectNetwork() {
  String ssid, pass;
  loadSavedWiFi(ssid, pass);
  if (!ssid.length()) {
    startRecoveryAp();
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid.c_str(), pass.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && (uint32_t)(millis() - started) < WIFI_CONNECT_TIMEOUT_MS) delay(100);
  if (WiFi.status() != WL_CONNECTED) {
    wifiOfflineSince = millis();
    startRecoveryAp();
  }
}

static const char PAGE[] PROGMEM = R"HTML(<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anderson Firmware Recovery</title><style>body{font-family:system-ui;margin:0;background:#101318;color:#eef2f7;display:grid;place-items:center;min-height:100vh}.c{width:min(92vw,520px);padding:28px;border:1px solid #313844;border-radius:18px;background:#171b22}h1{font-size:1.35rem;margin:0 0 12px}p{color:#aeb7c4;line-height:1.4}input,button{width:100%;box-sizing:border-box;margin-top:14px}input{padding:12px;border:1px solid #3d4654;border-radius:10px;background:#0e1116;color:#fff}button{padding:13px;border:0;border-radius:10px;font-weight:700;background:#2f7cf6;color:white}#s{min-height:1.4em}</style></head><body><main class="c"><h1>Anderson Firmware Recovery</h1><p>Choose an ESP32-C6 APP-only firmware .bin. The inactive OTA slot is written and validated before reboot.</p><form id="f"><input id="b" type="file" accept=".bin,application/octet-stream" required><button>Upload firmware</button></form><p id="s"></p></main><script>f.onsubmit=async e=>{e.preventDefault();let x=b.files[0];if(!x)return;s.textContent='Uploading…';let d=new FormData();d.append('firmware',x,x.name);try{let r=await fetch('/update',{method:'POST',body:d});let t=await r.text();s.textContent=t}catch(e){s.textContent='Connection closed. If upload completed, the controller may be rebooting.'}}</script></body></html>)HTML";

static void setupRoutes() {
  server.on("/", HTTP_GET, []() {
    server.sendHeader("Cache-Control", "no-store");
    server.send_P(200, "text/html", PAGE, sizeof(PAGE) - 1);
  });
  server.on("/update", HTTP_POST, []() {
    server.sendHeader("Cache-Control", "no-store");
    if (uploadOk) {
      server.send(200, "text/plain", "Firmware accepted. Rebooting into the new OTA slot…");
      delay(350);
      ESP.restart();
    } else {
      if (!uploadError.length()) uploadError = "Firmware upload failed";
      server.send(uploadCode, "text/plain", uploadError);
    }
  }, []() {
    HTTPUpload& u = server.upload();
    if (u.status == UPLOAD_FILE_START) {
      uploadStarted = true;
      uploadHeaderChecked = false;
      uploadOk = false;
      uploadCode = 500;
      uploadError = "";
      if (!Update.begin(UPDATE_SIZE_UNKNOWN, U_FLASH)) {
        uploadStarted = false;
        uploadError = String("Unable to open inactive OTA slot. Error ") + Update.getError();
      }
    } else if (u.status == UPLOAD_FILE_WRITE) {
      if (!uploadStarted || uploadError.length()) return;
      if (!uploadHeaderChecked) {
        if (!u.buf || u.currentSize == 0 || u.buf[0] != 0xE9) {
          uploadError = "Rejected: file is not an ESP APP image.";
          uploadCode = 400;
          Update.abort();
          uploadStarted = false;
          return;
        }
        uploadHeaderChecked = true;
      }
      if (Update.write(u.buf, u.currentSize) != u.currentSize) {
        uploadError = String("Firmware write failed. Error ") + Update.getError();
        Update.abort();
        uploadStarted = false;
      }
    } else if (u.status == UPLOAD_FILE_END) {
      if (!uploadStarted || uploadError.length()) return;
      if (!uploadHeaderChecked) {
        uploadError = "Rejected: firmware image header was not received.";
        uploadCode = 400;
        Update.abort();
        uploadStarted = false;
        return;
      }
      uploadOk = Update.end(true);
      uploadStarted = false;
      if (!uploadOk) uploadError = String("Firmware validation failed. Error ") + Update.getError();
      else uploadCode = 200;
    } else if (u.status == UPLOAD_FILE_ABORTED) {
      Update.abort();
      uploadStarted = false;
      uploadOk = false;
      uploadError = "Firmware upload aborted.";
    }
  });
  server.onNotFound([]() { server.send(404, "text/plain", "Not found"); });
}

static void maintainNetwork() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiOfflineSince = 0;
    return;
  }
  if (!wifiOfflineSince) wifiOfflineSince = millis();
  const uint32_t now = millis();
  if ((uint32_t)(now - lastWiFiRetry) >= WIFI_RETRY_INTERVAL_MS) {
    lastWiFiRetry = now;
    String ssid, pass;
    loadSavedWiFi(ssid, pass);
    if (ssid.length()) {
      if (recoveryAp) WiFi.mode(WIFI_AP_STA);
      else WiFi.mode(WIFI_STA);
      WiFi.begin(ssid.c_str(), pass.c_str());
    }
  }
  if ((uint32_t)(now - wifiOfflineSince) >= WIFI_AP_FALLBACK_MS) startRecoveryAp();
}

void setup() {
  trialBootBegin();
  pinMode(BLUE_LED, OUTPUT);
  pinMode(USER_BUTTON, INPUT_PULLUP);
  digitalWrite(BLUE_LED, HIGH);
  connectNetwork();
  setupRoutes();
  server.begin();
  trialBootConfirmHealthy();
  digitalWrite(BLUE_LED, LOW);
}

void loop() {
  server.handleClient();
  maintainNetwork();
  const bool pressed = digitalRead(USER_BUTTON) == LOW;
  if (pressed && !buttonDown) buttonDown = millis();
  if (!pressed) buttonDown = 0;
  if (buttonDown && (uint32_t)(millis() - buttonDown) > 5000UL) {
    buttonDown = 0;
    clearSavedWiFi();
    digitalWrite(BLUE_LED, HIGH);
    delay(300);
    ESP.restart();
  }
  delay(8);
}
