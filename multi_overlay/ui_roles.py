from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()

# -----------------------------------------------------------------------------
# BASIC TWO-PROFILE LANDING PAGE
# No PIN, cookie, token, login API, or server-side authentication.
# The selected user is saved in localStorage on that phone/browser.
# Jason gets the full interface. Shirley gets the simplified Home + Events view.
# -----------------------------------------------------------------------------
css='''\n.profileOverlay{position:fixed;inset:0;z-index:12000;background:rgba(5,9,14,.96);display:flex;align-items:center;justify-content:center;padding:18px}.profileCard{width:min(92vw,390px);background:#141b24;border:1px solid #334155;border-radius:20px;padding:22px;box-shadow:0 25px 80px rgba(0,0,0,.55)}.profileChoice{width:100%;margin-top:12px;min-height:52px}.userBar{display:flex;gap:7px;align-items:center}.role-user .adminOnly{display:none!important}\n'''
if '</style>' not in s: raise SystemExit('style close missing')
s=s.replace('</style>',css+'</style>',1)

old='<div id="connectionBadge" class="badge offline">● Preview</div>'
new='<div class="userBar"><span id="userBadge" class="badge">Choose User</span><button id="switchUser" class="btn" style="display:none;min-height:34px;padding:5px 9px">Switch User</button><div id="connectionBadge" class="badge offline">● Preview</div></div>'
if old not in s: raise SystemExit('connection badge missing')
s=s.replace(old,new,1)

overlay=r'''
<div id="profileOverlay" class="profileOverlay">
  <div class="profileCard">
    <h2 style="margin-top:0">Anderson Home</h2>
    <div class="sub">Choose your controller page. This choice will be remembered on this device.</div>
    <button type="button" class="btn primary profileChoice" onclick="ahChooseProfile('Shirley')">Shirley</button>
    <button type="button" class="btn profileChoice" onclick="ahChooseProfile('Jason')">Jason — Full Controls</button>
  </div>
</div>
<script>
function ahChooseProfile(name){
  try{localStorage.setItem('andersonHomeProfile',name)}catch(e){}
  location.reload();
}
</script>
'''
if '<script>' not in s: raise SystemExit('script open missing')
s=s.replace('<script>',overlay+'<script>',1)

post="async function post(path,obj){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)})}\n"
profile=r'''\nlet currentRole='none',currentUser='';
function markAdminControls(){
  const e=$('eventsMaster');if(e&&e.closest('label'))e.closest('label').classList.add('adminOnly');
  ['enableMonth','clearMonth'].forEach(id=>$(id)?.classList.add('adminOnly'));
}
function applyProfile(name){
  currentUser=name;currentRole=name==='Jason'?'admin':'user';
  document.body.classList.toggle('role-user',currentRole==='user');
  $('userBadge').textContent=currentRole==='admin'?'Jason • Full':'Shirley';
  $('switchUser').style.display='inline-block';
  document.title='Anderson Home — '+name;
  document.querySelectorAll('.tab').forEach(b=>{
    const allowed=currentRole==='admin'||b.dataset.tab==='home'||b.dataset.tab==='events';
    b.style.display=allowed?'':'none';
  });
  if(currentRole==='user'){
    const a=document.querySelector('.tab.active');
    if(a&&!['home','events'].includes(a.dataset.tab))document.querySelector('.tab[data-tab="home"]')?.click();
  }
  markAdminControls();
}
async function safeLoad(fn){try{if(typeof fn==='function')await fn()}catch(e){console.warn('Anderson Home load:',e)}}
async function refreshAfterProfile(){
  await safeLoad(typeof loadState==='function'?loadState:null);
  await safeLoad(typeof loadEvents==='function'?loadEvents:null);
  await safeLoad(typeof loadSavedColors==='function'?loadSavedColors:null);
  if(currentRole==='admin'){
    await safeLoad(typeof loadCustomPresets==='function'?loadCustomPresets:null);
    await safeLoad(typeof loadCustomSchedules==='function'?loadCustomSchedules:null);
    await safeLoad(typeof loadFirmwareInfo==='function'?loadFirmwareInfo:null);
  }
}
async function initProfile(){
  let name='';try{name=localStorage.getItem('andersonHomeProfile')||''}catch(e){}
  if(name!=='Jason'&&name!=='Shirley'){
    $('profileOverlay').style.display='flex';return;
  }
  applyProfile(name);$('profileOverlay').style.display='none';await refreshAfterProfile();
}
$('switchUser').addEventListener('click',()=>{
  try{localStorage.removeItem('andersonHomeProfile')}catch(e){}
  location.reload();
});
'''
if post not in s: raise SystemExit('post helper missing')
s=s.replace(post,post+profile,1)

# Shirley can view/preview events, but the event editing controls are hidden.
s=s.replace("checks.className='eventchecks';","checks.className='eventchecks adminOnly';",1)
s=s.replace("edit.className='btn';edit.textContent='Edit';","edit.className='btn adminOnly';edit.textContent='Edit';",1)

startup='loadState();loadEvents();setInterval(()=>{if(API_MODE)loadState()},15000);'
new_start="markAdminControls();initProfile();setInterval(()=>{if(API_MODE&&currentRole!=='none')loadState()},15000);"
if startup not in s: raise SystemExit('startup call missing')
s=s.replace(startup,new_start,1)

p.write_text(s)
print('Added simple remembered Jason/Shirley landing profiles with no authentication')
