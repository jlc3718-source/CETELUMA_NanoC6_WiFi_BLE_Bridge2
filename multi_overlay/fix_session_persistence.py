from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# -----------------------------------------------------------------------------
# Firmware authentication fix
# Keep the opaque token/cookie system, but also remember the authenticated client
# IP address. Android WebView/browser cookie or localStorage behavior can then no
# longer kick a successfully authenticated client back to the login screen.
# -----------------------------------------------------------------------------
s=main.read_text()

anchor='static String adminSessionToken,userSessionToken;\n'
insert='''static String adminSessionToken,userSessionToken;\nstatic IPAddress adminSessionIp(0,0,0,0),userSessionIp(0,0,0,0);\nstatic bool adminSessionIpValid=false,userSessionIpValid=false;\n'''
if anchor not in s: raise SystemExit('session storage anchor missing')
s=s.replace(anchor,insert,1)

old='''static uint8_t requestRole(){\n  String t=sessionCookie();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;\n}'''
new='''static uint8_t requestRole(){\n  String t;if(server.hasArg("ahsess"))t=server.arg("ahsess");else if(server.hasHeader("X-Anderson-Session"))t=server.header("X-Anderson-Session");else t=sessionCookie();t.trim();\n  if(t.length()){if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;}\n  IPAddress ip=server.client().remoteIP();\n  if(adminSessionIpValid&&ip==adminSessionIp)return 2;if(userSessionIpValid&&ip==userSessionIp)return 1;return 0;\n}'''
if old not in s: raise SystemExit('requestRole anchor missing')
s=s.replace(old,new,1)

old='''loginFailures=0;loginLockUntil=0;String token=makeSessionToken();if(isJason)adminSessionToken=token;else userSessionToken=token;'''
new='''loginFailures=0;loginLockUntil=0;String token=makeSessionToken();IPAddress loginIp=server.client().remoteIP();if(isJason){adminSessionToken=token;adminSessionIp=loginIp;adminSessionIpValid=true;}else{userSessionToken=token;userSessionIp=loginIp;userSessionIpValid=true;}'''
if old not in s: raise SystemExit('login token assignment anchor missing')
s=s.replace(old,new,1)

old='''JsonDocument out;out["ok"]=true;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";String json;serializeJson(out,json);sendJson(json);'''
new='''JsonDocument out;out["ok"]=true;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";out["token"]=token;String json;serializeJson(out,json);sendJson(json);'''
if old not in s: raise SystemExit('login response anchor missing')
s=s.replace(old,new,1)

old='''server.on("/api/logout",HTTP_POST,[]{uint8_t r=requestRole();if(r==2)adminSessionToken="";else if(r==1)userSessionToken="";server.sendHeader("Set-Cookie","AHSESS=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");sendJson("{\\"ok\\":true}");});'''
new='''server.on("/api/logout",HTTP_POST,[]{uint8_t r=requestRole();IPAddress ip=server.client().remoteIP();if(r==2){adminSessionToken="";if(adminSessionIpValid&&ip==adminSessionIp)adminSessionIpValid=false;}else if(r==1){userSessionToken="";if(userSessionIpValid&&ip==userSessionIp)userSessionIpValid=false;}server.sendHeader("Set-Cookie","AHSESS=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");sendJson("{\\"ok\\":true}");});'''
if old not in s: raise SystemExit('logout route anchor missing')
s=s.replace(old,new,1)

old='''const char* authHeaders[]={"Cookie"};server.collectHeaders(authHeaders,1);'''
new='''const char* authHeaders[]={"Cookie","X-Anderson-Session"};server.collectHeaders(authHeaders,2);'''
if old not in s: raise SystemExit('collectHeaders anchor missing')
s=s.replace(old,new,1)
main.write_text(s)

# -----------------------------------------------------------------------------
# Web UI authentication fix
# The old initAuth() treated ANY failure while loading Home/Events/colors/etc. as
# an authentication failure. That is why a valid PIN briefly showed Home and then
# returned to the sign-in screen. Authentication is now decided only by
# /api/session. Data refresh failures are isolated and can never log the user out.
# -----------------------------------------------------------------------------
s=web.read_text()

old="let ahLoginUser='';"
new=r'''let ahLoginUser='',ahLoginAccepted=false;
const ahNativeFetch=window.fetch.bind(window);
window.fetch=function(input,init){
  const opts=Object.assign({},init||{}),headers=new Headers(opts.headers||{});
  let token='';try{token=localStorage.getItem('ahSessionToken')||''}catch(e){}
  let target=input;const raw=typeof input==='string'?input:((input&&input.url)||'');
  if(token&&raw){try{const u=new URL(raw,location.origin);if(u.origin===location.origin&&u.pathname.startsWith('/api/')){u.searchParams.set('ahsess',token);headers.set('X-Anderson-Session',token);target=(typeof input==='string'&&raw.startsWith('/'))?(u.pathname+u.search):u.toString()}}catch(e){}}
  opts.headers=headers;opts.credentials='include';return ahNativeFetch(target,opts);
};'''
if old not in s: raise SystemExit('login JS anchor missing')
s=s.replace(old,new,1)

old="function ahShowLogin(){document.getElementById('loginOverlay').style.display='flex';ahBackToUsers()}"
new="function ahShowLogin(){if(ahLoginAccepted)return;document.getElementById('loginOverlay').style.display='flex';ahBackToUsers()}"
if old not in s: raise SystemExit('ahShowLogin anchor missing')
s=s.replace(old,new,1)

old="""const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}location.reload()"""
new="""const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}const q=await r.json();ahLoginAccepted=true;try{if(q.token)localStorage.setItem('ahSessionToken',q.token)}catch(e){}if(typeof applyRole==='function')applyRole({signedIn:true,role:q.role,name:q.name});document.getElementById('loginOverlay').style.display='none';if(typeof refreshAfterLogin==='function')refreshAfterLogin().catch(()=>{})"""
if old not in s: raise SystemExit('PIN login success anchor missing')
s=s.replace(old,new,1)

old_refresh="""async function refreshAfterLogin(){const tasks=[loadState(),loadEvents(),typeof loadCustomPresets==='function'?loadCustomPresets():Promise.resolve(),typeof loadCustomSchedules==='function'?loadCustomSchedules():Promise.resolve()];if(currentRole==='admin'){if(typeof loadSavedColors==='function')tasks.push(loadSavedColors());if(typeof loadFirmwareInfo==='function')tasks.push(loadFirmwareInfo())}else if(typeof loadSavedColors==='function')tasks.push(loadSavedColors());await Promise.all(tasks)}"""
new_refresh="""async function refreshAfterLogin(){const tasks=[];const add=fn=>{try{tasks.push(Promise.resolve().then(fn))}catch(e){}};add(()=>loadState());add(()=>loadEvents());if(typeof loadCustomPresets==='function')add(()=>loadCustomPresets());if(typeof loadCustomSchedules==='function')add(()=>loadCustomSchedules());if(typeof loadSavedColors==='function')add(()=>loadSavedColors());if(currentRole==='admin'&&typeof loadFirmwareInfo==='function')add(()=>loadFirmwareInfo());await Promise.allSettled(tasks)}"""
if old_refresh not in s: raise SystemExit('refreshAfterLogin anchor missing')
s=s.replace(old_refresh,new_refresh,1)

old_init="""async function initAuth(){try{const sess=await api('/api/session');if(sess.signedIn){applyRole(sess);$('loginOverlay').style.display='none';await refreshAfterLogin();return}}catch(e){}if(typeof ahShowLogin==='function')ahShowLogin();else $('loginOverlay').style.display='flex'}"""
new_init="""async function initAuth(){let sess=null;try{sess=await api('/api/session')}catch(e){sess=null}if(sess&&sess.signedIn){ahLoginAccepted=true;applyRole(sess);$('loginOverlay').style.display='none';refreshAfterLogin().catch(()=>{});return true}if(ahLoginAccepted)return true;if(typeof ahShowLogin==='function')ahShowLogin();else $('loginOverlay').style.display='flex';return false}"""
if old_init not in s: raise SystemExit('initAuth anchor missing')
s=s.replace(old_init,new_init,1)

old="$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}location.reload()});"
new="$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}try{localStorage.removeItem('ahSessionToken')}catch(e){}ahLoginAccepted=false;location.reload()});"
if old not in s: raise SystemExit('logout UI anchor missing')
s=s.replace(old,new,1)

# Firmware upload uses XMLHttpRequest rather than fetch. Token is optional now,
# but keep forwarding it when available.
old="x.open('POST','/api/update');$('uploadFirmware').disabled=true;"
new="let ahTok='';try{ahTok=localStorage.getItem('ahSessionToken')||''}catch(e){}x.open('POST','/api/update'+(ahTok?('?ahsess='+encodeURIComponent(ahTok)):''));if(ahTok)x.setRequestHeader('X-Anderson-Session',ahTok);$('uploadFirmware').disabled=true;"
if old not in s: raise SystemExit('OTA XHR anchor missing')
s=s.replace(old,new,1)

web.write_text(s)
print('Fixed login loop: auth result is now independent of post-login data refresh failures')
