#include "SmartDawnProtocol.h"
#include <assert.h>
#include <stdio.h>
int main(){
 using namespace SmartDawn;
 assert(nativeBrightness(0)==-1 && nativeBrightness(101)==-1);
 assert(nativeBrightness(1)==4 && nativeBrightness(100)==100);
 assert(rawBrightness(1)==10 && rawBrightness(100)==255);
 Effect e{};assert(effectInfo(0,e)&&e.group==15924&&e.index==0);
 assert(effectInfo(54,e)&&e.group==15924&&e.index==54);
 assert(effectInfo(55,e)&&e.group==15193&&e.index==0);
 assert(effectInfo(85,e)&&e.group==15224&&e.index==30);
 assert(effectInfo(86,e)&&e.group==15225&&e.index==31);
 assert(effectInfo(87,e)&&e.group==83494&&e.index==33);
 assert(!effectInfo(88,e));
 for(int i=0;i<88;i++){Effect x{};assert(effectInfo(i,x));Session all{};Frame first{},second{};assert(effectFrames(all,i,first,second));}
 Session s{};Frame a{},b{};
 assert(effectFrames(s,3,a,b)&&a.length==24&&a.bytes[10]==0x09&&a.bytes[11]==0x6a);
 assert(b.bytes[10]==0x0a&&b.bytes[11]==0x2e&&b.bytes[24]==8);
 assert(a.bytes[0]==1&&a.bytes[6]==0&&a.bytes[7]==1);
 assert(b.bytes[0]==2&&b.bytes[6]==0&&b.bytes[7]==2);
 assert(scalarFrame(s,0x09cd,10,a)&&a.bytes[10]==9&&a.bytes[11]==0xcd&&a.bytes[24]==8&&a.bytes[25]==10);
 printf("SmartDawn protocol tests passed\n");
}
