
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_system.h"
#include "esp_http_server.h"
#include "esp_ota_ops.h"
#include "nvs.h"
#include "nvs_flash.h"

#define AP_NAME "NanoC6-Fresh-Setup"
#define AP_OPEN_WIFI 1
static const char *TAG="NANOC6_BASIC";
static const char PAGE[]="<!doctype html><html lang=\"en\"><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta charset=\"utf-8\"><title>NanoC6 Basic Wi-Fi Setup</title>\n<style>body{font:16px system-ui;max-width:520px;margin:26px auto;padding:18px;background:#101a27;color:#f4f8ff}main{background:#1d2d3f;border:1px solid #425c71;border-radius:16px;padding:20px}input,button{box-sizing:border-box;font:inherit;padding:12px;width:100%;margin:8px 0 14px;border-radius:8px}button{background:#6dddbd;border:0;font-weight:700}input{background:#eef4fc;border:1px solid #7188a2}small{color:#bed1df}#status{padding:12px;background:#152337;border-radius:8px}a{color:#7ce5cf}</style></head><body><main><h2>NanoC6 — Basic Wi-Fi</h2><p>This is a clean connectivity test. No Oracle, Bluetooth or firmware updater is running.</p><p><b>Setup Wi-Fi:</b> NanoC6-Fresh-Setup</p><p>Setup Wi-Fi remains available while Deco Wi-Fi connects.</p><div id=\"status\">Checking...</div><form id=\"f\"><label>2.4 GHz home Wi-Fi SSID<input name=\"ssid\" maxlength=\"32\" required autocomplete=\"off\"></label><label>Home Wi-Fi password<input type=\"password\" name=\"password\" maxlength=\"63\" autocomplete=\"off\" placeholder=\"Enter password\"></label><button>Save and connect to Wi-Fi</button></form><small>The saved home Wi-Fi settings persist after power loss. Your passwords are never displayed here.</small><p id=\"result\"></p></main><script>\nasync function refresh(){try{const r=await fetch('/api/status',{cache:'no-store'}),j=await r.json();document.getElementById('status').textContent='Firmware: '+j.version+' | Home Wi-Fi: '+(j.connected?'CONNECTED':'NOT CONNECTED')+' | Home IP: '+(j.ip||'none')+' | Setup AP: '+(j.setupAP?'ON':'OFF')+' | Saved network: '+(j.ssidSaved?'YES':'NO')}catch(e){document.getElementById('status').textContent='Connection interrupted; reconnect to NanoC6-Fresh-Setup'}}setInterval(refresh,3000);refresh();\ndocument.getElementById('f').onsubmit=async e=>{e.preventDefault();const out=document.getElementById('result');out.textContent='Saving...';try{const body=new URLSearchParams(new FormData(e.target));const r=await fetch('/save',{method:'POST',body});const t=await r.text();out.textContent=t;await refresh()}catch(e){out.textContent='Save failed; stay connected to the setup Wi-Fi and retry'}};\n</script></body></html>";
static char saved_ssid[33]={0};
static char saved_password[65]={0};
static bool station_online=false;
static esp_netif_t *sta_netif=NULL;

static int hexval(char c){
 if(c>='0'&&c<='9')return c-'0';
 if(c>='a'&&c<='f')return c-'a'+10;
 if(c>='A'&&c<='F')return c-'A'+10;
 return -1;
}
static bool decode_form(const char *data,const char *key,char *out,size_t cap){
 size_t klen=strlen(key);const char *pos=data;
 while(*pos){
  const char *end=strchr(pos,'&');if(!end)end=pos+strlen(pos);
  if((size_t)(end-pos)>klen && strncmp(pos,key,klen)==0&&pos[klen]=='='){
   size_t len=0;
   for(const char *p=pos+klen+1;p<end;p++){
    unsigned char c=(unsigned char)*p;
    if(c=='+')c=' ';
    else if(c=='%'&&end-p>=3){
      int h=hexval(p[1]),l=hexval(p[2]);if(h<0||l<0)return false;
      c=(unsigned char)((h<<4)|l);p+=2;
    }else if(c=='%')return false;
    if(!c||c<32||len+1>=cap)return false;
    out[len++]=(char)c;
   }
   out[len]=0;return true;
  }
  pos=*end?end+1:end;
 }
 return false;
}
static esp_err_t home_get(httpd_req_t *r){
 httpd_resp_set_type(r,"text/html; charset=utf-8");
 httpd_resp_set_hdr(r,"Cache-Control","no-store");
 return httpd_resp_send(r,PAGE,HTTPD_RESP_USE_STRLEN);
}
static esp_err_t status_get(httpd_req_t *r){
 char ip[20]="";
 if(station_online && sta_netif){
  esp_netif_ip_info_t v={0};
  if(esp_netif_get_ip_info(sta_netif,&v)==ESP_OK)
   snprintf(ip,sizeof(ip),IPSTR,IP2STR(&v.ip));
 }
 char data[240];
 snprintf(data,sizeof(data),
  "{\"version\":\"1.0-basic\",\"connected\":%s,\"ssidSaved\":%s,\"setupAP\":true,\"ip\":\"%s\"}",
  station_online?"true":"false",saved_ssid[0]?"true":"false",ip);
 httpd_resp_set_type(r,"application/json");
 httpd_resp_set_hdr(r,"Cache-Control","no-store");
 return httpd_resp_sendstr(r,data);
}
static void wifi_event(void *a,esp_event_base_t b,int32_t id,void *data){
 (void)a;(void)data;
 if(b==WIFI_EVENT && id==WIFI_EVENT_STA_START && saved_ssid[0]){
  ESP_LOGI(TAG,"Attempting saved home Wi-Fi connection");
  esp_wifi_connect();
 }else if(b==WIFI_EVENT && id==WIFI_EVENT_STA_DISCONNECTED){
  station_online=false;
  ESP_LOGW(TAG,"Home Wi-Fi disconnected; retrying, setup AP stays active");
  if(saved_ssid[0])esp_wifi_connect();
 }else if(b==IP_EVENT && id==IP_EVENT_STA_GOT_IP){
  station_online=true;
  ESP_LOGI(TAG,"Home Wi-Fi CONNECTED successfully");
 }
}
static esp_err_t connect_saved(void){
 wifi_config_t sta={0};
 memcpy(sta.sta.ssid,saved_ssid,strnlen(saved_ssid,sizeof(sta.sta.ssid)));
 memcpy(sta.sta.password,saved_password,strnlen(saved_password,sizeof(sta.sta.password)));
 sta.sta.threshold.authmode=WIFI_AUTH_OPEN;
 ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
 ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&sta));
 station_online=false;
 return esp_wifi_connect();
}
static esp_err_t save_post(httpd_req_t *r){
 if(r->content_len<1 || r->content_len>350)
  return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid form size");
 char raw[351]={0};int n=0;
 while(n<r->content_len){
  int rc=httpd_req_recv(r,raw+n,r->content_len-n);
  if(rc<=0)return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Incomplete form");
  n+=rc;
 }
 char ssid[33]={0},password[65]={0};
 if(!decode_form(raw,"ssid",ssid,sizeof(ssid)) ||
    !decode_form(raw,"password",password,sizeof(password)) || !ssid[0])
  return httpd_resp_send_err(r,HTTPD_400_BAD_REQUEST,"Invalid SSID/password");
 if(!password[0]&&strcmp(ssid,saved_ssid)==0)
  snprintf(password,sizeof(password),"%s",saved_password);
 nvs_handle_t h;
 if(nvs_open("basicwifi",NVS_READWRITE,&h)!=ESP_OK)
  return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Cannot open Wi-Fi settings");
 esp_err_t err=nvs_set_str(h,"ssid",ssid);
 if(err==ESP_OK)err=nvs_set_str(h,"password",password);
 if(err==ESP_OK)err=nvs_commit(h);
 nvs_close(h);
 if(err!=ESP_OK)
  return httpd_resp_send_err(r,HTTPD_500_INTERNAL_SERVER_ERROR,"Wi-Fi save failed");
 snprintf(saved_ssid,sizeof(saved_ssid),"%s",ssid);
 snprintf(saved_password,sizeof(saved_password),"%s",password);
 if(connect_saved()!=ESP_OK){
  ESP_LOGW(TAG,"Wi-Fi connect request failed; setup AP remains enabled");
 }
 httpd_resp_set_type(r,"text/plain");
 return httpd_resp_sendstr(r,"Saved. Connecting to your Deco; wait 10-20 seconds. Setup AP stays on.");
}
void app_main(void){
 ESP_LOGI(TAG,"Clean NanoC6 Basic Wi-Fi startup. No BLE or Oracle code.");
 esp_err_t nv=nvs_flash_init();
 if(nv==ESP_ERR_NVS_NO_FREE_PAGES||nv==ESP_ERR_NVS_NEW_VERSION_FOUND){
  ESP_ERROR_CHECK(nvs_flash_erase());
  nv=nvs_flash_init();
 }
 ESP_ERROR_CHECK(nv);
 nvs_handle_t h;
 if(nvs_open("basicwifi",NVS_READONLY,&h)==ESP_OK){
  size_t z=sizeof(saved_ssid);(void)nvs_get_str(h,"ssid",saved_ssid,&z);
  z=sizeof(saved_password);(void)nvs_get_str(h,"password",saved_password,&z);
  nvs_close(h);
 }
 ESP_ERROR_CHECK(esp_netif_init());
 ESP_ERROR_CHECK(esp_event_loop_create_default());
 esp_netif_t *ap=esp_netif_create_default_wifi_ap();
 sta_netif=esp_netif_create_default_wifi_sta();
 if(!ap||!sta_netif){ESP_LOGE(TAG,"Cannot create Wi-Fi interfaces");return;}
 esp_netif_set_hostname(sta_netif,"nanoc6-basic");
 wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
 ESP_ERROR_CHECK(esp_wifi_init(&init));
 ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
 ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
 wifi_config_t config={0};
 snprintf((char*)config.ap.ssid,sizeof(config.ap.ssid),"%s",AP_NAME);
 config.ap.ssid_len=strlen(AP_NAME);
 config.ap.authmode=WIFI_AUTH_OPEN;
 config.ap.channel=1;
 config.ap.max_connection=4;
 ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
 ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP,&config));
 if(saved_ssid[0]){
  wifi_config_t sta={0};
  memcpy(sta.sta.ssid,saved_ssid,strnlen(saved_ssid,sizeof(sta.sta.ssid)));
  memcpy(sta.sta.password,saved_password,strnlen(saved_password,sizeof(sta.sta.password)));
  sta.sta.threshold.authmode=WIFI_AUTH_OPEN;
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&sta));
 }
 ESP_ERROR_CHECK(esp_wifi_start());
 ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
 httpd_config_t http=HTTPD_DEFAULT_CONFIG();
 http.server_port=80;http.max_uri_handlers=5;
 httpd_handle_t server=NULL;
 ESP_ERROR_CHECK(httpd_start(&server,&http));
 httpd_uri_t a={.uri="/",.method=HTTP_GET,.handler=home_get};
 httpd_uri_t b={.uri="/api/status",.method=HTTP_GET,.handler=status_get};
 httpd_uri_t c={.uri="/save",.method=HTTP_POST,.handler=save_post};
 ESP_ERROR_CHECK(httpd_register_uri_handler(server,&a));
 ESP_ERROR_CHECK(httpd_register_uri_handler(server,&b));
 ESP_ERROR_CHECK(httpd_register_uri_handler(server,&c));
 esp_err_t state=esp_ota_mark_app_valid_cancel_rollback();
 ESP_LOGI(TAG,"Runtime marked healthy rc=%d; setup AP %s at http://192.168.4.1 no setup password",state,AP_NAME);
 while(true)vTaskDelay(pdMS_TO_TICKS(30000));
}
