#include "EufyProtocol.h"
#include <fstream>
#include <iostream>
#include <sstream>
#include <iomanip>
static std::string hex(const EufyWire::Buffer&v){std::ostringstream o;for(auto b:v)o<<std::hex<<std::setfill('0')<<std::setw(2)<<int(b);return o.str();}
static std::vector<std::string>split(const std::string&s,char sep){std::vector<std::string>o;std::stringstream in(s);std::string p;while(std::getline(in,p,sep))o.push_back(p);return o;}
int main(int argc,char**argv){
 if(argc!=2)return 2;std::ifstream in(argv[1]);std::string line;int count=0;
 while(std::getline(in,line)){
  auto p=split(line,'\t');if(p.size()!=9)return 3;std::vector<uint32_t>colors;for(auto c:split(p[4],','))colors.push_back(std::stoul(c,nullptr,16));
  EufyWire::Pattern pattern;int mode=std::stoi(p[7]);if(mode==1){pattern.blocks={5,3};pattern.offset=4;pattern.mirror=true;}if(mode==2)pattern.positions={0,4,8,9,17};
  auto got=EufyWire::effect(p[0]=="T8L02",p[1],colors,std::stoi(p[2]),p[3]=="1",std::stoi(p[5]),std::stoi(p[6]),pattern);
  if(hex(got)!=p[8]){std::cerr<<"Production packet mismatch at vector "<<count<<" "<<line<<"\nactual "<<hex(got)<<"\n";return 1;}count++;
 }
 std::ifstream expected(std::string(argv[1])+".command");std::string want;expected>>want;
 if(hex(EufyWire::command(0x201,"123456789",EufyWire::setupPower(true),1792022400))!=want)return 4;
 std::cout<<"PASS: "<<count<<" exact E120/E22 packet comparisons and complete command envelope\n";
}
