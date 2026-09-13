#include "Preferences.h"
#include "nvs_flash.h"

bool Preferences::begin(const char* ns,bool readOnly,const char* partition){end();if(!ns||!*ns)return false;esp_err_t e=partition&&*partition?nvs_open_from_partition(partition,ns,readOnly?NVS_READONLY:NVS_READWRITE,&handle_):nvs_open(ns,readOnly?NVS_READONLY:NVS_READWRITE,&handle_);open_=e==ESP_OK;readOnly_=readOnly;return open_;}
void Preferences::end(){if(open_)nvs_close(handle_);handle_=0;open_=false;}
String Preferences::getString(const char* key,const char* def) const{if(!open_||!key)return String(def?def:"");size_t n=0;if(nvs_get_str(handle_,key,nullptr,&n)!=ESP_OK||!n)return String(def?def:"");std::vector<char>b(n);if(nvs_get_str(handle_,key,b.data(),&n)!=ESP_OK)return String(def?def:"");return String(b.data());}
size_t Preferences::putString(const char* key,const String& v){if(!open_||readOnly_||!key)return 0;if(nvs_set_str(handle_,key,v.c_str())!=ESP_OK||nvs_commit(handle_)!=ESP_OK)return 0;return v.length();}
uint8_t Preferences::getUChar(const char* k,uint8_t d)const{uint8_t v=d;return open_&&nvs_get_u8(handle_,k,&v)==ESP_OK?v:d;}
size_t Preferences::putUChar(const char* k,uint8_t v){return open_&&!readOnly_&&nvs_set_u8(handle_,k,v)==ESP_OK&&nvs_commit(handle_)==ESP_OK?1:0;}
uint16_t Preferences::getUShort(const char* k,uint16_t d)const{uint16_t v=d;return open_&&nvs_get_u16(handle_,k,&v)==ESP_OK?v:d;}
size_t Preferences::putUShort(const char* k,uint16_t v){return open_&&!readOnly_&&nvs_set_u16(handle_,k,v)==ESP_OK&&nvs_commit(handle_)==ESP_OK?2:0;}
uint32_t Preferences::getUInt(const char* k,uint32_t d)const{uint32_t v=d;return open_&&nvs_get_u32(handle_,k,&v)==ESP_OK?v:d;}
size_t Preferences::putUInt(const char* k,uint32_t v){return open_&&!readOnly_&&nvs_set_u32(handle_,k,v)==ESP_OK&&nvs_commit(handle_)==ESP_OK?4:0;}
uint64_t Preferences::getULong64(const char* k,uint64_t d)const{uint64_t v=d;return open_&&nvs_get_u64(handle_,k,&v)==ESP_OK?v:d;}
size_t Preferences::putULong64(const char* k,uint64_t v){return open_&&!readOnly_&&nvs_set_u64(handle_,k,v)==ESP_OK&&nvs_commit(handle_)==ESP_OK?8:0;}
bool Preferences::getBool(const char* k,bool d)const{return getUChar(k,d?1:0)!=0;}
size_t Preferences::putBool(const char* k,bool v){return putUChar(k,v?1:0);}
bool Preferences::remove(const char* k){if(!open_||readOnly_)return false;esp_err_t e=nvs_erase_key(handle_,k);return (e==ESP_OK||e==ESP_ERR_NVS_NOT_FOUND)&&nvs_commit(handle_)==ESP_OK;}
bool Preferences::clear(){if(!open_||readOnly_)return false;return nvs_erase_all(handle_)==ESP_OK&&nvs_commit(handle_)==ESP_OK;}
