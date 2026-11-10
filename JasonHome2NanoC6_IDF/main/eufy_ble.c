/* Dedicated, short-lived Eufy E10 GATT central. SmartDawn owns another
 * connection and is NEVER disconnected from this module. An explicit Oracle
 * request targets one of four allowlisted controller names, then completes.
 * No BLE packet, Eufy account ID or session key is printed or returned.
 */
#include "eufy_ble.h"
#include "eufy_e10.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "nimble/nimble_port.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "os/os_mbuf.h"
#include "esp_log.h"
static const char *TAG="EUFY_E10";
static const ble_uuid128_t SERVICE=BLE_UUID128_INIT(
  0x25,0x20,0x56,0x7c,0x05,0xcf,0x6e,0xb4,0xc5,0x41,0x02,0x03,0x01,0x00,0x85,0x8c);
static const ble_uuid128_t WRITE=BLE_UUID128_INIT(
  0x25,0x20,0x56,0x7c,0x05,0xcf,0x6e,0xb4,0xc5,0x41,0x02,0x03,0x02,0x00,0x85,0x8c);
static const ble_uuid128_t NOTIFY=BLE_UUID128_INIT(
  0x25,0x20,0x56,0x7c,0x05,0xcf,0x6e,0xb4,0xc5,0x41,0x02,0x03,0x03,0x00,0x85,0x8c);
enum { ST_IDLE=0, ST_QUEUED, ST_SCANNING, ST_FOUND, ST_CONNECTING,
       ST_DISCOVERING, ST_SUBSCRIBING, ST_HANDSHAKE, ST_WAIT_KEY,
       ST_COMMAND, ST_FINISHED, ST_CONNECT_RETRY };
typedef struct {
    volatile int stage;
    volatile bool busy,host_ready,result;
    volatile int64_t deadline;
    uint8_t mac[6];ble_addr_t peer;
    uint16_t connection,service_start,service_end,writer,notifier,cccd,mtu;
    uint8_t step;bool session_notified,is_e22;
    uint8_t connect_tries;int active_index;
    eufy_ble_op operation;bool on;
    uint8_t brightness,red,green,blue,lamps;
    eufy_e10_t crypto;
    char result_stage[100];
} eufy_controller;
static eufy_controller ctl={.connection=BLE_HS_CONN_HANDLE_NONE};
static SemaphoreHandle_t lock=NULL,completed=NULL;
/* Postmortem telemetry: bounded stage counters only; no addresses, packets or keys. */
static volatile int last_phase=ST_IDLE,last_failure_code=0;
static volatile unsigned scan_reports=0,scan_match_count=0,scan_deferred=0;
static volatile unsigned scan_starts=0,connected_count=0,notify_count=0,handshake_ack_count=0;
static volatile int64_t stage_since=0;
/* Per-unit facts are scoped to this Nano boot. Never infer the real lamp power
 * state from GATT success, and never call a missing advertisement "offline". */
typedef struct {
    const char *name,*model;
    uint8_t mac[6]; /* NimBLE byte order (LSB first). */
    int64_t seen_us,connected_us,gatt_us,attempt_us,failure_us;
    int8_t rssi;
    unsigned attempts,completed,failures;
    char failure[48];
} eufy_presence;
static eufy_presence units[4]={
    {.name="Pool",.model="E120",.mac={0x01,0xc4,0x0e,0xb1,0x2c,0x10}},
    {.name="House",.model="E120",.mac={0x7f,0xca,0xad,0xb1,0x2c,0x10}},
    {.name="Garage",.model="E22",.mac={0xb5,0xf7,0x9d,0xb1,0x2c,0x10}},
    {.name="Shed",.model="E22",.mac={0x96,0x27,0xeb,0xb1,0x2c,0x10}}
};
static volatile bool bg_scanning=false,closing=false;
static volatile int64_t bg_scan_at=0,bg_scan_finished=0,bg_next_scan=0;
static uint16_t closing_handle=BLE_HS_CONN_HANDLE_NONE;
static unsigned bg_scan_count=0;
static int index_by_name(const char *name){
    if(!name)return -1;
    for(int i=0;i<4;i++)if(!strcmp(name,units[i].name))return i;
    return -1;
}
static int index_by_mac(const uint8_t addr[6]){
    for(int i=0;i<4;i++)if(!memcmp(addr,units[i].mac,6))return i;
    return -1;
}
static void observe(const struct ble_gap_disc_desc *advert){
    const int i=index_by_mac(advert->addr.val);
    if(i>=0){units[i].seen_us=esp_timer_get_time();units[i].rssi=advert->rssi;}
}
static int age_seconds(int64_t time_us){
    if(time_us<=0)return -1;
    const int64_t delta=esp_timer_get_time()-time_us;
    return delta<0?-1:(int)(delta/1000000LL);
}
static int background_event(struct ble_gap_event *e,void *arg){
    (void)arg;
    if(e->type==BLE_GAP_EVENT_DISC)observe(&e->disc);
    else if(e->type==BLE_GAP_EVENT_DISC_COMPLETE){
        bg_scanning=false;
        bg_scan_finished=esp_timer_get_time();
        bg_next_scan=bg_scan_finished+120000000LL;
    }
    return 0;
}
static const char *phase_name(int stage){
    switch(stage){
    case ST_IDLE:return "idle";
    case ST_QUEUED:return "waiting-for-scan";
    case ST_SCANNING:return "scanning";
    case ST_FOUND:return "scan-match";
    case ST_CONNECTING:return "connecting";
    case ST_DISCOVERING:return "discovering-gatt";
    case ST_SUBSCRIBING:return "enabling-notify";
    case ST_HANDSHAKE:return "e10-handshake";
    case ST_WAIT_KEY:return "e10-session-key";
    case ST_COMMAND:return "sending-command";
    case ST_FINISHED:return "finished";
    case ST_CONNECT_RETRY:return "retrying-connection";
    default:return "unknown";
    }
}
static void stage_set(int stage){
    ctl.stage=stage;stage_since=esp_timer_get_time();
}
static void reset_crypto(void){eufy_e10_clear(&ctl.crypto);}
static bool parse_mac(const char *text,uint8_t out[6]){
    if(!text||strlen(text)!=17)return false;
    unsigned b[6];
    for(int i=0;i<17;i++)if((i+1)%3==0){if(text[i]!=':')return false;}
    else if(!((text[i]>='0'&&text[i]<='9')||(text[i]>='a'&&text[i]<='f')||
              (text[i]>='A'&&text[i]<='F')))return false;
    if(sscanf(text,"%2x:%2x:%2x:%2x:%2x:%2x",
              &b[0],&b[1],&b[2],&b[3],&b[4],&b[5])!=6)return false;
    for(int i=0;i<6;i++)out[i]=(uint8_t)b[5-i];
    return true;
}
static bool recognized(const char *name){
    return name&&(!strcmp(name,"Pool")||!strcmp(name,"House")||
                 !strcmp(name,"Garage")||!strcmp(name,"Shed"));
}
static void finish(bool result,const char *why){
    if(!ctl.busy)return;
    ctl.result=result;
    last_phase=ctl.stage;
    if(ctl.active_index>=0&&ctl.active_index<4){
        eufy_presence *u=&units[ctl.active_index];
        if(result){u->gatt_us=esp_timer_get_time();u->completed++;}
        else{u->failure_us=esp_timer_get_time();u->failures++;
             snprintf(u->failure,sizeof(u->failure),"%s",why?why:"unknown");}
    }
    snprintf(ctl.result_stage,sizeof(ctl.result_stage),"%s",why?why:"Eufy BLE unavailable");
    ctl.busy=false;stage_set(ST_FINISHED);
    reset_crypto();
    if(ctl.connection!=BLE_HS_CONN_HANDLE_NONE){
        closing_handle=ctl.connection;
        closing=true;
        const int rc=ble_gap_terminate(ctl.connection,BLE_ERR_REM_USER_CONN_TERM);
        if(rc!=0){closing=false;closing_handle=BLE_HS_CONN_HANDLE_NONE;}
        ctl.connection=BLE_HS_CONN_HANDLE_NONE;
    }
    if(completed)xSemaphoreGive(completed);
}
static int gap_event(struct ble_gap_event *e,void *unused);
static void fail(const char *step,int rc){
    /* Diagnostic step + return code only; never include account/serial/packets. */
    last_failure_code=rc;
    ESP_LOGW(TAG,"local command stage=%s phase=%s code=%d",step,phase_name(ctl.stage),rc);
    finish(false,step);
}
static int write_done(uint16_t conn,const struct ble_gatt_error *e,
                      struct ble_gatt_attr *attr,void *arg);
static bool send_step(void){
    if(!ctl.busy||ctl.connection==BLE_HS_CONN_HANDLE_NONE||ctl.step>=5)return false;
    uint8_t frame[EUFY_E10_FRAME_MAX];time_t now=time(NULL);
    if(now<1600000000){fail("device_clock_unavailable",0);return false;}
    int len=eufy_e10_handshake(&ctl.crypto,ctl.step,(uint32_t)now,frame,sizeof(frame));
    if(len<0 || len>(int)ble_att_mtu(ctl.connection)-3){
        fail("handshake_frame_size",len);return false;
    }
    int rc=ble_gattc_write_flat(ctl.connection,ctl.writer,frame,(uint16_t)len,write_done,NULL);
    memset(frame,0,sizeof(frame));
    if(rc){fail("handshake_write",rc);return false;}
    stage_set(ST_HANDSHAKE);return true;
}
static bool send_command(void){
    if(!ctl.busy||!ctl.crypto.session_valid||ctl.connection==BLE_HS_CONN_HANDLE_NONE)return false;
    uint8_t frame[EUFY_E10_FRAME_MAX];const time_t now=time(NULL);
    int len=-1;
    if(ctl.operation==EUFY_BLE_POWER)
        len=eufy_e10_power(&ctl.crypto,(uint32_t)now,ctl.on,frame,sizeof(frame));
    else if(ctl.operation==EUFY_BLE_BRIGHTNESS)
        len=eufy_e10_brightness(&ctl.crypto,(uint32_t)now,ctl.brightness,frame,sizeof(frame));
    else if(ctl.operation==EUFY_BLE_COLOR)
        len=eufy_e10_color(&ctl.crypto,(uint32_t)now,ctl.is_e22,ctl.red,ctl.green,
                           ctl.blue,ctl.lamps,frame,sizeof(frame));
    if(len<0||len>(int)ble_att_mtu(ctl.connection)-3){
        fail("command_frame_size_or_mtu",len);return false;
    }
    stage_set(ST_COMMAND);
    int rc=ble_gattc_write_flat(ctl.connection,ctl.writer,frame,(uint16_t)len,write_done,NULL);
    memset(frame,0,sizeof(frame));
    if(rc){fail("command_gatt_write",rc);return false;}
    return true;
}
static int write_done(uint16_t conn,const struct ble_gatt_error *e,
                      struct ble_gatt_attr *attr,void *arg){
    (void)conn;(void)attr;(void)arg;
    if(!ctl.busy)return 0;
    if(e->status){fail("gatt_write_ack",e->status);return 0;}
    if(ctl.stage==ST_COMMAND){
        finish(true,"eufy_gatt_write_acknowledged_physical_light_unverified");
        return 0;
    }
    if(ctl.stage!=ST_HANDSHAKE)return 0;
    ctl.step++;handshake_ack_count++;
    if(ctl.step<5)send_step();
    else if(ctl.crypto.session_valid)send_command();
    else stage_set(ST_WAIT_KEY);
    return 0;
}
static int subscribe_done(uint16_t conn,const struct ble_gatt_error *e,
                          struct ble_gatt_attr *attr,void *arg){
    (void)conn;(void)attr;(void)arg;
    if(e->status){fail("cccd_write",e->status);return 0;}
    ctl.step=0;send_step();return 0;
}
static int dsc_found(uint16_t conn,const struct ble_gatt_error *e,
                     uint16_t chr_handle,const struct ble_gatt_dsc *dsc,void *arg){
    (void)conn;(void)chr_handle;(void)arg;
    if(e->status==0){
        if(ble_uuid_u16(&dsc->uuid.u)==BLE_GATT_DSC_CLT_CFG_UUID16)ctl.cccd=dsc->handle;
        return 0;
    }
    if(e->status!=BLE_HS_EDONE||!ctl.cccd){fail("notification_cccd_missing",e->status);return 0;}
    const uint8_t enable[2]={1,0};stage_set(ST_SUBSCRIBING);
    int rc=ble_gattc_write_flat(ctl.connection,ctl.cccd,enable,2,subscribe_done,NULL);
    if(rc)fail("cccd_write_launch",rc);
    return 0;
}
static int chr_found(uint16_t conn,const struct ble_gatt_error *e,
                     const struct ble_gatt_chr *chr,void *arg){
    (void)conn;(void)arg;
    if(e->status==0){
        if(ble_uuid_cmp(&chr->uuid.u,&WRITE.u)==0)ctl.writer=chr->val_handle;
        if(ble_uuid_cmp(&chr->uuid.u,&NOTIFY.u)==0)ctl.notifier=chr->val_handle;
        return 0;
    }
    if(e->status!=BLE_HS_EDONE||!ctl.writer||!ctl.notifier){
        fail("eufy_characteristic_missing",e->status);return 0;
    }
    int rc=ble_gattc_disc_all_dscs(ctl.connection,ctl.notifier,ctl.service_end,dsc_found,NULL);
    if(rc)fail("eufy_descriptor_discovery",rc);
    return 0;
}
static int svc_found(uint16_t conn,const struct ble_gatt_error *e,
                     const struct ble_gatt_svc *svc,void *arg){
    (void)conn;(void)arg;
    if(e->status==0){
        if(ble_uuid_cmp(&svc->uuid.u,&SERVICE.u)==0){
            ctl.service_start=svc->start_handle;ctl.service_end=svc->end_handle;
        }return 0;
    }
    if(e->status!=BLE_HS_EDONE||!ctl.service_start){
        fail("eufy_service_missing",e->status);return 0;
    }
    int rc=ble_gattc_disc_all_chrs(ctl.connection,ctl.service_start,ctl.service_end,chr_found,NULL);
    if(rc)fail("eufy_characteristic_discovery",rc);
    return 0;
}
static int mtu_done(uint16_t conn,const struct ble_gatt_error *e,uint16_t mtu,void *arg){
    (void)arg;
    if(!ctl.busy)return 0;
    if(e->status!=0){fail("eufy_mtu_negotiation",e->status);return 0;}
    ctl.mtu=mtu;stage_set(ST_DISCOVERING);
    int rc=ble_gattc_disc_all_svcs(conn,svc_found,NULL);
    if(rc)fail("eufy_service_discovery",rc);
    return 0;
}
static int gap_event(struct ble_gap_event *e,void *unused){
    (void)unused;
    switch(e->type){
    case BLE_GAP_EVENT_DISC:
        observe(&e->disc);
        if(!ctl.busy||ctl.stage!=ST_SCANNING)return 0;
        scan_reports++;
        if(memcmp(e->disc.addr.val,ctl.mac,6)!=0)return 0;
        scan_match_count++;
        ctl.peer=e->disc.addr;stage_set(ST_FOUND);
        ble_gap_disc_cancel();return 0;
    case BLE_GAP_EVENT_DISC_COMPLETE:
        if(ctl.busy&&ctl.stage==ST_SCANNING)fail("eufy_scan_no_target",0);
        return 0;
    case BLE_GAP_EVENT_CONNECT:
        if(e->connect.status){
            if(ctl.busy&&ctl.stage==ST_CONNECTING){
                last_failure_code=e->connect.status;
                if(ctl.connect_tries<2)stage_set(ST_CONNECT_RETRY);
                else fail("eufy_gatt_connect",e->connect.status);
            }
            return 0;
        }
        /* Canceled or delayed connect callback must not leak a stale session. */
        if(!ctl.busy||ctl.stage!=ST_CONNECTING){
            ble_gap_terminate(e->connect.conn_handle,BLE_ERR_REM_USER_CONN_TERM);
            return 0;
        }
        ctl.connection=e->connect.conn_handle;connected_count++;stage_set(ST_DISCOVERING);
        if(ctl.active_index>=0&&ctl.active_index<4)
            units[ctl.active_index].connected_us=esp_timer_get_time();
        {int rc=ble_gattc_exchange_mtu(ctl.connection,mtu_done,NULL);
         if(rc)fail("eufy_mtu_request",rc);}
        return 0;
    case BLE_GAP_EVENT_NOTIFY_RX:
        if(!ctl.busy || e->notify_rx.conn_handle!=ctl.connection ||
           e->notify_rx.attr_handle!=ctl.notifier)return 0;
        {notify_count++;const uint16_t len=OS_MBUF_PKTLEN(e->notify_rx.om);
         if(len>EUFY_E10_FRAME_MAX||len<10)return 0;
         uint8_t b[EUFY_E10_FRAME_MAX];
         if(os_mbuf_copydata(e->notify_rx.om,0,len,b)!=0)return 0;
         int state=eufy_e10_notification(&ctl.crypto,b,len);
         memset(b,0,sizeof(b));
         if(state==1){
             ctl.session_notified=true;
             if(ctl.step>=5&&ctl.stage==ST_WAIT_KEY)send_command();
         }}
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        if(closing&&e->disconnect.conn.conn_handle==closing_handle){
            closing=false;closing_handle=BLE_HS_CONN_HANDLE_NONE;return 0;
        }
        if(e->disconnect.conn.conn_handle==ctl.connection){
            ctl.connection=BLE_HS_CONN_HANDLE_NONE;
            if(ctl.busy)fail("eufy_disconnected",e->disconnect.reason);
        }return 0;
    default:return 0;
    }
}
void jh2_eufy_ble_host_ready(bool ready){ctl.host_ready=ready;}
bool jh2_eufy_ble_active(void){return ctl.busy;}
void jh2_eufy_ble_tick(void){
    if(!ctl.host_ready)return;
    const int64_t now_us=esp_timer_get_time();
    if(!ctl.busy){
        /* Passive 4.5-second radio survey every two minutes, only when idle.
         * It never disconnects SmartDawn, never sends a power command, and
         * defers to any existing BLE GAP activity. */
        if(!closing&&!bg_scanning&&!ble_gap_disc_active()&&
           now_us>bg_next_scan&&now_us>15000000LL){
            uint8_t own=0;
            if(ble_hs_id_infer_auto(0,&own)==0){
                struct ble_gap_disc_params params={0};
                params.passive=1;params.filter_duplicates=0;
                const int rc=ble_gap_disc(own,4500,&params,background_event,NULL);
                if(rc==0){bg_scanning=true;bg_scan_at=now_us;bg_scan_count++;}
                else bg_next_scan=now_us+15000000LL;
            }
        }
        return;
    }
    if(now_us>ctl.deadline){
        fail(ctl.stage==ST_CONNECTING?"eufy_connect_timeout":"eufy_command_timeout",0);
        return;
    }
    if(ctl.stage==ST_CONNECTING&&now_us-stage_since>11000000LL){
        const int rc=ble_gap_conn_cancel();
        last_failure_code=rc;
        if(ctl.connect_tries<2)stage_set(ST_CONNECT_RETRY);
        else fail("eufy_connect_timeout",rc);
        return;
    }
    if(ctl.stage==ST_CONNECT_RETRY){
        if(now_us-stage_since>2500000LL)stage_set(ST_QUEUED);
        return;
    }
    if(ctl.stage==ST_QUEUED){
        if(ble_gap_disc_active()){
            if(bg_scanning){bg_scanning=false;ble_gap_disc_cancel();}
            scan_deferred++;return;
        }/* never interrupt SmartDawn's scan */
        uint8_t own=0;if(ble_hs_id_infer_auto(0,&own)!=0){fail("eufy_own_address",0);return;}
        struct ble_gap_disc_params params={0};
        params.passive=0;params.filter_duplicates=0;
        int rc=ble_gap_disc(own,6500,&params,gap_event,NULL);
        if(rc){fail("eufy_scan_start",rc);return;}
        scan_starts++;stage_set(ST_SCANNING);
    }else if(ctl.stage==ST_FOUND){
        if(ble_gap_disc_active())return;
        uint8_t own=0;if(ble_hs_id_infer_auto(0,&own)!=0){fail("eufy_address",0);return;}
        stage_set(ST_CONNECTING);ctl.connect_tries++;
        if(ctl.active_index>=0&&ctl.active_index<4)
            units[ctl.active_index].attempts++;
        int rc=ble_gap_connect(own,&ctl.peer,11000,NULL,gap_event,NULL);
        if(rc){
            last_failure_code=rc;
            if(ctl.connect_tries<2)stage_set(ST_CONNECT_RETRY);
            else fail("eufy_connect_start",rc);
        }
    }
}
bool jh2_eufy_ble_execute(const eufy_ble_request *r,char *stage,size_t n){
    if(stage && n)snprintf(stage,n,"Eufy BLE unavailable");
    if(!r||!recognized(r->name)||!r->mac||!r->serial||!r->account_id||
       (r->operation!=EUFY_BLE_POWER&&r->operation!=EUFY_BLE_BRIGHTNESS&&r->operation!=EUFY_BLE_COLOR))
        return false;
    if(!lock)lock=xSemaphoreCreateMutex();
    if(!completed)completed=xSemaphoreCreateBinary();
    if(!lock||!completed||xSemaphoreTake(lock,pdMS_TO_TICKS(500))!=pdTRUE)return false;
    if(ctl.busy || !ctl.host_ready){xSemaphoreGive(lock);return false;}
    /* Wait for the previous GATT termination to actually complete. */
    for(int attempt=0;closing&&attempt<16;attempt++)
        vTaskDelay(pdMS_TO_TICKS(125));
    if(closing){if(stage&&n)snprintf(stage,n,"eufy_gatt_disconnect_pending");
       xSemaphoreGive(lock);return false;}
    uint8_t address[6];
    if(!parse_mac(r->mac,address) || !eufy_e10_init(&ctl.crypto,r->serial,r->account_id)){
        xSemaphoreGive(lock);return false;
    }
    while(xSemaphoreTake(completed,0)==pdTRUE){}
    memcpy(ctl.mac,address,6);
    ctl.active_index=index_by_name(r->name);
    if(ctl.active_index<0||memcmp(address,units[ctl.active_index].mac,6)){
        xSemaphoreGive(lock);reset_crypto();return false;
    }
    units[ctl.active_index].attempt_us=esp_timer_get_time();
    ctl.connect_tries=0;
    ctl.is_e22=!strcmp(r->name,"Garage")||!strcmp(r->name,"Shed");
    ctl.operation=r->operation;ctl.on=r->on;ctl.brightness=r->brightness;
    ctl.red=r->red;ctl.green=r->green;ctl.blue=r->blue;
    ctl.lamps=r->lamp_count?r->lamp_count:60;
    ctl.connection=BLE_HS_CONN_HANDLE_NONE;
    ctl.service_start=ctl.service_end=ctl.writer=ctl.notifier=ctl.cccd=0;
    ctl.step=0;ctl.session_notified=false;ctl.mtu=0;
    ctl.result=false;ctl.result_stage[0]=0;
    ctl.deadline=esp_timer_get_time()+48000000LL;
    scan_reports=scan_match_count=scan_deferred=scan_starts=connected_count=notify_count=handshake_ack_count=0;
    last_failure_code=0;stage_set(ST_QUEUED);ctl.busy=true;
    xSemaphoreGive(lock);
    bool woke=xSemaphoreTake(completed,pdMS_TO_TICKS(50000))==pdTRUE;
    if(!woke)finish(false,"eufy_command_timeout");
    bool ok=ctl.result;
    if(stage&&n)snprintf(stage,n,"%s",ctl.result_stage[0]?ctl.result_stage:"eufy_transport_unavailable");
    return ok;
}
bool jh2_eufy_ble_rescan(char *status,size_t len){
    if(status&&len)snprintf(status,len,"Bluetooth survey unavailable");
    if(!ctl.host_ready||ctl.busy||closing)return false;
    const int64_t before=bg_scan_finished;
    bg_next_scan=0;
    /* Survey is started on the regular app tick, never inside NimBLE callback.
     * It never modifies Eufy light state or disconnects the SmartDawn curtain. */
    for(int i=0;i<180;i++){
        vTaskDelay(pdMS_TO_TICKS(100));
        if(bg_scan_finished>before){
            if(status&&len)snprintf(status,len,
                "BLE advertisement survey completed; no advertisement is not proof of offline power");
            return true;
        }
        if(!ctl.host_ready||ctl.busy)return false;
    }
    if(status&&len)snprintf(status,len,"BLE survey deferred by active radio or connection");
    return false;
}
void jh2_eufy_ble_status(cJSON *obj){
    if(!obj)return;
    cJSON *ble=cJSON_AddObjectToObject(obj,"eufyLocalBle");
    if(!ble)return;
    cJSON_AddBoolToObject(ble,"supported",true);
    cJSON_AddBoolToObject(ble,"busy",ctl.busy);
    cJSON_AddBoolToObject(ble,"connected",ctl.connection!=BLE_HS_CONN_HANDLE_NONE);
    cJSON_AddStringToObject(ble,"state",ctl.busy?"processing":
                ctl.result?"last-command-delivered":"idle-or-unavailable");
    cJSON_AddStringToObject(ble,"phase",phase_name(ctl.busy?ctl.stage:last_phase));
    cJSON_AddNumberToObject(ble,"scanReports",scan_reports);
    cJSON_AddNumberToObject(ble,"scanMatches",scan_match_count);
    cJSON_AddNumberToObject(ble,"scanDeferred",scan_deferred);
    cJSON_AddNumberToObject(ble,"scanStarts",scan_starts);
    cJSON_AddNumberToObject(ble,"gattConnections",connected_count);
    cJSON_AddNumberToObject(ble,"notificationCount",notify_count);
    cJSON_AddNumberToObject(ble,"handshakeWriteAcks",handshake_ack_count);
    cJSON_AddNumberToObject(ble,"gattMtu",ctl.mtu);
    cJSON_AddNumberToObject(ble,"lastFailureCode",last_failure_code);
    cJSON_AddStringToObject(ble,"lastResult",ctl.busy?"in_progress":ctl.result_stage);
    cJSON_AddStringToObject(ble,"activeTarget",ctl.busy&&ctl.active_index>=0?
        units[ctl.active_index].name:"");
    cJSON_AddBoolToObject(ble,"surveyRunning",bg_scanning);
    cJSON_AddNumberToObject(ble,"lastSurveyAgeSeconds",age_seconds(bg_scan_finished));
    cJSON_AddNumberToObject(ble,"surveyCount",bg_scan_count);
    cJSON *list=cJSON_AddArrayToObject(ble,"devices");
    for(int i=0;i<4&&list;i++){
        const eufy_presence *u=&units[i];
        cJSON *item=cJSON_CreateObject();
        if(!item)continue;
        cJSON_AddStringToObject(item,"name",u->name);
        cJSON_AddStringToObject(item,"model",u->model);
        const int since=age_seconds(u->seen_us);
        const bool near=since>=0&&since<=180;
        const bool link=ctl.busy&&ctl.active_index==i&&
           ctl.connection!=BLE_HS_CONN_HANDLE_NONE;
        cJSON_AddBoolToObject(item,"connected",link);
        cJSON_AddStringToObject(item,"availability",link?"connected":
           near?"seen-nearby":bg_scan_finished>0?"not-seen-recently":"not-checked");
        cJSON_AddNumberToObject(item,"lastAdvertisementAgeSeconds",since);
        cJSON_AddNumberToObject(item,"rssiDbm",u->seen_us?u->rssi:0);
        cJSON_AddNumberToObject(item,"lastGattAckAgeSeconds",age_seconds(u->gatt_us));
        cJSON_AddNumberToObject(item,"lastAttemptAgeSeconds",age_seconds(u->attempt_us));
        cJSON_AddNumberToObject(item,"lastConnectedAgeSeconds",age_seconds(u->connected_us));
        cJSON_AddNumberToObject(item,"lastFailureAgeSeconds",age_seconds(u->failure_us));
        cJSON_AddNumberToObject(item,"attemptCount",u->attempts);
        cJSON_AddNumberToObject(item,"ackCount",u->completed);
        cJSON_AddNumberToObject(item,"failureCount",u->failures);
        cJSON_AddStringToObject(item,"lastFailureStage",u->failure);
        cJSON_AddStringToObject(item,"connectionPhase",
            ctl.busy&&ctl.active_index==i?phase_name(ctl.stage):"idle");
        cJSON_AddItemToArray(list,item);
    }
    /* Do not report serial, account ID, MAC, ciphertext or session key. */
}
