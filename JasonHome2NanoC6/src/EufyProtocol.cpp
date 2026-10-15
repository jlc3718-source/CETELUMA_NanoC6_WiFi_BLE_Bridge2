#include "EufyProtocol.h"
#include <algorithm>
#include <math.h>
namespace EufyWire {
static int clamp(int x,int a,int b){return std::max(a,std::min(b,x));}
static void tlv(Buffer&o,uint8_t tag,const Buffer&v){if(v.size()>255)return;o.push_back(tag);o.push_back(v.size());o.insert(o.end(),v.begin(),v.end());}
static Buffer le16(int n){return {(uint8_t)n,(uint8_t)(n>>8)};}
static Buffer le32(uint32_t n){return {(uint8_t)n,(uint8_t)(n>>8),(uint8_t)(n>>16),(uint8_t)(n>>24)};}
Buffer setupPower(bool on){return {0xa3,1,(uint8_t)(on?1:0)};}
Buffer setupBrightness(int n){return {0xa4,1,(uint8_t)clamp(n,0,100)};}
Buffer status(){return {0xa3,2,0xff,0x1f};}
Buffer command(uint16_t op,const std::string&account,const Buffer&f,uint32_t ts){Buffer fields;tlv(fields,0xa1,le32(ts));tlv(fields,0xa2,Buffer(account.begin(),account.end()));fields.insert(fields.end(),f.begin(),f.end());size_t n=10+fields.size();Buffer o={0xff,9,(uint8_t)n,(uint8_t)(n>>8),3,0,2,(uint8_t)(op>>8),(uint8_t)op};o.insert(o.end(),fields.begin(),fields.end());uint8_t x=0;for(auto b:o)x^=b;o.push_back(x);return o;}
static double decode(int n){return pow(n/255.,2.2);}
static uint8_t encode(double n){return (uint8_t)floor(255*pow(std::max(0.,std::min(1.,n)),1/2.2)+.5);}
Buffer rgbcw(uint32_t col){
  if(col==0x5b00e6)return {0x5b,0,0xe6,0,0};
  const double data[5][3]={{15.932,.7035,.294},{39.83,.1629,.7208},{2.2404,.1472,.0309},{66.28,.4681,.4182},{73.58,.3166,.3397}};
  double xyz[5][3];for(int i=0;i<5;i++){auto Y=data[i][0],x=data[i][1],y=data[i][2];xyz[i][0]=x*Y/y;xyz[i][1]=Y;xyz[i][2]=(1-x-y)*Y/y;}
  double a=xyz[0][0],b=xyz[1][0],c=xyz[2][0],d=xyz[0][1],e=xyz[1][1],f=xyz[2][1],g=xyz[0][2],h=xyz[1][2],i=xyz[2][2];
  double A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;
  double inv[3][3]={{A/det,-(b*i-c*h)/det,(b*f-c*e)/det},{B/det,(a*i-c*g)/det,-(a*f-c*d)/det},{C/det,-(a*h-b*g)/det,(a*e-b*d)/det}};
  int r=(col>>16)&255,gr=(col>>8)&255,bl=col&255;double rgb[3]={decode(r),decode(gr),decode(bl)},target[3]{};
  for(int k=0;k<3;k++)for(int j=0;j<3;j++)target[k]+=xyz[j][k]*rgb[j];
  double warm=std::max(0.,std::min(1.,((r-bl)/255.)*2+.42)),bw=0,bc=0;
  for(double t=0;t<=1.7;t+=.005){double w=t*warm,cold=t*(1-warm);if(w>1.15||cold>1.15)break;double trial[3]{},rem[3];for(int k=0;k<3;k++)rem[k]=target[k]-(w*xyz[3][k]+cold*xyz[4][k]);for(int k=0;k<3;k++)for(int j=0;j<3;j++)trial[k]+=inv[k][j]*rem[j];if(trial[0]<-1e-6||trial[1]<-1e-6||trial[2]<-1e-6)break;for(int k=0;k<3;k++)rgb[k]=trial[k];bw=w;bc=cold;}
  double m=std::max(1e-9,std::max(rgb[0],std::max(rgb[1],rgb[2])));
  return {encode(m*pow(std::max(0.,rgb[0])/m,1.65)),encode(m*pow(std::max(0.,rgb[1])/m,1.65)),encode(m*pow(std::max(0.,rgb[2])/m,1.65)),encode(bw),encode(bc)};
}
static std::string canonical(std::string e){if(e=="Solid"||e=="Solid / Static")return "Static";if(e=="Jump")return "Cycle";if(e=="Breath")return "Breathe";if(e=="Strobe"||e=="Twinkle / Sparkle")return "Twinkle";if(e=="Chase"||e=="Gradient Sweep"||e=="Candy Cane"||e=="Rainbow Flow")return "Flow1";if(e=="Wipe / Fill"||e=="Meteor / Comet")return "Streamlight";if(e=="Pulse Wave")return "Breathe";return e;}
Buffer effect(bool e22,const std::string&raw,std::vector<uint32_t>colors,int speed,bool reverse,int lamps,int level,const Pattern&p){
  std::string name=canonical(raw);if(colors.empty())colors.push_back(0xffffff);if(colors.size()>8)colors.resize(8);if(name=="Streamlight"&&colors.size()==1)colors.push_back(0);
  const char* names[]={"Flow1","Flow2","Cycle","Streamlight","Twinkle","Breathe","Static"};int mode=-1;for(int n=0;n<7;n++)if(name==names[n])mode=20000+n;if(mode<0)return {};
  if(reverse&&mode==20000)mode=20001;else if(reverse&&mode==20001)mode=20000;
  Buffer out;tlv(out,0xa3,le16(mode));int direction=0;
  if(e22){if(mode==20000||mode==20002||mode==20003)direction=1;if(reverse&&(mode==20002||mode==20003))direction^=1;if(mode!=20001)tlv(out,0xa4,le16(direction));}else tlv(out,0xa4,le16(0));
  tlv(out,0xa5,{(uint8_t)clamp(speed,1,10)});Buffer pal={(uint8_t)colors.size()};for(auto color:colors){Buffer c=e22?rgbcw(color):Buffer{(uint8_t)(color>>16),(uint8_t)(color>>8),(uint8_t)color,0};pal.insert(pal.end(),c.begin(),c.end());}tlv(out,0xa6,pal);
  lamps=clamp(lamps,1,120);Buffer assignment;
  if(colors.size()==1||(p.blocks.empty()&&!p.positions.empty()&&colors.size()!=2)){assignment.push_back(lamps);for(int i=0;i<lamps;i++)assignment.push_back(i);}
  else{
    std::vector<Buffer>groups(colors.size());std::vector<int>blocks;
    for(size_t i=0;i<colors.size();i++)blocks.push_back(p.blocks.empty()?1:clamp(p.blocks[i%p.blocks.size()],1,12));
    int period=0;for(auto n:blocks)period+=n;int offset=((p.offset%period)+period)%period;
    bool explicitPos=!p.positions.empty()&&colors.size()==2;bool patterned=!p.blocks.empty()||!p.positions.empty();
    for(int l=0;l<lamps;l++){
      int ci=0;if(explicitPos)ci=std::find(p.positions.begin(),p.positions.end(),l)!=p.positions.end()?1:0;
      else{int pp=p.mirror?std::min(l,lamps-1-l):l;int pos=(pp+offset)%period;while(ci<(int)blocks.size()-1&&pos>=blocks[ci])pos-=blocks[ci++];}
      groups[ci].push_back(patterned&&reverse?lamps-1-l:l);
    }
    for(auto&group:groups){assignment.push_back(group.size());assignment.insert(assignment.end(),group.begin(),group.end());}
  }
  tlv(out,0xa7,assignment);tlv(out,0xa8,{(uint8_t)clamp(level,1,100)});tlv(out,0xa9,Buffer(e22?5:4,0));tlv(out,0xaa,{0});tlv(out,0xac,le32(0xffffffff));tlv(out,0xae,{0});tlv(out,0xb0,{0});return out;
}
}
