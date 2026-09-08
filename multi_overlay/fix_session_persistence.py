from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# --- Firmware: accept session token from query parameter, custom header, or cookie ---
s=main.read_text()
old='''static uint8_t requestRole(){\n  String t=sessionCookie();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;\n}'''
new='''static uint8_t requestRole(){\n  String t;if(server.hasArg("ahsess"))t=server.arg("ahsess");else if(server.hasHeader("X-Anderson-Session"))t=server.header("X-Anderson-Session");else t=sessionCookie();t.trim();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;\n}'''
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

# --- UI: persist token in localStorage and attach it to every API request ---
s=web.read_text()
old="let ahLoginUser='';"
new=r'''const ahNativeFetch=window.fetch.bind(window);
window.fetch=function(input,init){
  const opts=Object.assign({},init||{}),headers=new Headers(opts.headers||{}),token=localStorage.getItem('ahSessionToken')||'';
  let target=input;
  const raw=typeof input==='string'?input:((input&&input.url)||'');
  if(token&&raw){
    try{
      const u=new URL(raw,location.origin);
      if(u.origin===location.origin&&u.pathname.startsWith('/api/')){
        u.searchParams.set('ahsess',token);
        headers.set('X-Anderson-Session',token);
        target=(typeof input==='string'&&raw.startsWith('/'))?(u.pathname+u.search):u.toString();
      }
    }catch(e){}
  }
  opts.headers=headers;opts.credentials='include';return ahNativeFetch(target,opts);
};
let ahLoginUser='';'''
if old not in s: raise SystemExit('login script anchor missing')
s=s.replace(old,new,1)

old="""const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}location.reload()"""
new="""const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}const q=await r.json();if(q.token)localStorage.setItem('ahSessionToken',q.token);if(typeof applyRole==='function')applyRole({signedIn:true,role:q.role,name:q.name});document.getElementById('loginOverlay').style.display='none';if(typeof refreshAfterLogin==='function')await refreshAfterLogin()"""
if old not in s: raise SystemExit('PIN login fetch anchor missing')
s=s.replace(old,new,1)

old="$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}location.reload()});"
new="$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}localStorage.removeItem('ahSessionToken');location.reload()});"
if old not in s: raise SystemExit('logout handler anchor missing')
s=s.replace(old,new,1)

old="x.open('POST','/api/update');$('uploadFirmware').disabled=true;"
new="const ahTok=localStorage.getItem('ahSessionToken')||'';x.open('POST','/api/update'+(ahTok?('?ahsess='+encodeURIComponent(ahTok)):''));if(ahTok)x.setRequestHeader('X-Anderson-Session',ahTok);$('uploadFirmware').disabled=true;"
if old not in s: raise SystemExit('OTA XHR anchor missing')
s=s.replace(old,new,1)

web.write_text(s)
print('Fixed PIN session persistence and eliminated login reload loop')
