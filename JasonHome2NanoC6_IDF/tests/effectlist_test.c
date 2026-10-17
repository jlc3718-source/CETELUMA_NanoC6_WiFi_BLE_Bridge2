#include "../main/effectlist.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t packet[4096];
static size_t len;
static void varint(unsigned v){
    do{
        uint8_t b=(uint8_t)(v&127);
        v>>=7;
        packet[len++]=(uint8_t)(b|(v?128:0));
    }while(v);
}
static size_t effect_body(unsigned id,uint8_t *out){
    // EffectInfo: 1=id, 3=slot, 4=CID (valid 0 values count as present).
    size_t begin=len;
    varint(8);varint(id);
    varint(24);varint(id%55);
    varint(32);varint(15924);
    size_t n=len-begin;
    memcpy(out,packet+begin,n);
    len=begin;
    return n;
}
static void begin(void){
    memset(packet,0,sizeof(packet));
    packet[0]=0xf0;
    packet[6]=2904>>8;
    packet[7]=2904&255;
    len=20;
}
static void append(unsigned id){
    uint8_t raw[32];size_t n=effect_body(id,raw);
    varint(10);varint((unsigned)n);
    memcpy(packet+len,raw,n);len+=n;
}
int main(void){
    jh2_catalog_batch found;
    for(unsigned first=0;first<88;first+=20){
        begin();
        unsigned last=first+20;if(last>88)last=88;
        for(unsigned id=first;id<last;id++)append(id);
        assert(jh2_effectlist_parse(packet,len,&found)==0);
        assert(found.count==(size_t)(last-first));
        assert(found.first==first);
        assert(found.last==last-1);
        for(unsigned id=first;id<last;id++)assert(found.found[id]);
    }
    begin();append(0);append(0);append(87);
    assert(jh2_effectlist_parse(packet,len,&found)==0);
    assert(found.count==2&&found.found[0]&&found.found[87]);
    packet[6]=0xff;
    assert(jh2_effectlist_parse(packet,len,&found)<0);
    assert(jh2_effectlist_parse(NULL,len,&found)<0);
    puts("READ_ONLY_2904_PARSER_TESTS_PASS 88_effects 5_groups duplicates zero_id invalid_packet");
    return 0;
}
