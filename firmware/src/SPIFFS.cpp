#include "SPIFFS.h"
#include "esp_spiffs.h"
#include <sys/stat.h>
#include <unistd.h>
SPIFFSClass SPIFFS;
String SPIFFSClass::full(const char* path)const{return String("/spiffs")+String(path?path:"");}
bool SPIFFSClass::begin(bool formatOnFail){if(mounted_)return true;esp_vfs_spiffs_conf_t c{};c.base_path="/spiffs";c.partition_label="spiffs";c.max_files=6;c.format_if_mount_failed=formatOnFail;esp_err_t e=esp_vfs_spiffs_register(&c);if(e==ESP_ERR_INVALID_STATE)e=ESP_OK;mounted_=e==ESP_OK;return mounted_;}
File SPIFFSClass::open(const char* p,const char* m){if(!begin(false))return File();String f=full(p);return File(fopen(f.c_str(),m));}
bool SPIFFSClass::exists(const char* p){struct stat st{};String f=full(p);return stat(f.c_str(),&st)==0;}
bool SPIFFSClass::remove(const char* p){String f=full(p);return unlink(f.c_str())==0||errno==ENOENT;}
bool SPIFFSClass::rename(const char* a,const char* b){String x=full(a),y=full(b);return ::rename(x.c_str(),y.c_str())==0;}
size_t SPIFFSClass::totalBytes(){size_t total=0,used=0;if(esp_spiffs_info("spiffs",&total,&used)!=ESP_OK)return 0;return total;}
size_t SPIFFSClass::usedBytes(){size_t total=0,used=0;if(esp_spiffs_info("spiffs",&total,&used)!=ESP_OK)return 0;return used;}
String File::readString(){String out;if(!f_)return out;char b[1024];size_t n;while((n=fread(b,1,sizeof(b),f_))>0)out.append(b,n);return out;}
size_t File::print(const String& s){return f_?fwrite(s.data(),1,s.size(),f_):0;}
