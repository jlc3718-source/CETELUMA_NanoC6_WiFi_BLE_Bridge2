/*
 * Jason Home 2 native ESP-IDF diagnostic: Bluetooth-only, READ-ONLY.
 * One dedicated ESP32-C6 NimBLE central, no Wi-Fi/Oracle/Eufy/flash changes.
 * Manufacturer-observed request sequence: 205, 167, 2904.
 *
 * This image is an engineering probe, NOT a drop-in replacement for the
 * working Jason Home 2 runtime. Never install on the production Nano
 * until the Oracle transport has been migrated and accepted.
 */
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include "nvs.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_err.h"
#include "nvs_flash.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "os/os_mbuf.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "effectlist.h"
#include "native_ble.h"
#include "asset_stream.h"
#include "native_slot_guard.h"
#include "bridge.h"
#include "web_recovery.h"
#if CONFIG_JH2_NATIVE_BROWSER_OTA_COMPAT
extern const char jh2_native_runtime_marker[];

#endif
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include "mbedtls/base64.h"

#if !CONFIG_BT_NIMBLE_ENABLED
#error "The ESP-IDF NimBLE host must be enabled."
#endif
#if CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE < 512
#error "NimBLE's actual host receive mbuf must fit a complete large native EffectList notification."
#endif

extern void jh2_hci_acl_diag(cJSON *out);
static const char *TAG="JH2_IDF_BLE";

/* Hardware-independent firmware recovery state machine.
 * A/B candidates are marked healthy only after local web + BLE + bridge
 * have been alive for 60 seconds. ESP-IDF bootloader rolls back PENDING
 * candidates that reboot first. Three watchdog/panic boot loops of an
 * already confirmed app enter the separate factory rescue Wi-Fi uploader.
 */
static int64_t failsafe_boot_us=0;
static bool failsafe_confirmed=false;
static esp_reset_reason_t previous_reset_reason=ESP_RST_UNKNOWN;
static uint32_t persistent_boot_count=0;
static uint8_t persistent_crash_streak=0;
void jh2_runtime_boot_diagnostics(cJSON *out){
    if(!cJSON_IsObject(out))return;
    cJSON_AddNumberToObject(out,"espResetReason",(int)previous_reset_reason);
    cJSON_AddNumberToObject(out,"bootCounter",persistent_boot_count);
    cJSON_AddNumberToObject(out,"consecutiveCrashResets",persistent_crash_streak);
    cJSON_AddNumberToObject(out,"runtimeUptimeSeconds",(double)(esp_timer_get_time()/1000000ULL));
    cJSON_AddBoolToObject(out,"runtimeHealthy60s",failsafe_confirmed);
}

static void failsafe_boot_failed(void){
    const esp_partition_t *running=esp_ota_get_running_partition();
    esp_ota_img_states_t state;
    if(running&&esp_ota_get_state_partition(running,&state)==ESP_OK&&
       state==ESP_OTA_IMG_PENDING_VERIFY){
        ESP_LOGE(TAG,"Candidate failed startup; bootloader rollback requested");
        if(esp_ota_mark_app_invalid_rollback_and_reboot()==ESP_OK)return;
    }
    // A configuration or web initialization failure must NOT overwrite
    // the OTA boot choice with factory recovery. Preserve A/B selection.
    ESP_LOGE(TAG,"Runtime startup failed, retrying the same slot; factory recovery remains manual");
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart();
}
static void failsafe_boot_begin(void){
    failsafe_boot_us=esp_timer_get_time();
    const esp_reset_reason_t reason=esp_reset_reason();
    previous_reset_reason=reason;
    ESP_LOGW(TAG,"BOOT_DIAGNOSTIC reset_reason=%d",(int)reason);
    bool crash=reason==ESP_RST_PANIC||reason==ESP_RST_INT_WDT||
               reason==ESP_RST_TASK_WDT||reason==ESP_RST_WDT;
    nvs_handle_t n;
    if(nvs_open("jh2-failsafe",NVS_READWRITE,&n)==ESP_OK){
        uint8_t streak=0;
        (void)nvs_get_u8(n,"crashes",&streak);
        (void)nvs_get_u32(n,"boots",&persistent_boot_count);
        if(persistent_boot_count<UINT32_MAX)++persistent_boot_count;
        if(crash&&streak<255)streak++;
        if(!crash)streak=0;
        if(streak>=3){
            // Do not select the factory updater automatically.
            ESP_LOGE(TAG,"Consecutive crash resets; retaining A/B runtime and local setup");
            streak=0;
        }
        persistent_crash_streak=streak;
        (void)nvs_set_u32(n,"boots",persistent_boot_count);
        (void)nvs_set_u8(n,"crashes",streak);
        (void)nvs_commit(n);nvs_close(n);
        ESP_LOGW(TAG,"BOOT_DIAGNOSTIC boots=%lu crash_streak=%u",
                 (unsigned long)persistent_boot_count,(unsigned)streak);
    }
}
static void failsafe_confirm_after_60s(void){
    if(failsafe_confirmed||!failsafe_boot_us||
       esp_timer_get_time()-failsafe_boot_us<60000000LL)return;
    const esp_partition_t *running=esp_ota_get_running_partition();
    if(!running||(running->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_0&&
                  running->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_1))return;
    esp_ota_img_states_t state;
    if(esp_ota_get_state_partition(running,&state)==ESP_OK&&
       state==ESP_OTA_IMG_PENDING_VERIFY){
        if(esp_ota_mark_app_valid_cancel_rollback()!=ESP_OK){
            ESP_LOGE(TAG,"Cannot confirm OTA candidate; requesting safe rollback");
            failsafe_boot_failed();return;
        }
    }
    nvs_handle_t n;
    if(nvs_open("jh2-failsafe",NVS_READWRITE,&n)==ESP_OK){
        nvs_set_u8(n,"good",running->subtype==ESP_PARTITION_SUBTYPE_APP_OTA_1?1:0);
        nvs_set_u8(n,"crashes",0);
        nvs_commit(n);nvs_close(n);
        persistent_crash_streak=0;
    }
    failsafe_confirmed=true;
    ESP_LOGW(TAG,"2.0.6 runtime health confirmed after 60 seconds; A/B recovery retained");
}

static const char TARGET[]="DN5E58";
static const ble_uuid128_t SVC_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x19,0x74,0x00,0x00,0x00);
static const ble_uuid128_t WRITE_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x19,0x74,0x00,0x02,0x01);
static const ble_uuid128_t NOTIFY_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x19,0x74,0x00,0x01,0x01);

static uint16_t connection=BLE_HS_CONN_HANDLE_NONE;
static uint16_t service_start=0,service_end=0,writer=0,notifier=0,cccd=0;
static uint16_t next_def_after_notify=UINT16_MAX;
static uint32_t notification_count=0,catalog_packets=0,catalog_unique=0;
static volatile uint32_t unexpected_notify_count=0;
static volatile uint16_t last_unexpected_notify_handle=0;
static volatile uint16_t conn_interval_units=0,conn_latency=0;
static volatile int conn_update_request_rc=-1,conn_update_status=-1;
static volatile uint32_t conn_updates=0;
static volatile int phy_2m_request_rc=-1;
static volatile uint32_t phy_status_queries=0;
static uint16_t heart=0,upload=0;
static uint8_t catalog_seen[JH2_EFFECT_CAPACITY]={0};
static uint16_t catalog_slot[JH2_EFFECT_CAPACITY]={0};
static uint8_t catalog_type[JH2_EFFECT_CAPACITY]={0};
static uint64_t catalog_cid[JH2_EFFECT_CAPACITY]={0};
static volatile int64_t target_section_at=0;
static volatile unsigned target_section_matches=0;
static volatile uint16_t target_section_slot=0;
void jh2_ble_target_invalidate(void){target_section_at=0;}
void jh2_ble_catalog_begin_read(void){
    target_section_at=0;
    memset(catalog_seen,0,sizeof(catalog_seen));
    memset(catalog_slot,0,sizeof(catalog_slot));
    memset(catalog_type,0,sizeof(catalog_type));
    memset(catalog_cid,0,sizeof(catalog_cid));
    catalog_unique=0;
}
bool jh2_ble_target_section(unsigned *matches,uint16_t *slot){
    if(!target_section_at||esp_timer_get_time()-target_section_at>120000000||
       connection==BLE_HS_CONN_HANDLE_NONE)return false;
    *matches=target_section_matches;*slot=target_section_slot;return true;
}
// Do not permit an assigned-CID upload or erase on an incomplete catalog.
// The Nano has a single custom store: all factory IDs and the fresh
// terminal custom page must be accounted for first.
bool jh2_ble_catalog_cid(uint32_t cid,unsigned *matches,uint16_t *slot){
    if(!cid||!matches||!slot||!target_section_at||
       esp_timer_get_time()-target_section_at>120000000||
       connection==BLE_HS_CONN_HANDLE_NONE)return false;
    for(unsigned id=0;id<=86;id++)if(!catalog_seen[id])return false;
    *matches=0;*slot=0;
    for(unsigned id=0;id<JH2_EFFECT_CAPACITY;id++){
        if(!catalog_seen[id]||catalog_cid[id]!=(uint64_t)cid)continue;
        ++*matches;
        if(id<87){*matches=2;return true;}
        *slot=catalog_slot[id];
    }
    return true;
}
static SemaphoreHandle_t notice_lock=NULL,raw_write_lock=NULL,raw_write_event=NULL;
static volatile int last_write_status=-1;
static volatile bool raw_write_pending=false,raw_write_fault=false;
static uint32_t notice_number=0,notice_drops=0;
static const ble_uuid128_t HEART_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x19,0x74,0x00,0x02,0x02);
static const ble_uuid128_t UPLOAD_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x20,0x01,0x30,0x92,0x27);
// Restore pre-rewrite BLE scan/selected-controller behavior.
#define DISCOVERED_MAX 12
typedef struct {ble_addr_t addr;int8_t rssi;char name[32];uint32_t seen_ms;} discovered_device;
static discovered_device discovered[DISCOVERED_MAX];
static size_t discovered_count=0;
static SemaphoreHandle_t discovered_lock=NULL;
static ble_addr_t selected_addr={0};
static bool selected_valid=false;
static volatile uint32_t ble_scan_requests=0;
static volatile bool ble_host_ready=false;
static volatile bool ble_scan_only=false;
static volatile uint32_t ble_full_scan_requests=0;
static volatile uint32_t ble_last_disconnect_reason=0;
static volatile uint32_t ble_reconnect_attempts=0;
static volatile uint32_t ble_connection_successes=0;
static volatile uint32_t ble_recovery_scan_cycles=0;
static volatile uint32_t ble_retry_delay_seconds=0;
static volatile uint8_t ble_failure_streak=0;
static volatile int64_t ble_next_retry_us=0;
static volatile int64_t ble_connected_since_us=0;
static volatile bool ble_connect_pending=false;
static ble_addr_t ble_connect_addr={0};
// GAP callbacks only schedule retries; never recursively scan / connect.
static void schedule_ble_retry(const char *reason){
    if(hold_disconnect||ble_scan_only)return;
    if(ble_failure_streak<5)++ble_failure_streak;
    uint32_t delay=10U << (ble_failure_streak-1);
    if(delay>120U)delay=120U;
    ble_retry_delay_seconds=delay;
    ble_next_retry_us=esp_timer_get_time()+(int64_t)delay*1000000LL;
    ESP_LOGW(TAG,"BLE_RETRY_SCHEDULED cause=%s seconds=%lu failures=%u",
             reason,(unsigned long)delay,(unsigned)ble_failure_streak);
}
static volatile uint32_t local_command_seq=0,local_command_success=0,local_command_failure=0;
static bool hold_disconnect=false;
static void begin_scan(void);
static void format_mac(const ble_addr_t *addr,char out[18]){
    snprintf(out,18,"%02X:%02X:%02X:%02X:%02X:%02X",addr->val[5],addr->val[4],
             addr->val[3],addr->val[2],addr->val[1],addr->val[0]);
}
static bool parse_mac(const char *mac,uint8_t out[6]){
    if(!mac || strlen(mac)!=17)return false;
    unsigned x[6]={0};
    if(sscanf(mac,"%2x:%2x:%2x:%2x:%2x:%2x",&x[0],&x[1],&x[2],&x[3],&x[4],&x[5])!=6)return false;
    for(size_t k=0;k<6;k++)out[5-k]=(uint8_t)x[k];
    return true;
}
static void cache_discovery(const struct ble_gap_disc_desc *disc,const struct ble_hs_adv_fields *f){
    if(!discovered_lock || xSemaphoreTake(discovered_lock,0)!=pdTRUE)return;
    size_t i=0;for(;i<discovered_count;i++){
        if(ble_addr_cmp(&discovered[i].addr,&disc->addr)==0)break;
    }
    if(i>=DISCOVERED_MAX)i=DISCOVERED_MAX-1;
    if(i>=discovered_count)discovered_count=i+1;
    discovered[i].addr=disc->addr;
    discovered[i].rssi=disc->rssi;
    discovered[i].seen_ms=(uint32_t)(esp_timer_get_time()/1000);
    // Advertisements and scan responses arrive separately. Keep an
    // existing name when a subsequent packet has no name field.
    if(f->name && f->name_len){
        size_t n=f->name_len<sizeof(discovered[i].name)-1?f->name_len:sizeof(discovered[i].name)-1;
        memcpy(discovered[i].name,f->name,n);
        discovered[i].name[n]=0;
    }
    xSemaphoreGive(discovered_lock);
}
static void load_target(void){
    nvs_handle_t n;
    if(nvs_open("jh2-curtain",NVS_READONLY,&n)!=ESP_OK)return;
    size_t len=sizeof(selected_addr);
    if(nvs_get_blob(n,"target",&selected_addr,&len)==ESP_OK && len==sizeof(selected_addr))
        selected_valid=true;
    nvs_close(n);
}
bool jh2_ble_scan_start(void){
    ++ble_scan_requests;
    if(!ble_host_ready)return false;
    if(connection!=BLE_HS_CONN_HANDLE_NONE)return true;
    hold_disconnect=false;ble_scan_only=false;
    ble_failure_streak=0;ble_retry_delay_seconds=0;
    ble_next_retry_us=esp_timer_get_time();
    return true; // Main task starts a bounded scan, not this HTTP callback.
}
bool jh2_ble_full_scan(void){
    if(!ble_host_ready||!discovered_lock ||
       connection!=BLE_HS_CONN_HANDLE_NONE || ble_connect_pending ||
       ble_gap_disc_active())return false;
    if(xSemaphoreTake(discovered_lock,pdMS_TO_TICKS(500))!=pdTRUE)return false;
    discovered_count=0;
    memset(discovered,0,sizeof(discovered));
    xSemaphoreGive(discovered_lock);
    ++ble_full_scan_requests;
    hold_disconnect=false;
    ble_scan_only=true;
    begin_scan(); // 15-second discovery only; never initiates connection.
    return true;
}
bool jh2_ble_reconnect_last(void){
    if(!ble_host_ready||!selected_valid)return false;
    if(connection!=BLE_HS_CONN_HANDLE_NONE){
        struct ble_gap_conn_desc current={0};
        if(ble_gap_conn_find(connection,&current)==0 &&
           ble_addr_cmp(&current.peer_ota_addr,&selected_addr)==0)
            return true; // Never disconnect an already-correct, healthy link.
        // Switching to a different selected device requires one termination.
        hold_disconnect=false;
        return ble_gap_terminate(connection,BLE_ERR_REM_USER_CONN_TERM)==0;
    }
    hold_disconnect=false;ble_scan_only=false;
    ble_failure_streak=0;ble_retry_delay_seconds=0;
    ble_next_retry_us=esp_timer_get_time();
    return true;
}
bool jh2_ble_select_target(const char *mac){
    uint8_t desired[6]={0};
    if(!parse_mac(mac,desired)||!discovered_lock)return false;
    ble_addr_t addr={0};bool found=false;
    if(xSemaphoreTake(discovered_lock,pdMS_TO_TICKS(500))!=pdTRUE)return false;
    for(size_t i=0;i<discovered_count;i++){
        if(memcmp(discovered[i].addr.val,desired,6)==0){
            addr=discovered[i].addr;found=true;break;
        }
    }
    xSemaphoreGive(discovered_lock);
    if(!found)return false;
    nvs_handle_t n;
    if(nvs_open("jh2-curtain",NVS_READWRITE,&n)!=ESP_OK)return false;
    bool saved=nvs_set_blob(n,"target",&addr,sizeof(addr))==ESP_OK &&
               nvs_commit(n)==ESP_OK;
    nvs_close(n);
    if(!saved)return false;
    selected_addr=addr;selected_valid=true;
    hold_disconnect=false;ble_scan_only=false;
    ble_failure_streak=0;ble_retry_delay_seconds=0;
    ble_next_retry_us=esp_timer_get_time();
    if(connection!=BLE_HS_CONN_HANDLE_NONE){
        struct ble_gap_conn_desc current={0};
        if(ble_gap_conn_find(connection,&current)==0 &&
           ble_addr_cmp(&current.peer_ota_addr,&selected_addr)==0)
            return true; // Do not disturb matching connection.
        return ble_gap_terminate(connection,BLE_ERR_REM_USER_CONN_TERM)==0;
    }
    // A running discovery is allowed to finish; a later bounded scan uses
    // the remembered controller address without resetting the BLE stack.
    return true;
}
bool jh2_ble_disconnect(void){
    hold_disconnect=true;
    ble_scan_only=false;
    ble_connect_pending=false;
    ble_next_retry_us=0;
    if(ble_host_ready&&ble_gap_disc_active())ble_gap_disc_cancel();
    if(connection==BLE_HS_CONN_HANDLE_NONE)return true;
    return ble_gap_terminate(connection,BLE_ERR_REM_USER_CONN_TERM)==0;
}
bool jh2_ble_target_slot_seen(uint16_t slot){
    for(unsigned id=0;id<JH2_EFFECT_CAPACITY;id++)
        if(catalog_seen[id] && catalog_cid[id]==83928 && catalog_slot[id]==slot)return true;
    return false;
}
static const char *WRITE_UUID_TEXT="01020074-1972-1925-3022-077119514e44";
static const char *HEART_UUID_TEXT="02020074-1972-1925-3022-077119514e44";
static const char *UPLOAD_UUID_TEXT="27923001-2072-1925-3022-077119514e44";
#define NOTICE_RING_SIZE 48
#define CATALOG_RX_QUEUE_DEPTH 24
typedef struct{uint32_t id;uint16_t len;uint32_t received_ms;uint8_t b[520];} gatt_notice;
static gatt_notice notices[NOTICE_RING_SIZE];
// The NimBLE GAP callback must never parse protobuf or log a 400-byte
// catalog frame. The phone sends five responses in ~14 ms, often before
// the previous callback can finish. Copy into a bounded queue and return.
static QueueHandle_t catalog_queue=NULL;
static volatile uint32_t catalog_enqueued=0,catalog_queue_drops=0;
static volatile uint32_t catalog_parsed=0,catalog_parse_errors=0,catalog_fragments=0;
static size_t notice_head=0,notice_count=0;
// Per-current-BLE-link wire counters: raw GATT receipt, independent of decoding.
static volatile uint32_t raw_rx_2103=0,raw_rx_2105=0,raw_rx_2630=0;
static void record_notice(const uint8_t *raw,size_t len){
    if(!raw||len==0||len>sizeof(notices[0].b)){++notice_drops;return;}
    if(len>=24 && raw[1]==1 && raw[2]==0 && raw[3]==0
       && (((uint16_t)raw[10]<<8)|raw[11])==2630){
        static int64_t last_progress=0;
        int64_t now=esp_timer_get_time();
        if(now-last_progress<2000000)return;
        last_progress=now;
    }
    if(!notice_lock || xSemaphoreTake(notice_lock,0)!=pdTRUE){++notice_drops;return;}
    size_t idx=(notice_head+notice_count)%NOTICE_RING_SIZE;
    if(notice_count==NOTICE_RING_SIZE){notice_head=(notice_head+1)%NOTICE_RING_SIZE;++notice_drops;}
    else ++notice_count;
    notices[idx].id=++notice_number;
    notices[idx].len=(uint16_t)len;
    notices[idx].received_ms=(uint32_t)(esp_timer_get_time()/1000);
    memcpy(notices[idx].b,raw,len);
    xSemaphoreGive(notice_lock);
}
uint32_t jh2_ble_collect_notices(cJSON *array,uint32_t after){
    if(!cJSON_IsArray(array)||!notice_lock)return after;
    uint32_t cursor=after;
    for(size_t n=0;n<NOTICE_RING_SIZE;n++){
        gatt_notice item={0};bool found=false;
        xSemaphoreTake(notice_lock,portMAX_DELAY);
        for(size_t i=0;i<notice_count;i++){
            const gatt_notice *p=&notices[(notice_head+i)%NOTICE_RING_SIZE];
            if(p->id>cursor){item=*p;found=true;break;}
        }
        xSemaphoreGive(notice_lock);
        if(!found)break;
        uint8_t encoded[728];size_t encoded_len=0;
        if(mbedtls_base64_encode(encoded,sizeof(encoded)-1,&encoded_len,item.b,item.len)!=0)break;
        encoded[encoded_len]=0;
        cJSON *row=cJSON_CreateObject();
        if(!row)break;
        cJSON_AddNumberToObject(row,"id",item.id);
        cJSON_AddStringToObject(row,"uuid","01010074-1972-1925-3022-077119514e44");
        cJSON_AddStringToObject(row,"data",(const char*)encoded);
        cJSON_AddItemToArray(array,row);
        cursor=item.id;
    }
    return cursor;
}
/* SmartDawn PlayProgressNotify (2630) readback. Parses only short
 * controller-originated notices on the HTTP status task, never on the NimBLE
 * callback. A mode-only notice never erases the last reported effect identity.
 * No BLE commands, storage writes, or physical playback claims are made. */
typedef struct {
    uint32_t id,received_ms,type,slot,cid,total_frames,current_frame,interval_ms;
    bool valid,identity,slot_defaulted,has_frames,has_interval;
    char title[97];
} jh2_playback_info;
static jh2_playback_info playback_now={0},playback_identified={0};
static uint32_t playback_cursor=0;
static bool jh2_progress_varint(const uint8_t *b,size_t n,size_t *offset,uint32_t *out){
    uint32_t value=0;
    for(unsigned shift=0;shift<=28;shift+=7){
        if(*offset>=n)return false;
        uint8_t v=b[(*offset)++];
        if(shift==28 && (v&0xf0))return false;
        value|=(uint32_t)(v&0x7f)<<shift;
        if(!(v&0x80)){*out=value;return true;}
    }
    return false;
}
static bool jh2_decode_progress(const gatt_notice *notice,jh2_playback_info *out){
    const uint8_t *b=notice->b;size_t n=notice->len;
    if(n<26||n>520||b[1]!=1||b[2]!=0||b[3]!=0||b[4]!=0xf1||b[5]!=1||
       (((uint16_t)b[8]<<8)|b[9])!=n-4||
       (((uint16_t)b[10]<<8)|b[11])!=2630)return false;
    jh2_playback_info v={.id=notice->id,.received_ms=notice->received_ms};
    size_t at=24;bool has_type=false,has_slot=false,has_cid=false;
    while(at<n){
        uint32_t tag=0;
        if(!jh2_progress_varint(b,n,&at,&tag)||!tag)return false;
        uint32_t field=tag>>3,wire=tag&7;
        if(wire==0){
            uint32_t x=0;if(!jh2_progress_varint(b,n,&at,&x))return false;
            switch(field){
            case 2:v.type=x;has_type=true;break;
            case 3:v.slot=x;has_slot=true;break;
            case 4:v.cid=x;has_cid=true;break;
            case 5:v.total_frames=x;v.has_frames=true;break;
            case 6:v.current_frame=x;break;
            case 9:v.interval_ms=x;v.has_interval=true;break;
            default:break;
            }
        }else if(wire==2){
            uint32_t size=0;
            if(!jh2_progress_varint(b,n,&at,&size)||size>n-at)return false;
            if(field==1){
                size_t count=size<sizeof(v.title)-1?size:sizeof(v.title)-1;
                memcpy(v.title,b+at,count);v.title[count]=0;
                for(size_t k=0;k<count;k++)if((unsigned char)v.title[k]<32)v.title[k]=' ';
            }
            at+=size;
        }else if(wire==1){if(n-at<8)return false;at+=8;}
        else if(wire==5){if(n-at<4)return false;at+=4;}
        else return false;
    }
    if(!has_type||v.type>32|| (has_slot&&v.slot>100000)||
       (has_cid&&v.cid>0x7fffffff))return false;
    // Protobuf3 omits zero fields. For known CID-addressed native effects, zero
    // is a valid slot (E-0), but for doodle/mode-only it is not an identity.
    v.slot_defaulted=!has_slot&&has_cid&&(v.type==1||v.type==3);
    v.identity=has_cid&&(has_slot||v.slot_defaulted);
    v.valid=true;*out=v;return true;
}
static void jh2_add_progress(cJSON *parent,const char *name,
                            const jh2_playback_info *v,bool connected){
    cJSON *o=cJSON_AddObjectToObject(parent,name);
    if(!v->valid){cJSON_AddStringToObject(o,"state","unknown");return;}
    uint32_t age=(uint32_t)(esp_timer_get_time()/1000)-v->received_ms;
    cJSON_AddStringToObject(o,"state",!connected?"stale":
       age<30000?"current":"stale");
    cJSON_AddNumberToObject(o,"ageMs",age);
    cJSON_AddNumberToObject(o,"noticeId",v->id);
    cJSON_AddStringToObject(o,"source","controller-ble");
    cJSON_AddNumberToObject(o,"opcode",2630);
    cJSON_AddNumberToObject(o,"type",v->type);
    cJSON_AddStringToObject(o,"mode",v->type==9?"Doodle":v->type==10?"Solid color":"Effect");
    cJSON_AddBoolToObject(o,"identityReported",v->identity);
    cJSON_AddBoolToObject(o,"slotDefaulted",v->slot_defaulted);
    if(v->identity){
        cJSON_AddNumberToObject(o,"slot",v->slot);
        cJSON_AddNumberToObject(o,"cid",v->cid);
    }else{
        cJSON_AddNullToObject(o,"slot");cJSON_AddNullToObject(o,"cid");
    }
    if(v->title[0])cJSON_AddStringToObject(o,"title",v->title);
    else cJSON_AddNullToObject(o,"title");
    if(v->has_frames){
        cJSON_AddNumberToObject(o,"totalFrames",v->total_frames);
        cJSON_AddNumberToObject(o,"currentFrame",v->current_frame);
    }
    if(v->has_interval)cJSON_AddNumberToObject(o,"intervalMs",v->interval_ms);
}
/* SmartDawn vendor p2p.proto power: 2103 DeviceInfoNotify field 7,
 * 2105 SimpleMessage.i1 (0=off, nonzero=on). Passive and read-only.
 * The valid 40x40 DeviceInfoNotify has an unrelated negative int64 in field
 * 22, encoded as a ten-byte unsigned varint. A uint32 decoder rejects the
 * entire notification and loses the power state. Decode wire uint64 here;
 * keep playback's existing uint32 parser unchanged. */
typedef struct{uint32_t id,received_ms,opcode;bool valid,on;} jh2_power_info;
static jh2_power_info current_power={0};
static bool jh2_power_varint64(const uint8_t *b,size_t n,size_t *pos,uint64_t *out){
 uint64_t value=0;
 for(unsigned k=0;k<10;k++){
  if(*pos>=n)return false;
  const uint8_t part=b[(*pos)++];
  if(k==9 && (part&0xfe)!=0)return false; // reject uint64 overflow
  value|=((uint64_t)(part&0x7f))<<(7*k);
  if((part&0x80)==0){*out=value;return true;}
 }
 return false;
}
static bool jh2_decode_power(const gatt_notice *notice,jh2_power_info *out){
 if(!notice||!out)return false;
 const uint8_t *b=notice->b;const size_t n=notice->len;
 if(n<24||n>520||b[1]!=1||b[2]!=0||b[3]!=0||b[4]!=0xf1||b[5]!=1||
    (((uint16_t)b[8]<<8)|b[9])!=n-4)return false;
 const uint32_t opcode=((uint32_t)b[10]<<8)|b[11];
 if(opcode!=2103&&opcode!=2105)return false;
 size_t at=24;bool found=false,identity=false;
 uint32_t power=0;uint64_t width=0,height=0,raw_width=0,raw_height=0;
 while(at<n){
  uint64_t tag=0;
  if(!jh2_power_varint64(b,n,&at,&tag)||tag==0||tag>UINT32_MAX)return false;
  const uint32_t field=(uint32_t)(tag>>3),wire=(uint32_t)(tag&7);
  if(wire==0){
   uint64_t val=0;if(!jh2_power_varint64(b,n,&at,&val))return false;
   if((opcode==2105&&field==1)||(opcode==2103&&field==7)){
    if(val>255)return false;
    power=(uint32_t)val;
    found=true;
   }
   if(opcode==2103){
    if(field==8)width=val;
    if(field==9)height=val;
    if(field==39)raw_width=val;
    if(field==40)raw_height=val;
    if(field==2||field==3||field==6||field==33||field==34||field==36)identity=true;
   }
  }else if(wire==2){
   uint64_t size=0;
   if(!jh2_power_varint64(b,n,&at,&size)||size>(uint64_t)(n-at))return false;
   if(opcode==2103&&size>0&&(field==4||field==5||field==12||field==29))identity=true;
   at+=(size_t)size;
  }else if(wire==1){if(n-at<8)return false;at+=8;}
   else if(wire==5){if(n-at<4)return false;at+=4;}
   else return false;
 }
 // Proto3 omits scalar field 7 when powerstate=0. Only infer OFF from a
 // structurally complete 40x40 DeviceInfoNotify; never from 2630 playback,
 // an arbitrary short fragment, or an unrecognized device.
 if(opcode==2103&&!found&&identity&&
    ((width==40&&height==40)||(raw_width==40&&raw_height==40))){
  power=0;found=true;
 }
 if(!found)return false;
 *out=(jh2_power_info){.id=notice->id,.received_ms=notice->received_ms,
  .opcode=opcode,.valid=true,.on=power!=0};return true;
}
void jh2_ble_playback_status(cJSON *status){
    if(!status)return;
    // Pull the bounded latest notice ring in producer order. Lock only to copy
    // one notice; parse outside NimBLE and the mutex.
    for(unsigned pass=0;pass<NOTICE_RING_SIZE;pass++){
        gatt_notice sample={0};bool found=false;
        if(!notice_lock||xSemaphoreTake(notice_lock,pdMS_TO_TICKS(40))!=pdTRUE)break;
        for(size_t i=0;i<notice_count;i++){
            const gatt_notice *p=&notices[(notice_head+i)%NOTICE_RING_SIZE];
            if(p->id>playback_cursor){sample=*p;found=true;break;}
        }
        xSemaphoreGive(notice_lock);
        if(!found)break;
        playback_cursor=sample.id;
        jh2_power_info power={0};
        if(jh2_decode_power(&sample,&power))current_power=power;
        jh2_playback_info parsed={0};
        if(jh2_decode_progress(&sample,&parsed)){
            playback_now=parsed;
            if(parsed.identity)playback_identified=parsed;
        }
    }
    bool connected=connection!=BLE_HS_CONN_HANDLE_NONE;
    jh2_add_progress(status,"controllerPlayback",&playback_now,connected);
    jh2_add_progress(status,"controllerLastIdentified",&playback_identified,connected);
    cJSON *power=cJSON_AddObjectToObject(status,"controllerPower");
    if(power){
     if(!current_power.valid)cJSON_AddStringToObject(power,"state","unknown");
     else{
      cJSON_AddStringToObject(power,"state",connected?"last-reported":"stale");
      cJSON_AddBoolToObject(power,"on",current_power.on);
      cJSON_AddNumberToObject(power,"opcode",current_power.opcode);
      cJSON_AddNumberToObject(power,"noticeId",current_power.id);
      cJSON_AddNumberToObject(power,"ageMs",(uint32_t)(esp_timer_get_time()/1000)-current_power.received_ms);
      cJSON_AddStringToObject(power,"source","controller-ble");
     }
    }
}
uint32_t jh2_ble_notice_cursor(void){
    if(!notice_lock)return 0;
    xSemaphoreTake(notice_lock,portMAX_DELAY);
    uint32_t cursor=notice_number;
    xSemaphoreGive(notice_lock);return cursor;
}
static bool reply_varint(const uint8_t *b,size_t n,size_t *p,uint32_t *value){
    uint32_t v=0;
    for(unsigned shift=0;shift<35;shift+=7){
        if(*p>=n)return false;
        uint8_t c=b[(*p)++];
        if(shift==28&&(c&240))return false;
        v|=(uint32_t)(c&127)<<shift;
        if(!(c&128)){*value=v;return true;}
    }
    return false;
}
/* SmartDawn sends upload-progress opcode 2933 at 7,17,27... packets.
 * 0xFB (251) is observed DURING active upload, so it must not be treated
 * as a completed-file acknowledgment. The sender waits for a real
 * controller-originated counter before pushing each next packet window. */
bool jh2_ble_upload_progress(uint32_t *cursor,uint32_t parts,uint32_t min_completed,
                            uint32_t timeout_ms,const char **error){
    *error="SmartDawn progress response did not catch up with local BLE packet window";
    if(!cursor||!parts||!min_completed)return false;
    const int64_t deadline=esp_timer_get_time()+(int64_t)timeout_ms*1000;
    while(esp_timer_get_time()<deadline&&connection!=BLE_HS_CONN_HANDLE_NONE){
        gatt_notice item={0};bool found=false;
        xSemaphoreTake(notice_lock,portMAX_DELAY);
        for(size_t i=0;i<notice_count;i++){
            const gatt_notice *p=&notices[(notice_head+i)%NOTICE_RING_SIZE];
            if(p->id>*cursor){item=*p;found=true;break;}
        }
        xSemaphoreGive(notice_lock);
        if(!found){vTaskDelay(pdMS_TO_TICKS(15));continue;}
        *cursor=item.id;
        const uint8_t *b=item.b;size_t n=item.len;
        if(n<24||b[1]!=1||b[2]||b[3]||b[5]!=1||
           (((uint16_t)b[10]<<8)|b[11])!=2933)continue;
        uint32_t fields[8]={0};size_t pos=24;bool valid=true;
        while(pos<n){
            uint32_t tag=0,v=0;
            if(!reply_varint(b,n,&pos,&tag)||!tag){valid=false;break;}
            unsigned type=tag&7,field=tag>>3;
            if(type==0){
                if(!reply_varint(b,n,&pos,&v)){valid=false;break;}
                if(field<8)fields[field]=v;
            }else if(type==2){
                if(!reply_varint(b,n,&pos,&v)||v>n-pos){valid=false;break;}
                pos+=v;
            }else{valid=false;break;}
        }
        if(!valid||fields[1]!=parts)continue;
        if(b[18]!=0&&b[18]!=251){
            *error="SmartDawn rejected a native file progress window";return false;
        }
        if(fields[3]>=min_completed){
            ESP_LOGI(TAG,"Native progress confirmed received=%lu minimum=%lu total=%lu",
                (unsigned long)fields[3],(unsigned long)min_completed,(unsigned long)parts);
            *error=NULL;return true;
        }
    }
    return false;
}
bool jh2_ble_upload_reply(uint32_t *cursor,uint16_t opcode,uint8_t session,
        uint32_t parts,uint32_t timeout_ms,const char **error){
    *error="Controller native upload response timed out";
    int64_t end=esp_timer_get_time()+(int64_t)timeout_ms*1000;
    while(esp_timer_get_time()<end&&connection!=BLE_HS_CONN_HANDLE_NONE){
        gatt_notice item={0};bool found=false;
        xSemaphoreTake(notice_lock,portMAX_DELAY);
        for(size_t i=0;i<notice_count;i++){
            const gatt_notice *p=&notices[(notice_head+i)%NOTICE_RING_SIZE];
            if(p->id>*cursor){item=*p;found=true;break;}
        }
        xSemaphoreGive(notice_lock);
        if(!found){vTaskDelay(pdMS_TO_TICKS(10));continue;}
        *cursor=item.id;
        const uint8_t *b=item.b;size_t n=item.len;
        if(n<24||b[1]!=1||b[2]||b[3]||b[5]!=1||
           (((uint16_t)b[10]<<8)|b[11])!=opcode)continue;
        uint32_t values[7]={0};size_t pos=24;bool valid=true;
        while(pos<n){
            uint32_t tag=0,v=0;
            if(!reply_varint(b,n,&pos,&tag)||!tag){valid=false;break;}
            if((tag&7)==0){
                if(!reply_varint(b,n,&pos,&v)){valid=false;break;}
                if((tag>>3)<7)values[tag>>3]=v;
            }else if((tag&7)==2){
                if(!reply_varint(b,n,&pos,&v)||v>n-pos){valid=false;break;}
                pos+=v;
            }else{valid=false;break;}
        }
        if(!valid){*error="Malformed controller native upload response";return false;}
        if(opcode==2931&&values[2]!=session)continue;
        ESP_LOGI(TAG,"Native upload reply op=%u rcode=%u result=%lu count=%lu",
            opcode,b[18],(unsigned long)values[1],(unsigned long)values[2]);
        if(b[18]||values[1]||(opcode==2931&&values[5])){
            static char rejection[132];
            snprintf(rejection,sizeof(rejection),
                "SmartDawn rejected native upload: opcode=%u responseCode=%u result=%lu count=%lu",
                (unsigned)opcode,(unsigned)b[18],(unsigned long)values[1],(unsigned long)values[2]);
            *error=rejection;return false;
        }
        if(opcode==2934&&values[2]!=parts){*error="Controller final packet count differs from file";return false;}
        *error=NULL;return true;
    }
    return false;
}
void jh2_ble_status(cJSON *out){
    if(!cJSON_IsObject(out))return;
    cJSON_AddBoolToObject(out,"ok",true);
    cJSON_AddBoolToObject(out,"connected",connection!=BLE_HS_CONN_HANDLE_NONE);
    cJSON_AddBoolToObject(out,"nativeReconnectPaused",hold_disconnect);
    cJSON_AddBoolToObject(out,"nanoLocalCacheSupported",true);
    cJSON_AddNumberToObject(out,"nanoLocalCacheMaxBytes",jh2_asset_local_available_bytes());
    cJSON_AddNumberToObject(out,"nanoLocalCacheAvailableBytes",jh2_asset_local_available_bytes());
    cJSON_AddNumberToObject(out,"mtu",connection==BLE_HS_CONN_HANDLE_NONE?23:ble_att_mtu(connection));
    cJSON_AddNumberToObject(out,"nativeCatalogPackets",catalog_packets);
    cJSON_AddNumberToObject(out,"nativeCatalogUnique",catalog_unique);
    cJSON_AddNumberToObject(out,"nativeLocalCommands",local_command_seq);
    cJSON_AddNumberToObject(out,"nativeLocalCommandsSucceeded",local_command_success);
    cJSON_AddNumberToObject(out,"nativeLocalCommandsFailed",local_command_failure);
    cJSON_AddNumberToObject(out,"nativeBleScanRequests",ble_scan_requests);
    cJSON_AddNumberToObject(out,"nativeFullBleScans",ble_full_scan_requests);
    cJSON_AddBoolToObject(out,"nativeBleStackReady",ble_host_ready);
    cJSON_AddBoolToObject(out,"nativeBleFullScanActive",ble_scan_only&&ble_host_ready);
    cJSON_AddNumberToObject(out,"nativeReconnectAttempts",ble_reconnect_attempts);
    cJSON_AddNumberToObject(out,"nativeConnectionsSucceeded",ble_connection_successes);
    cJSON_AddNumberToObject(out,"nativeRecoveryScans",ble_recovery_scan_cycles);
    cJSON_AddNumberToObject(out,"nativeReconnectFailures",ble_failure_streak);
    cJSON_AddNumberToObject(out,"nativeRetryDelaySeconds",ble_retry_delay_seconds);
    const int64_t now_us=esp_timer_get_time();
    cJSON_AddNumberToObject(out,"nativeRetryInSeconds",
        ble_next_retry_us>now_us?(double)((ble_next_retry_us-now_us+999999)/1000000):0);
    cJSON_AddBoolToObject(out,"nativeConnecting",ble_connect_pending);
    cJSON_AddNumberToObject(out,"nativeLastBleDisconnectReason",ble_last_disconnect_reason);
    cJSON_AddBoolToObject(out,"nativeRememberedDevice",selected_valid);
    char chosen[18]="";
    if(selected_valid)format_mac(&selected_addr,chosen);
    cJSON_AddStringToObject(out,"nativeSelectedControllerMac",chosen);
    cJSON *visible=cJSON_AddArrayToObject(out,"nativeDiscoveredDevices");
    if(discovered_lock && xSemaphoreTake(discovered_lock,pdMS_TO_TICKS(40))==pdTRUE){
        for(size_t i=0;i<discovered_count;i++){
            cJSON *row=cJSON_CreateObject();if(!row)break;
            char mac[18];format_mac(&discovered[i].addr,mac);
            cJSON_AddStringToObject(row,"mac",mac);
            cJSON_AddStringToObject(row,"name",discovered[i].name);
            cJSON_AddNumberToObject(row,"rssi",discovered[i].rssi);
            cJSON_AddBoolToObject(row,"selected",selected_valid && ble_addr_cmp(&selected_addr,&discovered[i].addr)==0);
            cJSON_AddItemToArray(visible,row);
        }
        xSemaphoreGive(discovered_lock);
    }
    cJSON_AddBoolToObject(out,"nativeCatalogComplete88",catalog_unique==JH2_FACTORY_EFFECTS);
    // A single received final catalog reply identifies 83928 without reading
    // all 88 entries. Historical E87/E88 both referenced this CID, so expose
    // every matching (effect ID, slot, type) rather than assuming uniqueness.
    cJSON *target=cJSON_AddArrayToObject(out,"nativeTarget83928");
    unsigned target_matches=0;
    for(unsigned id=0;id<JH2_EFFECT_CAPACITY;id++){
        if(!catalog_seen[id] || catalog_cid[id]!=83928)continue;
        ++target_matches;
        cJSON *item=cJSON_CreateObject();
        if(!item)continue;
        cJSON_AddNumberToObject(item,"effectId",id);
        cJSON_AddNumberToObject(item,"slot",catalog_slot[id]);
        cJSON_AddNumberToObject(item,"type",catalog_type[id]);
        cJSON_AddNumberToObject(item,"cid",83928);
        cJSON_AddItemToArray(target,item);
    }
    unsigned section_matches=0;uint16_t section_slot=0;
    cJSON_AddBoolToObject(out,"nativeSlotTransferSupported",true);
    cJSON_AddBoolToObject(out,"nativeTargetSectionComplete",jh2_ble_target_section(&section_matches,&section_slot));
    cJSON_AddNumberToObject(out,"nativeTarget83928Count",target_matches);
    cJSON_AddBoolToObject(out,"nativeTarget83928Unique",target_matches==1);
    // Separate new empty test target from the preserved custom slot 83928.
    cJSON *next_target=cJSON_AddArrayToObject(out,"nativeTarget83929");
    unsigned fresh_matches=0;
    for(unsigned id=0;id<JH2_EFFECT_CAPACITY;id++){
        if(!catalog_seen[id] || catalog_cid[id]!=JH2_TEST_CID)continue;
        ++fresh_matches;
        cJSON *item=cJSON_CreateObject();
        if(!item)continue;
        cJSON_AddNumberToObject(item,"effectId",id);
        cJSON_AddNumberToObject(item,"slot",catalog_slot[id]);
        cJSON_AddNumberToObject(item,"type",catalog_type[id]);
        cJSON_AddNumberToObject(item,"cid",JH2_TEST_CID);
        cJSON_AddItemToArray(next_target,item);
    }
    cJSON_AddNumberToObject(out,"nativeTarget83929Count",fresh_matches);
    cJSON_AddBoolToObject(out,"nativeTarget83929Empty",fresh_matches==0);

    cJSON_AddNumberToObject(out,"nativeNotificationsSeen",notification_count);
    cJSON_AddNumberToObject(out,"nativeRawPower2103Seen",raw_rx_2103);
    cJSON_AddNumberToObject(out,"nativeRawPower2105Seen",raw_rx_2105);
    cJSON_AddNumberToObject(out,"nativeRawPlayback2630Seen",raw_rx_2630);
    cJSON_AddNumberToObject(out,"nativeNoticeDrops",notice_drops);
    cJSON_AddNumberToObject(out,"nativeCatalogEnqueued",catalog_enqueued);
    cJSON_AddNumberToObject(out,"nativeCatalogParsed",catalog_parsed);
    cJSON_AddNumberToObject(out,"nativeCatalogParseErrors",catalog_parse_errors);
    cJSON_AddNumberToObject(out,"nativeCatalogQueueDrops",catalog_queue_drops);
    cJSON_AddNumberToObject(out,"nativeCatalogFragments",catalog_fragments);
    cJSON_AddNumberToObject(out,"nativeCatalogQueueDepth",catalog_queue?uxQueueMessagesWaiting(catalog_queue):0);
    cJSON_AddNumberToObject(out,"nativeCatalogQueueCapacity",CATALOG_RX_QUEUE_DEPTH);
    cJSON_AddNumberToObject(out,"nativeBLEConnInterval1250us",conn_interval_units);
    cJSON_AddNumberToObject(out,"nativeBLEConnLatency",conn_latency);
    cJSON_AddNumberToObject(out,"nativeBLEConnUpdateRequestRc",conn_update_request_rc);
    cJSON_AddNumberToObject(out,"nativeBLEConnUpdateStatus",conn_update_status);
    cJSON_AddNumberToObject(out,"nativeBLEConnUpdateEvents",conn_updates);
    cJSON_AddNumberToObject(out,"nativeUnexpectedNotifyCount",unexpected_notify_count);
    cJSON_AddNumberToObject(out,"nativeLastUnexpectedNotifyHandle",last_unexpected_notify_handle);
    cJSON_AddNumberToObject(out,"nativeHostMsys2Bytes",CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE);
    cJSON_AddNumberToObject(out,"nativeHostMsys2Count",CONFIG_BT_NIMBLE_MSYS_2_BLOCK_COUNT);
    cJSON_AddNumberToObject(out,"nativeHostAclBytes",CONFIG_BT_NIMBLE_TRANSPORT_ACL_SIZE);
    cJSON_AddNumberToObject(out,"nativeHostAclCount",CONFIG_BT_NIMBLE_TRANSPORT_ACL_FROM_LL_COUNT);
    uint8_t phy_tx=0,phy_rx=0;
    int phy_rc=connection==BLE_HS_CONN_HANDLE_NONE?-1:ble_gap_read_le_phy(connection,&phy_tx,&phy_rx);
    ++phy_status_queries;
    cJSON_AddNumberToObject(out,"nativeBLEPhyRequestRc",phy_2m_request_rc);
    cJSON_AddNumberToObject(out,"nativeBLEPhyQueryRc",phy_rc);
    cJSON_AddNumberToObject(out,"nativeBLEPhyTX",phy_tx);
    cJSON_AddNumberToObject(out,"nativeBLEPhyRX",phy_rx);
    jh2_hci_acl_diag(out);
    cJSON_AddStringToObject(out,"nativeRxExperiment","rx16-targeted-cid83928-feature-restoration");
}
bool jh2_ble_asset_packet(uint8_t channel,const uint8_t *bytes,size_t len){
    if(!bytes||!len||len>508||connection==BLE_HS_CONN_HANDLE_NONE)return false;
    if(len>(size_t)(ble_att_mtu(connection)-3))return false;
    if(channel==0)return jh2_ble_raw_write(WRITE_UUID_TEXT,bytes,len,12000);
    if(channel!=1 || !heart)return false;
    // Native SmartDawn doodle/image characteristic supports no-response
    // writes; periodically yield so the BLE controller can drain its HCI TX.
    int rc=ble_gattc_write_no_rsp_flat(connection,heart,bytes,(uint16_t)len);
    static unsigned since_yield=0;
    if(rc==0 && (++since_yield%6)==0)vTaskDelay(pdMS_TO_TICKS(3));
    return rc==0;
}
static int raw_write_done(uint16_t conn,const struct ble_gatt_error *err,
                          struct ble_gatt_attr *attr,void *arg){
    (void)conn;(void)attr;(void)arg;
    if(raw_write_pending){
        last_write_status=err->status;
        raw_write_pending=false;
        xSemaphoreGive(raw_write_event);
    }
    return 0;
}
bool jh2_ble_raw_write(const char *uuid,const uint8_t *bytes,size_t len,uint32_t timeout_ms){
    if(!uuid||!bytes||!len||len>508||!raw_write_lock || raw_write_fault)return false;
    if(connection==BLE_HS_CONN_HANDLE_NONE)return false;
    uint16_t attr=0;
    if(strcmp(uuid,WRITE_UUID_TEXT)==0)attr=writer;
    else if(strcmp(uuid,HEART_UUID_TEXT)==0)attr=heart;
    else if(strcmp(uuid,UPLOAD_UUID_TEXT)==0)attr=upload;
    if(!attr||len>(size_t)(ble_att_mtu(connection)-3))return false;
    if(xSemaphoreTake(raw_write_lock,pdMS_TO_TICKS(timeout_ms))!=pdTRUE)return false;
    if(attr==upload){
        // The original Android SmartDawn native file characteristic uses
        // Write Without Response for its upload frames, unlike DDP commands.
        // A controller 2931/2934 notification, NOT this transport result,
        // is the authoritative acceptance of the file and packet count.
        bool queued=false;
        for(unsigned attempt=0;attempt<20;attempt++){
            if(connection==BLE_HS_CONN_HANDLE_NONE)break;
            int rc=ble_gattc_write_no_rsp_flat(connection,attr,bytes,(uint16_t)len);
            if(rc==0){queued=true;break;}
            vTaskDelay(pdMS_TO_TICKS(10));
        }
        xSemaphoreGive(raw_write_lock);
        return queued;
    }
    while(xSemaphoreTake(raw_write_event,0)==pdTRUE){}
    raw_write_pending=true;last_write_status=-1;
    int rc=ble_gattc_write_flat(connection,attr,bytes,(uint16_t)len,raw_write_done,NULL);
    bool ok=false;
    if(rc==0){
        if(xSemaphoreTake(raw_write_event,pdMS_TO_TICKS(timeout_ms))==pdTRUE)
            ok=last_write_status==0;
        else raw_write_fault=true; // late ACK cannot be misapplied to next write
    }else raw_write_pending=false;
    xSemaphoreGive(raw_write_lock);
    return ok;
}
static uint8_t own_addr=0,request_index=0,sequence=0;
static bool requested=false,finished=false;

static int64_t started_at=0;
static const uint16_t READ_OPS[]={205,167,2904};

static int gap_event(struct ble_gap_event *event,void *arg);
static void begin_scan(void);
static void fail(const char *stage,int rc){
    ESP_LOGE(TAG,"DIAGNOSTIC_FAILURE stage=%s rc=%d no_controller_mutation",stage,rc);
}

static void begin_scan(void){
    if(!ble_host_ready||hold_disconnect||ble_connect_pending||
       connection!=BLE_HS_CONN_HANDLE_NONE||ble_gap_disc_active())return;
    if(ble_hs_id_infer_auto(0,&own_addr)!=0){
        if(!ble_scan_only)schedule_ble_retry("address");return;
    }
    struct ble_gap_disc_params params={0};
    params.passive=0;params.filter_duplicates=0;
    const int32_t duration=ble_scan_only?15000:12000;
    int rc=ble_gap_disc(own_addr,duration,&params,gap_event,NULL);
    if(rc!=0){
        fail("scan",rc);
        if(!ble_scan_only)schedule_ble_retry("scan_start");
        else{ble_scan_only=false;hold_disconnect=true;}
    }else if(!ble_scan_only)++ble_recovery_scan_cycles;
}
// Called periodically by the normal main loop, never reentered from GAP.
static void ble_service_tick(void){
    if(!ble_host_ready||hold_disconnect||ble_scan_only||
       ble_connect_pending||connection!=BLE_HS_CONN_HANDLE_NONE||
       ble_gap_disc_active())return;
    if(ble_next_retry_us==0)
        ble_next_retry_us=esp_timer_get_time()+5000000LL;
    if(esp_timer_get_time()>=ble_next_retry_us){
        ble_next_retry_us=0;
        begin_scan();
    }
}

static int write_done(uint16_t conn,const struct ble_gatt_error *error,
                      struct ble_gatt_attr *attr,void *arg);
static void send_next(void){
    if(connection==BLE_HS_CONN_HANDLE_NONE||!writer||request_index>=3)return;
    uint16_t opcode=READ_OPS[request_index];
    uint8_t frame[24]={0};
    uint8_t id=sequence++;
    frame[0]=id;frame[1]=1;frame[2]=0;frame[3]=0;
    frame[4]=0xf0;frame[5]=4;
    frame[6]=0;frame[7]=id;
    frame[10]=(uint8_t)(opcode>>8);
    frame[11]=(uint8_t)opcode;
    ESP_LOGI(TAG,"CATALOG_READ_TX stage=%d opcode=%u payload_bytes=24",request_index+1,opcode);
    int rc=ble_gattc_write_flat(connection,writer,frame,sizeof(frame),write_done,NULL);
    if(rc)fail("catalog_read_write",rc);
}
static int write_done(uint16_t conn,const struct ble_gatt_error *error,
                      struct ble_gatt_attr *attr,void *arg){
    (void)conn;(void)attr;(void)arg;
    if(error->status){fail("write_ack",error->status);return 0;}
    ++request_index;
    if(request_index<3)send_next();
    else{
        requested=true;started_at=esp_timer_get_time();
        ESP_LOGI(TAG,"CATALOG_READ_ARMED no_upload_no_delete waiting_for_five_groups");
    }
    return 0;
}
static int subscribe_done(uint16_t conn,const struct ble_gatt_error *error,
                          struct ble_gatt_attr *attr,void *arg){
    (void)conn;(void)attr;(void)arg;
    if(error->status)fail("subscribe_ack",error->status);
    else{
        ESP_LOGI(TAG,"NOTIFY_SUBSCRIBED cccd=%u; sending manufacturer read only",cccd);
        request_index=0;sequence=0;
        send_next();
    }
    return 0;
}
static int descriptor_found(uint16_t conn,const struct ble_gatt_error *error,
                            uint16_t chr_handle,const struct ble_gatt_dsc *dsc,void *arg){
    (void)conn;(void)chr_handle;(void)arg;
    if(error->status==0){
        if(ble_uuid_u16(&dsc->uuid.u)==BLE_GATT_DSC_CLT_CFG_UUID16)cccd=dsc->handle;
        return 0;
    }
    if(error->status!=BLE_HS_EDONE){fail("descriptor_discovery",error->status);return 0;}
    if(!cccd){fail("missing_notification_cccd",-1);return 0;}
    const uint8_t enabled[]={1,0};
    int rc=ble_gattc_write_flat(connection,cccd,enabled,2,subscribe_done,NULL);
    if(rc)fail("enable_notifications",rc);
    return 0;
}
static int characteristic_found(uint16_t conn,const struct ble_gatt_error *error,
                                const struct ble_gatt_chr *chr,void *arg){
    (void)conn;(void)arg;
    if(error->status==0){
        if(ble_uuid_cmp(&chr->uuid.u,&WRITE_UUID.u)==0)writer=chr->val_handle;
        if(ble_uuid_cmp(&chr->uuid.u,&HEART_UUID.u)==0)heart=chr->val_handle;
        if(ble_uuid_cmp(&chr->uuid.u,&UPLOAD_UUID.u)==0)upload=chr->val_handle;
        if(ble_uuid_cmp(&chr->uuid.u,&NOTIFY_UUID.u)==0)notifier=chr->val_handle;
        if(chr->def_handle>notifier && notifier && chr->def_handle<next_def_after_notify)
            next_def_after_notify=chr->def_handle;
        return 0;
    }
    if(error->status!=BLE_HS_EDONE){fail("characteristic_discovery",error->status);return 0;}
    if(!writer||!notifier){fail("missing_write_or_notify",-1);return 0;}
    uint16_t limit=service_end;
    if(next_def_after_notify!=UINT16_MAX&&next_def_after_notify>notifier+1)
        limit=next_def_after_notify-1;
    ESP_LOGI(TAG,"CHARACTERISTICS write=%u notify=%u descriptor_limit=%u",writer,notifier,limit);
    int rc=ble_gattc_disc_all_dscs(connection,notifier,limit,descriptor_found,NULL);
    if(rc)fail("descriptor_start",rc);
    return 0;
}
static int service_found(uint16_t conn,const struct ble_gatt_error *error,
                         const struct ble_gatt_svc *svc,void *arg){
    (void)conn;(void)arg;
    if(error->status==0){
        if(ble_uuid_cmp(&svc->uuid.u,&SVC_UUID.u)==0){
            service_start=svc->start_handle;service_end=svc->end_handle;
        }
        return 0;
    }
    if(error->status!=BLE_HS_EDONE){fail("service_discovery",error->status);return 0;}
    if(!service_start){fail("missing_smartdawn_service",-1);return 0;}
    ESP_LOGI(TAG,"SMARTDAWN_SERVICE handles=%u-%u",service_start,service_end);
    int rc=ble_gattc_disc_all_chrs(connection,service_start,service_end,characteristic_found,NULL);
    if(rc)fail("characteristic_start",rc);
    return 0;
}
static int mtu_done(uint16_t conn,const struct ble_gatt_error *error,uint16_t mtu,void *arg){
    (void)arg;
    if(error->status)ESP_LOGW(TAG,"MTU negotiation returned error %d",error->status);
    ESP_LOGI(TAG,"ATT_MTU=%u",mtu);
    int rc=ble_gattc_disc_all_svcs(conn,service_found,NULL);
    if(rc)fail("service_start",rc);
    return 0;
}
static void catalog_worker(void *unused){
    (void)unused;
    gatt_notice item;
    while(true){
        if(xQueueReceive(catalog_queue,&item,portMAX_DELAY)!=pdTRUE)continue;
        if(connection==BLE_HS_CONN_HANDLE_NONE)continue;
        const uint8_t *ddp=item.b+4;
        ++catalog_packets;
        jh2_catalog_batch batch;
        const int rc=jh2_effectlist_parse(ddp,item.len-4,&batch);
        if(rc){
            ++catalog_parse_errors;
            ESP_LOGW(TAG,"CATALOG_PARSE_FAIL message_id=%u gatt_size=%u rc=%d",
                     item.b[0],item.len,rc);
            continue;
        }
        ++catalog_parsed;
        // Captured controller pages contain 20 entries. A short final page
        // beginning at ID 80 covers every custom record (IDs 87 and later).
        if(batch.first==80&&batch.count>=7&&batch.count<20&&
           batch.last>=86&&batch.last<100&&batch.count==(size_t)(batch.last-79)){
            bool contiguous=true;unsigned matches=0;uint16_t slot=0;
            for(unsigned id=80;id<=batch.last;id++){
                if(!batch.found[id])contiguous=false;
                if(batch.cid[id]==JH2_TEST_CID){++matches;slot=batch.slot[id];}
            }
            if(contiguous){target_section_matches=matches;target_section_slot=slot;
                target_section_at=esp_timer_get_time();}
        }

        for(size_t i=0;i<JH2_EFFECT_CAPACITY;i++){
            if(!batch.found[i])continue;
            catalog_slot[i]=batch.slot[i];
            catalog_type[i]=batch.type[i];
            catalog_cid[i]=batch.cid[i];
            if(!catalog_seen[i]){catalog_seen[i]=1;++catalog_unique;}
        }
        ESP_LOGI(TAG,"CATALOG_REPLY id=%u gatt_bytes=%u effects=%u first=%u last=%u unique=%u",
                 item.b[0],item.len,(unsigned)batch.count,batch.first,batch.last,
                 (unsigned)catalog_unique);
        if(!finished && catalog_unique==JH2_FACTORY_EFFECTS){
            finished=true;
            ESP_LOGI(TAG,"SUCCESS_NATIVE_CATALOG_88_OF_88 reply_packets=%u notifications=%u",
                     (unsigned)catalog_packets,(unsigned)notification_count);
        }
    }
}
// NimBLE host GAP callback: no protocol parsing, allocation, or logging.
// A complete 396-byte phone inventory notification needs only a bounded
// OS mbuf -> RAM copy before returning to the BLE host.
static void on_notification(struct os_mbuf *om){
    ++notification_count;
    uint16_t len=OS_MBUF_PKTLEN(om);
    if(len<4 || len>520){++notice_drops;return;}
    uint8_t raw[520];
    if(os_mbuf_copydata(om,0,len,raw)!=0){++notice_drops;return;}
    record_notice(raw,len);
    if(len>=24&&raw[1]==1&&raw[2]==0&&raw[3]==0&&raw[4]==0xf1&&raw[5]==1){
        const uint16_t op=((uint16_t)raw[10]<<8)|raw[11];
        if(op==2103)++raw_rx_2103;
        else if(op==2105)++raw_rx_2105;
        else if(op==2630)++raw_rx_2630;
    }
    if(len<24)return;
    if(raw[1]!=1 || raw[2]!=0 || raw[3]!=0){
        ++catalog_fragments;
        return;
    }
    const uint8_t *ddp=raw+4;
    if(ddp[0]!=0xf0 && ddp[0]!=0xf1)return;
    const uint16_t opcode=((uint16_t)ddp[6]<<8)|ddp[7];
    if(opcode!=2904)return;
    if(!catalog_queue){++catalog_queue_drops;return;}
    gatt_notice packet={.len=len};
    memcpy(packet.b,raw,len);
    if(xQueueSend(catalog_queue,&packet,0)==pdTRUE)++catalog_enqueued;
    else ++catalog_queue_drops;
}
static int gap_event(struct ble_gap_event *event,void *arg){
    (void)arg;
    switch(event->type){
    case BLE_GAP_EVENT_DISC:{
        struct ble_hs_adv_fields f;
        if(ble_hs_adv_parse_fields(&f,event->disc.data,event->disc.length_data)!=0)return 0;
        cache_discovery(&event->disc,&f);
        if(ble_scan_only||ble_connect_pending)return 0;
        bool selected=selected_valid && ble_addr_cmp(&event->disc.addr,&selected_addr)==0;
        bool named=(f.name && f.name_len==strlen(TARGET)&&
                    memcmp(f.name,TARGET,f.name_len)==0);
        if(!selected && (selected_valid || !named))return 0;
        ble_connect_addr=event->disc.addr;
        ble_connect_pending=true;
        // Do not begin connecting inside the discovery callback before
        // NimBLE has completed the scan cancellation.
        const int cancel_rc=ble_gap_disc_cancel();
        if(cancel_rc!=0){
            ble_connect_pending=false;
            fail("scan_cancel",cancel_rc);
            schedule_ble_retry("scan_cancel");
        }
        return 0;
    }
    case BLE_GAP_EVENT_CONNECT:
        if(event->connect.status){
            fail("connect",event->connect.status);
            ++ble_reconnect_attempts;
            ble_connect_pending=false;
            schedule_ble_retry("connect_failed");
            return 0;
        }
        connection=event->connect.conn_handle;
        ble_connect_pending=false;
        ble_failure_streak=0;ble_retry_delay_seconds=0;ble_next_retry_us=0;
        ble_connected_since_us=esp_timer_get_time();
        ++ble_connection_successes;
        ESP_LOGI(TAG,"SMARTDAWN_CONNECTED conn=%u",connection);
        {
            struct ble_gap_conn_desc desc={0};
            if(ble_gap_conn_find(connection,&desc)==0){
                conn_interval_units=desc.conn_itvl;
                conn_latency=desc.conn_latency;
            }
            // Stability first: keep negotiated connection interval and 1M PHY.
            // 2.0.6 forced 10-15ms + 2M PHY on every reconnection, which
            // can produce RF contention with ESP32-C6 simultaneous Wi-Fi.
            conn_update_request_rc=-2;
            phy_2m_request_rc=-2;
            ESP_LOGW(TAG,"BLE_STABILITY_MODE retaining controller default PHY/interval=%u",
                     conn_interval_units);
            int rc=ble_gattc_exchange_mtu(connection,mtu_done,NULL);
            if(rc)fail("exchange_mtu",rc);
        }
        return 0;
    case BLE_GAP_EVENT_NOTIFY_RX:
        if(event->notify_rx.attr_handle==notifier)on_notification(event->notify_rx.om);
        else{
            ++unexpected_notify_count;
            last_unexpected_notify_handle=event->notify_rx.attr_handle;
        }
        return 0;
    case BLE_GAP_EVENT_CONN_UPDATE:{
        conn_update_status=event->conn_update.status;
        ++conn_updates;
        struct ble_gap_conn_desc desc={0};
        if(ble_gap_conn_find(event->conn_update.conn_handle,&desc)==0){
            conn_interval_units=desc.conn_itvl;
            conn_latency=desc.conn_latency;
        }
        ESP_LOGI(TAG,"BLE_CONN_PACING_ACTUAL rc=%d interval_units=%u latency=%u",
                 conn_update_status,conn_interval_units,conn_latency);
        return 0;
    }
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGW(TAG,"BLE_DISCONNECTED reason=%u",event->disconnect.reason);
        ble_last_disconnect_reason=event->disconnect.reason;
        connection=BLE_HS_CONN_HANDLE_NONE;
        ble_connect_pending=false;
        if(ble_connected_since_us &&
           esp_timer_get_time()-ble_connected_since_us>60000000LL)
            ble_failure_streak=0;
        ble_connected_since_us=0;
        service_start=service_end=writer=notifier=cccd=heart=upload=0;
        raw_write_fault=false;raw_write_pending=false;
        next_def_after_notify=UINT16_MAX;
        requested=finished=false;
        request_index=0;
        memset(catalog_seen,0,sizeof(catalog_seen));
        memset(catalog_slot,0,sizeof(catalog_slot));
        memset(catalog_type,0,sizeof(catalog_type));
        memset(catalog_cid,0,sizeof(catalog_cid));
        target_section_at=0;
        catalog_packets=catalog_unique=notification_count=0;
        raw_rx_2103=raw_rx_2105=raw_rx_2630=0;
        conn_interval_units=conn_latency=0;
        conn_update_request_rc=conn_update_status=phy_2m_request_rc=-1;
        conn_updates=0;
        if(!hold_disconnect)schedule_ble_retry("disconnected");
        return 0;
    case BLE_GAP_EVENT_DISC_COMPLETE:
        if(ble_scan_only){
            ble_scan_only=false;
            hold_disconnect=true; // Wait for explicit Select or Reconnect Last.
            ESP_LOGI(TAG,"BLE_FULL_SCAN_COMPLETE found=%u",(unsigned)discovered_count);
            return 0;
        }
        if(ble_connect_pending){
            ble_connect_pending=false;
            if(!hold_disconnect && connection==BLE_HS_CONN_HANDLE_NONE){
                int rc=ble_gap_connect(own_addr,&ble_connect_addr,20000,NULL,gap_event,NULL);
                if(rc!=0){
                    fail("gap_connect",rc);
                    schedule_ble_retry("gap_connect");
                }
            }
            return 0;
        }
        if(connection==BLE_HS_CONN_HANDLE_NONE&&!hold_disconnect)
            schedule_ble_retry("discovery_complete");
        return 0;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG,"NEGOTIATED_MTU %u",event->mtu.value);
        return 0;
    default:return 0;
    }
}
static void on_sync(void){
    int rc=ble_hs_util_ensure_addr(0);
    if(rc){fail("ensure_address",rc);return;}
    ble_host_ready=true;
    ble_next_retry_us=esp_timer_get_time()+5000000LL;
    ESP_LOGI(TAG,"NIMBLE_NATIVE_READY msys2=%d no_wifi diagnostics_only",
             CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE);
    ESP_LOGW(TAG,"BLE_STABILITY_READY discovery deferred to bounded main-loop retry");
}
static void on_reset(int reason){
    ble_host_ready=false;
    ble_scan_only=false;
    ble_connect_pending=false;
    fail("nimble_reset",reason);
}
static void host_task(void *parameter){
    (void)parameter;
    nimble_port_run();
    nimble_port_freertos_deinit();
}
static volatile bool ble_start_attempted=false;
static volatile bool oracle_autolink_boot_attempted=false;
static void start_oracle_after_home_wifi(void){
#if CONFIG_JH2_NATIVE_ENABLE_ORACLE
    if(oracle_autolink_boot_attempted)return;
    EventGroupHandle_t g=jh2_web_wifi_group();
    if(!g || !(xEventGroupGetBits(g)&BIT0) ||
       !jh2_web_has_oracle_credentials())return;
    oracle_autolink_boot_attempted=true;
    if(!jh2_bridge_autolink_request())
        ESP_LOGW(TAG,"Automatic Oracle verification request unavailable; manual Settings > Oracle remains active");
    else
        ESP_LOGW(TAG,"Oracle auto-link verification started after local Wi-Fi; no boot dependency");
#endif
}
// The ESP32-C6 shares one radio between BLE and Wi-Fi. Do not initialize
// NimBLE until home Wi-Fi has an IP address. Until then the setup AP must
// remain a simple, open and responsive recovery interface.
static void start_ble_after_home_wifi(void){
    if(ble_start_attempted)return;
    EventGroupHandle_t group=jh2_web_wifi_group();
    if(!group || !(xEventGroupGetBits(group)&BIT0))return;
    ble_start_attempted=true;
    ESP_LOGW(TAG,"2.0.6 home Wi-Fi online; BLE startup permitted");
    esp_err_t rc=ESP_OK;
    // Wi-Fi and web recovery are mission critical; BLE is independent.
    // Bluetooth initialization failure must NOT discard a fully provisioned
    // Nano into the isolated factory uploader.
    discovered_lock=xSemaphoreCreateMutex();
    load_target();
    notice_lock=xSemaphoreCreateMutex();
    raw_write_lock=xSemaphoreCreateMutex();
    raw_write_event=xSemaphoreCreateBinary();
    bool ble_available=discovered_lock&&notice_lock&&raw_write_lock&&raw_write_event;
    if(ble_available){
        catalog_queue=xQueueCreate(CATALOG_RX_QUEUE_DEPTH,sizeof(gatt_notice));
        if(!catalog_queue || xTaskCreate(catalog_worker,"jh2-catalog-rx",8192,NULL,3,NULL)!=pdPASS){
            ble_available=false;
            ESP_LOGE(TAG,"BLE catalog worker unavailable; retaining configured Wi-Fi and Oracle");
        }
    }
    if(ble_available){
        rc=nimble_port_init();
        if(rc!=ESP_OK){
            fail("nimble_port_init",rc);
            ble_available=false;
            ESP_LOGE(TAG,"BLE stack unavailable; retaining configured Wi-Fi and Oracle");
        }
    }
    if(ble_available){
        ble_hs_cfg.reset_cb=on_reset;
        ble_hs_cfg.sync_cb=on_sync;
        ble_att_set_preferred_mtu(517);
        nimble_port_freertos_init(host_task);
    }
    ESP_LOGW(TAG,"2.0.6 BLE startup attempt finished; setup AP retained");
}

void app_main(void){
    // Deliberately NEVER erase NVS; production Wi-Fi and pairing data survive.
    esp_err_t rc=nvs_flash_init();
    if(rc!=ESP_OK){
        ESP_LOGE(TAG,"NVS_INIT_FAILED rc=%d; refusing destructive recovery",rc);
        return;
    }
    failsafe_boot_begin();
    // Start web recovery immediately after NVS. Even a failed BLE mutex,
    // catalog parser task, or Oracle transport must NEVER strand OTA again.
    if(!jh2_web_start()){
        ESP_LOGE(TAG,"WEB_RECOVERY_START_FAILED");
        failsafe_boot_failed();
        return;
    }
    // 2.0.6: open setup Wi-Fi and HTTP are now up. Neither home Wi-Fi,
    // BLE, filesystem nor Oracle is allowed to gate the setup AP.
    // Configure Oracle later with Settings > Oracle > Connect Automatically.
    ESP_LOGW(TAG,"2.0.6 setup AP ready; proceeding with independent BLE startup");
    // Initial provisioning: BLE stays OFF to avoid simultaneous 2.4 GHz
    // radio arbitration while the phone associates with JH2-Nano-Fresh.
    ESP_LOGW(TAG,"2.0.6 Bluetooth deferred until home Wi-Fi connects");
#if CONFIG_JH2_NATIVE_BROWSER_OTA_COMPAT
    // Retain the product marker in the signed application image. The
    // original factory browser updater validates it and the final size;
    // the separate build gate enforces its >0x120000-byte requirement.
    ESP_LOGW(TAG,"NATIVE_BROWSER_OTA_COMPAT_MARKER %s",
             jh2_native_runtime_marker);
#endif
#if CONFIG_JH2_NATIVE_ENABLE_ORACLE
    // Oracle startup never blocks the setup AP. Existing credentials can be
    // verified automatically after DHCP; manual controls remain available.
    ESP_LOGW(TAG,"Oracle standby until home Wi-Fi ready; secure auto-link enabled");
#else
    ESP_LOGW(TAG,"Oracle disabled at build-time; local Wi-Fi + BLE still run");
#endif
    while(true){
        vTaskDelay(pdMS_TO_TICKS(10000));
        failsafe_confirm_after_60s();
        start_ble_after_home_wifi();
        ble_service_tick();
        start_oracle_after_home_wifi();
        if(requested && !finished && started_at &&
           esp_timer_get_time()-started_at>20000000LL){
            ESP_LOGW(TAG,"PARTIAL_CATALOG received=%u of 88 reply_packets=%u notifications=%u",
                     (unsigned)catalog_unique,(unsigned)catalog_packets,(unsigned)notification_count);
            started_at=esp_timer_get_time();
        }
    }
}
