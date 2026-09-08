from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()

css='''\n.loginOverlay{position:fixed;inset:0;z-index:12000;background:rgba(5,9,14,.94);display:flex;align-items:center;justify-content:center;padding:18px}.loginCard{width:min(92vw,390px);background:#141b24;border:1px solid #334155;border-radius:20px;padding:22px;box-shadow:0 25px 80px rgba(0,0,0,.55)}.loginChoice{width:100%;margin-top:10px}.userBar{display:flex;gap:7px;align-items:center}.role-user .adminOnly{display:none!important}\n'''
if '</style>' not in s: raise SystemExit('style close missing')
s=s.replace('</style>',css+'</style>',1)

old='<div id="connectionBadge" class="badge offline">● Preview</div>'
new='<div class="userBar"><span id="userBadge" class="badge">Signed out</span><button id="logoutUser" class="btn" style="display:none;min-height:34px;padding:5px 9px">Logout</button><div id="connectionBadge" class="badge offline">● Preview</div></div>'
if old not in s: raise SystemExit('connection badge missing')
s=s.replace(old,new,1)

overlay='''\n<div id="loginOverlay" class="loginOverlay">\n  <div class="loginCard"><h2 style="margin-top:0">Anderson Home</h2><div class="sub">Choose who is using the controller.</div><button class="btn primary loginChoice" data-login="Shirley">Shirley</button><button class="btn loginChoice" data-login="Jason">Jason — Administrator</button><div class="sub" style="margin-top:14px">No password is required. Jason has full access; Shirley sees Home and Events.</div></div>\n</div>\n'''
if '<script>' not in s: raise SystemExit('script open missing')
s=s.replace('<script>',overlay+'<script>',1)

post="async function post(path,obj){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)})}\n"
auth=r'''\nlet currentRole='none',currentUser='';\nfunction markAdminControls(){const e=$('eventsMaster');if(e&&e.closest('label'))e.closest('label').classList.add('adminOnly');['enableMonth','clearMonth'].forEach(id=>$(id)?.classList.add('adminOnly'))}\nfunction applyRole(session){currentRole=session.role||'none';currentUser=session.name||'';document.body.classList.toggle('role-user',currentRole==='user');$('userBadge').textContent=currentUser?currentUser+(currentRole==='admin'?' • Admin':''):'Signed out';$('logoutUser').style.display=currentUser?'inline-block':'none';document.querySelectorAll('.tab').forEach(b=>{const allowed=currentRole==='admin'||b.dataset.tab==='home'||b.dataset.tab==='events';b.style.display=allowed?'':'none'});if(currentRole==='user'){const a=document.querySelector('.tab.active');if(a&&!['home','events'].includes(a.dataset.tab))document.querySelector('.tab[data-tab="home"]')?.click()}markAdminControls()}\nasync function refreshAfterLogin(){const tasks=[loadState(),loadEvents(),typeof loadCustomPresets==='function'?loadCustomPresets():Promise.resolve(),typeof loadCustomSchedules==='function'?loadCustomSchedules():Promise.resolve()];if(currentRole==='admin'){if(typeof loadSavedColors==='function')tasks.push(loadSavedColors());if(typeof loadFirmwareInfo==='function')tasks.push(loadFirmwareInfo())}await Promise.all(tasks)}\nasync function initAuth(){try{const sess=await api('/api/session');if(sess.signedIn){applyRole(sess);$('loginOverlay').style.display='none';await refreshAfterLogin();return}}catch(e){}$('loginOverlay').style.display='flex'}\ndocument.querySelectorAll('[data-login]').forEach(b=>b.addEventListener('click',async()=>{try{const q=await post('/api/login',{name:b.dataset.login});applyRole(q);$('loginOverlay').style.display='none';await refreshAfterLogin();status('Signed in as '+q.name+'.')}catch(e){status('Sign-in failed: '+e.message)}}));\n$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}currentRole='none';currentUser='';$('loginOverlay').style.display='flex';$('logoutUser').style.display='none';$('userBadge').textContent='Signed out'});\n'''
if post not in s: raise SystemExit('post helper missing')
s=s.replace(post,post+auth,1)

s=s.replace("checks.className='eventchecks';","checks.className='eventchecks adminOnly';",1)
s=s.replace("edit.className='btn';edit.textContent='Edit';","edit.className='btn adminOnly';edit.textContent='Edit';",1)

startup='loadState();loadEvents();setInterval(()=>{if(API_MODE)loadState()},15000);'
new_start="markAdminControls();initAuth();setInterval(()=>{if(API_MODE&&currentRole!=='none')loadState()},15000);"
if startup not in s: raise SystemExit('startup call missing')
s=s.replace(startup,new_start,1)

p.write_text(s)
print('Added Jason/Shirley login UI and role-based tabs')
