#include "effectlist.h"
#include <string.h>

// Protocol: outer DDP header is 20 bytes; opcode in big endian at [6:7].
// Its body is protobuf EffectList: repeated field 1 EffectInfo messages.
// Each EffectInfo has field 1 effect ID and field 4 controller CID.
static int varint(const uint8_t *b, size_t n, size_t *at, uint64_t *value) {
    uint64_t out=0;
    for (unsigned shift=0;shift<70;shift+=7) {
        if (*at>=n || (shift==63 && (b[*at]&0x7e))) return -1;
        uint8_t v=b[(*at)++];
        out|=((uint64_t)(v&127))<<shift;
        if (!(v&128)) { *value=out; return 0; }
    }
    return -1;
}
static int skip(const uint8_t *b,size_t n,size_t *at,unsigned wire,
                const uint8_t **value,size_t *length,uint64_t *number) {
    uint64_t v=0;
    *value=NULL;*length=0;*number=0;
    switch (wire) {
    case 0:
        if (varint(b,n,at,&v)) return -1;
        *number=v;return 0;
    case 1:
        if (n-*at<8) return -1;
        *value=b+*at;*length=8;*at+=8;return 0;
    case 2:
        if (varint(b,n,at,&v)||v>n-*at) return -1;
        *value=b+*at;*length=(size_t)v;*at+=(size_t)v;return 0;
    case 5:
        if (n-*at<4) return -1;
        *value=b+*at;*length=4;*at+=4;return 0;
    default:return -1;
    }
}
static int decode_effect(const uint8_t *b,size_t n,uint16_t *id,uint64_t *cid,uint16_t *slot,uint8_t *type){
    size_t at=0;
    uint64_t effect=0,controller=0,effect_slot=0,effect_type=0;
    int have_id=0,have_cid=0;
    (void)0;
    while(at<n){
        uint64_t key=0,value=0;
        if(varint(b,n,&at,&key))return -1;
        if(!key || (key&7)>5)return -1;
        const uint8_t *bytes=NULL;size_t length=0;
        if(skip(b,n,&at,(unsigned)(key&7),&bytes,&length,&value))return -1;
        if((key>>3)==1 && (key&7)==0){effect=value;have_id=1;}
        if((key>>3)==2 && (key&7)==0)effect_type=value;
        if((key>>3)==3 && (key&7)==0)effect_slot=value;
        if((key>>3)==4 && (key&7)==0){controller=value;have_cid=1;}
    }
    // Protobuf 3 suppresses scalar zero fields. The first native E-0
    // EffectInfo has no field 1, which means default ID 0 (not missing data).
    // Require the controller CID to distinguish a valid catalog item.
    if(!have_cid||effect>=JH2_FACTORY_EFFECTS)return 1;
    if(!have_id)effect=0;
    if(effect_slot>UINT16_MAX || effect_type>UINT8_MAX)return -1;
    *id=(uint16_t)effect;*cid=controller;
    *slot=(uint16_t)effect_slot;*type=(uint8_t)effect_type;return 0;
}
int jh2_effectlist_parse(const uint8_t *ddp,size_t len,jh2_catalog_batch *out){
    if(!ddp||!out||len<20||len>4096)return -1;
    memset(out,0,sizeof(*out));
    if(ddp[0]!=0xf0 && ddp[0]!=0xf1)return -2;
    if(((unsigned)ddp[6]<<8 | ddp[7])!=2904)return -3;
    size_t at=20;
    out->first=UINT16_MAX;
    while(at<len){
        uint64_t tag=0,number=0;
        if(varint(ddp,len,&at,&tag)||!tag)return -4;
        const uint8_t *entry=NULL;size_t n=0;
        if(skip(ddp,len,&at,(unsigned)(tag&7),&entry,&n,&number))return -5;
        if((tag>>3)!=1 || (tag&7)!=2)continue;
        uint16_t id=0,slot=0;uint64_t cid=0;uint8_t type=0;
        int rc=decode_effect(entry,n,&id,&cid,&slot,&type);
        if(rc<0)return -6;
        if(rc>0)continue;
        if(!out->found[id]){
            out->found[id]=1;
            out->values[id]=id;
            out->cid[id]=cid;
            out->slot[id]=slot;
            out->type[id]=type;
            ++out->count;
            if(id<out->first)out->first=id;
            if(id>out->last)out->last=id;
        }
    }
    return out->count?0:-7;
}
