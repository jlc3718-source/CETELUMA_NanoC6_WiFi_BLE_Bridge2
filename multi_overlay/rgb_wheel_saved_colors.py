from pathlib import Path
import re, sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# ---------- NanoC6 persistent saved-color API ----------
s=main.read_text()
anchor='  server.on("/api/preset",HTTP_POST,[]{\n'
api=r'''  server.on("/api/colors",HTTP_GET,[]{
    Preferences p;p.begin("anderson-colors",true);String raw=p.getString("saved","[]");p.end();
    JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonDocument d;JsonArray out=d["colors"].to<JsonArray>();
    for(JsonVariant v:list.as<JsonArray>())out.add(v.as<String>());String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/colors",HTTP_POST,[]{
    JsonDocument d;if(!body(d))return;String col=d["color"].as<String>();col.trim();if(!col.startsWith("#"))col="#"+col;col.toUpperCase();
    if(col.length()!=7){server.send(400,"text/plain","Color must be #RRGGBB");return;}bool remove=d["remove"]|false;
    Preferences p;p.begin("anderson-colors",false);String raw=p.getString("saved","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    int found=-1;for(int i=0;i<(int)arr.size();i++){String x=arr[i].as<String>();x.toUpperCase();if(x==col){found=i;break;}}
    if(remove){if(found>=0)arr.remove(found);}else if(found<0&&arr.size()<32)arr.add(col);
    String saved;serializeJson(list,saved);p.putString("saved",saved);p.end();JsonDocument out;JsonArray oa=out["colors"].to<JsonArray>();for(JsonVariant v:arr)oa.add(v.as<String>());String json;serializeJson(out,json);sendJson(json);
  });

'''
if anchor not in s: raise SystemExit('/api/preset anchor not found')
s=s.replace(anchor,api+anchor,1)
main.write_text(s)

# ---------- RGB wheel + Saved Colors UI ----------
s=web.read_text()
css=r'''
.rgbPickerOverlay{position:fixed;inset:0;background:rgba(0,0,0,.68);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px}.rgbPickerOverlay.open{display:flex}.rgbPickerCard{width:min(94vw,430px);max-height:92vh;overflow:auto;background:#141b24;border:1px solid #334155;border-radius:18px;padding:16px;box-shadow:0 24px 80px rgba(0,0,0,.55)}.rgbWheel{width:min(72vw,280px);height:min(72vw,280px);max-width:280px;max-height:280px;aspect-ratio:1;border-radius:50%;margin:10px auto 14px;position:relative;touch-action:none;background:radial-gradient(circle at center,#fff 0%,rgba(255,255,255,.92) 4%,rgba(255,255,255,0) 72%),conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14),0 8px 25px rgba(0,0,0,.35)}.rgbWheelMarker{position:absolute;width:22px;height:22px;border:3px solid white;border-radius:50%;box-shadow:0 0 0 2px #111,0 2px 8px #000;transform:translate(-50%,-50%);pointer-events:none}.rgbReadout{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rgbReadout label{font-size:11px;color:#94a3b8}.rgbReadout input,.rgbHex{width:100%;box-sizing:border-box;background:#0b1118;color:#fff;border:1px solid #334155;border-radius:9px;padding:9px}.savedColorGrid{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.savedSwatch{width:42px;height:42px;border-radius:11px;border:2px solid rgba(255,255,255,.35);position:relative;box-shadow:0 2px 8px rgba(0,0,0,.3)}.savedSwatch .x{position:absolute;right:-6px;top:-7px;width:18px;height:18px;border-radius:50%;border:0;background:#111827;color:#fff;font-size:12px;line-height:18px;padding:0}.colorChip{width:54px;height:44px;border-radius:10px;border:2px solid rgba(255,255,255,.35);box-shadow:0 2px 8px rgba(0,0,0,.25)}.pickerPreview{height:38px;border-radius:10px;border:1px solid #334155;margin:8px 0}
'''
if '</style>' not in s: raise SystemExit('style close not found')
s=s.replace('</style>',css+'</style>',1)

modal=r'''
<div id="rgbPickerOverlay" class="rgbPickerOverlay">
  <div class="rgbPickerCard">
    <div class="row" style="justify-content:space-between;align-items:center"><strong>RGB Color Wheel</strong><button id="rgbClose" class="btn">Done</button></div>
    <div class="sub">Choose hue and saturation on the wheel. Use brightness or exact RGB/HEX values below.</div>
    <div id="rgbWheel" class="rgbWheel"><div id="rgbWheelMarker" class="rgbWheelMarker"></div></div>
    <div class="label">Color brightness</div><input id="rgbValue" type="range" min="0" max="100" value="100">
    <div id="rgbPreview" class="pickerPreview"></div>
    <div class="rgbReadout"><label>R<input id="rgbR" type="number" min="0" max="255"></label><label>G<input id="rgbG" type="number" min="0" max="255"></label><label>B<input id="rgbB" type="number" min="0" max="255"></label></div>
    <div class="label">HEX</div><input id="rgbHex" class="rgbHex" maxlength="7" value="#FFFFFF">
    <div class="row wraprow" style="margin-top:10px"><button id="rgbSave" class="btn primary">Save This Color</button></div>
    <div class="label">Saved Colors</div><div id="savedColorGrid" class="savedColorGrid"></div>
  </div>
</div>
'''
if '<script>' not in s: raise SystemExit('script tag not found')
s=s.replace('<script>',modal+'<script>',1)

js=r'''
let savedColors=[],activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;
function clamp255(v){return Math.max(0,Math.min(255,Math.round(+v||0)))}
function normHex(h){h=(h||'#FFFFFF').trim().toUpperCase();if(!h.startsWith('#'))h='#'+h;return /^#[0-9A-F]{6}$/.test(h)?h:'#FFFFFF'}
function hexRgb(h){h=normHex(h);return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function rgbHex(r,g,b){return'#'+[r,g,b].map(v=>clamp255(v).toString(16).padStart(2,'0')).join('').toUpperCase()}
function rgbHsv(r,g,b){r/=255;g/=255;b/=255;let mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,h=0;if(d){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360}return[h,mx?d/mx:0,mx]}
function hsvRgb(h,s,v){let c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c,r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}return[(r+m)*255,(g+m)*255,(b+m)*255]}
function pickerHex(){const q=hsvRgb(pickerH,pickerS,pickerV);return rgbHex(q[0],q[1],q[2])}
function setChipColor(chip,h){if(!chip)return;h=normHex(h);chip.dataset.color=h;chip.style.background=h;chip.title=h+' — tap to edit';}
function renderPicker(){const h=pickerHex(),q=hexRgb(h),w=$('rgbWheel'),rad=w.clientWidth/2,ang=(pickerH-90)*Math.PI/180,rr=pickerS*rad*.92;$('rgbWheelMarker').style.left=(rad+Math.cos(ang)*rr)+'px';$('rgbWheelMarker').style.top=(rad+Math.sin(ang)*rr)+'px';$('rgbValue').value=Math.round(pickerV*100);$('rgbR').value=q[0];$('rgbG').value=q[1];$('rgbB').value=q[2];$('rgbHex').value=h;$('rgbPreview').style.background=h;setChipColor(activeColorChip,h)}
function setPickerHex(h){const q=hexRgb(h),v=rgbHsv(q[0],q[1],q[2]);pickerH=v[0];pickerS=v[1];pickerV=v[2];renderPicker()}
function openRgbWheel(chip){activeColorChip=chip;setPickerHex(chip?.dataset.color||'#FFFFFF');$('rgbPickerOverlay').classList.add('open');renderSavedColors()}
function wheelPoint(e){const w=$('rgbWheel'),r=w.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,dist=Math.sqrt(dx*dx+dy*dy),rad=r.width/2;pickerS=Math.min(1,dist/(rad*.92));pickerH=(Math.atan2(dy,dx)*180/Math.PI+90+360)%360;renderPicker()}
function renderSavedColors(){const g=$('savedColorGrid');if(!g)return;g.innerHTML='';if(!savedColors.length){const t=document.createElement('span');t.className='sub';t.textContent='No custom colors saved yet.';g.appendChild(t);return}savedColors.forEach(c=>{const b=document.createElement('button');b.className='savedSwatch';b.style.background=c;b.title='Use '+c;b.onclick=()=>setPickerHex(c);const x=document.createElement('button');x.className='x';x.textContent='×';x.title='Delete saved color';x.onclick=e=>{e.stopPropagation();removeSavedColor(c)};b.appendChild(x);g.appendChild(b)})}
async function loadSavedColors(){try{if(API_MODE){const r=await fetch('/api/colors',{cache:'no-store'}),d=await r.json();savedColors=d.colors||[]}else savedColors=JSON.parse(localStorage.getItem('andersonSavedColors')||'[]')}catch(e){savedColors=[]}renderSavedColors()}
async function saveCurrentColor(){const c=pickerHex();if(API_MODE){const r=await post('/api/colors',{color:c});savedColors=r.colors||savedColors}else{if(!savedColors.includes(c))savedColors.push(c);savedColors=savedColors.slice(-32);localStorage.setItem('andersonSavedColors',JSON.stringify(savedColors))}renderSavedColors();status(c+' saved to Custom Colors.')}
async function removeSavedColor(c){if(API_MODE){const r=await post('/api/colors',{color:c,remove:true});savedColors=r.colors||[]}else{savedColors=savedColors.filter(x=>x!==c);localStorage.setItem('andersonSavedColors',JSON.stringify(savedColors))}renderSavedColors()}
function bindRgbPicker(){const w=$('rgbWheel');let drag=false;w.addEventListener('pointerdown',e=>{drag=true;w.setPointerCapture(e.pointerId);wheelPoint(e)});w.addEventListener('pointermove',e=>{if(drag)wheelPoint(e)});w.addEventListener('pointerup',()=>drag=false);$('rgbValue').addEventListener('input',e=>{pickerV=(+e.target.value)/100;renderPicker()});['rgbR','rgbG','rgbB'].forEach(id=>$(id).addEventListener('change',()=>setPickerHex(rgbHex($('rgbR').value,$('rgbG').value,$('rgbB').value))));$('rgbHex').addEventListener('change',e=>setPickerHex(e.target.value));$('rgbSave').addEventListener('click',saveCurrentColor);$('rgbClose').addEventListener('click',()=>$('rgbPickerOverlay').classList.remove('open'));$('rgbPickerOverlay').addEventListener('click',e=>{if(e.target===$('rgbPickerOverlay'))$('rgbPickerOverlay').classList.remove('open')});loadSavedColors()}
'''
edit_anchor='function editEventInline(ev,row){'
if edit_anchor not in s: raise SystemExit('editEventInline anchor not found')
s=s.replace(edit_anchor,js+'\n'+edit_anchor,1)

# Replace native <input type=color> buttons in direct event editing with wheel-driven color chips.
pat=r'''function addColor\(v='#ffffff'\)\{if\(colors\.children\.length>=8\)return;const inp=document\.createElement\('input'\);inp\.type='color';inp\.value=v;inp\.style\.width='54px';inp\.style\.height='42px';inp\.style\.padding='2px';inp\.style\.border='0';inp\.style\.background='transparent';inp\.title='Tap to change color';inp\.addEventListener\('contextmenu',e=>\{e\.preventDefault\(\);if\(colors\.children\.length>1\)inp\.remove\(\)\}\);colors\.appendChild\(inp\)\}'''
rep="""function addColor(v='#ffffff'){if(colors.children.length>=8)return;const inp=document.createElement('button');inp.type='button';inp.className='colorChip';setChipColor(inp,v);inp.onclick=()=>openRgbWheel(inp);inp.addEventListener('contextmenu',e=>{e.preventDefault();if(colors.children.length>1)inp.remove()});colors.appendChild(inp)}"""
s,n=re.subn(pat,rep,s,count=1)
if n!=1: raise SystemExit('native event color input function not found')

s=s.replace("const vals=[...colors.querySelectorAll('input[type=color]')].map(x=>x.value);","const vals=[...colors.querySelectorAll('.colorChip')].map(x=>x.dataset.color);",1)

# Give the editor an explicit saved-colors hint.
s=s.replace("const colorsLab=document.createElement('div');colorsLab.className='label';colorsLab.textContent='Colors';", "const colorsLab=document.createElement('div');colorsLab.className='label';colorsLab.textContent='Colors — tap a color to open the RGB wheel; saved colors are available inside the wheel';",1)

# Initialize after DOM exists.
if '</script>' not in s: raise SystemExit('script close not found')
s=s.replace('</script>','setTimeout(bindRgbPicker,0);\n</script>',1)
web.write_text(s)
print('Added RGB wheel and persistent custom saved colors')
