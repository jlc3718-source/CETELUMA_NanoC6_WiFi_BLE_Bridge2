/* Embedded browser-OTA compatibility for the original Jason Home 2
 * factory updater. It requires an ESP32-C6 image containing
 * "jason-home-2-nanoc6-runtime-v1" with length > 0x120000.
 * This is in the app's mapped flash image, not trailing unsigned data.
 * The factory recovery partition and original uploader are unchanged.
 */
#include <stdint.h>
#include "sdkconfig.h"
#if CONFIG_JH2_NATIVE_BROWSER_OTA_COMPAT
__attribute__((used)) const char jh2_native_runtime_marker[] =
    "jason-home-2-nanoc6-runtime-v1";
/* No artificial padding: the original recovery updater requires a runtime
 * image larger than 0x120000 bytes. The build-only optimization gate checks
 * the final image size, product marker and partition bounds. Keeping the
 * original bootloader, factory updater and partitions makes this OTA-safe.
 */
#endif
