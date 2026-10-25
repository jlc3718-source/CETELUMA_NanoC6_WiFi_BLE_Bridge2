#include "../main/native_slot_guard.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t buf[508];static size_t n;
static void vint(uint32_t v){do{uint8_t c=v&127;v>>=7;buf[n++]=(uint8_t)(c|(v?128:0));}while(v);}
static void field(unsigned f,uint32_t v){vint(f<<3);vint(v);}
static uint8_t crc(const uint8_t *b,size_t z){uint8_t c=0;for(size_t i=0;i<z;i++){c^=b[i];for(unsigned j=0;j<8;j++)c=(uint8_t)((c&128)?(c<<1)^0x97:c<<1);}return c;}
static void put32(uint8_t *p,uint32_t v){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(v>>(8*i));}
static void header(unsigned type,unsigned size,unsigned cid){
 memset(buf,0,sizeof(buf));unsigned parts=(size+499)/500;
 buf[0]=17;buf[1]=parts>>8;buf[2]=parts&255;buf[3]=17;buf[4]=255;buf[5]=parts>>8;buf[6]=parts&255;n=8;
 field(1,17);field(2,type);field(3,size);field(4,0);field(5,parts);field(6,500);field(7,0);
 if(type==0){char name[20];int len=snprintf(name,sizeof(name),"%u.eff",cid);
  assert(len>0&&len<20);vint(66);vint((uint32_t)len);memcpy(buf+n,name,len);n+=(size_t)len;}
 field(9,cid);buf[7]=crc(buf,n);
}
static void command(unsigned op,unsigned cid,unsigned slot){
 memset(buf,0,sizeof(buf));buf[0]=23;buf[1]=1;buf[4]=240;buf[5]=4;buf[10]=op>>8;buf[11]=op&255;n=24;
 if(cid){field(1,cid);if(op==2606)field(2,slot);}
}
static void part(unsigned index,unsigned size,unsigned type,unsigned cid){
 memset(buf,0,sizeof(buf));unsigned parts=(size+499)/500,left=parts-index-1;
 buf[0]=17;buf[1]=parts>>8;buf[2]=parts&255;buf[3]=17;buf[4]=255;buf[5]=left>>8;buf[6]=left&255;
 unsigned bytes=size-index*500;if(bytes>500)bytes=500;n=8+bytes;
 if(index==0){
  if(type==3){memcpy(buf+8,"DN\x01\xfe",4);put32(buf+12,cid);}
  else{memcpy(buf+8,"DNMX",4);buf[12]=3;buf[13]=1;buf[14]=40;buf[16]=40;put32(buf+22,cid);}
 }
 buf[7]=crc(buf+8,bytes);
}
int main(void){
 const char *error=NULL;jh2_slot_session state={0},copy;
 for(unsigned i=0;i<3;i++){
  command((unsigned[]){205,167,2904}[i],0,0);
  assert(jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,false,0,0,true,&error));
 }
 command(2909,83928,0);
 assert(!jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,false,1,32,false,&error));
 assert(!jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,2,32,false,&error));
 assert(!jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,1,32,true,&error));
 assert(jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,1,32,false,&error));
 command(2909,84268,0);
 assert(!jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,0,32,false,&error));
 assert(jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,1,32,false,&error));
 command(2606,83928,33);
 assert(!jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,1,32,false,&error));
 assert(jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,1,true,1,33,false,&error));
 header(3,4096,83928);
 assert(!jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,1,false,0,0,false,&error));
 assert(!jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,1,true,1,32,false,&error));
 assert(jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,1,true,0,0,false,&error));
 copy=state;part(1,4096,3,83928);
 assert(!jh2_slot_validate(&copy,JH2_SLOT_UPLOAD_UUID,buf,n,2,false,0,0,false,&error));
 part(0,4096,3,83928);buf[20]^=1;
 assert(!jh2_slot_validate(&copy,JH2_SLOT_UPLOAD_UUID,buf,n,2,false,0,0,false,&error));
 part(0,4096,3,83928);copy=state;
 assert(!jh2_slot_validate(&copy,JH2_SLOT_UPLOAD_UUID,buf,n,180002,false,0,0,false,&error));
 for(unsigned i=0;i<9;i++){
  part(i,4096,3,83928);
  assert(jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,3+i,false,0,0,false,&error));
 }
 assert(!state.active&&state.next==9);
 assert(!jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,20,false,0,0,false,&error));
 header(0,20480,83928);assert(jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,30,true,0,0,false,&error));
 part(0,20480,0,83928);copy=state;buf[22]^=1;buf[7]=crc(buf+8,n-8);
 assert(!jh2_slot_validate(&copy,JH2_SLOT_UPLOAD_UUID,buf,n,31,false,0,0,false,&error));
 part(0,20480,0,83928);assert(jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,31,false,0,0,false,&error));
 assert(state.next==1);
 // Manufacturer-assigned ID must be coherent in UploadRequest path and file header.
 const uint32_t assigned=945321U;
 header(0,20480,assigned);
 assert(jh2_slot_packet_cid(&state,JH2_SLOT_UPLOAD_UUID,buf,n)==assigned);
 assert(jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,40,true,0,0,false,&error));
 part(0,20480,0,83928);
 copy=state;
 assert(!jh2_slot_validate(&copy,JH2_SLOT_UPLOAD_UUID,buf,n,41,false,0,0,false,&error));
 part(0,20480,0,assigned);
 assert(jh2_slot_packet_cid(&state,JH2_SLOT_UPLOAD_UUID,buf,n)==assigned);
 assert(jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,41,false,0,0,false,&error));
 command(2909,assigned,0);
 assert(jh2_slot_packet_cid(&state,JH2_SLOT_COMMAND_UUID,buf,n)==assigned);
 assert(!jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,43,true,2,0,false,&error));
 assert(jh2_slot_validate(&state,JH2_SLOT_COMMAND_UUID,buf,n,43,true,1,12,false,&error));
 header(0,20480,assigned);
 buf[30]^=1;buf[7]=0;buf[7]=crc(buf,n);
 assert(!jh2_slot_validate(&state,JH2_SLOT_UPLOAD_UUID,buf,n,44,true,0,0,false,&error));
 puts("NATIVE_SLOT_GUARD_PASS reads assigned_CID file_header upload_filename CRC sequence timeout type0 type3 replay factory_protection");
}
