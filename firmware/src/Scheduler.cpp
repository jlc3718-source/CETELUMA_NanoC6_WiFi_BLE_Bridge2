#include "Scheduler.h"
#include "EventCatalog.h"
#include "EventState.h"
#include <math.h>
extern Theme applyEventOverrideByIndex(size_t i,const Theme& base);

static constexpr double ANDERSON_LATITUDE_DEG=42.16;
static constexpr double ANDERSON_LONGITUDE_DEG=-78.97;
static constexpr double CIVIL_DAWN_ZENITH_DEG=96.0;
static constexpr double RAD_PER_DEG=3.14159265358979323846/180.0;
static constexpr size_t MAX_ACTIVE_TIER_EVENTS=64;

static double normalizeDegrees(double v){while(v<0.0)v+=360.0;while(v>=360.0)v-=360.0;return v;}
static double normalizeHours(double v){while(v<0.0)v+=24.0;while(v>=24.0)v-=24.0;return v;}
static int localUtcOffsetMinutes(const tm& l){
  time_t epoch=time(nullptr);tm utc{};gmtime_r(&epoch,&utc);
  int localMin=l.tm_hour*60+l.tm_min,utcMin=utc.tm_hour*60+utc.tm_min;
  int dayDiff=l.tm_yday-utc.tm_yday;if(dayDiff>1)dayDiff=-1;else if(dayDiff<-1)dayDiff=1;
  return constrain(localMin-utcMin+dayDiff*1440,-840,840);
}
static bool localLeapYear(int y){return (y%4==0&&y%100!=0)||y%400==0;}
static int localDaysInMonth(int y,int m){static const uint8_t days[]={31,28,31,30,31,30,31,31,30,31,30,31};return m==2?days[1]+(localLeapYear(y)?1:0):days[m-1];}

// Split one Schedule-1 night evenly among same-priority events. When resolve() is
// called for Schedule 2, elapsed time is past Schedule-1 END and clamps to the final
// slot, so Schedule 2 continues the last scene at 30% exactly as before.
static uint16_t timedTierPick(const uint16_t* items,size_t count,const tm& l,const AppSettings* cfg){
  if(!count)return 0;if(count==1)return items[0];
  int nowSec=l.tm_hour*3600+l.tm_min*60+l.tm_sec,onSec=(int)cfg->onMinutes*60,offSec=(int)cfg->offMinutes*60;
  int span=offSec-onSec;if(span<=0)span+=24*3600;
  int elapsed=nowSec-onSec;if(elapsed<0)elapsed+=24*3600;if(elapsed>=span)elapsed=span-1;
  size_t slot=(size_t)(((int64_t)elapsed*(int64_t)count)/max(1,span));if(slot>=count)slot=count-1;return items[slot];
}

static uint32_t enabledEventHash(){
  uint32_t h=2166136261u;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){h^=(uint32_t)(eventStateEnabled(i)?(i+1):0);h*=16777619u;}
  return h;
}
static bool higherPriorityThanMonthlyOn(const tm& day,const AppSettings* cfg){
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){
    if(!eventStateEnabled(i))continue;const auto&e=EVENTS[i];if(e.rule==RuleType::Month)continue;
    bool active=eventActiveOn(i,day);if(active)return true;
    if(e.kind==EventKind::Holiday&&(cfg->leadDays||cfg->trailDays)&&eventWindowActiveOn(i,day,cfg->leadDays,cfg->trailDays))return true;
  }
  return false;
}
struct MonthlyEligibilityCache{
  int year=-1,month=-1;uint8_t lead=255,trail=255;uint32_t enabledHash=0;bool eligible[32]={false};uint8_t total=0;
};
static MonthlyEligibilityCache monthlyEligibilityCache;
static void monthlyEligiblePosition(const tm& l,const AppSettings* cfg,size_t& ordinal,size_t& total){
  int year=l.tm_year+1900,month=l.tm_mon+1;uint32_t stateHash=enabledEventHash();auto& c=monthlyEligibilityCache;
  if(c.year!=year||c.month!=month||c.lead!=cfg->leadDays||c.trail!=cfg->trailDays||c.enabledHash!=stateHash){
    c=MonthlyEligibilityCache();c.year=year;c.month=month;c.lead=cfg->leadDays;c.trail=cfg->trailDays;c.enabledHash=stateHash;
    int days=localDaysInMonth(year,month);for(int d=1;d<=days;d++){tm probe=l;probe.tm_mday=d;probe.tm_hour=12;probe.tm_min=0;probe.tm_sec=0;probe.tm_isdst=-1;mktime(&probe);c.eligible[d]=!higherPriorityThanMonthlyOn(probe,cfg);if(c.eligible[d])c.total++;}
  }
  ordinal=0;for(int d=1;d<l.tm_mday&&d<32;d++)if(c.eligible[d])ordinal++;total=c.total;
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
  uint16_t specific[MAX_ACTIVE_TIER_EVENTS],holidayWindows[MAX_ACTIVE_TIER_EVENTS],monthly[MAX_ACTIVE_TIER_EVENTS];
  size_t specificCount=0,holidayWindowCount=0,monthlyCount=0;
  for(size_t i=0;i<EVENT_COUNT;i++){
    if(i>=MAX_BUILTIN_EVENTS||!eventStateEnabled(i))continue;const auto&e=EVENTS[i];bool active=eventActiveOn(i,l);
    if(active){
      if(e.rule==RuleType::Month){if(monthlyCount<MAX_ACTIVE_TIER_EVENTS)monthly[monthlyCount++]=(uint16_t)i;continue;}
      // Holiday, awareness, and seasonal dates all share the specific-event tier.
      // This matches the UI rule and prevents a long-running holiday from starving
      // another specific observance that lands inside it.
      if(specificCount<MAX_ACTIVE_TIER_EVENTS)specific[specificCount++]=(uint16_t)i;continue;
    }
    if(e.kind==EventKind::Holiday&&(cfg->leadDays||cfg->trailDays)&&eventWindowActiveOn(i,l,cfg->leadDays,cfg->trailDays)){
      if(holidayWindowCount<MAX_ACTIVE_TIER_EVENTS)holidayWindows[holidayWindowCount++]=(uint16_t)i;
    }
  }
  if(specificCount){uint16_t pick=timedTierPick(specific,specificCount,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
  if(holidayWindowCount){uint16_t pick=timedTierPick(holidayWindows,holidayWindowCount,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
  if(monthlyCount){
    if(cfg->overlap==0){
      size_t ordinal=0,eligibleTotal=0;monthlyEligiblePosition(l,cfg,ordinal,eligibleTotal);
      if(!eligibleTotal){uint16_t pick=monthly[0];return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
      if(eligibleTotal>=monthlyCount){uint16_t pick=monthly[ordinal%monthlyCount];return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
      // If higher-priority dates leave fewer monthly-only nights than enabled month
      // themes, assign a small group to each remaining night and split that night.
      size_t start=(ordinal*monthlyCount)/eligibleTotal,end=((ordinal+1)*monthlyCount)/eligibleTotal;
      if(end<=start)end=min(monthlyCount,start+1);uint16_t pick=timedTierPick(monthly+start,end-start,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));
    }
    if(cfg->overlap==1){uint16_t pick=timedTierPick(monthly,monthlyCount,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
    Theme t;t.name="Combined monthly events";t.effect=Effect::Breath;t.colorCount=0;for(size_t n=0;n<monthlyCount&&t.colorCount<8;n++){Theme q=applyEventOverrideByIndex(monthly[n],themeFromEvent(monthly[n]));for(uint8_t c=0;c<q.colorCount&&t.colorCount<8;c++)t.colors[t.colorCount++]=q.colors[c];}if(!t.colorCount){t.colors[0]=0xFFFFFA;t.colorCount=1;}return t;
  }
  return normal;
}

String Scheduler::nextEventLabel(const tm& l) const{
  int y=l.tm_year+1900;tm copy=l;time_t now=mktime(&copy),best=0;int bi=-1;
  for(size_t i=0;i<EVENT_COUNT;i++){if(!eventStateEnabled(i)||EVENTS[i].rule==RuleType::Month)continue;for(int yy=y;yy<=y+1;yy++){time_t s=eventStartEpoch(i,yy);if(s>now&&(!best||s<best)){best=s;bi=i;}}}
  if(bi<0)return "-";tm out{};localtime_r(&best,&out);return String(EVENTS[bi].name)+" - "+eventWhen(bi,out.tm_year+1900);
}
