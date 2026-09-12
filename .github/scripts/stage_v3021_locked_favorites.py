from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {n}: {old[:80]!r}")
    p.write_text(s.replace(old, new, 1))


replace_once("FIRMWARE_VERSION.txt", "3.0.20\n", "3.0.21\n")
replace_once("README.md", "Current firmware: **v3.0.20**.", "Current firmware: **v3.0.21**.")
replace_once(
    "firmware/src/main.cpp",
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.20";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.0.21";',
)

p = Path("firmware/src/main.cpp")
s = p.read_text()
old = '''  server.on("/api/colors",HTTP_GET,[]{
    if(!requireUser())return;Preferences p;p.begin("anderson-colors",true);String raw=p.getString("saved","[]");p.end();
    JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonDocument d;JsonArray out=d["colors"].to<JsonArray>();
    for(JsonVariant v:list.as<JsonArray>())out.add(v.as<String>());String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/colors",HTTP_POST,[]{
    if(!requireUser())return;JsonDocument d;if(!body(d))return;String col=d["color"].as<String>();col.trim();if(!col.startsWith("#"))col="#"+col;col.toUpperCase();
    if(col.length()!=7){server.send(400,"text/plain","Color must be #RRGGBB");return;}col=andersonCorrectHex(col);bool remove=d["remove"]|false;
    Preferences p;p.begin("anderson-colors",false);String raw=p.getString("saved","[]");JsonDocument list;if(deserializeJson(list,raw))list.to<JsonArray>();JsonArray arr=list.as<JsonArray>();
    int found=-1;for(int i=0;i<(int)arr.size();i++){String x=arr[i].as<String>();x.toUpperCase();if(x==col){found=i;break;}}
    if(remove){if(found>=0)arr.remove(found);}else if(found<0&&arr.size()<32)arr.add(col);
    String saved;serializeJson(list,saved);p.putString("saved",saved);p.end();JsonDocument out;JsonArray oa=out["colors"].to<JsonArray>();for(JsonVariant v:arr)oa.add(v.as<String>());String json;serializeJson(out,json);sendJson(json);
  });
'''
new = '''  server.on("/api/colors",HTTP_GET,[]{
    if(!requireUser())return;JsonDocument d;d["locked"]=true;d["requiresFirmware"]=true;JsonArray out=d["colors"].to<JsonArray>();
    out.add("#FF0000");out.add("#FF0D00");out.add("#FF0024");out.add("#FFFF44");out.add("#28FF00");out.add("#00BD4C");out.add("#0D00FF");out.add("#5B00E6");out.add("#FFFFFA");
    String json;serializeJson(d,json);sendJson(json);
  });
  server.on("/api/colors",HTTP_POST,[]{
    if(!requireUser())return;server.sendHeader("Cache-Control","no-store");
    server.send(423,"application/json","{\\"ok\\":false,\\"locked\\":true,\\"error\\":\\"Master Favorite Colors are firmware-locked. Install a new firmware build to change them.\\"}");
  });
'''
if s.count(old) != 1:
    raise SystemExit(f"main.cpp: /api/colors route block match count={s.count(old)}")
p.write_text(s.replace(old, new, 1))

p = Path("firmware/web/index.html")
s = p.read_text()
oldcss = '.savedColorGrid{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.savedSwatch{width:42px;height:42px;border-radius:11px;border:2px solid rgba(255,255,255,.35);position:relative;box-shadow:0 2px 8px rgba(0,0,0,.3)}.savedSwatch .x{position:absolute;right:-6px;top:-7px;width:18px;height:18px;border-radius:50%;border:0;background:#111827;color:#fff;font-size:12px;line-height:18px;padding:0}.colorChip{width:54px;height:44px;border-radius:10px;border:2px solid rgba(255,255,255,.35);box-shadow:0 2px 8px rgba(0,0,0,.25)}.pickerPreview{height:38px;border-radius:10px;border:1px solid #334155;margin:8px 0}'
newcss = '.savedColorGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}.savedSwatch{min-width:0;min-height:48px;border-radius:10px;border:2px solid rgba(255,255,255,.35);padding:8px 6px;display:grid;place-items:center;font-weight:800;font-size:13px;line-height:1.1;text-align:center;letter-spacing:.01em;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer}.savedSwatch:active{transform:translateY(1px)}.savedSwatch:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.colorChip{width:54px;height:44px;border-radius:10px;border:2px solid rgba(255,255,255,.35);box-shadow:0 2px 8px rgba(0,0,0,.25)}.pickerPreview{height:38px;border-radius:10px;border:1px solid #334155;margin:8px 0}@media(max-width:430px){.savedColorGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}'
if s.count(oldcss) != 1:
    raise SystemExit(f"index.html: favorite CSS match count={s.count(oldcss)}")
s = s.replace(oldcss, newcss, 1)

oldbutton = '<div class="row wraprow" style="margin-top:10px"><button id="rgbSave" class="btn primary">Save This Color</button></div>'
newbutton = '<div class="note">Favorite Colors are the firmware-locked master palette. Changing the palette requires a firmware update.</div>'
if s.count(oldbutton) != 1:
    raise SystemExit(f"index.html: rgbSave block match count={s.count(oldbutton)}")
s = s.replace(oldbutton, newbutton, 1)

marker = "function displayLabel(c){const k=String(c||'').toUpperCase(),n=LED_COLOR_NAME[k],r=LED_REFERENCE[k];return n&&r?`${n} ${r} • LED ${k}`:c}\n"
helper = marker + "const MASTER_FAVORITE_COLORS=NAMED_COLOR_PALETTE.map(x=>x.output);\nfunction favoriteName(c){const k=normHex(c);return LED_COLOR_NAME[k]||k}\nfunction favoriteInk(c){const q=hexRgb(displayColor(c));return(q[0]*299+q[1]*587+q[2]*114)>155000?'#071019':'#FFFFFF'}\nfunction masterFavoriteTile(c,verb,onClick){const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=displayColor(c);b.style.color=favoriteInk(c);b.textContent=favoriteName(c);b.setAttribute('aria-label',verb+' '+favoriteName(c));b.title=verb+' '+favoriteName(c)+' '+normHex(c);b.onclick=onClick;return b}\n"
if s.count(marker) != 1:
    raise SystemExit(f"index.html: displayLabel marker count={s.count(marker)}")
s = s.replace(marker, helper, 1)

old = "savedColors.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=displayColor(c);b.title='Add '+displayLabel(c);b.onclick=()=>addColor(c);g.appendChild(b)})"
new = "savedColors.forEach(c=>g.appendChild(masterFavoriteTile(c,'Add',()=>addColor(c))))"
if s.count(old) != 1:
    raise SystemExit(f"index.html: event favorite renderer count={s.count(old)}")
s = s.replace(old, new, 1)

old = "savedColors.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=displayColor(c);b.style.color=displayColor(c);b.setAttribute('aria-label','Use '+displayLabel(c));b.title='Use '+displayLabel(c);b.onclick=()=>manual({name:'Favorite '+c,colors:[c],effect:'Jump',brightness,speed});g.appendChild(b)})"
new = "savedColors.forEach(c=>g.appendChild(masterFavoriteTile(c,'Use',()=>manual({name:'Favorite '+favoriteName(c),colors:[c],effect:'Jump',brightness,speed}))))"
if s.count(old) != 1:
    raise SystemExit(f"index.html: home favorite renderer count={s.count(old)}")
s = s.replace(old, new, 1)

old = "savedColors.forEach(c=>{const b=document.createElement('button');b.className='savedSwatch';b.style.background=displayColor(c);b.title=(forLights?'Add ':'Use ')+displayLabel(c);b.onclick=()=>{if(forLights){if(builderColors.length===1&&builderColors[0]==='#0D00FF')builderColors[0]=c;else if(builderColors.length<8)builderColors.push(c);else builderColors[builderColors.length-1]=c;renderColorBuilder();sendBuilderLook()}else setPickerHex(c)};const x=document.createElement('button');x.className='x';x.textContent='×';x.title='Delete saved color';x.onclick=e=>{e.stopPropagation();removeSavedColor(c)};b.appendChild(x);g.appendChild(b)})"
new = "savedColors.forEach(c=>g.appendChild(masterFavoriteTile(c,forLights?'Add':'Use',()=>{if(forLights){if(builderColors.length===1&&builderColors[0]==='#0D00FF')builderColors[0]=c;else if(builderColors.length<8)builderColors.push(c);else builderColors[builderColors.length-1]=c;renderColorBuilder();sendBuilderLook()}else setPickerHex(c)})))"
if s.count(old) != 1:
    raise SystemExit(f"index.html: picker favorite renderer count={s.count(old)}")
s = s.replace(old, new, 1)

old = "async function loadSavedColors(){try{if(API_MODE){const d=await api('/api/colors',{cache:'no-store'});savedColors=d.colors||[]}else savedColors=JSON.parse(localStorage.getItem('andersonSavedColors')||'[]')}catch(e){savedColors=[]}renderSavedColors()}"
new = "async function loadSavedColors(){try{if(API_MODE){const d=await api('/api/colors',{cache:'no-store'});savedColors=(d.colors||MASTER_FAVORITE_COLORS).map(normHex)}else savedColors=[...MASTER_FAVORITE_COLORS]}catch(e){savedColors=[...MASTER_FAVORITE_COLORS]}renderSavedColors()}"
if s.count(old) != 1:
    raise SystemExit(f"index.html: loadSavedColors count={s.count(old)}")
s = s.replace(old, new, 1)

old = "async function saveCurrentColor(){const c=pickerHex();if(API_MODE){const r=await post('/api/colors',{color:c});savedColors=r.colors||savedColors}else{if(!savedColors.includes(c))savedColors.push(c);savedColors=savedColors.slice(-32);localStorage.setItem('andersonSavedColors',JSON.stringify(savedColors))}renderSavedColors();status(c+' saved to Favorite Colors.')}"
new = "async function saveCurrentColor(){status('Favorite Colors are firmware-locked. A new firmware build is required to change the master palette.')}"
if s.count(old) != 1:
    raise SystemExit(f"index.html: saveCurrentColor count={s.count(old)}")
s = s.replace(old, new, 1)

old = "async function removeSavedColor(c){if(API_MODE){const r=await post('/api/colors',{color:c,remove:true});savedColors=r.colors||[]}else{savedColors=savedColors.filter(x=>x!==c);localStorage.setItem('andersonSavedColors',JSON.stringify(savedColors))}renderSavedColors()}"
new = "async function removeSavedColor(c){status('Favorite Colors are firmware-locked. A new firmware build is required to change the master palette.')}"
if s.count(old) != 1:
    raise SystemExit(f"index.html: removeSavedColor count={s.count(old)}")
s = s.replace(old, new, 1)

old = "$('rgbSave').addEventListener('click',saveCurrentColor);"
new = "const saveFavorite=$('rgbSave');if(saveFavorite)saveFavorite.addEventListener('click',saveCurrentColor);"
if s.count(old) != 1:
    raise SystemExit(f"index.html: rgbSave binding count={s.count(old)}")
s = s.replace(old, new, 1)
p.write_text(s)

p = Path("AGENTS.md")
s = p.read_text()
anchor = "- Built-in event palettes are editable through saved per-event overrides. The UI must\n  allow visible removal as well as addition of colors while keeping at least one color;\n  preserve event identity, ordering, schedules, and unrelated event settings.\n"
addition = anchor + "- v3.0.21 and later Favorite Colors are the firmware-locked nine-color master palette in this exact order: Red `#FF0000`, Orange `#FF0D00`, Pink `#FF0024`, Yellow `#FFFF44`, Green `#28FF00`, Cyan `#00BD4C`, Blue `#0D00FF`, Purple `#5B00E6`, White `#FFFFFA`. `/api/colors` is read-only; the UI must not offer add/delete controls. Changing this palette requires a firmware build.\n"
if s.count(anchor) != 1:
    raise SystemExit(f"AGENTS.md invariant anchor count={s.count(anchor)}")
p.write_text(s.replace(anchor, addition, 1))

ui = Path("firmware/web/index.html").read_text()
main = Path("firmware/src/main.cpp").read_text()
assert "Save This Color</button>" not in ui
assert "x.title='Delete saved color'" not in ui
assert "masterFavoriteTile" in ui and "favoriteName(c)" in ui
assert 'server.send(423,"application/json"' in main
assert 'd["locked"]=true' in main
assert 'ANDERSON_FIRMWARE_VERSION="3.0.21"' in main
