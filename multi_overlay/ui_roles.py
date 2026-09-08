from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()

css='''\n.loginOverlay{position:fixed;inset:0;z-index:12000;background:rgba(5,9,14,.96);display:flex;align-items:center;justify-content:center;padding:18px}.loginCard{width:min(92vw,390px);background:#141b24;border:1px solid #334155;border-radius:20px;padding:22px;box-shadow:0 25px 80px rgba(0,0,0,.55)}.loginChoice{width:100%;margin-top:10px}.pinBox{display:none;margin-top:14px}.pinInput{width:100%;box-sizing:border-box;text-align:center;letter-spacing:.35em;font-size:28px;font-weight:700;background:#0b1118;color:#fff;border:1px solid #334155;border-radius:12px;padding:12px}.loginError{min-height:20px;color:#fca5a5;margin-top:8px}.userBar{display:flex;gap:7px;align-items:center}.role-user .adminOnly{display:none!important}\n'''
if '</style>' not in s: raise SystemExit('style close missing')
s=s.replace('</style>',css+'</style>',1)

old='<div id="connectionBadge" class="badge offline">● Preview</div>'
new='<div class="userBar"><span id="userBadge" class="badge">Signed out</span><button id="logoutUser" class="btn" style="display:none;min-height:34px;padding:5px 9px">Logout</button><div id="connectionBadge" class="badge offline">● Preview</div></div>'
if old not in s: raise SystemExit('connection badge missing')
s=s.replace(old,new,1)

overlay=r'''
<div id="loginOverlay" class="loginOverlay">
  <div class="loginCard">
    <h2 style="margin-top:0">Anderson Home</h2>
    <div id="loginChoose">
      <div class="sub">Who is using the controller?</div>
      <button type="button" class="btn primary loginChoice" onclick="ahChooseUser('Shirley')">Shirley</button>
      <button type="button" class="btn loginChoice" onclick="ahChooseUser('Jason')">Jason — Administrator</button>
    </div>
    <div id="loginPinBox" class="pinBox">
      <div id="loginPinTitle" style="font-weight:700;margin-bottom:8px">Enter PIN</div>
      <input id="loginPin" class="pinInput" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="current-password" onkeydown="if(event.key==='Enter')ahPinLogin()">
      <button type="button" class="btn primary loginChoice" onclick="ahPinLogin()">Sign In</button>
      <button type="button" class="btn loginChoice" onclick="ahBackToUsers()">Back</button>
      <div id="loginError" class="loginError small"></div>
    </div>
  </div>
</div>
<script>
let ahLoginUser='';
function ahChooseUser(name){ahLoginUser=name;document.getElementById('loginChoose').style.display='none';const box=document.getElementById('loginPinBox');box.style.display='block';document.getElementById('loginPinTitle').textContent='Enter PIN for '+name;const pin=document.getElementById('loginPin');pin.value='';document.getElementById('loginError').textContent='';setTimeout(()=>pin.focus(),30)}
function ahBackToUsers(){ahLoginUser='';document.getElementById('loginPinBox').style.display='none';document.getElementById('loginChoose').style.display='block';document.getElementById('loginError').textContent=''}
function ahShowLogin(){document.getElementById('loginOverlay').style.display='flex';ahBackToUsers()}
async function ahPinLogin(){const pinEl=document.getElementById('loginPin'),err=document.getElementById('loginError');const pin=pinEl.value.trim();if(!ahLoginUser)return ahBackToUsers();if(!/^\d{4}$/.test(pin)){err.textContent='Enter the 4-digit PIN.';pinEl.focus();return}err.textContent='Signing in…';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:ahLoginUser,pin}),cache:'no-store'});if(!r.ok){const t=await r.text();throw new Error(t||('HTTP '+r.status))}location.reload()}catch(e){err.textContent=e.message||'Sign-in failed';pinEl.value='';pinEl.focus()}}
</script>
'''
if '<script>' not in s: raise SystemExit('script open missing')
s=s.replace('<script>',overlay+'<script>',1)

post="async function post(path,obj){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)})}\n"
auth=r'''\nlet currentRole='none',currentUser='';\nfunction markAdminControls(){const e=$('eventsMaster');if(e&&e.closest('label'))e.closest('label').classList.add('adminOnly');['enableMonth','clearMonth'].forEach(id=>$(id)?.classList.add('adminOnly'))}\nfunction applyRole(session){currentRole=session.role||'none';currentUser=session.name||'';document.body.classList.toggle('role-user',currentRole==='user');$('userBadge').textContent=currentUser?currentUser+(currentRole==='admin'?' • Admin':''):'Signed out';$('logoutUser').style.display=currentUser?'inline-block':'none';document.querySelectorAll('.tab').forEach(b=>{const allowed=currentRole==='admin'||b.dataset.tab==='home'||b.dataset.tab==='events';b.style.display=allowed?'':'none'});if(currentRole==='user'){const a=document.querySelector('.tab.active');if(a&&!['home','events'].includes(a.dataset.tab))document.querySelector('.tab[data-tab="home"]')?.click()}markAdminControls()}\nasync function refreshAfterLogin(){const tasks=[loadState(),loadEvents(),typeof loadCustomPresets==='function'?loadCustomPresets():Promise.resolve(),typeof loadCustomSchedules==='function'?loadCustomSchedules():Promise.resolve()];if(currentRole==='admin'){if(typeof loadSavedColors==='function')tasks.push(loadSavedColors());if(typeof loadFirmwareInfo==='function')tasks.push(loadFirmwareInfo())}else if(typeof loadSavedColors==='function')tasks.push(loadSavedColors());await Promise.all(tasks)}\nasync function initAuth(){try{const sess=await api('/api/session');if(sess.signedIn){applyRole(sess);$('loginOverlay').style.display='none';await refreshAfterLogin();return}}catch(e){}if(typeof ahShowLogin==='function')ahShowLogin();else $('loginOverlay').style.display='flex'}\n$('logoutUser').addEventListener('click',async()=>{try{await post('/api/logout',{})}catch(e){}location.reload()});\n'''
if post not in s: raise SystemExit('post helper missing')
s=s.replace(post,post+auth,1)

s=s.replace("checks.className='eventchecks';","checks.className='eventchecks adminOnly';",1)
s=s.replace("edit.className='btn';edit.textContent='Edit';","edit.className='btn adminOnly';edit.textContent='Edit';",1)

startup='loadState();loadEvents();setInterval(()=>{if(API_MODE)loadState()},15000);'
new_start="markAdminControls();initAuth();setInterval(()=>{if(API_MODE&&currentRole!=='none')loadState()},15000);"
if startup not in s: raise SystemExit('startup call missing')
s=s.replace(startup,new_start,1)

p.write_text(s)
print('Added reliable Jason/Shirley PIN login screen and role-based tabs')
