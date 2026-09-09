from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
s=main.read_text()

# Use the dedicated SPIFFS partition for custom lights/schedules instead of large JSON strings in NVS.
inc='#include <ArduinoJson.h>\n'
if inc not in s: raise SystemExit('ArduinoJson include anchor missing')
if '#include <SPIFFS.h>' not in s:
    s=s.replace(inc,inc+'#include <SPIFFS.h>\n#include <Preferences.h>\n',1)

old='''static String presetStoreRaw(){Preferences p;p.begin("anderson-preset",true);String r=p.getString("custom","[]");p.end();return r;}\nstatic String scheduleStoreRaw(){Preferences p;p.begin("anderson-csched",true);String r=p.getString("items","[]");p.end();return r;}'''
new=r'''static bool customFsReady=false;
static String customFileRead(const char* path){
  if(!customFsReady||!SPIFFS.exists(path))return "[]";File f=SPIFFS.open(path,FILE_READ);if(!f)return "[]";String r=f.readString();f.close();r.trim();return r.length()?r:"[]";
}
static bool customFileWrite(const char* path,const String& data){
  if(!customFsReady)return false;File f=SPIFFS.open(path,FILE_WRITE);if(!f)return false;size_t wrote=f.print(data);f.flush();f.close();if(wrote!=data.length())return false;File v=SPIFFS.open(path,FILE_READ);if(!v)return false;String check=v.readString();v.close();return check==data;
}
static String presetStoreRaw(){return customFileRead("/custom_lights.json");}
static String scheduleStoreRaw(){return customFileRead("/custom_schedules.json");}
static uint32_t nextStoredId(JsonArray arr,const char prefix){uint32_t maxId=0;for(JsonObject o:arr){String id=o["id"].as<String>();if(id.length()>1&&id[0]==prefix){uint32_t n=id.substring(1).toInt();if(n>maxId)maxId=n;}}return maxId+1;}
static void migrateLegacyCustomStorage(){
  if(!customFsReady)return;
  if(!SPIFFS.exists("/custom_lights.json")){Preferences p;if(p.begin("anderson-preset",true)){String raw=p.getString("custom","");p.end();JsonDocument d;if(raw.length()&&!deserializeJson(d,raw)&&d.is<JsonArray>())customFileWrite("/custom_lights.json",raw);}if(!SPIFFS.exists("/custom_lights.json"))customFileWrite("/custom_lights.json","[]");}
  if(!SPIFFS.exists("/custom_schedules.json")){Preferences p;if(p.begin("anderson-csched",true)){String raw=p.getString("items","");p.end();JsonDocument d;if(raw.length()&&!deserializeJson(d,raw)&&d.is<JsonArray>())customFileWrite("/custom_schedules.json",raw);}if(!SPIFFS.exists("/custom_schedules.json"))customFileWrite("/custom_schedules.json","[]");}
}'''
if old not in s: raise SystemExit('legacy storage helpers not found')
s=s.replace(old,new,1)

old_remove='''static void removeSchedulesForPreset(const String& presetId){\n  Preferences p;p.begin("anderson-csched",false);String raw=p.getString("items","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);p.putString("items",out);p.end();\n}'''
new_remove='''static bool removeSchedulesForPreset(const String& presetId){\n  String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray a=list.as<JsonArray>();for(int i=(int)a.size()-1;i>=0;i--)if(a[i]["presetId"].as<String>()==presetId)a.remove(i);String out;serializeJson(list,out);return customFileWrite("/custom_schedules.json",out);\n}'''
if old_remove not in s: raise SystemExit('removeSchedulesForPreset anchor missing')
s=s.replace(old_remove,new_remove,1)

start=s.find('  server.on("/api/presets",HTTP_GET,[]{')
end=s.find('  server.on("/api/wifi/scan",HTTP_GET,[]{',start)
if start<0 or end<0: raise SystemExit('custom route block missing')
routes=r'''  server.on("/api/presets",HTTP_GET,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Custom-light storage unavailable");return;}String raw=presetStoreRaw();JsonDocument check;if(deserializeJson(check,raw)||!check.is<JsonArray>())raw="[]";String json;json.reserve(raw.length()+20);json="{\"presets\":";json+=raw;json+="}";sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Custom-light storage unavailable");return;}JsonDocument d;if(!body(d))return;String deleteId=d["deleteId"].as<String>();String name=d["name"].as<String>();name.trim();String raw=presetStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    if(deleteId.length()){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);String out;serializeJson(list,out);if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light delete could not be saved");return;}removeSchedulesForPreset(deleteId);sendJson("{\"ok\":true}");return;}
    if(!name.length()){server.send(400,"text/plain","Give this custom light a name");return;}for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12)arr.remove(0);uint32_t seq=nextStoredId(arr,'p');String newId=String("p")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=newId;o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;String color=v.as<String>();if(color.length())c.add(color);}if(!c.size())c.add("#FFF1C7");
    String out;serializeJson(list,out);if(out.length()>32768){server.send(507,"text/plain","Custom-light storage is full");return;}if(!customFileWrite("/custom_lights.json",out)){server.send(500,"text/plain","Custom light could not be saved to persistent storage");return;}JsonDocument r;r["ok"]=true;r["id"]=newId;r["count"]=(uint32_t)arr.size();String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;if(!customFsReady){server.send(500,"text/plain","Schedule storage unavailable");return;}int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireAdmin())return;if(!customFsReady){server.send(500,"text/plain","Schedule storage unavailable");return;}JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();String savedId=id;bool removing=(d["remove"]|false)&&id.length();bool toggling=id.length()&&!d["enabled"].isNull();String presetId=d["presetId"].as<String>();
    if(!removing&&!toggling){Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){server.send(400,"text/plain","Choose a valid schedule date");return;}}
    String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();if(removing){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}else if(toggling){bool found=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){o["enabled"]=d["enabled"].as<bool>();found=true;break;}if(!found){server.send(404,"text/plain","Schedule entry not found");return;}}else{int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=nextStoredId(arr,'s');savedId=String("s")+String(seq);JsonObject o=arr.add<JsonObject>();o["id"]=savedId;o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;}
    while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);if(out.length()>65536){server.send(507,"text/plain","Schedule storage is full");return;}if(!customFileWrite("/custom_schedules.json",out)){server.send(500,"text/plain","Schedule could not be saved to persistent storage");return;}JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)arr.size();String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+350;
  });

'''
s=s[:start]+routes+s[end:]

setup_anchor='  store.begin();scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());\n'
setup_new='  store.begin();customFsReady=SPIFFS.begin(true);if(customFsReady)migrateLegacyCustomStorage();else Serial.println("Custom storage SPIFFS mount failed");scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());\n'
if setup_anchor not in s: raise SystemExit('setup storage anchor missing')
s=s.replace(setup_anchor,setup_new,1)

main.write_text(s)
print('Moved custom-light and schedule persistence to SPIFFS')
