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
    packet[41]^=1;assert(eufy_e10_notification(&s,packet,sizeof(packet))==-1);
    eufy_e10_clear(&s);assert(!s.session_valid);
    puts("E10 framing, AES session, power/brightness/color, checksum tests PASS");
}