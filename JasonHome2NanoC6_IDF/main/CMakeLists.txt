idf_component_register(
    SRCS "main.c" "effectlist.c" "bridge.c"
    INCLUDE_DIRS "."
    REQUIRES bt nvs_flash esp_timer esp_event esp_netif esp_wifi esp_http_client json joltwallet__littlefs
    EMBED_TXTFILES "tls_roots.pem"
)
