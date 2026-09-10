#include "Scheduler.h"
#include "EventCatalog.h"
#include <vector>
extern Theme applyEventOverrideByIndex(size_t i,const Theme& base);

bool Scheduler::inRunWindow(const tm& l) const{
  int m=l.tm_hour*60+l.tm_min,a=cfg->onMinutes,b=cfg->offMinutes;
  if(a==b)return true;if(a<b)return m>=a&&m<b;return m>=a||m<b;
}
Theme Scheduler::resolve(const tm& l){
  Theme normal;normal.name="Warm White";normal.effect=Effect::Jump;normal.colors[0]=0xFFDA7F;normal.colorCount=1;
  if(!cfg->schedulerEnabled)return normal;
  std::vector<size_t> exact,window,monthly,seasonal;
  for(size_t i=0;i<EVENT_COUNT;i++){if(!enabled(i))continue;const auto&e=EVENTS[i];if(eventActiveOn(i,l)){if(e.rule==RuleType::Month){if(e.kind==EventKind::Seasonal)seasonal.push_back(i);else monthly.push_back(i);}else exact.push_back(i);}else if(eventWindowActiveOn(i,l,cfg->leadDays,cfg->trailDays))window.push_back(i);}
  auto pickHolidayFirst=[&](std::vector<size_t>&v)->int{for(auto i:v)if(EVENTS[i].kind==EventKind::Holiday)return (int)i;return v.empty()?-1:(int)v[0];};
  int p=pickHolidayFirst(exact);if(p>=0)return applyEventOverrideByIndex(p,themeFromEvent(p));p=pickHolidayFirst(window);if(p>=0)return applyEventOverrideByIndex(p,themeFromEvent(p));
  if(!monthly.empty()){
    if(monthly.size()==1)return applyEventOverrideByIndex(monthly[0],themeFromEvent(monthly[0]));
    if(cfg->overlap==2){Theme t;t.name="Combined Monthly Themes";t.effect=Effect::Gradient;t.colorCount=0;for(auto i:monthly){Theme et=applyEventOverrideByIndex(i,themeFromEvent(i));for(int c=0;c<et.colorCount && t.colorCount<8;c++)t.colors[t.colorCount++]=et.colors[c];}return t;}
    int idx=0;if(cfg->overlap==0)idx=(l.tm_mday-1)%monthly.size();else{int mins=l.tm_hour*60+l.tm_min,start=cfg->onMinutes,end=cfg->offMinutes;if(end<=start)end+=1440;if(mins<start)mins+=1440;int span=max(1,end-start),pos=constrain(mins-start,0,span-1);idx=min((int)monthly.size()-1,(int)(pos*monthly.size()/span));}return applyEventOverrideByIndex(monthly[idx],themeFromEvent(monthly[idx]));
  }
  if(!seasonal.empty())return applyEventOverrideByIndex(seasonal[0],themeFromEvent(seasonal[0]));return normal;
}
String Scheduler::nextEventLabel(const tm& l) const{
  int y=l.tm_year+1900;time_t now=mktime((tm*)&l),best=0;int bi=-1;
  for(size_t i=0;i<EVENT_COUNT;i++){if(!enabled(i)||EVENTS[i].rule==RuleType::Month)continue;for(int yy=y;yy<=y+1;yy++){time_t s=eventStartEpoch(i,yy);if(s>now && (!best||s<best)){best=s;bi=i;}}}
  if(bi<0)return "—";return String(EVENTS[bi].name)+" • "+eventWhen(bi,localtime(&best)->tm_year+1900);
}
