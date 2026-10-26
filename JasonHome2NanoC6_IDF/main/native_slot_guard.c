#include "native_slot_guard.h"
#include <string.h>
#include <stdio.h>

static uint8_t crc8(const uint8_t *b,size_t n){
    uint8_t crc=0;
    for(size_t i=0;i<n;i++){
        crc^=b[i];
        for(unsigned k=0;k<8;k++)crc=(uint8_t)((crc&128)?(crc<<1)^0x97:crc<<1);
    }
    return crc;
}
static bool varint(const uint8_t *b,size_t n,size_t *p,uint32_t *out){
    uint32_t v=0;
    for(unsigned shift=0;shift<35;shift+=7){
        if(*p>=n)return false;
        uint8_t c=b[(*p)++];
        if(shift==28&&(c&0xf0))return false;
        v|=(uint32_t)(c&127)<<shift;
        if(!(c&128)){*out=v;return true;}
    }
    return false;
}
static uint32_t le32(const uint8_t *b){
    return (uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24;
}
uint16_t jh2_slot_command_opcode(const uint8_t *b,size_t n){
    if(!b||n<24||n>104||b[1]!=1||b[2]||b[3]||b[4]!=0xf0||b[5]!=4)return 0;
    return (uint16_t)((uint16_t)b[10]<<8|b[11]);
}
// Discover the manufacturer-assigned CID without altering BLE bytes.
uint32_t jh2_slot_packet_cid(const jh2_slot_session *s,const char *uuid,
        const uint8_t *b,size_t n){
    if(!uuid||!b)return 0;
    if(strcmp(uuid,JH2_SLOT_COMMAND_UUID)==0){
        uint16_t op=jh2_slot_command_opcode(b,n);
        if(op!=2909&&op!=2606)return 0;
        size_t p=24;uint32_t tag=0,cid=0;
        return varint(b,n,&p,&tag)&&tag==8&&varint(b,n,&p,&cid)?cid:0;
    }
    if(strcmp(uuid,JH2_SLOT_UPLOAD_UUID)!=0||n<9)return 0;
    uint32_t parts=(uint32_t)b[1]*256+b[2],left=(uint32_t)b[5]*256+b[6];
    if(left!=parts)return s&&s->active?s->cid:0;
    size_t p=8;
    while(p<n){
        uint32_t tag=0,v=0;
        if(!varint(b,n,&p,&tag))return 0;
        if((tag&7)==0){
            if(!varint(b,n,&p,&v))return 0;
            if((tag>>3)==9)return v;
        }else if((tag&7)==2){
            if(!varint(b,n,&p,&v)||v>n-p)return 0;
            p+=v;
        }else return 0;
    }
    return 0;
}
bool jh2_slot_validate(jh2_slot_session *s,const char *uuid,
        const uint8_t *b,size_t n,uint32_t now,bool known,unsigned matches,
        uint16_t slot,bool read_only,const char **error){
    *error="Unsupported native slot packet";
    if(!s||!uuid||!b||n>508)return false;
    if(strcmp(uuid,JH2_SLOT_COMMAND_UUID)==0){
        uint16_t op=jh2_slot_command_opcode(b,n);
        if(op==205||op==167||op==2904||op==2104||op==2627){
            // Manufacturer read-only controller playlist catalog (single DDP).
            if(n!=24)return false;
            *error=NULL;return true;
        }
        if(read_only){*error="Read-only firmware permits only 205/167/2904/2104/2627";return false;}
        if(op!=2909&&op!=2606)return false;
        size_t p=24;uint32_t tag=0,cid=0,play_slot=0;
        if(!varint(b,n,&p,&tag)||tag!=8||!varint(b,n,&p,&cid)||!cid)return false;
        if(op==2606&&(!varint(b,n,&p,&tag)||tag!=16||!varint(b,n,&p,&play_slot)))return false;
        if(p!=n)return false;
        if(!known){*error="Fresh final target catalog section required";return false;}
        if(matches!=1){*error="Assigned custom CID is absent, duplicated or a factory effect; erase/play refused";return false;}
        if(op==2606&&play_slot!=slot){*error="Playback slot differs from controller inventory";return false;}
        s->active=false;*error=NULL;return true;
    }
    if(read_only||strcmp(uuid,JH2_SLOT_UPLOAD_UUID)!=0||n<9||b[3]!=0x11||b[4]!=0xff)return false;
    uint32_t parts=(uint32_t)b[1]*256+b[2],left=(uint32_t)b[5]*256+b[6];
    if(!parts||parts>1200||left>parts)return false;
    if(left==parts){
        // UploadRequest CRC covers the entire header with its CRC byte zero.
        uint8_t header[508];memcpy(header,b,n);header[7]=0;
        if(crc8(header,n)!=b[7]){*error="Upload header CRC mismatch";return false;}
        if(!known||matches!=0){*error="Fresh controller catalog must prove the assigned CID empty before upload";return false;}
        uint32_t values[10]={0},seen=0;size_t p=8;
        size_t path_start=0,path_len=0;
        while(p<n){
            uint32_t tag=0,v=0;
            if(!varint(b,n,&p,&tag))return false;
            unsigned field=tag>>3;
            if(!field||field>9||(seen&(1U<<field)))return false;
            seen|=1U<<field;
            if((tag&7)==0){
                if(!varint(b,n,&p,&v))return false;
                values[field]=v;
            }else if(field==8&&(tag&7)==2){
                if(!varint(b,n,&p,&v)||v<5||v>14||p+v>n)return false;
                path_start=p;path_len=v;p+=v;
            }else return false;
        }
        const uint32_t required=(1U<<1)|(1U<<2)|(1U<<3)|(1U<<5)|(1U<<6)|(1U<<9);
        if((seen&required)!=required||values[1]!=b[0]||!values[9]||
           values[4]||values[7]||values[5]!=parts||values[6]!=500||
           !values[3]||values[3]>600000||(values[3]+499)/500!=parts||
           !((values[2]==0&&path_len)||(values[2]==3&&!path_len&&values[3]>=4096&&values[3]<=32768&&values[3]%4096==0)))return false;
        if(values[2]==0){
            char name[20];int needed=snprintf(name,sizeof(name),"%u.eff",(unsigned)values[9]);
            if(needed<=0||(size_t)needed!=path_len||memcmp(b+path_start,name,path_len))return false;
        }
        *s=(jh2_slot_session){.size=values[3],.parts=parts,.next=0,
            .last_ms=now,.id=b[0],.type=(uint8_t)values[2],.cid=values[9],.active=true};
        *error=NULL;return true;
    }
    if(!s->active||now-s->last_ms>180000||s->id!=b[0]||s->parts!=parts||
       s->next>=parts||left!=parts-s->next-1){*error="Native upload session expired or packet out of order";return false;}
    size_t payload=s->size-s->next*500;
    if(payload>500)payload=500;
    if(n!=payload+8||crc8(b+8,payload)!=b[7]){*error="Native upload payload length/CRC mismatch";return false;}
    if(s->next==0){
        const uint8_t *file=b+8;
        bool valid=s->type==3?
            payload>=9&&memcmp(file,"DN\x01\xfe",4)==0&&le32(file+4)==s->cid&&file[8]==s->size/4096:
            payload>=18&&(memcmp(file,"DNMX",4)==0||memcmp(file,"DNCX",4)==0)&&
                file[4]==3&&file[5]==1&&file[6]==40&&file[7]==0&&
                file[8]==40&&file[9]==0&&le32(file+14)==s->cid;
        if(!valid){*error="File header CID does not match registered upload session";return false;}
    }
    ++s->next;s->last_ms=now;
    if(s->next==parts)s->active=false;
    *error=NULL;return true;
}
