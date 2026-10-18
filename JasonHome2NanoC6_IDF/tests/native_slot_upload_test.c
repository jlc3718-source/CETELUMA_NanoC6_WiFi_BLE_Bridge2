#include "../main/native_slot_upload.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef struct {unsigned writes,pauses,replies;bool reject_start,reject_end,fail_data;jh2_slot_session session;} fixture;
static bool write_packet(void *ctx,const uint8_t *bytes,size_t len){
    fixture *f=ctx;const char *error=NULL;
    assert(jh2_slot_validate(&f->session,JH2_SLOT_UPLOAD_UUID,bytes,len,100,true,0,0,false,&error));
    ++f->writes;return !(f->fail_data&&f->writes==3);
}
static bool reply(void *ctx,uint16_t op,uint8_t id,uint32_t parts,const char **error){
    fixture *f=ctx;assert(id==123&&parts==58);++f->replies;
    if(op==2931){assert(f->writes==1);if(f->reject_start){*error="start rejected";return false;}}
    else {assert(op==2934&&f->writes==59&&f->pauses==58);if(f->reject_end){*error="end rejected";return false;}}
    return true;
}
static void pace(void *ctx){++((fixture*)ctx)->pauses;}
static void le32(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static bool transfer(uint8_t *data,fixture *f,bool known,unsigned matches){
    const char *error=NULL;jh2_slot_io io={f,write_packet,reply,pace};
    return jh2_slot_transfer(data,28672,123,100,known,matches,0,&io,&error);
}
int main(void){
    uint8_t *file=calloc(1,28672);assert(file);
    memcpy(file,"DNMX",4);file[4]=3;file[5]=1;file[6]=file[8]=40;
    le32(file+10,4800);le32(file+14,83928);le32(file+128,4096);file[134]=4;
    memcpy(file+4096,"DNX2",4);file[4100]=3;le32(file+4101,4800);le32(file+4105,4);file[4109]=file[4111]=40;
    fixture f={0};assert(transfer(file,&f,true,0));assert(f.writes==59&&f.replies==2);
    f=(fixture){0};assert(!transfer(file,&f,false,0)&&f.writes==0);
    f=(fixture){0};assert(!transfer(file,&f,true,1)&&f.writes==0);
    f=(fixture){.reject_start=true};assert(!transfer(file,&f,true,0)&&f.writes==1);
    f=(fixture){.reject_end=true};assert(!transfer(file,&f,true,0)&&f.writes==59);
    f=(fixture){.fail_data=true};assert(!transfer(file,&f,true,0)&&f.writes==3&&f.replies==1);
    file[14]^=1;f=(fixture){0};assert(!transfer(file,&f,true,0)&&f.writes==0);
    file[14]^=1;file[4105]=99;assert(!transfer(file,&f,true,0)&&f.writes==0);
    free(file);puts("NATIVE_RAM_UPLOAD_TESTS_PASSED");return 0;
}
