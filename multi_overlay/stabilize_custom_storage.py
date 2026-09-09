from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

s=main.read_text()

# Defer scheduler/BLE work until after the HTTP response is finished.
anchor='static String scheduleStoreRaw(){Preferences p;p.begin("anderson-csched",true);String r=p.getString("items","[]");p.end();return r;}\n'
if anchor not in s:
    raise SystemExit('scheduleStoreRaw anchor missing')
if 'customScheduleRefreshPending' not in s:
    s=s.replace(anchor, anchor+'static bool customScheduleRefreshPending=false;\nstatic uint32_t customScheduleRefreshAt=0;\n', 1)

start=s.find('  server.on("/api/presets",HTTP_GET,[]{')
end=s.find('  server.on("/api/wifi/scan",HTTP_GET,[]{', start)
if start < 0 or end < 0:
    raise SystemExit('custom route block not found')

routes=r'''  server.on("/api/presets",HTTP_GET,[]{
    if(!requireAdmin())return;
    String raw=presetStoreRaw();JsonDocument check;
    if(deserializeJson(check,raw)||!check.is<JsonArray>())raw="[]";
    String json;json.reserve(raw.length()+20);json="{\"presets\":";json+=raw;json+="}";sendJson(json);
  });
  server.on("/api/preset",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;
    String deleteId=d["deleteId"].as<String>();
    String name=d["name"].as<String>();name.trim();
    Preferences p;if(!p.begin("anderson-preset",false)){server.send(500,"text/plain","Custom-light storage unavailable");return;}
    String raw=p.getString("custom","[]");JsonDocument list;
    if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    if(deleteId.length()){
      for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==deleteId)arr.remove(i);
      String out;serializeJson(list,out);size_t wrote=p.putString("custom",out);String verify=p.getString("custom","");p.end();
      if(!wrote||verify!=out){server.send(500,"text/plain","Custom light delete could not be saved");return;}
      removeSchedulesForPreset(deleteId);sendJson("{\"ok\":true}");return;
    }
    if(!name.length()){p.end();server.send(400,"text/plain","Give this custom light a name");return;}
    for(JsonObject x:arr){String n=x["name"].as<String>();if(n.equalsIgnoreCase(name)){p.end();server.send(409,"text/plain","That custom light name is already in use");return;}}
    if(arr.size()>=12)arr.remove(0);
    uint32_t seq=p.getUInt("seq",0)+1;String newId=String("p")+String(seq);
    JsonObject o=arr.add<JsonObject>();o["id"]=newId;o["name"]=name;o["effect"]=d["effect"]|String("Jump");o["brightness"]=constrain(d["brightness"]|100,1,100);o["speed"]=constrain(d["speed"]|1,1,5);
    JsonArray c=o["colors"].to<JsonArray>();if(d["colors"].is<JsonArray>())for(JsonVariant v:d["colors"].as<JsonArray>()){if(c.size()>=8)break;String color=v.as<String>();if(color.length())c.add(color);}if(!c.size())c.add("#FFF1C7");
    String out;serializeJson(list,out);
    if(out.length()>7000){p.end();server.send(507,"text/plain","Custom-light storage is full");return;}
    size_t seqWrote=p.putUInt("seq",seq);size_t wrote=p.putString("custom",out);String verify=p.getString("custom","");p.end();
    if(!seqWrote||!wrote||verify!=out){server.send(500,"text/plain","Custom light could not be saved to persistent storage");return;}
    JsonDocument r;r["ok"]=true;r["id"]=newId;r["count"]=(uint32_t)arr.size();String json;serializeJson(r,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_GET,[]{
    if(!requireUser())return;int year=server.arg("year").toInt(),month=server.arg("month").toInt();String raw=scheduleStoreRaw();JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonDocument d;JsonArray out=d["items"].to<JsonArray>();
    for(JsonObject o:list.as<JsonArray>()){bool annual=o["annual"]|true;int oy=o["year"]|0,om=o["month"]|0;if(month>=1&&month<=12&&om!=month)continue;if(!annual&&year>=2020&&oy!=year)continue;JsonObject z=out.add<JsonObject>();z["id"]=o["id"];z["presetId"]=o["presetId"];z["year"]=oy;z["month"]=om;z["day"]=o["day"]|0;z["annual"]=annual;z["enabled"]=o["enabled"]|true;Theme t;uint8_t br=100,sp=1;String n;if(loadPresetTheme(o["presetId"].as<String>(),t,br,sp,&n)){z["name"]=n;z["effect"]=effectName(t.effect);z["brightness"]=br;z["speed"]=sp;JsonArray c=z["colors"].to<JsonArray>();for(uint8_t i=0;i<t.colorCount;i++)c.add(colorHex(t.colors[i]));}}
    String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/custom-schedules",HTTP_POST,[]{
    if(!requireAdmin())return;JsonDocument d;if(!body(d))return;String id=d["id"].as<String>();String savedId=id;
    bool removing=(d["remove"]|false)&&id.length();bool toggling=id.length()&&!d["enabled"].isNull();
    String presetId=d["presetId"].as<String>();
    if(!removing&&!toggling){Theme t;uint8_t br=100,sp=1;if(!loadPresetTheme(presetId,t,br,sp)){server.send(404,"text/plain","Custom light not found");return;}int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;if(month<1||month>12||day<1||day>31){server.send(400,"text/plain","Choose a valid schedule date");return;}}
    Preferences p;if(!p.begin("anderson-csched",false)){server.send(500,"text/plain","Schedule storage unavailable");return;}
    String raw=p.getString("items","[]");JsonDocument list;if(deserializeJson(list,raw)||!list.is<JsonArray>())list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    if(removing){for(int i=(int)arr.size()-1;i>=0;i--)if(arr[i]["id"].as<String>()==id)arr.remove(i);}
    else if(toggling){bool found=false;for(JsonObject o:arr)if(o["id"].as<String>()==id){o["enabled"]=d["enabled"].as<bool>();found=true;break;}if(!found){p.end();server.send(404,"text/plain","Schedule entry not found");return;}}
    else{int month=d["month"]|0,day=d["day"]|0,year=d["year"]|0;uint32_t seq=p.getUInt("seq",0)+1;savedId=String("s")+String(seq);p.putUInt("seq",seq);JsonObject o=arr.add<JsonObject>();o["id"]=savedId;o["presetId"]=presetId;o["month"]=month;o["day"]=day;o["year"]=year;o["annual"]=d["annual"]|true;o["enabled"]=true;}
    while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);
    if(out.length()>7000){p.end();server.send(507,"text/plain","Schedule storage is full");return;}
    size_t wrote=p.putString("items",out);String verify=p.getString("items","");size_t savedCount=arr.size();p.end();
    if(!wrote||verify!=out){server.send(500,"text/plain","Schedule could not be saved to persistent storage");return;}
    JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)savedCount;String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);
    customScheduleRefreshPending=true;customScheduleRefreshAt=millis()+250;
  });

'''
s=s[:start]+routes+s[end:]

loop_anchor='  server.handleClient();ble.loop();\n'
if loop_anchor not in s:
    raise SystemExit('loop anchor missing')
if 'customScheduleRefreshPending&&' not in s:
    s=s.replace(loop_anchor,loop_anchor+'  if(customScheduleRefreshPending&&(int32_t)(millis()-customScheduleRefreshAt)>=0){customScheduleRefreshPending=false;evaluateSchedule(true);}\n',1)

main.write_text(s)

# UI: give flash/NVS writes a moment to finish before immediately asking for the list again.
s=web.read_text()
s=s.replace("try{await post('/api/preset',preset);$('customPresetName').value='';await loadCustomPresets();status(name+' saved as a custom light.')}",
            "try{const ack=await post('/api/preset',preset);$('customPresetName').value='';await new Promise(r=>setTimeout(r,180));await loadCustomPresets();status(name+' saved as a custom light.')}",1)
s=s.replace("try{await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});$('scheduleOverlay').classList.remove('open');$('monthSelect').value=m;$('yearSelect').value=y;await loadCustomSchedules();status('Custom light added to the automatic schedule.')}",
            "try{const ack=await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});$('scheduleOverlay').classList.remove('open');$('monthSelect').value=m;$('yearSelect').value=y;await new Promise(r=>setTimeout(r,180));await loadCustomSchedules();status('Custom light added to the automatic schedule.')}",1)
web.write_text(s)
print('Stabilized custom-light and schedule persistence')
