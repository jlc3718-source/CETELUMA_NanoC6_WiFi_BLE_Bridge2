#include "eufy_e10.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <openssl/evp.h>
static uint8_t xorsum(const uint8_t *b,size_t n){uint8_t x=0;for(size_t i=0;i<n;i++)x^=b[i];return x;}
static void encrypt(const uint8_t *key,const uint8_t *iv,const uint8_t *plain,size_t len,uint8_t *out){
    EVP_CIPHER_CTX *c=EVP_CIPHER_CTX_new();int n=0,m=0;
    assert(EVP_EncryptInit_ex(c,EVP_aes_128_cbc(),NULL,key,iv)==1);
    assert(EVP_CIPHER_CTX_set_padding(c,0)==1);
    assert(EVP_EncryptUpdate(c,out,&n,plain,(int)len)==1);
    assert(EVP_EncryptFinal_ex(c,out+n,&m)==1);
    assert((size_t)(n+m)==len);EVP_CIPHER_CTX_free(c);
}
int main(void){
    const char *serial="T8L006102353014B",*user="0123456789012345678901234567890123456789";
    eufy_e10_t s;assert(eufy_e10_init(&s,serial,user));
    uint8_t f[EUFY_E10_FRAME_MAX];const uint16_t cmd[]={1,0x29,3,5,0x4022};
    for(int i=0;i<5;i++){
        int n=eufy_e10_handshake(&s,i,0x12345678,f,sizeof(f));assert(n>0);
        assert(f[0]==0xff && f[1]==9 && f[2]==n && f[3]==0 && f[6]==1 && xorsum(f,n)==0);
        assert(((uint16_t)f[7]<<8|f[8])==cmd[i]);
        assert(f[4]==i+1);
        if(i==0){assert(n==58);assert(f[9]==0xA1&&f[10]==4&&f[11]==0x78&&f[12]==0x56&&f[13]==0x34&&f[14]==0x12&&f[15]==0xA2&&f[16]==40);}
        if(i==4)assert(n==74);
    }
    uint8_t raw[32],cipher[32],packet[42];memset(raw,14,sizeof(raw));raw[0]=0xA1;raw[1]=0x10;
    for(int i=0;i<16;i++)raw[2+i]=(uint8_t)(i+0x30);
    encrypt((const uint8_t*)user,(const uint8_t*)serial,raw,sizeof(raw),cipher);
    packet[0]=0xff;packet[1]=9;packet[2]=sizeof(packet);packet[3]=0;packet[4]=99;packet[5]=0;
    packet[6]=1;packet[7]=0x48;packet[8]=0x22;memcpy(packet+9,cipher,32);
    packet[41]=xorsum(packet,41);
    assert(eufy_e10_notification(&s,packet,sizeof(packet))==1 && s.session_valid);
    int n=eufy_e10_power(&s,0x12345678,true,f,sizeof(f));
    assert(n==74&&f[6]==2&&f[7]==0x42&&f[8]==1&&xorsum(f,n)==0);
    n=eufy_e10_brightness(&s,0x12345678,150,f,sizeof(f));
    assert(n==74&&xorsum(f,n)==0);
    n=eufy_e10_color(&s,0x12345678,false,0xff,0x22,0x11,60,f,sizeof(f));
    assert(n>100&&n<247&&f[7]==0x42&&f[8]==6&&xorsum(f,n)==0);
    n=eufy_e10_color(&s,0x12345678,true,1,2,3,60,f,sizeof(f));
    assert(n>100&&n<247&&f[7]==0x42&&f[8]==6&&xorsum(f,n)==0);

    /* Authenticated state query and real device-reply parsing, no contact
     * with physical lights in this deterministic host-side fixture. */
    n=eufy_e10_read_status(&s,0x12345678,f,sizeof(f));
    assert(n>60&&f[7]==0x42&&f[8]==0x00&&xorsum(f,n)==0);
    const uint8_t state_payload[]={0,
        0xa1,1,1, 0xa2,1,55, 0xa3,2,20,0,
        0xa4,2,0x26,0x4e, 0xa6,4,0x88,0x27,0,0, 0xa8,1,2};
    size_t plen=sizeof(state_payload),block=((plen/16)+1)*16;
    uint8_t plain[64]={0},coded[64]={0},reply[74]={0};
    memcpy(plain,state_payload,plen);
    memset(plain+plen,(int)(block-plen),block-plen);
    encrypt(s.session_key,s.serial_iv,plain,block,coded);
    size_t reply_n=block+10;
    reply[0]=0xff;reply[1]=9;reply[2]=(uint8_t)reply_n;
    reply[3]=(uint8_t)(reply_n>>8);reply[4]=10;reply[6]=2;
    reply[7]=0x4a;reply[8]=0x00;
    memcpy(reply+9,coded,block);reply[reply_n-1]=xorsum(reply,reply_n-1);
    assert(eufy_e10_notification(&s,reply,reply_n)==4);
    assert(s.state_valid&&s.state_has_segments&&s.state_segments==20);
    assert(s.state_has_power&&s.state_power);
    assert(s.state_has_brightness&&s.state_brightness==55);
    assert(s.state_has_effect&&s.state_effect_id==20006);
    assert(s.state_has_cloud_effect&&s.state_cloud_effect_id==10120);
    uint8_t preset_tail[24]={0xa3,4,0x88,0x27,0,0,0xa4,1,40,0xa5,1,1,
      0xa6,1,0,0xa8,1,0,0xa9,4,1,2,3,4};
    n=eufy_e10_preset(&s,0x12345678,preset_tail,sizeof(preset_tail),f,sizeof(f));
    assert(n>60&&f[7]==0x42&&f[8]==0x0d&&xorsum(f,n)==0);
    n=eufy_e10_dynamic(&s,0x12345678,true,20000,5,255,0,0,20,f,sizeof(f));
    assert(n>60&&f[7]==0x42&&f[8]==0x06&&xorsum(f,n)==0);
    const uint8_t rejected[]={1};
    plen=sizeof(rejected);block=16;
    memset(plain,0,sizeof(plain));plain[0]=1;memset(plain+1,15,15);
    encrypt(s.session_key,s.serial_iv,plain,16,coded);
    reply_n=26;memset(reply,0,sizeof(reply));
    reply[0]=0xff;reply[1]=9;reply[2]=(uint8_t)reply_n;reply[4]=11;
    reply[6]=2;reply[7]=0x4a;reply[8]=0x0d;
    memcpy(reply+9,coded,16);reply[reply_n-1]=xorsum(reply,reply_n-1);
    assert(eufy_e10_notification(&s,reply,reply_n)==2);
    assert(s.last_ack_opcode==0x0a0d&&s.last_ack_result==1);
    (void)rejected;
    packet[41]^=1;assert(eufy_e10_notification(&s,packet,sizeof(packet))==-1);
    eufy_e10_clear(&s);assert(!s.session_valid);
    puts("E10/E22 session, encrypted state query, real 020D ACK and dynamic RGBWW checksum tests PASS");
}