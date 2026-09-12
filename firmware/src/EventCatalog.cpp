#include "EventCatalog.h"

#define C1(a) {a,0,0,0,0,0}
#define C2(a,b) {a,b,0,0,0,0}
#define C3(a,b,c) {a,b,c,0,0,0}
#define C4(a,b,c,d) {a,b,c,d,0,0}
#define C5(a,b,c,d,e) {a,b,c,d,e,0}
#define C6(a,b,c,d,e,f) {a,b,c,d,e,f}

const EventDef EVENTS[] = {
{"newyear","New Year's Day",EventKind::Holiday,RuleType::Fixed,1,1,0,0,0,1,Effect::Strobe,C3(0xFFFF44,0xFFFF44,0x0D00FF),3},
{"holocaust","Holocaust Remembrance Day",EventKind::Awareness,RuleType::Fixed,1,27,0,0,0,1,Effect::Jump,C2(0xFFFF44,0xFFFF44),2},
{"mlk","Martin Luther King Jr. Day",EventKind::Holiday,RuleType::NthWeekday,1,0,1,3,0,1,Effect::Gradient,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"heart","American Heart Month",EventKind::Awareness,RuleType::Month,2,0,0,0,0,1,Effect::Breath,C2(0xFF0D00,0xFF0024),2},
{"wearred","National Wear Red Day",EventKind::Awareness,RuleType::NthWeekday,2,0,5,1,0,1,Effect::Breath,C2(0xFF0D00,0xFF0D00),2},
{"presidents","Presidents' Day",EventKind::Holiday,RuleType::NthWeekday,2,0,1,3,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"valentine","Valentine's Day",EventKind::Holiday,RuleType::Fixed,2,14,0,0,0,1,Effect::Breath,C3(0xFF0024,0xFF0024,0xFFFF44),3},
{"mardigras","Mardi Gras",EventKind::Holiday,RuleType::EasterOffset,0,0,0,0,-47,1,Effect::Jump,C3(0x5B00E6,0x28FF00,0xFFFF44),3},
{"stpatrick","St. Patrick's Day",EventKind::Holiday,RuleType::Fixed,3,17,0,0,0,1,Effect::Jump,C3(0x28FF00,0x28FF00,0xFFFF44),3},
{"aprilfools","April Fools' Day",EventKind::Holiday,RuleType::Fixed,4,1,0,0,0,1,Effect::Strobe,C4(0xFF0D00,0x5B00E6,0x28FF00,0xFF0024),4},
{"autism","Autism Acceptance Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Gradient,C5(0xFFFF44,0x0D00FF,0x28FF00,0x5B00E6,0xFF0D00),5},
{"saam","Sexual Assault Awareness Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Gradient,C2(0x28FF00,0x28FF00),2},
{"easter","Easter",EventKind::Holiday,RuleType::EasterOffset,0,0,0,0,0,1,Effect::Gradient,C5(0xFF0024,0x5B00E6,0x0D00FF,0xFFFF44,0xFFFF44),5},
{"earth","Earth Day",EventKind::Awareness,RuleType::Fixed,4,22,0,0,0,1,Effect::Gradient,C3(0x28FF00,0x0D00FF,0x0D00FF),3},
{"mental","Mental Health Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Gradient,C2(0x28FF00,0x28FF00),2},
{"mothers","Mother's Day",EventKind::Holiday,RuleType::NthWeekday,5,0,0,2,0,1,Effect::Gradient,C3(0xFF0024,0xFF0024,0xFFFF44),3},
{"memorial","Memorial Day",EventKind::Holiday,RuleType::LastWeekday,5,0,1,0,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"pride","Pride Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Gradient,C6(0xFF0D00,0xFF0D00,0xFFFF44,0x28FF00,0x0D00FF,0x5B00E6),6},
{"alz","Alzheimer's & Brain Awareness Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Breath,C2(0x5B00E6,0x5B00E6),2},
{"ptsd","PTSD Awareness Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Gradient,C2(0x28FF00,0x0D00FF),2},
{"flag","Flag Day",EventKind::Holiday,RuleType::Fixed,6,14,0,0,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"fathers","Father's Day",EventKind::Holiday,RuleType::NthWeekday,6,0,0,3,0,1,Effect::Gradient,C3(0x0D00FF,0x0D00FF,0xFFFF44),3},
{"juneteenth","Juneteenth",EventKind::Holiday,RuleType::Fixed,6,19,0,0,0,1,Effect::Jump,C4(0xFF0D00,0x5B00E6,0x28FF00,0xFFFF44),4},
{"independence","Independence Day",EventKind::Holiday,RuleType::Fixed,7,4,0,0,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"labor","Labor Day",EventKind::Holiday,RuleType::NthWeekday,9,0,1,1,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"childcancer","Childhood Cancer Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Strobe,C2(0xFFFF44,0xFFFF44),2},
{"suicide","Suicide Prevention Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Gradient,C2(0x28FF00,0x5B00E6),2},
{"988","988 Day",EventKind::Awareness,RuleType::Fixed,9,8,0,0,0,1,Effect::Breath,C3(0x28FF00,0x5B00E6,0xFFFF44),3},
{"wspd","World Suicide Prevention Day",EventKind::Awareness,RuleType::Fixed,9,10,0,0,0,1,Effect::Gradient,C2(0x28FF00,0x5B00E6),2},
{"patriot","Patriot Day / 9-11 Remembrance",EventKind::Holiday,RuleType::Fixed,9,11,0,0,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"breast","Breast Cancer Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C2(0xFF0024,0xFF0024),2},
{"dv","Domestic Violence Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Gradient,C2(0x5B00E6,0x5B00E6),2},
{"indigenous","Indigenous Peoples' / Columbus Day",EventKind::Holiday,RuleType::NthWeekday,10,0,1,2,0,1,Effect::Gradient,C3(0xFF0D00,0xFFFF44,0xFF0D00),3},
{"halloween","Halloween",EventKind::Holiday,RuleType::Fixed,10,31,0,0,0,1,Effect::Strobe,C3(0xFF0D00,0x5B00E6,0x28FF00),3},
{"november","November / Autumn Theme",EventKind::Seasonal,RuleType::Month,11,0,0,0,0,1,Effect::Gradient,C4(0xFF0D00,0xFF0D00,0xFFFF44,0xFF0D00),4},
{"diabetes","Diabetes Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Gradient,C2(0x0D00FF,0x0D00FF),2},
{"veterans","Veterans Day",EventKind::Holiday,RuleType::Fixed,11,11,0,0,0,1,Effect::Jump,C3(0xFF0D00,0xFFFF44,0x0D00FF),3},
{"thanksgiving","Thanksgiving",EventKind::Holiday,RuleType::NthWeekday,11,0,4,4,0,1,Effect::Gradient,C4(0xFF0D00,0xFF0D00,0xFFFF44,0xFF0D00),4},
{"december","December / Winter Theme",EventKind::Seasonal,RuleType::Month,12,0,0,0,0,1,Effect::Strobe,C4(0x0D00FF,0x0D00FF,0xFFFF44,0x0D00FF),4},
{"hanukkah","Hanukkah",EventKind::Holiday,RuleType::Hanukkah,12,0,0,0,0,8,Effect::Strobe,C3(0x0D00FF,0xFFFF44,0xFFFF44),3},
{"christmas","Christmas Day",EventKind::Holiday,RuleType::Fixed,12,25,0,0,0,1,Effect::Jump,C3(0xFF0D00,0x28FF00,0xFFFF44),3},
{"kwanzaa","Kwanzaa",EventKind::Holiday,RuleType::Fixed,12,26,0,0,0,7,Effect::Gradient,C3(0xFF0D00,0x5B00E6,0x28FF00),3},
{"nye","New Year's Eve",EventKind::Holiday,RuleType::Fixed,12,31,0,0,0,1,Effect::Strobe,C3(0xFFFF44,0xFFFF44,0x0D00FF),3}
};
const size_t EVENT_COUNT = sizeof(EVENTS)/sizeof(EVENTS[0]);

static bool leap(int y){return (y%4==0 && y%100!=0)||y%400==0;}
static int dim(int y,int m){static const int d[]={31,28,31,30,31,30,31,31,30,31,30,31}; return m==2?d[1]+(leap(y)?1:0):d[m-1];}
static int dow(int y,int m,int d){tm t{};t.tm_year=y-1900;t.tm_mon=m-1;t.tm_mday=d;t.tm_hour=12;time_t x=mktime(&t);tm out{};localtime_r(&x,&out);return out.tm_wday;}
static void easter(int Y,int& M,int& D){int a=Y%19,b=Y/100,c=Y%100,d=b/4,e=b%4,f=(b+8)/25,g=(b-f+1)/3,h=(19*a+b-d-g+15)%30,i=c/4,k=c%4,l=(32+2*e+2*i-h-k)%7,m=(a+11*h+22*l)/451;M=(h+l-7*m+114)/31;D=((h+l-7*m+114)%31)+1;}
static time_t mk(int y,int m,int d){tm t{};t.tm_year=y-1900;t.tm_mon=m-1;t.tm_mday=d;t.tm_hour=12;t.tm_isdst=-1;return mktime(&t);}
static bool ymd(time_t x,int y,int m,int d){tm t{};localtime_r(&x,&t);return t.tm_year+1900==y&&t.tm_mon+1==m&&t.tm_mday==d;}

static bool hanukkahDate(int y,int& m,int& d){
  struct HD{int y,m,d;}; static const HD table[]={
    {2026,12,5},{2027,12,25},{2028,12,13},{2029,12,2},{2030,12,21},{2031,12,10},{2032,11,28},{2033,12,17},{2034,12,7},{2035,12,26},{2036,12,14},
    {2037,12,4},{2038,12,22},{2039,12,11},{2040,11,29},{2041,12,18},{2042,12,8},{2043,12,27},{2044,12,15},{2045,12,5}
  };
  for(auto &x:table) if(x.y==y){m=x.m;d=x.d;return true;} return false;
}

time_t eventStartEpoch(size_t i,int year){
  if(i>=EVENT_COUNT)return 0; const auto&e=EVENTS[i]; int m=e.month,d=e.day;
  if(e.rule==RuleType::Month) return mk(year,e.month,1);
  if(e.rule==RuleType::Fixed) return mk(year,e.month,e.day);
  if(e.rule==RuleType::NthWeekday){int first=dow(year,e.month,1);d=1+((e.weekday-first+7)%7)+7*(e.nth-1);return mk(year,e.month,d);}
  if(e.rule==RuleType::LastWeekday){d=dim(year,e.month);int last=dow(year,e.month,d);d-=((last-e.weekday+7)%7);return mk(year,e.month,d);}
  if(e.rule==RuleType::EasterOffset){easter(year,m,d);return mk(year,m,d)+(time_t)e.offsetDays*86400;}
  if(e.rule==RuleType::Hanukkah){if(!hanukkahDate(year,m,d))return 0;return mk(year,m,d);}
  return 0;
}

bool eventOccursInMonth(size_t i,int year,int month){
  if(i>=EVENT_COUNT)return false;const auto&e=EVENTS[i];
  if(e.rule==RuleType::Month)return e.month==month;
  time_t s=eventStartEpoch(i,year); if(!s)return false;
  for(int k=0;k<max(1,(int)e.durationDays);k++){tm t{};time_t x=s+(time_t)k*86400;localtime_r(&x,&t);if(t.tm_mon+1==month)return true;} return false;
}

bool eventActiveOn(size_t i,const tm& local){
  if(i>=EVENT_COUNT)return false;const auto&e=EVENTS[i];int y=local.tm_year+1900,m=local.tm_mon+1,d=local.tm_mday;
  if(e.rule==RuleType::Month)return e.month==m;
  time_t s=eventStartEpoch(i,y);
  if(!s && m==1)s=eventStartEpoch(i,y-1);
  for(int k=0;k<max(1,(int)e.durationDays);k++)if(ymd(s+(time_t)k*86400,y,m,d))return true;
  return false;
}

bool eventWindowActiveOn(size_t i,const tm& local,uint8_t lead,uint8_t trail){
  if(i>=EVENT_COUNT||EVENTS[i].kind!=EventKind::Holiday||EVENTS[i].rule==RuleType::Month)return false;
  int y=local.tm_year+1900;time_t today=mk(y,local.tm_mon+1,local.tm_mday);
  for(int yy=y-1;yy<=y+1;yy++){time_t s=eventStartEpoch(i,yy);if(!s)continue;time_t a=s-(time_t)lead*86400;time_t b=s+(time_t)(max(1,(int)EVENTS[i].durationDays)-1+trail)*86400;if(today>=a&&today<=b)return true;}
  return false;
}

String eventWhen(size_t i,int year){
  if(i>=EVENT_COUNT)return "";const auto&e=EVENTS[i];
  if(e.rule==RuleType::Month)return String("All ")+String(e.month);
  time_t s=eventStartEpoch(i,year);if(!s)return "Calculated yearly";tm t{};localtime_r(&s,&t);char b[24];strftime(b,sizeof(b),"%b %e",&t);
  if(e.durationDays>1){time_t end=s+(time_t)(e.durationDays-1)*86400;tm te{};localtime_r(&end,&te);char b2[24];strftime(b2,sizeof(b2),"%b %e",&te);return String(b)+" - "+b2;}return String(b);
}

Theme themeFromEvent(size_t i){
  Theme t;if(i>=EVENT_COUNT)return t;const auto&e=EVENTS[i];t.name=e.name;t.effect=e.effect;t.colorCount=e.colorCount;for(int c=0;c<e.colorCount;c++)t.colors[c]=e.colors[c];return t;
}
int eventIndexById(const String& id){for(size_t i=0;i<EVENT_COUNT;i++)if(id==EVENTS[i].id)return (int)i;return -1;}
