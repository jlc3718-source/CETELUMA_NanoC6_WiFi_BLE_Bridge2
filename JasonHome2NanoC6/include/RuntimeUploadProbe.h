#pragma once
#include <cstddef>
#include <cstdint>
#include "LocalFirmware.h"
inline bool validRuntimeUploadSize(size_t size){return size>0x120000&&size<=0x290000;}
// Inspect arbitrary binary chunks, including NUL bytes and split headers/markers.
class RuntimeUploadProbe {
  uint8_t first[24]{};
  size_t count=0,matched=0;
  bool product=false;
public:
  void feed(const uint8_t*data,size_t length){
    for(size_t i=0;i<length;i++){
      if(count<sizeof(first))first[count++]=data[i];
      if(product)continue;
      if(data[i]==(uint8_t)JH2_RUNTIME_MARKER[matched])++matched;
      else matched=data[i]==(uint8_t)JH2_RUNTIME_MARKER[0]?1:0;
      if(matched==sizeof(JH2_RUNTIME_MARKER)-1)product=true;
    }
  }
  size_t headerSize()const{return count;}
  const uint8_t*header()const{return first;}
  bool headerComplete()const{return count==sizeof(first);}
  bool validHeader()const{return headerComplete()&&first[0]==0xe9&&first[1]>0&&first[1]<=16&&first[12]==13&&first[13]==0;}
  bool productFound()const{return product;}
};
