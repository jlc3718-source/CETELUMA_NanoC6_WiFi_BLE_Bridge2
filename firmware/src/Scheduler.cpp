#include "Scheduler.h"
#include "EventCatalog.h"
#include "EventState.h"
#include <vector>
#include <math.h>
extern Theme applyEventOverrideByIndex(size_t i,const Theme& base);

static constexpr double ANDERSON_LATITUDE_DEG=42.16;
static constexpr double ANDERSON_LONGITUDE_DEG=-78.97;
static constexpr double CIVIL_DAWN_ZENITH_DEG=96.0;
static constexpr double DEG_TO_RAD=3.14159265358979323846/180.0;

static double normalizeDegrees(double v){while(v<0.0)v+=360.0;while(v>=360.0)v-=360.0;return v;}
static double normalizeHours(double v){while(v<0.0)v+=24.0;while(v>=24.0)v-=24.0;return v;}
static int localUtcOffsetMinutes(const tm& l){
  time_t epoch=time(nullptr);tm utc{};gmtime_r(&epoch,&utc);
  int localMin=l.tm_hour*60+l.tm_min,utcMin=utc.tm_hour*60+utc.tm_min;
  int dayDiff=l.tm_yday-utc.tm_yday;if(dayDiff>1)dayDiff=-1;else if(dayDiff<-1)dayDiff=1;
  return constrain(localMin-utcMin+dayDiff*1440,-840,840);
}

bool Scheduler::inRunWindow(const tm& l) const{
  int m=l.tm_hour*60+l.tm_min,a=cfg->onMinutes,b=cfg->offMinutes;
  if(a==b)return true;if(a<b)return m>=a&&m<b;return m>=a||m<b;
}
uint16_t Scheduler::civilDawnMinutes(const tm& l) const{
  const int n=l.tm_yday+1;const double lngHour=ANDERSON_LONGITUDE_DEG/15.0;
  const double t=n+((6.0-lngHour)/24.0),M=0.9856*t-3.289;
  double L=normalizeDegrees(M+1.916*sin(M*DEG_TO_RAD)+0.020*sin(2.0*M*DEG_TO_RAD)+282.634);
  double RA=normalizeDegrees(atan(0.91764*tan(L*DEG_TO_RAD))/DEG_TO_RAD);
  const double lQuadrant=floor(L/90.0)*90.0,raQuadrant=floor(RA/90.0)*90.0;RA=(RA+(lQuadrant-raQuadrant))/15.0;
  const double sinDec=0.39782*sin(L*DEG_TO_RAD),cosDec=cos(asin(sinDec));
  const double cosH=(cos(CIVIL_DAWN_ZENITH_DEG*DEG_TO_RAD)-sinDec*sin(ANDERSON_LATITUDE_DEG*DEG_TO_RAD))/(cosDec*cos(ANDERSON_LATITUDE_DEG*DEG_TO_RAD));
  if(cosH>1.0||cosH<-1.0)return 6*60;
  const double H=(360.0-(acos(cosH)/DEG_TO_RAD))/15.0;
  const double localHours=normalizeHours(H+RA-(0.06571*t)-6.622-lngHour+(localUtcOffsetMinutes(l)/60.0));
  int minutes=(int)lround(localHours*60.0);if(minutes>=1440)minutes-=1440;if(minutes<0)minutes+=1440;return (uint16_t)minutes;
}
bool Scheduler::inSchedule2Window(const tm& l) const{
  int m=l.tm_hour*60+l.tm_min,a=cfg->offMinutes,b=civilDawnMinutes(l);
  if(a==b)return false;if(a<b)return m>=a&&m<b;return m>=a||m<b;
}
Theme Scheduler::resolve(const tm& l){
  Theme normal;normal.name="Warm White";normal.effect=Effect::Solid;normal.colors[0]=0xFFFFFA;normal.colorCount=1;
  std::vector<size_t> exact,multiHoliday,monthly,seasonal;
  for(size_t i=0;i<EVENT_COUNT;i++){
    if(!eventStateEnabled(i)||!eventActiveOn(i,l))continue;const auto&e=EVENTS[i];
    if(e.rule==RuleType::Month||(e.kind==EventKind::Awareness&&e.durationDays>1)){if(e.kind==EventKind::Seasonal)seasonal.push_back(i);else monthly.push_back(i);}
    else if(e.kind==EventKind::Holiday&&e.durationDays>1)multiHoliday.push_back(i);
    else exact.push_back(i);
  }
  auto pickHolidayFirst=[&](const std::vector<size_t>&v)->int{for(auto i:v)if(EVENTS[i].kind==EventKind::Holiday)return (int)i;return v.empty()?-1:(int)v[0];};
  int p=pickHolidayFirst(exact);if(p>=0)return applyEventOverrideByIndex(p,themeFromEvent(p));
  p=pickHolidayFirst(multiHoliday);if(p>=0)return applyEventOverrideByIndex(p,themeFromEvent(p));
  if(!monthly.empty()){
    if(monthly.size()==1)return applyEventOverrideByIndex(monthly[0],themeFromEvent(monthly[0]));
    if(cfg->overlap==2){Theme t;t.name="Combined Monthly Themes";t.effect=Effect::Gradient;t.colorCount=0;for(auto i:monthly){Theme et=applyEventOverrideByIndex(i,themeFromEvent(i));for(int c=0;c<et.colorCount&&t.colorCount<8;c++)t.colors[t.colorCount++]=et.colors[c];}return t;}
    int idx=0;if(cfg->overlap==0)idx=(l.tm_mday-1)%monthly.size();else{int mins=l.tm_hour*60+l.tm_min,start=cfg->onMinutes,end=cfg->offMinutes;if(end<=start)end+=1440;if(mins<start)mins+=1440;int span=max(1,end-start),pos=constrain(mins-start,0,span-1);idx=min((int)monthly.size()-1,(int)(pos*monthly.size()/span));}
    return applyEventOverrideByIndex(monthly[idx],themeFromEvent(monthly[idx]));
  }
  if(!seasonal.empty())return applyEventOverrideByIndex(seasonal[0],themeFromEvent(seasonal[0]));return normal;
}
String Scheduler::nextEventLabel(const tm& l) const{
  int y=l.tm_year+1900;tm copy=l;time_t now=mktime(&copy),best=0;int bi=-1;
  for(size_t i=0;i<EVENT_COUNT;i++){if(!eventStateEnabled(i)||EVENTS[i].rule==RuleType::Month)continue;for(int yy=y;yy<=y+1;yy++){time_t s=eventStartEpoch(i,yy);if(s>now&&(!best||s<best)){best=s;bi=i;}}}
  if(bi<0)return "-";tm out{};localtime_r(&best,&out);return String(EVENTS[bi].name)+" - "+eventWhen(bi,out.tm_year+1900);
}
