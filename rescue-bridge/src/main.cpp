#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <Preferences.h>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>

static constexpr int LED_PIN = 7;
static constexpr char BRIDGE_VERSION[] = "4.0.1r";
static constexpr char TARGET_VERSION[] = "4.0.4";
static constexpr char TARGET_COMMIT[] = "15bcfd45cb155a714fc7456f1a1ab4ad8a49f401";
static constexpr char TARGET_SHA256[] = "b96868243a0cd1e97e0e179dd7baebf4b42304b91b0a99ad79aff4254f5afb5a";
static constexpr size_t TARGET_BYTES = 1723440;
static constexpr char TARGET_URL[] = "https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v4.0.4/and_4.0.4.bin";

static uint32_t nextAttemptAt = 0;
static bool bridgeValidated = false;

static String hexDigest(const uint8_t* data, size_t len) {
  static const char h[] = "0123456789abcdef";
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; ++i) {
    out += h[data[i] >> 4];
    out += h[data[i] & 0x0F];
  }
  return out;
}

static void blink(unsigned count, unsigned onMs = 80, unsigned offMs = 120) {
  for (unsigned i = 0; i < count; ++i) {
    digitalWrite(LED_PIN, HIGH);
    delay(onMs);
    digitalWrite(LED_PIN, LOW);
    delay(offMs);
  }
}

static bool loadWiFi(String& ssid, String& pass) {
  Preferences p;
  if (!p.begin("anderson", true)) return false;
  ssid = p.getString("ssid", "");
  pass = p.getString("pass", "");
  p.end();
  ssid.trim();
  return ssid.length() > 0;
}

static bool connectSavedWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  String ssid, pass;
  if (!loadWiFi(ssid, pass)) {
    Serial.println("RESCUE: no saved Anderson Wi-Fi credentials");
    return false;
  }
  Serial.printf("RESCUE: connecting to %s\n", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), pass.c_str());
  const uint32_t started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 30000UL) {
    delay(250);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }
  digitalWrite(LED_PIN, LOW);
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("RESCUE: Wi-Fi connection timed out");
    return false;
  }
  Serial.print("RESCUE: Wi-Fi connected, IP ");
  Serial.println(WiFi.localIP());
  return true;
}

static void validateBridgeSlotOnce() {
  if (bridgeValidated) return;
  const esp_partition_t* running = esp_ota_get_running_partition();
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  if (running && esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
    esp_err_t rc = esp_ota_mark_app_valid_cancel_rollback();
    Serial.printf("RESCUE: bridge slot validation %s\n", esp_err_to_name(rc));
  }
  bridgeValidated = true;
}

static bool saveTargetIdentity() {
  Preferences p;
  if (!p.begin("anderson-ota", false)) return false;
  bool ok = true;
  ok = ok && p.putString("pending", TARGET_VERSION) == strlen(TARGET_VERSION);
  ok = ok && p.putString("sha", TARGET_SHA256) == strlen(TARGET_SHA256);
  ok = ok && p.putString("commit", TARGET_COMMIT) == strlen(TARGET_COMMIT);
  p.putString("lastmsg", "Rescue bridge staged Anderson Home 4.0.4.");
  p.end();
  return ok;
}

static bool installTarget() {
  Serial.printf("RESCUE %s: downloading Anderson Home %s\n", BRIDGE_VERSION, TARGET_VERSION);
  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(15);

  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(15000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(client, TARGET_URL)) {
    Serial.println("RESCUE: could not open target URL");
    return false;
  }

  const int code = http.GET();
  if (code != HTTP_CODE_OK) {
    Serial.printf("RESCUE: target HTTP error %d\n", code);
    http.end();
    return false;
  }

  const int announced = http.getSize();
  if (announced > 0 && (size_t)announced != TARGET_BYTES) {
    Serial.printf("RESCUE: Content-Length mismatch %d != %u\n", announced, (unsigned)TARGET_BYTES);
    http.end();
    return false;
  }

  if (!Update.begin(TARGET_BYTES, U_FLASH)) {
    Serial.printf("RESCUE: Update.begin failed, error %u\n", Update.getError());
    http.end();
    return false;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  if (mbedtls_sha256_starts(&sha, 0) != 0) {
    Update.abort();
    mbedtls_sha256_free(&sha);
    http.end();
    Serial.println("RESCUE: SHA-256 init failed");
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buffer[4096];
  size_t total = 0;
  uint32_t lastData = millis();
  bool failed = false;

  while (total < TARGET_BYTES) {
    const int available = stream->available();
    if (available > 0) {
      size_t want = (size_t)available;
      if (want > sizeof(buffer)) want = sizeof(buffer);
      if (want > TARGET_BYTES - total) want = TARGET_BYTES - total;
      const int got = stream->readBytes(buffer, want);
      if (got > 0) {
        if (mbedtls_sha256_update(&sha, buffer, (size_t)got) != 0 || Update.write(buffer, (size_t)got) != (size_t)got) {
          failed = true;
          break;
        }
        total += (size_t)got;
        lastData = millis();
        if ((total & 0x1FFFF) < (size_t)got) Serial.printf("RESCUE: %u / %u bytes\n", (unsigned)total, (unsigned)TARGET_BYTES);
        delay(1);
        continue;
      }
    }
    if (!stream->connected() && !stream->available()) {
      failed = true;
      break;
    }
    if (millis() - lastData > 20000UL) {
      failed = true;
      break;
    }
    delay(2);
  }

  uint8_t digest[32];
  const bool hashOk = !failed && total == TARGET_BYTES && mbedtls_sha256_finish(&sha, digest) == 0;
  mbedtls_sha256_free(&sha);
  http.end();

  if (!hashOk) {
    Update.abort();
    Serial.printf("RESCUE: download incomplete at %u / %u bytes\n", (unsigned)total, (unsigned)TARGET_BYTES);
    return false;
  }

  String actual = hexDigest(digest, sizeof(digest));
  if (!actual.equalsIgnoreCase(TARGET_SHA256)) {
    Update.abort();
    Serial.print("RESCUE: SHA mismatch: ");
    Serial.println(actual);
    return false;
  }

  if (!saveTargetIdentity()) {
    Update.abort();
    Serial.println("RESCUE: could not save target identity in NVS");
    return false;
  }

  if (!Update.end(true)) {
    Serial.printf("RESCUE: image validation failed, error %u\n", Update.getError());
    return false;
  }

  Serial.println("RESCUE: Anderson Home 4.0.4 verified and selected for boot");
  blink(5, 70, 70);
  delay(1200);
  ESP.restart();
  return true;
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  Serial.begin(115200);
  delay(300);
  Serial.printf("\nAnderson OTA Rescue Bridge %s\n", BRIDGE_VERSION);
  Serial.println("Preserving NVS; no erase or filesystem formatting is performed.");
  nextAttemptAt = 0;
}

void loop() {
  if ((int32_t)(millis() - nextAttemptAt) < 0) {
    delay(100);
    return;
  }

  if (!connectSavedWiFi()) {
    nextAttemptAt = millis() + 15000UL;
    blink(2, 150, 250);
    return;
  }

  validateBridgeSlotOnce();
  if (!installTarget()) {
    Serial.println("RESCUE: install attempt failed; retrying in 30 seconds");
    nextAttemptAt = millis() + 30000UL;
    blink(3, 120, 180);
  }
}
