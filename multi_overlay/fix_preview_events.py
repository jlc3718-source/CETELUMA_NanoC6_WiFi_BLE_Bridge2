from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
s = p.read_text()

# Make the browser preview use the exact same speed timing as the NanoC6 4FX engine.
# Firmware intervals for speed levels 1..5 are 700, 549, 398, 247, 95 ms.
paint_pat = r"function paint\(state,i,br,total\)\{.*?return\{c,a,s:sc\}\}"
paint_new = r'''function speedInterval(level){return [0,700,549,398,247,95][+level]||398}
function blendHex(a,b,f){const rgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)],A=rgb(a),B=rgb(b);return `rgb(${Math.round(A[0]+(B[0]-A[0])*f)},${Math.round(A[1]+(B[1]-A[1])*f)},${Math.round(A[2]+(B[2]-A[2])*f)})`}
function paint(state,i,br,total){const colors=state.colors&&state.colors.length?state.colors:['#25a7ff'],e=state.effect||'Jump',n=colors.length,frame=Math.floor(tick),phase=((tick%8)+8)%8/8;let c=colors[0],a=br,sc=1;if(!power)return{c:'#2a313b',a:.35,s:1};if(e==='Jump'){c=colors[frame%n]}else if(e==='Strobe'){const half=Math.floor(tick*2),on=(half&1)===1;c=on?colors[Math.floor(half/2)%n]:'#000000';a=on?br:.05;sc=on?1.08:.92}else{const pos=phase*n,idx=Math.floor(pos)%n,j=(idx+1)%n,f=pos-Math.floor(pos),mixed=blendHex(colors[idx],colors[j],f);if(e==='Breath'){const wave=.10+.90*(.5-.5*Math.cos(phase*2*Math.PI));c=n>1?mixed:colors[0];a=br*wave}else if(e==='Gradient'){c=mixed}}return{c,a,s:sc}}'''
s, n = re.subn(paint_pat, paint_new, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit('4FX paint() function not found')

animate_pat = r"function animate\(\)\{.*?requestAnimationFrame\(animate\)\}requestAnimationFrame\(animate\);"
animate_new = r'''function animate(ts){tick=ts/speedInterval(speed);const br=brightness/100;leds.forEach((el,i)=>{const x=paint(preview,i,br,leds.length);el.style.background=x.c;el.style.opacity=Math.max(.08,x.a);el.style.boxShadow=power?`0 0 ${Math.round(4+12*x.a)}px ${x.c}`:'none';el.style.transform=`scale(${x.s})`});houseLeds.forEach((el,i)=>{const x=paint(running,i,br,houseLeds.length);el.setAttribute('fill',x.c);el.setAttribute('opacity',Math.max(.12,x.a));el.style.filter=power?`drop-shadow(0 0 ${Math.round(2+7*x.a)}px ${x.c})`:'none'});requestAnimationFrame(animate)}requestAnimationFrame(animate);'''
s, n = re.subn(animate_pat, animate_new, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit('animate() function not found')

# Keep the physical light strings and the browser preview synchronized while the speed slider moves.
old_speed = "$('speed').addEventListener('input',e=>{$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][+e.target.value-1];speed=+e.target.value});$('speed').addEventListener('change',e=>manual({speed:+e.target.value}));"
new_speed = "let speedSyncTimer=null;$('speed').addEventListener('input',e=>{$('speedVal').textContent=['Very Slow','Slow','Normal','Fast','Very Fast'][+e.target.value-1];speed=+e.target.value;clearTimeout(speedSyncTimer);speedSyncTimer=setTimeout(()=>manual({speed}),160)});$('speed').addEventListener('change',e=>{clearTimeout(speedSyncTimer);manual({speed:+e.target.value})});"
if old_speed not in s:
    raise SystemExit('speed slider handler not found')
s = s.replace(old_speed, new_speed, 1)

# Event Preview must visibly do something: preview locally AND apply the event to both saved controllers.
old_event = "pv.addEventListener('click',()=>{setPreview(ev.name,ev.colors,ev.effect);status(ev.name+' loaded in preview only.')})"
new_event = "pv.addEventListener('click',async()=>{setPreview(ev.name,ev.colors,ev.effect);if(API_MODE){try{await post('/api/ble/target',{target:0})}catch(e){}}await manual({name:ev.name,colors:ev.colors,effect:ev.effect,speed});status(ev.name+' previewing on all light strings. Use Resume Schedule when finished.')})"
if old_event not in s:
    raise SystemExit('event Preview handler not found')
s = s.replace(old_event, new_event, 1)

# Make brightness preview react immediately too; the final value is still sent to the NanoC6 on change.
s = s.replace("$('brightness').addEventListener('input',e=>{$('brightVal').textContent=e.target.value+'%';$('homeBrightness').value=e.target.value;$('homeBrightVal').textContent=e.target.value+'%'})", "$('brightness').addEventListener('input',e=>{brightness=+e.target.value;$('brightVal').textContent=e.target.value+'%';$('homeBrightness').value=e.target.value;$('homeBrightVal').textContent=e.target.value+'%'})", 1)
s = s.replace("$('homeBrightness').addEventListener('input',e=>{$('homeBrightVal').textContent=e.target.value+'%';$('brightness').value=e.target.value;$('brightVal').textContent=e.target.value+'%'})", "$('homeBrightness').addEventListener('input',e=>{brightness=+e.target.value;$('homeBrightVal').textContent=e.target.value+'%';$('brightness').value=e.target.value;$('brightVal').textContent=e.target.value+'%'})", 1)

p.write_text(s)
print('Fixed preview timing, live speed sync, and event Preview buttons')
