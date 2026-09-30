#!/usr/bin/env python3
"""Produce the separately hosted Jason Home 2 UI from the proven 5.4.11 UI."""
from pathlib import Path
import shutil


def native_effect_choices(text):
    import re, json
    names = ["Static","Flow1","Flow2","Cycle","Streamlight","Twinkle","Breathe"]
    options = ''.join('<option value="'+name+'">'+name+'</option>' for name in names)
    text = re.sub(r'<option value="Jump">.*?<option value="Pulse Wave">Pulse Wave</option>', lambda _: options, text, flags=re.S)
    old = '["Jump","Breath","Strobe","Solid","Chase","Gradient Sweep","Candy Cane","Twinkle / Sparkle","Wipe / Fill","Meteor / Comet","Rainbow Flow","Pulse Wave"]'
    text = text.replace(old, json.dumps(names,separators=(',',':')))
    text = re.sub(r'const labels=[{].*?[}];', 'const labels='+json.dumps(dict(zip(names,names)))+';', text)
    descriptions={"Static":"Hold the selected color","Flow1":"Flow along the string","Flow2":"Flow in the opposite direction","Cycle":"Cycle through selected colors","Streamlight":"Moving stream of selected colors","Twinkle":"Twinkling selected colors","Breathe":"Smooth brightness rise and fall"}
    text = re.sub(r'const descriptions=[{].*?[}];', 'const descriptions='+json.dumps(descriptions)+';', text)
    text = text.replace('const effect=node.dataset.effect,', 'const effect=({Static:"Solid",Flow1:"Chase",Flow2:"Chase",Cycle:"Jump",Streamlight:"Wipe / Fill",Twinkle:"Twinkle / Sparkle",Breathe:"Breath"}[node.dataset.effect]||node.dataset.effect),')
    return text

def ten_speed_settings(text):
    import json
    labels = json.dumps([str(i) for i in range(1,11)], separators=(',',':'))
    text = text.replace('["Very Slow","Slow","Normal","Fast","Very Fast"]', labels)
    text = text.replace('["","Very Slow","Slow","Normal","Fast","Very Fast"]', '["",'+labels[1:])
    text = text.replace('max="5"', 'max="10"').replace('c.max="5",c.value=e.speed', 'c.max="10",c.value=e.speed')
    text = text.replace('Math.min(5,parseInt(byId("homeSpeed")', 'Math.min(10,parseInt(byId("homeSpeed")')
    text = text.replace('[.4,.65,1,1.65,2.5][v-1]', '[.4,.525,.65,.825,1,1.2167,1.4333,1.65,2.075,2.5][v-1]')
    text = text.replace('["🐌","🐢","🚲","🐇","🚀"]', '["🐌","🐌","🐢","🐢","🚲","🚲","🐇","🐇","🚀","🚀"]')
    text = text.replace('[0,2e3,1e3,500,250,100][+e]', '[0,2000,1500,1000,750,500,417,333,250,175,100][+e]')
    return text

root = Path(__file__).resolve().parents[1]
source = root / "JasonHome/app/src/main/assets"
target = Path(__file__).resolve().parent / "web"
target.mkdir(exist_ok=True)
for name in ("anderson_home.html", "v3_mockup.css", "v3_mockup.js",
             "event_categories.css", "event_categories.js",
             "android_eufy_ui.css", "android_eufy_ui.js"):
    shutil.copyfile(source / name, target / name)

page = target / "anderson_home.html"
text = page.read_text()
old = 'try{const o=await fetch(e,{...t,signal:n.signal}),i=await o.text();return{response:o,text:i}}'
new = 'try{const path=location.pathname.startsWith("/jason-home-2/")?"/jason-home-2"+e:e;const o=await fetch(path,{...t,signal:n.signal,credentials:"same-origin"}),i=await o.text();return{response:o,text:i}}'
if text.count(old) != 1:
    raise SystemExit("Jason Home 2 request adapter source changed")
text = text.replace(old, new).replace("<title>Craumer Home Lights</title>",
                                     "<title>Jason Home 2</title>", 1)
text = text.replace("Craumer <b>Home</b>", "Jason <b>Home 2</b>", 1)
text = text.replace('>● Preview</div>', '>● Connecting</div>', 1)
text = text.replace('function controllerRequest(e,t={},o=12e3)',
                    'function controllerRequest(e,t={},o=45e3)', 1)
text = text.replace('async function api(e,t={},n=12e3)',
                    'async function api(e,t={},n=45e3)', 1)
text = text.replace('async function post(e,t,n=12e3)',
                    'async function post(e,t,n=45e3)', 1)
text = text.replace('setInterval(refreshVisibleState,30e3)',
                    'setInterval(refreshVisibleState,120e3)', 1)
text = text.replace('<script src="v3_mockup.js"></script>',
                    '<script src="v3_mockup.js"></script>\n<script src="night_calendar.js"></script>', 1)
old_resume = '.catch(()=>status("Preview mode — schedule resumed."))'
if text.count(old_resume) != 1:
    raise SystemExit("Jason Home 2 resume error handler source changed")
text = text.replace(old_resume, '.catch(e=>status("Resume failed: "+e.message))')
page.write_text(ten_speed_settings(native_effect_choices(text)))

ui = target / "v3_mockup.js"
text = ui.read_text()
old = 'if(!window.AndroidAnderson?.copyBackupText)throw new Error("Android clipboard bridge unavailable");window.AndroidAnderson.copyBackupText(text);'
if text.count(old) != 1:
    raise SystemExit("Jason Home 2 backup copy source changed")
text = text.replace(old, 'await navigator.clipboard.writeText(text);')
old = 'const raw=window.AndroidAnderson?.readBackupText?.()||"";'
if text.count(old) != 1:
    raise SystemExit("Jason Home 2 backup import source changed")
text = text.replace(old, 'const raw=prompt("Paste your Jason Home backup JSON here:")||"";')
ui.write_text(ten_speed_settings(native_effect_choices(text)))
shutil.copyfile(Path(__file__).resolve().parent / "night_calendar.js", target / "night_calendar.js")

eufy = target / "android_eufy_ui.js"
text = eufy.read_text()
old = """'<div class=\"sub\">Choose whether Jason Home controls the lights through Oracle or directly from this phone.</div></div>'+"""
if text.count(old) != 1:
    raise SystemExit("Jason Home 2 controller introduction source changed")
text = text.replace(old, "'<div class=\"sub\">Oracle controls all four lights.</div></div>'+", 1)
start = text.index("        '<div class=\"label\">Controller mode</div>'+", text.index("function installAndroidEufyUi"))
end = text.index("        '<div class=\"grid2\" style=\"margin-top:8px\">", start)
text = text[:start] + "        '<button id=\"testCloudController\" class=\"btn primary\" type=\"button\">Test Oracle</button>'+\n" + text[end:]
text = text.replace('api("/api/cloud/test?ts="+Date.now(),{},30000)',
                    'api("/api/cloud/test?ts="+Date.now(),{},45000)', 1)
text = text.replace('setInterval(()=>{if(!document.hidden)refreshEufyStatus();},20000)',
                    'setInterval(()=>{if(!document.hidden&&document.body.dataset.page==="settings")refreshEufyStatus();},120000)', 1)
eufy.write_text(text)
print("Jason Home 2 hosted UI ready")

