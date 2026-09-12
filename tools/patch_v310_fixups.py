from pathlib import Path

p=Path('firmware/src/main.cpp'); s=p.read_text()
s=s.replace('enum class EventColorThemeStore : uint8_t { Original=0, Modern=1 };\n','')
s=s.replace('server.on("/api/event-color-theme",HTTP_POST,[]{if(!requireAdmin())return;','server.on("/api/event-color-theme",HTTP_POST,[]{if(!requireUser())return;',1)
s=s.replace('if(i<0||i>=(int)EVENT_COUNT||i>=(int)MAX_BUILTIN_EVENTS){server.send(404,"text/plain","Unknown event");return;}auto&s=store.get();','if(i<0||i>=(int)EVENT_COUNT||i>=(int)MAX_BUILTIN_EVENTS){server.send(404,"text/plain","Unknown event");return;}',1)

old="static uint32_t nextStoredId(JsonArray arr,const char prefix){uint32_t maxId=0;for(JsonObject o:arr){String id=o[\"id\"].as<String>();if(id.length()>1&&id[0]==prefix){uint32_t n=id.substring(1).toInt();if(n>maxId)maxId=n;}}return maxId+1;}"
new="static uint32_t nextStoredId(JsonArray arr,const char prefix){uint32_t maxId=0;for(JsonObject o:arr){String id=o[\"id\"].as<String>();if(id.length()>1&&id[0]==prefix){uint32_t n=id.substring(1).toInt();if(n>maxId)maxId=n;}}Preferences p;if(!p.begin(\"anderson-ids\",false))return 0;const char* key=prefix=='p'?\"preset\":\"sched\";uint32_t stored=p.getUInt(key,0),next=max(maxId,stored)+1;size_t wrote=p.putUInt(key,next);bool ok=wrote>0&&p.getUInt(key,0)==next;p.end();return ok?next:0;}"
if old not in s: raise AssertionError('nextStoredId target missing')
s=s.replace(old,new,1)
s=s.replace("uint32_t seq=nextStoredId(arr,'p');String newId=String(\"p\")+String(seq);","uint32_t seq=nextStoredId(arr,'p');if(!seq){server.send(500,\"text/plain\",\"Could not reserve a stable custom-light ID\");return;}String newId=String(\"p\")+String(seq);",1)
s=s.replace("uint32_t seq=nextStoredId(arr,'s');savedId=String(\"s\")+String(seq);","uint32_t seq=nextStoredId(arr,'s');if(!seq){server.send(500,\"text/plain\",\"Could not reserve a stable schedule ID\");return;}savedId=String(\"s\")+String(seq);",1)

# Wi-Fi persistence must be verified before reboot.
old='store.saveWiFi(ssid,pass);sendJson("{\\"ok\\":true}");delay(300);ESP.restart();'
new='if(!store.saveWiFi(ssid,pass)){server.send(500,"text/plain","Wi-Fi settings could not be saved");return;}sendJson("{\\"ok\\":true}");delay(300);ESP.restart();'
if old not in s: raise AssertionError('Wi-Fi save route target missing')
s=s.replace(old,new,1)

# BLE settings writes are checked and surfaced instead of silently acknowledged.
old='bool ok=ble.selectAndConnect(addr);if(ok){store.saveAll();ble.setTarget(0);applyRunning(true);}sendJson(stateJson(),ok?200:500);'
new='bool ok=ble.selectAndConnect(addr);if(ok){if(!store.saveBle()){server.send(500,"text/plain","Controller selected but its saved settings could not be verified");return;}ble.setTarget(0);applyRunning(true);}sendJson(stateJson(),ok?200:500);'
if old not in s: raise AssertionError('BLE select target missing')
s=s.replace(old,new,1)
old='ble.removeController(slot);store.saveAll();ble.setTarget(0);sendJson(stateJson());'
new='ble.removeController(slot);if(!store.saveBle()){server.send(500,"text/plain","Controller removal could not be persisted");return;}ble.setTarget(0);sendJson(stateJson());'
if old not in s: raise AssertionError('BLE remove target missing')
s=s.replace(old,new,1)

# Do not report malformed unsupported years as real calendar data.
s=s.replace('if(!requireUser())return;int year=server.arg("year").toInt(),month=server.arg("month").toInt();if(year<2020)year=2026;if(month<1||month>12)month=1;','if(!requireUser())return;int year=server.arg("year").toInt(),month=server.arg("month").toInt();if(year<2020)year=2026;if(year>2037){server.send(400,"text/plain","Built-in variable-date calendar is supported through 2037");return;}if(month<1||month>12)month=1;',1)

p.write_text(s)
print('v3.1.0 safety fixups applied')
