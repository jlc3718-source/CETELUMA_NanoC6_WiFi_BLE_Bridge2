/*
 * Native port of SmartDawnProtocol.cpp factory-control packets.
 * Bluetooth UUIDs and controller firmware are unchanged.
 * No slot erase or upload operations exist in this module.
 */
#include "native_commands.h"
#include "native_ble.h"
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdbool.h>

static const char *CTRL_UUID="01020074-1972-1925-3022-077119514e44";
static uint8_t seq=0;
static uint16_t tx=0;
static const uint32_t GROUPS[33]={
  15193,15194,15195,15196,15197,15198,15199,15200,15201,15202,15203,
  15204,15205,15206,15207,15208,15209,15210,15211,15212,15213,15214,
  15215,15216,15217,15218,15219,15220,15221,15222,15224,15225,83494
};
static const uint32_t INDEXES[33]={
  0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,
  18,19,20,21,22,23,24,25,26,27,28,29,30,31,33
};
static size_t uvar(uint32_t value,uint8_t *b){
    size_t len=0;
    do{
        uint8_t next=(uint8_t)(value&127);
        value>>=7;
        b[len++]=(uint8_t)(next|(value?128:0));
    }while(value&&len<5);
    return len;
}
static bool command(uint16_t opcode,const uint8_t *payload,size_t len){
    if(len>256||(len&&!payload))return false;
    uint8_t bytes[280]={0};
    bytes[0]=seq++;
    bytes[1]=1;bytes[2]=0;bytes[3]=0;
    bytes[4]=0xf0;bytes[5]=4;
    bytes[6]=(uint8_t)(tx>>8);bytes[7]=(uint8_t)(tx&255);++tx;
    bytes[10]=(uint8_t)(opcode>>8);bytes[11]=(uint8_t)opcode;
    if(len)memcpy(bytes+24,payload,len);
    // Factory control writes are short. An unresponsive controller must not
    // occupy the Nano's single HTTP handler for up to 12 seconds per write.
    // Large native animation uploads retain their separate long timeouts.
    return jh2_ble_raw_write(CTRL_UUID,bytes,len+24,2500);
}
bool jh2_native_read(uint16_t opcode){
    if(opcode!=205 && opcode!=167 && opcode!=2904 && opcode!=2104)return false;
    return command(opcode,NULL,0);
}
static bool scalar(uint16_t opcode,uint32_t v){
    uint8_t p[6];p[0]=8;
    size_t n=uvar(v,p+1);
    return command(opcode,p,n+1);
}
static int raw_brightness(int ui){
    if(ui<1||ui>100)return -1;
    const int pct=4+((ui-1)*96+49)/99;
    return (pct*255+50)/100;
}
// Original Smart Dawn 1.2.4 APK: M_REBOOT=2599 (0x0A27), sent with
// no protobuf payload. This restarts the SmartDawn controller, NOT the Nano.
// Do not confuse with M_FACTORY_RESET=2598, which is never used here.
bool jh2_native_curtain_reboot(void){
    return command(2599,NULL,0);
}
bool jh2_native_power(bool on){
    return command(on?0x09d2:0x09d3,NULL,0);
}
bool jh2_native_brightness(int level){
    if(level==0)return jh2_native_power(false);
    int native=raw_brightness(level);
    return native>=0&&scalar(0x09cd,(uint32_t)native);
}
bool jh2_native_speed(int speed){
    return speed>=0&&speed<=255&&scalar(0x09db,(uint32_t)speed);
}
bool jh2_native_layout(int code){
    return (code==0||code==4||code==5||code==6)&&scalar(0x09c6,(uint32_t)code);
}
bool jh2_native_effect(int id){
    if(id<0||id>87)return false;
    uint32_t group,id_in_group;
    if(id<55){group=15924;id_in_group=(uint32_t)id;}
    else{group=GROUPS[id-55];id_in_group=INDEXES[id-55];}
    if(!command(0x096a,NULL,0))return false;
    uint8_t data[12];size_t n=0;
    data[n++]=8;n+=uvar(group,data+n);
    data[n++]=16;n+=uvar(id_in_group,data+n);
    return command(0x0a2e,data,n);
}
bool jh2_native_play(uint32_t cid,uint32_t slot){
    // Matches the original production Nano permission boundary.
    // Other CIDs require an 88-entry verified inventory and backup.
    if(cid!=83928 || slot>255)return false;
    uint8_t data[12];size_t n=0;
    data[n++]=8;n+=uvar(cid,data+n);
    data[n++]=16;n+=uvar(slot,data+n);
    return command(2606,data,n);
}
bool jh2_native_solid(uint32_t rgb,int brightness){
    if(brightness<0||brightness>100||rgb>0xffffff)return false;
    if(!command(2514,NULL,0) || !scalar(2701,1) ||
       !command(2713,NULL,0))return false;
    uint8_t packet[30]={0};
    packet[0]=seq++;packet[1]=1;packet[2]=0;packet[3]=1;
    packet[4]=1;packet[5]=(uint8_t)(rgb>>16);
    packet[6]=(uint8_t)(rgb>>8);packet[7]=(uint8_t)rgb;
    int remaining=1600;size_t n=9;
    while(remaining>0&&n<sizeof(packet)){
        int run=remaining<127?remaining:127;
        packet[n++]=(uint8_t)(0x80|run);
        remaining-=run;
    }
    if(remaining || !jh2_ble_asset_packet(1,packet,n))return false;
    if(brightness==0)return command(2515,NULL,0);
    return jh2_native_brightness(brightness);
}
