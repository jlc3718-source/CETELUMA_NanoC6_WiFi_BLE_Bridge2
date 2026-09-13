#pragma once
#include "Arduino.h"
#include "esp_ota_ops.h"
static constexpr size_t UPDATE_SIZE_UNKNOWN=OTA_SIZE_UNKNOWN;
static constexpr int U_FLASH=0;
class UpdateClass {
 public:
  bool begin(size_t size=UPDATE_SIZE_UNKNOWN,int command=U_FLASH);
  size_t write(const uint8_t* data,size_t len);
  bool end(bool evenIfRemaining=false);
  void abort();
  bool isRunning() const{return running_;}
  int getError() const{return (int)lastError_;}
 private:
  esp_ota_handle_t handle_=0;const esp_partition_t* target_=nullptr;bool running_=false;esp_err_t lastError_=ESP_OK;size_t written_=0;
};
extern UpdateClass Update;
