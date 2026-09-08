from pathlib import Path
import re, sys

root = Path(sys.argv[1])
main = root/'src/main.cpp'
sched = root/'src/Scheduler.cpp'
web = root/'include/WebUI.h'

# ---------- Firmware defaults + editable event overrides ----------
s = main.read_text()
s = s.replace('uint8_t brightness=75,speedLevel=3;', 'uint8_t brightness=100,speedLevel=1;', 1)

anchor = 'static bool timeValid(){return time(nullptr)>1700000000;}\n'
insert = r'''

struct EventOverrideCfg {
  bool valid=false;
  Effect effect=Effect::Jump;
  uint32_t colors[8]={0};
  uint8_t colorCount=0;
};
static EventOverrideCfg eventOverrides[64];

static String eventOverrideKey(size_t i){return String("e")+String((unsigned)i);}
static Theme baseEventTheme(size_t i){
  Theme t;t.name=EVENTS[i].name;t.effect=EVENTS[i].effect;t.colorCount=min((uint8_t)8,EVENTS[i].colorCount);
  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=EVENTS[i].colors[c];
  return t;
}
Theme applyEventOverrideByIndex(size_t i,const Theme& base){
  Theme t=base;if(i>=64||!eventOverrides[i].valid)return t;
  t.effect=eventOverrides[i].effect;t.colorCount=eventOverrides[i].colorCount;
  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=eventOverrides[i].colors[c];
  return t;
}
static Theme effectiveEventTheme(size_t i){return applyEventOverrideByIndex(i,baseEventTheme(i));}
static void loadEventOverrides(){
  Preferences p;p.begin("anderson-event",true);
  for(size_t i=0;i<EVENT_COUNT&&i<64;i++){
    String raw=p.getString(eventOverrideKey(i).c_str(),"");if(!raw.length())continue;
    int sep=raw.indexOf(';');if(sep<1)continue;
    EventOverrideCfg o;o.valid=true;o.effect=effectFromString(raw.substring(0,sep));
    String list=raw.substring(sep+1);int start=0;
    while(start<(int)list.length()&&o.colorCount<8){int comma=list.indexOf(',',start);String v=comma<0?list.substring(start):list.substring(start,comma);v.trim();if(v.startsWith("#"))v.remove(0,1);if(v.length())o.colors[o.colorCount++]=strtoul(v.c_str(),nullptr,16);if(comma<0)break;start=comma+1;}
    if(o.colorCount)eventOverrides[i]=o;
  }
  p.end();
}
static void saveEventOverride(size_t i,const Theme& t){
  if(i>=64)return;EventOverrideCfg&o=eventOverrides[i];o.valid=true;o.effect=t.effect;o.colorCount=min((uint8_t)8,t.colorCount);for(uint8_t c=0;c<o.colorCount;c++)o.colors[c]=t.colors[c];
  String raw=String(effectName(o.effect))+";";for(uint8_t c=0;c<o.colorCount;c++){if(c)raw+=",";raw+=colorHex(o.colors[c]);}
  Preferences p;p.begin("anderson-event",false);p.putString(eventOverrideKey(i).c_str(),raw);p.end();
}
static void clearEventOverride(size_t i){if(i>=64)return;eventOverrides[i]=EventOverrideCfg();Preferences p;p.begin("anderson-event",false);p.remove(eventOverrideKey(i).c_str());p.end();}
'''
if anchor not in s:
    raise SystemExit('timeValid anchor not found')
s = s.replace(anchor, anchor+insert, 1)

# Scheduled operation always starts from the requested defaults.
s = s.replace('server.on("/api/resume",HTTP_POST,[]{manualOverride=false;power=true;evaluateSchedule(true);sendJson(stateJson());});',
              'server.on("/api/resume",HTTP_POST,[]{manualOverride=false;power=true;brightness=100;speedLevel=1;evaluateSchedule(true);sendJson(stateJson());});',1)
s = s.replace('ble.setTarget(0);bool should=scheduler->inRunWindow(l)&&store.get().schedulerEnabled;',
              'ble.setTarget(0);brightness=100;speedLevel=1;bool should=scheduler->inRunWindow(l)&&store.get().schedulerEnabled;',1)

# API event lists must return the effective, user-edited event theme.
events_pat = r'''for\(size_t i=0;i<EVENT_COUNT;i\+\+\)\{if\(!eventOccursInMonth\(i,year,month\)\)continue;JsonObject e=arr.add<JsonObject>\(\);e\["id"\]=EVENTS\[i\]\.id;e\["name"\]=EVENTS\[i\]\.name;e\["kind"\]=kindName\(EVENTS\[i\]\.kind\);e\["when"\]=eventWhen\(i,year\);e\["effect"\]=effectName\(EVENTS\[i\]\.effect\);e\["enabled"\]=i<64\?\(\(s\.enabledMask>>i\)&1ULL\):true;e\["favorite"\]=i<64\?\(\(s\.favoriteMask>>i\)&1ULL\):false;JsonArray c=e\["colors"\]\.to<JsonArray>\(\);for\(int j=0;j<EVENTS\[i\]\.colorCount;j\+\+\)c\.add\(colorHex\(EVENTS\[i\]\.colors\[j\]\)\);if\(EVENTS\[i\]\.rule==RuleType::Month&&EVENTS\[i\]\.kind==EventKind::Awareness&&e\["enabled"\]\.as<bool>\(\)\)monthly\+\+;\}'''
events_new = '''for(size_t i=0;i<EVENT_COUNT;i++){if(!eventOccursInMonth(i,year,month))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["kind"]=kindName(EVENTS[i].kind);e["when"]=eventWhen(i,year);e["effect"]=effectName(et.effect);e["customized"]=i<64?eventOverrides[i].valid:false;e["enabled"]=i<64?((s.enabledMask>>i)&1ULL):true;e["favorite"]=i<64?((s.favoriteMask>>i)&1ULL):false;JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));if(EVENTS[i].rule==RuleType::Month&&EVENTS[i].kind==EventKind::Awareness&&e["enabled"].as<bool>())monthly++;}'''
s,n = re.subn(events_pat,events_new,s,count=1)
if n!=1: raise SystemExit('events list block not found')

fav_pat = r'''for\(size_t i=0;i<EVENT_COUNT&&i<64;i\+\+\)\{if\(!\(\(s\.favoriteMask>>i\)&1ULL\)\)continue;JsonObject e=arr.add<JsonObject>\(\);e\["id"\]=EVENTS\[i\]\.id;e\["name"\]=EVENTS\[i\]\.name;e\["effect"\]=effectName\(EVENTS\[i\]\.effect\);JsonArray c=e\["colors"\]\.to<JsonArray>\(\);for\(int j=0;j<EVENTS\[i\]\.colorCount;j\+\+\)c\.add\(colorHex\(EVENTS\[i\]\.colors\[j\]\)\);\}'''
fav_new = '''for(size_t i=0;i<EVENT_COUNT&&i<64;i++){if(!((s.favoriteMask>>i)&1ULL))continue;Theme et=effectiveEventTheme(i);JsonObject e=arr.add<JsonObject>();e["id"]=EVENTS[i].id;e["name"]=EVENTS[i].name;e["effect"]=effectName(et.effect);JsonArray c=e["colors"].to<JsonArray>();for(int j=0;j<et.colorCount;j++)c.add(colorHex(et.colors[j]));}'''
s,n = re.subn(fav_pat,fav_new,s,count=1)
if n!=1: raise SystemExit('favorites block not found')

# Extend /api/event: enabled/favorite remain, while effect/colors update the built-in event in place.
old_event_tail = '''    if(!d["favorite"].isNull()){if(d["favorite"].as<bool>())s.favoriteMask|=(1ULL<<i);else s.favoriteMask&=~(1ULL<<i);}\n    store.saveAll();server.send(204);'''
new_event_tail = '''    if(!d["favorite"].isNull()){if(d["favorite"].as<bool>())s.favoriteMask|=(1ULL<<i);else s.favoriteMask&=~(1ULL<<i);}\n    if(d["reset"]|false){clearEventOverride(i);}\n    else if(!d["effect"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){et.colors[0]=0xFFF1C7;et.colorCount=1;}}saveEventOverride(i,et);}\n    store.saveAll();evaluateSchedule(true);sendJson(stateJson());'''
if old_event_tail not in s: raise SystemExit('/api/event tail not found')
s=s.replace(old_event_tail,new_event_tail,1)

# Load persisted event edits before scheduler evaluation.
s=s.replace('store.begin();scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());',
            'store.begin();loadEventOverrides();scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());',1)
main.write_text(s)

# ---------- Scheduler uses effective event themes ----------
s=sched.read_text()
if '#include <vector>' in s and 'applyEventOverrideByIndex' not in s:
    s=s.replace('#include <vector>','#include <vector>\nextern Theme applyEventOverrideByIndex(size_t i,const Theme& base);',1)
s=s.replace('return themeFromEvent(p);p=pickHolidayFirst(window);if(p>=0)return themeFromEvent(p);',
            'return applyEventOverrideByIndex(p,themeFromEvent(p));p=pickHolidayFirst(window);if(p>=0)return applyEventOverrideByIndex(p,themeFromEvent(p));',1)
s=s.replace('if(monthly.size()==1)return themeFromEvent(monthly[0]);',
            'if(monthly.size()==1)return applyEventOverrideByIndex(monthly[0],themeFromEvent(monthly[0]));',1)
s=s.replace('}return themeFromEvent(monthly[idx]);',
            '}return applyEventOverrideByIndex(monthly[idx],themeFromEvent(monthly[idx]));',1)
s=s.replace('if(!seasonal.empty())return themeFromEvent(seasonal[0]);return normal;',
            'if(!seasonal.empty())return applyEventOverrideByIndex(seasonal[0],themeFromEvent(seasonal[0]));return normal;',1)
# Combined monthly colors must also honor edits.
s=s.replace('for(auto i:monthly)for(int c=0;c<EVENTS[i].colorCount && t.colorCount<8;c++)t.colors[t.colorCount++]=EVENTS[i].colors[c];',
            'for(auto i:monthly){Theme et=applyEventOverrideByIndex(i,themeFromEvent(i));for(int c=0;c<et.colorCount && t.colorCount<8;c++)t.colors[t.colorCount++]=et.colors[c];}',1)
sched.write_text(s)

# ---------- UI defaults + direct per-event editor ----------
s=web.read_text()
s=s.replace('<span id="brightVal" class="muted">75%</span></div><input id="brightness" type="range" min="1" max="100" value="75">',
            '<span id="brightVal" class="muted">100%</span></div><input id="brightness" type="range" min="1" max="100" value="100">',1)
s=s.replace('<span id="speedVal" class="muted">Normal</span></div><input id="speed" type="range" min="1" max="5" value="3">',
            '<span id="speedVal" class="muted">Very Slow</span></div><input id="speed" type="range" min="1" max="5" value="1">',1)
s=s.replace('let power=true,brightness=75,speed=3,tick=0;', 'let power=true,brightness=100,speed=1,tick=0;',1)

# Built-in presets and favorites start at the requested defaults when applied.
s=s.replace("manual({name:n,colors:c,effect:e})", "manual({name:n,colors:c,effect:e,brightness:100,speed:1})")
s=s.replace("manual({name:ev.name,colors:ev.colors,effect:ev.effect})", "manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed:1})")
# Current event-preview fix sends 'speed'; force both defaults instead.
s=s.replace("await manual({name:ev.name,colors:ev.colors,effect:ev.effect,speed});", "await manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed:1});")

# Replace event renderer with Preview + Edit controls. Edits save directly back to that built-in event.
pat = r"function renderEvents\(events\)\{.*?\}\nasync function eventChange"
new = r'''function editEventInline(ev,row){
  const old=row.querySelector('.eventEditor');if(old){old.remove();return}
  const box=document.createElement('div');box.className='card eventEditor';box.style.gridColumn='1/-1';box.style.marginTop='8px';
  const title=document.createElement('div');title.className='small';title.innerHTML=`<strong>Edit ${ev.name}</strong>${ev.customized?' <span class="tag">Customized</span>':''}`;
  const lab=document.createElement('div');lab.className='label';lab.textContent='Effect';
  const effect=document.createElement('select');effect.className='field';['Jump','Breath','Strobe','Gradient'].forEach(x=>{const o=document.createElement('option');o.textContent=x;o.value=x;o.selected=x===ev.effect;effect.appendChild(o)});
  const colorsLab=document.createElement('div');colorsLab.className='label';colorsLab.textContent='Colors';
  const colors=document.createElement('div');colors.className='row wraprow';
  function addColor(v='#ffffff'){if(colors.children.length>=8)return;const inp=document.createElement('input');inp.type='color';inp.value=v;inp.style.width='54px';inp.style.height='42px';inp.style.padding='2px';inp.style.border='0';inp.style.background='transparent';inp.title='Tap to change color';inp.addEventListener('contextmenu',e=>{e.preventDefault();if(colors.children.length>1)inp.remove()});colors.appendChild(inp)}
  (ev.colors||['#ffffff']).forEach(addColor);
  const controls=document.createElement('div');controls.className='row wraprow';controls.style.marginTop='10px';
  const add=document.createElement('button');add.className='btn';add.textContent='Add Color';add.onclick=()=>addColor();
  const save=document.createElement('button');save.className='btn primary';save.textContent='Save Event';save.onclick=async()=>{const vals=[...colors.querySelectorAll('input[type=color]')].map(x=>x.value);await eventChange(ev.id,{effect:effect.value,colors:vals});status(ev.name+' updated directly. Future scheduled runs will use these settings.')};
  const reset=document.createElement('button');reset.className='btn';reset.textContent='Restore Default';reset.onclick=async()=>{await eventChange(ev.id,{reset:true});status(ev.name+' restored to its built-in default.')};
  controls.append(add,save,reset);box.append(title,lab,effect,colorsLab,colors,controls);row.appendChild(box);
}
function renderEvents(events){const list=$('eventList');list.innerHTML='';events.forEach(ev=>{const row=document.createElement('div');row.className='card event';const checks=document.createElement('div');checks.className='eventchecks';const en=document.createElement('input');en.type='checkbox';en.checked=ev.enabled;en.title='Scheduled';const fav=document.createElement('input');fav.type='checkbox';fav.checked=ev.favorite;fav.title='Favorite';checks.append(en,fav);const main=document.createElement('div');main.innerHTML=`<div class="small"><strong>${ev.name}</strong>${ev.customized?' <span class="tag">Edited</span>':''}</div><div class="sub">${ev.when} • ${ev.effect}</div><div class="sub" style="margin-top:4px">Top box = scheduled • Bottom box = ★ favorite</div><div class="tags"><span class="tag ${ev.kind}">${ev.kind}</span></div><div class="chips">${ev.colors.map(c=>`<span class="chip" style="background:${c}"></span>`).join('')}</div>`;const actions=document.createElement('div');actions.className='row wraprow';const pv=document.createElement('button');pv.className='btn previewEvent';pv.textContent='Preview';pv.addEventListener('click',async()=>{brightness=100;speed=1;$('brightness').value=100;$('homeBrightness').value=100;$('brightVal').textContent='100%';$('homeBrightVal').textContent='100%';$('speed').value=1;$('speedVal').textContent='Very Slow';setPreview(ev.name,ev.colors,ev.effect);if(API_MODE){try{await post('/api/ble/target',{target:0})}catch(e){}}await manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed:1});status(ev.name+' previewing on all light strings. Use Resume Schedule when finished.')});const edit=document.createElement('button');edit.className='btn';edit.textContent='Edit';edit.onclick=()=>editEventInline(ev,row);actions.append(pv,edit);en.addEventListener('change',()=>eventChange(ev.id,{enabled:en.checked}));fav.addEventListener('change',()=>eventChange(ev.id,{favorite:fav.checked}));row.append(checks,main,actions);list.appendChild(row)})}
async function eventChange'''
s,n = re.subn(pat,new,s,count=1,flags=re.S)
if n!=1: raise SystemExit('renderEvents function not found after preview patch')
web.write_text(s)
print('Added direct event editing plus 100% brightness / Very Slow defaults')
