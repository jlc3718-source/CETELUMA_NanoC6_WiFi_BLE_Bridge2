#include "ColorCorrection.h"
#include <math.h>

const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE[] = {
  {0xFF0000,0xFF0000},
  {0xFF9500,0xFF3000},
  {0xFFFF00,0xFFFF00},
  {0xFACC15,0xF18900},
  {0xF59E0B,0xE44300},
  {0x22C55E,0x00FF00},
  {0x86EFAC,0x2AD555},
  {0x2563EB,0x0000FF},
  {0x0EA5E9,0x004BC6},
  {0x93C5FD,0x377CF9},
  {0x32D7D5,0x00FFFF},
  {0x14B8A6,0x00664D},
  {0x7E22CE,0x23018C},
  {0xC4B5FD,0x7A62F9},
  {0xFF00FF,0xFF00FF},
  {0xFF2D55,0xFF020C},
  {0xFF69B4,0xFF1560},
  {0xF9A8D4,0xEF4F98},
  {0xFFFFFF,0xFFFFFF},
  {0xFFF1C7,0xFFDA7F},
  {0xDBEAFE,0xA7C8FC},
  {0x92400E,0x360500},
  {0x7C2D12,0x220200},
  {0x000000,0x000000}
};
const size_t ANDERSON_COLOR_PALETTE_COUNT=sizeof(ANDERSON_COLOR_PALETTE)/sizeof(ANDERSON_COLOR_PALETTE[0]);

struct LabColor{float l,a,b;};
struct DirectMap{uint32_t source,output;};

// Exact user matches plus the historical Anderson event/UI colors. Known source
// colors are mapped by their intended named family before CIEDE2000 is used for
// genuinely unknown saved colors. In particular, blue-family source colors can
// never drift into Purple/Lavender simply because of a perceptual near-tie.
static constexpr DirectMap DIRECT_MAP[] = {
  // Red family.
  {0xFF0000,0xFF0000},{0xFF3B30,0xFF0000},{0xEF4444,0xFF0000},{0xDC2626,0xFF0000},{0xEF233C,0xFF0000},{0xFF1744,0xFF0000},{0xE11D48,0xFF0000},
  {0xFF4D6D,0xFF020C},{0xFF2D55,0xFF020C},
  // Orange / gold / amber / yellow families.
  {0xFF9500,0xFF3000},{0xFF7A00,0xFF3000},{0xF97316,0xFF3000},{0xFF6B35,0xFF3000},
  {0xFACC15,0xF18900},{0xF5D76E,0xF18900},{0xFBBF24,0xF18900},{0xF59E0B,0xE44300},{0xFFFF00,0xFFFF00},{0xFDE68A,0xFFDA7F},
  // Green / mint families.
  {0x00FF00,0x00FF00},{0x34C759,0x00FF00},{0x22C55E,0x00FF00},{0x16A34A,0x00FF00},{0x86EFAC,0x2AD555},
  // Blue families. Preserve source lightness distinctions explicitly.
  {0x0000FF,0x0000FF},{0x0A84FF,0x0000FF},{0x2563EB,0x0000FF},{0x3B82F6,0x0000FF},
  {0x0EA5E9,0x004BC6},{0x5BC0EB,0x004BC6},{0x38BDF8,0x004BC6},
  {0x93C5FD,0x377CF9},{0x60A5FA,0x377CF9},{0xDBEAFE,0xA7C8FC},
  // Cyan / teal remain distinct from blue and green.
  {0x00FFFF,0x00FFFF},{0x32D7D5,0x00FFFF},{0x14B8A6,0x00664D},{0x2DD4BF,0x00664D},
  // Purple / lavender / magenta families.
  {0x7E22CE,0x23018C},{0xA855F7,0x23018C},{0xBF5AF2,0x23018C},{0xC4B5FD,0x7A62F9},{0xFF00FF,0xFF00FF},
  // Pink families.
  {0xFF69B4,0xFF1560},{0xEC4899,0xFF1560},{0xFF2D92,0xFF1560},{0xF9A8D4,0xEF4F98},
  // White / brown / black families.
  {0xFFFFFF,0xFFFFFF},{0xFFF1C7,0xFFDA7F},{0x92400E,0x360500},{0xB45309,0x360500},{0x7C2D12,0x220200},{0x000000,0x000000},{0x111111,0x000000}
};

static float srgbLinear(float v){v/=255.0f;return v<=0.04045f?v/12.92f:powf((v+0.055f)/1.055f,2.4f);}
static LabColor rgbToLab(uint32_t c){
  float r=srgbLinear((c>>16)&0xFF),g=srgbLinear((c>>8)&0xFF),b=srgbLinear(c&0xFF);
  float x=(r*0.4124564f+g*0.3575761f+b*0.1804375f)/0.95047f;
  float y=(r*0.2126729f+g*0.7151522f+b*0.0721750f);
  float z=(r*0.0193339f+g*0.1191920f+b*0.9503041f)/1.08883f;
  const float d=6.0f/29.0f,d3=d*d*d;
  auto f=[&](float t){return t>d3?cbrtf(t):(t/(3.0f*d*d)+4.0f/29.0f);};
  float fx=f(x),fy=f(y),fz=f(z);return {116.0f*fy-16.0f,500.0f*(fx-fy),200.0f*(fy-fz)};
}
static float deg(float r){return r*57.29577951308232f;}
static float rad(float d){return d*0.017453292519943295f;}
static float hue(float a,float b){if(a==0&&b==0)return 0;float h=deg(atan2f(b,a));return h<0?h+360.0f:h;}

static float deltaE2000(const LabColor& x,const LabColor& y){
  float c1=hypotf(x.a,x.b),c2=hypotf(y.a,y.b),cbar=(c1+c2)*0.5f;
  float cbar7=powf(cbar,7.0f),g=0.5f*(1.0f-sqrtf(cbar7/(cbar7+powf(25.0f,7.0f))));
  float a1=(1.0f+g)*x.a,a2=(1.0f+g)*y.a,cp1=hypotf(a1,x.b),cp2=hypotf(a2,y.b);
  float h1=hue(a1,x.b),h2=hue(a2,y.b),dL=y.l-x.l,dC=cp2-cp1,dh=h2-h1,dhp;
  if(cp1*cp2==0)dhp=0;else if(fabsf(dh)<=180.0f)dhp=dh;else if(dh>180.0f)dhp=dh-360.0f;else dhp=dh+360.0f;
  float dH=2.0f*sqrtf(cp1*cp2)*sinf(rad(dhp*0.5f));
  float lbar=(x.l+y.l)*0.5f,cpbar=(cp1+cp2)*0.5f,hbar;
  if(cp1*cp2==0)hbar=h1+h2;else if(fabsf(h1-h2)<=180.0f)hbar=(h1+h2)*0.5f;else if(h1+h2<360.0f)hbar=(h1+h2+360.0f)*0.5f;else hbar=(h1+h2-360.0f)*0.5f;
  float t=1.0f-0.17f*cosf(rad(hbar-30.0f))+0.24f*cosf(rad(2.0f*hbar))+0.32f*cosf(rad(3.0f*hbar+6.0f))-0.20f*cosf(rad(4.0f*hbar-63.0f));
  float dtheta=30.0f*expf(-powf((hbar-275.0f)/25.0f,2.0f));
  float cpbar7=powf(cpbar,7.0f),rc=2.0f*sqrtf(cpbar7/(cpbar7+powf(25.0f,7.0f)));
  float sl=1.0f+0.015f*powf(lbar-50.0f,2.0f)/sqrtf(20.0f+powf(lbar-50.0f,2.0f));
  float sc=1.0f+0.045f*cpbar,sh=1.0f+0.015f*cpbar*t,rt=-sinf(rad(2.0f*dtheta))*rc;
  float qL=dL/sl,qC=dC/sc,qH=dH/sh;return sqrtf(qL*qL+qC*qC+qH*qH+rt*qC*qH);
}

uint32_t andersonCorrectColor(uint32_t original){
  original&=0xFFFFFF;
  for(const auto& d:DIRECT_MAP)if(d.source==original)return d.output;
  LabColor source=rgbToLab(original);float best=1.0e9f;uint32_t output=original;
  for(size_t i=0;i<ANDERSON_COLOR_PALETTE_COUNT;i++){
    float distance=deltaE2000(source,rgbToLab(ANDERSON_COLOR_PALETTE[i].reference));
    if(distance<best){best=distance;output=ANDERSON_COLOR_PALETTE[i].output;}
  }
  return output;
}

static bool parseHex(const String& input,uint32_t& color){
  String s=input;s.trim();if(s.startsWith("#"))s.remove(0,1);if(s.length()!=6)return false;
  for(size_t i=0;i<6;i++){char c=s[i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F')))return false;}
  color=strtoul(s.c_str(),nullptr,16)&0xFFFFFF;return true;
}
String andersonCorrectHex(const String& original){
  uint32_t c;if(!parseHex(original,c))return original;c=andersonCorrectColor(c);char out[8];snprintf(out,sizeof(out),"#%06lX",(unsigned long)c);return String(out);
}
