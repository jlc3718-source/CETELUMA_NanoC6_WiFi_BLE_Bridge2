#include "LocalScheduler.h"
#include "Catalog.h"
#include "Programs.h"
#include "Factory.h"
#include <math.h>
#include <algorithm>
static int clamp(int x,int a,int b){return std::max(a,std::min(b,x));}
static String nativeEffect(String s){if(s=="Solid"||s=="Solid / Static")return "Static";if(s=="Jump")return "Cycle";if(s=="Breath"||s=="Pulse Wave")return "Breathe";if(s=="Strobe"||s=="Twinkle / Sparkle")return "Twinkle";if(s=="Wipe / Fill"||s=="Meteor / Comet")return "Streamlight";if(s=="Gradient Sweep"||s=="Candy Cane"||s=="Chase"||s=="Rainbow Flow")return "Flow1";return s;}
void schedulerBegin(){
  if(!state["settings"].is<JsonObject>()){
    auto s=state["settings"].to<JsonObject>();s["enabled"]=false;s["mode"]=2;s["on"]=1020;s["off"]=1380;s["startAtDusk"]=true;s["schedule2Enabled"]=true;s["schedule2EndAtDawn"]=true;s["schedule2End"]=360;s["schedule2Brightness"]=10;s["categoryMask"]=32767;s["whiteOverride1Enabled"]=true;s["whiteOverride2Enabled"]=true;
  }
  if(!state["overrides"].is<JsonObject>())state["overrides"].to<JsonObject>();
  if(!state["customSchedules"].is<JsonArray>())state["customSchedules"].to<JsonArray>();
  if(!state["presets"].is<JsonArray>())state["presets"].to<JsonArray>();
}
size_t eventCount(){return sizeof(CATALOG_EVENTS)/sizeof(CATALOG_EVENTS[0]);}
void eventAt(size_t i,JsonDocument&e){
  e.clear();if(i>=eventCount())return;deserializeJson(e,CATALOG_EVENTS[i]);
  String id=e["id"]|String("");int mode=state["settings"]["mode"]|2;auto profile=e["profiles"];
  e["colors"]=profile[mode==0?"major":mode==1?"basic":"expanded"];
  e["effect"]=nativeEffect(mode==2?profile["expandedEffect"]|String("Flow1"):e["effect"]|String("Flow1"));
  int old=mode==2?profile["expandedSpeed"]|2:e["speed"]|2;const int speeds[]={1,3,5,8,10};e["speed"]=speeds[clamp(old,1,5)-1];e["enabled"]=true;e["favorite"]=false;e.remove("profiles");
  for(JsonPairConst p:state["overrides"][id].as<JsonObjectConst>())e[p.key()]=p.value();
  e["_catalogIndex"]=(int)i;e["_catalogMode"]=mode;
}
int eventIndex(const String&id){for(size_t i=0;i<eventCount();i++){JsonDocument e;eventAt(i,e);if(String(e["id"]|"")==id)return i;}return -1;}
static time_t dayEpoch(int y,int m,int d){struct tm t{};t.tm_year=y-1900;t.tm_mon=m-1;t.tm_mday=d;t.tm_hour=12;t.tm_isdst=-1;return mktime(&t);}
static int monthDays(int y,int m){struct tm t{};time_t v=dayEpoch(y,m+1,0);localtime_r(&v,&t);return t.tm_mday;}
static int ordinal(int y,int m,int d){return (int)floor((double)dayEpoch(y,m,d)/86400);}
static int weekday(int y,int m,int d){struct tm t{};time_t v=dayEpoch(y,m,d);localtime_r(&v,&t);return t.tm_wday;}
static time_t addDay(time_t d,int count){struct tm t{};localtime_r(&d,&t);return dayEpoch(t.tm_year+1900,t.tm_mon+1,t.tm_mday+count);}
static double norm(double n,double max){n=fmod(n,max);return n<0?n+max:n;}
static double rad(double n){return n*M_PI/180.;}
static int solarUTC(const tm&t,double lat,double lon,bool dawn){
  double n=t.tm_yday+1,lng=lon/15,tt=n+((dawn?6:18)-lng)/24,m=.9856*tt-3.289,l=norm(m+1.916*sin(rad(m))+.020*sin(rad(2*m))+282.634,360);
  double ra=norm(atan(.91764*tan(rad(l)))*180/M_PI,360);ra=(ra+(floor(l/90)*90-floor(ra/90)*90))/15;
  double sd=.39782*sin(rad(l)),cd=cos(asin(sd)),ch=(cos(rad(96))-sd*sin(rad(lat)))/(cd*cos(rad(lat)));if(ch>1||ch< -1)return dawn?360:1080;
  double h=acos(ch)*180/M_PI;if(dawn)h=360-h;return (int)floor(norm(h/15+ra-.06571*tt-6.622-lng,24)*60+.5)%1440;
}
void solarTimes(time_t at,int&dawn,int&dusk){
  tm t{};localtime_r(&at,&t);double lat=state["latitude"]|42.1507,lon=state["longitude"]|-78.9452;int offset= -300+(t.tm_isdst>0?60:0);
  dawn=(solarUTC(t,lat,lon,true)+offset+1440)%1440;dusk=(solarUTC(t,lat,lon,false)+offset+1440)%1440;
}
String clockLabel(int n){n=(n+1440)%1440;char b[20];snprintf(b,sizeof(b),"%d:%02d %s",((n/60+11)%12)+1,n%60,n<720?"AM":"PM");return b;}
static bool activeEvent(JsonVariantConst e,const tm&day){
  int y=day.tm_year+1900,m=day.tm_mon+1,d=day.tm_mday,ord=ordinal(y,m,d);auto o=e["scheduleOverride"];
  String mode=o["mode"]|String("default");bool annual=o["annual"]|true;if(mode!="default"&&!annual&&(o["year"]|y)!=y)return false;
  if(mode=="month")return m==(o["startMonth"]|e["month"]|1);
  if(mode=="date"||mode=="range"){
    int sy=annual?y:o["year"]|y,sm=o["startMonth"]|1,sd=o["startDay"]|1,em=mode=="range"?o["endMonth"]|sm:sm,ed=mode=="range"?o["endDay"]|sd:sd;
    bool wraps=em<sm||(em==sm&&ed<sd);if(annual&&wraps&&(m<sm||(m==sm&&d<sd)))sy--;int a=ordinal(sy,sm,sd),b=ordinal(sy+(wraps?1:0),em,ed);return ord>=a&&ord<=b;
  }
  String rule=e["rule"]|String("Fixed");int em=e["month"]|1;if(rule=="Month")return m==em;
  int lead=0,trail=0;if(String(e["kind"]|"")=="Holiday"){lead=state["settings"]["lead"]|0;trail=state["settings"]["trail"]|0;}
  for(int year=y-1;year<=y+1;year++){
    int ed=e["day"]|1,month=em;bool found=true;
    if(rule=="NthWeekday")ed=1+((int(e["weekday"]|0)-weekday(year,em,1)+7)%7)+(std::max(1,int(e["nth"]|1))-1)*7;
    else if(rule=="LastWeekday")ed=monthDays(year,em)-(weekday(year,em,monthDays(year,em))-int(e["weekday"]|0)+7)%7;
    else if(rule=="MonthEnd")ed=monthDays(year,em);
    else if(rule=="EasterOffset"){
      int a=year%19,b=year/100,c=year%100,dd=b/4,ee=b%4,f=(b+8)/25,g=(b-f+1)/3,h=(19*a+b-dd-g+15)%30,i=c/4,k=c%4,l=(32+2*ee+2*i-h-k)%7,mm=(a+11*h+22*l)/451;
      month=(h+l-7*mm+114)/31;ed=(h+l-7*mm+114)%31+1;
    }else if(rule=="YearTable"||rule=="Hanukkah"){
      found=false;String id=e["dateRuleSourceId"]|e["id"]|String("");for(auto&s:CATALOG_SPECIAL)if(id==s.id&&year==s.year){month=s.month;ed=s.day;found=true;break;}
    }
    if(!found||ed>monthDays(year,month))continue;
    int a=ordinal(year,month,ed)+int(e["offsetDays"]|0),b=a+std::max(1,int(e["durationDays"]|1))-1;if(ord>=a-lead&&ord<=b+trail)return true;
  }
  return false;
}
bool localEventOccurs(JsonVariantConst e,time_t at){tm t{};localtime_r(&at,&t);return activeEvent(e,t);}
void localNightCandidates(time_t at,JsonArray out){
  if(!(state["settings"]["enabled"]|false))return;tm day{};localtime_r(&at,&day);int mask=state["settings"]["categoryMask"]|32767;
  for(size_t i=0;i<eventCount();i++){JsonDocument e;eventAt(i,e);if(!(e["enabled"]|true)||((state["settings"]["mode"]|2)==0&&!(e["major"]|false))||!(mask&(1<<int(e["categoryIndex"]|0)))||!activeEvent(e.as<JsonVariantConst>(),day))continue;auto c=out.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];c["type"]="Calendar event";c["colors"]=e["colors"];c["event"]=e.as<JsonVariantConst>();}
  for(JsonVariantConst e:state["extraEvents"].as<JsonArrayConst>())if((e["enabled"]|true)&&activeEvent(e,day)){auto c=out.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];c["type"]="AI event";c["colors"]=e["colors"];c["event"]=e;}
  for(JsonVariantConst e:state["customSchedules"].as<JsonArrayConst>())if((e["enabled"]|true)&&int(e["month"]|0)==day.tm_mon+1&&int(e["day"]|0)==day.tm_mday&&((e["annual"]|false)||int(e["year"]|0)==day.tm_year+1900)){auto c=out.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];c["type"]="Custom event";c["colors"]=e["colors"];c["event"]=e;}
}
static bool has(const String&s,const char*words){String w=words;int start=0;while(start<(int)w.length()){int end=w.indexOf('|',start);if(end<0)end=w.length();if(s.indexOf(w.substring(start,end))>=0)return true;start=end+1;}return false;}
void defaultLayers(JsonVariantConst e,JsonArray out){
  if(e["creativePhases"].is<JsonArrayConst>()&&e["creativePhases"].size()){for(auto p:e["creativePhases"].as<JsonArrayConst>())out.add(p);return;}
  if(e["_catalogIndex"].is<int>()){
    int i=e["_catalogIndex"].as<int>(),mode=e["_catalogMode"]|2;const char*effects[]={"Static","Flow1","Flow2","Cycle","Streamlight","Twinkle","Breathe"};
    if(i>=0&&i<(int)eventCount()&&mode>=0&&mode<3){auto&program=DEFAULT_PROGRAMS[mode][i];for(int j=0;j<program.count;j++){auto p=out.add<JsonObject>();p["effect"]=effects[program.effect[j]];p["speed"]=program.speed[j];p["minutes"]=program.minutes[j];p["shift"]=program.shift[j];}return;}
  }
  String n=e["name"]|String("");n.toLowerCase();String base=nativeEffect(e["effect"]|String("Flow1"));int speed=clamp(e["speed"]|2,1,5);
  auto add=[&](const char*effect,int sp,int min,int shift=0){auto p=out.add<JsonObject>();p["effect"]=effect;p["speed"]=sp;p["minutes"]=min;p["shift"]=shift;};
  if(String(e["id"]|"").indexOf("::factory:")>=0){String opposite=base=="Flow2"?"Flow1":"Flow2",accent=base=="Twinkle"?"Breathe":base=="Breathe"?"Twinkle":"Breathe";add(base.c_str(),std::min(speed,4),8);add(accent.c_str(),std::min(speed,2),7,1);add(opposite.c_str(),std::min(speed,3),8,-1);add("Static",1,5,2);}
  else if(has(n,"halloween")){add("Streamlight",3,7);add("Twinkle",3,6,1);add("Breathe",2,6,2);add("Flow2",3,7,-1);add("Static",1,4);}
  else if(has(n,"christmas day")){add("Flow1",2,7);add("Breathe",1,6,1);add("Twinkle",2,6,2);add("Flow2",2,7,-1);add("Static",1,4,1);}
  else if(has(n,"christmas eve")){add("Breathe",1,7);add("Flow1",2,7,1);add("Twinkle",1,5,2);add("Flow2",2,7,-1);add("Static",1,4);}
  else if(has(n,"remembrance|memorial|holocaust|pow/mia|yom kippur|good friday|ash wednesday|gold star|pearl harbor")){add("Static",1,10);add("Breathe",1,10,1);add("Static",1,10,-1);}
  else if(has(n,"independence day")){add("Flow1",3,7);add("Cycle",3,6,1);add("Twinkle",4,6,2);add("Flow2",3,7,-1);add("Static",1,4);}
  else if(has(n,"pride|lgbtq|coming out|homophobia|transphobia")){add("Flow1",3,7);add("Flow2",3,7,1);add("Breathe",1,6,2);add("Streamlight",2,6,-1);add("Twinkle",2,4,3);}
  else if(has(n,"valentine|mother|father|parents|grandparents")){add("Breathe",1,8);add("Flow1",2,7,1);add("Twinkle",1,6,-1);add("Static",1,5,2);}
  else if(String(e["rule"]|"")=="Month"&&e["colors"].size()<3){add("Breathe",1,10);add(base.c_str(),std::min(speed,2),10,1);add("Static",1,10,-1);}
  else if(e["colors"].size()>1){add(base.c_str(),std::min(speed,2),9);add("Breathe",1,8,1);add("Flow2",2,7,-1);add("Static",1,6,2);}
  else{add(base.c_str(),std::min(speed,2),15);add(base=="Breathe"?"Flow1":"Breathe",1,15,1);}
}
void renderEventScene(JsonVariantConst e,int brightness,int position,JsonObject out){
  out["power"]=true;out["brightness"]=brightness<100?brightness:e["brightness"]|100;JsonDocument phases;auto list=phases.to<JsonArray>();defaultLayers(e,list);int cycle=0;for(auto p:list)cycle+=std::max(2,int(p["minutes"]|8));int cursor=((position%cycle)+cycle)%cycle;JsonVariant chosen=list[0];int phaseIndex=0;
  for(auto p:list){int span=std::max(2,int(p["minutes"]|8));if(cursor<span){chosen=p;break;}cursor-=span;phaseIndex++;}
  out["effect"]=chosen["effect"]|e["effect"]|"Static";out["speed"]=clamp(chosen["speed"]|3,1,5);
  std::vector<uint32_t>colors;for(auto c:e["colors"].as<JsonArrayConst>()){if(c.is<String>()){String s=c.as<String>();s.replace("#","");colors.push_back(strtoul(s.c_str(),nullptr,16));}else colors.push_back(c.as<uint32_t>());}if(colors.empty())colors.push_back(0xffffff);
  int shift=((int(chosen["shift"]|0)%(int)colors.size())+colors.size())%colors.size();auto cols=out["colors"].to<JsonArray>();for(size_t i=0;i<colors.size();i++)cols.add(colors[(i+shift)%colors.size()]);
  if(!chosen["pattern"].isNull())out["pattern"]=chosen["pattern"];
  else if(colors.size()>1){
    static const int bank[6][8]={{5,3,2,4,6,2,3,1},{4,2,5,3,2,6,1,4},{6,3,2,5,4,1,3,2},{3,2,7,2,4,3,1,5},{5,2,3,6,2,4,3,1},{2,4,6,3,5,2,1,4}};
    String id=e["id"]|String("event");uint32_t seed=2166136261;for(char c:id){seed^=(uint8_t)c;seed*=16777619;}
    auto pat=out["pattern"].to<JsonObject>();auto blocks=pat["blocks"].to<JsonArray>();int total=0;for(size_t i=0;i<colors.size();i++){int n=bank[(seed+phaseIndex)%6][(i+phaseIndex)%8];total+=n;blocks.add(n);}pat["offset"]=((seed>>3)+phaseIndex*3)%total;pat["mirror"]=((seed+phaseIndex)&3)==0;
  }
}
void resolveSchedule(time_t at,JsonDocument&out){
  out.clear();if(at<1735689600)return;tm day{};localtime_r(&at,&day);int minute=day.tm_hour*60+day.tm_min,dawn,dusk;solarTimes(at,dawn,dusk);auto s=state["settings"];
  bool white1=(s["whiteOverride1Enabled"]|true)&&minute>=1260&&minute<1320,white2=(s["whiteOverride2Enabled"]|true)&&dawn>360&&minute>=360&&minute<std::min(450,dawn);
  if(day.tm_wday<=4&&(white1||white2)){out["id"]=white1?"white-override-1":"white-override-2";out["name"]=white1?"White Override 1":"White Override 2";auto scene=out["scene"].to<JsonObject>();scene["power"]=true;scene["brightness"]=100;scene["effect"]="Static";scene["speed"]=3;scene["colors"].to<JsonArray>().add(0xffffff);return;}
  // Explicit weekly rows retain their targets and priorities from Oracle.
  JsonVariantConst bestRow;int bestPriority=-2147483647;
  for(JsonVariantConst row:state["weeklySchedules"].as<JsonArrayConst>()){
    if(!(row["enabled"]|false))continue;String days=row["days"]|String("*");days.toLowerCase();
    auto minuteFor=[&](const char*k,const char*v) -> int {String kind=row[k]|String("clock"),value=row[v]|String("0");if(kind=="dawn")return (dawn+value.toInt()+1440)%1440;if(kind=="dusk")return (dusk+value.toInt()+1440)%1440;int h=0,m=0;return sscanf(value.c_str(),"%d:%d",&h,&m)==2?h*60+m:-1;};
    int start=minuteFor("start_kind","start_value"),end=minuteFor("end_kind","end_value");if(start<0||end<0)continue;
    int weekday=day.tm_wday;if(start>=end&&minute<end)weekday=(weekday+6)%7;const char*names[]={"sun","mon","tue","wed","thu","fri","sat"};if(days!="*"&&days.indexOf(names[weekday])<0)continue;
    bool active=start<end?(minute>=start&&minute<end):(minute>=start||minute<end);int priority=row["priority"]|0;if(active&&priority>=bestPriority){bestRow=row;bestPriority=priority;}
  }
  if(!bestRow.isNull()){
    out["id"]=bestRow["id"];out["name"]=bestRow["name"];auto scene=out["scene"].to<JsonObject>();scene["power"]=true;scene["brightness"]=bestRow["brightness"]|75;scene["effect"]=nativeEffect(bestRow["effect"]|String("Static"));scene["speed"]=bestRow["speed"]|3;scene["target"]=bestRow["target"]|"All";
    if(bestRow["colors"].is<String>()){JsonDocument colors;deserializeJson(colors,bestRow["colors"].as<String>());scene["colors"]=colors.as<JsonVariantConst>();}else scene["colors"]=bestRow["colors"];return;
  }
  if(!(s["enabled"]|false))return;
  int start=(s["startAtDusk"]|false)?dusk:s["on"]|1020,end=s["off"]|1380,s2end=(s["schedule2EndAtDawn"]|true)?dawn:s["schedule2End"]|360;
  auto window=[](int min,int a,int b){return a<b?min>=a&&min<b:min>=a||min<b;};
  bool schedule2=false;if(!window(minute,start,end)){if((s["schedule2Enabled"]|true)&&window(minute,end,s2end))schedule2=true;else return;}
  int position=(minute-start+1440)%1440;if((schedule2&&minute<start)||(!schedule2&&start>end&&minute<end)){time_t y=addDay(at,-1);localtime_r(&y,&day);}
  JsonDocument candidates;auto list=candidates.to<JsonArray>();int mask=s["categoryMask"]|32767;
  for(size_t i=0;i<eventCount();i++){JsonDocument e;eventAt(i,e);if(!(e["enabled"]|true)||((s["mode"]|2)==0&&!(e["major"]|false))||!(mask&(1<<int(e["categoryIndex"]|0)))||!activeEvent(e.as<JsonVariantConst>(),day))continue;
    auto o=e["scheduleOverride"];if(o["customTime"]|false){int a=o["start"]|start,b=o["end"]|end;if(!window(minute,a,b))continue;}
    auto c=list.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];renderEventScene(e.as<JsonVariantConst>(),schedule2?s["schedule2Brightness"]|10:100,position,c["scene"].to<JsonObject>());
  }
  for(JsonVariantConst e:state["extraEvents"].as<JsonArrayConst>()){if(!(e["enabled"]|true)||!activeEvent(e,day))continue;auto c=list.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];renderEventScene(e,schedule2?s["schedule2Brightness"]|10:100,position,c["scene"].to<JsonObject>());}
  for(JsonVariantConst e:state["customSchedules"].as<JsonArrayConst>()){if(!(e["enabled"]|true)||int(e["month"]|0)!=day.tm_mon+1||int(e["day"]|0)!=day.tm_mday||(!(e["annual"]|false)&&int(e["year"]|0)!=day.tm_year+1900))continue;auto c=list.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];c["scene"]=e;c["scene"]["power"]=true;if(schedule2)c["scene"]["brightness"]=s["schedule2Brightness"]|10;}
  JsonDocument promotions;factoryPromotionRows(promotions.to<JsonArray>());
  for(JsonVariantConst p:promotions.as<JsonArrayConst>()){
    JsonDocument e;e.set(p["event"]);if(!(p["enabled"]|true)||!(e["enabled"]|true)||!activeEvent(e.as<JsonVariantConst>(),day))continue;
    e["id"]=String(e["id"]|"")+"::factory:"+String(p["lightId"]|0);e["name"]=p["name"];e.remove("_catalogIndex");e.remove("creativePhases");e["effect"]=p["scene"]["effect"];e["speed"]=p["scene"]["speed"];e["colors"]=p["scene"]["colors"];
    auto c=list.add<JsonObject>();c["id"]=e["id"];c["name"]=e["name"];renderEventScene(e.as<JsonVariantConst>(),schedule2?s["schedule2Brightness"]|10:100,position,c["scene"].to<JsonObject>());
  }
  if(!list.size())return;
  int overlap=s["overlap"]|0,idx=0;for(size_t i=0;i<list.size();i++)if(String(list[i]["id"]|"").startsWith("ai-once-")){out.set(list[i]);out["schedule2"]=schedule2;return;}
  if(overlap==1)idx=std::min((int)list.size()-1,position*(int)list.size()/((end-start+1440)%1440?:1440));
  else if(overlap==0)idx=((ordinal(day.tm_year+1900,day.tm_mon+1,day.tm_mday)%(int)list.size())+list.size())%list.size();
  if(overlap!=2||list.size()==1)out.set(list[idx]);
  else{String id="overlap:",name;std::vector<uint32_t>colors;for(JsonVariantConst c:list){if(id!="overlap:"){id+="+";name+=" + ";}id+=c["id"]|String("");name+=c["name"]|String("");for(auto col:c["scene"]["colors"].as<JsonArrayConst>()){uint32_t v=col.as<uint32_t>();if(colors.size()<8&&std::find(colors.begin(),colors.end(),v)==colors.end())colors.push_back(v);}}out["id"]=id;out["name"]=name;auto sc=out["scene"].to<JsonObject>();sc["power"]=true;sc["effect"]="Cycle";sc["speed"]=1;sc["brightness"]=schedule2?s["schedule2Brightness"]|10:100;auto ca=sc["colors"].to<JsonArray>();for(auto c:colors)ca.add(c);}
  out["schedule2"]=schedule2;
}
bool nextLocalEventDate(JsonVariantConst e,time_t now,int&year,int&month,int&day){JsonDocument copy;copy.set(e);copy["kind"]="Observance";for(int i=0;i<1100;i++){time_t at=addDay(now,i);tm t{};localtime_r(&at,&t);if(activeEvent(copy.as<JsonVariantConst>(),t)){year=t.tm_year+1900;month=t.tm_mon+1;day=t.tm_mday;return true;}}return false;}
