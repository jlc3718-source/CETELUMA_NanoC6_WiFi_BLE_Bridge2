from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
s=main.read_text()

# esp_random() is used for unguessable, server-side session tokens.
inc='#include <Arduino.h>\n'
if inc in s and '#include <esp_system.h>' not in s:
    s=s.replace(inc,inc+'#include <esp_system.h>\n',1)

anchor='static bool timeValid(){return time(nullptr)>1700000000;}\n'
helpers=r'''

// PIN-authenticated role separation. 0=signed out, 1=Shirley/user, 2=Jason/admin.
// The public repository intentionally contains placeholders only. The release BINs
// are patched after CI so the real default PINs never appear in GitHub source/logs.
static const char* JASON_PIN_SEED="JPN0000";
static const char* SHIRLEY_PIN_SEED="SPN0000";
static String adminSessionToken,userSessionToken;
static uint8_t loginFailures=0;static uint32_t loginLockUntil=0;

static String configuredPin(bool admin){
  Preferences p;p.begin("anderson-auth",true);String v=p.getString(admin?"jpin":"spin","");p.end();
  if(v.length()==4)return v;const char* seed=admin?JASON_PIN_SEED:SHIRLEY_PIN_SEED;return String(seed+3);
}
static String makeSessionToken(){
  char b[33];snprintf(b,sizeof(b),"%08lX%08lX%08lX%08lX",(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random());return String(b);
}
static String sessionCookie(){
  if(!server.hasHeader("Cookie"))return "";String c=server.header("Cookie");int p=c.indexOf("AHSESS=");if(p<0)return "";p+=7;int e=c.indexOf(';',p);return e<0?c.substring(p):c.substring(p,e);
}
static uint8_t requestRole(){
  String t=sessionCookie();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;
}
static bool requireUser(){if(requestRole()>=1)return true;server.send(401,"text/plain","Please sign in to Anderson Home");return false;}
static bool requireAdmin(){if(requestRole()==2)return true;server.send(403,"text/plain","Jason administrator access required");return false;}
'''
if anchor not in s: raise SystemExit('timeValid anchor not found')
s=s.replace(anchor,anchor+helpers,1)

state='  server.on("/api/state",HTTP_GET,[]{sendJson(stateJson());});\n'
login=r'''  server.on("/api/login",HTTP_POST,[]{
    if(loginLockUntil && (int32_t)(millis()-loginLockUntil)<0){server.send(429,"text/plain","Too many incorrect PIN attempts. Try again in one minute.");return;}
    JsonDocument d;if(!body(d))return;String n=d["name"].as<String>(),pin=d["pin"].as<String>();pin.trim();
    bool isJason=n.equalsIgnoreCase("Jason"),isShirley=n.equalsIgnoreCase("Shirley");
    if(!isJason&&!isShirley){server.send(400,"text/plain","Choose Jason or Shirley");return;}
    if(pin.length()!=4||pin!=configuredPin(isJason)){
      loginFailures++;if(loginFailures>=5){loginFailures=0;loginLockUntil=millis()+60000UL;}
      server.send(401,"text/plain","Incorrect PIN");return;
    }
    loginFailures=0;loginLockUntil=0;String token=makeSessionToken();if(isJason)adminSessionToken=token;else userSessionToken=token;
    server.sendHeader("Set-Cookie",String("AHSESS=")+token+"; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict");
    JsonDocument out;out["ok"]=true;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";String json;serializeJson(out,json);sendJson(json);
  });
  server.on("/api/logout",HTTP_POST,[]{uint8_t r=requestRole();if(r==2)adminSessionToken="";else if(r==1)userSessionToken="";server.sendHeader("Set-Cookie","AHSESS=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");sendJson("{\"ok\":true}");});
  server.on("/api/session",HTTP_GET,[]{uint8_t r=requestRole();JsonDocument d;d["signedIn"]=r>0;d["role"]=r==2?"admin":(r==1?"user":"none");d["name"]=r==2?"Jason":(r==1?"Shirley":"");String out;serializeJson(d,out);sendJson(out);});
  server.on("/api/state",HTTP_GET,[]{if(!requireUser())return;sendJson(stateJson());});
'''
if state not in s: raise SystemExit('state route not found')
s=s.replace(state,login,1)

s=s.replace('server.on("/api/resume",HTTP_POST,[]{manualOverride=false;', 'server.on("/api/resume",HTTP_POST,[]{if(!requireUser())return;manualOverride=false;',1)
s=s.replace('server.on("/api/control",HTTP_POST,[]{\n    JsonDocument d;', 'server.on("/api/control",HTTP_POST,[]{\n    if(!requireUser())return;if(requestRole()==1)ble.setTarget(0);JsonDocument d;',1)
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
print('Added PIN-authenticated Jason/Shirley roles with opaque server sessions')
