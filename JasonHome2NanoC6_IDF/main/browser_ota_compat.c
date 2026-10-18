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
/* Keep the native app's image larger than the factory updater's
 * minimum (>0x120000). The section is mapped flash ROM, not heap.
 * Both first and last entries initialized to force a complete region.
 */
__attribute__((used,aligned(16)))
const unsigned char jh2_native_compat_padding[0x120100] = {
    [0] = 0x4a,
    [0x1200ff] = 0x32,
};
#endif
