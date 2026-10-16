import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const home=dirname(dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(join(home,'curtain_converter.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const source=scripts.at(-1);
const section=(start,end)=>{
 const i=source.indexOf(start),j=source.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i, 'missing function section '+start);
 return source.slice(i,j);
};

test('every inline Curtain Studio script parses',()=>{
 assert.equal(scripts.length,4);
 for(const code of scripts)if(code.trim())new Script(code);
});

test('single send control preserves native scroll installer for standalone direct BLE mode',()=>{
 const click=section("$('sendLive').onclick=async()=>","$('play').onclick=");
 assert.match(click,/if\(\$\('motion'\)\.value==='scroll'&&!oracleStudio\(\)\)/);
 assert.match(click,/prepared=nativeFromImage\(sourceImage\)/);
 assert.match(click,/plan\(prepared,CID\)/);
 assert.match(click,/await delete928\(\)/);
 assert.match(click,/await sendFile\(prepared\)/);
 assert.match(source,/if\(!match\)throw Error\('Transfer acknowledged, but slot 83928 is not listed after upload'\)/);
 assert.match(html,/id="sendLive"/);
 assert.match(html,/id="stopSend"/);
});

test('static/GIF stream is honestly distinguished from saved native effects',()=>{
 const ui=section('function ui(){','function varint(');
 assert.match(ui,/No curtain connection is needed to submit it/);
 assert.match(ui,/Saved controller slots are unchanged/);
 assert.match(ui,/Replace saved slot & play/);
 const click=section("$('sendLive').onclick=async()=>","$('play').onclick=");
 assert.match(click,/else\{\s*liveActive=true;ui\(\);\s*await drawLive\(\)/);
});

test('GIF playback loops over all frames until stopped, while static sends once',async()=>{
 const draw=section('async function drawLive(){','function stopPreview(){');
 async function simulate(motion,until){
  const progress={value:0},status=[],writes=[];
  const runtime={
   connected:true,binWriter:{},stopLive:false,oracleStudio:()=>false,
   $:id=>id==='motion'?{value:motion}:id==='progress'?progress:{},
   frames:['a','b'],frameDelays:[40,40],
   ddp:async cmd=>{writes.push(cmd);},delay:async()=>{},
   renderImage:()=>{},getEncoding:()=>({kind:'palette'}),
   sendLiveFrame:async()=>{
    if(++runtime.sent>=until)runtime.stopLive=true;
    return 1;
   },
   sent:0,say:message=>status.push(message),
  };
  runInNewContext(draw+'\nthis.invoke=drawLive;',runtime);
  await runtime.invoke();
  return {sent:runtime.sent,status,progress,writes};
 }
 const gif=await simulate('gif',6);
 assert.equal(gif.sent,6);
 assert.ok(gif.status.some(x=>x.includes('GIF stopped')));
 const staticResult=await simulate('static',99);
 assert.equal(staticResult.sent,1);
 assert.ok(staticResult.status.some(x=>x.includes('Static picture displayed')));
});
