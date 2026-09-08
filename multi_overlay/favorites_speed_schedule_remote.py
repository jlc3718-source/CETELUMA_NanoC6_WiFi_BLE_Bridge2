from pathlib import Path
import re, sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# ---------------- Firmware: global favorite colors access ----------------
s=main.read_text()
# Favorite colors are readable by either signed-in user; only Jason may add/remove them.
s=s.replace('server.on("/api/colors",HTTP_GET,[]{\n    if(!requireAdmin())return;Preferences',
            'server.on("/api/colors",HTTP_GET,[]{\n    if(!requireUser())return;Preferences',1)

# ---------------- Firmware: per-event speed persistence ----------------
s=s.replace('''struct EventOverrideCfg {\n  bool valid=false;\n  Effect effect=Effect::Jump;\n  uint32_t colors[8]={0};\n  uint8_t colorCount=0;\n};''',
'''struct EventOverrideCfg {\n  bool valid=false;\n  Effect effect=Effect::Jump;\n  uint32_t colors[8]={0};\n  uint8_t colorCount=0;\n  uint8_t speed=1;\n};''',1)

old='''    int sep=raw.indexOf(';');if(sep<1)continue;\n    EventOverrideCfg o;o.valid=true;o.effect=effectFromString(raw.substring(0,sep));\n    String list=raw.substring(sep+1);int start=0;'''
new='''    int sep=raw.indexOf(';');if(sep<1)continue;\n    String head=raw.substring(0,sep);int bar=head.indexOf('|');EventOverrideCfg o;o.valid=true;\n    if(bar>0){o.effect=effectFromString(head.substring(0,bar));o.speed=constrain(head.substring(bar+1).toInt(),1,5);}else{o.effect=effectFromString(head);o.speed=1;}\n    String list=raw.substring(sep+1);int start=0;'''
if old not in s: raise SystemExit('event override loader anchor missing')
s=s.replace(old,new,1)

old='''Theme applyEventOverrideByIndex(size_t i,const Theme& base){\n  Theme t=base;if(i>=64||!eventOverrides[i].valid)return t;\n  t.effect=eventOverrides[i].effect;t.colorCount=eventOverrides[i].colorCount;\n  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=eventOverrides[i].colors[c];\n  return t;\n}'''
new='''static uint8_t scheduledEventSpeedHint=1;\nTheme applyEventOverrideByIndex(size_t i,const Theme& base){\n  Theme t=base;if(i>=64||!eventOverrides[i].valid){scheduledEventSpeedHint=1;return t;}\n  scheduledEventSpeedHint=constrain(eventOverrides[i].speed,1,5);t.effect=eventOverrides[i].effect;t.colorCount=eventOverrides[i].colorCount;\n  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=eventOverrides[i].colors[c];\n  return t;\n}'''
if old not in s: raise SystemExit('applyEventOverrideByIndex anchor missing')
s=s.replace(old,new,1)

old='''static void saveEventOverride(size_t i,const Theme& t){\n  if(i>=64)return;EventOverrideCfg&o=eventOverrides[i];o.valid=true;o.effect=t.effect;o.colorCount=min((uint8_t)8,t.colorCount);for(uint8_t c=0;c<o.colorCount;c++)o.colors[c]=t.colors[c];\n  String raw=String(effectName(o.effect))+";";for(uint8_t c=0;c<o.colorCount;c++){if(c)raw+=",";raw+=colorHex(o.colors[c]);}\n  Preferences p;p.begin("anderson-event",false);p.putString(eventOverrideKey(i).c_str(),raw);p.end();\n}'''
new='''static void saveEventOverride(size_t i,const Theme& t,uint8_t sp=1){\n  if(i>=64)return;EventOverrideCfg&o=eventOverrides[i];o.valid=true;o.effect=t.effect;o.speed=constrain(sp,1,5);o.colorCount=min((uint8_t)8,t.colorCount);for(uint8_t c=0;c<o.colorCount;c++)o.colors[c]=t.colors[c];\n  String raw=String(effectName(o.effect))+"|"+String(o.speed)+";";for(uint8_t c=0;c<o.colorCount;c++){if(c)raw+=",";raw+=colorHex(o.colors[c]);}\n  Preferences p;p.begin("anderson-event",false);p.putString(eventOverrideKey(i).c_str(),raw);p.end();\n}'''
if old not in s: raise SystemExit('saveEventOverride anchor missing')
s=s.replace(old,new,1)

# Return event speed in both the month list and favorites list.
s=s.replace('e["customized"]=i<64?eventOverrides[i].valid:false;e["enabled"]=',
            'e["customized"]=i<64?eventOverrides[i].valid:false;e["speed"]=(i<64&&eventOverrides[i].valid)?eventOverrides[i].speed:1;e["enabled"]=',1)
s=s.replace('e["effect"]=effectName(et.effect);JsonArray c=e["colors"].to<JsonArray>();',
            'e["effect"]=effectName(et.effect);e["speed"]=eventOverrides[i].valid?eventOverrides[i].speed:1;JsonArray c=e["colors"].to<JsonArray>();',1)

old='''    else if(!d["effect"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){et.colors[0]=0xFFF1C7;et.colorCount=1;}}saveEventOverride(i,et);}'''
new='''    else if(!d["effect"].isNull()||!d["speed"].isNull()||d["colors"].is<JsonArray>()){Theme et=effectiveEventTheme(i);uint8_t esp=eventOverrides[i].valid?eventOverrides[i].speed:1;if(!d["effect"].isNull())et.effect=effectFromString(d["effect"].as<String>());if(!d["speed"].isNull())esp=constrain(d["speed"].as<int>(),1,5);if(d["colors"].is<JsonArray>()){et.colorCount=0;for(JsonVariant v:d["colors"].as<JsonArray>()){if(et.colorCount>=8)break;String cs=v.as<String>();if(cs.startsWith("#"))cs.remove(0,1);if(cs.length())et.colors[et.colorCount++]=strtoul(cs.c_str(),nullptr,16);}if(!et.colorCount){et.colors[0]=0xFFF1C7;et.colorCount=1;}}saveEventOverride(i,et,esp);}'''
if old not in s: raise SystemExit('/api/event override block missing')
s=s.replace(old,new,1)

# Scheduled built-in events use their stored speed. Custom schedules retain their own speed.
old='''  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(l,t,cb,cs)){brightness=cb;speedLevel=cs;}else t=scheduler->resolve(l);bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);'''
new='''  Theme t;uint8_t cb=100,cs=1;if(resolveCustomSchedule(l,t,cb,cs)){brightness=cb;speedLevel=cs;}else{scheduledEventSpeedHint=1;t=scheduler->resolve(l);speedLevel=scheduledEventSpeedHint;}bool changed=!power||runningTheme.name!=t.name||runningTheme.effect!=t.effect;power=true;runningTheme=t;if(changed||force)applyRunning(true);'''
if old not in s: raise SystemExit('custom schedule evaluation anchor missing')
s=s.replace(old,new,1)

# ---------------- Firmware: make custom schedule writes verifiable ----------------
s=s.replace('String id=d["id"].as<String>();\n    if((d["remove"]|false)',
            'String id=d["id"].as<String>();String savedId=id;\n    if((d["remove"]|false)',1)
s=s.replace('o["id"]=String("s")+String(seq);o["presetId"]=presetId;',
            'savedId=String("s")+String(seq);o["id"]=savedId;o["presetId"]=presetId;',1)
old='''    }while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);p.putString("items",out);p.end();evaluateSchedule(true);sendJson("{\\"ok\\":true}");'''
new='''    }while(arr.size()>32)arr.remove(0);String out;serializeJson(list,out);size_t wrote=p.putString("items",out);String verify=p.getString("items","");size_t savedCount=arr.size();p.end();if(!wrote||verify!=out){server.send(500,"text/plain","Schedule could not be saved to persistent storage");return;}evaluateSchedule(true);JsonDocument ack;ack["ok"]=true;ack["id"]=savedId;ack["count"]=(uint32_t)savedCount;String ackJson;serializeJson(ack,ackJson);sendJson(ackJson);'''
if old not in s: raise SystemExit('custom schedule persistence tail missing')
s=s.replace(old,new,1)

# ---------------- Firmware: Jason may perform OTA from any reachable network ----------------
s=s.replace('d["localOnly"]=true;', 'd["localOnly"]=false;',1)
s=s.replace('otaUploadAllowed=localFirmwareClient() && requestRole()==2;', 'otaUploadAllowed=requestRole()==2;',1)
s=s.replace('otaUploadAllowed=localFirmwareClient();otaUploadOk=false;', 'otaUploadAllowed=requestRole()==2;otaUploadOk=false;',1)
s=s.replace('if(!localFirmwareClient()){server.send(403,"text/plain","Reboot is local Wi-Fi only");return;}', '',1)
s=s.replace('if(!localFirmwareClient()){server.send(403,"text/plain","Rollback is local Wi-Fi only");return;}', '',1)
s=s.replace('Firmware updates are local Wi-Fi only','Jason administrator access required',2)
s=s.replace('Firmware updates are allowed only from the local Wi-Fi network','Jason administrator access required',1)
main.write_text(s)

# ---------------- Web UI ----------------
s=web.read_text()

# Call saved colors Favorite Colors everywhere.
s=s.replace('Saved Colors','Favorite Colors')
s=s.replace('saved to Custom Colors.','saved to Favorite Colors.')
s=s.replace('No custom colors saved yet.','No favorite colors saved yet.')

# Per-event speed editor.
needle="""  const effect=document.createElement('select');effect.className='field';['Jump','Breath','Strobe','Gradient'].forEach(x=>{const o=document.createElement('option');o.textContent=x;o.value=x;o.selected=x===ev.effect;effect.appendChild(o)});\n  const colorsLab=document.createElement('div');"""
replacement="""  const effect=document.createElement('select');effect.className='field';['Jump','Breath','Strobe','Gradient'].forEach(x=>{const o=document.createElement('option');o.textContent=x;o.value=x;o.selected=x===ev.effect;effect.appendChild(o)});\n  const speedLab=document.createElement('div');speedLab.className='label';speedLab.textContent='Speed';const evSpeed=document.createElement('input');evSpeed.type='range';evSpeed.min='1';evSpeed.max='5';evSpeed.value=ev.speed||1;const evSpeedVal=document.createElement('div');evSpeedVal.className='sub';const showEvSpeed=()=>evSpeedVal.textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][+evSpeed.value-1];evSpeed.addEventListener('input',showEvSpeed);showEvSpeed();\n  const colorsLab=document.createElement('div');"""
if needle not in s: raise SystemExit('event effect editor anchor missing')
s=s.replace(needle,replacement,1)

# Add Favorite Colors directly inside each event editor.
s=s.replace("const colors=document.createElement('div');colors.className='row wraprow';",
            "const colors=document.createElement('div');colors.className='row wraprow';const eventFavLab=document.createElement('div');eventFavLab.className='label';eventFavLab.textContent='Favorite Colors';const eventFav=document.createElement('div');eventFav.className='savedColorGrid eventFavoriteGrid';",1)

# RGB script changed the save query to .colorChip by this stage.
s=s.replace("await eventChange(ev.id,{effect:effect.value,colors:vals});",
            "await eventChange(ev.id,{effect:effect.value,speed:+evSpeed.value,colors:vals});",1)
s=s.replace('controls.append(add,save,reset);box.append(title,lab,effect,colorsLab,colors,controls);',
            'controls.append(add,save,reset);box.append(title,lab,effect,speedLab,evSpeed,evSpeedVal,colorsLab,colors,eventFavLab,eventFav,controls);renderEventFavoriteGrid(eventFav,addColor);',1)

# Event rows show and preview their own speed.
s=s.replace('${ev.when} • ${ev.effect}</div>', '${ev.when} • ${ev.effect} • ${[\'Very Slow\',\'Slow\',\'Normal\',\'Fast\',\'Very Fast\'][(ev.speed||1)-1]}</div>',1)
old_preview="""brightness=100;speed=1;$('brightness').value=100;$('homeBrightness').value=100;$('brightVal').textContent='100%';$('homeBrightVal').textContent='100%';$('speed').value=1;$('speedVal').textContent='Very Slow';setPreview(ev.name,ev.colors,ev.effect);if(API_MODE){try{await post('/api/ble/target',{target:0})}catch(e){}}await manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed:1});"""
new_preview="""brightness=100;speed=ev.speed||1;$('brightness').value=100;$('homeBrightness').value=100;$('brightVal').textContent='100%';$('homeBrightVal').textContent='100%';$('speed').value=speed;$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];if($('homeSpeed')){$('homeSpeed').value=speed;$('homeSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1]}setPreview(ev.name,ev.colors,ev.effect);if(API_MODE){try{await post('/api/ble/target',{target:0})}catch(e){}}await manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed});"""
if old_preview not in s: raise SystemExit('event preview speed anchor missing')
s=s.replace(old_preview,new_preview,1)

# Favorites applied from Events should use the event's stored speed when that object supplies one.
s=s.replace("manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed:1})",
            "manual({name:ev.name,colors:ev.colors,effect:ev.effect,brightness:100,speed:ev.speed||1})")

# Render favorite colors in event editor, Home, Lights, and RGB wheel from the same global list.
insert_before='function fillSavedColors(g,forLights){'
helper=r'''function renderEventFavoriteGrid(g,addColor){if(!g)return;g.innerHTML='';if(!savedColors.length){g.innerHTML='<span class="sub">No favorite colors saved yet.</span>';return}savedColors.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=c;b.title='Add '+c;b.onclick=()=>addColor(c);g.appendChild(b)})}
function renderHomeFavoriteGrid(){const g=$('homeFavoriteColorGrid');if(!g)return;g.innerHTML='';if(!savedColors.length){g.innerHTML='<span class="sub">No favorite colors saved yet.</span>';return}savedColors.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=c;b.title='Use '+c;b.onclick=()=>manual({name:'Favorite '+c,colors:[c],effect:'Jump',brightness,speed});g.appendChild(b)})}
'''
if insert_before not in s: raise SystemExit('fillSavedColors anchor missing')
s=s.replace(insert_before,helper+insert_before,1)
s=s.replace("function renderSavedColors(){fillSavedColors($('savedColorGrid'),false);fillSavedColors($('lightSavedColorGrid'),true)}",
            "function renderSavedColors(){fillSavedColors($('savedColorGrid'),false);fillSavedColors($('lightSavedColorGrid'),true);renderHomeFavoriteGrid();document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor'),colors=box?.querySelector('.row.wraprow');if(colors)renderEventFavoriteGrid(g,c=>{if(colors.children.length>=8)return;const b=document.createElement('button');b.type='button';b.className='colorChip';setChipColor(b,c);b.onclick=()=>openRgbWheel(b);colors.appendChild(b)})})}",1)

# Add speed controls to Home and Events without depending on a fragile static layout anchor.
ui_js=r'''
function ensureExtraControls(){
  const hb=$('homeBrightness');if(hb&&!$('homeSpeed')){const wrap=document.createElement('div');wrap.id='homeSpeedBlock';wrap.innerHTML='<div class="label">Effect Speed <span id="homeSpeedVal" class="muted">Very Slow</span></div><input id="homeSpeed" type="range" min="1" max="5" value="1"><div class="label">Favorite Colors</div><div id="homeFavoriteColorGrid" class="savedColorGrid"></div>';hb.insertAdjacentElement('afterend',wrap);const hs=$('homeSpeed');hs.value=speed;$('homeSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];let ht=null;hs.addEventListener('input',e=>{speed=+e.target.value;$('homeSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];$('speed').value=speed;$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];clearTimeout(ht);ht=setTimeout(()=>manual({speed}),160)});hs.addEventListener('change',()=>{clearTimeout(ht);manual({speed})});renderHomeFavoriteGrid()}
  const list=$('eventList');if(list&&!$('eventsSpeed')){const wrap=document.createElement('div');wrap.id='eventsSpeedBlock';wrap.className='card';wrap.style.marginTop='10px';wrap.innerHTML='<div class="label" style="margin-top:0">Event Preview Speed <span id="eventsSpeedVal" class="muted">Very Slow</span></div><input id="eventsSpeed" type="range" min="1" max="5" value="1"><div class="sub">This changes preview speed immediately. Each event can also save its own speed with Edit.</div>';list.parentNode.insertBefore(wrap,list);const es=$('eventsSpeed');es.value=speed;$('eventsSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];let et=null;es.addEventListener('input',e=>{speed=+e.target.value;$('eventsSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];$('speed').value=speed;$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1];if($('homeSpeed')){$('homeSpeed').value=speed;$('homeSpeedVal').textContent=$('eventsSpeedVal').textContent}clearTimeout(et);et=setTimeout(()=>manual({speed}),160)});es.addEventListener('change',()=>{clearTimeout(et);manual({speed})})}
}
setTimeout(ensureExtraControls,0);
'''
if '</script>' not in s: raise SystemExit('script close missing')
s=s.replace('</script>',ui_js+'\n</script>',1)

# Keep new speed controls synchronized when state is refreshed.
s=s.replace("$('speed').value=speed;$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1]||'Normal';",
            "$('speed').value=speed;$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1]||'Normal';if($('homeSpeed')){$('homeSpeed').value=speed;$('homeSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1]||'Normal'}if($('eventsSpeed')){$('eventsSpeed').value=speed;$('eventsSpeedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][speed-1]||'Normal'}",1)
# Existing Lights speed slider also synchronizes the Home/Events copies.
s=s.replace("speed=+e.target.value;clearTimeout(speedSyncTimer);",
            "speed=+e.target.value;if($('homeSpeed')){$('homeSpeed').value=speed;$('homeSpeedVal').textContent=$('speedVal').textContent}if($('eventsSpeed')){$('eventsSpeed').value=speed;$('eventsSpeedVal').textContent=$('speedVal').textContent}clearTimeout(speedSyncTimer);",1)

# Verify custom schedule persistence before telling the user it saved.
s=s.replace("await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});$('scheduleOverlay').classList.remove('open');",
            "const ack=await post('/api/custom-schedules',{presetId:schedulePresetId,year:y,month:m,day:d,annual:$('customScheduleAnnual').checked});if(!ack||!ack.ok)throw new Error('NanoC6 did not confirm the schedule save');$('scheduleOverlay').classList.remove('open');",1)

# Remote OTA wording. Jason auth still protects all firmware-management routes.
s=s.replace('Routine updates can be installed here over local Wi-Fi.', 'Routine updates can be installed here from anywhere the Anderson Home controller is reachable.')
s=s.replace('Local Wi-Fi only. The device will not reboot until you press Reboot NanoC6.', 'Remote firmware update enabled for Jason. The device will not reboot until you press Reboot NanoC6.')

web.write_text(s)
print('Added global favorite colors, Home/Events speed, verified schedules, and remote Jason OTA')
