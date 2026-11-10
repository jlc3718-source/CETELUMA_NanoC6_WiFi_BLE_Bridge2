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

/* 0x0204 pushed state and 0x0A00 query replies are the only device-state
 * evidence. GATT write completion alone must never update desired state. */
static void eufy_parse_state(eufy_e10_t *ctx,const uint8_t *p,size_t n){
    if(!ctx||!p||n<3)return;
    bool anything=false;
    for(size_t i=0;i+2<=n;){
        const uint8_t tag=p[i],len=p[i+1];
        i+=2;
        if(i+len>n)break;
        uint32_t value=0;
        if(len>=1&&len<=4){
            for(uint8_t k=0;k<len;k++)value|=(uint32_t)p[i+k]<<(8*k);
            switch(tag){
            case 0xA1:ctx->state_has_power=true;ctx->state_power=value!=0;anything=true;break;
            case 0xA2:ctx->state_has_brightness=true;ctx->state_brightness=(uint8_t)value;anything=true;break;
            case 0xA3:ctx->state_has_segments=true;ctx->state_segments=(uint16_t)value;anything=true;break;
            case 0xA4:ctx->state_has_effect=true;ctx->state_effect_id=value;anything=true;break;
            case 0xA6:ctx->state_has_cloud_effect=true;ctx->state_cloud_effect_id=value;anything=true;break;
            case 0xA7:if(len==1){ctx->state_has_mode=true;ctx->state_mode=(uint8_t)value;}break;
            case 0xA8:if(len==1){ctx->state_has_mode=true;ctx->state_mode=(uint8_t)value;}break;
            default:break;
            }
        }
        i+=len;
    }
    if(anything){ctx->state_valid=true;ctx->state_generation++;}
}
static int eufy_decrypt_notification(eufy_e10_t *ctx,const uint8_t *in,size_t len,
                                     const uint8_t key[16],uint8_t *plain,size_t *plain_len){
    const size_t n=len-10;
    if(n<16 || n>EUFY_E10_FRAME_MAX || (n&15))return -1;
    if(aes_cbc(false,key,ctx->serial_iv,in+9,n,plain)!=0)return -1;
    const uint8_t pad=plain[n-1];
    if(!pad||pad>16||pad>n)return -1;
    for(size_t i=n-pad;i<n;i++)if(plain[i]!=pad)return -1;
    *plain_len=n-pad;
    return 0;
}
int eufy_e10_notification(eufy_e10_t *ctx,const uint8_t *in,size_t len){
    if(!ctx||!in||len<10||len>EUFY_E10_FRAME_MAX||in[0]!=0xff||in[1]!=9||
       ((size_t)in[2]|((size_t)in[3]<<8))!=len)return -1;
    uint8_t crc=0;for(size_t i=0;i<len;i++)crc^=in[i];if(crc)return -1;
    const uint16_t opcode=(uint16_t)((in[7]<<8)|in[8]);
    if(opcode==0x0801||opcode==0x0829||opcode==0x0803||opcode==0x0805)return 0;
    if(opcode==0x4822){
        uint8_t plain[EUFY_E10_FRAME_MAX];size_t n=0;
        if(eufy_decrypt_notification(ctx,in,len,ctx->initial_key,plain,&n)<0){
            wipe(plain,sizeof(plain));return -1;
        }
        int result=-1;
        for(size_t i=0;i+18<=n;i++)if(plain[i]==0xA1&&plain[i+1]==0x10){
            memcpy(ctx->session_key,plain+i+2,16);
            ctx->session_valid=true;
            ctx->last_ack_result=-1;
            result=1;break;
        }
        wipe(plain,sizeof(plain));return result;
    }
    /* Some hardware emits unencrypted 0x0Axx acknowledgements. */
    if((opcode==0x0A01||opcode==0x0A06||opcode==0x0A0D)&&len>=11){
        ctx->last_ack_opcode=opcode;
        ctx->last_ack_result=(int8_t)in[9];
        ctx->ack_generation++;
        return 2;
    }
    if(!ctx->session_valid)return -1;
    if(opcode!=0x4204&&opcode!=0x4A00&&
       opcode!=0x4A01&&opcode!=0x4A06&&opcode!=0x4A0D)return -1;
    uint8_t plain[EUFY_E10_FRAME_MAX];size_t n=0;
    if(eufy_decrypt_notification(ctx,in,len,ctx->session_key,plain,&n)<0){
        wipe(plain,sizeof(plain));return -1;
    }
    int result=-1;
    if(opcode==0x4204){
        eufy_parse_state(ctx,plain,n);
        result=ctx->state_valid?3:-1;
    }else if(opcode==0x4A00){
        if(n>1&&plain[0]==0){
            eufy_parse_state(ctx,plain+1,n-1);
            result=ctx->state_valid?4:-1;
        }
    }else if(n>=1){
        ctx->last_ack_opcode=(uint16_t)(opcode&~0x4000);
        ctx->last_ack_result=(int8_t)plain[0];
        ctx->ack_generation++;
        result=2;
    }
    wipe(plain,sizeof(plain));
    return result;
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

int eufy_e10_read_status(eufy_e10_t *ctx,uint32_t seconds,uint8_t *out,size_t cap){
    const uint8_t mask[]={0xA3,2,0xFF,0xFF};
    return command(ctx,seconds,0x0200,mask,sizeof(mask),out,cap);
}
int eufy_e10_preset(eufy_e10_t *ctx,uint32_t seconds,
                    const uint8_t *tail,size_t tail_len,uint8_t *out,size_t cap){
    /* Encrypted E22 0x020D is ignored above 240 bytes of AES ciphertext.
     * 48-byte envelope + tail + padding must remain <=240. */
    if(!tail||tail_len<16||tail_len>191)return -1;
    if(tail[0]!=0xA3||tail[1]!=4)return -1;
    return command(ctx,seconds,0x020D,tail,tail_len,out,cap);
}
int eufy_e10_dynamic(eufy_e10_t *ctx,uint32_t seconds,bool is_e22,
                     uint16_t effect_id,uint8_t speed,
                     uint8_t red,uint8_t green,uint8_t blue,
                     uint8_t lamps,uint8_t *out,size_t cap){
    if(effect_id<20000||effect_id>20006||speed<1||speed>10||lamps<1||lamps>120)return -1;
    uint8_t p[210];size_t n=0;
#define APP(...) do { const uint8_t b[]={__VA_ARGS__};if(n+sizeof(b)>sizeof(p))return -1;memcpy(p+n,b,sizeof(b));n+=sizeof(b); }while(0)
    APP(0xA3,2,(uint8_t)effect_id,(uint8_t)(effect_id>>8));
    APP(0xA5,1,speed);
    if(is_e22){APP(0xA6,6,1,red,green,blue,0,0);}
    else{APP(0xA6,5,1,red,green,blue,0);}
    APP(0xA7,(uint8_t)(lamps+1),lamps);
    for(uint8_t i=0;i<lamps;i++)p[n++]=i;
    APP(0xA8,1,100);APP(0xA9,5,0,0,0,0,0);
    APP(0xAA,1,0);APP(0xAC,4,0,0,0,0);APP(0xAE,1,0);APP(0xB0,1,7);
#undef APP
    const int rc=command(ctx,seconds,0x0206,p,n,out,cap);
    wipe(p,sizeof(p));return rc;
}
int eufy_e10_color(eufy_e10_t *ctx,uint32_t seconds,bool is_e22,
                   uint8_t red,uint8_t green,uint8_t blue,uint8_t lamps,
                   uint8_t *out,size_t cap){
    return eufy_e10_dynamic(ctx,seconds,is_e22,20006,5,red,green,blue,lamps,out,cap);
}
