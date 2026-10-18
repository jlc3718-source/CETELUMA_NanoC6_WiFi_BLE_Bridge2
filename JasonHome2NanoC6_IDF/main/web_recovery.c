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
#include "nvs.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_littlefs.h"
#include "mdns.h"
#include "lwip/sockets.h"
#include "lwip/apps/sntp.h"
#include "cJSON.h"
#include "freertos/task.h"
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
static int64_t wifi_down_since=0;
static bool sntp_started=false,mdns_started=false;

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
"<p><b>Use the runtime-only BIN, not a 4 MB full-flash image.</b></p>"
"<button onclick='go()'>Open firmware upload mode</button>"
"<p id='state'></p><p><a href='/setup'>Wi-Fi / Oracle settings</a> &nbsp; <a href='/api/status'>Status</a></p>"
"<small>The Nano reboots into its original updater. If your home connection drops, "
"join Jason-Home-2-Setup Wi-Fi and open http://192.168.4.1/firmware .</small>"
"<script>async function go(){const s=document.getElementById('state');s.textContent='Selecting factory updater...';"
"try{const r=await fetch('/firmware/recovery',{method:'POST'});if(!r.ok)throw Error(await r.text());"
"s.textContent='Restarting to factory upload mode. Reconnect to http://192.168.4.1/firmware or use the home IP /firmware.';"
"}catch(e){s.textContent=e.message}}</script></body></html>";

static bool same_subnet(uint32_t peer,esp_netif_t *netif){
    if(!netif)return false;
    esp_netif_ip_info_t ip={0};
    if(esp_netif_get_ip_info(netif,&ip)!=ESP_OK || !ip.ip.addr || !ip.netmask.addr)return false;
    return (peer&ip.netmask.addr)==(ip.ip.addr&ip.netmask.addr);
}
static bool local_only(httpd_req_t *r){
    struct sockaddr_storage ss={0};socklen_t len=sizeof(ss);
    int fd=httpd_req_to_sockfd(r);
    if(fd<0||getpeername(fd,(struct sockaddr*)&ss,&len)!=0||ss.ss_family!=AF_INET)return false;
    uint32_t peer=((struct sockaddr_in*)&ss)->sin_addr.s_addr;
    return same_subnet(peer,sta_netif)||same_subnet(peer,ap_netif);
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
    cJSON_AddStringToObject(o,"version","1.1.29-rx2-web");
    cJSON_AddBoolToObject(o,"webRecoveryAvailable",true);
    return send_json(r,o);
}
static esp_err_t status_get(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    cJSON *o=cJSON_CreateObject();
    cJSON_AddBoolToObject(o,"ok",true);
    cJSON_AddStringToObject(o,"version","1.1.29-rx2-web");
    cJSON_AddBoolToObject(o,"webRecoveryAvailable",true);
    cJSON_AddBoolToObject(o,"oracleConfigured",creds_ready);
    cJSON_AddBoolToObject(o,"oracleRunning",jh2_bridge_ready());
    cJSON_AddBoolToObject(o,"storageReady",fs_ready);
    cJSON_AddBoolToObject(o,"setupAP",ap_enabled);
    cJSON_AddBoolToObject(o,"wifi",net_event && (xEventGroupGetBits(net_event)&WEB_WIFI_READY));
    cJSON_AddBoolToObject(o,"signedAutoUpdate",false);
    cJSON *curtain=cJSON_AddObjectToObject(o,"curtain");
    jh2_ble_status(curtain);
    return send_json(r,o);
}
static esp_err_t html_get(httpd_req_t *r){
    if(!local_only(r))return denied(r);
    const char *page=strstr(r->uri,"firmware")||strstr(r->uri,"recovery")?FIRMWARE_HTML:SETUP_HTML;
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
static void update_time(void){
    if(sntp_started)return;sntp_started=true;
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
    fs_ready=mount_store();read_saved();
    if(!start_net()){ESP_LOGE(TAG,"Wi-Fi/AP setup failed");return false;}
    httpd_config_t cfg=HTTPD_DEFAULT_CONFIG();
    cfg.server_port=80;
    cfg.max_uri_handlers=14;
    cfg.stack_size=7168;
    cfg.lru_purge_enable=true;
    if(httpd_start(&web_server,&cfg)!=ESP_OK)return false;
    const httpd_uri_t routes[]={
        {.uri="/",.method=HTTP_GET,.handler=html_get},
        {.uri="/setup",.method=HTTP_GET,.handler=html_get},
        {.uri="/setup",.method=HTTP_POST,.handler=setup_post},
        {.uri="/firmware",.method=HTTP_GET,.handler=html_get},
        {.uri="/recovery",.method=HTTP_GET,.handler=html_get},
        {.uri="/firmware/recovery",.method=HTTP_POST,.handler=recovery_post},
        {.uri="/jason-home-2/firmware",.method=HTTP_GET,.handler=html_get},
        {.uri="/jason-home-2/recovery",.method=HTTP_GET,.handler=html_get},
        {.uri="/api/status",.method=HTTP_GET,.handler=status_get},
        {.uri="/api/curtain/status",.method=HTTP_GET,.handler=status_get},
        {.uri="/api/health",.method=HTTP_GET,.handler=health_get}
    };
    for(size_t i=0;i<sizeof(routes)/sizeof(routes[0]);i++)
        if(httpd_register_uri_handler(web_server,&routes[i])!=ESP_OK)return false;
    ESP_LOGI(TAG,"Persistent HTTP web recovery ready on port 80, AP fallback enabled");
    return true;
}
