import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parsePixelGrid} from '../curtain_pixel_grid.mjs';
import {renderShapeArt,subjectBlockArt} from '../curtain_shape_art.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=name=>readFileSync(join(root,name),'utf8');
const converter=read('curtain_converter.html'),server=read('server.mjs'),curtain=read('curtain.js'),assets=read('curtain_asset.mjs');
const js=[...converter.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
test('AI generator is minimal and its script parses',()=>{
 const inline=js.filter(x=>x[1].trim());assert.equal(inline.length,1);new Script(inline[0][1],{filename:'curtain_converter.html'});
 for(const id of ['prompt','generate','sample','file','image','preview','send','stop','speed','connection','testResult'])
   assert.ok(converter.includes('id="'+id+'"'),id);
 assert.doesNotMatch(inline[0][1],/requestDevice|gatt\.connect|BLE scan|upload firmware/);
});
test('Oracle public OTA manifest proxy exposes signed release metadata only',()=>{
 assert.match(server,/path==="\/api\/curtain\/firmware-manifest"/);
 assert.match(server,/jh2-nanoc6-ota\/latest\.json/);
 assert.match(server,/manifest\.signature/);
 assert.match(server,/redirect:"error"/);
});
test('Oracle serves exact canonical signed SHA-verified runtime BIN without a new key',()=>{
 assert.match(server,/firmware-runtime/);
 assert.match(server,/fields\.url!==canonical/);
 assert.match(server,/createHash\("sha256"\)\.update\(bytes\)/);
 assert.match(server,/fields\.product!==/);
 assert.match(server,/manifest\.signature/);
 assert.match(server,/x-firmware-sha256/);
});
test('Generate uses configured Cloudflare Workers AI, never an automatic paid call',()=>{
 assert.match(server,/path==="\/api\/curtain\/generate-art"/);
 assert.match(server,/cloudflareAiRun/);
 assert.match(server,/@cf\/black-forest-labs\/flux-1-schnell/);
 assert.match(server,/steps:4/);
 assert.match(server,/parsePixelGrid/);
 assert.doesNotMatch(server.slice(server.indexOf('if(method==="POST"&&path==="/api/curtain/generate-art")'),server.indexOf('if(method==="POST"&&path==="/api/curtain/ai-revamp")')),/renderShapeArt|cloudflareAiChat/);
 assert.match(server,/cloudflareAiConfigured\(\)/);
 assert.match(server,/One enormous centered subject/);
 assert.match(server,/referenceColors/);
 assert.match(converter,/\$\('generate'\)\.onclick=async/);
 assert.match(converter,/\/api\/curtain\/generate-art/);
});
test('Oracle gets 40x40 prepared RGBA, palette compression and approved asset command',()=>{
 assert.match(converter,/width="40" height="40"/);
 assert.match(converter,/block\.width=20/);
 assert.match(converter,/referenceColors\.map\(fromHex\)/);
 assert.match(converter,/JH2_CURTAIN_IMAGE_SRC/);
 assert.match(converter,/loadFactoryGallery/);
 assert.match(converter,/output\.data\[dest\+3\]=255/);
 assert.match(converter,/base64\(new Uint8Array\(prepared.data\)\)/);
 assert.match(converter,/await load\(r.image\)/);
 assert.match(converter,/canvas.toDataURL\('image\/png'\)/);
 assert.match(converter,/quality:'rgbfull'/);
 assert.match(converter,/queue\('asset',payload\)/);
 assert.match(converter,/JH2CurtainLastSelection/);
 assert.match(assets,/6400 RGBA bytes/);
});
test('Full animation Studio preserves legacy still-image tools and composes true multi-frame assets',()=>{
 for(const id of ['style','colors','generate','sample','send','stop','frameCount','motion','frameDelay','motionPrompt','loop',
  'aiFrames','autoFrames','animationPreview','frameStrip','playFrames','pauseFrames','prevFrame','nextFrame',
  'addFrame','duplicateFrame','removeFrame','clearFrames','leftFrame','rightFrame','publishAnimation']){
  assert.ok(converter.includes('id="'+id+'"'),id);
 }
 assert.match(converter,/function frameMotion\(/);
 assert.match(converter,/function frameThumbnail\(/);
 assert.match(converter,/frameIndex/);
 assert.match(converter,/frameCount:total/);
 assert.match(converter,/previewTimer=setInterval/);
 assert.match(converter,/animationFrames\.map\(f=>base64\(new Uint8Array\(f\.data\)\)\)/);
 assert.match(converter,/delays:animationFrames\.map\(/);
 assert.match(converter,/loop:\$\('loop'\)\.checked/);
 assert.match(converter,/quality:'rgbfull'/);
 assert.match(converter,/await queue\('asset',payload\)/);
 assert.match(converter,/await ack\(id,120000\)/);
 assert.match(assets,/images\.length>180/);
 assert.match(assets,/Each prepared frame must contain 6400 RGBA bytes/);
 assert.match(assets,/Math\.max\(40,Math\.min\(60000/);
});
test('Cloudflare FLUX generation enforces simplified art and bounded keyframe inputs',()=>{
 const route=server.slice(server.indexOf('if(method==="POST"&&path==="/api/curtain/generate-art")'),
                         server.indexOf('if(method==="POST"&&path==="/api/curtain/ai-revamp")'));
 for(const term of ['"blocky"','"simple"','"classic"','styleRules','body.colorLimit',
  'body.frameCount','body.frameIndex','total>12','frame>=total','"Frame "+(frame+1)','"No tiny details',
  'const motion=String(body.motion||"")']){
  assert.ok(route.includes(term),term);
 }
 assert.match(route,/@cf\/black-forest-labs\/flux-1-schnell/);
 assert.doesNotMatch(route,/curtainRelay\.enqueue|curtainRelay\.upload/);
});
test('speed test measures actual applied acknowledgments rather than a queued response',()=>{
 assert.match(converter,/i<3/);
 assert.match(converter,/queue\('nanoInfo'\)/);
 assert.match(converter,/c.state==='applied'/);
 assert.match(converter,/x.pushConnected/);
});
test('Curtain host retains existing original controls and studio iframe',()=>{
 new Script(curtain,{filename:'curtain.js'});
 for(const term of ['jh2CurtainStudioTab','jh2CurtainControlsTab','jh2CurtainOriginalControls','jh2CurtainStudioPanel','jh2CurtainBrightness','jh2CurtainSequenceStart'])
   assert.ok(curtain.includes(term),term);
});
test('Native pixel AI returns exact 40x40 RGBA and no post-generation scaling',()=>{
 const rows=Array(20).fill('00000001111110000000');
 const design=parsePixelGrid(JSON.stringify({palette:['#000000','#F78315'],rows}));
 const data=Buffer.from(design.rgba,'base64');
 assert.equal(data.length,6400);
 assert.equal(design.sourceBlocks,120);
 assert.ok(design.activeBlocks>=60,'auto-framed subject should remain legible');
 const at=(x,y)=>[...data.subarray((y*40+x)*4,(y*40+x)*4+4)];
 assert.deepEqual(at(0,0),[0,0,0,255]);
 assert.deepEqual(at(20,20),[247,131,21,255]);
 assert.deepEqual(at(21,21),at(20,20));
 assert.deepEqual(at(20,22),[247,131,21,255]);
 assert.equal(design.outputGrid,'40x40');
 assert.match(converter,/await load\(r.image\)/);
 assert.match(converter,/quality:'rgbfull'/);
 assert.match(assets,/count===1600\|\|trueColor\.length/);
 assert.throws(()=>parsePixelGrid(JSON.stringify({palette:['#000000','#FF0000'],rows:['011']})),/approximately 20/);
});

test('AI small artwork is auto-framed instead of rejecting below 45 blocks',()=>{
 const rows=Array(20).fill('00000000000000000000');
 for(let y=8;y<=11;y++)rows[y]='00000000011100000000';
 const art=parsePixelGrid(JSON.stringify({palette:['#000000','#FA7C12'],rows}));
 assert.equal(art.sourceBlocks,12);
 assert.ok(art.activeBlocks>=45);
 assert.equal(art.autoFramed,true);
 const data=Buffer.from(art.rgba,'base64');
 assert.equal(data.length,6400);
 for(let y=0;y<40;y+=2)for(let x=0;x<40;x+=2){
  const a=(y*40+x)*4,b=((y+1)*40+x+1)*4;
  assert.deepEqual(data.subarray(a,a+4),data.subarray(b,b+4));
 }
});
test('AI all black output is rejected without enqueuing',()=>{
 const rows=Array(20).fill('0'.repeat(20));
 assert.throws(()=>parsePixelGrid(JSON.stringify({palette:['#000000','#FF8800'],rows})),/no usable subject/);
});

test('AI geometric drawing produces exact 40x40 blocks with pumpkin face cutouts',()=>{
 const art=renderShapeArt(JSON.stringify({
  palette:['#000000','#FA8117','#188A30'],
  shapes:[
    {type:'ellipse',x:2,y:5,w:16,h:13,color:1},
    {type:'rect',x:9,y:2,w:3,h:5,color:2},
    {type:'ellipse',x:6,y:10,w:3,h:2,color:0},
    {type:'ellipse',x:12,y:10,w:3,h:2,color:0},
    {type:'rect',x:7,y:14,w:7,h:2,color:0}
  ]
 }));
 const bytes=Buffer.from(art.rgba,'base64');
 assert.equal(bytes.length,6400);
 assert.ok(art.activeBlocks>70);
 for(let y=0;y<40;y+=2)for(let x=0;x<40;x+=2){
  const i=(y*40+x)*4,j=((y+1)*40+x+1)*4;
  assert.deepEqual(bytes.subarray(i,i+4),bytes.subarray(j,j+4));
 }
 assert.deepEqual(art.palette,['#000000','#FA8117','#188A30']);
});

test('Pumpkin block-art fallback is recognizable, fully filled and exact-preview safe',()=>{
 const art=subjectBlockArt('Happy Halloween pumpkin with a green stem');
 assert.equal(art.mode,'recognizable-block-art-preset');
 assert.ok(art.activeBlocks>=75,'A readable pumpkin must fill a useful portion of the curtain');
 assert.equal(Buffer.from(art.rgba,'base64').length,6400);
 assert.equal(subjectBlockArt('unrecognized abstract figure'),null);
});

test('separate controller slot button never conflates JHC1 frame streaming with a native SmartDawn .eff upload',()=>{
 const native=read('curtain_native_slot.js');
 new Script(native,{filename:'curtain_native_slot.js'});
 for(const id of ['publishAnimation','uploadControllerSlot','nativeFile','confirmNative','nativeSlotStatus'])
  assert.match(converter,new RegExp('id="'+id+'"'));
 assert.match(converter,/curtain_native_slot\.js/);
 assert.match(converter,/window\.JH2NativeSlot\.upload/);
 assert.match(converter,/nativeEffect\)/);
 assert.match(converter,/!nativeEffect/);
 assert.match(converter,/confirmNative/);
 assert.match(native,/CID=83928/);
 assert.match(native,/ddp\(t,2904\)/);
 assert.match(native,/ddp\(t,2909,CID\)/);
 assert.match(native,/ddp\(t,2606,CID,newSlot\.slot\)/);
 assert.match(native,/2931/);
 assert.match(native,/2934/);
 assert.match(native,/crc8\(/);
 assert.match(native,/data\.length!==4096/);
 assert.match(native,/Native controller slot requires a 4,096-byte DN1FE/);
 assert.match(native,/response timeout/);
});
test('native file plan accepts only the reserved 83928 CID and exact 4 KB DN1FE bytes',()=>{
 const source=read('curtain_native_slot.js');
 const context={window:{},navigator:{},Uint8Array,DataView,Number,Error,Math,Array,Promise,console,setTimeout,clearTimeout};
 new Script(source).runInNewContext(context);
 const native=context.window.JH2NativeSlot;
 const image=new Uint8Array(4096);image.set([68,78,1,254,216,71,1,0],0);
 // Reserved CID 83928 little endian: 0x000147D8.
 const plan=native.filePlan(image);
 assert.equal(plan.parts.length,9);
 assert.equal(plan.request.length>8,true);
 assert.equal(plan.parts[0].length,508);
 assert.equal(plan.parts[8].length,104);
 const wrong=image.slice();wrong[4]=217;
 assert.throws(()=>native.filePlan(wrong),/CID must be 83928/);
 assert.throws(()=>native.filePlan(new Uint8Array(6400)),/4,096-byte DN1FE/);
 const bad=image.slice();bad[0]=74;
 assert.throws(()=>native.filePlan(bad),/DN1FE/);
});
