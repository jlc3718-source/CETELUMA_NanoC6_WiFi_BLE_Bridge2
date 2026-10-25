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
#include "native_slot_guard.h"
#include "signed_ota.h"
#include "asset_stream.h"
#include "native_slot_upload.h"
#include "native_commands.h"
#include "native_sequence.h"
#include "web_recovery.h"
#include "native_recovery.h"
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
// Recovery runtime: boot safely with automatic signed OTA OFF by default.
// Existing NVS is preserved; OTA may only be re-enabled explicitly after recovery.
static volatile bool firmware_auto_update=false;
bool jh2_bridge_auto_update_enabled(void){return firmware_auto_update;}
bool jh2_bridge_set_auto_update_enabled(bool enabled){
    // Owner freeze. Do not allow 2.0.x to enable autonomous firmware OTA.
    if(enabled){ESP_LOGW(TAG,"2.0.1 firmware freeze: automatic OTA remains disabled");return false;}
    nvs_handle_t n;
    if(nvs_open("jh2-fwcfg",NVS_READWRITE,&n)!=ESP_OK)return false;
    esp_err_t error=nvs_set_u8(n,"auto",enabled?1:0);
    if(error==ESP_OK)error=nvs_commit(n);
    nvs_close(n);
    if(error!=ESP_OK)return false;
    firmware_auto_update=enabled;
    return true;
}
static void jh2_load_auto_ota(void){
    nvs_handle_t n;
    if(nvs_open("jh2-fwcfg",NVS_READONLY,&n)!=ESP_OK)return;
    uint8_t stored=0;
    // Read historical preference without re-arming the failing 1.1.72 OTA loop.
    (void)nvs_get_u8(n,"auto",&stored);
    nvs_close(n);
    firmware_auto_update=false;
}
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
static volatile bool bridge_start_requested=false;
static volatile bool oracle_link_busy=false;
static volatile bool oracle_link_verified=false;
static const char *oracle_link_status="Not linked. Open Settings > Oracle and select Connect Automatically.";
static EventGroupHandle_t wifi_group;

typedef struct { uint64_t command_id; char *json; } ack_record;
static ack_record acks[MAX_ACKS]={0};
static size_t ack_count=0;
static uint64_t last_command=0;
static uint64_t restart_after_ack=0;
#define NATIVE_FW_VERSION "2.0.3"
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
    if(err!=ESP_OK && err!=ESP_ERR_INVALID_STATE){
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
// Native web/recovery service OWNS Wi-Fi, AP fallback, mDNS and DHCP.
// The Oracle transport shares its connection; never initialize Wi-Fi twice.
static bool wifi_setup(void){
    wifi_group=jh2_web_wifi_group();
    if(!wifi_group){
        ESP_LOGE(TAG,"Native Wi-Fi service unavailable; Oracle bridge not started");
        return false;
    }
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
// Small, read-only manufacturer thumbnail tunnel using the existing pinned
// Oracle TLS CA and Nano bridge credentials. No credentials reach the phone.
bool jh2_bridge_factory_preview(uint8_t effect,uint8_t **bytes,size_t *length){
    if(bytes)*bytes=NULL;
    if(length)*length=0;
    if(!bytes||!length||effect>87||!jh2_bridge_ready())return false;
    char url[MAX_ENDPOINT+80];
    const int n=snprintf(url,sizeof(url),"%s/api/curtain-bridge/preview/%u",
                         endpoint,(unsigned)effect);
    if(n<1||(size_t)n>=sizeof(url))return false;
    http_output out={0};
    const esp_http_client_config_t cfg={
        .url=url,.cert_pem=(const char *)tls_roots_pem_start,
        .event_handler=receive_http,.user_data=&out,
        .timeout_ms=11000,.buffer_size=2048,.buffer_size_tx=1024,
    };
    esp_http_client_handle_t http=esp_http_client_init(&cfg);
    if(!http)return false;
    char auth[75];snprintf(auth,sizeof(auth),"Bearer %s",bridge_token);
    esp_http_client_set_header(http,"Authorization",auth);
    esp_http_client_set_header(http,"X-JH2-Bridge-Token",bridge_token);
    esp_http_client_set_method(http,HTTP_METHOD_GET);
    const esp_err_t rc=esp_http_client_perform(http);
    const int status=esp_http_client_get_status_code(http);
    const bool valid=rc==ESP_OK&&status==200&&!out.exceeded&&
       out.data&&out.len>=64&&out.len<=16000&&
       memcmp(out.data,"RIFF",4)==0&&memcmp(out.data+8,"WEBP",4)==0;
    esp_http_client_cleanup(http);
    if(valid){*bytes=(uint8_t *)out.data;*length=out.len;return true;}
    free(out.data);
    ESP_LOGW(TAG,"Factory preview unavailable id=%u status=%d",
       (unsigned)effect,status);
    return false;
}
bool jh2_bridge_signed_firmware(bool install,char *version,size_t version_size,
                                char *error,size_t error_size){
    if(error && error_size)error[0]=0;
    if(version && version_size)version[0]=0;
    if(!jh2_bridge_ready()){
        if(error && error_size)snprintf(error,error_size,"Oracle bridge not connected");
        return false;
    }
    // Use the same trusted Oracle origin as the working encrypted bridge.
    // The existing public signed manifest endpoint on Oracle also serves
    // the factory updater; the browser never accepts arbitrary URLs.
    cJSON *manifest=https_json("/api/curtain/firmware-manifest",NULL);
    if(!manifest){
        if(error && error_size)snprintf(error,error_size,"Oracle signed manifest unavailable");
        return false;
    }
    char fetched[32]={0};
    bool ok=jh2_validate_signed_manifest(manifest,NATIVE_FW_VERSION,
        fetched,sizeof(fetched),error,error_size);
    if(ok&&install)
        ok=jh2_queue_signed_update(manifest,NATIVE_FW_VERSION,error,error_size);
    if(ok&&version&&version_size)snprintf(version,version_size,"%s",fetched);
    cJSON_Delete(manifest);
    return ok;
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
// Stop is asynchronous because the worker may be in an HTTPS read. Do not
// acknowledge a clean Stop or accept a replacement until that worker exits.
static bool stop_image_stream_and_wait(void){
    jh2_asset_stream_stop();
    for(int attempt=0;attempt<160&&jh2_asset_stream_active();attempt++)
        vTaskDelay(pdMS_TO_TICKS(100));
    return !jh2_asset_stream_active();
}
#if CONFIG_JH2_NATIVE_READONLY_ACCEPTANCE
#define NATIVE_SLOT_READ_ONLY true
#else
#define NATIVE_SLOT_READ_ONLY false
#endif
static jh2_slot_session native_slot_session={0};
static char staged_native_sha[65]={0};
static uint32_t staged_native_cid=0,staged_native_size=0;

static bool slot_write_ram(void *context,const uint8_t *packet,size_t len){
    (void)context;return jh2_ble_raw_write(JH2_SLOT_UPLOAD_UUID,packet,len,2000);
}
static bool slot_reply_ram(void *context,uint16_t opcode,uint8_t id,uint32_t parts,const char **error){
    return jh2_ble_upload_reply((uint32_t*)context,opcode,id,parts,12000,error);
}
static void slot_pace_ram(void *context){(void)context;vTaskDelay(pdMS_TO_TICKS(25));}
/* Native flash writes need controller processing time; the 25ms unthrottled
 * 1.1.70 transfer received controller final rejection code 251. Keep RAM test
 * uploader unchanged, pace registered files at 120ms plus true 2933 ACKs. */
static void slot_pace_native(void *context){(void)context;vTaskDelay(pdMS_TO_TICKS(120));}
static bool slot_progress_native(void *context,uint32_t parts,uint32_t minimum,
                                 const char **error){
    return jh2_ble_upload_progress((uint32_t*)context,parts,minimum,15000,error);
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
       strcmp(action->valuestring,"subscribeRaw")!=0 &&
       strcmp(action->valuestring,"nanoFirmwareCheck")!=0 &&
       strcmp(action->valuestring,"nanoInstallUpdate")!=0 &&
       strcmp(action->valuestring,"nanoEnterRecovery")!=0){
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
        bool idle=stop_image_stream_and_wait();
        bool started=idle&&valid&&jh2_native_sequence_start(effects,(size_t)n,(uint32_t)interval->valueint);
        append_ack(current,started?"applied":"failed",
            started?"Native effect sequence started":"Invalid sequence or BLE unavailable",started);
    }else if(strcmp(action->valuestring,"assetSpeed")==0){
        cJSON *percent=cJSON_GetObjectItemCaseSensitive(payload,"percent");
        const bool valid=cJSON_IsNumber(percent)&&percent->valuedouble==(double)percent->valueint &&
                         percent->valueint>=25&&percent->valueint<=300;
        const bool accepted=valid&&jh2_asset_stream_set_speed((uint16_t)percent->valueint);
        append_ack(current,accepted?"applied":"failed",
            accepted?"Nano animation speed adjusted locally without stopping playback":
                     "Invalid speed; use 25 to 300 percent",false);
    }else if(strcmp(action->valuestring,"assetStop")==0){
        bool idle=stop_image_stream_and_wait();
        append_ack(current,idle?"applied":"failed",
            idle?"Native image stream fully stopped; ready for next image":
                 "Image stream stop timed out; next image not yet safe",false);
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
        // New image replaces a previous loop atomically at the BLE worker
        // boundary. Do not make the caller send a separate Stop first.
        bool idle=stop_image_stream_and_wait();
        bool started=idle&&bytes&&jh2_asset_stream_start(endpoint,bridge_token,sha,bytes,current,asset_report);
        append_ack(current,started?"downloaded":"failed",
           started?"Authenticated Oracle image stream started":
                    (!idle?"Previous image stream is still stopping":
                     "Requested image digest missing from Oracle sync or BLE worker unavailable"),false);

    }else if(strcmp(action->valuestring,"nativeSlotStage")==0){
        cJSON *digest=cJSON_GetObjectItemCaseSensitive(payload,"sha256");
        cJSON *target=cJSON_GetObjectItemCaseSensitive(payload,"cid");
        const char *sha=cJSON_IsString(digest)?digest->valuestring:NULL;
        uint32_t cid=cJSON_IsNumber(target)&&target->valuedouble>=1&&
            target->valuedouble<=4294967295.0?(uint32_t)target->valuedouble:0;
        uint32_t bytes=0;cJSON *entry=NULL;
        cJSON_ArrayForEach(entry,assets){
            cJSON *h=cJSON_GetObjectItemCaseSensitive(entry,"sha256");
            cJSON *count=cJSON_GetObjectItemCaseSensitive(entry,"bytes");
            cJSON *assigned=cJSON_GetObjectItemCaseSensitive(entry,"cid");
            if(sha&&cJSON_IsString(h)&&!strcmp(sha,h->valuestring)&&
               cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(entry,"native"))&&
               cJSON_IsNumber(assigned)&&assigned->valuedouble==(double)cid&&
               cJSON_IsNumber(count)&&count->valuedouble>=8192&&
               count->valuedouble<=JH2_NATIVE_LOCAL_LIMIT){
                bytes=(uint32_t)count->valuedouble;break;
            }
        }
        // No controller erase or BLE upload occurs during staging. Any
        // failure leaves the existing SmartDawn effect entirely untouched.
        staged_native_sha[0]=0;staged_native_size=0;staged_native_cid=0;
        bool ready=sha&&safe_hex64(sha)&&cid&&bytes&&!NATIVE_SLOT_READ_ONLY;
        if(ready){jh2_native_sequence_stop();ready=stop_image_stream_and_wait();}
        if(ready)ready=jh2_asset_stage_native(endpoint,bridge_token,sha,bytes,cid);
        if(ready){
            memcpy(staged_native_sha,sha,64);staged_native_sha[64]=0;
            staged_native_size=bytes;staged_native_cid=cid;
        }
        append_ack(current,ready?"applied":"failed",
            ready?"Whole native .eff staged to Nano LittleFS and SHA-256/CID verified; old controller effect unchanged":
                  "Native local stage rejected: invalid CID, insufficient flash or authenticated download failed",false);
    }else if(strcmp(action->valuestring,"nativeSlotCommit")==0){
        cJSON *digest=cJSON_GetObjectItemCaseSensitive(payload,"sha256");
        cJSON *target=cJSON_GetObjectItemCaseSensitive(payload,"cid");
        const char *sha=cJSON_IsString(digest)?digest->valuestring:NULL;
        uint32_t cid=cJSON_IsNumber(target)&&target->valuedouble>=1&&
            target->valuedouble<=4294967295.0?(uint32_t)target->valuedouble:0;
        const char *error="No matching verified Nano-local native effect staged";
        bool ready=sha&&safe_hex64(sha)&&cid&&staged_native_size&&
                   cid==staged_native_cid&&!strcmp(sha,staged_native_sha)&&
                   !NATIVE_SLOT_READ_ONLY;
        if(ready){jh2_native_sequence_stop();ready=stop_image_stream_and_wait();}
        if(ready)ready=jh2_asset_native_verified(sha,staged_native_size,cid);
        if(ready){
            unsigned matches=0;uint16_t slot=0;
            bool known=jh2_ble_catalog_cid(cid,&matches,&slot);
            if(known&&matches==0){
                uint32_t cursor=jh2_ble_notice_cursor();
                jh2_slot_io io={.context=&cursor,.write=slot_write_ram,
                               .reply=slot_reply_ram,.pace=slot_pace_native,
                                .progress=slot_progress_native};
                ready=jh2_slot_transfer_file(jh2_native_local_path(),cid,(uint8_t)esp_random(),
                    (uint32_t)(esp_timer_get_time()/1000),known,matches,slot,&io,&error);
                jh2_ble_target_invalidate();
            }else{
                ready=false;error="Fresh complete SmartDawn catalog must show assigned CID empty";
            }
        }
        // One-shot commit. Explicit new stage required before any retry to
        // prevent accidental repeat writes after an uncertain BLE response.
        staged_native_sha[0]=0;staged_native_size=0;staged_native_cid=0;
        native_slot_session.active=false;
        append_ack(current,ready?"applied":"failed",ready?
            "Nano sent entire flash-cached native effect over BLE; controller final ACK received; verify catalog twice":
            (error?error:"Local native upload did not complete"),ready);
    }else if(strcmp(action->valuestring,"nativeSlotUpload")==0){
        cJSON *requested=cJSON_GetObjectItemCaseSensitive(payload,"sha256");
        const char *sha=cJSON_IsString(requested)?requested->valuestring:NULL;
        uint32_t bytes=0;cJSON *entry=NULL;
        cJSON_ArrayForEach(entry,assets){
            cJSON *digest=cJSON_GetObjectItemCaseSensitive(entry,"sha256");
            cJSON *count=cJSON_GetObjectItemCaseSensitive(entry,"bytes");
            if(sha&&cJSON_IsString(digest)&&!strcmp(sha,digest->valuestring)&&
               cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(entry,"native"))&&
               cJSON_IsNumber(count)&&count->valuedouble>=4096&&count->valuedouble<=JH2_NATIVE_RAM_LIMIT){
                bytes=(uint32_t)count->valuedouble;break;
            }
        }
        const char *error="Native asset missing or cannot fit in volatile RAM";
        unsigned matches=0;uint16_t slot=0;uint8_t *file=NULL;
        bool good=bytes&&safe_hex64(sha)&&!NATIVE_SLOT_READ_ONLY;
        if(good){jh2_native_sequence_stop();good=stop_image_stream_and_wait();}
        if(good)good=jh2_asset_fetch_ram(endpoint,bridge_token,sha,bytes,&file);
        if(good){
            bool known=jh2_ble_target_section(&matches,&slot);
            uint32_t cursor=jh2_ble_notice_cursor();
            jh2_slot_io io={.context=&cursor,.write=slot_write_ram,.reply=slot_reply_ram,.pace=slot_pace_ram};
            good=jh2_slot_transfer(file,bytes,(uint8_t)esp_random(),
                (uint32_t)(esp_timer_get_time()/1000),known,matches,slot,&io,&error);
            jh2_ble_target_invalidate();
        }
        free(file);native_slot_session.active=false;
        append_ack(current,good?"applied":"failed",good?
            "Controller completed continuous native RAM upload; catalog verification required":
            (error?error:"Native RAM upload failed"),good);
    }else if(strcmp(action->valuestring,"status")==0||strcmp(action->valuestring,"nanoInfo")==0){
        append_ack(current,"applied","Native ESP-IDF connected to Oracle",false);
    }else if(strcmp(action->valuestring,"nanoEnterRecovery")==0){
        // This command switches only to the trusted, existing factory
        // browser updater. It does not erase the display or flash partitions.
        append_ack(current,"applied","Entering local browser recovery updater",false);
        jh2_web_request_recovery();
        restart_after_ack=current;
    }else if(strcmp(action->valuestring,"nanoAutoUpdate")==0){
        cJSON *enabled=cJSON_GetObjectItemCaseSensitive(payload,"enabled");
        const bool valid=cJSON_IsTrue(enabled)||cJSON_IsFalse(enabled);
        const bool saved=valid&&!cJSON_IsTrue(enabled)&&jh2_bridge_set_auto_update_enabled(false);
        append_ack(current,saved?"applied":"failed",saved?
            "Automatic updates disabled; use independent A/B rescue uploader":
            (valid?"Automatic updates locked OFF until hardware A/B acceptance":"Invalid auto-update setting"),false);
    }else if(strcmp(action->valuestring,"nanoFirmwareCheck")==0){
        cJSON *m=https_json("/api/curtain/firmware-manifest",NULL);
        char version[32]={0},error[150]={0};
        bool valid=m&&jh2_validate_signed_manifest(m,NATIVE_FW_VERSION,version,sizeof(version),error,sizeof(error));
        append_ack(current,valid?"applied":"failed",valid?"New signed update available":
            (m?error:"Signed firmware manifest download unavailable"),false);
        cJSON_Delete(m);
    }else if(strcmp(action->valuestring,"nanoInstallUpdate")==0){
        cJSON *m=https_json("/api/curtain/firmware-manifest",NULL);
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
    }else if(strcmp(action->valuestring,"scan")==0){
        bool accepted=jh2_ble_scan_start();
        append_ack(current,accepted?"applied":"failed",
                   accepted?"Native scan requested":"Native scan failed",false);
    }else if(strcmp(action->valuestring,"disconnect")==0){
        bool accepted=jh2_ble_disconnect();
        append_ack(current,accepted?"applied":"failed",
                   accepted?"Native Bluetooth disconnect requested":"BLE disconnect failed",false);
    }else if(strcmp(action->valuestring,"selectController")==0){
        cJSON *mac=cJSON_GetObjectItemCaseSensitive(payload,"mac");
        bool accepted=cJSON_IsString(mac)&&
                      jh2_ble_select_target(mac->valuestring);
        append_ack(current,accepted?"applied":"failed",
                   accepted?"Bluetooth controller selected and persisted":
                            "Controller was not observed in Nano scan or cannot be persisted",false);
    }else if(strcmp(action->valuestring,"power")==0 ||
             strcmp(action->valuestring,"brightness")==0 ||
             strcmp(action->valuestring,"speed")==0 ||
             strcmp(action->valuestring,"layout")==0 ||
             strcmp(action->valuestring,"effect")==0 ||
             strcmp(action->valuestring,"nativePlay")==0 ||
             strcmp(action->valuestring,"solid")==0){
        // An explicit visual command supersedes an old long-running animation.
        jh2_native_sequence_stop();
        if(jh2_asset_stream_active())(void)stop_image_stream_and_wait();
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
        bool idle=stop_image_stream_and_wait();
        append_ack(current,idle?"applied":"failed",
            idle?"Native sequence and image stream fully stopped":
                 "Native sequence stopped, but image stream is still stopping",false);
    }else if(strcmp(action->valuestring,"nanoResumeOracle")==0){
        append_ack(current,"applied","Oracle scheduling resumed",false);
    }else if(strcmp(action->valuestring,"rawWrite")==0){
        cJSON *uuid=cJSON_GetObjectItemCaseSensitive(payload,"uuid");
        cJSON *data=cJSON_GetObjectItemCaseSensitive(payload,"data");
        const char *error="Missing native UUID or data";
        bool delivered=false;
        if(cJSON_IsString(uuid)&&cJSON_IsString(data)){
            uint8_t bytes[508];size_t n=0;
            if(mbedtls_base64_decode(bytes,sizeof(bytes),&n,
                (const unsigned char*)data->valuestring,strlen(data->valuestring))==0){
                unsigned matches=0;uint16_t slot=0;
                const uint32_t assigned_cid=jh2_slot_packet_cid(&native_slot_session,
                    uuid->valuestring,bytes,n);
                const bool known=assigned_cid?
                    jh2_ble_catalog_cid(assigned_cid,&matches,&slot):
                    jh2_ble_target_section(&matches,&slot);
                jh2_slot_session next=native_slot_session;
                if(jh2_slot_validate(&next,uuid->valuestring,bytes,n,
                    (uint32_t)(esp_timer_get_time()/1000),known,matches,slot,
                    NATIVE_SLOT_READ_ONLY,&error)){
                    const uint16_t op=jh2_slot_command_opcode(bytes,n);
                    const bool upload=strcmp(uuid->valuestring,JH2_SLOT_UPLOAD_UUID)==0;
                    if(upload){jh2_native_sequence_stop();}
                    if(!upload||!jh2_asset_stream_active()||stop_image_stream_and_wait()){
                        if(op==2904)jh2_ble_catalog_begin_read();
                        delivered=jh2_ble_raw_write(uuid->valuestring,bytes,n,12000);
                        if(delivered){native_slot_session=next;
                            if(op==2909||(upload&&!next.active))jh2_ble_target_invalidate();
                        }else{native_slot_session.active=false;error="Native GATT write was not acknowledged";}
                    }else error="Previous image stream is still stopping";
                }
            }else error="Invalid native packet encoding";
        }
        append_ack(current,delivered?"applied":"failed",
            delivered?"Validated native packet acknowledged by GATT":error,delivered);
    }else if(strcmp(action->valuestring,"nativeSlotWrite")==0){
        cJSON *packets=cJSON_GetObjectItemCaseSensitive(payload,"packets");
        int count=cJSON_IsArray(packets)?cJSON_GetArraySize(packets):0;
        bool valid=count>=1&&count<=8;
        const char *error="Native slot batch requires 1..8 packets";
        jh2_slot_session next=native_slot_session;
        uint8_t bytes[508];size_t n=0;
        // Validate the entire batch before transmitting its first packet.
        for(int i=0;valid&&i<count;i++){
            cJSON *item=cJSON_GetArrayItem(packets,i);
            valid=cJSON_IsString(item)&&mbedtls_base64_decode(bytes,sizeof(bytes),&n,
                (const unsigned char*)item->valuestring,strlen(item->valuestring))==0;
            if(!valid){error="Invalid native slot packet encoding";break;}
            if(n<9||((unsigned)bytes[5]*256+bytes[6])==((unsigned)bytes[1]*256+bytes[2])){
                valid=false;error="UploadRequest must be acknowledged before file-data batches";break;
            }
            valid=jh2_slot_validate(&next,JH2_SLOT_UPLOAD_UUID,bytes,n,
                (uint32_t)(esp_timer_get_time()/1000),false,0,0,NATIVE_SLOT_READ_ONLY,&error);
        }
        int sent=0;
        for(int i=0;valid&&i<count;i++){
            cJSON *item=cJSON_GetArrayItem(packets,i);
            if(mbedtls_base64_decode(bytes,sizeof(bytes),&n,(const unsigned char*)item->valuestring,
               strlen(item->valuestring))!=0||!jh2_ble_raw_write(JH2_SLOT_UPLOAD_UUID,bytes,n,12000)){
                valid=false;error="Native slot batch GATT write failed; do not replay the batch";break;
            }
            ++sent;vTaskDelay(pdMS_TO_TICKS(25));
        }
        if(valid){native_slot_session=next;if(!next.active)jh2_ble_target_invalidate();}
        else if(sent)native_slot_session.active=false;
        char message[160];
        if(valid)snprintf(message,sizeof(message),"Native slot batch: %d GATT packets acknowledged",sent);
        else snprintf(message,sizeof(message),"%s (%d packets transmitted)",error?error:"Native slot rejected",sent);
        append_ack(current,valid?"applied":"failed",message,valid);
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
    cJSON_AddBoolToObject(status,"autoUpdate",jh2_bridge_auto_update_enabled());
    #if CONFIG_JH2_NATIVE_READONLY_ACCEPTANCE
    cJSON_AddBoolToObject(status,"nativeReadOnlyAcceptance",true);
#else
    cJSON_AddBoolToObject(status,"nativeReadOnlyAcceptance",false);
#endif
    cJSON_AddBoolToObject(status,"relayStreaming",jh2_asset_stream_active());
    cJSON_AddStringToObject(status,"assetStorage","nano-local");
    cJSON_AddNumberToObject(status,"nanoAnimationSpeedPercent",jh2_asset_stream_get_speed());
    cJSON *curtain=cJSON_AddObjectToObject(status,"curtain");
    jh2_ble_status(curtain);
    cJSON_AddBoolToObject(curtain,"sequenceRunning",jh2_native_sequence_running());
    // Forward the Nano's own read-only power + playback decoder result to
    // Oracle alongside native GATT notices, so the APK can compare both.
    // This is passive; no new GATT request, lighting control or BLE reset.
    jh2_ble_playback_status(status);
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
        bridge_start_requested=false;
        ESP_LOGE(TAG,"Native bridge disabled; saved production settings unchanged");
        vTaskDelete(NULL);return;
    }
    initial_boot_id();
    bridge_active=true;
    uint32_t retry_ms=1000;
    int64_t next_auto_ota_check_us=esp_timer_get_time()+45000000LL;
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
            ESP_LOGW(TAG,"Firmware maintenance acknowledged by Oracle");
            vTaskDelay(pdMS_TO_TICKS(300));
            // Signed update queue already selected factory. An explicit
            // nanoEnterRecovery action must select factory NOW.
            if(jh2_web_recovery_requested()){
                jh2_enter_local_recovery();
            }
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
        const bool idle_commands=!cJSON_IsArray(commands)||cJSON_GetArraySize(commands)==0;
        cJSON_Delete(reply);
        // Periodic production OTA; never writes runtime in-place and never
        // interrupts an active animation, sequence, or pending command.
        const int64_t now_us=esp_timer_get_time();
        if(firmware_auto_update&&idle_commands&&ack_count==0&&restart_after_ack==0&&
           !jh2_asset_stream_active()&&!jh2_native_sequence_running()&&
           now_us>=next_auto_ota_check_us){
            next_auto_ota_check_us=now_us+900000000LL; // fifteen minutes
            char newer[32]={0},err[170]={0};
            if(jh2_bridge_signed_firmware(true,newer,sizeof(newer),err,sizeof(err))){
                ESP_LOGW(TAG,"Verified newer signed firmware %s; entering factory updater",newer);
                vTaskDelay(pdMS_TO_TICKS(1500));
                esp_restart();
            }else{
                ESP_LOGI(TAG,"Auto OTA check: %s",err[0]?err:"no newer signed firmware");
            }
        }
        vTaskDelay(pdMS_TO_TICKS(1100));
    }
}
void jh2_bridge_start(void){
    if(bridge_active||bridge_start_requested)return;
    bridge_start_requested=true;
    jh2_load_auto_ota();
    if(!ack_lock)ack_lock=xSemaphoreCreateMutex();
    if(!ack_lock){bridge_start_requested=false;return;}
    if(xTaskCreate(oracle_task,"jh2-idf-oracle",12288,NULL,4,NULL)!=pdPASS){
        bridge_start_requested=false;
        ESP_LOGE(TAG,"Unable to start native Oracle task");
    }
}
bool jh2_bridge_ready(void){return bridge_active;}

// Connect Automatically uses the private device bridge token already saved
// on the Nano. A failed credential cannot create a new pairing on the open AP.
static void oracle_link_task(void *ctx){
    (void)ctx;
    bool success=false;
    EventGroupHandle_t group=jh2_web_wifi_group();
    if(!group || !(xEventGroupGetBits(group)&WIFI_READY)){
        oracle_link_status="Connect to home Wi-Fi first; setup AP remains available.";
    }else if(!load_saved_settings()){
        oracle_link_status="No valid bridge token saved. Use the signed-in Oracle pairing page.";
    }else{
        oracle_link_status="Verifying bridge ID and token with Oracle...";
        cJSON *bootstrap=https_json("/api/curtain-bridge/bootstrap",NULL);
        const cJSON *valid=bootstrap?cJSON_GetObjectItemCaseSensitive(bootstrap,"ok"):NULL;
        const cJSON *identity=bootstrap?cJSON_GetObjectItemCaseSensitive(bootstrap,"bridgeId"):NULL;
        const cJSON *address=bootstrap?cJSON_GetObjectItemCaseSensitive(bootstrap,"endpoint"):NULL;
        if(cJSON_IsTrue(valid)&&cJSON_IsString(identity)&&identity->valuestring&&
           strcmp(identity->valuestring,bridge_id)==0&&
           cJSON_IsString(address)&&address->valuestring&&
           strcmp(address->valuestring,endpoint)==0){
            oracle_link_verified=true;
            oracle_link_status="Bridge verified. Starting Oracle synchronization.";
            jh2_bridge_start();
            success=true;
        }else{
            oracle_link_status="Oracle authentication failed or bridge identity mismatch. Re-pair through Oracle.";
        }
        cJSON_Delete(bootstrap);
    }
    if(!success)oracle_link_verified=false;
    oracle_link_busy=false;
    vTaskDelete(NULL);
}
bool jh2_bridge_autolink_request(void){
    if(oracle_link_busy)return false;
    oracle_link_busy=true;
    oracle_link_status="Preparing encrypted Oracle verification...";
    if(xTaskCreate(oracle_link_task,"jh2-oracle-link",10240,NULL,3,NULL)!=pdPASS){
        oracle_link_busy=false;
        oracle_link_status="Cannot allocate Oracle link task. Wi-Fi remains available.";
        return false;
    }
    return true;
}
const char *jh2_bridge_autolink_status(void){return oracle_link_status;}
bool jh2_bridge_autolink_verified(void){return oracle_link_verified;}
