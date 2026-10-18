/*
 * Jason Home 2 native Oracle bridge — staging implementation.
 *
 * Uses the existing /storage LittleFS partition and NVS recovery credentials
 * without erasing or formatting either partition. HTTPS is validated against
 * the same seven CA certificates trusted by the prior Arduino runtime.
 *
 * This module is intentionally NOT started by app_main while the independent
 * native BLE lab firmware is under acceptance testing. It compiles in CI and
 * enables functional migration without replacing the production Nano.
 */
#include "bridge.h"
#include "native_ble.h"
#include "signed_ota.h"
#include "asset_stream.h"
#include "native_commands.h"
#include "native_sequence.h"
#include "esp_ota_ops.h"
#include "mbedtls/base64.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_http_client.h"
#include "nvs.h"
#include "esp_littlefs.h"
#include "cJSON.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"

extern const unsigned char tls_roots_pem_start[] asm("_binary_tls_roots_pem_start");

static const char *TAG="JH2_IDF_ORACLE";
#define WIFI_READY BIT0
#define MAX_ORACLE_BODY 65536
#define MAX_ACKS 16
#define MAX_ENDPOINT 208
#define MAX_NAME 64
#define MAX_TOKEN 65

static char endpoint[MAX_ENDPOINT]={0},bridge_token[MAX_TOKEN]={0},bridge_id[MAX_NAME]={0};
static char ssid[33]={0},password[65]={0};
static char boot_id[17]={0};
static volatile bool bridge_active=false;
static EventGroupHandle_t wifi_group;

typedef struct { uint64_t command_id; char *json; } ack_record;
static ack_record acks[MAX_ACKS]={0};
static size_t ack_count=0;
static uint64_t last_command=0;
static uint64_t restart_after_ack=0;
#define NATIVE_FW_VERSION "1.1.28"
static uint32_t committed_notice_cursor=0;
static SemaphoreHandle_t ack_lock;

typedef struct {char *data; size_t len,cap; bool exceeded;} http_output;
static esp_err_t receive_http(esp_http_client_event_t *event){
    if(event->event_id!=HTTP_EVENT_ON_DATA || !event->user_data)return ESP_OK;
    http_output *out=event->user_data;
    if(event->data_len<=0)return ESP_OK;
    size_t n=(size_t)event->data_len;
    if(out->len+n>=MAX_ORACLE_BODY){out->exceeded=true;return ESP_FAIL;}
    if(out->len+n+1>out->cap){
        size_t next=out->cap?out->cap*2:2048;
        while(next<out->len+n+1)next*=2;
        if(next>MAX_ORACLE_BODY)next=MAX_ORACLE_BODY;
        char *ptr=realloc(out->data,next);
        if(!ptr){out->exceeded=true;return ESP_ERR_NO_MEM;}
        out->data=ptr;out->cap=next;
    }
    memcpy(out->data+out->len,event->data,n);
    out->len+=n;out->data[out->len]=0;
    return ESP_OK;
}
static bool safe_hex64(const char *s){
    if(!s||strlen(s)!=64)return false;
    for(size_t i=0;i<64;i++)if(!isxdigit((unsigned char)s[i]))return false;
    return true;
}
static bool safe_https_endpoint(const char *s){
    if(!s || strncmp(s,"https://",8)!=0 || strlen(s)>MAX_ENDPOINT-50)return false;
    for(const char *p=s;*p;p++)if((unsigned char)*p<0x21 || *p=='#'||*p=='?'||*p=='@')return false;
    return true;
}
static bool json_string(cJSON *root,const char *name,char *dest,size_t cap){
    cJSON *value=cJSON_GetObjectItemCaseSensitive(root,name);
    if(!cJSON_IsString(value)||!value->valuestring)return false;
    const size_t n=strlen(value->valuestring);
    if(n>=cap)return false;
    memcpy(dest,value->valuestring,n+1);return n>0;
}
static cJSON *load_json(const char *path){
    FILE *f=fopen(path,"rb");
    if(!f)return NULL;
    if(fseek(f,0,SEEK_END)!=0){fclose(f);return NULL;}
    long size=ftell(f);
    if(size<=0||size>16384 || fseek(f,0,SEEK_SET)!=0){fclose(f);return NULL;}
    char *b=calloc((size_t)size+1,1);
    if(!b){fclose(f);return NULL;}
    size_t read=fread(b,1,(size_t)size,f);
    fclose(f);
    if(read!=(size_t)size){free(b);return NULL;}
    cJSON *result=cJSON_Parse(b);
    free(b);return result;
}
static bool load_saved_settings(void){
    const esp_vfs_littlefs_conf_t options={
       .base_path="/littlefs",.partition_label="storage",
       .format_if_mount_failed=false,.dont_mount=false,
    };
    esp_err_t err=esp_vfs_littlefs_register(&options);
    if(err!=ESP_OK){
        ESP_LOGE(TAG,"Unable to read existing LittleFS without formatting (err=%s)",esp_err_to_name(err));
        return false;
    }
    cJSON *secrets=load_json("/littlefs/secrets.json");
    if(!secrets){
        ESP_LOGE(TAG,"Existing secrets.json not readable; refusing to reset or re-pair");
        return false;
    }
    bool e=json_string(secrets,"oracleEndpoint",endpoint,sizeof(endpoint));
    bool t=json_string(secrets,"oracleBridgeToken",bridge_token,sizeof(bridge_token));
    bool b=json_string(secrets,"oracleBridgeId",bridge_id,sizeof(bridge_id));
    (void)json_string(secrets,"ssid",ssid,sizeof(ssid));
    (void)json_string(secrets,"wifiPassword",password,sizeof(password));
    cJSON_Delete(secrets);
    if(!e||!t||!b||!safe_https_endpoint(endpoint)||!safe_hex64(bridge_token)){
        ESP_LOGE(TAG,"Saved Oracle credentials missing/invalid; no secrets were changed");
        return false;
    }
    // Existing production firmware mirrors Wi-Fi credentials into NVS. Use
    // the same backup when the legacy LittleFS secrets omit Wi-Fi details.
    if(!ssid[0]){
        nvs_handle_t handle;
        if(nvs_open("jh2-network",NVS_READONLY,&handle)==ESP_OK){
            size_t len=sizeof(ssid);
            if(nvs_get_str(handle,"ssid",ssid,&len)!=ESP_OK)ssid[0]=0;
            len=sizeof(password);
            if(nvs_get_str(handle,"password",password,&len)!=ESP_OK)password[0]=0;
            nvs_close(handle);
        }
    }
    if(!ssid[0]){ESP_LOGE(TAG,"No stored Wi-Fi; no AP/reset triggered");return false;}
    return true;
}
// Server credential rotation is a two-phase exchange. Save the new bridge
// token atomically BEFORE using it, then connect on the following sync to
// confirm the pending token. A failed file write keeps the old token active.
static bool accept_rotated_credentials(const cJSON *credential){
    if(!cJSON_IsObject(credential))return true;
    char next_endpoint[MAX_ENDPOINT]={0},next_token[MAX_TOKEN]={0},next_id[MAX_NAME]={0};
    if(!json_string((cJSON*)credential,"endpoint",next_endpoint,sizeof(next_endpoint))||
       !json_string((cJSON*)credential,"token",next_token,sizeof(next_token))||
       !json_string((cJSON*)credential,"bridgeId",next_id,sizeof(next_id))||
       !safe_https_endpoint(next_endpoint)||!safe_hex64(next_token)){
        ESP_LOGE(TAG,"Received invalid bridge credential rotation; preserving current token");
        return false;
    }
    cJSON *secrets=load_json("/littlefs/secrets.json");
    if(!secrets)return false;
    cJSON_DeleteItemFromObjectCaseSensitive(secrets,"oracleEndpoint");
    cJSON_DeleteItemFromObjectCaseSensitive(secrets,"oracleBridgeToken");
    cJSON_DeleteItemFromObjectCaseSensitive(secrets,"oracleBridgeId");
    cJSON_AddStringToObject(secrets,"oracleEndpoint",next_endpoint);
    cJSON_AddStringToObject(secrets,"oracleBridgeToken",next_token);
    cJSON_AddStringToObject(secrets,"oracleBridgeId",next_id);
    char *encoded=cJSON_PrintUnformatted(secrets);
    cJSON_Delete(secrets);
    if(!encoded)return false;
    size_t count=strlen(encoded);
    bool saved=false;
    if(count>0&&count<16384){
        FILE *f=fopen("/littlefs/secrets.json.tmp","wb");
        if(f){
            size_t written=fwrite(encoded,1,count,f);
            bool flushed=written==count && fflush(f)==0 && fsync(fileno(f))==0;
            int closed=fclose(f);f=NULL;
            if(flushed && closed==0 &&
               rename("/littlefs/secrets.json.tmp","/littlefs/secrets.json")==0)
                saved=true;
            if(!saved)remove("/littlefs/secrets.json.tmp");
        }
    }
    free(encoded);
    if(!saved){
        ESP_LOGE(TAG,"Credential rotation persistence failed; old token retained");
        return false;
    }
    strcpy(endpoint,next_endpoint);
    strcpy(bridge_token,next_token);
    strcpy(bridge_id,next_id);
    ESP_LOGI(TAG,"Oracle rotated bridge credentials; token redacted and persisted");
    return true;
}
static void wifi_event(void *arg,esp_event_base_t base,int32_t event,void *data){
    (void)arg;(void)data;
    if(base==WIFI_EVENT){
        if(event==WIFI_EVENT_STA_START || event==WIFI_EVENT_STA_DISCONNECTED){
            xEventGroupClearBits(wifi_group,WIFI_READY);
            esp_wifi_connect();
        }
    }else if(base==IP_EVENT && event==IP_EVENT_STA_GOT_IP){
        xEventGroupSetBits(wifi_group,WIFI_READY);
    }
}
static bool wifi_setup(void){
    wifi_group=xEventGroupCreate();
    if(!wifi_group)return false;
    if(esp_netif_init()!=ESP_OK)return false;
    if(esp_event_loop_create_default()!=ESP_OK)return false;
    if(!esp_netif_create_default_wifi_sta())return false;
    wifi_init_config_t cfg=WIFI_INIT_CONFIG_DEFAULT();
    if(esp_wifi_init(&cfg)!=ESP_OK)return false;
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
    wifi_config_t connection_cfg={0};
    memcpy(connection_cfg.sta.ssid,ssid,strlen(ssid));
    memcpy(connection_cfg.sta.password,password,strlen(password));
    connection_cfg.sta.threshold.authmode=WIFI_AUTH_OPEN; // allow configured home network's auth level
    connection_cfg.sta.pmf_cfg.capable=true;
    connection_cfg.sta.pmf_cfg.required=false;
    if(esp_wifi_set_mode(WIFI_MODE_STA)!=ESP_OK ||
       esp_wifi_set_config(WIFI_IF_STA,&connection_cfg)!=ESP_OK ||
       esp_wifi_start()!=ESP_OK)return false;
    esp_wifi_set_ps(WIFI_PS_NONE);
    return true;
}
static cJSON *https_json(const char *path,const char *request_text){
    const size_t endpoint_len=strlen(endpoint),path_len=strlen(path);
    if(endpoint_len+path_len+1>MAX_ENDPOINT+256)return NULL;
    char *url=malloc(endpoint_len+path_len+1);
    if(!url)return NULL;
    const bool public_firmware=strcmp(path,"/api/public-signed-manifest")==0;
    static const char FIRMWARE_URL[]=
        "https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/jh2-nanoc6-ota/latest.json";
    if(public_firmware){
        free(url);url=strdup(FIRMWARE_URL);if(!url)return NULL;
    }else{
        memcpy(url,endpoint,endpoint_len);
        memcpy(url+endpoint_len,path,path_len+1);
    }
    http_output out={0};
    esp_http_client_config_t config={
        .url=url,.cert_pem=(const char *)tls_roots_pem_start,
        .event_handler=receive_http,.user_data=&out,
        .timeout_ms=13000,.buffer_size=2048,.buffer_size_tx=2048,
    };
    esp_http_client_handle_t http=esp_http_client_init(&config);
    free(url);
    if(!http)return NULL;
    char auth[75];
    snprintf(auth,sizeof(auth),"Bearer %s",bridge_token);
    // Never send a private Oracle bridge credential to the public release channel.
    if(!public_firmware){
        esp_http_client_set_header(http,"Authorization",auth);
        esp_http_client_set_header(http,"X-JH2-Bridge-Token",bridge_token);
    }
    esp_http_client_set_header(http,"Content-Type","application/json");
    if(request_text){
        esp_http_client_set_method(http,HTTP_METHOD_POST);
        esp_http_client_set_post_field(http,request_text,(int)strlen(request_text));
    }else esp_http_client_set_method(http,HTTP_METHOD_GET);
    esp_err_t rc=esp_http_client_perform(http);
    int code=esp_http_client_get_status_code(http);
    cJSON *result=NULL;
    if(rc==ESP_OK&&code==200&&!out.exceeded&&out.data&&out.len){
        result=cJSON_ParseWithLength(out.data,out.len);
    }else{
        ESP_LOGW(TAG,"Oracle HTTPS request failed rc=%s code=%d bytes=%u",esp_err_to_name(rc),code,(unsigned)out.len);
    }
    esp_http_client_cleanup(http);
    free(out.data);
    return result;
}
static void append_ack(uint64_t command_id,const char *state,const char *message,bool ble_transmitted){
    cJSON *record=cJSON_CreateObject();
    if(!record)return;
    cJSON_AddNumberToObject(record,"id",(double)command_id);
    cJSON_AddStringToObject(record,"state",state);
    cJSON *result=cJSON_AddObjectToObject(record,"result");
    cJSON_AddBoolToObject(result,"ok",strcmp(state,"failed")!=0);
    cJSON_AddStringToObject(result,"message",message);
    cJSON_AddBoolToObject(result,"bleTransmitted",ble_transmitted);
    cJSON_AddBoolToObject(result,"connected",ble_transmitted);
    cJSON_AddBoolToObject(result,"physicalPlaybackConfirmed",false);
    char *json=cJSON_PrintUnformatted(record);
    cJSON_Delete(record);
    if(!json)return;
    xSemaphoreTake(ack_lock,portMAX_DELAY);
    if(ack_count<MAX_ACKS){
        acks[ack_count++]=(ack_record){.command_id=command_id,.json=json};
    }else{
        // Never falsely ACK a command. Stop buffering new commands until
        // the Oracle sync has confirmed the prior ACK batch.
        free(json);
        ESP_LOGE(TAG,"ACK_BUFFER_FULL: refusing command; existing ACKs retained");
    }
    xSemaphoreGive(ack_lock);
}
static void asset_report(uint64_t id,const char *state,const char *message,bool ble){
    append_ack(id,state,message,ble);
}
static void handle_command(const cJSON *row,const cJSON *assets){
    cJSON *id=cJSON_GetObjectItemCaseSensitive(row,"id");
    cJSON *action=cJSON_GetObjectItemCaseSensitive(row,"action");
    cJSON *payload=cJSON_GetObjectItemCaseSensitive(row,"payload");
    if(!cJSON_IsNumber(id)||!cJSON_IsString(action)||!action->valuestring)return;
    const uint64_t current=(uint64_t)id->valuedouble;
    if(current<=last_command)return;
#if CONFIG_JH2_NATIVE_READONLY_ACCEPTANCE
    // Stage-1 field acceptance: Oracle provides diagnostics and read-only
    // 205/167/2904 ONLY. Queued old visual, OTA, upload, or schedule actions
    // must not mutate the curtain during inventory recovery.
    if(strcmp(action->valuestring,"rawWrite")!=0 &&
       strcmp(action->valuestring,"status")!=0 &&
       strcmp(action->valuestring,"nanoInfo")!=0 &&
       strcmp(action->valuestring,"connect")!=0 &&
       strcmp(action->valuestring,"subscribeRaw")!=0){
        append_ack(current,"failed","Native read-only acceptance: display writes and OTA disabled",false);
        last_command=current;
        return;
    }
#endif
    if(strcmp(action->valuestring,"sequenceStart")==0){
        cJSON *items=cJSON_GetObjectItemCaseSensitive(payload,"effects");
        cJSON *interval=cJSON_GetObjectItemCaseSensitive(payload,"intervalSeconds");
        uint8_t effects[88]={0};int n=cJSON_IsArray(items)?cJSON_GetArraySize(items):0;
        bool valid=n>=2&&n<=88&&cJSON_IsNumber(interval)
            &&interval->valueint>=5&&interval->valueint<=3600;
        if(valid){
            for(int i=0;i<n;i++){
                cJSON *item=cJSON_GetArrayItem(items,i);
                if(!cJSON_IsNumber(item)||item->valueint<0||item->valueint>87){valid=false;break;}
                effects[i]=(uint8_t)item->valueint;
            }
        }
        jh2_asset_stream_stop();
        bool started=valid&&jh2_native_sequence_start(effects,(size_t)n,(uint32_t)interval->valueint);
        append_ack(current,started?"applied":"failed",
            started?"Native effect sequence started":"Invalid sequence or BLE unavailable",started);
    }else if(strcmp(action->valuestring,"assetStop")==0){
        jh2_asset_stream_stop();
        append_ack(current,"applied","Native image stream stop requested; last frame retained",false);
    }else if(strcmp(action->valuestring,"asset")==0){
        jh2_native_sequence_stop();
        cJSON *requested=cJSON_GetObjectItemCaseSensitive(payload,"sha256");
        const char *sha=cJSON_IsString(requested)?requested->valuestring:NULL;
        uint32_t bytes=0;
        cJSON *entry=NULL;
        if(sha&&strlen(sha)==64){
            cJSON_ArrayForEach(entry,assets){
                cJSON *digest=cJSON_GetObjectItemCaseSensitive(entry,"sha256");
                cJSON *count=cJSON_GetObjectItemCaseSensitive(entry,"bytes");
                if(cJSON_IsString(digest)&&cJSON_IsNumber(count) &&
                   strcmp(digest->valuestring,sha)==0&&count->valuedouble>0 &&
                   count->valuedouble<=4194304){
                    bytes=(uint32_t)count->valuedouble;
                    break;
                }
            }
        }
        bool started=bytes&&jh2_asset_stream_start(endpoint,bridge_token,sha,bytes,current,asset_report);
        append_ack(current,started?"downloaded":"failed",
           started?"Authenticated Oracle image stream started":"Native image asset missing or another stream active",false);
    }else if(strcmp(action->valuestring,"status")==0||strcmp(action->valuestring,"nanoInfo")==0){
        append_ack(current,"applied","Native ESP-IDF connected to Oracle",false);
    }else if(strcmp(action->valuestring,"nanoAutoUpdate")==0){
        cJSON *enabled=cJSON_GetObjectItemCaseSensitive(payload,"enabled");
        if(cJSON_IsFalse(enabled))
            append_ack(current,"applied","Automatic updates remain disabled",false);
        else
            append_ack(current,"failed","No automatic updates during native firmware migration",false);
    }else if(strcmp(action->valuestring,"nanoFirmwareCheck")==0){
        cJSON *m=https_json("/api/public-signed-manifest",NULL);
        char version[32]={0},error[150]={0};
        bool valid=m&&jh2_validate_signed_manifest(m,NATIVE_FW_VERSION,version,sizeof(version),error,sizeof(error));
        append_ack(current,valid?"applied":"failed",valid?"New signed update available":
            (m?error:"Signed firmware manifest download unavailable"),false);
        cJSON_Delete(m);
    }else if(strcmp(action->valuestring,"nanoInstallUpdate")==0){
        cJSON *m=https_json("/api/public-signed-manifest",NULL);
        char error[150]={0};
        bool installed=m&&jh2_queue_signed_update(m,NATIVE_FW_VERSION,error,sizeof(error));
        append_ack(current,installed?"applied":"failed",
          installed?"Verified signed update queued in permanent updater":
          (m?error:"Signed firmware manifest download unavailable"),false);
        if(installed)restart_after_ack=current;
        cJSON_Delete(m);
    }else if(strcmp(action->valuestring,"connect")==0||
             strcmp(action->valuestring,"subscribeRaw")==0){
        append_ack(current,"applied","Native GATT connection managed by NimBLE central",false);
    }else if(strcmp(action->valuestring,"power")==0 ||
             strcmp(action->valuestring,"brightness")==0 ||
             strcmp(action->valuestring,"speed")==0 ||
             strcmp(action->valuestring,"layout")==0 ||
             strcmp(action->valuestring,"effect")==0 ||
             strcmp(action->valuestring,"nativePlay")==0 ||
             strcmp(action->valuestring,"solid")==0){
        // An explicit visual command supersedes an old long-running animation.
        jh2_native_sequence_stop();
        if(jh2_asset_stream_active()){
            jh2_asset_stream_stop();
            for(int wait=0;wait<70&&jh2_asset_stream_active();wait++)
                vTaskDelay(pdMS_TO_TICKS(30));
        }
        bool delivered=false;
        cJSON *value=cJSON_GetObjectItemCaseSensitive(payload,"value");
        const char *name=action->valuestring;
        if(!jh2_asset_stream_active()){
            if(strcmp(name,"power")==0){
                cJSON *on=cJSON_GetObjectItemCaseSensitive(payload,"on");
                if(cJSON_IsBool(on))delivered=jh2_native_power(cJSON_IsTrue(on));
            }else if(strcmp(name,"brightness")==0){
                if(cJSON_IsNumber(value))delivered=jh2_native_brightness(value->valueint);
            }else if(strcmp(name,"speed")==0){
                if(cJSON_IsNumber(value))delivered=jh2_native_speed(value->valueint);
            }else if(strcmp(name,"layout")==0){
                if(cJSON_IsNumber(value))delivered=jh2_native_layout(value->valueint);
            }else if(strcmp(name,"effect")==0){
                cJSON *id=cJSON_GetObjectItemCaseSensitive(payload,"id");
                if(cJSON_IsNumber(id))delivered=jh2_native_effect(id->valueint);
            }else if(strcmp(name,"nativePlay")==0){
                cJSON *cid=cJSON_GetObjectItemCaseSensitive(payload,"cid");
                cJSON *slot=cJSON_GetObjectItemCaseSensitive(payload,"slot");
                if(cJSON_IsNumber(cid)&&cJSON_IsNumber(slot)&&cid->valuedouble>=0&&slot->valuedouble>=0)
                    delivered=jh2_native_play((uint32_t)cid->valuedouble,(uint32_t)slot->valuedouble);
            }else if(strcmp(name,"solid")==0){
                cJSON *color=cJSON_GetObjectItemCaseSensitive(payload,"color");
                cJSON *level=cJSON_GetObjectItemCaseSensitive(payload,"brightness");
                if(cJSON_IsString(color)&&color->valuestring&&strlen(color->valuestring)==7
                   &&color->valuestring[0]=='#'){
                    bool valid=true;
                    for(int i=1;i<7;i++)
                        if(!isxdigit((unsigned char)color->valuestring[i]))valid=false;
                    if(valid)delivered=jh2_native_solid(
                        (uint32_t)strtoul(color->valuestring+1,NULL,16),
                        cJSON_IsNumber(level)?level->valueint:100);
                }
            }
        }
        append_ack(current,delivered?"applied":"failed",
          delivered?"Native SmartDawn command acknowledged by GATT; physical display unconfirmed":
          "Native SmartDawn command rejected or GATT unavailable",delivered);
    }else if(strcmp(action->valuestring,"sequenceStop")==0){
        jh2_native_sequence_stop();
        jh2_asset_stream_stop();
        append_ack(current,"applied","Native sequence/stream stop requested",false);
    }else if(strcmp(action->valuestring,"nanoResumeOracle")==0){
        append_ack(current,"applied","Oracle scheduling resumed",false);
    }else if(strcmp(action->valuestring,"rawWrite")==0){
        cJSON *uuid=cJSON_GetObjectItemCaseSensitive(payload,"uuid");
        cJSON *data=cJSON_GetObjectItemCaseSensitive(payload,"data");
        if(!cJSON_IsString(uuid)||!cJSON_IsString(data)){
            append_ack(current,"failed","Missing BLE UUID or data",false);
        }else{
            uint8_t bytes[508];size_t n=0;
            int rc=mbedtls_base64_decode(bytes,sizeof(bytes),&n,
                (const unsigned char*)data->valuestring,strlen(data->valuestring));
            // During acceptance testing allow only known read-only command
            // opcodes, on the single catalog-control characteristic.
            bool safe=rc==0 && n>=24 && n<=508
                && bytes[1]==1 && bytes[2]==0 && bytes[3]==0
                && bytes[4]==0xf0 &&
                (((uint16_t)bytes[10]<<8)|bytes[11])!=2909;
            uint16_t op=safe?(((uint16_t)bytes[10]<<8)|bytes[11]):0;
            safe=safe&&(op==205||op==167||op==2904)
                && strcmp(uuid->valuestring,"01020074-1972-1925-3022-077119514e44")==0;
            if(!safe){
                append_ack(current,"failed","Native migration permits only read-only 205/167/2904; no erase or upload",false);
            }else{
                bool success=jh2_ble_raw_write(uuid->valuestring,bytes,n,12000);
                append_ack(current,success?"applied":"failed",
                    success?"Native GATT read packet acknowledged":"Native GATT read packet not acknowledged",
                    success);
            }
        }
    }else{
        append_ack(current,"failed","Native migration not yet accepted for display or upload commands",false);
    }
    last_command=current;
}
static void initial_boot_id(void){
    uint64_t n=((uint64_t)esp_random()<<32)|esp_random();
    snprintf(boot_id,sizeof(boot_id),"%016llx",(unsigned long long)n);
}
static cJSON *sync_document(void){
    cJSON *body=cJSON_CreateObject();
    if(!body)return NULL;
    cJSON_AddStringToObject(body,"bridgeId",bridge_id);
    cJSON_AddStringToObject(body,"bootId",boot_id);
    cJSON *status=cJSON_AddObjectToObject(body,"status");
    cJSON_AddStringToObject(status,"firmware",NATIVE_FW_VERSION);
    cJSON_AddNumberToObject(status,"uptimeSeconds",(double)(esp_timer_get_time()/1000000));
    cJSON_AddBoolToObject(status,"autoUpdate",false);
    cJSON_AddBoolToObject(status,"nativeReadOnlyAcceptance",CONFIG_JH2_NATIVE_READONLY_ACCEPTANCE);
    cJSON_AddBoolToObject(status,"relayStreaming",jh2_asset_stream_active());
    cJSON_AddStringToObject(status,"assetStorage","oracle");
    cJSON *curtain=cJSON_AddObjectToObject(status,"curtain");
    jh2_ble_status(curtain);
    cJSON_AddBoolToObject(curtain,"sequenceRunning",jh2_native_sequence_running());
    cJSON *notifications=cJSON_AddArrayToObject(body,"notifications");
    (void)jh2_ble_collect_notices(notifications,committed_notice_cursor);
    cJSON *batch=cJSON_AddArrayToObject(body,"acks");
    xSemaphoreTake(ack_lock,portMAX_DELAY);
    for(size_t i=0;i<ack_count;i++){
        cJSON *row=cJSON_Parse(acks[i].json);
        if(row)cJSON_AddItemToArray(batch,row);
    }
    xSemaphoreGive(ack_lock);
    return body;
}
static void clear_sent_ack_batch(size_t sent){
    xSemaphoreTake(ack_lock,portMAX_DELAY);
    if(sent>ack_count)sent=ack_count;
    for(size_t i=0;i<sent;i++)free(acks[i].json);
    for(size_t i=sent;i<ack_count;i++)acks[i-sent]=acks[i];
    ack_count-=sent;
    xSemaphoreGive(ack_lock);
}
static void oracle_task(void *ctx){
    (void)ctx;
    if(!load_saved_settings() || !wifi_setup()){
        ESP_LOGE(TAG,"Native bridge disabled; saved production settings unchanged");
        vTaskDelete(NULL);return;
    }
    initial_boot_id();
    bridge_active=true;
    uint32_t retry_ms=1000;
    while(true){
        if(!(xEventGroupWaitBits(wifi_group,WIFI_READY,pdFALSE,pdTRUE,pdMS_TO_TICKS(12000))&WIFI_READY)){
            vTaskDelay(pdMS_TO_TICKS(1200));continue;
        }
        cJSON *body=sync_document();
        if(!body){vTaskDelay(pdMS_TO_TICKS(1500));continue;}
        int sent=cJSON_GetArraySize(cJSON_GetObjectItemCaseSensitive(body,"acks"));
        cJSON *sent_notices=cJSON_GetObjectItemCaseSensitive(body,"notifications");
        uint32_t final_notice=committed_notice_cursor;
        if(cJSON_IsArray(sent_notices)){
            int count=cJSON_GetArraySize(sent_notices);
            if(count>0){
                cJSON *last=cJSON_GetArrayItem(sent_notices,count-1);
                cJSON *notice_id=cJSON_GetObjectItemCaseSensitive(last,"id");
                if(cJSON_IsNumber(notice_id))final_notice=(uint32_t)notice_id->valuedouble;
            }
        }
        bool restart_ack_included=false;
        if(restart_after_ack){
            cJSON *row=NULL;
            cJSON_ArrayForEach(row,cJSON_GetObjectItemCaseSensitive(body,"acks")){
                cJSON *id=cJSON_GetObjectItemCaseSensitive(row,"id");
                if(cJSON_IsNumber(id) && (uint64_t)id->valuedouble==restart_after_ack){
                    restart_ack_included=true;break;
                }
            }
        }
        char *data=cJSON_PrintUnformatted(body);
        cJSON_Delete(body);
        cJSON *reply=data?https_json("/api/curtain-bridge/sync",data):NULL;
        free(data);
        if(!reply){
            vTaskDelay(pdMS_TO_TICKS(retry_ms));
            if(retry_ms<8000)retry_ms*=2;
            continue;
        }
        retry_ms=1000;
        (void)accept_rotated_credentials(cJSON_GetObjectItemCaseSensitive(reply,"credential"));
        clear_sent_ack_batch((size_t)sent);
        committed_notice_cursor=final_notice;
        if(restart_ack_included){
            ESP_LOGW(TAG,"Signed OTA acknowledged by Oracle; selecting permanent boot updater");
            vTaskDelay(pdMS_TO_TICKS(400));
            esp_restart();
        }
        cJSON *commands=cJSON_GetObjectItemCaseSensitive(reply,"commands");
        if(cJSON_IsArray(commands)){
            cJSON *row=NULL;
            cJSON_ArrayForEach(row,commands){
                handle_command(row,cJSON_GetObjectItemCaseSensitive(reply,"assets"));
                break; // Preserve sequential ACK and Oracle ordering
            }
        }
        cJSON_Delete(reply);
        vTaskDelay(pdMS_TO_TICKS(1100));
    }
}
void jh2_bridge_start(void){
    if(bridge_active)return;
    ack_lock=xSemaphoreCreateMutex();
    if(!ack_lock)return;
    if(xTaskCreate(oracle_task,"jh2-idf-oracle",12288,NULL,4,NULL)!=pdPASS){
        vSemaphoreDelete(ack_lock);
        ack_lock=NULL;
        ESP_LOGE(TAG,"Unable to start native Oracle task");
    }
}
bool jh2_bridge_ready(void){return bridge_active;}
