#include "Arduino.h"
#include "esp_sntp.h"
#include "sdkconfig.h"
#include "esp_flash_partitions.h"
#include "esp_image_format.h"
#include <sys/time.h>
#include <time.h>

ESPClass ESP;
uint32_t millis(){return (uint32_t)(esp_timer_get_time()/1000ULL);}
uint32_t micros(){return (uint32_t)esp_timer_get_time();}
void delay(uint32_t ms){if(ms==0){taskYIELD();return;}TickType_t ticks=pdMS_TO_TICKS(ms);if(ticks==0)ticks=1;vTaskDelay(ticks);}
void yield(){taskYIELD();}
void pinMode(int pin,int mode){gpio_config_t c{};c.pin_bit_mask=1ULL<<pin;c.mode=mode==OUTPUT?GPIO_MODE_OUTPUT:GPIO_MODE_INPUT;c.pull_up_en=mode==INPUT_PULLUP?GPIO_PULLUP_ENABLE:GPIO_PULLUP_DISABLE;c.pull_down_en=GPIO_PULLDOWN_DISABLE;c.intr_type=GPIO_INTR_DISABLE;gpio_config(&c);}
void digitalWrite(int pin,int value){gpio_set_level((gpio_num_t)pin,value?1:0);}
int digitalRead(int pin){return gpio_get_level((gpio_num_t)pin);}
void configTzTime(const char* tz,const char* s1,const char* s2,const char* s3){setenv("TZ",tz&&*tz?tz:"UTC0",1);tzset();if(esp_sntp_enabled())esp_sntp_stop();esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);if(s1&&*s1)esp_sntp_setservername(0,const_cast<char*>(s1));if(s2&&*s2)esp_sntp_setservername(1,const_cast<char*>(s2));if(s3&&*s3)esp_sntp_setservername(2,const_cast<char*>(s3));esp_sntp_init();}
uint32_t getCpuFrequencyMhz(){return CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ;}
[[noreturn]] void ESPClass::restart() const {esp_restart();for(;;)vTaskDelay(portMAX_DELAY);}
uint32_t ESPClass::getHeapSize() const{return (uint32_t)heap_caps_get_total_size(MALLOC_CAP_8BIT);}
uint32_t ESPClass::getFreeHeap() const{return (uint32_t)heap_caps_get_free_size(MALLOC_CAP_8BIT);}
uint32_t ESPClass::getMinFreeHeap() const{return (uint32_t)heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT);}
uint32_t ESPClass::getMaxAllocHeap() const{return (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);}
uint32_t ESPClass::getSketchSize() const{const esp_partition_t* p=esp_ota_get_running_partition();if(!p)return 0;esp_partition_pos_t pos{};pos.offset=p->address;pos.size=p->size;esp_image_metadata_t meta{};meta.start_addr=p->address;return esp_image_verify(ESP_IMAGE_VERIFY_SILENT,&pos,&meta)==ESP_OK?(uint32_t)meta.image_len:0;}
