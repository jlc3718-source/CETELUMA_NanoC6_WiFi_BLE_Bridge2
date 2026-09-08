from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
s=main.read_text()

anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
helpers=r'''
static String presetStoreRaw(){Preferences p;p.begin("anderson-preset",true);String r=p.getString("custom","[]");p.end();return r;}
static String scheduleStoreRaw(){Preferences p;p.begin("anderson-csched",true);String r=p.getString("items","[]");p.end();return r;}
static bool loadPresetTheme(const String& id,Theme& t,uint8_t& br,uint8_t& sp,String* outName=nullptr){
  JsonDocument list;if(deserializeJson(list,presetStoreRaw()))return false;
  for(JsonObject o:list.as<JsonArray>()){
    if(o["id"].as<String>()!=id)continue;t.name=o["name"].as<String>();if(outName)*outName=t.name;t.effect=effectFromString(o["effect"].as<String>());t.colorCount=0;
    for(JsonVariant v:o["colors"].as<JsonArray>()){if(t.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())t.colors[t.colorCount++]=strtoul(cs.c_str(),nullptr,16);}
    if(!t.colorCount){t.colors[0]=0xFFF1C7;t.colorCount=1;}br=constrain(o["brightness"]|100,1,100);sp=constrain(o["speed"]|1,1,5);return true;
  }return false;
}
static bool resolveCustomSchedule(const tm& l,Theme& t,uint8_t& br,uint8_t& sp){
  JsonDocument list;if(deserializeJson(list,scheduleStoreRaw()))return false;bool found=false;
  for(JsonObject o:list.as<JsonArray>()){
    if(!(o["enabled"]|true))continue;int m=o["month"]|0,d=o["day"]|0,y=o["year"]|0;bool annual=o["annual"]|true;
    if(m!=l.tm_mon+1||d!=l.tm_mday)continue;if(!annual&&y!=l.tm_year+1900)continue;Theme q;uint8_t qb=100,qs=1;if(loadPresetTheme(o["presetId"].as<String>(),q,qb,qs)){t=q;br=qb;sp=qs;found=true;}
  }return found;
}
static void removeSchedulesForPreset(const String& presetId){
  Preferences p;p.begin("anderson-csched",false);String raw=p.getString("items","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);p.putString("items",out);p.end();
}
'''
if anchor not in s: raise SystemExit('timeValid anchor missing')
s=s.replace(anchor,anchor+helpers,1)

start=s.find('  server.on("/api/preset",HTTP_POST,[]{')
end=s.find('  server.on("/api/wifi/scan",HTTP_GET,[]{',start)
if start<0 or end<0: raise SystemExit('preset route block not found')
routes=r'''  server.on("/api/presets",HTTP_GET,[]{
    if(!requireAdmin())return;JsonDocument list;if(deserializeJson(list,presetStoreRaw()))list.to<JsonArray>();JsonDocument d;JsonArray out=d["presets"].to<JsonArray>();for(JsonObject o:list.as<JsonArray>())out.add(o);String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;Preferences p;p.begin("anderson-preset",false);String raw=p.getString("custom","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    String deleteId=d["deleteId"].as<String>();if(deleteId.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);String out;serializeJson(list,out);p.putString("custom",out);p.end();removeSchedulesForPreset(deleteId);sendJson("{\"ok\":true}");return;}
    String name=d["name"].as<String>();name.trim();if(!name.length()){p.end();server.send(400,"text/plain","Give this custom light a name");return;}for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){p.end();server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12)arr.remove(0);uint32_t seq=p.getUInt("seq",0)+1;p.putUInt("seq",seq);JsonObject o=arr.add<JsonObject>();o["id"]=String("p")+String(seq);o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;c.add(v.as<String>());}if(!c.size())c.add("#FFF1C7");
    String out;serializeJson(list,out);p.putString("custom",out);String id=o["id"].as<String>();p.end();JsonDocument r;r["ok"]=true;r["id"]=id;String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;int year=server.arg("year").toInt(),month=server.arg("month").toInt();JsonDocument list;if(deserializeJson(list,scheduleStoreRaw()))list.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();
    for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}
    String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;Preferences p;p.begin("anderson-csched",false);String raw=p.getString("items","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();String id=d["id"].as<String>();
    if((d["remove"]|false)&&id.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}else if(id.length()&&!d["enabled"].isNull()){for(JsonObject o:arr)if(o["id"].as<String>()==id)o["enabled"]=d["enabled"].as<bool>();}else{
      String presetId=d["presetId"].as<String>();Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){p.end();server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){p.end();server.send(400,"text/plain","Choose a valid schedule date");return;}uint32_t seq=p.getUInt("seq",0)+1;p.putUInt("seq",seq);JsonObject o=arr.add<JsonObject>();o["id"]=String("s")+String(seq);o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;
    }while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);p.putString("items",out);p.end();evaluateSchedule(true);sendJson("{\"ok\":true}");
  });

'''
s=s[:start]+routes+s[end:]

old='''  ble.setTarget(0);brightness=100;speedLevel=1;bool should=scheduler->inRunWindow(l)&&store.get().schedulerEnabled;if(!should){if(power){power=false;ble.setPower(false);}return;}\n  Theme t=scheduler->resolve(l);bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);'''
new='''  ble.setTarget(0);brightness=100;speedLevel=1;bool should=scheduler->inRunWindow(l)&&store.get().schedulerEnabled;if(!should){if(power){power=false;ble.setPower(false);}return;}\n  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(l,t,cb,cs)){brightness=cb;speedLevel=cs;}else t=scheduler->resolve(l);bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);'''
if old not in s: raise SystemExit('evaluateSchedule block not found')
s=s.replace(old,new,1)

main.write_text(s)
print('Added named custom lights and custom schedule engine')
