#pragma once
#include <stddef.h>
#include <stdint.h>
#include "psa/crypto.h"

// ESP-IDF 6.x / Mbed TLS 4 removed the legacy SHA-256 implementation API.
// Anderson's existing OTA verifier calls that small legacy surface, so map it
// to the native PSA Crypto hashing API without linking Arduino or legacy crypto.
typedef struct {
  psa_hash_operation_t operation;
  bool active;
} mbedtls_sha256_context;

static inline void mbedtls_sha256_init(mbedtls_sha256_context* ctx){
  if(!ctx)return;
  ctx->operation=PSA_HASH_OPERATION_INIT;
  ctx->active=false;
}
static inline void mbedtls_sha256_free(mbedtls_sha256_context* ctx){
  if(!ctx)return;
  if(ctx->active)psa_hash_abort(&ctx->operation);
  ctx->operation=PSA_HASH_OPERATION_INIT;
  ctx->active=false;
}
static inline int mbedtls_sha256_starts(mbedtls_sha256_context* ctx,int is224){
  if(!ctx||is224)return -1;
  if(psa_crypto_init()!=PSA_SUCCESS)return -1;
  if(ctx->active)psa_hash_abort(&ctx->operation);
  ctx->operation=PSA_HASH_OPERATION_INIT;
  psa_status_t rc=psa_hash_setup(&ctx->operation,PSA_ALG_SHA_256);
  ctx->active=rc==PSA_SUCCESS;
  return rc==PSA_SUCCESS?0:-1;
}
static inline int mbedtls_sha256_update(mbedtls_sha256_context* ctx,const unsigned char* input,size_t len){
  if(!ctx||!ctx->active||(!input&&len))return -1;
  return psa_hash_update(&ctx->operation,input,len)==PSA_SUCCESS?0:-1;
}
static inline int mbedtls_sha256_finish(mbedtls_sha256_context* ctx,unsigned char output[32]){
  if(!ctx||!ctx->active||!output)return -1;
  size_t outLen=0;
  psa_status_t rc=psa_hash_finish(&ctx->operation,output,32,&outLen);
  ctx->active=false;
  return rc==PSA_SUCCESS&&outLen==32?0:-1;
}
static inline int mbedtls_sha256(const unsigned char* input,size_t len,unsigned char output[32],int is224){
  if(is224||!output||(!input&&len))return -1;
  if(psa_crypto_init()!=PSA_SUCCESS)return -1;
  size_t outLen=0;
  psa_status_t rc=psa_hash_compute(PSA_ALG_SHA_256,input,len,output,32,&outLen);
  return rc==PSA_SUCCESS&&outLen==32?0:-1;
}
