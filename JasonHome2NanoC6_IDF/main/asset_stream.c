#include "asset_stream.h"
#include "native_ble.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <ctype.h>
#include "esp_log.h"
#include "esp_http_client.h"
#include "mbedtls/sha256.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

extern const unsigned char tls_roots_pem_start[] asm("_binary_tls_roots_pem_start");
static const char *TAG="JH2_IDF_STREAM";
#define MAX_ASSET (4U*1024U*1024U)
typedef struct {
    char endpoint[208],token[65],sha[65];
    uint32_t size,generation;
    uint64_t command_id;
    jh2_asset_ack_fn ack;
} asset_job;
static volatile uint32_t generation=0;
static volatile bool streaming=false;
static SemaphoreHandle_t job_lock=NULL;

static bool hex64(const char *v){
    if(!v||strlen(v)!=64)return false;
    for(int i=0;i<64;i++)if(!isxdigit((unsigned char)v[i]))return false;
    return true;
}
static bool wanted(uint32_t gen){return gen==generation;}
typedef struct{
    esp_http_client_handle_t h;
    mbedtls_sha256_context sha;
    uint32_t position,bytes;
} stream_source;
static bool read_exact(stream_source *s,uint8_t *buffer,size_t len,uint32_t gen){
    if(!s||!buffer||!len || len>s->bytes-s->position)return false;
    size_t done=0;int retries=0;
    while(done<len&&wanted(gen)){
        int n=esp_http_client_read(s->h,(char*)(buffer+done),(int)(len-done));
        if(n<0)return false;
        if(n==0){
            if(++retries>40)return false;
            vTaskDelay(pdMS_TO_TICKS(20));continue;
        }
        retries=0;done+=(size_t)n;
    }
    if(done!=len)return false;
    if(mbedtls_sha256_update(&s->sha,buffer,len)!=0)return false;
    s->position+=(uint32_t)len;
    return true;
}
static bool digest_matches(stream_source *s,const char *hex){
    unsigned char actual[32];
    if(mbedtls_sha256_finish(&s->sha,actual)!=0)return false;
    const char *alphabet="0123456789abcdef";
    unsigned int different=0;
    for(int i=0;i<32;i++){
        different|=(unsigned)(alphabet[actual[i]>>4]!=(char)tolower((unsigned char)hex[2*i]));
        different|=(unsigned)(alphabet[actual[i]&15]!=(char)tolower((unsigned char)hex[2*i+1]));
    }
    return different==0;
}
// Preflight parses the exact authenticated, content-addressed Oracle blob
// and verifies its complete SHA-256 before *any* GATT packet is transmitted.
// A second HTTPS pass is deliberately checked again at EOF to detect changes
// between requests. This avoids storing artwork on the constrained Nano.
static bool stream_once(asset_job *job,bool *first_sent,bool *repeat,bool verify_only){
    char url[370];
    if(snprintf(url,sizeof(url),"%s/api/curtain-bridge/stream/%s",job->endpoint,job->sha)
       >=(int)sizeof(url))return false;
    esp_http_client_config_t cfg={
        .url=url,.cert_pem=(const char *)tls_roots_pem_start,
        .timeout_ms=12000,.buffer_size=2048,.buffer_size_tx=2048
    };
    esp_http_client_handle_t h=esp_http_client_init(&cfg);
    if(!h)return false;
    char authorization[75];
    snprintf(authorization,sizeof(authorization),"Bearer %s",job->token);
    esp_http_client_set_header(h,"Authorization",authorization);
    esp_http_client_set_header(h,"X-JH2-Bridge-Token",job->token);
    bool good=false;
    stream_source source={.h=h,.position=0,.bytes=job->size};
    mbedtls_sha256_init(&source.sha);
    do{
        if(esp_http_client_open(h,0)!=ESP_OK)break;
        int64_t n=esp_http_client_fetch_headers(h);
        if(esp_http_client_get_status_code(h)!=200 || n!=(int64_t)job->size)break;
        if(mbedtls_sha256_starts(&source.sha,0)!=0)break;
        uint8_t header[8];
        if(!read_exact(&source,header,sizeof(header),job->generation))break;
        if(memcmp(header,"JHC1",4)!=0)break;
        uint16_t frames=(uint16_t)(header[4]|header[5]<<8);
        if(!frames||frames>180)break;
        *repeat=header[6]!=0;
        bool fail=false;
        for(uint16_t f=0;f<frames && wanted(job->generation);f++){
            uint8_t fh[6];
            if(!read_exact(&source,fh,sizeof(fh),job->generation)){fail=true;break;}
            uint32_t hold=(uint32_t)fh[0]|(uint32_t)fh[1]<<8|
                (uint32_t)fh[2]<<16|(uint32_t)fh[3]<<24;
            uint16_t packets=(uint16_t)fh[4]|((uint16_t)fh[5]<<8);
            if(packets>5000||hold>60000){fail=true;break;}
            for(uint16_t i=0;i<packets && wanted(job->generation);i++){
                uint8_t packet_meta[3],packet[508];
                if(!read_exact(&source,packet_meta,3,job->generation)){fail=true;break;}
                uint16_t bytes=(uint16_t)packet_meta[1]|((uint16_t)packet_meta[2]<<8);
                uint8_t channel=packet_meta[0];
                if(channel>1||!bytes||bytes>sizeof(packet)||
                    !read_exact(&source,packet,bytes,job->generation)){fail=true;break;}
                if(!verify_only && !jh2_ble_asset_packet(channel,packet,bytes)){
                    fail=true;break;
                }
                if(!verify_only && (i&7)==7)vTaskDelay(pdMS_TO_TICKS(1));
            }
            if(fail||!wanted(job->generation))break;
            if(!verify_only && !*first_sent){
                *first_sent=true;
                job->ack(job->command_id,"applied",
                    "Native ESP-IDF transmitted the first verified-format frame; physical output unconfirmed",true);
            }
            uint32_t waited=0;
            while(!verify_only && waited<hold&&wanted(job->generation)){
                uint32_t step=(hold-waited)>20?20:hold-waited;
                vTaskDelay(pdMS_TO_TICKS(step?step:1));
                waited+=step;
            }
        }
        if(fail||!wanted(job->generation)||source.position!=source.bytes)break;
        if(!digest_matches(&source,job->sha)){
            ESP_LOGE(TAG,"Asset SHA-256 mismatch; stream rejected");
            break;
        }
        good=true;
    }while(0);
    mbedtls_sha256_free(&source.sha);
    esp_http_client_close(h);
    esp_http_client_cleanup(h);
    return good;
}
static void run_asset(void *param){
    asset_job job=*(asset_job *)param;
    free(param);
    bool applied=false,repeat=false,failed=false;
    while(wanted(job.generation)){
        bool repeat_this=false;
        // Authenticate and validate the WHOLE JHC1 stream first. Never send
        // bytes from an unverified first download to the controller.
        bool verified=stream_once(&job,&applied,&repeat_this,true);
        if(!verified || !wanted(job.generation) ||
           !stream_once(&job,&applied,&repeat_this,false)){
            failed=wanted(job.generation);
            break;
        }
        repeat=repeat_this;
        if(!repeat)break;
        // The Oracle command poller is a separate bounded task. Give it a
        // service window at the end of every animation loop.
        for(int i=0;i<30&&wanted(job.generation);i++)vTaskDelay(pdMS_TO_TICKS(20));
    }
    if(failed)
        job.ack(job.command_id,"failed","Native asset stream aborted; retaining last curtain frame",false);
    if(!applied && wanted(job.generation) && !failed)
        job.ack(job.command_id,"failed","Native stream contained no displayed frame",false);
    // A Stop request increments generation. The old generation check kept
    // streaming=true forever after cancellation, rejecting every later asset.
    // Only one stream task can exist while streaming is true, so the task
    // that owns the slot must ALWAYS release it on exit, including Stop.
    if(job_lock && xSemaphoreTake(job_lock,pdMS_TO_TICKS(1000))==pdTRUE){
        streaming=false;
        xSemaphoreGive(job_lock);
    }else{
        streaming=false;
    }
    // Do not log endpoint, token, source URLs with embedded sensitive keys,
    // or any transferred pixel data.
    ESP_LOGI(TAG,"Stream finished bytes=%u repeated=%d",
             (unsigned)job.size,repeat);
    vTaskDelete(NULL);
}
bool jh2_asset_stream_start(const char *endpoint,const char *token,const char *sha,
                            uint32_t size,uint64_t command_id,jh2_asset_ack_fn ack){
    if(!endpoint||!token||!sha||!ack||!hex64(sha)||!hex64(token)
       ||size<8||size>MAX_ASSET||strlen(endpoint)>=208)return false;
    if(strncmp(endpoint,"https://",8)!=0)return false;
    if(!job_lock)job_lock=xSemaphoreCreateMutex();
    if(!job_lock)return false;
    xSemaphoreTake(job_lock,portMAX_DELAY);
    // Do not run competing HTTPS streams against the ESP32-C6's limited RAM.
    if(streaming){xSemaphoreGive(job_lock);return false;}
    asset_job *job=calloc(1,sizeof(*job));
    if(!job){xSemaphoreGive(job_lock);return false;}
    strcpy(job->endpoint,endpoint);
    strcpy(job->token,token);
    strcpy(job->sha,sha);
    job->size=size;job->command_id=command_id;job->ack=ack;
    job->generation=++generation;
    streaming=true;
    if(xTaskCreate(run_asset,"jh2-native-asset",14336,job,3,NULL)!=pdPASS){
        streaming=false;free(job);xSemaphoreGive(job_lock);return false;
    }
    xSemaphoreGive(job_lock);
    return true;
}
void jh2_asset_stream_stop(void){++generation;}
bool jh2_asset_stream_active(void){return streaming;}
