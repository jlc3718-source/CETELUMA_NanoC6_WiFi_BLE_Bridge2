/*
 * Jason Home 2 ESP32-C6 independent factory rescue, v1.1.74.
 * Always advertises local recovery Wi-Fi. Never contacts Oracle or Eufy.
 * Writes only the inactive OTA slot; no changes to bootloader/NVS/storage.
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>
#include "esp_log.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_image_format.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
static const char *TAG="JH2_RESCUE_174";
static const char MARKER[]="jason-home-2-nanoc6-runtime-v1";
static const char PAGE[]=
"<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
"<title>Jason Home 2 Emergency Firmware</title><style>body{font:16px system-ui;max-width:580px;"
"margin:25px auto;padding:20px;background:#0b1724;color:#edf8ff}button,input{display:block;"
"padding:15px;margin:16px 0;width:100%;border-radius:10px}button{background:#20b9a4;border:0}"
"</style></head><body><h1>Jason Home 2 - Emergency Recovery</h1>"
"<p>This screen runs from an independent factory partition. It is available even if BOTH "
"runtime copies fail. Upload a 1.1.74+ dual-slot runtime BIN, not a full-flash image.</p>"
"<p>Saved Wi-Fi, Oracle server, Eufy integration and curtain controller data are not erased.</p>"
"<input type=file id=f accept='.bin'><button onclick='upload()'>Install runtime to inactive slot</button>"
"<progress id=p max=100 value=0 style='width:100%'></progress><p id=s>Ready.</p>"
"<button onclick='back()'>Return to last known-good runtime</button>"
"<script>function upload(){let f=document.getElementById('f').files[0];"
"if(!f){document.getElementById('s').textContent='Select a runtime BIN';return;}"
"let x=new XMLHttpRequest();x.open('POST','/firmware/upload');x.timeout=240000;"
"x.upload.onprogress=e=>{if(e.lengthComputable)document.getElementById('p').value=Math.round(e.loaded*100/e.total)};"
"x.onload=()=>document.getElementById('s').textContent=x.responseText;"
"x.onerror=()=>document.getElementById('s').textContent='Upload failed; rescue stays available';"
"x.send(f)}async function back(){let r=await fetch('/firmware/return',{method:'POST'});"
"document.getElementById('s').textContent=await r.text()}</script></body></html>";
static const esp_partition_t *slot(unsigned index){
    return esp_partition_find_first(ESP_PARTITION_TYPE_APP,
        index?ESP_PARTITION_SUBTYPE_APP_OTA_1:ESP_PARTITION_SUBTYPE_APP_OTA_0,
        index?"runtime_b":"runtime");
}
static bool image_valid(const esp_partition_t *p){
    if(!p)return false;
    esp_partition_pos_t pos={.offset=p->address,.size=p->size};
    esp_image_metadata_t meta={0};
    if(esp_image_verify(ESP_IMAGE_VERIFY_SILENT,&pos,&meta)!=ESP_OK)return false;
    esp_ota_img_states_t state;
    if(esp_ota_get_state_partition(p,&state)==ESP_OK){
        if(state==ESP_OTA_IMG_INVALID||state==ESP_OTA_IMG_ABORTED)return false;
    }
    return true;
}
static int known_good(void){
    nvs_handle_t h;uint8_t good=255;
    if(nvs_open("jh2-failsafe",NVS_READONLY,&h)==ESP_OK){
        (void)nvs_get_u8(h,"good",&good);nvs_close(h);
    }
    return good<=1 && image_valid(slot(good))?(int)good:-1;
}
static esp_err_t send(httpd_req_t *r,const char *status,const char *message){
    httpd_resp_set_status(r,status);
    httpd_resp_set_type(r,"text/plain; charset=utf-8");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    return httpd_resp_sendstr(r,message);
}
static esp_err_t page_get(httpd_req_t *r){
    httpd_resp_set_type(r,"text/html; charset=utf-8");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    return httpd_resp_sendstr(r,PAGE);
}
static esp_err_t return_post(httpd_req_t *r){
    int good=known_good();
    if(good<0)return send(r,"409 Conflict","No confirmed working runtime. Upload firmware here.");
    const esp_partition_t *p=slot((unsigned)good);
    if(esp_ota_set_boot_partition(p)!=ESP_OK)
        return send(r,"500 Internal Server Error","Could not select the working runtime.");
    send(r,"200 OK","Returning to last known-good runtime.");
    vTaskDelay(pdMS_TO_TICKS(400));esp_restart();return ESP_OK;
}
static esp_err_t upload_post(httpd_req_t *r){
    const int good=known_good();
    const unsigned target=good==0?1:0;
    const esp_partition_t *p=slot(target);
    if(!p||p->size!=0x160000||r->content_len<0x100000||
       (size_t)r->content_len>p->size)
        return send(r,"400 Bad Request","Wrong runtime size or partition; rescue remains available.");
    uint8_t *buf=malloc(4096);
    if(!buf)return send(r,"500 Internal Server Error","Not enough memory.");
    esp_ota_handle_t handle=0;
    if(esp_ota_begin(p,r->content_len,&handle)!=ESP_OK){
        free(buf);return send(r,"500 Internal Server Error","Cannot open inactive runtime slot.");
    }
    bool ok=true,product=false,header=false;
    size_t matched=0,total=0;
    while(total<(size_t)r->content_len){
        int n=httpd_req_recv(r,(char*)buf,
            (size_t)r->content_len-total>4096?4096:(size_t)r->content_len-total);
        if(n<=0){ok=false;break;}
        if(!header){
            if(n<24 && total==0){ok=false;break;}
            if(buf[0]!=0xe9||buf[12]!=13||buf[13]!=0){ok=false;break;}
            header=true;
        }
        for(int i=0;i<n;i++){
            if(buf[i]==(uint8_t)MARKER[matched])matched++;
            else matched=buf[i]==(uint8_t)MARKER[0]?1:0;
            if(matched==sizeof(MARKER)-1){product=true;matched=0;}
        }
        if(esp_ota_write(handle,buf,(size_t)n)!=ESP_OK){ok=false;break;}
        total+=(size_t)n;
    }
    free(buf);
    if(!ok||total!=(size_t)r->content_len||!product){
        esp_ota_abort(handle);
        return send(r,"400 Bad Request","Incomplete or wrong product firmware. Existing good slot is preserved.");
    }
    if(esp_ota_end(handle)!=ESP_OK)
        return send(r,"400 Bad Request","Firmware image validation failed; rescue remains available.");
    if(esp_ota_set_boot_partition(p)!=ESP_OK)
        return send(r,"500 Internal Server Error","Image stored, but boot selection failed.");
    send(r,"200 OK","Firmware installed to inactive slot; booting candidate. Rollback enabled.");
    vTaskDelay(pdMS_TO_TICKS(400));esp_restart();return ESP_OK;
}
static void start_ap(void){
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(esp_netif_create_default_wifi_ap()?ESP_OK:ESP_FAIL);
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    wifi_config_t config={0};
    strcpy((char*)config.ap.ssid,"Jason-Home-2-Setup");
    strcpy((char*)config.ap.password,"JasonHome2");
    config.ap.ssid_len=strlen((char*)config.ap.ssid);
    config.ap.max_connection=4;config.ap.channel=6;
    config.ap.authmode=WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP,&config));
    ESP_ERROR_CHECK(esp_wifi_start());
}
void app_main(void){
    esp_err_t err=nvs_flash_init();
    if(err!=ESP_OK){ESP_LOGE(TAG,"NVS unavailable, recovery AP cannot initialize");return;}
    start_ap();
    httpd_handle_t server=NULL;
    httpd_config_t config=HTTPD_DEFAULT_CONFIG();
    config.stack_size=7168;
    config.max_uri_handlers=5;
    ESP_ERROR_CHECK(httpd_start(&server,&config));
    const httpd_uri_t routes[]={
        {.uri="/",.method=HTTP_GET,.handler=page_get},
        {.uri="/firmware",.method=HTTP_GET,.handler=page_get},
        {.uri="/firmware/upload",.method=HTTP_POST,.handler=upload_post},
        {.uri="/firmware/return",.method=HTTP_POST,.handler=return_post}
    };
    for(unsigned i=0;i<sizeof(routes)/sizeof(routes[0]);i++)
        ESP_ERROR_CHECK(httpd_register_uri_handler(server,&routes[i]));
    ESP_LOGW(TAG,"Emergency factory firmware page: WiFi Jason-Home-2-Setup, http://192.168.4.1/firmware");
    while(true)vTaskDelay(pdMS_TO_TICKS(10000));
}
