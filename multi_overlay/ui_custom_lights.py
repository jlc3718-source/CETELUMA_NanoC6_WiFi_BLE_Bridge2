from pathlib import Path
import re,sys

p=Path(sys.argv[1])
s=p.read_text()

css='''\n.scheduleOverlay{position:fixed;inset:0;z-index:11000;background:rgba(0,0,0,.68);display:none;align-items:center;justify-content:center;padding:16px}.scheduleOverlay.open{display:flex}.scheduleCard{width:min(92vw,390px);background:#141b24;border:1px solid #334155;border-radius:18px;padding:18px}.customPresetActions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}\n'''
if '</style>' not in s: raise SystemExit('style close missing')
s=s.replace('</style>',css+'</style>',1)

old='<button id="savePreset" class="btn primary" style="width:100%;margin-top:12px">Save Current as Custom Preset</button>'
new='<div class="label">Custom light name</div><input id="customPresetName" class="field" maxlength="32" placeholder="e.g. Front Porch Purple"><button id="savePreset" class="btn primary" style="width:100%;margin-top:10px">Save Custom Light</button>'
if old not in s: raise SystemExit('save preset button missing')
s=s.replace(old,new,1)

panel='<div class="panel"><strong>Presets</strong><div class="sub">Favorites are managed from Events, not here.</div><div id="presetList" class="presetList"></div></div>'
if panel not in s: raise SystemExit('presets panel missing')
saved_panel='<div class="panel"><strong>Saved Custom Lights</strong><div class="sub">Your saved shows appear here immediately. Use Add to Schedule to assign one to a date.</div><div id="customPresetList" class="presetList"><div class="sub">Loading saved custom lights…</div></div></div>'
s=s.replace(panel,saved_panel+panel,1)

events='      <div id="overlapInfo" class="note"></div><div id="eventList" style="display:grid;gap:8px;margin-top:10px"></div>\n    </div>\n  </section>'
replace='      <div id="overlapInfo" class="note"></div><div id="eventList" style="display:grid;gap:8px;margin-top:10px"></div>\n    </div>\n    <div class="panel"><strong>Custom Scheduled Lights</strong><div class="sub">Named custom lights assigned to this month. They take priority over built-in automatic events on their scheduled date.</div><div id="customScheduleList" style="display:grid;gap:8px;margin-top:10px"></div></div>\n  </section>'
if events not in s: raise SystemExit('events panel anchor missing')
s=s.replace(events,replace,1)

modal='''\n<div id="scheduleOverlay" class="scheduleOverlay"><div class="scheduleCard"><strong>Add Custom Light to Schedule</strong><div id="schedulePresetName" class="sub" style="margin-top:4px"></div><div class="label">Date</div><input id="customScheduleDate" type="date" class="field"><label class="row" style="margin-top:12px"><input id="customScheduleAnnual" type="checkbox" checked><span class="small">Repeat every year</span></label><div class="grid2" style="margin-top:12px"><button id="cancelCustomSchedule" class="btn">Cancel</button><button id="saveCustomSchedule" class="btn primary">Add to Schedule</button></div></div></div>\n'''
if '<script>' not in s: raise SystemExit('script open missing')
s=s.replace('<script>',modal+'<script>',1)

# Refresh custom schedules with the Events tab/month/year.
s=s.replace("if(btn.dataset.tab==='events')loadEvents();","if(btn.dataset.tab==='lights'){/* ANDERSON_CUSTOM_LIGHTS_AUTO_LOAD */loadCustomPresets();loadStorageInfo();}if(btn.dataset.tab==='events'){loadEvents();loadCustomSchedules();}",1)
s=s.replace("$('monthSelect').addEventListener('change',loadEvents);$('yearSelect').addEventListener('change',loadEvents);","$('monthSelect').addEventListener('change',()=>{loadEvents();loadCustomSchedules()});$('yearSelect').addEventListener('change',()=>{loadEvents();loadCustomSchedules()});",1)

start=s.find("$('savePreset').addEventListener('click',async()=>{")
end=s.find('\n});',start)
if start<0 or end<0: raise SystemExit('savePreset handler missing')
end+=4
js=r'''$('savePreset').addEventListener('click',async()=>{
  const name=$('customPresetName').value.trim();if(!name)return status('Give this custom light a unique name first.');const preset={name,colors:[...builderColors],effect:$('effectSelect').value,brightness,speed};
  status('Saving '+name+'…');
  try{const saved=await post('/api/preset',preset);if(!saved||saved.ok!==true||!saved.id)throw new Error('NanoC6 did not confirm the custom-light save');await loadCustomPresets(saved.id);$('customPresetName').value='';await loadStorageInfo();const panel=$('customPresetList')?.closest('.panel');if(panel)panel.scrollIntoView({behavior:'smooth',block:'start'});status(name+' saved and verified • '+(saved.fileBytes||0)+' bytes')}catch(e){status('Custom light save failed: '+e.message)}
});
let schedulePresetId='';
async function loadCustomPresets(expectedId=''){const box=$('customPresetList');if(!box)return[];if(currentRole!=='admin'){box.innerHTML='';return[]}try{const d=await api('/api/presets?ts='+Date.now());box.innerHTML='';const a=Array.isArray(d.presets)?d.presets:[];if(!a.length)box.innerHTML='<div class="sub">No custom lights saved yet.</div>';a.forEach(p=>{const row=document.createElement('div');row.className='card';row.dataset.presetId=p.id||'';row.innerHTML=`<div class="small"><strong>${p.name}</strong></div><div class="sub">${p.effect} • ${p.brightness||100}% • ${['','Very Slow','Slow','Normal','Fast','Very Fast'][p.speed||1]}</div><div class="chips">${(p.colors||[]).map(c=>`<span class="chip" style="background:${c}"></span>`).join('')}</div>`;const actions=document.createElement('div');actions.className='customPresetActions';const apply=document.createElement('button');apply.className='btn';apply.textContent='Apply';apply.onclick=()=>manual({name:p.name,colors:p.colors,effect:p.effect,brightness:p.brightness||100,speed:p.speed||1});const sch=document.createElement('button');sch.className='btn primary';sch.textContent='Add to Schedule';sch.onclick=()=>openCustomSchedule(p);const del=document.createElement('button');del.className='btn';del.textContent='Delete';del.onclick=async()=>{if(!confirm('Delete '+p.name+'?'))return;await post('/api/preset',{deleteId:p.id});await Promise.all([loadCustomPresets(),loadCustomSchedules()])};actions.append(apply,sch,del);row.appendChild(actions);box.appendChild(row)});if(expectedId&&!a.some(p=>p.id===expectedId))throw new Error('Save was acknowledged, but the custom light could not be read back');return a}catch(e){box.innerHTML='<div class="sub">Unable to load saved custom lights: '+e.message+'</div>';if(expectedId)throw e;return[]}}
function openCustomSchedule(p){schedulePresetId=p.id;$('schedulePresetName').textContent=p.name;const d=new Date();$('customScheduleDate').value=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;$('customScheduleAnnual').checked=true;$('scheduleOverlay').classList.add('open')}
$('cancelCustomSchedule').addEventListener('click',()=>$('scheduleOverlay').classList.remove('open'));
$('saveCustomSchedule').addEventListener('click',async()=>{const v=$('customScheduleDate').value;if(!v)return status('Choose a schedule date.');const [y,m,d]=v.split('-').map(Number);try{await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});$('scheduleOverlay').classList.remove('open');$('monthSelect').value=m;$('yearSelect').value=y;await loadCustomSchedules();status('Custom light added to the automatic schedule.')}catch(e){status('Schedule save failed: '+e.message)}});
async function loadCustomSchedules(){const box=$('customScheduleList');if(!box||currentRole==='none')return;try{const q=`?year=${$('yearSelect').value}&month=${$('monthSelect').value}`;const d=await api('/api/custom-schedules'+q);box.innerHTML='';const a=d.items||[];if(!a.length){box.innerHTML='<div class="sub">No custom lights scheduled this month.</div>';return}a.forEach(x=>{const row=document.createElement('div');row.className='card';row.innerHTML=`<div class="small"><strong>${x.name||'Custom Light'}</strong></div><div class="sub">${monthNames[(x.month||1)-1]} ${x.day}${x.annual?' • repeats yearly':' • '+x.year} • ${x.effect||''}</div><div class="chips">${(x.colors||[]).map(c=>`<span class="chip" style="background:${c}"></span>`).join('')}</div>`;const actions=document.createElement('div');actions.className='customPresetActions';const pv=document.createElement('button');pv.className='btn';pv.textContent='Preview';pv.onclick=()=>manual({name:x.name,colors:x.colors,effect:x.effect,brightness:x.brightness||100,speed:x.speed||1});actions.appendChild(pv);if(currentRole==='admin'){const lab=document.createElement('label');lab.className='row small';const en=document.createElement('input');en.type='checkbox';en.checked=x.enabled!==false;en.onchange=()=>post('/api/custom-schedules',{id:x.id,enabled:en.checked}).then(loadCustomSchedules);lab.append(en,document.createTextNode('Enabled'));const del=document.createElement('button');del.className='btn';del.textContent='Delete';del.onclick=()=>post('/api/custom-schedules',{id:x.id,remove:true}).then(loadCustomSchedules);actions.append(lab,del)}row.appendChild(actions);box.appendChild(row)})}catch(e){box.innerHTML='<div class="sub">Custom schedule unavailable.</div>'}}
setTimeout(()=>loadCustomPresets(),180);
'''
s=s[:start]+js+s[end:]

# Show user-created schedule in the priority explanation.
s=s.replace('<div>2. Specific holiday / awareness day</div><div>3. Holiday window</div><div>4. Month-long events</div><div>5. Seasonal theme</div><div>6. Normal preset</div>','<div>2. Custom scheduled light</div><div>3. Specific holiday / awareness day</div><div>4. Holiday window</div><div>5. Month-long events</div><div>6. Seasonal theme</div><div>7. Normal preset</div>',1)

p.write_text(s)
print('Added named custom lights and custom scheduling UI')
