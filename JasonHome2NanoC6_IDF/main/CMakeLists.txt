idf_component_register(
    SRCS "main.c" "effectlist.c" "bridge.c" "signed_ota.c" "asset_stream.c" "native_commands.c" "native_sequence.c" "native_recovery.c" "browser_ota_compat.c"
    INCLUDE_DIRS "."
    REQUIRES bt nvs_flash app_update esp_partition mbedtls esp_timer esp_event esp_netif esp_wifi esp_http_client json joltwallet__littlefs
    EMBED_TXTFILES "tls_roots.pem" "ota_public.pem"
)
