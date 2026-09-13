#pragma once
#include <stddef.h>
#include <stdint.h>
#include <psa/crypto.h>

struct AndersonSha256Context {
  psa_hash_operation_t operation = PSA_HASH_OPERATION_INIT;
  bool active = false;
};

static inline void andersonSha256Init(AndersonSha256Context* ctx) {
  if (!ctx) return;
  ctx->operation = PSA_HASH_OPERATION_INIT;
  ctx->active = false;
}

static inline void andersonSha256Free(AndersonSha256Context* ctx) {
  if (!ctx) return;
  if (ctx->active) psa_hash_abort(&ctx->operation);
  ctx->operation = PSA_HASH_OPERATION_INIT;
  ctx->active = false;
}

static inline int andersonSha256Starts(AndersonSha256Context* ctx) {
  if (!ctx) return -1;
  if (psa_crypto_init() != PSA_SUCCESS) return -1;
  if (ctx->active) psa_hash_abort(&ctx->operation);
  ctx->operation = PSA_HASH_OPERATION_INIT;
  const psa_status_t rc = psa_hash_setup(&ctx->operation, PSA_ALG_SHA_256);
  ctx->active = rc == PSA_SUCCESS;
  return ctx->active ? 0 : -1;
}

static inline int andersonSha256Update(AndersonSha256Context* ctx, const uint8_t* input, size_t len) {
  if (!ctx || !ctx->active || (!input && len)) return -1;
  return psa_hash_update(&ctx->operation, input, len) == PSA_SUCCESS ? 0 : -1;
}

static inline int andersonSha256Finish(AndersonSha256Context* ctx, uint8_t output[32]) {
  if (!ctx || !ctx->active || !output) return -1;
  size_t outLen = 0;
  const psa_status_t rc = psa_hash_finish(&ctx->operation, output, 32, &outLen);
  ctx->active = false;
  return rc == PSA_SUCCESS && outLen == 32 ? 0 : -1;
}

static inline int andersonSha256Compute(const uint8_t* input, size_t len, uint8_t output[32]) {
  if (!output || (!input && len)) return -1;
  if (psa_crypto_init() != PSA_SUCCESS) return -1;
  size_t outLen = 0;
  const psa_status_t rc = psa_hash_compute(PSA_ALG_SHA_256, input, len, output, 32, &outLen);
  return rc == PSA_SUCCESS && outLen == 32 ? 0 : -1;
}
