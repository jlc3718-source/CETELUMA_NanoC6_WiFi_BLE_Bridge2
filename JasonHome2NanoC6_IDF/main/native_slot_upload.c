#include "native_slot_upload.h"
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
static size_t varint(uint8_t *out,uint32_t v){
    size_t n=0;
    do{uint8_t c=(uint8_t)(v&127);v>>=7;out[n++]=(uint8_t)(c|(v?128:0));}while(v);
    return n;
}
static size_t field(uint8_t *out,unsigned key,uint32_t v){
    out[0]=(uint8_t)(key<<3);return 1+varint(out+1,v);
}
static void envelope(uint8_t *b,uint8_t id,uint32_t parts,uint32_t left){
    b[0]=id;b[1]=(uint8_t)(parts>>8);b[2]=(uint8_t)parts;
    b[3]=17;b[4]=255;b[5]=(uint8_t)(left>>8);b[6]=(uint8_t)left;b[7]=0;
}
static uint32_t le32(const uint8_t *b){
    return (uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24;
}
/* Validate the complete TinyProgram before staging/transmitting:
 * manufacturer CID in both headers, 4-KiB pages, protobuf data extents,
 * and the CRC8/0x97 over every post-header byte including page padding.
 * This does not assert that SmartDawn supports an eight-image scheduler. */
static bool type3_varint(const uint8_t *data,size_t limit,size_t *pos,uint32_t *value){
    uint32_t out=0;
    for(unsigned shift=0;shift<35;shift+=7){
        if(*pos>=limit)return false;
        const uint8_t b=data[(*pos)++];
        if(shift==28&&(b&0xf0))return false;
        out|=(uint32_t)(b&127)<<shift;
        if(!(b&128)){*value=out;return true;}
    }
    return false;
}
bool jh2_slot_type3_verified(const char *path,size_t size,uint32_t cid){
    if(!path||!cid||size<4096||size>32768||size%4096)return false;
    FILE *f=fopen(path,"rb");
    if(!f)return false;
    bool ok=false;
    do{
        uint8_t h[256];
        if(fread(h,1,sizeof(h),f)!=sizeof(h)||
           memcmp(h,"DN\x01\xfe",4)||le32(h+4)!=cid||h[8]!=size/4096)break;
        size_t p=10;uint32_t header_cid=0,code=0,data=0;
        bool got_cid=false,got_code=false,got_data=false,valid=true;
        while(p<sizeof(h)&&h[p]){
            uint32_t key=0,value=0;
            if(!type3_varint(h,sizeof(h),&p,&key)||!key){valid=false;break;}
            const uint32_t field=key>>3,wire=key&7;
            if(wire==0){
                if(!type3_varint(h,sizeof(h),&p,&value)){valid=false;break;}
                if(field==6){if(got_cid){valid=false;break;}header_cid=value;got_cid=true;}
                if(field==8){if(got_code){valid=false;break;}code=value;got_code=true;}
                if(field==9){if(got_data){valid=false;break;}data=value;got_data=true;}
            }else if(wire==2){
                if(!type3_varint(h,sizeof(h),&p,&value)||value>sizeof(h)-p){valid=false;break;}
                p+=(size_t)value;
            }else {valid=false;break;}
        }
        if(!valid||!got_cid||header_cid!=cid||!got_code||!got_data||
           code<1||code>2048||data<1||data>32768||
           (uint64_t)256+code+data>size)break;
        uint8_t check=0,buffer[512];
        size_t remaining=size-10;
        if(fseek(f,10,SEEK_SET)!=0)break;
        valid=true;
        while(remaining){
            size_t n=remaining<sizeof(buffer)?remaining:sizeof(buffer);
            if(fread(buffer,1,n,f)!=n){valid=false;break;}
            for(size_t i=0;i<n;i++){
                check^=buffer[i];
                for(unsigned j=0;j<8;j++)
                    check=(uint8_t)((check&128)?(check<<1)^0x97:check<<1);
            }
            remaining-=n;
        }
        ok=valid&&check==h[9];
    }while(0);
    fclose(f);
    return ok;
}

bool jh2_slot_transfer(const uint8_t *file,size_t size,uint8_t id,
        uint32_t now,bool known,unsigned matches,uint16_t slot,
        const jh2_slot_io *io,const char **error){
    *error="Invalid native RAM file";
    if(!file||size<4096||size>JH2_NATIVE_RAM_LIMIT||!io||!io->write||!io->reply||!io->pace)return false;
    // Baseline control: original, exactly 4096-byte SmartDawn DN1FE format.
    // No erase, no other CID, no Oracle latency once this RAM transfer begins.
    const bool original_4k=size==4096 && memcmp(file,"DN\x01\xfe",4)==0 &&
                           le32(file+4)==JH2_TEST_CID;
    if(!original_4k){
        if(size<8192 || (memcmp(file,"DNMX",4)&&memcmp(file,"DNCX",4)))return false;
        uint32_t offset=le32(file+128),stride=le32(file+10);
        unsigned frames=(unsigned)file[134]|(unsigned)file[135]<<8;
        if(file[4]!=3||file[5]!=1||file[6]!=40||file[7]||file[8]!=40||file[9]||
           le32(file+14)!=JH2_TEST_CID||offset<4096||offset>size-4096||stride!=4800||
           frames<2||memcmp(file+offset,"DNX2",4)||file[offset+4]!=3||
           le32(file+offset+5)!=stride||le32(file+offset+9)!=frames||
           file[offset+13]!=40||file[offset+14]||file[offset+15]!=40||file[offset+16]||
           (uint64_t)offset+4096+(uint64_t)stride*frames>size)return false;
    }
    uint32_t parts=(uint32_t)((size+499)/500);
    uint8_t header[80],packet[508];size_t n=8;
    envelope(header,id,parts,parts);
    n+=field(header+n,1,id);n+=field(header+n,2,original_4k?3:0);n+=field(header+n,3,(uint32_t)size);
    n+=field(header+n,4,0);n+=field(header+n,5,parts);n+=field(header+n,6,500);
    n+=field(header+n,7,0);
    if(!original_4k){header[n++]=66;header[n++]=9;
        memcpy(header+n,"83928.eff",9);n+=9;}
    n+=field(header+n,9,JH2_TEST_CID);
    header[7]=crc8(header,n);
    jh2_slot_session session={0};
    if(!jh2_slot_validate(&session,JH2_SLOT_UPLOAD_UUID,header,n,now,known,matches,slot,false,error))return false;
    // Validate every generated packet before beginning a controller transaction.
    jh2_slot_session check=session;
    for(uint32_t i=0;i<parts;i++){
        size_t bytes=size-i*500;if(bytes>500)bytes=500;
        envelope(packet,id,parts,parts-i-1);memcpy(packet+8,file+i*500,bytes);
        packet[7]=crc8(packet+8,bytes);
        if(!jh2_slot_validate(&check,JH2_SLOT_UPLOAD_UUID,packet,bytes+8,now,known,matches,slot,false,error))return false;
    }
    *error="Native UploadRequest GATT write failed";
    if(!io->write(io->context,header,n))return false;
    if(!io->reply(io->context,2931,id,parts,error))return false;
    for(uint32_t i=0;i<parts;i++){
        size_t bytes=size-i*500;if(bytes>500)bytes=500;
        envelope(packet,id,parts,parts-i-1);memcpy(packet+8,file+i*500,bytes);
        packet[7]=crc8(packet+8,bytes);
        *error="Native file-data GATT write failed";
        if(!io->write(io->context,packet,bytes+8))return false;
        io->pace(io->context);
    }
    return io->reply(io->context,2934,id,parts,error);
}

/* Manufacturer-assigned CID upload from local verified LittleFS .eff.
 * File is read twice: preflight validates every packet/CRC and CID BEFORE
 * the controller sees UploadRequest, followed by the actual local BLE send.
 * Neither phase requires Oracle to send individual BLE frames. */
bool jh2_slot_transfer_file(const char *path,uint32_t cid,uint8_t id,
        uint32_t now,bool known,unsigned matches,uint16_t slot,
        const jh2_slot_io *io,const char **error){
    *error="Invalid native local effect";
    if(!path||!cid||!io||!io->write||!io->reply||!io->pace||
       !known||matches!=0)return false;
    FILE *f=fopen(path,"rb");
    if(!f)return false;
    bool ok=false;
    do{
        if(fseek(f,0,SEEK_END)!=0)break;
        long length=ftell(f);
        if(length<4096||length>256*1024||fseek(f,0,SEEK_SET)!=0)break;
        const size_t size=(size_t)length;
        uint8_t first[144],item[17];
        if(fread(first,1,sizeof(first),f)!=sizeof(first))break;
        const bool type3=memcmp(first,"DN\x01\xfe",4)==0;
        if(type3){
            if(!jh2_slot_type3_verified(path,size,cid))break;
        }else{
            uint32_t stride=le32(first+10),offset=le32(first+128);
            unsigned frames=(unsigned)first[134]|(unsigned)first[135]<<8;
            if((memcmp(first,"DNMX",4)&&memcmp(first,"DNCX",4))||
               first[4]!=3||first[5]!=1||first[6]!=40||first[7]||
               first[8]!=40||first[9]||stride!=4800||le32(first+14)!=cid||
               offset<4096||offset>size-4096||frames<2||frames>180||
               (uint64_t)offset+4096+(uint64_t)stride*frames>size||
               fseek(f,(long)offset,SEEK_SET)!=0||
               fread(item,1,sizeof(item),f)!=sizeof(item)||
               memcmp(item,"DNX2",4)||item[4]!=3||
               le32(item+5)!=stride||le32(item+9)!=frames||
               item[13]!=40||item[14]||item[15]!=40||item[16])break;
        }
        const uint32_t parts=(uint32_t)((size+499)/500);
        uint8_t header[96]={0},packet[508];
        char filename[20];
        int filename_length=snprintf(filename,sizeof(filename),"%lu.eff",(unsigned long)cid);
        if(filename_length<5||filename_length>14)break;
        envelope(header,id,parts,parts);
        size_t n=8;
        n+=field(header+n,1,id);n+=field(header+n,2,type3?3:0);
        n+=field(header+n,3,(uint32_t)size);n+=field(header+n,4,0);
        n+=field(header+n,5,parts);n+=field(header+n,6,500);
        n+=field(header+n,7,0);
        if(!type3){
            header[n++]=66;header[n++]=(uint8_t)filename_length;
            memcpy(header+n,filename,(size_t)filename_length);n+=(size_t)filename_length;
        }
        n+=field(header+n,9,cid);
        header[7]=crc8(header,n);
        jh2_slot_session initial={0};
        if(!jh2_slot_validate(&initial,JH2_SLOT_UPLOAD_UUID,header,n,
                now,known,matches,slot,false,error))break;
        // Validate every packet in storage before starting BLE transaction.
        jh2_slot_session check=initial;
        if(fseek(f,0,SEEK_SET)!=0)break;
        bool valid=true;
        for(uint32_t i=0;i<parts;i++){
            size_t bytes=size-(size_t)i*500;if(bytes>500)bytes=500;
            envelope(packet,id,parts,parts-i-1);
            if(fread(packet+8,1,bytes,f)!=bytes){valid=false;break;}
            packet[7]=crc8(packet+8,bytes);
            if(!jh2_slot_validate(&check,JH2_SLOT_UPLOAD_UUID,packet,bytes+8,
                    now,known,matches,slot,false,error)){valid=false;break;}
        }
        if(!valid||fseek(f,0,SEEK_SET)!=0)break;
        *error="SmartDawn UploadRequest BLE send failed";
        if(!io->write(io->context,header,n))break;
        if(!io->reply(io->context,2931,id,parts,error))break;
        *error="Local native BLE data send failed";
        valid=true;
        for(uint32_t i=0;i<parts;i++){
            size_t bytes=size-(size_t)i*500;if(bytes>500)bytes=500;
            envelope(packet,id,parts,parts-i-1);
            if(fread(packet+8,1,bytes,f)!=bytes){valid=false;break;}
            packet[7]=crc8(packet+8,bytes);
            if(!io->write(io->context,packet,bytes+8)){valid=false;break;}
            io->pace(io->context);
            // Every tenth 500-byte packet: wait until real controller 2933
            // progress confirms all but its known 3-packet reporting lag.
            // Do not confuse local GATT queueing with SmartDawn flash writes.
            const uint32_t sent=i+1;
            if(sent%10==0 && sent<parts){
                *error="SmartDawn did not acknowledge the previous native packet window";
                if(!io->progress||!io->progress(io->context,parts,sent-3,error)){
                    valid=false;break;
                }
            }
        }
        if(!valid)break;
        *error="SmartDawn final 2934 upload verification failed";
        if(!io->reply(io->context,2934,id,parts,error))break;
        *error=NULL;ok=true;
    }while(0);
    fclose(f);
    return ok;
}
