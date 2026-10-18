/*
 * Read-only controller -> NimBLE HCI ACL receive diagnostic.
 * --wrap intercepts host ACL packets and immediately forwards untouched.
 * No packet modification, allocation, IO, logging, or transport writes.
 */
#include <stdbool.h>
#include <stdint.h>
#include "os/os_mbuf.h"
#include "cJSON.h"

static volatile uint32_t packets_total=0,packets_start=0,packets_cont=0;
static volatile uint32_t packets_other_pb=0,packets_short=0,packets_copy_error=0;
static volatile uint32_t incoming_att_notify=0,unknown_notify_length=0;
static volatile uint32_t notify_350=0,notify_364=0,notify_370=0,notify_396=0,notify_163=0;
static volatile uint32_t notify_other=0,notify_values_below_350=0,notify_values_above_396=0;
static volatile uint32_t hci_acl_len_max=0,hci_acl_len_gt_260=0;

extern int __real_ble_hs_hci_evt_acl_process(struct os_mbuf *om);

int __wrap_ble_hs_hci_evt_acl_process(struct os_mbuf *om) {
    uint8_t b[11]={0};
    const uint16_t len=om?OS_MBUF_PKTLEN(om):0;
    ++packets_total;
    if(len>hci_acl_len_max)hci_acl_len_max=len;
    if(len>260)++hci_acl_len_gt_260;
    if(len<4)++packets_short;
    else if(os_mbuf_copydata(om,0,len<sizeof(b)?len:sizeof(b),b)!=0)++packets_copy_error;
    else {
        const uint8_t pb=(b[1]>>4)&3;
        if(pb==1)++packets_cont;
        else if(pb==0||pb==2)++packets_start;
        else ++packets_other_pb;
        if((pb==0||pb==2)&&len>=11 && b[6]==4 && b[7]==0 && b[8]==0x1b){
            ++incoming_att_notify;
            const uint16_t l2cap_len=(uint16_t)b[4]|((uint16_t)b[5]<<8);
            if(l2cap_len>=3){
                const uint16_t value_len=l2cap_len-3;
                if(value_len==350)++notify_350;
                else if(value_len==364)++notify_364;
                else if(value_len==370)++notify_370;
                else if(value_len==396)++notify_396;
                else if(value_len==163)++notify_163;
                else {
                    ++notify_other;
                    if(value_len<350)++notify_values_below_350;
                    if(value_len>396)++notify_values_above_396;
                }
            }else ++unknown_notify_length;
        }
    }
    return __real_ble_hs_hci_evt_acl_process(om);
}
void jh2_hci_acl_diag(cJSON *out){
    if(!out)return;
    cJSON_AddNumberToObject(out,"nativeHCIAclPackets",packets_total);
    cJSON_AddNumberToObject(out,"nativeHCIAclStarts",packets_start);
    cJSON_AddNumberToObject(out,"nativeHCIAclContinuations",packets_cont);
    cJSON_AddNumberToObject(out,"nativeHCIAclOtherPB",packets_other_pb);
    cJSON_AddNumberToObject(out,"nativeHCIAclShort",packets_short);
    cJSON_AddNumberToObject(out,"nativeHCIAclCopyErrors",packets_copy_error);
    cJSON_AddNumberToObject(out,"nativeHCIAclMaxBytes",hci_acl_len_max);
    cJSON_AddNumberToObject(out,"nativeHCIAclLongPackets",hci_acl_len_gt_260);
    cJSON_AddNumberToObject(out,"nativeHCIStartATTNotifies",incoming_att_notify);
    cJSON_AddNumberToObject(out,"nativeHCINotify350",notify_350);
    cJSON_AddNumberToObject(out,"nativeHCINotify364",notify_364);
    cJSON_AddNumberToObject(out,"nativeHCINotify370",notify_370);
    cJSON_AddNumberToObject(out,"nativeHCINotify396",notify_396);
    cJSON_AddNumberToObject(out,"nativeHCINotify163",notify_163);
    cJSON_AddNumberToObject(out,"nativeHCINotifyOther",notify_other);
    cJSON_AddNumberToObject(out,"nativeHCINotifyUnknownLength",unknown_notify_length);
}
