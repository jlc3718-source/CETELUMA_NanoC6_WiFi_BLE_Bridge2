#include "asset_stream.h"
#include "native_ble.h"
#include "native_slot_upload.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <ctype.h>
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_littlefs.h"
#include <unistd.h>
#include <sys/stat.h>
#include "mbedtls/sha256.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

extern const unsigned char tls_roots_pem_start[] asm("_binary_tls_roots_pem_start");
static const char *TAG="JH2_IDF_STREAM";
// One local persistent asset, in the existing 256KiB LittleFS partition.
// Never touch /littlefs/secrets.json or OTA partitions.
// Physical storage partition is 256 KiB. The only size ceiling is its
// capacity; actual admission is checked against measured free LittleFS space.
#define MAX_ASSET (256U*1024U)
#define CACHE_RESERVED_BYTES (8U*1024U)
#define CACHE_PATH "/littlefs/curtain-local.jhc1"
#define STAGE_PATH "/littlefs/curtain-local.tmp"
#define DIGEST_PATH "/littlefs/curtain-local.sha"
typedef struct {
    char endpoint[208],token[65],sha[65];
    uint32_t size,generation;
    uint64_t command_id;
    jh2_asset_ack_fn ack;
} asset_job;
static volatile uint32_t generation=0;
static volatile bool streaming=false;
static volatile uint16_t speed_percent=100; // 100%=stored timing; 200%=twice as fast
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
bool jh2_asset_fetch_ram(const char *endpoint,const char *token,
        const char *sha,uint32_t size,uint8_t **out){
    *out=NULL;
    if(!endpoint||!token||!hex64(sha)||size<4096||size>JH2_NATIVE_RAM_LIMIT)return false;
    char url[370],authorization[75];
    if(snprintf(url,sizeof(url),"%s/api/curtain-bridge/stream/%s",endpoint,sha)>=(int)sizeof(url))return false;
    uint8_t *data=malloc(size);
    if(!data)return false;
    esp_http_client_config_t cfg={.url=url,.cert_pem=(const char*)tls_roots_pem_start,
        .timeout_ms=12000,.buffer_size=2048,.buffer_size_tx=2048};
    esp_http_client_handle_t h=esp_http_client_init(&cfg);
    if(!h){free(data);return false;}
    snprintf(authorization,sizeof(authorization),"Bearer %s",token);
    esp_http_client_set_header(h,"Authorization",authorization);
    esp_http_client_set_header(h,"X-JH2-Bridge-Token",token);
    stream_source source={.h=h,.bytes=size};
    mbedtls_sha256_init(&source.sha);
    bool good=esp_http_client_open(h,0)==ESP_OK&&
        esp_http_client_fetch_headers(h)==(int64_t)size&&esp_http_client_get_status_code(h)==200&&
        mbedtls_sha256_starts(&source.sha,0)==0&&
        read_exact(&source,data,size,generation)&&digest_matches(&source,sha);
    mbedtls_sha256_free(&source.sha);
    esp_http_client_close(h);esp_http_client_cleanup(h);
    if(!good){free(data);return false;}
    *out=data;return true;
}
// All frames are downloaded ONCE to Nano LittleFS and verified by SHA-256.
// Subsequent loops read only local flash. Oracle is not consulted during replay.
static bool file_digest_ok(const char *path,const char *sha,uint32_t expected){
    struct stat st={0};
    if(stat(path,&st)!=0||st.st_size!=(off_t)expected)return false;
    FILE *f=fopen(path,"rb");if(!f)return false;
    mbedtls_sha256_context ctx;mbedtls_sha256_init(&ctx);
    bool ok=mbedtls_sha256_starts(&ctx,0)==0;
    uint8_t block[1024];uint32_t count=0;
    while(ok&&count<expected){
        size_t want=expected-count;if(want>sizeof(block))want=sizeof(block);
        size_t n=fread(block,1,want,f);
        if(n!=want||mbedtls_sha256_update(&ctx,block,n)!=0){ok=false;break;}
        count+=(uint32_t)n;
    }
    if(ok){
        stream_source stream={0};stream.sha=ctx;
        ok=digest_matches(&stream,sha);
        // digest_matches finalizes a copy; ctx is still freed below.
    }
    mbedtls_sha256_free(&ctx);
    fclose(f);return ok&&count==expected;
}
// Available capacity after replacing the prior single animation.
// Keep 8 KiB of free blocks for LittleFS metadata and internal housekeeping.
uint32_t jh2_asset_local_available_bytes(void){
    size_t total=0,used=0;
    if(esp_littlefs_info("storage",&total,&used)!=ESP_OK||used>total)return 0;
    uint64_t available=total-used;
    struct stat cached={0},digest={0};
    if(stat(CACHE_PATH,&cached)==0&&cached.st_size>0)
        available+=(uint64_t)cached.st_size;
    if(stat(DIGEST_PATH,&digest)==0&&digest.st_size>0)
        available+=(uint64_t)digest.st_size;
    if(available<=CACHE_RESERVED_BYTES)return 0;
    available-=CACHE_RESERVED_BYTES;
    return (uint32_t)(available>MAX_ASSET?MAX_ASSET:available);
}
static bool cache_asset_once(asset_job *job){
    if(!job||job->size<8||job->size>MAX_ASSET)return false;
    // Only a known verified on-device digest may bypass the one-time download.
    FILE *meta=fopen(DIGEST_PATH,"rb");
    if(meta){
        char cached[65]={0};
        bool same=fread(cached,1,64,meta)==64&&memcmp(cached,job->sha,64)==0;
        fclose(meta);
        if(same&&file_digest_ok(CACHE_PATH,job->sha,job->size)){
            ESP_LOGI(TAG,"Reusing locally verified curtain animation (%u bytes)",(unsigned)job->size);
            return true;
        }
    }
    // Check usable capacity BEFORE removing the old animation.
    // No 160 KiB policy cap: only actual free capacity after replacement.
    if(job->size>jh2_asset_local_available_bytes()){
        ESP_LOGE(TAG,"Not enough usable Nano local flash for %u bytes",
            (unsigned)job->size);
        return false;
    }
    // Only replace the one cached animation, not other LittleFS data.
    unlink(STAGE_PATH);
    unlink(CACHE_PATH);
    unlink(DIGEST_PATH);
    size_t total=0,used=0;
    if(esp_littlefs_info("storage",&total,&used)!=ESP_OK||
       total<used||total-used<(size_t)job->size+CACHE_RESERVED_BYTES){
        ESP_LOGE(TAG,"LittleFS available capacity changed before transfer");
        return false;
    }
    FILE *f=fopen(STAGE_PATH,"wb");if(!f)return false;
    char url[370],authorization[75];bool ok=false;
    if(snprintf(url,sizeof(url),"%s/api/curtain-bridge/stream/%s",job->endpoint,job->sha)>=(int)sizeof(url)){
        fclose(f);unlink(STAGE_PATH);return false;
    }
    esp_http_client_config_t cfg={.url=url,.cert_pem=(const char*)tls_roots_pem_start,
        .timeout_ms=12000,.buffer_size=2048,.buffer_size_tx=2048};
    esp_http_client_handle_t h=esp_http_client_init(&cfg);
    if(!h){fclose(f);unlink(STAGE_PATH);return false;}
    snprintf(authorization,sizeof(authorization),"Bearer %s",job->token);
    esp_http_client_set_header(h,"Authorization",authorization);
    esp_http_client_set_header(h,"X-JH2-Bridge-Token",job->token);
    mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);
    do{
        if(esp_http_client_open(h,0)!=ESP_OK)break;
        if(esp_http_client_fetch_headers(h)!=(int64_t)job->size||
           esp_http_client_get_status_code(h)!=200)break;
        if(mbedtls_sha256_starts(&sha,0)!=0)break;
        uint8_t block[2048];uint32_t count=0;
        while(count<job->size&&wanted(job->generation)){
            size_t take=job->size-count;if(take>sizeof(block))take=sizeof(block);
            int n=esp_http_client_read(h,(char*)block,(int)take);
            if(n<=0||fwrite(block,1,(size_t)n,f)!=(size_t)n||
                mbedtls_sha256_update(&sha,block,(size_t)n)!=0)break;
            count+=(uint32_t)n;
        }
        if(count!=job->size||!wanted(job->generation))break;
        stream_source stream={0};stream.sha=sha;
        if(!digest_matches(&stream,job->sha))break;
        if(fflush(f)!=0)break;
        ok=true;
    }while(0);
    mbedtls_sha256_free(&sha);esp_http_client_close(h);esp_http_client_cleanup(h);
    if(fclose(f)!=0)ok=false;
    if(ok&&rename(STAGE_PATH,CACHE_PATH)!=0)ok=false;
    if(ok){
        FILE *digest=fopen(DIGEST_PATH,"wb");
        if(!digest)ok=false;
        else {
            if(fwrite(job->sha,1,64,digest)!=64||fflush(digest)!=0)ok=false;
            if(fclose(digest)!=0)ok=false;
        }
    }
    if(!ok){unlink(STAGE_PATH);unlink(CACHE_PATH);unlink(DIGEST_PATH);}
    return ok;
}
static bool local_exact(FILE *f,uint8_t *b,size_t len,uint32_t *position,uint32_t size){
    if(!f||!b||!len||len>size-*position)return false;
    if(fread(b,1,len,f)!=len)return false;
    *position+=(uint32_t)len;return true;
}
static bool stream_local_once(asset_job *job,bool *first_sent,bool *repeat,bool verify_only,bool continued_loop){
    FILE *file=fopen(CACHE_PATH,"rb");if(!file)return false;
    uint32_t position=0;bool ok=false;
    do{
        uint8_t header[8];
        if(!local_exact(file,header,8,&position,job->size)||memcmp(header,"JHC1",4))break;
        uint16_t frames=(uint16_t)(header[4]|header[5]<<8);
        if(!frames||frames>180||header[7]>1)break;
        const bool seamless=header[7]==1;
        if(seamless&&(frames>24||!header[6]))break;
        *repeat=header[6]!=0;
        bool failed=false;
        for(uint16_t f=0;f<frames&&wanted(job->generation);f++){
            uint8_t fh[6];
            if(!local_exact(file,fh,6,&position,job->size)){failed=true;break;}
            uint32_t hold=(uint32_t)fh[0]|(uint32_t)fh[1]<<8|
                (uint32_t)fh[2]<<16|(uint32_t)fh[3]<<24;
            uint16_t packets=(uint16_t)fh[4]|((uint16_t)fh[5]<<8);
            if(packets>5000||hold<40||hold>60000){failed=true;break;}
            for(uint16_t i=0;i<packets&&wanted(job->generation);i++){
                uint8_t meta[3],packet[508];
                if(!local_exact(file,meta,3,&position,job->size)){failed=true;break;}
                uint16_t bytes=(uint16_t)meta[1]|(uint16_t)meta[2]<<8;
                uint8_t channel=meta[0];
                if(channel>1||!bytes||bytes>sizeof(packet)||
                   !local_exact(file,packet,bytes,&position,job->size)){failed=true;break;}
                if(!verify_only&&!(seamless&&continued_loop&&f==0)&&
                   !jh2_ble_asset_packet(channel,packet,bytes)){failed=true;break;}
                if(!verify_only&&(i&7)==7)vTaskDelay(pdMS_TO_TICKS(1));
            }
            if(failed||!wanted(job->generation))break;
            // The preceding final frame is identical to frame zero. On repeat,
            // skip both first-frame redraw and dwell: no visible seam or pause.
            if(!verify_only&&seamless&&continued_loop&&f==0)continue;
            if(!verify_only&&!*first_sent){
                *first_sent=true;
                job->ack(job->command_id,"applied",
                    "Verified animation cached on Nano; first frame sent over BLE; visual output unconfirmed",true);
            }
            uint32_t elapsed=0;
            uint16_t rate=speed_percent;
            if(rate<25||rate>300)rate=100;
            uint32_t adjusted=(uint32_t)(((uint64_t)hold*100U+rate/2)/rate);
            if(adjusted<20)adjusted=20;
            while(!verify_only&&elapsed<adjusted&&wanted(job->generation)){
                uint32_t step=adjusted-elapsed>20?20:adjusted-elapsed;
                vTaskDelay(pdMS_TO_TICKS(step));elapsed+=step;
            }
        }
        ok=!failed&&wanted(job->generation)&&position==job->size;
    }while(0);
    fclose(file);return ok;
}
static void run_asset(void *param){
    asset_job job=*(asset_job*)param;free(param);
    bool applied=false,repeat=false,failed=false;
    // The entire asset is saved to the Nano once, verified, then preflight parsed.
    bool cached=cache_asset_once(&job);
    bool verified=cached&&stream_local_once(&job,&applied,&repeat,true,false);
    bool seamless_loop=false;
    if(verified){
        FILE *info=fopen(CACHE_PATH,"rb");
        if(info){uint8_t h[8];seamless_loop=fread(h,1,8,info)==8&&h[7]==1;fclose(info);}
    }
    if(!verified){
        failed=wanted(job.generation);
    }else{
        unsigned cycle=0;
        while(wanted(job.generation)){
            bool current_repeat=false;
            if(!stream_local_once(&job,&applied,&current_repeat,false,cycle>0)){
                failed=wanted(job.generation);break;
            }
            repeat=current_repeat;
            if(!repeat)break;
            cycle++;
            if(!seamless_loop)for(int i=0;i<30&&wanted(job.generation);i++)
                vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
    if(failed)
        job.ack(job.command_id,"failed",
            cached?"Local Nano BLE playback failed; cached animation retained":
                   "Nano local storage/download verification failed; no frame sent",false);
    if(!applied&&!failed&&wanted(job.generation))
        job.ack(job.command_id,"failed","Cached animation had no displayed frames",false);
    if(job_lock&&xSemaphoreTake(job_lock,pdMS_TO_TICKS(1000))==pdTRUE){
        streaming=false;xSemaphoreGive(job_lock);
    }else streaming=false;
    ESP_LOGI(TAG,"Nano local animation finished bytes=%u repeated=%d",
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
bool jh2_asset_stream_set_speed(uint16_t percent){
    if(percent<25||percent>300)return false;
    speed_percent=percent;
    return true;
}
uint16_t jh2_asset_stream_get_speed(void){return speed_percent;}
void jh2_asset_stream_stop(void){++generation;}
bool jh2_asset_stream_active(void){return streaming;}


/* Registered SmartDawn native effect cache. Unlike JHC1 streaming, the
 * native transport stages an opaque .eff to LittleFS and then uploads it
 * over BLE locally. The preexisting partition table is left unchanged. */
#define NATIVE_CACHE_PATH "/littlefs/curtain-native.eff"
#define NATIVE_STAGE_PATH "/littlefs/curtain-native.tmp"
const char *jh2_native_local_path(void){return NATIVE_CACHE_PATH;}
static uint32_t local_le32(const uint8_t *p){
    return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);
}
static bool native_header_ok(const char *path,uint32_t size,uint32_t cid){
    if(!cid||size<8192||size>JH2_NATIVE_LOCAL_LIMIT)return false;
    FILE *f=fopen(path,"rb");if(!f)return false;
    uint8_t h[144]={0},item[17]={0};
    bool ok=fread(h,1,sizeof(h),f)==sizeof(h);
    if(ok){
        uint32_t offset=local_le32(h+128),frames=(uint32_t)h[134]|(uint32_t)h[135]<<8;
        ok=(!memcmp(h,"DNMX",4)||!memcmp(h,"DNCX",4))&&
           h[4]==3&&h[5]==1&&h[6]==40&&h[7]==0&&h[8]==40&&h[9]==0&&
           local_le32(h+10)==4800&&local_le32(h+14)==cid&&
           offset>=4096&&offset<=size-4096&&frames>=2&&frames<=180&&
           (uint64_t)offset+4096+(uint64_t)4800*frames<=size;
        if(ok)ok=fseek(f,(long)offset,SEEK_SET)==0&&fread(item,1,sizeof(item),f)==sizeof(item)&&
            !memcmp(item,"DNX2",4)&&item[4]==3&&local_le32(item+5)==4800&&
            local_le32(item+9)==frames&&item[13]==40&&item[14]==0&&
            item[15]==40&&item[16]==0;
    }
    fclose(f);return ok;
}
bool jh2_asset_native_verified(const char *sha,uint32_t size,uint32_t cid){
    return hex64(sha)&&native_header_ok(NATIVE_CACHE_PATH,size,cid)&&
           file_digest_ok(NATIVE_CACHE_PATH,sha,size);
}
bool jh2_asset_stage_native(const char *endpoint,const char *token,
                            const char *sha,uint32_t size,uint32_t cid){
    if(!endpoint||!token||!hex64(sha)||!cid||size<8192||
       size>JH2_NATIVE_LOCAL_LIMIT||streaming)return false;
    if(jh2_asset_native_verified(sha,size,cid))return true;
    size_t total=0,used=0;
    if(esp_littlefs_info("storage",&total,&used)!=ESP_OK||used>total)return false;
    struct stat old={0};
    size_t reclaim=stat(NATIVE_CACHE_PATH,&old)==0&&old.st_size>0?
                   (size_t)old.st_size:0;
    // The old verified animation is expendable; do not remove JHC1,
    // secrets.json, settings, NVS or any other LittleFS path.
    if((uint64_t)total-used+reclaim<(uint64_t)size+CACHE_RESERVED_BYTES)return false;
    char url[370],authorization[75];
    if(snprintf(url,sizeof(url),"%s/api/curtain-bridge/stream/%s",endpoint,sha)>=(int)sizeof(url))return false;
    unlink(NATIVE_STAGE_PATH);unlink(NATIVE_CACHE_PATH);
    FILE *f=fopen(NATIVE_STAGE_PATH,"wb");if(!f)return false;
    esp_http_client_config_t cfg={.url=url,.cert_pem=(const char*)tls_roots_pem_start,
        .timeout_ms=12000,.buffer_size=2048,.buffer_size_tx=2048};
    esp_http_client_handle_t h=esp_http_client_init(&cfg);
    if(!h){fclose(f);unlink(NATIVE_STAGE_PATH);return false;}
    snprintf(authorization,sizeof(authorization),"Bearer %s",token);
    esp_http_client_set_header(h,"Authorization",authorization);
    esp_http_client_set_header(h,"X-JH2-Bridge-Token",token);
    stream_source source={.h=h,.bytes=size};
    mbedtls_sha256_init(&source.sha);
    bool ok=false;
    if(esp_http_client_open(h,0)==ESP_OK&&
       esp_http_client_fetch_headers(h)==(int64_t)size&&
       esp_http_client_get_status_code(h)==200&&
       mbedtls_sha256_starts(&source.sha,0)==0){
        uint8_t b[2048];uint32_t count=0;
        while(count<size){
            size_t take=size-count;if(take>sizeof(b))take=sizeof(b);
            if(!read_exact(&source,b,take,generation)||fwrite(b,1,take,f)!=take)break;
            count+=(uint32_t)take;
        }
        ok=count==size&&digest_matches(&source,sha)&&fflush(f)==0;
    }
    mbedtls_sha256_free(&source.sha);
    esp_http_client_close(h);esp_http_client_cleanup(h);
    if(fclose(f)!=0)ok=false;
    if(ok)ok=native_header_ok(NATIVE_STAGE_PATH,size,cid);
    if(ok)ok=rename(NATIVE_STAGE_PATH,NATIVE_CACHE_PATH)==0;
    if(!ok)unlink(NATIVE_STAGE_PATH);
    if(ok)ESP_LOGI(TAG,"NATIVE_EFF_STAGED_LOCAL size=%u cid=%lu sha=%.12s",
                   (unsigned)size,(unsigned long)cid,sha);
    return ok;
}
