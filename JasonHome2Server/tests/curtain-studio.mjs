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
  assert.match(curtain,/event\.source!==studioFrame\.contentWindow/);
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
test('Android bridges native BLE notifications, MTU and photo chooser',()=>{
  for(const term of ['"rawWrite"','"subscribeRaw"','requestMtu(517)','onCharacteristicChanged','forwardRawNotify','RAW_UPLOAD'])
    assert.ok(bridge.includes(term),term);
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

test('Nano Local Test tab is adjacent to Native Test and uses protected separate iframe',()=>{
  assert.match(curtain,/subnav\.append\(oldButton,studioButton,testButton,localButton\)/);
  assert.match(curtain,/id='jh2CurtainLocalTestTab'/);
  assert.match(curtain,/jh2-local-test-frames/);
  assert.match(converter,/id="sendLocalTest"/);
  const local=read('JasonHome2Server/curtain_local_test.html');
  const js=[...local.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(js.length,1);
  new Script(js[0][1],{filename:'curtain_local_test.js'});
  assert.match(local,/nanoLocalCacheSupported/);
  assert.match(local,/Send to Nano/);
  assert.match(server,/curtain_local_test\.html/);
  assert.match(generator,/curtain_local_test\.html/);
});
