from pathlib import Path
import re

# Fix the pre-login recovery script inserted by the first v4.0.1 patch and remove
# the old Home-only recovery runtime entirely.
webp=Path('firmware/web/index.html')
web=webp.read_text()
start=web.find('\\n<script id="anderson-login-emergency-recovery">\\n')
end=web.find('</script>\\n',start)
if start<0 or end<0:
    raise SystemExit('escaped login recovery script not found')
end += len('</script>\\n')
script='''<script id="anderson-login-emergency-recovery">
(function(){
  const byId=id=>document.getElementById(id),pin=byId('loginRecoveryPin'),file=byId('loginRecoveryFile'),button=byId('loginRecoveryFlash'),progress=byId('loginRecoveryProgress'),out=byId('loginRecoveryStatus');
  if(!pin||!file||!button)return;
  pin.addEventListener('input',()=>pin.value=pin.value.replace(/\\D/g,'').slice(0,4));
  button.addEventListener('click',async()=>{
    const p=pin.value,f=file.files&&file.files[0];
    if(!/^\\d{4}$/.test(p)){out.textContent='Enter Jason’s four-digit PIN.';return;}
    if(!f){out.textContent='Choose an Anderson APP-only .bin file first.';return;}
    if(!/\\.bin$/i.test(f.name)){out.textContent='Firmware file must end in .bin.';return;}
    if(f.size<4096||f.size>=0x1E0000){out.textContent='That file does not fit the Anderson APP-only OTA slot.';return;}
    try{const first=new Uint8Array(await f.slice(0,1).arrayBuffer());if(first.length!==1||first[0]!==0xE9){out.textContent='Invalid ESP application image: missing 0xE9 header.';return;}}catch(e){out.textContent='Could not inspect the selected firmware file.';return;}
    if(!confirm('Emergency flash this APP-only firmware to the inactive slot and reboot?'))return;
    button.disabled=true;progress.value=0;out.textContent='Opening emergency recovery path…';
    const x=new XMLHttpRequest();x.open('POST','/api/update?recovery=1');x.setRequestHeader('Content-Type','application/octet-stream');x.setRequestHeader('X-Anderson-Recovery-PIN',p);x.setRequestHeader('X-Anderson-Filename',f.name);
    x.upload.onprogress=e=>{if(e.lengthComputable){const pct=Math.round(e.loaded*100/e.total);progress.value=pct;out.textContent=pct<100?`Emergency upload ${pct}%…`:'Upload complete. Validating APP image and boot slot…';}};
    x.onload=()=>{if(x.status>=200&&x.status<300){progress.value=100;out.textContent='Firmware accepted. NanoC6 is rebooting…';setTimeout(()=>location.reload(),6500);}else{button.disabled=false;out.textContent=x.responseText||'Emergency firmware recovery failed.';}};
    x.onerror=()=>{button.disabled=false;out.textContent='Emergency firmware upload connection failed.';};
    x.send(f);
  });
})();
</script>
'''
web=web[:start]+script+web[end:]
webp.write_text(web)

rp=Path('tools/release.py')
r=rp.read_text()
r=r.replace("V4_HOME_JS = ROOT / 'firmware/web/v4_home_recovery.js'\n",'')
r=r.replace("    if not V3_CSS.exists() or not V3_JS.exists() or not V4_HOME_JS.exists():\n        raise ValueError('Anderson UI runtime assets are missing')\n","    if not V3_CSS.exists() or not V3_JS.exists():\n        raise ValueError('Anderson UI runtime assets are missing')\n")
r=r.replace("    js = V3_JS.read_text() + '\\n' + V4_HOME_JS.read_text()\n","    js = V3_JS.read_text()\n")
if 'V4_HOME_JS' in r: raise SystemExit('V4_HOME_JS still referenced')
rp.write_text(r)

old=Path('firmware/web/v4_home_recovery.js')
if old.exists(): old.unlink()

tp=Path('tools/test_regressions.py')
t=tp.read_text()
if "assert not Path('firmware/web/v4_home_recovery.js').exists()" not in t:
    t += "\nassert not Path('firmware/web/v4_home_recovery.js').exists()\n"
tp.write_text(t)

print('v4.0.1 login recovery cleanup applied')
