from pathlib import Path
import re
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else '.')

# Types.h: four-effect model + legacy compatibility aliases
p=root/'include/Types.h'
s=p.read_text()
s=re.sub(r'enum class Effect : uint8_t \{[^}]+\};', 'enum class Effect : uint8_t { Jump, Breath, Strobe, Gradient };', s)
s=s.replace('Effect effect = Effect::Solid;', 'Effect effect = Effect::Jump;')
start=s.index('inline const char* effectName(Effect e) {')
end=s.index('inline const char* kindName(EventKind k) {')
new='''inline const char* effectName(Effect e) {\n  switch(e) {\n    case Effect::Jump: return "Jump";\n    case Effect::Breath: return "Breath";\n    case Effect::Strobe: return "Strobe";\n    case Effect::Gradient: return "Gradient";\n  }\n  return "Jump";\n}\n\ninline Effect effectFromString(const String& s) {\n  // Current Anderson Home effect set. Legacy names are intentionally mapped so\n  // old presets/API calls cannot reintroduce retired effects.\n  if (s=="Breath" || s=="Pulse") return Effect::Breath;\n  if (s=="Strobe" || s=="Twinkle") return Effect::Strobe;\n  if (s=="Gradient" || s=="Fade" || s=="Rainbow" || s=="Fire" || s=="Water") return Effect::Gradient;\n  // Jump is also the safe replacement for Solid/Chase/Meteor/Candy Cane.\n  return Effect::Jump;\n}\n\n'''
s=s[:start]+new+s[end:]
p.write_text(s)

# Scheduler defaults and combined themes
p=root/'src/Scheduler.cpp'; s=p.read_text()
s=s.replace('Effect::Solid','Effect::Jump').replace('Effect::Chase','Effect::Gradient')
p.write_text(s)

# Event catalog mapping: every event gets one of the four approved effects.
p=root/'src/EventCatalog.cpp'; s=p.read_text()
mapping={
 'Solid':'Jump','Chase':'Jump','Meteor':'Jump','CandyCane':'Jump',
 'Pulse':'Breath','Twinkle':'Strobe',
 'Fade':'Gradient','Rainbow':'Gradient','Fire':'Gradient','Water':'Gradient'
}
for old,newv in mapping.items(): s=s.replace(f'Effect::{old}', f'Effect::{newv}')
p.write_text(s)

# BLE software effect engine. Keep proven connection/protocol code, replace only applyTheme logic.
p=root/'src/BleController.cpp'; s=p.read_text()
start=s.index('bool BleController::targetUsesSoftwareEffects() const')
end=s.index('void BleController::loop(){')
new='''bool BleController::targetUsesSoftwareEffects() const{return true;}\n\nvoid BleController::applyTheme(const Theme& t,uint8_t bright,uint8_t speedLevel,uint32_t nowMs,bool force){\n  uint8_t sp=map(constrain(speedLevel,1,5),1,5,20,95);\n  bool changed=!activeValid||activeTheme.name!=t.name||activeTheme.effect!=t.effect||activeTheme.colorCount!=t.colorCount;\n  if(force||changed){\n    activeTheme=t;activeValid=true;setPower(true);setBrightness(bright);setSpeed(sp);lastEffect=0;\n  }\n  uint8_t count=max((uint8_t)1,t.colorCount);\n  uint32_t interval=map(constrain(speedLevel,1,5),1,5,700,95);\n\n  // Jump: discrete color-to-color changes. One color intentionally behaves as a steady color.\n  if(t.effect==Effect::Jump){\n    if(count==1){if(force||changed)setColor(t.colors[0]);return;}\n    if(!force && nowMs-lastEffect<interval)return;\n    lastEffect=nowMs;\n    uint32_t step=(nowMs/interval)%count;\n    setColor(t.colors[step]);\n    if(force||changed)setBrightness(bright);\n    return;\n  }\n\n  // Strobe: sharp on/off flashes; configured colors rotate between flashes.\n  if(t.effect==Effect::Strobe){\n    uint32_t half=max((uint32_t)45,interval/2);\n    if(!force && nowMs-lastEffect<half)return;\n    lastEffect=nowMs;\n    uint32_t phase=nowMs/half;\n    if((phase&1)==0){setColor(0x000000);}\n    else {setColor(t.colors[(phase/2)%count]);}\n    if(force||changed)setBrightness(bright);\n    return;\n  }\n\n  // Breath and Gradient are smooth software animations so they work identically on both ELK strings.\n  uint32_t frame=max((uint32_t)55,interval/5);\n  if(!force && nowMs-lastEffect<frame)return;\n  lastEffect=nowMs;\n  float cycleMs=(float)(interval*8UL);\n  float phase=fmodf((float)nowMs,cycleMs)/cycleMs;\n  int idx=(int)(phase*count)%count;\n  int nxt=(idx+1)%count;\n  float local=fmodf(phase*count,1.0f);\n  uint32_t a=t.colors[idx],z=t.colors[nxt];\n  uint8_t R=(uint8_t)(r8(a)+(r8(z)-r8(a))*local);\n  uint8_t G=(uint8_t)(g8(a)+(g8(z)-g8(a))*local);\n  uint8_t B=(uint8_t)(b8(a)+(b8(z)-b8(a))*local);\n  uint32_t color=((uint32_t)R<<16)|((uint32_t)G<<8)|B;\n\n  if(t.effect==Effect::Breath){\n    // Switch/blend colors slowly while brightness rises and falls.\n    float wave=0.5f-0.5f*cosf(phase*2.0f*PI);\n    uint8_t level=(uint8_t)max(1.0f,bright*(0.10f+0.90f*wave));\n    setColor(count>1?color:t.colors[0]);\n    setBrightness(level);\n    return;\n  }\n\n  // Gradient: continuously blend through the event/preset colors at the selected speed.\n  setColor(color);\n  if(force||changed)setBrightness(bright);\n}\n\n'''
s=s[:start]+new+s[end:]
p.write_text(s)

# main defaults + custom preset default
p=root/'src/main.cpp'; s=p.read_text()
s=s.replace('runningTheme.effect=Effect::Solid','runningTheme.effect=Effect::Jump')
s=s.replace('String("Solid")','String("Jump")')
p.write_text(s)

# Web UI: expose only the four requested effects, and make preview engine match firmware semantics.
p=root/'include/WebUI.h'; s=p.read_text()
s=s.replace('<option>Solid</option><option>Fade</option><option>Pulse</option><option>Rainbow</option><option>Chase</option><option>Twinkle</option><option>Meteor</option><option>Candy Cane</option><option>Fire</option><option>Water</option>', '<option>Jump</option><option>Breath</option><option>Strobe</option><option>Gradient</option>')
s=s.replace("let running={name:'Warm White',colors:['#fff1c7'],effect:'Solid'},preview={...running,colors:[...running.colors]};", "let running={name:'Warm White',colors:['#fff1c7'],effect:'Jump'},preview={...running,colors:[...running.colors]};")
# Replace paint() function completely
pat=r"function paint\(state,i,br,total\)\{.*?\}return\{c,a,s\}\}"
m=re.search(pat,s)
if not m: raise SystemExit('paint function not found')
paint="""function paint(state,i,br,total){let colors=state.colors&&state.colors.length?state.colors:['#25a7ff'],e=state.effect||'Jump',c=colors[0],a=br,sc=1,n=colors.length;if(!power){return{c:'#2a313b',a:.35,s:1}}if(e==='Jump'){c=colors[Math.floor(tick)%n]}else if(e==='Strobe'){let on=(Math.floor(tick*2)%2)===1;c=on?colors[Math.floor(tick/2)%n]:'#000000';a=on?br:.05;sc=on?1.08:.92}else if(e==='Breath'){let w=.10+.90*((Math.sin(tick/2)+1)/2);c=colors[Math.floor(tick/6)%n];a=br*w}else if(e==='Gradient'){let p=((tick/6)%n+n)%n,idx=Math.floor(p),j=(idx+1)%n,f=p-idx;const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)],A=rgb(colors[idx]),B=rgb(colors[j]);c=`rgb(${Math.round(A[0]+(B[0]-A[0])*f)},${Math.round(A[1]+(B[1]-A[1])*f)},${Math.round(A[2]+(B[2]-A[2])*f)})`}return{c,a,s:sc}}"""
s=s[:m.start()]+paint+s[m.end():]
# demo event mappings and fallback preview state
repls={"effect:'Chase'":"effect:'Jump'","effect:'Twinkle'":"effect:'Strobe'","effect:'Fade'":"effect:'Gradient'","effect:'Pulse'":"effect:'Breath'","effect:'Solid'":"effect:'Jump'","'Fade'":"'Gradient'"}
for a,b in repls.items(): s=s.replace(a,b)
# test buttons: only approved names
s=s.replace("manual({name:'BLE Test Red',colors:['#ff0000'],effect:'Solid'})", "manual({name:'BLE Test Red',colors:['#ff0000'],effect:'Jump'})")
s=s.replace("$('testRainbow').addEventListener('click',()=>manual({name:'BLE Test Rainbow',colors:['#25a7ff'],effect:'Rainbow'}));", "$('testRainbow').textContent='Test Gradient';$('testRainbow').addEventListener('click',()=>manual({name:'BLE Test Gradient',colors:['#25a7ff','#7e22ce','#ffffff'],effect:'Gradient'}));")
# Update labels that default to Solid
s=s.replace('>Solid</div>','>Jump</div>')
# Custom/fallback default effect strings
s=s.replace("obj.effect||'Solid'", "obj.effect||'Jump'")
s=s.replace("String('Solid')", "String('Jump')")
p.write_text(s)

print('patched')
