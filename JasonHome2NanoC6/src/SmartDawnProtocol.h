#pragma once
#include <stdint.h>
#include <stddef.h>

// SmartDawn DN5E58 wire format transcribed from Jason Home 2 CurtainBridge.java.
// No Android / Anderson Home code or pin mappings are used here.
namespace SmartDawn {
constexpr size_t MAX_FRAME = 40;
struct Frame { uint8_t bytes[MAX_FRAME]{}; size_t length = 0; };
struct Session { uint8_t seq = 1; uint16_t tx = 1; };
struct Effect { uint32_t group; uint32_t index; };
int nativeBrightness(int ui); // 1..100 -> 4..100; -1 for invalid
int rawBrightness(int ui);    // 1..100 -> 0..255; -1 for invalid
bool effectInfo(int id, Effect& out); // E-0..E-87 ONLY
bool commandFrame(Session& s, uint16_t opcode, const uint8_t* payload, size_t count, Frame& out);
bool scalarFrame(Session& s, uint16_t opcode, uint32_t value, Frame& out);
bool effectFrames(Session& s, int id, Frame& clear, Frame& select);
}
