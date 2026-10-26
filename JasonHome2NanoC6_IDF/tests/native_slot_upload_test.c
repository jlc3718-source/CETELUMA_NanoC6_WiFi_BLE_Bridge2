#include "../main/native_slot_upload.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct {unsigned writes,pauses,replies,expected_parts;bool reject_start,reject_end,fail_data,fail_progress;unsigned progresses;jh2_slot_session session;} fixture;
static bool write_packet(void *ctx,const uint8_t *bytes,size_t len){
    fixture *f=ctx;const char *error=NULL;
    assert(jh2_slot_validate(&f->session,JH2_SLOT_UPLOAD_UUID,bytes,len,100,true,0,0,false,&error));
    ++f->writes;return !(f->fail_data&&f->writes==3);
}
static bool reply(void *ctx,uint16_t op,uint8_t id,uint32_t parts,const char **error){
    fixture *f=ctx;assert(id==123&&parts==f->expected_parts);++f->replies;
    if(op==2931){assert(f->writes==1);if(f->reject_start){*error="start rejected";return false;}}
    else {assert(op==2934&&f->writes==f->expected_parts+1&&f->pauses==f->expected_parts);if(f->reject_end){*error="end rejected";return false;}}
    return true;
}
static void pace(void *ctx){++((fixture*)ctx)->pauses;}
static bool progress(void *ctx,uint32_t parts,uint32_t minimum,const char **error){
    fixture *f=ctx;assert(parts==f->expected_parts&&minimum<=f->pauses);
    ++f->progresses;
    if(f->fail_progress){*error="Progress window rejected";return false;}
    return true;
}
static uint8_t crc8_data(const uint8_t *b,size_t n){
    uint8_t crc=0;
    for(size_t i=0;i<n;i++){
        crc^=b[i];
        for(unsigned j=0;j<8;j++)crc=(uint8_t)((crc&128)?(crc<<1)^0x97:crc<<1);
    }
    return crc;
}
static size_t vnum(uint8_t *b,size_t pos,uint32_t x){
    do{uint8_t v=(uint8_t)(x&127);x>>=7;b[pos++]=(uint8_t)(v|(x?128:0));}while(x);
    return pos;
}
static size_t pfield(uint8_t *b,size_t pos,unsigned field,uint32_t val){
    pos=vnum(b,pos,field<<3);return vnum(b,pos,val);
}
static void save_file(const char *path,const uint8_t *bytes,size_t len){
    FILE *f=fopen(path,"wb");assert(f);
    assert(fwrite(bytes,1,len,f)==len);assert(fclose(f)==0);
}
static void le32(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static bool transfer(uint8_t *data,fixture *f,bool known,unsigned matches){
    const char *error=NULL;jh2_slot_io io={.context=f,.write=write_packet,.reply=reply,.pace=pace,.progress=progress};
    return jh2_slot_transfer(data,28672,123,100,known,matches,0,&io,&error);
}
int main(void){
    uint8_t *file=calloc(1,28672);assert(file);
    memcpy(file,"DNMX",4);file[4]=3;file[5]=1;file[6]=file[8]=40;
    le32(file+10,4800);le32(file+14,83928);le32(file+128,4096);file[134]=4;
    memcpy(file+4096,"DNX2",4);file[4100]=3;le32(file+4101,4800);le32(file+4105,4);file[4109]=file[4111]=40;
    fixture f={.expected_parts=58};assert(transfer(file,&f,true,0));assert(f.writes==59&&f.replies==2);
    f=(fixture){.expected_parts=58};assert(!transfer(file,&f,false,0)&&f.writes==0);
    f=(fixture){.expected_parts=58};assert(!transfer(file,&f,true,1)&&f.writes==0);
    f=(fixture){.expected_parts=58,.reject_start=true};assert(!transfer(file,&f,true,0)&&f.writes==1);
    f=(fixture){.expected_parts=58,.reject_end=true};assert(!transfer(file,&f,true,0)&&f.writes==59);
    f=(fixture){.expected_parts=58,.fail_data=true};assert(!transfer(file,&f,true,0)&&f.writes==3&&f.replies==1);
    file[14]^=1;f=(fixture){.expected_parts=58};assert(!transfer(file,&f,true,0)&&f.writes==0);
    file[14]^=1;file[4105]=99;assert(!transfer(file,&f,true,0)&&f.writes==0);
    // Golden original 4 KB DN1FE SmartDawn baseline: 9 packets in one
    // contiguous native-RAM transaction, no host-to-Oracle round trips.
    uint8_t original[4096]={0};
    original[0]='D';original[1]='N';original[2]=1;original[3]=0xfe;
    le32(original+4,83928);original[8]=1;
    const char *control_error=NULL;
    fixture legacy={.expected_parts=9};
    jh2_slot_io legacy_io={.context=&legacy,.write=write_packet,.reply=reply,.pace=pace,.progress=progress};
    assert(jh2_slot_transfer(original,sizeof(original),123,100,true,0,0,&legacy_io,&control_error));
    assert(legacy.writes==10&&legacy.replies==2&&legacy.pauses==9);
    original[4]^=1;
    legacy=(fixture){.expected_parts=9};
    assert(!jh2_slot_transfer(original,sizeof(original),123,100,true,0,0,&legacy_io,&control_error));
    assert(legacy.writes==0);
    original[4]^=1;
    legacy=(fixture){.expected_parts=9};
    assert(!jh2_slot_transfer(original,sizeof(original),123,100,true,1,0,&legacy_io,&control_error));
    assert(legacy.writes==0);
    legacy=(fixture){.expected_parts=9,.reject_end=true};
    assert(!jh2_slot_transfer(original,sizeof(original),123,100,true,0,0,&legacy_io,&control_error));
    assert(legacy.writes==10);

    // The 8192-byte candidate requires complete local file validation,
    // per-packet BLE acknowledgement, one progress window, and fresh empty CID.
    const char *name="/tmp/jh2-native-type3-8192-unit-test.bin";
    uint8_t candidate[8192]={0};
    memcpy(candidate,"DN\x01\xfe",4);le32(candidate+4,85391);candidate[8]=2;
    size_t p=10;p=pfield(candidate,p,6,85391);p=pfield(candidate,p,8,180);
    p=pfield(candidate,p,9,7266);
    assert(p<256);
    candidate[9]=crc8_data(candidate+10,sizeof(candidate)-10);
    save_file(name,candidate,sizeof(candidate));
    assert(jh2_slot_type3_verified(name,sizeof(candidate),85391));
    assert(!jh2_slot_type3_verified(name,sizeof(candidate),85392));
    fixture candidate_case={.expected_parts=17};
    jh2_slot_io candidate_io={.context=&candidate_case,.write=write_packet,
                             .reply=reply,.pace=pace,.progress=progress};
    const char *candidate_error=NULL;
    assert(jh2_slot_transfer_file(name,85391,123,100,true,0,0,&candidate_io,&candidate_error));
    assert(candidate_case.writes==18&&candidate_case.pauses==17&&
           candidate_case.replies==2&&candidate_case.progresses==1);
    candidate_case=(fixture){.expected_parts=17};
    assert(!jh2_slot_transfer_file(name,85391,123,100,true,1,0,&candidate_io,&candidate_error));
    assert(candidate_case.writes==0);
    candidate_case=(fixture){.expected_parts=17,.fail_progress=true};
    assert(!jh2_slot_transfer_file(name,85391,123,100,true,0,0,&candidate_io,&candidate_error));
    assert(candidate_case.writes==11&&candidate_case.replies==1&&candidate_case.progresses==1);
    candidate_case=(fixture){.expected_parts=17,.reject_end=true};
    assert(!jh2_slot_transfer_file(name,85391,123,100,true,0,0,&candidate_io,&candidate_error));
    assert(candidate_case.writes==18&&candidate_case.replies==2);
    candidate[20]^=1;save_file(name,candidate,sizeof(candidate));
    assert(!jh2_slot_type3_verified(name,sizeof(candidate),85391));
    candidate_case=(fixture){.expected_parts=17};
    assert(!jh2_slot_transfer_file(name,85391,123,100,true,0,0,&candidate_io,&candidate_error));
    assert(candidate_case.writes==0);
    candidate[20]^=1;candidate[8]=1;
    candidate[9]=crc8_data(candidate+10,sizeof(candidate)-10);
    save_file(name,candidate,sizeof(candidate));
    assert(!jh2_slot_type3_verified(name,sizeof(candidate),85391));
    assert(remove(name)==0);
    free(file);puts("NATIVE_RAM_UPLOAD_TESTS_PASSED");return 0;
}
