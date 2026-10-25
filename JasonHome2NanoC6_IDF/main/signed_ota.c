#include "signed_ota.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_err.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "nvs.h"
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
bool jh2_queue_signed_update(const cJSON *manifest,const char *current_version,
                             char *error,size_t error_capacity){
    (void)manifest;(void)current_version;
    msg(error,error_capacity,"Remote OTA locked off for 2.0.4 A/B recovery. Use local factory rescue upload.");
    return false;
    char version[32];
    if(!jh2_validate_signed_manifest(manifest,current_version,version,
                                    sizeof(version),error,error_capacity))return false;
    // The permanent updater was shipped in the original factory app slot.
    // The runtime must never write its own OTA-0 image in place.
    const esp_partition_t *active=esp_ota_get_running_partition();
    const esp_partition_t *updater=esp_partition_find_first(
        ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_FACTORY,"boot");
    if(!active||active->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_0 || !updater){
        msg(error,error_capacity,"Permanent boot updater unavailable");return false;
    }
    char *json=cJSON_PrintUnformatted(manifest);
    if(!json){msg(error,error_capacity,"Manifest allocation failed");return false;}
    if(strlen(json)>3000){free(json);msg(error,error_capacity,"Manifest too large");return false;}
    nvs_handle_t h=0;
    esp_err_t rc=nvs_open("jh2-release",NVS_READWRITE,&h);
    if(rc!=ESP_OK){free(json);msg(error,error_capacity,"Cannot open release metadata");return false;}
    rc=nvs_set_str(h,"pending",json);
    if(rc==ESP_OK)rc=nvs_set_str(h,"target",version);
    if(rc==ESP_OK)rc=nvs_set_str(h,"phase","queued");
    if(rc==ESP_OK)rc=nvs_erase_key(h,"reason");
    if(rc==ESP_ERR_NVS_NOT_FOUND)rc=ESP_OK;
    if(rc==ESP_OK)rc=nvs_commit(h);
    nvs_close(h);free(json);
    if(rc!=ESP_OK){
        msg(error,error_capacity,"Cannot persist signed install request");return false;
    }
    rc=esp_ota_set_boot_partition(updater);
    if(rc!=ESP_OK){
        nvs_handle_t cleanup;
        if(nvs_open("jh2-release",NVS_READWRITE,&cleanup)==ESP_OK){
            nvs_erase_key(cleanup,"pending");nvs_commit(cleanup);nvs_close(cleanup);
        }
        msg(error,error_capacity,"Failed to select permanent updater");
        return false;
    }
    // Caller must FIRST send successful ACK to Oracle, THEN esp_restart().
    // Automatic installation is never enabled by this function.
    return true;
}
