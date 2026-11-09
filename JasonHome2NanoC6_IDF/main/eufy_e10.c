#include "eufy_e10.h"
#include <string.h>
#ifdef EUFY_E10_HOST_TEST
#include <openssl/evp.h>
#else
#include "mbedtls/aes.h"
#endif
static void wipe(void *ptr, size_t len) {
    volatile uint8_t *p=(volatile uint8_t*)ptr;
    while(len--) *p++=0;
}
static bool safe_ascii(const char *s, size_t len) {
    if(!s || strnlen(s,len+1)!=len) return false;
    for(size_t i=0;i<len;i++) if((unsigned char)s[i]<33 || (unsigned char)s[i]>126) return false;
    return true;
}
static int aes_cbc(bool encrypt,const uint8_t key[16],const uint8_t iv[16],
                   const uint8_t *in,size_t len,uint8_t *out) {
    if(!len || (len&15)) return -1;
#ifdef EUFY_E10_HOST_TEST
    EVP_CIPHER_CTX *c=EVP_CIPHER_CTX_new();if(!c)return -1;
    int n=0,done=0;
    bool ok=EVP_CipherInit_ex(c,EVP_aes_128_cbc(),NULL,key,iv,encrypt?1:0)==1&&
            EVP_CIPHER_CTX_set_padding(c,0)==1&&
            EVP_CipherUpdate(c,out,&n,in,(int)len)==1&&
            EVP_CipherFinal_ex(c,out+n,&done)==1&&((size_t)(n+done))==len;
    EVP_CIPHER_CTX_free(c); return ok?0:-1;
#else
    mbedtls_aes_context aes;uint8_t tmp_iv[16];memcpy(tmp_iv,iv,16);
    mbedtls_aes_init(&aes);
    int rc=encrypt?mbedtls_aes_setkey_enc(&aes,key,128):mbedtls_aes_setkey_dec(&aes,key,128);
    if(!rc)rc=mbedtls_aes_crypt_cbc(&aes,encrypt?MBEDTLS_AES_ENCRYPT:MBEDTLS_AES_DECRYPT,
                                    len,tmp_iv,in,out);
    mbedtls_aes_free(&aes);wipe(tmp_iv,sizeof(tmp_iv));return rc? -1:0;
#endif
}
static size_t base(const eufy_e10_t *ctx,uint32_t seconds,uint8_t *out){
    out[0]=0xA1;out[1]=4;
    for(int i=0;i<4;i++)out[2+i]=(uint8_t)(seconds>>(8*i));
    out[6]=0xA2;out[7]=40;memcpy(out+8,ctx->account_id,40);return 48;
}
static int frame(eufy_e10_t *ctx,uint16_t opcode,uint8_t channel,
                 const uint8_t *payload,size_t length,uint8_t *out,size_t cap){
    if(!ctx || !out || !payload || length+10>cap || length+10>EUFY_E10_FRAME_MAX)return -1;
    size_t total=length+10;
    out[0]=0xff;out[1]=9;out[2]=(uint8_t)total;out[3]=(uint8_t)(total>>8);
    uint16_t seq=ctx->sequence++;
    out[4]=(uint8_t)seq;out[5]=(uint8_t)(seq>>8);out[6]=channel;
    out[7]=(uint8_t)(opcode>>8);out[8]=(uint8_t)opcode;
    memcpy(out+9,payload,length);
    uint8_t check=0;for(size_t i=0;i<total-1;i++)check^=out[i];out[total-1]=check;
    return (int)total;
}
static int encrypt_frame(eufy_e10_t *ctx,uint16_t opcode,uint8_t channel,
                         const uint8_t *plain,size_t n,const uint8_t key[16],
                         uint8_t *out,size_t cap){
    uint8_t padded[EUFY_E10_FRAME_MAX],cipher[EUFY_E10_FRAME_MAX];
    size_t pad=16-(n&15),size=n+pad;
    if(size>sizeof(padded))return -1;
    memcpy(padded,plain,n);memset(padded+n,(int)pad,pad);
    int rc=aes_cbc(true,key,ctx->serial_iv,padded,size,cipher);
    int answer=rc==0?frame(ctx,opcode,channel,cipher,size,out,cap):-1;
    wipe(padded,sizeof(padded));wipe(cipher,sizeof(cipher));return answer;
}
bool eufy_e10_init(eufy_e10_t *ctx,const char *serial,const char *account){
    if(!ctx || !safe_ascii(serial,16) || !safe_ascii(account,40))return false;
    memset(ctx,0,sizeof(*ctx));memcpy(ctx->serial_iv,serial,16);
    memcpy(ctx->account_id,account,40);memcpy(ctx->initial_key,account,16);
    ctx->sequence=1;return true;
}
void eufy_e10_clear(eufy_e10_t *ctx){if(ctx)wipe(ctx,sizeof(*ctx));}
int eufy_e10_handshake(eufy_e10_t *ctx,int step,uint32_t seconds,uint8_t *out,size_t cap){
    if(!ctx || step<0 || step>4)return -1;
    static const uint16_t codes[]={0x0001,0x0029,0x0003,0x0005,0x4022};
    uint8_t payload[64];size_t n=base(ctx,seconds,payload);
    static const uint8_t setup[]={0xA3,1,0x20,0xA4,2,0x96,0};
    static const uint8_t last[]={0xA3,4,0xE0,0xE3,0xFF,0xFF};
    if(step==2 || step==3){memcpy(payload+n,setup,sizeof(setup));n+=sizeof(setup);}
    if(step==4){memcpy(payload+n,last,sizeof(last));n+=sizeof(last);}
    int rc=step==4?encrypt_frame(ctx,codes[step],1,payload,n,ctx->initial_key,out,cap):
                   frame(ctx,codes[step],1,payload,n,out,cap);
    wipe(payload,sizeof(payload));return rc;
}
int eufy_e10_notification(eufy_e10_t *ctx,const uint8_t *in,size_t len){
    if(!ctx || !in || len<10 || len>EUFY_E10_FRAME_MAX || in[0]!=0xff || in[1]!=9 ||
       ((size_t)in[2]|((size_t)in[3]<<8))!=len)return -1;
    uint8_t xor=0;for(size_t i=0;i<len;i++)xor^=in[i];if(xor)return -1;
    uint16_t command=(uint16_t)((in[7]<<8)|in[8]);
    if(command==0x0801 || command==0x0829 || command==0x0803 || command==0x0805)return 0;
    if(command!=0x4822 || !((len-10)>0 && !((len-10)&15)))return -1;
    uint8_t plain[EUFY_E10_FRAME_MAX];size_t n=len-10;
    int rc=aes_cbc(false,ctx->initial_key,ctx->serial_iv,in+9,n,plain);
    if(rc){wipe(plain,sizeof(plain));return -1;}
    uint8_t pad=plain[n-1];if(pad<1||pad>16||pad>n){wipe(plain,sizeof(plain));return -1;}
    for(size_t i=n-pad;i<n;i++)if(plain[i]!=pad){wipe(plain,sizeof(plain));return -1;}
    int result=-1;
    for(size_t i=0;i+18<=n-pad;i++)if(plain[i]==0xA1&&plain[i+1]==0x10){
        memcpy(ctx->session_key,plain+i+2,16);ctx->session_valid=true;result=1;break;
    }
    wipe(plain,sizeof(plain));return result;
}
static int command(eufy_e10_t *ctx,uint32_t seconds,uint16_t opcode,
                   const uint8_t *params,size_t count,uint8_t *out,size_t cap){
    if(!ctx || !ctx->session_valid || count>210)return -1;
    uint8_t plain[EUFY_E10_FRAME_MAX];size_t n=base(ctx,seconds,plain);
    memcpy(plain+n,params,count);n+=count;
    int rc=encrypt_frame(ctx,opcode|0x4000,2,plain,n,ctx->session_key,out,cap);
    wipe(plain,sizeof(plain));return rc;
}
int eufy_e10_power(eufy_e10_t *ctx,uint32_t seconds,bool on,uint8_t *out,size_t cap){
    uint8_t p[]={0xA3,1,(uint8_t)(on?1:0)};
    return command(ctx,seconds,0x0201,p,sizeof(p),out,cap);
}
int eufy_e10_brightness(eufy_e10_t *ctx,uint32_t seconds,uint8_t percent,
                        uint8_t *out,size_t cap){
    uint8_t p[]={0xA4,1,(uint8_t)(percent>100?100:percent)};
    return command(ctx,seconds,0x0201,p,sizeof(p),out,cap);
}
int eufy_e10_color(eufy_e10_t *ctx,uint32_t seconds,bool is_e22,
                   uint8_t red,uint8_t green,uint8_t blue,uint8_t lamps,
                   uint8_t *out,size_t cap){
    if(lamps==0 || lamps>120)return -1;
    uint8_t p[210];size_t n=0;
#define APP(...) do { const uint8_t b[]={__VA_ARGS__}; if(n+sizeof(b)>sizeof(p))return -1;memcpy(p+n,b,sizeof(b));n+=sizeof(b); }while(0)
    APP(0xA3,2,0x26,0x4E);
    APP(0xA4,2,0,0);APP(0xA5,1,1);
    if(is_e22){APP(0xA6,6,1,red,green,blue,0,0);}else{APP(0xA6,5,1,red,green,blue,0);}
    APP(0xA7,(uint8_t)(lamps+1),lamps);
    for(uint8_t i=0;i<lamps;i++)p[n++]=i;
    APP(0xA8,1,100);APP(0xA9,5,0,0,0,0,0);APP(0xAA,1,0);APP(0xAE,1,0);APP(0xB0,1,0);
#undef APP
    int rc=command(ctx,seconds,0x0206,p,n,out,cap);wipe(p,sizeof(p));return rc;
}
