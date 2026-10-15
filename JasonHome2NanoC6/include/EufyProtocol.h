#pragma once
#include <vector>
#include <string>
#include <stdint.h>
namespace EufyWire {
using Buffer=std::vector<uint8_t>;
struct Pattern{std::vector<int>blocks,positions;int offset=0;bool mirror=false;};
Buffer effect(bool e22,const std::string&name,std::vector<uint32_t>colors,int speed,bool reverse,int lamps,int level,const Pattern&pattern={});
Buffer command(uint16_t op,const std::string&account,const Buffer&fields,uint32_t timestamp);
Buffer setupPower(bool on);
Buffer setupBrightness(int brightness);
Buffer status();
Buffer rgbcw(uint32_t color);
}
