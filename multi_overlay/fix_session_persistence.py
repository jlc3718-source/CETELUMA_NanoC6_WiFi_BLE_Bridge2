from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# --- Firmware: accept an explicit session header as well as the cookie ---
s=main.read_text()
old='''static uint8_t requestRole(){\n  String t=sessionCookie();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;\n}'''
new='''static uint8_t requestRole(){\n  String t=server.hasHeader("X-Anderson-Session")?server.header("X-Anderson-Session"):sessionCookie();t.trim();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;\n}'''
if old not in s: raise SystemExit('requestRole anchor missing')
s=s.replace(old,new,1)

old='''JsonDocument out;out["ok"]=true;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";String json;serializeJson(out,json);sendJson(json);'''
new='''JsonDocument out;out["ok"]=true;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";out["token"]=token;String json;serializeJson(out,json);sendJson(json);'''
if old not in s: raise SystemExit('login response anchor missing')
s=s.replace(old,new,1)

old='''const char* authHeaders[]={"Cookie"};server.collectHeaders(authHeaders,1);'''
new='''const char* authHeaders[]={"Cookie","X-Anderson-Session"};server.collectHeaders(authHeaders,2);'''
if old not in s: raise SystemExit('collectHeaders anchor missing')
s=s.replace(old,new,1)
main.write_text(s)

# --- UI: persist the opaque token in localStorage and attach it to every API fetch ---
s=web.read_text()
old="let ahLoginUser='';"
new=r'''const ahNativeFetch=window.fetch.bind(window);
window.fetch=function(input,init){
  const opts=Object.assign({},init||{}),headers=new Headers(opts.headers||{}),token=localStorage.getItem('ahSessionToken')||'';
  const url=typeof input==='string'?input:((input&&input.url)||'');
  if(token&&(url.startsWith('/')||url.startsWith(location.origin)))headers.set('X-Anderson-Session',token);
  opts.headers=headers;opts.credentials='include';return ahNativeFetch(input,opts);
};
let ahLoginUser='';'''
if old not in s: raise SystemExit('login script anchor missing')
s=s.replace(old,new,1)

old="""const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}location.reload()"""
new="""const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}const q=await r.json();if(q.token)localStorage.setItem('ahSessionToken',q.token);location.reload()"""
if old not in s: raise SystemExit('PIN login fetch anchor missing')
s=s.replace(old,new,1)

old="$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}location.reload()});"
new="$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}localStorage.removeItem('ahSessionToken');location.reload()});"
if old not in s: raise SystemExit('logout handler anchor missing')
s=s.replace(old,new,1)

# Firmware upload uses XMLHttpRequest rather than fetch, so carry the same session token there.
old="x.open('POST','/api/update');$('uploadFirmware').disabled=true;"
new="x.open('POST','/api/update');const ahTok=localStorage.getItem('ahSessionToken')||'';if(ahTok)x.setRequestHeader('X-Anderson-Session',ahTok);$('uploadFirmware').disabled=true;"
if old not in s: raise SystemExit('OTA XHR anchor missing')
s=s.replace(old,new,1)

web.write_text(s)
print('Fixed PIN session persistence for browser and Android WebView')
