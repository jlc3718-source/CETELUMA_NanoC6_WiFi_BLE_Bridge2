from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# ---- Firmware: keep cookie support, add explicit session header support for WebView/browser reliability ----
s=main.read_text()
old='''static uint8_t requestRole(){
  String t=sessionCookie();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;
}'''
new='''static uint8_t requestRole(){
  String t="";if(server.hasHeader("X-Anderson-Session"))t=server.header("X-Anderson-Session");if(!t.length())t=sessionCookie();if(!t.length())return 0;if(adminSessionToken.length()&&t==adminSessionToken)return 2;if(userSessionToken.length()&&t==userSessionToken)return 1;return 0;
}'''
if old not in s: raise SystemExit('requestRole anchor missing')
s=s.replace(old,new,1)

old='''JsonDocument out;out["ok"]=true;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";String json;serializeJson(out,json);sendJson(json);'''
new='''JsonDocument out;out["ok"]=true;out["token"]=token;out["name"]=isJason?"Jason":"Shirley";out["role"]=isJason?"admin":"user";String json;serializeJson(out,json);sendJson(json);'''
if old not in s: raise SystemExit('login response anchor missing')
s=s.replace(old,new,1)

s=s.replace('SameSite=Strict','SameSite=Lax')
old='''const char* authHeaders[]={"Cookie"};server.collectHeaders(authHeaders,1);'''
new='''const char* authHeaders[]={"Cookie","X-Anderson-Session"};server.collectHeaders(authHeaders,2);'''
if old not in s: raise SystemExit('collectHeaders anchor missing')
s=s.replace(old,new,1)
main.write_text(s)

# ---- UI: store successful login token and inject it into every /api request ----
s=web.read_text()
anchor="let ahLoginUser='';\n"
wrapper=r'''let ahLoginUser='';
const ahNativeFetch=window.fetch.bind(window);
window.fetch=function(input,init){
  init=init||{};const url=typeof input==='string'?input:((input&&input.url)||'');
  if(url.startsWith('/api/')){const token=localStorage.getItem('ahSessionToken')||'';if(token){const h=new Headers(init.headers||{});h.set('X-Anderson-Session',token);init=Object.assign({},init,{headers:h})}}
  return ahNativeFetch(input,init);
};
'''
if anchor not in s: raise SystemExit('login JS anchor missing')
s=s.replace(anchor,wrapper,1)

old="""if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}location.reload()"""
new="""if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}const q=await r.json();if(q.token)localStorage.setItem('ahSessionToken',q.token);location.reload()"""
if old not in s: raise SystemExit('login success anchor missing')
s=s.replace(old,new,1)

old="""$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}location.reload()});"""
new="""$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}localStorage.removeItem('ahSessionToken');location.reload()});"""
if old not in s: raise SystemExit('logout anchor missing')
s=s.replace(old,new,1)

web.write_text(s)
print('Fixed PIN session persistence with explicit X-Anderson-Session header plus cookie fallback')
