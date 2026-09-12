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

static void schedulePosition(const tm& l,const AppSettings* cfg,int& elapsed,int& span){
  int nowSec=l.tm_hour*3600+l.tm_min*60+l.tm_sec,onSec=(int)cfg->onMinutes*60,offSec=(int)cfg->offMinutes*60;
  span=offSec-onSec;if(span<=0)span+=24*3600;elapsed=nowSec-onSec;if(elapsed<0)elapsed+=24*3600;if(elapsed>=span)elapsed=span-1;if(elapsed<0)elapsed=0;
}
static uint16_t tierPickAt(const uint16_t* items,size_t count,int elapsed,int span){
  if(!count)return 0;if(count==1)return items[0];if(span<=0)span=1;elapsed=constrain(elapsed,0,span-1);
  size_t slot=(size_t)(((int64_t)elapsed*(int64_t)count)/(int64_t)span);if(slot>=count)slot=count-1;return items[slot];
}
// Split one Schedule-1 night evenly among same-priority events. Schedule 2 clamps
// to the final Schedule-1 slot, preserving the last scene overnight at 30%.
static uint16_t timedTierPick(const uint16_t* items,size_t count,const tm& l,const AppSettings* cfg){int elapsed=0,span=1;schedulePosition(l,cfg,elapsed,span);return tierPickAt(items,count,elapsed,span);}

static uint32_t enabledEventHash(){
  uint32_t h=2166136261u;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){h^=(uint32_t)(eventStateEnabled(i)?(i+1):0);h*=16777619u;}
  return h;
}
static uint8_t higherPriorityCountOn(const tm& day,const AppSettings* cfg){
  uint8_t count=0;
  for(size_t i=0;i<EVENT_COUNT&&i<MAX_BUILTIN_EVENTS;i++){
    if(!eventStateEnabled(i))continue;const auto&e=EVENTS[i];if(e.rule==RuleType::Month)continue;
    bool active=eventActiveOn(i,day);if(active){if(count<255)count++;continue;}
    if(e.kind==EventKind::Holiday&&(cfg->leadDays||cfg->trailDays)&&eventWindowActiveOn(i,day,cfg->leadDays,cfg->trailDays)){if(count<255)count++;}
  }
  return count;
}
struct MonthlyEligibilityCache{
  int year=-1,month=-1;uint8_t lead=255,trail=255;uint32_t enabledHash=0;bool eligible[32]={false};uint8_t total=0,forcedDay=0;
};
static MonthlyEligibilityCache monthlyEligibilityCache;
static void monthlyEligiblePosition(const tm& l,const AppSettings* cfg,size_t& ordinal,size_t& total,uint8_t& forcedDay){
  int year=l.tm_year+1900,month=l.tm_mon+1;uint32_t stateHash=enabledEventHash();auto& c=monthlyEligibilityCache;
  if(c.year!=year||c.month!=month||c.lead!=cfg->leadDays||c.trail!=cfg->trailDays||c.enabledHash!=stateHash){
    c=MonthlyEligibilityCache();c.year=year;c.month=month;c.lead=cfg->leadDays;c.trail=cfg->trailDays;c.enabledHash=stateHash;
    int days=localDaysInMonth(year,month);uint8_t lowest=255;
    for(int d=1;d<=days;d++){
      tm probe=l;probe.tm_mday=d;probe.tm_hour=12;probe.tm_min=0;probe.tm_sec=0;probe.tm_isdst=-1;mktime(&probe);uint8_t high=higherPriorityCountOn(probe,cfg);
      c.eligible[d]=high==0;if(c.eligible[d])c.total++;
      // If every date is occupied, choose the least-conflicted date for one
      // protected monthly coverage slice. This is the only lower-tier exception.
      if(high<lowest){lowest=high;c.forcedDay=(uint8_t)d;}
    }
  }
  ordinal=0;for(int d=1;d<l.tm_mday&&d<32;d++)if(c.eligible[d])ordinal++;total=c.total;forcedDay=c.forcedDay;
}
static Theme combinedMonthlyTheme(const uint16_t* monthly,size_t monthlyCount){
  Theme t;t.name="Combined monthly events";t.effect=Effect::Breath;t.colorCount=0;
  for(size_t n=0;n<monthlyCount&&t.colorCount<8;n++){Theme q=applyEventOverrideByIndex(monthly[n],themeFromEvent(monthly[n]));for(uint8_t c=0;c<q.colorCount&&t.colorCount<8;c++)t.colors[t.colorCount++]=q.colors[c];}
  if(!t.colorCount){t.colors[0]=0xFFFFFA;t.colorCount=1;}return t;
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
      // Same-tier collisions share Schedule 1 instead of silently starving later events.
      if(specificCount<MAX_ACTIVE_TIER_EVENTS)specific[specificCount++]=(uint16_t)i;continue;
    }
    if(e.kind==EventKind::Holiday&&(cfg->leadDays||cfg->trailDays)&&eventWindowActiveOn(i,l,cfg->leadDays,cfg->trailDays)){
      if(holidayWindowCount<MAX_ACTIVE_TIER_EVENTS)holidayWindows[holidayWindowCount++]=(uint16_t)i;
    }
  }

  size_t monthlyOrdinal=0,monthlyEligibleTotal=0;uint8_t forcedCoverageDay=0;
  if(monthlyCount)monthlyEligiblePosition(l,cfg,monthlyOrdinal,monthlyEligibleTotal,forcedCoverageDay);
  const bool forcedMonthlyCoverage=monthlyCount&&monthlyEligibleTotal==0&&forcedCoverageDay==(uint8_t)l.tm_mday&&(specificCount||holidayWindowCount);
  if(forcedMonthlyCoverage){
    // Extremely rare case: a whole calendar month is occupied by higher-priority
    // specific dates/windows. Reserve only the first third of the least-conflicted
    // Schedule-1 night for monthly coverage. Higher-priority scenes keep the final
    // two thirds and therefore remain the scene continued by Schedule 2.
    int elapsed=0,span=1;schedulePosition(l,cfg,elapsed,span);int monthlySpan=max(1,span/3);
    if(elapsed<monthlySpan){
      if(cfg->overlap==2)return combinedMonthlyTheme(monthly,monthlyCount);
      uint16_t pick=tierPickAt(monthly,monthlyCount,elapsed,monthlySpan);return applyEventOverrideByIndex(pick,themeFromEvent(pick));
    }
    int highElapsed=elapsed-monthlySpan,highSpan=max(1,span-monthlySpan);
    if(holidayWindowCount&&specificCount){
      // Window events get the first third of the remaining high-priority span;
      // exact specific events finish the night and continue through Schedule 2.
      int windowSpan=max(1,highSpan/3);
      if(highElapsed<windowSpan){uint16_t pick=tierPickAt(holidayWindows,holidayWindowCount,highElapsed,windowSpan);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
      uint16_t pick=tierPickAt(specific,specificCount,highElapsed-windowSpan,max(1,highSpan-windowSpan));return applyEventOverrideByIndex(pick,themeFromEvent(pick));
    }
    if(specificCount){uint16_t pick=tierPickAt(specific,specificCount,highElapsed,highSpan);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
    uint16_t pick=tierPickAt(holidayWindows,holidayWindowCount,highElapsed,highSpan);return applyEventOverrideByIndex(pick,themeFromEvent(pick));
  }

  if(specificCount){uint16_t pick=timedTierPick(specific,specificCount,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
  if(holidayWindowCount){uint16_t pick=timedTierPick(holidayWindows,holidayWindowCount,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
  if(monthlyCount){
    if(cfg->overlap==0){
      if(!monthlyEligibleTotal){uint16_t pick=monthly[0];return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
      if(monthlyEligibleTotal>=monthlyCount){uint16_t pick=monthly[monthlyOrdinal%monthlyCount];return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
      size_t start=(monthlyOrdinal*monthlyCount)/monthlyEligibleTotal,end=((monthlyOrdinal+1)*monthlyCount)/monthlyEligibleTotal;
      if(end<=start)end=min(monthlyCount,start+1);uint16_t pick=timedTierPick(monthly+start,end-start,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));
    }
    if(cfg->overlap==1){uint16_t pick=timedTierPick(monthly,monthlyCount,l,cfg);return applyEventOverrideByIndex(pick,themeFromEvent(pick));}
    return combinedMonthlyTheme(monthly,monthlyCount);
  }
  return normal;
}

String Scheduler::nextEventLabel(const tm& l) const{
  int y=l.tm_year+1900;tm copy=l;time_t now=mktime(&copy),best=0;int bi=-1;
  for(size_t i=0;i<EVENT_COUNT;i++){if(!eventStateEnabled(i)||EVENTS[i].rule==RuleType::Month)continue;for(int yy=y;yy<=y+1;yy++){time_t s=eventStartEpoch(i,yy);if(s>now&&(!best||s<best)){best=s;bi=i;}}}
  if(bi<0)return "-";tm out{};localtime_r(&best,&out);return String(EVENTS[bi].name)+" - "+eventWhen(bi,out.tm_year+1900);
}
