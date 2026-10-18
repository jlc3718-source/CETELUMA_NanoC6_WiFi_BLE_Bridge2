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
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_err.h"
#include "nvs_flash.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "os/os_mbuf.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "effectlist.h"
#include "native_ble.h"
#include "bridge.h"
#include "web_recovery.h"
#if CONFIG_JH2_NATIVE_BROWSER_OTA_COMPAT
extern const char jh2_native_runtime_marker[];
extern const unsigned char jh2_native_compat_padding[];
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
static SemaphoreHandle_t notice_lock=NULL,raw_write_lock=NULL,raw_write_event=NULL;
static volatile int last_write_status=-1;
static volatile bool raw_write_pending=false,raw_write_fault=false;
static uint32_t notice_number=0,notice_drops=0;
static const ble_uuid128_t HEART_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x19,0x74,0x00,0x02,0x02);
static const ble_uuid128_t UPLOAD_UUID=BLE_UUID128_INIT(
  0x44,0x4e,0x51,0x19,0x71,0x07,0x22,0x30,0x25,0x19,0x72,0x20,0x01,0x30,0x92,0x27);
static const char *WRITE_UUID_TEXT="01020074-1972-1925-3022-077119514e44";
static const char *HEART_UUID_TEXT="02020074-1972-1925-3022-077119514e44";
static const char *UPLOAD_UUID_TEXT="27923001-2072-1925-3022-077119514e44";
#define NOTICE_RING_SIZE 48
#define CATALOG_RX_QUEUE_DEPTH 24
typedef struct{uint32_t id;uint16_t len;uint8_t b[520];} gatt_notice;
static gatt_notice notices[NOTICE_RING_SIZE];
// The NimBLE GAP callback must never parse protobuf or log a 400-byte
// catalog frame. The phone sends five responses in ~14 ms, often before
// the previous callback can finish. Copy into a bounded queue and return.
static QueueHandle_t catalog_queue=NULL;
static volatile uint32_t catalog_enqueued=0,catalog_queue_drops=0;
static volatile uint32_t catalog_parsed=0,catalog_parse_errors=0,catalog_fragments=0;
static gatt_notice notices[NOTICE_RING_SIZE];
static size_t notice_head=0,notice_count=0;
static void record_notice(const uint8_t *raw,size_t len){
    if(!raw||len==0||len>sizeof(notices[0].b)){++notice_drops;return;}
    if(len>=24 && raw[1]==1 && raw[2]==0 && raw[3]==0
       && (((uint16_t)raw[10]<<8)|raw[11])==2630)return;
    if(!notice_lock || xSemaphoreTake(notice_lock,0)!=pdTRUE){++notice_drops;return;}
    size_t idx=(notice_head+notice_count)%NOTICE_RING_SIZE;
    if(notice_count==NOTICE_RING_SIZE){notice_head=(notice_head+1)%NOTICE_RING_SIZE;++notice_drops;}
    else ++notice_count;
    notices[idx].id=++notice_number;
    notices[idx].len=(uint16_t)len;
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
void jh2_ble_status(cJSON *out){
    if(!cJSON_IsObject(out))return;
    cJSON_AddBoolToObject(out,"ok",true);
    cJSON_AddBoolToObject(out,"connected",connection!=BLE_HS_CONN_HANDLE_NONE);
    cJSON_AddNumberToObject(out,"mtu",connection==BLE_HS_CONN_HANDLE_NONE?23:ble_att_mtu(connection));
    cJSON_AddNumberToObject(out,"nativeCatalogPackets",catalog_packets);
    cJSON_AddNumberToObject(out,"nativeCatalogUnique",catalog_unique);
    cJSON_AddBoolToObject(out,"nativeCatalogComplete88",catalog_unique==JH2_FACTORY_EFFECTS);
    cJSON_AddNumberToObject(out,"nativeNotificationsSeen",notification_count);
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
    cJSON_AddStringToObject(out,"nativeRxExperiment","rx11-mtu247-small-catalog-groups");
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

static uint8_t catalog_seen[JH2_FACTORY_EFFECTS]={0};
static int64_t started_at=0;
static const uint16_t READ_OPS[]={205,167,2904};

static int gap_event(struct ble_gap_event *event,void *arg);
static void begin_scan(void);
static void fail(const char *stage,int rc){
    ESP_LOGE(TAG,"DIAGNOSTIC_FAILURE stage=%s rc=%d no_controller_mutation",stage,rc);
}

static void begin_scan(void){
    if(connection!=BLE_HS_CONN_HANDLE_NONE)return;
    if(ble_hs_id_infer_auto(0,&own_addr)!=0)return;
    struct ble_gap_disc_params params={0};
    params.passive=0; // active scan obtains DN5E58 name when in scan response
    params.filter_duplicates=0;
    int rc=ble_gap_disc(own_addr,BLE_HS_FOREVER,&params,gap_event,NULL);
    if(rc)fail("scan",rc);
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
        for(size_t i=0;i<JH2_FACTORY_EFFECTS;i++)
            if(batch.found[i]&&!catalog_seen[i]){catalog_seen[i]=1;++catalog_unique;}
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
        if(f.name_len!=strlen(TARGET)||memcmp(f.name,TARGET,f.name_len)!=0)return 0;
        ESP_LOGI(TAG,"FOUND_TARGET %s",TARGET);
        if(ble_gap_disc_cancel()!=0)return 0;
        int rc=ble_gap_connect(own_addr,&event->disc.addr,30000,NULL,gap_event,NULL);
        if(rc){fail("gap_connect",rc);begin_scan();}
        return 0;
    }
    case BLE_GAP_EVENT_CONNECT:
        if(event->connect.status){
            fail("connect",event->connect.status);begin_scan();return 0;
        }
        connection=event->connect.conn_handle;
        ESP_LOGI(TAG,"SMARTDAWN_CONNECTED conn=%u",connection);
        {
            struct ble_gap_conn_desc desc={0};
            if(ble_gap_conn_find(connection,&desc)==0){
                conn_interval_units=desc.conn_itvl;
                conn_latency=desc.conn_latency;
            }
            // ESP32-C6 receives only 3 of the 5 rapid catalog notifications.
            // Request a short 10-15ms connection interval, latency 0,
            // allowing multi-PDU bursts to drain between events. This
            // request is advisory: GATT operates normally if refused.
            struct ble_gap_upd_params pacing={0};
            pacing.itvl_min=8;
            pacing.itvl_max=12;
            pacing.latency=0;
            pacing.supervision_timeout=400;
            conn_update_request_rc=ble_gap_update_params(connection,&pacing);
            // Prefer 2M PHY for the controller's five 2904 inventory notifications
            // sent in a ~14ms burst. Controller may decline; 1M is still valid.
            phy_2m_request_rc=ble_gap_set_prefered_le_phy(
                connection,BLE_GAP_LE_PHY_2M_MASK,BLE_GAP_LE_PHY_2M_MASK,0);
            ESP_LOGI(TAG,"BLE_RX5_PHY_2M_REQUEST rc=%d",phy_2m_request_rc);
            ESP_LOGI(TAG,"BLE_RX6_SHORT_INTERVAL_REQUEST rc=%d before_interval=%u",
                     conn_update_request_rc,conn_interval_units);
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
        connection=BLE_HS_CONN_HANDLE_NONE;
        service_start=service_end=writer=notifier=cccd=heart=upload=0;
        raw_write_fault=false;raw_write_pending=false;
        next_def_after_notify=UINT16_MAX;
        requested=finished=false;
        request_index=0;
        memset(catalog_seen,0,sizeof(catalog_seen));
        catalog_packets=catalog_unique=notification_count=0;
        conn_interval_units=conn_latency=0;
        conn_update_request_rc=conn_update_status=phy_2m_request_rc=-1;
        conn_updates=0;
        begin_scan();
        return 0;
    case BLE_GAP_EVENT_DISC_COMPLETE:
        if(connection==BLE_HS_CONN_HANDLE_NONE)begin_scan();
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
    ESP_LOGI(TAG,"NIMBLE_NATIVE_READY msys2=%d no_wifi diagnostics_only",
             CONFIG_BT_NIMBLE_MSYS_2_BLOCK_SIZE);
    begin_scan();
}
static void on_reset(int reason){fail("nimble_reset",reason);}
static void host_task(void *parameter){
    (void)parameter;
    nimble_port_run();
    nimble_port_freertos_deinit();
}
void app_main(void){
    // Deliberately NEVER erase NVS; production Wi-Fi and pairing data survive.
    esp_err_t rc=nvs_flash_init();
    if(rc!=ESP_OK){
        ESP_LOGE(TAG,"NVS_INIT_FAILED rc=%d; refusing destructive recovery",rc);
        return;
    }
    // Start web recovery immediately after NVS. Even a failed BLE mutex,
    // catalog parser task, or Oracle transport must NEVER strand OTA again.
    if(!jh2_web_start()){
        ESP_LOGE(TAG,"WEB_RECOVERY_START_FAILED");
    }
    notice_lock=xSemaphoreCreateMutex();
    raw_write_lock=xSemaphoreCreateMutex();
    raw_write_event=xSemaphoreCreateBinary();
    if(!notice_lock||!raw_write_lock||!raw_write_event){
        ESP_LOGE(TAG,"Native BLE synchronization allocation failed");
        return;
    }
    // Catalog parser is deliberately lower priority than NimBLE and never
    // runs inside the notification callback. No dependency on Oracle uptime.
    catalog_queue=xQueueCreate(CATALOG_RX_QUEUE_DEPTH,sizeof(gatt_notice));
    if(!catalog_queue || xTaskCreate(catalog_worker,"jh2-catalog-rx",4096,NULL,3,NULL)!=pdPASS){
        ESP_LOGE(TAG,"CATALOG_RECEIVE_WORKER_FAILED");
        return;
    }
    rc=nimble_port_init();
    if(rc!=ESP_OK){fail("nimble_port_init",rc);return;}
    ble_hs_cfg.reset_cb=on_reset;
    ble_hs_cfg.sync_cb=on_sync;
    ble_att_set_preferred_mtu(247);
    nimble_port_freertos_init(host_task);
#if CONFIG_JH2_NATIVE_BROWSER_OTA_COMPAT
    // Keep the product marker and compat segment in the actual ESP32-C6
    // app image (not appended after its checksum). Required by the
    // existing 1.1.27 factory browser updater's verified runtime gate.
    ESP_LOGI(TAG,"NATIVE_BROWSER_OTA_COMPAT_MARKER %s padding=%p",
             jh2_native_runtime_marker,(const void*)jh2_native_compat_padding);
#endif
#if CONFIG_JH2_NATIVE_ENABLE_ORACLE
    // Lab opt-in only. Default firmware remains the non-destructive BLE
    // inventory probe; enabling this option does not authorize OTA or flashing.
    ESP_LOGW(TAG,"NATIVE_ORACLE_LAB_OPT_IN: starting saved-credential bridge");
    jh2_bridge_start();
#else
    ESP_LOGW(TAG,"DIAGNOSTIC_ONLY; native inventory read; Oracle startup disabled");
#endif
    while(true){
        vTaskDelay(pdMS_TO_TICKS(10000));
        if(requested && !finished && started_at &&
           esp_timer_get_time()-started_at>20000000LL){
            ESP_LOGW(TAG,"PARTIAL_CATALOG received=%u of 88 reply_packets=%u notifications=%u",
                     (unsigned)catalog_unique,(unsigned)catalog_packets,(unsigned)notification_count);
            started_at=esp_timer_get_time();
        }
    }
}
