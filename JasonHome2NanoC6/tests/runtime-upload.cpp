#include "RuntimeUploadProbe.h"
#include <algorithm>
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>
int main(){
  assert(!validRuntimeUploadSize(0x120000)&&validRuntimeUploadSize(2585232)&&!validRuntimeUploadSize(0x400000));
  std::vector<uint8_t> image(512,0);image[0]=0xe9;image[1]=5;image[12]=13;
  std::copy(JH2_RUNTIME_MARKER,JH2_RUNTIME_MARKER+sizeof(JH2_RUNTIME_MARKER)-1,image.begin()+201);
  for(size_t chunk=1;chunk<=image.size();chunk++){
    RuntimeUploadProbe p;std::vector<uint8_t> written;bool opened=false;
    for(size_t i=0;i<image.size();i+=chunk){
      size_t length=std::min(chunk,image.size()-i),before=p.headerSize();p.feed(image.data()+i,length);
      size_t consumed=0;if(!opened){if(!p.headerComplete())continue;assert(p.validHeader());opened=true;
        written.insert(written.end(),p.header(),p.header()+24);consumed=24-before;}
      written.insert(written.end(),image.begin()+i+consumed,image.begin()+i+length);
    }
    assert(p.validHeader()&&p.productFound()&&written==image);
  }
  RuntimeUploadProbe wrongChip;image[12]=9;wrongChip.feed(image.data(),image.size());assert(!wrongChip.validHeader());
  image[12]=13;image[0]=0;RuntimeUploadProbe wrongMagic;wrongMagic.feed(image.data(),image.size());assert(!wrongMagic.validHeader());
  image[0]=0xe9;image[201]=0;RuntimeUploadProbe wrongProduct;wrongProduct.feed(image.data(),image.size());assert(wrongProduct.validHeader()&&!wrongProduct.productFound());
  RuntimeUploadProbe shortHeader;shortHeader.feed(image.data(),23);assert(!shortHeader.headerComplete()&&!shortHeader.validHeader());
  std::cout<<"PASS: upload guard and exact reconstructed image across 512 chunk sizes; wrong chip, magic, product and short header rejected\n";
}
