import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const home=dirname(dirname(fileURLToPath(import.meta.url)));
const root=dirname(home);
const read=path=>readFileSync(join(root,path),'utf8');
const curtain=read('JasonHome2Server/curtain.js');
const converter=read('JasonHome2Server/curtain_converter.html');
const server=read('JasonHome2Server/server.mjs');
const generator=read('JasonHome2Server/generate_web.py');
const bridge=read('JasonHome2Android/src/com/jasonhome2/app/CurtainBridge.java');
const activity=read('JasonHome2Android/src/com/jasonhome2/app/MainActivity.java');

test('Curtain has two sub-tabs and preserves original control IDs',()=>{
  new Script(curtain,{filename:'curtain.js'});
  for(const term of ['jh2CurtainStudioTab','jh2CurtainControlsTab','jh2CurtainOriginalControls','jh2CurtainStudioPanel','jh2CurtainBrightness','jh2CurtainSequenceStart','jh2CurtainEffects'])
    assert.ok(curtain.includes(term),term);
  assert.match(curtain,/event\.origin!==location\.origin/);
  assert.match(curtain,/event\.source===studioFrame\.contentWindow/);
});
test('v25 converter is complete and JavaScript parses',()=>{
  const scripts=[...converter.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,4);
  for(const [i,script] of scripts.entries())if(script[1].trim())new Script(script[1],{filename:'curtain_converter_'+i+'.js'});
  for(const term of ['sourcePreview','imageInfo','framing','cleanup','zoom','sendLive','Build','83928','gif'])
    assert.ok(converter.includes(term),term);
});
test('Curtain Studio uses the condensed three-step mobile flow',()=>{
  for(const term of ['Choose your picture','Make it look its best','Prepare and send','class="steps"','class="controlGroup"','id="aiResults"'])
    assert.ok(converter.includes(term),term);
  assert.match(converter,/id="photoControls"[^>]*><summary>Adjust crop and position/);
  assert.match(converter,/id="aiResults"/);
  assert.match(converter,/\$\('aiResults'\)\.open=true/);
});
test('host serves isolated studio asset with same-origin framing',()=>{
  assert.match(generator,/curtain_converter\.html/);
  assert.match(server,/curtain_converter\.html/);
  assert.match(server,/frame-src 'self'; frame-ancestors /);
  assert.match(server,/name==="curtain_converter.html"/);
  assert.match(server,/img-src 'self' blob: data:/,'user-selected blob: images must not be CSP-blocked');
  assert.ok(generator.includes('curtain_image_headers.js'));
  assert.ok(server.includes('curtain_image_headers.js'));
  assert.ok(converter.includes('src="curtain_image_headers.js"'));
  const deployed=join(home,'web/curtain_converter.html');
  if(existsSync(join(home,'web')))assert.ok(existsSync(deployed),'generated converter absent');
});
test('Android retains Oracle-only curtain transport and photo chooser',()=>{
  for(const term of ['requireOracleOrigin','JH2OracleCurtainCall','saveRawFile','localController'])
    assert.ok(bridge.includes(term),term);
  assert.doesNotMatch(bridge,/BluetoothGatt|requestMtu\(517\)/);
  for(const term of ['onShowFileChooser','REQUEST_CURTAIN_IMAGE','onActivityResult'])
    assert.ok(activity.includes(term),term);
});
test('iframe Web Bluetooth adapter proxies writes and notifications',async()=>{
  const shim=[...converter.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  const calls=[],handlers={};
  const parent={postMessage(message){
    calls.push(message);
    Promise.resolve().then(()=>handlers.message({
      origin:'https://example.test',source:parent,
      data:{kind:'jh2-curtain-response',id:message.id,ok:true,result:{connected:true}}
    }));
  }};
  const win={parent,location:{origin:'https://example.test'},addEventListener(type,fn){handlers[type]=fn;}};
  const navigator={};
  runInNewContext(shim,{navigator,window:win,location:win.location,Promise,setTimeout,clearTimeout,Uint8Array,DataView,atob,btoa,console,Object});
  const device=await navigator.bluetooth.requestDevice();
  const srv=await device.gatt.connect();
  const svc=await srv.getPrimaryService('00000074-1972-1925-3022-077119514e44');
  const bin=await svc.getCharacteristic('02020074-1972-1925-3022-077119514e44');
  await bin.writeValueWithoutResponse(new Uint8Array([1,2,3]));
  assert.ok(calls.some(x=>x.action==='connect'));
  assert.ok(calls.some(x=>x.action==='rawWrite'&&x.payload.data==='AQID'));
  const notify=await svc.getCharacteristic('01010074-1972-1925-3022-077119514e44');
  await notify.startNotifications();
  let received;
  notify.addEventListener('characteristicvaluechanged',ev=>received=new Uint8Array(ev.target.value.buffer));
  handlers.message({origin:'https://example.test',source:parent,data:{kind:'jh2-curtain-notify',uuid:notify.uuid,data:'AAECAw=='}});
  assert.deepEqual([...received],[0,1,2,3]);
});

test('Android picker returns readable photo URIs to trusted WebView',()=>{
  assert.match(activity,/setAllowContentAccess\(true\)/);
  assert.match(activity,/setAllowFileAccess\(false\)/);
  assert.match(activity,/onShowFileChooser/);
  assert.match(activity,/Intent picker=params\.createIntent\(\)/);
   assert.doesNotMatch(activity,/picker\.setType/);
   assert.doesNotMatch(activity,/picker\.addCategory/);
  assert.match(activity,/FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(activity,/FileChooserParams\.parseResult/);
  assert.match(converter,/id="filePickerStatus"/);
  assert.match(converter,/input id="fileInput".*accept="image\/\*,\.gif"/);
});

test('AI subject revamp is explicitly opt-in and Cloudflare credentials stay on server',()=>{
  assert.match(converter,/id="aiRevamp"/);
  assert.match(converter,/id="applyAiRevamp"/);
  assert.match(converter,/id="undoAiRevamp"/);
  assert.match(converter,/api\/curtain\/ai-revamp/);
  assert.match(server,/@cf\/facebook\/detr-resnet-50/);
  assert.match(server,/if\(method==="POST"&&path==="\/api\/curtain\/ai-revamp"\)/);
  assert.match(generator,/curtain_quality\.js/);
  assert.match(server,/curtain_quality\.js/);
  assert.match(converter,/src="curtain_quality\.js"/);
});

test('AI revamp honors the user-selected subject and manual framing',()=>{
  assert.match(converter,/let userSubjectLocked=false,userFrameLocked=false/);
  assert.match(converter,/if\(userSubjectLocked\)/);
  assert.match(converter,/label='your selected subject'/);
  assert.match(converter,/keepFrame:userFrameLocked&&!userSubjectLocked/);
  assert.match(converter,/Object\.assign\(fields,\{framing:\$\('framing'\)\.value/);
  assert.match(converter,/userSubjectLocked=true/);
});

test('AI Animation replaces Local and Native Test without deleting underlying BLE support',()=>{
 assert.ok(curtain.includes('subnav.append(oldButton,studioButton,aiButton)'));
 assert.ok(curtain.includes('jh2CurtainAnimationTab'));
 assert.ok(curtain.includes('curtain_ai_animation.html'));
 assert.doesNotMatch(curtain,/localFrame|pendingLocalTest|jh2CurtainLocalTestTab/);
 assert.doesNotMatch(curtain,/testFrame|pendingNativeTest|jh2CurtainNativeTestTab|testButton/);
 assert.ok(server.includes('curtain_ai_animation.html'));
 assert.ok(generator.includes('curtain_ai_animation.html'));
 assert.ok(!generator.includes('curtain_local_test.html'));
 assert.ok(!converter.includes('sendLocalTest'));
});
test('AI Animation prompt, preview, frame count, speed slider and local delta publish parse',()=>{
 const html=read('JasonHome2Server/curtain_ai_animation.html');
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].filter(x=>x[1].trim());
 assert.equal(scripts.length,1);
 new Script(scripts[0][1],{filename:'curtain_ai_animation.js'});
 for(const id of ['prompt','generate','animate','count','speed','preview','publish','stop'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('seamlessAnimation:true'));
 assert.ok(html.includes('assetSpeed'));
 assert.ok(html.includes("status.firmware!=='1.1.55'"));
 const motion=read('JasonHome2Server/curtain_loop_animation.js');
 new Script(motion,{filename:'curtain_loop_animation.js'});
 assert.ok(motion.includes('function buildSimpleAnimation('));
 assert.ok(!motion.includes('function buildKeyframes('));
 assert.ok(html.includes('L.buildSimpleAnimation(base,'));
 assert.ok(!html.includes("api('/api/curtain/ai-animation/motion'"));
 assert.ok(!html.includes("api('/api/curtain/ai-animation/generate',{prompt:description,pose:"));
 assert.ok(html.includes('max>25'));
 const plan=read('JasonHome2Server/curtain_ai_animation.mjs');
 assert.ok(plan.includes('createCurtainAiAnimation'));
});


test('Animation is a simple 5x5 eye patch edit then exact restore, not multiple full AI poses',()=>{
 const code=read('JasonHome2Server/curtain_loop_animation.js');
 const context={window:{},Uint8ClampedArray,Math,Uint8Array};
 runInNewContext(code,context);
 const engine=context.window.JH2LoopAnimation;
 assert.equal(typeof engine.buildSimpleAnimation,'function');
 assert.equal(engine.buildKeyframes,undefined,'no extra pose redraws');
 const base=new Uint8ClampedArray(6400);
 for(let y=8;y<=32;y++)for(let x=8;x<=32;x++){
  const i=(y*40+x)*4;base.set([255,106,0,255],i);
 }
 // Carved right eye is a BLACK 5x5 hole surrounded by orange.
 for(let y=16;y<=20;y++)for(let x=22;x<=26;x++){
  const i=(y*40+x)*4;base.set([0,0,0,255],i);
 }
 const original=Buffer.from(base);
 const frames=engine.buildSimpleAnimation(base,{prompt:'orange pumpkin with a right-eye wink',count:24});
 assert.equal(frames.length,24);
 const changed=engine.validate(frames);
 assert.equal(changed.length,23);
 assert.ok(changed.some(n=>n>=5),'wink must visibly alter eye pixels');
 assert.ok(changed.some(n=>n===0),'held frames must not send any delta pixels');
 assert.ok(changed.every(n=>n<=25),'each BLE frame must change at most 5x5 pixels');
 assert.equal(engine.deltaCount(frames[0],frames.at(-1)),0);
 assert.deepEqual(Buffer.from(base),original,'original image must remain untouched');
 assert.ok(frames.some(frame=>frame[(18*40+24)*4]>128),'black wink eye must temporarily return to pumpkin color');
 assert.ok(frames.every(frame=>frame[(10*40+10)*4]===255),'the other body pixels never change');
 assert.ok(frames.every(frame=>frame[(6*40+6)*4]===0),'the background never changes');
});
