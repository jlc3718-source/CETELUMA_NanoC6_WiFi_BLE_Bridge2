#!/usr/bin/env python3
"""Rebuild firmware assets from current Jason Home 2 sources. No network or secrets."""
from pathlib import Path
import gzip,hashlib,json,re,subprocess,base64,io
ROOT=Path(__file__).resolve().parents[2]
HERE=ROOT/'JasonHome2NanoC6'
subprocess.run(['python3',str(ROOT/'JasonHome2Server/generate_catalog.py')],check=True)
subprocess.run(['python3',str(ROOT/'JasonHome2Server/generate_web.py')],check=True)
web=ROOT/'JasonHome2Server/web'
assets={p.name:p.read_text() for p in web.iterdir() if p.is_file()}
assets.pop('nano_sync.js',None)
html=assets['anderson_home.html']
html=html.replace('<head>','<head><script src="nano_transport.js"></script>',1)
html=html.replace('<script src="nano_sync.js"></script>','')
html=html.replace('aiVoiceLastAudio=data.audioBase64||"";$("aiVoiceReplay").disabled=!aiVoiceLastAudio;','aiVoiceLastAudio=data.audioBase64||"";window.nanoVoiceLastText=data.reply||"";$("aiVoiceReplay").disabled=!aiVoiceLastAudio&&!window.nanoVoiceLastText;')
html=html.replace('await playAiVoiceReply(aiVoiceLastAudio,data.audioMime||"audio/mpeg");\n    }','await playAiVoiceReply(aiVoiceLastAudio,data.audioMime||"audio/mpeg");\n    }else if(data.reply&&aiVoiceSessionActive){setAiVoiceState("speaking");await window.JH2NanoSpeak(data.reply);}')
html=html.replace('()=>{if(aiVoiceLastAudio){setAiVoiceState("speaking");','()=>{if(!aiVoiceLastAudio&&window.nanoVoiceLastText){window.JH2NanoSpeak(window.nanoVoiceLastText);return;}if(aiVoiceLastAudio){setAiVoiceState("speaking");')
assets['anderson_home.html']=html
assets['nano_transport.js']=(HERE/'web/nano_transport.js').read_text()
text=assets['curtain.js']
anchor='function call(action,data={}){'
assert text.count(anchor)==1
text=text.replace(anchor,anchor+"if(window.JH2NanoCurtainCall)return window.JH2NanoCurtainCall(action,data);",1)
text=text.replace('Connect directly to the SmartDawn curtain from this phone.','Connect the local NanoC6 to the SmartDawn curtain.')
text=text.replace('Playback is handled by Android while connected; it stops on disconnect or when the app process is closed.','Playback runs on NanoC6 and continues after closing this screen.')
assets['curtain.js']=text
text=assets['android_eufy_ui.js']
text=text.replace('function openFactoryEditor(p){','async function openFactoryEditor(p){if(p._summary){const loaded=await api("/api/eufy/factory-preset?id="+p.lightId);p=loaded.preset;}',1)
text=text.replace('await post("/api/eufy/factory-presets/refresh",{});','const queued=await post("/api/eufy/factory-presets/refresh",{});for(let n=0;n<300;n++){await new Promise(r=>setTimeout(r,800));const job=await api("/api/jobs");if(job.jobId===queued.jobId&&job.done){if(!job.ok)throw Error(job.error||"Catalog refresh failed");break;}if(n===299)throw Error("Catalog refresh is still running; reopen Factory Lab shortly");}')
text=text.replace('Refreshing Eufy factory catalog on Oracle…','Refreshing Eufy factory catalog on NanoC6…')
text=text.replace('Oracle Linux → Eufy MQTT','Local NanoC6 → Eufy MQTT').replace('Oracle server controller','NanoC6 controller').replace('Oracle API token saved securely on this phone.','NanoC6 controller session is active.').replace('Normal Oracle schedule resumed.','Normal NanoC6 schedule resumed.')
assets['android_eufy_ui.js']=text
text=assets['curtain_converter.html']
text=text.replace("if(navigator.bluetooth || window.parent===window) return;","if((navigator.bluetooth && !window.parent.JH2_NANO) || window.parent===window) return;",1)
# Keep the built-in example while avoiding a high-resolution embedded example
# that consumes more flash than the updater's remaining space.
from PIL import Image
m=re.search(r"const SAMPLE_PICTURE_B64='([^']+)';",text)
if m:
    image=Image.open(io.BytesIO(base64.b64decode(m.group(1))))
    image.thumbnail((160,160))
    small=io.BytesIO();image.convert('RGB').save(small,'JPEG',quality=88,optimize=True)
    text=text[:m.start(1)]+base64.b64encode(small.getvalue()).decode()+text[m.end(1):]
assets['curtain_converter.html']=text
preview=HERE/'.pio/preview';preview.mkdir(parents=True,exist_ok=True)
for name,text in assets.items():(preview/name).write_text(text)
out='#pragma once\n#include <Arduino.h>\nstruct WebAsset{const char*path;const char*type;const uint8_t*data;size_t size;};\n'
entries=[];manifest={}
for i,(name,text) in enumerate(sorted(assets.items())):
    raw=text.encode();compressed=gzip.compress(raw,compresslevel=9,mtime=0)
    kind='text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html'
    out+=f'static const uint8_t web_{i}[] PROGMEM={{'+','.join(str(n) for n in compressed)+'};\n'
    entries.append('{'+json.dumps('/'+name)+','+json.dumps(kind)+f',web_{i},sizeof(web_{i})'+'}')
    manifest[name]={'source_bytes':len(raw),'gzip_bytes':len(compressed),'sha256':hashlib.sha256(raw).hexdigest()}
out+='static const WebAsset WEB_ASSETS[]={'+','.join(entries)+'};\n'
(HERE/'include/WebAssets.h').write_text(out)
catalog=json.loads((ROOT/'JasonHome2Server/catalog.json').read_text())
s='#pragma once\nstatic const char* const CATALOG_EVENTS[]={\n'
for e in catalog['events']:s+='R"EV('+json.dumps(e,separators=(',',':'))+')EV",\n'
s+='};\nstruct SpecialDate{const char*id;int year,month,day;};\nstatic const SpecialDate CATALOG_SPECIAL[]={\n'
for d in catalog['special']:s+='{'+json.dumps(d['id'])+','+','.join(str(d[k]) for k in ['year','month','day'])+'},\n'
s+='};\nstatic const char CATALOG_META[]=R"META('+json.dumps({k:v for k,v in catalog.items() if k not in ['events','special']},separators=(',',':'))+')META";\n'
(HERE/'include/Catalog.h').write_text(s)
subprocess.run(['node',str(HERE/'tools/generate_programs.mjs')],check=True)
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
version=(HERE/'VERSION').read_text().strip()
(HERE/'include/Build.h').write_text(f'#pragma once\n#define JH2_VERSION "{version}"\n#define JH2_BUILD_SHA "{sha}"\n')
(HERE/'asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Embedded web gzip bytes:',sum(x['gzip_bytes'] for x in manifest.values()))

(HERE/'data').mkdir(exist_ok=True)
(HERE/'data/README.txt').write_text('Jason Home 2 NanoC6 settings volume. Configure Wi-Fi locally after installation.\n')
