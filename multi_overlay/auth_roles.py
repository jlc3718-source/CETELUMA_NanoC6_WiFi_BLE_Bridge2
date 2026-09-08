from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
s=main.read_text()

anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
helpers=r'''

// Passwordless role separation. 0=signed out, 1=Shirley/user, 2=Jason/admin.
static uint8_t requestRole(){
  if(!server.hasHeader("Cookie"))return 0;String c=server.header("Cookie");
  if(c.indexOf("AHROLE=J")>=0)return 2;if(c.indexOf("AHROLE=S")>=0)return 1;return 0;
}
static bool requireUser(){if(requestRole()>=1)return true;server.send(401,"text/plain","Please sign in to Anderson Home");return false;}
static bool requireAdmin(){if(requestRole()==2)return true;server.send(403,"text/plain","Jason administrator access required");return false;}
'''
if anchor not in s: raise SystemExit('timeValid anchor not found')
s=s.replace(anchor,anchor+helpers,1)

state='  server.on("/api/state",HTTP_GET,[]{sendJson(stateJson());});\n'
login=r'''  server.on("/api/login",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String n=d["name"].as<String>();
    if(n.equalsIgnoreCase("Jason")){server.sendHeader("Set-Cookie","AHROLE=J; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax");sendJson("{\"ok\":true,\"name\":\"Jason\",\"role\":\"admin\"}");return;}
    if(n.equalsIgnoreCase("Shirley")){server.sendHeader("Set-Cookie","AHROLE=S; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax");sendJson("{\"ok\":true,\"name\":\"Shirley\",\"role\":\"user\"}");return;}
    server.send(400,"text/plain","Choose Jason or Shirley");
  });
  server.on("/api/logout",HTTP_POST,[]{server.sendHeader("Set-Cookie","AHROLE=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");sendJson("{\"ok\":true}");});
  server.on("/api/session",HTTP_GET,[]{uint8_t r=requestRole();JsonDocument d;d["signedIn"]=r>0;d["role"]=r==2?"admin":(r==1?"user":"none");d["name"]=r==2?"Jason":(r==1?"Shirley":"");String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/state",HTTP_GET,[]{if(!requireUser())return;sendJson(stateJson());});
'''
if state not in s: raise SystemExit('state route not found')
s=s.replace(state,login,1)

s=s.replace('server.on("/api/resume",HTTP_POST,[]{manualOverride=false;', 'server.on("/api/resume",HTTP_POST,[]{if(!requireUser())return;manualOverride=false;',1)
s=s.replace('server.on("/api/control",HTTP_POST,[]{\n    JsonDocument d;', 'server.on("/api/control",HTTP_POST,[]{\n    if(!requireUser())return;JsonDocument d;',1)
s=s.replace('server.on("/api/events",HTTP_GET,[]{\n    int year=', 'server.on("/api/events",HTTP_GET,[]{\n    if(!requireUser())return;int year=',1)
s=s.replace('server.on("/api/favorites",HTTP_GET,[]{\n    JsonDocument d;', 'server.on("/api/favorites",HTTP_GET,[]{\n    if(!requireUser())return;JsonDocument d;',1)

admin_repls=[
('server.on("/api/event",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/event",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;'),
('server.on("/api/events/bulk",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/events/bulk",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;'),
('server.on("/api/settings",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/settings",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;'),
('server.on("/api/wifi/scan",HTTP_GET,[]{\n    if(setupAP)','server.on("/api/wifi/scan",HTTP_GET,[]{\n    if(!requireAdmin())return;if(setupAP)'),
('server.on("/api/wifi",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/wifi",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;'),
('server.on("/api/ble/scan",HTTP_GET,[]{\n    auto found=','server.on("/api/ble/scan",HTTP_GET,[]{\n    if(!requireAdmin())return;auto found='),
('server.on("/api/ble/select",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/ble/select",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;'),
('server.on("/api/ble/remove",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/ble/remove",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;'),
('server.on("/api/ble/target",HTTP_POST,[]{\n    JsonDocument d;','server.on("/api/ble/target",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument d;')]
for old,new in admin_repls:
    if old in s:s=s.replace(old,new,1)

s=s.replace('server.on("/api/colors",HTTP_GET,[]{\n    Preferences', 'server.on("/api/colors",HTTP_GET,[]{\n    if(!requireAdmin())return;Preferences',1)
s=s.replace('server.on("/api/colors",HTTP_POST,[]{\n    JsonDocument', 'server.on("/api/colors",HTTP_POST,[]{\n    if(!requireAdmin())return;JsonDocument',1)
s=s.replace('server.on("/api/firmware",HTTP_GET,[]{sendJson(firmwareJson());});','server.on("/api/firmware",HTTP_GET,[]{if(!requireAdmin())return;sendJson(firmwareJson());});',1)
s=s.replace('server.on("/api/update",HTTP_POST,[]{\n    if(!otaUploadAllowed)', 'server.on("/api/update",HTTP_POST,[]{\n    if(!requireAdmin())return;if(!otaUploadAllowed)',1)
s=s.replace('otaUploadAllowed=localFirmwareClient();otaUploadOk=false;', 'otaUploadAllowed=localFirmwareClient() && requestRole()==2;otaUploadOk=false;',1)
s=s.replace('server.on("/api/reboot",HTTP_POST,[]{\n    if(!localFirmwareClient())', 'server.on("/api/reboot",HTTP_POST,[]{\n    if(!requireAdmin())return;if(!localFirmwareClient())',1)
s=s.replace('server.on("/api/rollback",HTTP_POST,[]{\n    if(!localFirmwareClient())', 'server.on("/api/rollback",HTTP_POST,[]{\n    if(!requireAdmin())return;if(!localFirmwareClient())',1)

setup='  setupRoutes();server.begin();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);\n'
if setup not in s: raise SystemExit('setup route/server anchor not found')
s=s.replace(setup,'  setupRoutes();const char* authHeaders[]={"Cookie"};server.collectHeaders(authHeaders,1);server.begin();evaluateSchedule(true);digitalWrite(BLUE_LED,LOW);\n',1)

main.write_text(s)
print('Added passwordless Jason/Shirley server-side roles')
