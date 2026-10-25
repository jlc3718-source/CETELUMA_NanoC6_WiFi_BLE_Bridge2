#include "signed_ota.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_err.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "nvs.h"
#include "esp_http_client.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/pk.h"
#include "mbedtls/base64.h"
#include "mbedtls/sha256.h"
#include "mbedtls/md.h"

extern const unsigned char ota_public_pem_start[] asm("_binary_ota_public_pem_start");
static const char EXPECTED_PRODUCT[]="jason-home-2-nanoc6";
static const char URL_PREFIX[]=
 "https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/jason-home-2-nanoc6-v";
static void msg(char *buf,size_t cap,const char *message){
    if(buf&&cap)snprintf(buf,cap,"%s",message);
}
static bool hex_str(const char *s,size_t n){
    if(!s||strlen(s)!=n)return false;
    for(size_t i=0;i<n;i++)if(!isxdigit((unsigned char)s[i]))return false;
    return true;
}
static bool semver(const char *s,unsigned out[3]){
    unsigned a,b,c;char extra;
    if(!s||sscanf(s,"%u.%u.%u%c",&a,&b,&c,&extra)!=3)return false;
    if(a>=10000||b>=10000||c>=10000)return false;
    out[0]=a;out[1]=b;out[2]=c;return true;
}
static bool newer(const char *candidate,const char *current){
    unsigned c[3],v[3];
    if(!semver(candidate,c)||!semver(current,v))return false;
    for(size_t i=0;i<3;i++)if(c[i]!=v[i])return c[i]>v[i];
    return false;
}
typedef struct {
    char product[40],version[32],sha[65],commit[41],url[280];
    size_t bytes;
} signed_fields;
static bool parse_payload(const char *payload,signed_fields *out){
    if(!payload||!out||strlen(payload)>1024)return false;
    memset(out,0,sizeof(*out));
    char buffer[1025];
    strcpy(buffer,payload);
    char *fields[]={
        out->product,out->version,NULL,out->sha,out->commit,out->url
    };
    const char *keys[]={"product","version","bytes","sha256","commit","url"};
    const size_t capacities[]={sizeof(out->product),sizeof(out->version),0,
        sizeof(out->sha),sizeof(out->commit),sizeof(out->url)};
    unsigned seen=0;
    for(char *line=strtok(buffer,"\n");line;line=strtok(NULL,"\n")){
        char *eq=strchr(line,'=');
        if(!eq||eq==line)return false;
        *eq=0;const char *value=eq+1;
        bool matched=false;
        for(unsigned i=0;i<6;i++){
            if(strcmp(line,keys[i])!=0)continue;
            if(seen&(1U<<i))return false;
            seen|=1U<<i;matched=true;
            if(i==2){
                if(!*value)return false;
                for(const char *p=value;*p;p++)if(!isdigit((unsigned char)*p))return false;
                unsigned long long amount=strtoull(value,NULL,10);
                if(amount<1024||amount>0x290000)return false;
                out->bytes=(size_t)amount;
            }else{
                size_t size=strlen(value);
                if(!size||size>=capacities[i])return false;
                memcpy(fields[i],value,size+1);
            }
            break;
        }
        if(!matched)return false;
    }
    return seen==63;
}
static bool verify_signed(const cJSON *manifest,signed_fields *out,
                          char *error,size_t error_cap){
    cJSON *schema=cJSON_GetObjectItemCaseSensitive(manifest,"schema");
    cJSON *payload=cJSON_GetObjectItemCaseSensitive(manifest,"payload");
    cJSON *signature=cJSON_GetObjectItemCaseSensitive(manifest,"signature");
    if(!cJSON_IsNumber(schema)||schema->valueint!=1||
       !cJSON_IsString(payload)||!cJSON_IsString(signature)){
        msg(error,error_cap,"Signed manifest format invalid");return false;
    }
    unsigned char bytes[128];size_t siglen=0;
    if(mbedtls_base64_decode(bytes,sizeof(bytes),&siglen,
        (const unsigned char*)signature->valuestring,strlen(signature->valuestring))!=0){
        msg(error,error_cap,"Signed manifest signature malformed");return false;
    }
    unsigned char digest[32];
    if(mbedtls_sha256((const unsigned char*)payload->valuestring,
       strlen(payload->valuestring),digest,0)!=0){
        msg(error,error_cap,"Signed manifest hashing unavailable");return false;
    }
    mbedtls_pk_context pk;mbedtls_pk_init(&pk);
    int rc=mbedtls_pk_parse_public_key(&pk,ota_public_pem_start,
        strlen((const char*)ota_public_pem_start)+1);
    if(!rc)rc=mbedtls_pk_verify(&pk,MBEDTLS_MD_SHA256,digest,sizeof(digest),
                              bytes,siglen);
    mbedtls_pk_free(&pk);
    if(rc){
        msg(error,error_cap,"Signed manifest signature verification failed");return false;
    }
    if(!parse_payload(payload->valuestring,out)||
       strcmp(out->product,EXPECTED_PRODUCT)!=0||
       !hex_str(out->sha,64)||!hex_str(out->commit,40)){
        msg(error,error_cap,"Signed manifest identity invalid");return false;
    }
    unsigned parsed[3];
    if(!semver(out->version,parsed)){
        msg(error,error_cap,"Signed firmware version invalid");return false;
    }
    char exact[sizeof(out->url)];
    int n=snprintf(exact,sizeof(exact),"%s%s/jh2-runtime-%s.bin",
       URL_PREFIX,out->version,out->version);
    if(n<=0||(size_t)n>=sizeof(exact)||strcmp(out->url,exact)!=0){
        msg(error,error_cap,"Signed firmware URL outside trusted release channel");return false;
    }
    return true;
}
bool jh2_validate_signed_manifest(const cJSON *manifest,const char *current_version,
                                  char *version,size_t version_capacity,
                                  char *error,size_t error_capacity){
    signed_fields out;
    if(!verify_signed(manifest,&out,error,error_capacity))return false;
    if(!newer(out.version,current_version)){
        msg(error,error_capacity,"Only newer signed firmware may be installed");return false;
    }
    if(!version||!version_capacity||strlen(out.version)>=version_capacity){
        msg(error,error_capacity,"Version output buffer too small");return false;
    }
    strcpy(version,out.version);
    return true;
}

extern const unsigned char tls_roots_pem_start[] asm("_binary_tls_roots_pem_start");
static const char *OTA_TAG="JH2_SIGNED_AB";
typedef enum { OTA_EMPTY, OTA_DOWNLOADING, OTA_READY, OTA_FAILED, OTA_INSTALLING } ota_state_t;
typedef struct {
    char url[280];
    char sha[65];
    char version[32];
    size_t bytes;
} ota_candidate;
static volatile ota_state_t ota_state=OTA_EMPTY;
static volatile size_t ota_downloaded=0;
static char ota_staged_version[32]="";
static char ota_error[144]="";
static const esp_partition_t *ota_staged_partition=NULL;
typedef struct {
    esp_ota_handle_t handle;
    size_t downloaded,expected;
    mbedtls_sha256_context digest;
    bool failed;
} ota_download_ctx;
static esp_err_t ota_http_event(esp_http_client_event_t *e){
    if(e->event_id!=HTTP_EVENT_ON_DATA || !e->data || e->data_len<=0)return ESP_OK;
    ota_download_ctx *ctx=(ota_download_ctx *)e->user_data;
    if(!ctx || ctx->failed)return ESP_FAIL;
    // Never flash a redirect page or error response as firmware.
    if(esp_http_client_get_status_code(e->client)!=200)return ESP_OK;
    const size_t n=(size_t)e->data_len;
    if(n>ctx->expected-ctx->downloaded){ctx->failed=true;return ESP_FAIL;}
    if(esp_ota_write(ctx->handle,e->data,n)!=ESP_OK){ctx->failed=true;return ESP_FAIL;}
    if(mbedtls_sha256_update(&ctx->digest,(const unsigned char *)e->data,n)!=0){
        ctx->failed=true;return ESP_FAIL;
    }
    ctx->downloaded+=n;
    ota_downloaded=ctx->downloaded;
    return ESP_OK;
}
static void ota_fetch_task(void *arg){
    ota_candidate *candidate=(ota_candidate *)arg;
    ota_state=OTA_DOWNLOADING;
    ota_downloaded=0;
    ota_staged_partition=NULL;
    const esp_partition_t *running=esp_ota_get_running_partition();
    const esp_partition_t *inactive=esp_ota_get_next_update_partition(NULL);
    if(!running||!inactive||
       (running->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_0 &&
        running->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_1)||
       inactive==running||candidate->bytes>inactive->size){
        snprintf(ota_error,sizeof(ota_error),"No safe inactive A/B partition available");
        goto failure;
    }
    esp_ota_handle_t h=0;
    esp_err_t rc=esp_ota_begin(inactive,candidate->bytes,&h);
    if(rc!=ESP_OK){
        snprintf(ota_error,sizeof(ota_error),"Inactive OTA partition unavailable: %s",esp_err_to_name(rc));
        goto failure;
    }
    ota_download_ctx ctx={.handle=h,.downloaded=0,.expected=candidate->bytes};
    mbedtls_sha256_init(&ctx.digest);
    mbedtls_sha256_starts(&ctx.digest,0);
    esp_http_client_config_t config={
        .url=candidate->url,
        .cert_pem=(const char*)tls_roots_pem_start,
        .event_handler=ota_http_event,
        .user_data=&ctx,
        .timeout_ms=30000,
        .buffer_size=2048,
        .max_redirection_count=5,
        .disable_auto_redirect=false,
    };
    esp_http_client_handle_t client=esp_http_client_init(&config);
    if(!client){
        snprintf(ota_error,sizeof(ota_error),"Cannot allocate HTTPS firmware downloader");
        esp_ota_abort(h);
        mbedtls_sha256_free(&ctx.digest);
        goto failure;
    }
    rc=esp_http_client_perform(client);
    const int status=esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    unsigned char sha[32]={0};
    char computed[65]={0};
    if(mbedtls_sha256_finish(&ctx.digest,sha)!=0)ctx.failed=true;
    mbedtls_sha256_free(&ctx.digest);
    for(unsigned i=0;i<sizeof(sha);i++)snprintf(computed+i*2,3,"%02x",sha[i]);
    bool verified=rc==ESP_OK&&!ctx.failed&&status==200&&
         ctx.downloaded==candidate->bytes&&
         strcasecmp(computed,candidate->sha)==0;
    if(!verified){
        ESP_LOGE(OTA_TAG,"SIGNED_DOWNLOAD_FAILED rc=%s status=%d received=%u expected=%u",
                 esp_err_to_name(rc),status,(unsigned)ctx.downloaded,(unsigned)candidate->bytes);
        snprintf(ota_error,sizeof(ota_error),"Download failed, incomplete, or SHA-256 mismatch");
        esp_ota_abort(h);
        goto failure;
    }
    rc=esp_ota_end(h);  // Validates ESP image before marking as staged.
    if(rc!=ESP_OK){
        snprintf(ota_error,sizeof(ota_error),"ESP firmware image validation failed: %s",esp_err_to_name(rc));
        goto failure;
    }
    snprintf(ota_staged_version,sizeof(ota_staged_version),"%s",candidate->version);
    ota_staged_partition=inactive;
    ota_state=OTA_READY;
    ESP_LOGW(OTA_TAG,"SIGNED_OTA_STAGED version=%s bytes=%u inactive=%s; awaiting installation",
             candidate->version,(unsigned)ctx.downloaded,inactive->label);
    free(candidate);
    vTaskDelete(NULL);
    return;
failure:
    ota_staged_partition=NULL;
    ota_state=OTA_FAILED;
    free(candidate);
    vTaskDelete(NULL);
}
bool jh2_ota_stage_signed(const cJSON *manifest,const char *current_version,
                          char *error,size_t error_capacity){
    signed_fields fields;
    if(!verify_signed(manifest,&fields,error,error_capacity))return false;
    if(!newer(fields.version,current_version)){
        msg(error,error_capacity,"No newer signed release available");return false;
    }
    if(ota_state==OTA_DOWNLOADING){
        msg(error,error_capacity,"Signed firmware is already downloading");
        return false;
    }
    if(ota_state==OTA_READY && strcmp(ota_staged_version,fields.version)==0)
        return true;
    ota_candidate *candidate=calloc(1,sizeof(*candidate));
    if(!candidate){msg(error,error_capacity,"Firmware downloader memory unavailable");return false;}
    snprintf(candidate->url,sizeof(candidate->url),"%s",fields.url);
    snprintf(candidate->sha,sizeof(candidate->sha),"%s",fields.sha);
    snprintf(candidate->version,sizeof(candidate->version),"%s",fields.version);
    candidate->bytes=fields.bytes;
    ota_error[0]=0;
    ota_state=OTA_DOWNLOADING;
    if(xTaskCreate(ota_fetch_task,"jh2-signed-ota",9216,candidate,3,NULL)!=pdPASS){
        ota_state=OTA_FAILED;
        free(candidate);
        msg(error,error_capacity,"Cannot start OTA download task");return false;
    }
    return true;
}
bool jh2_ota_staged_ready(void){return ota_state==OTA_READY && ota_staged_partition;}
bool jh2_ota_download_active(void){return ota_state==OTA_DOWNLOADING;}
void jh2_ota_status(cJSON *object){
    if(!cJSON_IsObject(object))return;
    const char *state=ota_state==OTA_DOWNLOADING?"downloading":
                      ota_state==OTA_READY?"ready":
                      ota_state==OTA_FAILED?"failed":
                      ota_state==OTA_INSTALLING?"installing":"idle";
    cJSON_AddStringToObject(object,"state",state);
    cJSON_AddNumberToObject(object,"downloadedBytes",ota_downloaded);
    cJSON_AddStringToObject(object,"version",ota_staged_version);
    cJSON_AddStringToObject(object,"message",ota_error);
    cJSON_AddBoolToObject(object,"installReady",jh2_ota_staged_ready());
}
bool jh2_ota_install_staged(char *error,size_t error_capacity){
    if(!jh2_ota_staged_ready()){
        msg(error,error_capacity,ota_state==OTA_DOWNLOADING?
            "Firmware is still downloading; wait for verification":
            ota_error[0]?ota_error:"No signed firmware has been downloaded");
        return false;
    }
    // Selection only; caller sends HTTP/Oracle ACK and then restarts.
    esp_err_t rc=esp_ota_set_boot_partition(ota_staged_partition);
    if(rc!=ESP_OK){
        msg(error,error_capacity,"Could not activate verified A/B firmware");
        return false;
    }
    ota_state=OTA_INSTALLING;
    ESP_LOGW(OTA_TAG,"SIGNED_OTA_INSTALL version=%s target=%s; bootloader rollback stays enabled",
             ota_staged_version,ota_staged_partition->label);
    return true;
}
bool jh2_queue_signed_update(const cJSON *manifest,const char *current_version,
                             char *error,size_t error_capacity){
    // Check downloads/validates the newer image into the inactive slot.
    // Install only switches boot after the entire signed image is verified.
    if(ota_state!=OTA_READY){
        if(jh2_ota_stage_signed(manifest,current_version,error,error_capacity))
            msg(error,error_capacity,"Signed image downloading; install will be available when verified");
        return false;
    }
    return jh2_ota_install_staged(error,error_capacity);
}
