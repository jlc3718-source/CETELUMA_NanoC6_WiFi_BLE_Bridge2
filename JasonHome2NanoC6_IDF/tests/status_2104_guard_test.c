#include "native_slot_guard.h"
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int check(uint16_t opcode, size_t length, int valid_uuid, int valid_frame) {
    uint8_t frame[32] = {0};
    frame[0] = 42;
    frame[1] = 1;
    frame[4] = 0xf0;
    frame[5] = valid_frame ? 4 : 0;
    frame[7] = frame[0];
    frame[10] = (uint8_t)(opcode >> 8);
    frame[11] = (uint8_t)opcode;
    jh2_slot_session session = {0};
    const char *error = NULL;
    return jh2_slot_validate(&session,
        valid_uuid ? JH2_SLOT_COMMAND_UUID : JH2_SLOT_UPLOAD_UUID,
        frame, length, 0, false, 0, 0, true, &error);
}
static int expect(const char *name, int actual, int expected) {
    if (actual == expected) return 0;
    fprintf(stderr, "%s: got %d expected %d\n", name, actual, expected);
    return 1;
}
int main(void) {
    int errors = 0;
    errors += expect("2104 read-only status allowed", check(2104, 24, 1, 1), 1);
    errors += expect("205 handshake allowed", check(205, 24, 1, 1), 1);
    errors += expect("167 init allowed", check(167, 24, 1, 1), 1);
    errors += expect("2904 inventory allowed", check(2904, 24, 1, 1), 1);
    errors += expect("2514 power ON rejected", check(2514, 24, 1, 1), 0);
    errors += expect("2515 power OFF rejected", check(2515, 24, 1, 1), 0);
    errors += expect("2909 slot erase rejected", check(2909, 24, 1, 1), 0);
    errors += expect("2105 unsolicited notification rejected", check(2105, 24, 1, 1), 0);
    errors += expect("2104 with data rejected", check(2104, 25, 1, 1), 0);
    errors += expect("2104 on upload characteristic rejected", check(2104, 24, 0, 1), 0);
    errors += expect("2104 malformed DDP rejected", check(2104, 24, 1, 0), 0);
    if (!errors) puts("PASS: only 205/167/2904/2104 read-only 24-byte DDP commands allowed");
    return errors ? 1 : 0;
}
