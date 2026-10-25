// 1.1.79 clean-room Wi-Fi-only NanoC6 baseline.
// No Bluetooth, Oracle integration, factory-rescue selector, or auto-OTA.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_http_server.h"
#include "esp_ota_ops.h"
#include "nvs.h"
#include "nvs_flash.h"

#define AP_SSID "JH2-Nano-Fresh"
#define AP_PASSWORD ""
#define WIFI_NAMESPACE "jh2basic"
static const char *TAG="JH2_WIFI_BASE";
static esp_netif_t *sta_netif=NULL;
static volatile bool sta_connected=false;
static volatile bool configured=false;
static char home_ssid[33]={0};
static char home_password[65]={0};

static const char PAGE[]=
"<!doctype html><html lang='en'><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
"<meta charset='UTF-8'><title>NanoC6 | Fresh Wi-Fi Setup</title>"
"<style>body{background:#0d1828;color:#ecf5ff;font:16px system-ui;margin:0 auto;max-width:540px;padding:24px}"
"section{background:#192a40;padding:20px;border:1px solid #355370;border-radius:14px;margin:14px 0}"
"h1{font-size:1.6rem}input{width:100%;box-sizing:border-box;padding:13px;border-radius:9px;margin:7px 0 16px}"
"button{background:#79e7ce;color:#12283a;font-weight:700;border:0;border-radius:9px;padding:14px;width:100%}"
"small{color:#b3c6d9}#status{white-space:pre-wrap;line-height:1.65}</style></head><body>"
"<h1>Jason Home 2 — Nano Wi-Fi</h1><p>Fresh baseline 1.1.79 · Wi-Fi only</p>"
"<section><strong>Connection status</strong><div id='status'>Checking…</div></section>"
"<section><h2>Connect to home Wi-Fi</h2>"
"<form action='/save' method='POST'>"
"<label>2.4 GHz Wi-Fi name (SSID)<input name='ssid' maxlength='32' required autocomplete='off'></label>"
"<label>Wi-Fi password<input name='password' type='password' maxlength='63' autocomplete='off'></label>"
"<button type='submit'>Save and connect</button></form></section>"
"<p><small>This setup network stays on while the Nano connects. "
"No Oracle or Bluetooth starts in this test. Your settings are saved in the Nano.</small></p>"
"<script>async function refresh(){try{const r=await fetch('/status',{cache:'no-store'}),d=await r.json();"
"document.getElementById('status').textContent="
"'Nano firmware: 1.1.79\\nSetup network: JH2-Nano-Fresh\\n'"
"+'Wi-Fi configured: '+(d.configured?'Yes':'No')+'\\n'"
"+'Connected to home Wi-Fi: '+(d.connected?'YES':'No')+'\\n'"
"+'Home IP address: '+(d.ip||'Not assigned');"
"}catch(e){document.getElementById('status').textContent='Nano not responding; reconnect to JH2-Nano-Fresh';}}"
"refresh();setInterval(refresh,3000);</script></body></html>";

static const char SAVED[]=
"<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'>"
"<style>body{font:18px system-ui;background:#0d1828;color:#ecf5ff;padding:24px}</style>"
"<h2>Settings saved</h2><p>Connecting to home Wi-Fi. The setup network stays enabled.</p>"
"<p>Return to <a style='color:#79e7ce' href='/'>Wi-Fi status</a> and watch for an assigned IP address.</p>"
"</html>";

static void html_response(httpd_req_t *r,const char *text){
    httpd_resp_set_type(r,"text/html; charset=utf-8");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    httpd_resp_sendstr(r,text);
}
static esp_err_t root_get(httpd_req_t *r){
    html_response(r,PAGE);
    return ESP_OK;
}
static esp_err_t status_get(httpd_req_t *r){
    char ip[20]="";
    if(sta_connected && sta_netif){
        esp_netif_ip_info_t info={0};
        if(esp_netif_get_ip_info(sta_netif,&info)==ESP_OK){
            snprintf(ip,sizeof(ip),IPSTR,IP2STR(&info.ip));
        }
    }
    char json[180];
    snprintf(json,sizeof(json),
        "{\"ok\":true,\"version\":\"1.1.79\",\"configured\":%s,\"connected\":%s,\"ip\":\"%s\"}",
        configured?"true":"false",sta_connected?"true":"false",ip);
    httpd_resp_set_type(r,"application/json");
    httpd_resp_set_hdr(r,"Cache-Control","no-store");
    return httpd_resp_sendstr(r,json);
}
static bool url_decode(const char *start,size_t len,char *dst,size_t cap){
    size_t n=0;
    for(size_t i=0;i<len;i++){
        unsigned char c=(unsigned char)start[i];
        if(c=='+')c=' ';
        else if(c=='%'){
            if(i+2>=len || !isxdigit((unsigned char)start[i+1]) || !isxdigit((unsigned char)start[i+2]))return false;
            char hex[3]={start[i+1],start[i+2],0};
            c=(unsigned char)strtoul(hex,NULL,16);
            i+=2;
        }
        if(!c || c<32 || n+1>=cap)return false;
        dst[n++]=(char)c;
    }
    dst[n]=0;return true;
}
static bool form_param(const char *body,const char *key,char *out,size_t outlen){
    size_t klen=strlen(key);
    const char *p=body;
    while(p && *p){
        const char *end=strchr(p,'&');
        size_t n=end?(size_t)(end-p):strlen(p);
        if(n>klen && strncmp(p,key,klen)==0 && p[klen]=='=')
            return url_decode(p+klen+1,n-klen-1,out,outlen);
        p=end?end+1:NULL;
    }
    return false;
}
static esp_err_t save_post(httpd_req_t *r){
    if(r->content_len<=0||r->content_len>400)
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid form length");
    char form[401]={0},ssid[33]={0},password[65]={0};
    int used=0;
    while(used<r->content_len){
        int read=httpd_req_recv(r,form+used,r->content_len-used);
        if(read<=0)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Form read failed");
        used+=read;
    }
    if(!form_param(form,"ssid",ssid,sizeof(ssid))||!ssid[0]||
       !form_param(form,"password",password,sizeof(password))||
       strlen(password)>63)
        return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Check network name or password");
    nvs_handle_t n=0;
    esp_err_t e=nvs_open(WIFI_NAMESPACE,NVS_READWRITE,&n);
    if(e==ESP_OK)e=nvs_set_str(n,"ssid",ssid);
    if(e==ESP_OK)e=nvs_set_str(n,"password",password);
    if(e==ESP_OK)e=nvs_commit(n);
    if(n)nvs_close(n);
    if(e!=ESP_OK)return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Could not save network");
    strlcpy(home_ssid,ssid,sizeof(home_ssid));
    strlcpy(home_password,password,sizeof(home_password));
    configured=true;
    sta_connected=false;
    wifi_config_t sta={0};
    strlcpy((char*)sta.sta.ssid,home_ssid,sizeof(sta.sta.ssid));
    strlcpy((char*)sta.sta.password,home_password,sizeof(sta.sta.password));
    sta.sta.threshold.authmode=WIFI_AUTH_OPEN;
    sta.sta.pmf_cfg.capable=true;
    esp_wifi_disconnect();
    e=esp_wifi_set_config(WIFI_IF_STA,&sta);
    if(e==ESP_OK)e=esp_wifi_connect();
    if(e!=ESP_OK)ESP_LOGW(TAG,"STA connect rc=%s (AP remains enabled)",esp_err_to_name(e));
    html_response(r,SAVED);
    return ESP_OK;
}
static void wifi_events(void *arg,esp_event_base_t base,int32_t id,void *data){
    (void)arg;(void)data;
    if(base==WIFI_EVENT&&id==WIFI_EVENT_STA_DISCONNECTED){
        sta_connected=false;
        ESP_LOGW(TAG,"STA not connected; setup AP remains available");
    }
    if(base==IP_EVENT&&id==IP_EVENT_STA_GOT_IP){
        sta_connected=true;
        ESP_LOGW(TAG,"Home Wi-Fi connected, setup AP retained");
    }
}
static void reconnect_task(void *ignored){
    (void)ignored;
    while(true){
        vTaskDelay(pdMS_TO_TICKS(15000));
        if(configured&&!sta_connected){
            esp_err_t e=esp_wifi_connect();
            if(e!=ESP_OK&&e!=ESP_ERR_WIFI_CONN)
                ESP_LOGW(TAG,"Retry rc=%s",esp_err_to_name(e));
        }
    }
}
static void load_saved(void){
    nvs_handle_t n=0;
    if(nvs_open(WIFI_NAMESPACE,NVS_READONLY,&n)!=ESP_OK)return;
    size_t size=sizeof(home_ssid);
    if(nvs_get_str(n,"ssid",home_ssid,&size)==ESP_OK && home_ssid[0]){
        size=sizeof(home_password);
        if(nvs_get_str(n,"password",home_password,&size)!=ESP_OK)home_password[0]=0;
        configured=true;
    }
    nvs_close(n);
}
void app_main(void){
    ESP_LOGW(TAG,"Starting clean 1.1.79 Wi-Fi-only baseline");
    esp_err_t e=nvs_flash_init();
    if(e==ESP_ERR_NVS_NO_FREE_PAGES||e==ESP_ERR_NVS_NEW_VERSION_FOUND){
        ESP_ERROR_CHECK(nvs_flash_erase());
        e=nvs_flash_init();
    }
    ESP_ERROR_CHECK(e);
    load_saved();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_ap();
    sta_netif=esp_netif_create_default_wifi_sta();
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_events,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_events,NULL));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));

    wifi_config_t ap={0};
    strlcpy((char*)ap.ap.ssid,AP_SSID,sizeof(ap.ap.ssid));
    ap.ap.password[0]=0; // Open setup network, explicitly requested
    ap.ap.ssid_len=strlen(AP_SSID);
    ap.ap.channel=6;
    ap.ap.max_connection=4;
    ap.ap.authmode=WIFI_AUTH_OPEN;
    ap.ap.pmf_cfg.required=false;
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP,&ap));
    if(configured){
        wifi_config_t sta={0};
        strlcpy((char*)sta.sta.ssid,home_ssid,sizeof(sta.sta.ssid));
        strlcpy((char*)sta.sta.password,home_password,sizeof(sta.sta.password));
        sta.sta.threshold.authmode=WIFI_AUTH_OPEN;
        sta.sta.pmf_cfg.capable=true;
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&sta));
    }
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    if(configured)esp_wifi_connect();
    httpd_config_t cfg=HTTPD_DEFAULT_CONFIG();
    cfg.server_port=80;
    cfg.stack_size=6144;
    cfg.max_uri_handlers=6;
    httpd_handle_t server=NULL;
    ESP_ERROR_CHECK(httpd_start(&server,&cfg));
    const httpd_uri_t routes[]={
        {.uri="/",.method=HTTP_GET,.handler=root_get,.user_ctx=NULL},
        {.uri="/status",.method=HTTP_GET,.handler=status_get,.user_ctx=NULL},
        {.uri="/save",.method=HTTP_POST,.handler=save_post,.user_ctx=NULL}
    };
    for(size_t i=0;i<sizeof(routes)/sizeof(routes[0]);i++)
        ESP_ERROR_CHECK(httpd_register_uri_handler(server,&routes[i]));

    const esp_partition_t *running=esp_ota_get_running_partition();
    if(running){
        esp_ota_img_states_t state;
        if(esp_ota_get_state_partition(running,&state)==ESP_OK &&
           state==ESP_OTA_IMG_PENDING_VERIFY)
            ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
    }
    ESP_LOGW(TAG,"Setup Wi-Fi SSID %s; page http://192.168.4.1; setup AP stays online",AP_SSID);
    xTaskCreate(reconnect_task,"jh2-wifi-retry",3072,NULL,2,NULL);
    while(true)vTaskDelay(pdMS_TO_TICKS(60000));
}
