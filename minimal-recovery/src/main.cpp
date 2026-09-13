#include <cstring>
#include <string>

extern "C" {
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs_flash.h"
}

static const char *TAG = "anderson-recovery";
static EventGroupHandle_t wifi_events;
static constexpr EventBits_t GOT_IP_BIT = BIT0;
static constexpr char AP_SSID[] = "Anderson-Recovery";
static constexpr char AP_PASS[] = "AndersonSafeOTA";

static const char PAGE[] = R"HTML(
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Anderson Recovery</title>
<style>body{font-family:system-ui;background:#0b1220;color:#eef3ff;max-width:620px;margin:40px auto;padding:20px}button,input{font-size:16px;margin:8px 0;padding:10px}#s{white-space:pre-wrap}</style></head>
<body><h2>Anderson Minimal Firmware Updater</h2><p>This recovery image contains no lighting application logic.</p>
<input id="f" type="file" accept=".bin,application/octet-stream"><br><button onclick="go()">Install firmware</button><pre id="s">Ready.</pre>
<script>async function go(){const f=document.getElementById('f').files[0];if(!f){s.textContent='Choose a .bin file.';return;}if(!confirm('Flash '+f.name+' ('+f.size+' bytes)?'))return;s.textContent='Uploading... do not remove power.';try{const r=await fetch('/update',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Firmware-Name':f.name},body:f});s.textContent=await r.text();}catch(e){s.textContent='Connection closed during reboot. Reconnect after the device restarts.'}}</script></body></html>)HTML";

static void wifi_event(void *, esp_event_base_t base, int32_t id, void *data) {
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(wifi_events, GOT_IP_BIT);
        auto *ev = static_cast<ip_event_got_ip_t *>(data);
        ESP_LOGI(TAG, "STA IP: " IPSTR, IP2STR(&ev->ip_info.ip));
    }
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(wifi_events, GOT_IP_BIT);
        esp_wifi_connect();
    }
}

static esp_err_t start_recovery_ap() {
    wifi_mode_t mode = WIFI_MODE_NULL;
    esp_wifi_get_mode(&mode);
    ESP_ERROR_CHECK(esp_wifi_set_mode(mode == WIFI_MODE_STA ? WIFI_MODE_APSTA : WIFI_MODE_AP));

    wifi_config_t ap{};
    std::strncpy(reinterpret_cast<char *>(ap.ap.ssid), AP_SSID, sizeof(ap.ap.ssid) - 1);
    std::strncpy(reinterpret_cast<char *>(ap.ap.password), AP_PASS, sizeof(ap.ap.password) - 1);
    ap.ap.ssid_len = std::strlen(AP_SSID);
    ap.ap.channel = 1;
    ap.ap.max_connection = 2;
    ap.ap.authmode = WIFI_AUTH_WPA2_PSK;
    ap.ap.pmf_cfg.required = false;
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));
    ESP_LOGW(TAG, "Recovery AP enabled: %s", AP_SSID);
    return ESP_OK;
}

static void init_wifi() {
    wifi_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t loop = esp_event_loop_create_default();
    if (loop != ESP_OK && loop != ESP_ERR_INVALID_STATE) ESP_ERROR_CHECK(loop);
    esp_netif_create_default_wifi_sta();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_FLASH));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event, nullptr));

    wifi_config_t saved{};
    bool have_saved = esp_wifi_get_config(WIFI_IF_STA, &saved) == ESP_OK && saved.sta.ssid[0] != 0;
    ESP_ERROR_CHECK(esp_wifi_set_mode(have_saved ? WIFI_MODE_STA : WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_start());

    if (have_saved) {
        ESP_LOGI(TAG, "Trying saved Wi-Fi: %s", saved.sta.ssid);
        esp_wifi_connect();
        EventBits_t bits = xEventGroupWaitBits(wifi_events, GOT_IP_BIT, pdFALSE, pdTRUE, pdMS_TO_TICKS(8000));
        if (!(bits & GOT_IP_BIT)) start_recovery_ap();
    } else {
        start_recovery_ap();
    }
}

static esp_err_t root_get(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, PAGE, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t health_get(httpd_req_t *req) {
    const char *json = "{\"ok\":true,\"mode\":\"minimal-recovery\",\"ota\":true}";
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t update_post(httpd_req_t *req) {
    if (req->content_len <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty firmware image");
        return ESP_FAIL;
    }

    const esp_partition_t *target = esp_ota_get_next_update_partition(nullptr);
    if (!target) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "No OTA target partition");
        return ESP_FAIL;
    }
    if (static_cast<size_t>(req->content_len) > target->size) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Firmware image is larger than OTA partition");
        return ESP_FAIL;
    }

    esp_ota_handle_t handle = 0;
    esp_err_t err = esp_ota_begin(target, req->content_len, &handle);
    if (err != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "OTA begin failed");
        return ESP_FAIL;
    }

    char buf[4096];
    int remaining = req->content_len;
    while (remaining > 0) {
        int want = remaining > static_cast<int>(sizeof(buf)) ? sizeof(buf) : remaining;
        int got = httpd_req_recv(req, buf, want);
        if (got == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (got <= 0) {
            esp_ota_abort(handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Upload interrupted; active firmware unchanged");
            return ESP_FAIL;
        }
        err = esp_ota_write(handle, buf, got);
        if (err != ESP_OK) {
            esp_ota_abort(handle);
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Flash write failed; active firmware unchanged");
            return ESP_FAIL;
        }
        remaining -= got;
    }

    err = esp_ota_end(handle); // validates the ESP image before activation
    if (err != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Firmware validation failed; active firmware unchanged");
        return ESP_FAIL;
    }
    err = esp_ota_set_boot_partition(target);
    if (err != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not select validated firmware; active firmware unchanged");
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "text/plain");
    httpd_resp_sendstr(req, "Firmware validated and installed. Rebooting now...");
    vTaskDelay(pdMS_TO_TICKS(750));
    esp_restart();
    return ESP_OK;
}

static void start_http() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 6144;
    config.recv_wait_timeout = 10;
    config.send_wait_timeout = 10;
    config.max_uri_handlers = 4;
    httpd_handle_t server = nullptr;
    ESP_ERROR_CHECK(httpd_start(&server, &config));

    httpd_uri_t root{.uri = "/", .method = HTTP_GET, .handler = root_get, .user_ctx = nullptr};
    httpd_uri_t health{.uri = "/health", .method = HTTP_GET, .handler = health_get, .user_ctx = nullptr};
    httpd_uri_t update{.uri = "/update", .method = HTTP_POST, .handler = update_post, .user_ctx = nullptr};
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &root));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &health));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &update));
}

extern "C" void app_main() {
    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(nvs);
    }

    // If this recovery image was itself booted as a pending OTA image, confirm it only
    // after NVS initialization succeeded. A failure before this point remains rollback-safe.
    esp_ota_mark_app_valid_cancel_rollback();

    init_wifi();
    start_http();
    ESP_LOGI(TAG, "Minimal recovery updater ready");

    while (true) vTaskDelay(pdMS_TO_TICKS(30000));
}
