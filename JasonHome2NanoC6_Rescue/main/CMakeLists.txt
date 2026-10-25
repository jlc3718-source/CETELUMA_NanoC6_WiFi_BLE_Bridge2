idf_component_register(SRCS "rescue.c" INCLUDE_DIRS "." REQUIRES nvs_flash esp_wifi esp_event esp_netif esp_http_server app_update esp_partition bootloader_support)
