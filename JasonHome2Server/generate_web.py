#!/usr/bin/env python3
"""Produce the separately hosted Jason Home 2 UI from the proven 5.4.11 UI."""
from pathlib import Path
import shutil

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
old_resume = '.catch(()=>status("Preview mode — schedule resumed."))'
if text.count(old_resume) != 1:
    raise SystemExit("Jason Home 2 resume error handler source changed")
text = text.replace(old_resume, '.catch(e=>status("Resume failed: "+e.message))')
page.write_text(text)

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
ui.write_text(text)
print("Jason Home 2 hosted UI ready")
