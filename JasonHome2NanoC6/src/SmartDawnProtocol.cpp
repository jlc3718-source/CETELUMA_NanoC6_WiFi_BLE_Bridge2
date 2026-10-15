#include "SmartDawnProtocol.h"
#include <string.h>
namespace SmartDawn {
static const uint32_t GROUPS[33] = {
  15193,15194,15195,15196,15197,15198,15199,15200,15201,15202,15203,
  15204,15205,15206,15207,15208,15209,15210,15211,15212,15213,15214,
  15215,15216,15217,15218,15219,15220,15221,15222,15224,15225,83494
};
static const uint32_t INDEXES[33] = {
  0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,
  18,19,20,21,22,23,24,25,26,27,28,29,30,31,33
};
int nativeBrightness(int ui) {
  if (ui < 1 || ui > 100) return -1;
  // Integer equivalent to Java Math.round(4 + (ui-1) * 96f / 99f).
  return 4 + (((ui - 1) * 96 + 49) / 99);
}
int rawBrightness(int ui) {
  const int level = nativeBrightness(ui);
  return level < 0 ? -1 : (level * 255 + 50) / 100;
}
bool effectInfo(int id, Effect& out) {
  if (id < 0 || id > 87) return false;
  if (id < 55) { out = {15924U, static_cast<uint32_t>(id)}; return true; }
  out = {GROUPS[id-55], INDEXES[id-55]}; return true;
}
static size_t varint(uint32_t value, uint8_t* out) {
  size_t n = 0;
  do { const uint32_t next = value >> 7;
       out[n++] = static_cast<uint8_t>((value & 127U) | (next ? 128U : 0U));
       value = next;
  } while(value != 0 && n < 5);
  return n;
}
bool commandFrame(Session& s, uint16_t opcode, const uint8_t* payload, size_t count, Frame& out) {
  if (count > MAX_FRAME - 24 || (count && !payload)) return false;
  memset(out.bytes, 0, sizeof(out.bytes));
  out.length = 24 + count;
  out.bytes[0] = s.seq; out.bytes[1] = 1;
  out.bytes[4] = 0xf0; out.bytes[5] = 4;
  out.bytes[6] = static_cast<uint8_t>(s.tx >> 8);
  out.bytes[7] = static_cast<uint8_t>(s.tx & 0xff);
  out.bytes[10] = static_cast<uint8_t>(opcode >> 8);
  out.bytes[11] = static_cast<uint8_t>(opcode & 0xff);
  if (count) memcpy(out.bytes + 24, payload, count);
  s.seq = static_cast<uint8_t>(s.seq+1);
  s.tx = static_cast<uint16_t>(s.tx+1);
  return true;
}
bool scalarFrame(Session& s, uint16_t opcode, uint32_t value, Frame& out) {
  uint8_t payload[6]{8};
  const size_t len = varint(value, payload + 1);
  return commandFrame(s,opcode,payload,1+len,out);
}
bool effectFrames(Session& s, int id, Frame& clear, Frame& select) {
  Effect e{}; if (!effectInfo(id,e)) return false;
  // 0x096a clears prior mode, 0x0a2e applies exact catalog group/index.
  if (!commandFrame(s,0x096a,nullptr,0,clear)) return false;
  uint8_t p[12]{};
  size_t n=0; p[n++]=8; n+=varint(e.group,p+n);
  p[n++]=16; n+=varint(e.index,p+n);
  return commandFrame(s,0x0a2e,p,n,select);
}
}
