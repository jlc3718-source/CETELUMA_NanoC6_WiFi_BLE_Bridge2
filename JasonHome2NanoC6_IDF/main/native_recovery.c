#include "native_recovery.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG="JH2_NATIVE_RECOVERY";
bool jh2_enter_local_recovery(void){
    const esp_partition_t *updater=esp_partition_find_first(
        ESP_PARTITION_TYPE_APP,ESP_PARTITION_SUBTYPE_APP_FACTORY,"rescue");
    const esp_partition_t *running=esp_ota_get_running_partition();
    if(!running||(running->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_0&&
        running->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_1)||
       !updater||updater->address!=0x10000||updater->size!=0x100000){
        ESP_LOGE(TAG,"Independent A/B factory rescue partition not found; refusing unsafe boot selection");
        return false;
    }
    nvs_handle_t nvs=0;
    if(nvs_open("jh2-release",NVS_READWRITE,&nvs)!=ESP_OK)return false;
    esp_err_t rc=nvs_set_u8(nvs,"local",1);
    if(rc==ESP_OK)rc=nvs_commit(nvs);
    nvs_close(nvs);
    if(rc!=ESP_OK)return false;
    if(esp_ota_set_boot_partition(updater)!=ESP_OK)return false;
    ESP_LOGW(TAG,"Entering independent A/B firmware rescue. NVS and storage untouched.");
    vTaskDelay(pdMS_TO_TICKS(350));
    esp_restart();
    return true;
}
