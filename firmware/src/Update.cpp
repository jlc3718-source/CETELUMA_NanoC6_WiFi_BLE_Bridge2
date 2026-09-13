#include "Update.h"
UpdateClass Update;
bool UpdateClass::begin(size_t size,int){abort();target_=esp_ota_get_next_update_partition(nullptr);if(!target_){lastError_=ESP_ERR_NOT_FOUND;return false;}size_t requested=(size==UPDATE_SIZE_UNKNOWN)?OTA_SIZE_UNKNOWN:size;lastError_=esp_ota_begin(target_,requested,&handle_);running_=lastError_==ESP_OK;written_=0;return running_;}
size_t UpdateClass::write(const uint8_t* data,size_t len){if(!running_||!data||!len)return 0;lastError_=esp_ota_write(handle_,data,len);if(lastError_!=ESP_OK)return 0;written_+=len;return len;}
bool UpdateClass::end(bool){if(!running_)return false;lastError_=esp_ota_end(handle_);handle_=0;running_=false;if(lastError_!=ESP_OK)return false;lastError_=esp_ota_set_boot_partition(target_);return lastError_==ESP_OK;}
void UpdateClass::abort(){if(running_&&handle_)esp_ota_abort(handle_);handle_=0;target_=nullptr;running_=false;written_=0;}
