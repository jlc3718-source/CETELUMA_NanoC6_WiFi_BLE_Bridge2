#include "Scheduler.h"
#include "EventCatalog.h"
#include "EventState.h"
#include <math.h>
extern Theme applyEventOverrideByIndex(size_t i,const Theme& base);

static constexpr double ANDERSON_LATITUDE_DEG=42.16;
static constexpr double ANDERSON_LONGITUDE_DEG=-78.97;
static constexpr double CIVIL_DAWN_ZENITH_DEG=96.0;
static constexpr double RAD_PER_DEG=3.14159265358979323846/180.0;

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
  double L=normalizeDegrees(M+1.916*sin(M*RAD_PER_DEG)+0.020*sin(2.0*M*RAD_PER_DEG)+282.634);
  double RA=normalizeDegrees(atan(0.91764*tan(L*RAD_PER_DEG))/RAD_PER_DEG);
  const double lQuadrant=floor(L/90.0)*90.0,raQuadrant=floor(RA/90.0)*90.0;RA=(RA+(lQuadrant-raQuadrant))/15.0;
  const double sinDec=0.39782*sin(L*RAD_PER_DEG),cosDec=cos(asin(sinDec));
  const double cosH=(cos(CIVIL_DAWN_ZENITH_DEG*RAD_PER_DEG)-sinDec*sin(ANDERSON_LATITUDE_DEG*RAD_PER_DEG))/(cosDec*cos(ANDERSON_LATITUDE_DEG*RAD_PER_DEG));
  if(cosH>1.0||cosH<-1.0)return 6*60;
  const double H=(360.0-(acos(cosH)/RAD_PER_DEG))/15.0;
  const double localHours=normalizeHours(H+RA-(0.06571*t)-6.622-lngHour+(localUtcOffsetMinutes(l)/60.0));
  int minutes=(int)lround(localHours*60.0);if(minutes>=1440)minutes-=1440;if(minutes<0)minutes+=1440;return (uint16_t)minutes;
}
bool Scheduler::inSchedule2Window(const tm& l) const{
  int m=l.tm_hour*60+l.tm_min,a=cfg->offMinutes,b=civilDawnMinutes(l);
  if(a==b)return false;if(a<b)return m>=a&&m<b;return m>=a||m<b;
}
Theme Scheduler::resolve(const tm& l){
  Theme normal;normal.name="Warm White";normal.effect=Effect::Solid;normal.colors[0]=0xFFFFFA;normal.colorCount=1;
  int exactHoliday=-1,exactOther=-1,holidayWindow=-1,seasonal=-1;size_t monthly[64];size_t monthlyCount=0;
  for(size_t i=0;i<EVENT_COUNT;i++){
    if(i>=MAX_BUILTIN_EVENTS||!eventStateEnabled(i))continue;const auto&e=EVENTS[i];bool active=eventActiveOn(i,l);
    if(active){
      if(e.kind==EventKind::Seasonal){if(seasonal<0)seasonal=(int)i;continue;}
      if(e.rule==RuleType::Month){if(monthlyCount<64)monthly[monthlyCount++]=i;continue;}
      if(e.kind==EventKind::Holiday){if(exactHoliday<0)exactHoliday=(int)i;}else if(exactOther<0)exactOther=(int)i;continue;
    }
    if(e.kind==EventKind::Holiday&&(cfg->leadDays||cfg->trailDays)&&eventWindowActiveOn(i,l,cfg->leadDays,cfg->trailDays)&&holidayWindow<0)holidayWindow=(int)i;
  }
  if(exactHoliday>=0)return applyEventOverrideByIndex((size_t)exactHoliday,themeFromEvent((size_t)exactHoliday));
  if(exactOther>=0)return applyEventOverrideByIndex((size_t)exactOther,themeFromEvent((size_t)exactOther));
  if(holidayWindow>=0)return applyEventOverrideByIndex((size_t)holidayWindow,themeFromEvent((size_t)holidayWindow));
  if(monthlyCount){
    if(cfg->overlap==0){size_t pick=monthly[(l.tm_yday+(l.tm_year+1900))%monthlyCount];return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
    if(cfg->overlap==1){int mins=l.tm_hour*60+l.tm_min;uint16_t on=cfg->onMinutes,off=cfg->offMinutes;int elapsed=mins-on;if(elapsed<0)elapsed+=1440;int span=off-on;if(span<=0)span+=1440;size_t slot=min(monthlyCount-1,(size_t)((elapsed*monthlyCount)/max(1,span)));return applyEventOverrideByIndex(monthly[slot],themeFromEvent(monthly[slot]));}
    Theme t;t.name="Combined monthly events";t.effect=Effect::Breath;t.colorCount=0;for(size_t n=0;n<monthlyCount&&t.colorCount<8;n++){Theme q=applyEventOverrideByIndex(monthly[n],themeFromEvent(monthly[n]));for(uint8_t c=0;c<q.colorCount&&t.colorCount<8;c++)t.colors[t.colorCount++]=q.colors[c];}if(!t.colorCount){t.colors[0]=0xFFFFFA;t.colorCount=1;}return t;
  }
  if(seasonal>=0)return applyEventOverrideByIndex((size_t)seasonal,themeFromEvent((size_t)seasonal));
  return normal;
}

String Scheduler::nextEventLabel(const tm& l) const{
  int y=l.tm_year+1900;tm copy=l;time_t now=mktime(&copy),best=0;int bi=-1;
  for(size_t i=0;i<EVENT_COUNT;i++){if(!eventStateEnabled(i)||EVENTS[i].rule==RuleType::Month)continue;for(int yy=y;yy<=y+1;yy++){time_t s=eventStartEpoch(i,yy);if(s>now&&(!best||s<best)){best=s;bi=i;}}}
  if(bi<0)return "-";tm out{};localtime_r(&best,&out);return String(EVENTS[bi].name)+" - "+eventWhen(bi,out.tm_year+1900);
}
