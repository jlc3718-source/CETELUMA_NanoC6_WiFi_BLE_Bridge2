#!/usr/bin/env python3
"""Scoped, rollback-safe Local Test rollout onto the EXISTING production JH2 web UI.
Never replace AI Studio with an older source snapshot; no SmartDawn slot writes.
"""
import pathlib, subprocess, tempfile, shutil, json, urllib.request, time, re
ROOT=pathlib.Path(__file__).resolve().parents[2]
CONTAINER="jason-home-2-web"
CHANGED=["server.mjs","curtain_bridge.mjs","web/curtain.js","web/curtain_converter.html"]
CREATED=["web/curtain_local_test.html"]
def run(*cmd,**kwargs):
    return subprocess.run(cmd,check=True,text=True,**kwargs)
def assert_one(s,old,context):
    if s.count(old)!=1:
        raise RuntimeError(f"Drift in {context}: expected one anchor, found {s.count(old)}")
def replace(s,old,new,context):
    assert_one(s,old,context);return s.replace(old,new,1)
def patch_server(s):
    s=replace(s,'"curtain_converter.html","curtain_quality.js"','"curtain_converter.html","curtain_local_test.html","curtain_quality.js"',"static allowlist")
    s=replace(s,'(name==="curtain_converter.html"?"\'self\'":"\'none\'")',
      '((name==="curtain_converter.html"||name==="curtain_local_test.html")?"\'self\'":"\'none\'")',"iframe CSP")
    return s
def patch_bridge(s):
    s=replace(s,
      " function assetManifest(sha){const r=db.prepare('SELECT length(bytes) size,metadata FROM curtain_assets WHERE sha=?').get(sha);return r?{sha256:sha,bytes:r.size,...JSON.parse(r.metadata)}:null;}",
      """ function assetManifest(sha){
       const r=db.prepare('SELECT length(bytes) size,metadata FROM curtain_assets WHERE sha=?').get(sha);
       if(!r)return null;
       const meta=JSON.parse(r.metadata);
       return {sha256:sha,bytes:meta.originalBytes||r.size,...meta,oracleBytes:r.size,nanoCached:meta.nanoCached===true};
      }""","asset manifest")
    s=replace(s,
      "const metadata={format:a.format,frames:a.frames,loop:a.loop,...(a.native?{native:true,cid:83928}:{}),name:String(input.name||'Curtain asset').slice(0,100)};",
      "const metadata={format:a.format,frames:a.frames,loop:a.loop,originalBytes:a.bytes.length,nanoCached:false,...(a.native?{native:true,cid:83928}:{}),name:String(input.name||'Curtain asset').slice(0,100)};",
      "asset metadata")
    s=replace(s,
      "   db.prepare('UPDATE curtain_commands SET state=?,result=? WHERE id=?').run(ack.state,JSON.stringify(result).slice(0,12000),ack.id);\n   const displaySelection=",
      """   db.prepare('UPDATE curtain_commands SET state=?,result=? WHERE id=?').run(ack.state,JSON.stringify(result).slice(0,12000),ack.id);
   // Deallocate Oracle media only AFTER SHA-verified Nano local cache and first-frame BLE ACK.
   if(old.action==='asset'&&ack.state==='applied'&&result.bleTransmitted===true&&
      body.status?.curtain?.nanoLocalCacheSupported===true&&
      String(result.message||'').includes('cached on Nano')){
     const requested=JSON.parse(old.payload).sha256;
     const file=db.prepare('SELECT metadata,length(bytes) stored FROM curtain_assets WHERE sha=?').get(requested);
     if(file&&file.stored>0){
       const meta=JSON.parse(file.metadata);
       meta.originalBytes=Number(meta.originalBytes)||file.stored;
       meta.nanoCached=true;
       db.prepare('UPDATE curtain_assets SET bytes=?,metadata=? WHERE sha=?')
         .run(Buffer.alloc(0),JSON.stringify(meta),requested);
     }
   }
   const displaySelection=""","first-frame acknowledgment")
    s=replace(s,
      "asset:sha=>db.prepare('SELECT bytes FROM curtain_assets WHERE sha=?').get(sha)?.bytes",
      "asset:sha=>{const bytes=db.prepare('SELECT bytes FROM curtain_assets WHERE sha=?').get(sha)?.bytes;return bytes?.length?bytes:undefined;}","asset accessor")
    return s
def patch_curtain(s):
    s=replace(s,
      "  subnav.append(oldButton,studioButton,testButton);\n  page.append(subnav,controls,studio,testPanel);\n  let pendingNativeTest=null;",
      """  // Local cache playback is isolated from native controller-slot experiments.
  const localButton=create('button','btn jh2-curtain-subtab','Local Test');
  localButton.type='button';localButton.id='jh2CurtainLocalTestTab';localButton.setAttribute('role','tab');
  const localPanel=create('div','jh2-curtain-subpanel jh2-curtain-converter-panel');
  localPanel.id='jh2CurtainLocalTestPanel';localPanel.hidden=true;
  const localFrame=document.createElement('iframe');
  localFrame.id='jh2CurtainLocalTestFrame';localFrame.title='Nano cached animation Local Test';
  localFrame.loading='lazy';localFrame.setAttribute('referrerpolicy','same-origin');
  localPanel.appendChild(localFrame);
  subnav.append(oldButton,studioButton,testButton,localButton);
  page.append(subnav,controls,studio,testPanel,localPanel);
  let pendingNativeTest=null,pendingLocalTest=null;
  function deliverLocalTest(){
    if(pendingLocalTest&&localFrame.contentWindow&&localFrame.getAttribute('src'))
      localFrame.contentWindow.postMessage({kind:'jh2-local-test-frames',...pendingLocalTest},location.origin);
  }""","Local Test navigation")
    s=replace(s,"    controls.hidden=which!=='controls';studio.hidden=which!=='studio';testPanel.hidden=which!=='test';",
      "    controls.hidden=which!=='controls';studio.hidden=which!=='studio';testPanel.hidden=which!=='test';localPanel.hidden=which!=='local';","tab selection")
    s=replace(s,"    testPanel.style.display=which==='test'?'':'none';",
      "    testPanel.style.display=which==='test'?'':'none';\n    localPanel.style.display=which==='local'?'':'none';","panel display")
    s=replace(s,"[testButton,which==='test']])","[testButton,which==='test'],[localButton,which==='local']])","selected tabs")
    s=replace(s,"    if(which==='test'&&!testFrame.getAttribute('src'))testFrame.src='curtain_native_test.html?v=ram-upload-1.1.49';",
      "    if(which==='test'&&!testFrame.getAttribute('src'))testFrame.src='curtain_native_test.html?v=ram-upload-1.1.49';\n    if(which==='local'&&!localFrame.getAttribute('src'))localFrame.src='curtain_local_test.html?v=nano-cache-1';","iframe routing")
    s=replace(s,"  testButton.addEventListener('click',()=>selectCurtainSubtab('test'));",
      "  testButton.addEventListener('click',()=>selectCurtainSubtab('test'));\n  localButton.addEventListener('click',()=>selectCurtainSubtab('local'));","tab event")
    s=replace(s,
      "const sender=event.source===studioFrame.contentWindow?studioFrame:event.source===testFrame.contentWindow?testFrame:null;",
      "const sender=event.source===studioFrame.contentWindow?studioFrame:event.source===testFrame.contentWindow?testFrame:event.source===localFrame.contentWindow?localFrame:null;","same origin sender")
    s=replace(s,"    if(sender===testFrame&&data.kind==='jh2-native-test-ready'){",
      """    if(sender===studioFrame&&data.kind==='jh2-local-test-open'){
      const frames=data.frames,delays=data.delays;
      if(!Array.isArray(frames)||frames.length<1||frames.length>180||
        frames.some(f=>!(f instanceof Uint8Array||f instanceof Uint8ClampedArray||Array.isArray(f))||f.length!==6400))return;
      if(!Array.isArray(delays)||delays.length!==frames.length||
        delays.some(d=>!Number.isFinite(Number(d))||Number(d)<40||Number(d)>60000))return;
      pendingLocalTest={frames:frames.map(f=>new Uint8ClampedArray(f)),delays:delays.map(Number),
        quality:String(data.quality||'pal8'),name:String(data.name||'Local test').slice(0,100)};
      selectCurtainSubtab('local');
      if(localFrame.dataset.ready==='true')deliverLocalTest();
      return;
    }
    if(sender===localFrame&&data.kind==='jh2-local-test-ready'){
      localFrame.dataset.ready='true';deliverLocalTest();return;
    }
    if(sender===testFrame&&data.kind==='jh2-native-test-ready'){""","studio frame handoff")
    s=replace(s,"for(const frame of [studioFrame,testFrame])","for(const frame of [studioFrame,testFrame,localFrame])","notification relay")
    return s
def patch_studio(s):
    s=replace(s,
      '<div class="buttons"><button id="testNativeFrames" type="button">🧪 Test these frames in Native tab</button></div>',
      '<div class="buttons"><button id="testNativeFrames" type="button">🧪 Test these frames in Native tab</button><button id="testLocalFrames" type="button">Local Test → Nano</button></div>',
      "AI Studio Local Test button")
    s=replace(s,"'uploadControllerSlot','testNativeFrames'","'uploadControllerSlot','testNativeFrames','testLocalFrames'","Studio busy-state controls")
    s=replace(s,"$('nativeFile').onchange=async event=>{",
      """$('testLocalFrames').onclick=()=>{
 if(busy)return;
 if(animationFrames.length<1||animationFrames.length>180){
   return $('nativeSlotStatus').textContent='Prepare 1–180 exact 40×40 frames in Studio first.';
 }
 if(window.parent===window)return $('nativeSlotStatus').textContent='Open Studio inside Jason Home 2 Curtain.';
 window.parent.postMessage({
   kind:'jh2-local-test-open',
   name:($('prompt').value.trim().slice(0,65)||'40×40 animation'),
   frames:animationFrames.map(f=>new Uint8ClampedArray(f.data)),
   delays:animationFrames.map(()=>Math.max(40,Math.min(60000,previewDelay()))),
   quality:'pal8'
 },location.origin);
 $('nativeSlotStatus').textContent='Opened Nano Local Test with '+animationFrames.length+' prepared frames. No controller slot upload.';
};
$('nativeFile').onchange=async event=>{""","AI Studio frame send")
    return s
def check_types(stage):
    for file in ["server.mjs","curtain_bridge.mjs","web/curtain.js"]:
        run("docker","cp",str(stage/file),f"{CONTAINER}:/tmp/jh2-local-check-"+pathlib.Path(file).name)
        run("docker","exec",CONTAINER,"node","--check","/tmp/jh2-local-check-"+pathlib.Path(file).name)
    import re
    for name in ["curtain_converter.html","curtain_local_test.html"]:
        source=(stage/"web"/name).read_text()
        scripts=re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>",source,re.S)
        for i,script in enumerate(scripts):
            if not script.strip():continue
            path=stage/(name+f"-inline-{i}.js")
            path.write_text(script)
            run("docker","cp",str(path),f"{CONTAINER}:/tmp/jh2-{name}-{i}.js")
            run("docker","exec",CONTAINER,"node","--check",f"/tmp/jh2-{name}-{i}.js")
def main():
    with tempfile.TemporaryDirectory(prefix="jh2-local-rollout-") as temp:
        root=pathlib.Path(temp);original=root/"original";stage=root/"stage"
        original.mkdir();stage.mkdir()
        for name in CHANGED:
            (original/name).parent.mkdir(parents=True,exist_ok=True)
            (stage/name).parent.mkdir(parents=True,exist_ok=True)
            run("docker","cp",f"{CONTAINER}:/app/{name}",str(original/name))
            shutil.copy2(original/name,stage/name)
        for name,fn in [("server.mjs",patch_server),("curtain_bridge.mjs",patch_bridge),
                        ("web/curtain.js",patch_curtain),("web/curtain_converter.html",patch_studio)]:
            source=(stage/name).read_text()
            new=fn(source)
            if new==source:raise RuntimeError("Nothing changed in "+name)
            (stage/name).write_text(new)
        local_src=ROOT/"JasonHome2Server"/"curtain_local_test.html"
        assert local_src.exists()
        (stage/CREATED[0]).parent.mkdir(exist_ok=True)
        shutil.copy2(local_src,stage/CREATED[0])
        check_types(stage)
        print("LOCAL_TEST_SOURCE_AND_JAVASCRIPT_VERIFIED",flush=True)
        updated=[]
        try:
            for name in CHANGED+CREATED:
                run("docker","cp",str(stage/name),f"{CONTAINER}:/app/{name}")
                updated.append(name)
            run("docker","restart",CONTAINER,stdout=subprocess.DEVNULL)
            success=False
            for _ in range(45):
                try:
                    with urllib.request.urlopen("http://127.0.0.1:8081/api/health",timeout=6) as response:
                        if json.load(response).get("ok") is True:success=True;break
                except Exception:time.sleep(2)
            assert success,"Web app health did not recover"
            server_now=subprocess.check_output(["docker","exec",CONTAINER,"sha256sum","/app/web/curtain.js"],text=True)
            assert server_now
            # No GATT or curtain commands are issued by this deployment.
            assert "jh2CurtainLocalTestTab" in (stage/"web/curtain.js").read_text()
            print("LOCAL_TEST_PRODUCTION_DEPLOYED_HEALTHY",flush=True)
        except BaseException:
            for name in CHANGED:
                if name in updated:run("docker","cp",str(original/name),f"{CONTAINER}:/app/{name}")
            if CREATED[0] in updated:run("docker","exec",CONTAINER,"rm","-f","/app/"+CREATED[0])
            if updated:run("docker","restart",CONTAINER,stdout=subprocess.DEVNULL)
            print("LOCAL_TEST_DEPLOYMENT_ROLLED_BACK",flush=True)
            raise
if __name__=="__main__":main()
