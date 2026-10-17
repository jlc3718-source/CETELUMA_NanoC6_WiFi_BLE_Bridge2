import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const read=name=>readFileSync(join(root,name),'utf8');
const converter=read('curtain_converter.html'),server=read('server.mjs'),curtain=read('curtain.js'),assets=read('curtain_asset.mjs');
const js=[...converter.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
test('AI generator is minimal and its script parses',()=>{
 assert.equal(js.length,1);new Script(js[0][1],{filename:'curtain_converter.html'});
 for(const id of ['prompt','generate','sample','file','image','preview','send','stop','speed','connection','testResult'])
   assert.ok(converter.includes('id="'+id+'"'),id);
 assert.doesNotMatch(converter,/requestDevice|gatt\.connect|BLE scan|upload firmware|83928/);
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
 assert.match(server,/model:AI_MODEL/);
 assert.match(server,/cloudflareAiChat/);
 assert.match(server,/parsePixelGrid/);
 assert.doesNotMatch(server.slice(server.indexOf('if(method==="POST"&&path==="/api/curtain/generate-art")'),server.indexOf('if(method==="POST"&&path==="/api/curtain/ai-revamp")')),/flux-1-schnell/);
 assert.match(server,/cloudflareAiConfigured\(\)/);
 assert.match(server,/20 by 20 BLOCKY logical pixel clusters/);
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
 assert.match(converter,/usePreparedFrame\(r.pixels\)/);
 assert.match(converter,/canvas.toDataURL\('image\/png'\)/);
 assert.match(converter,/quality:'rgbfull'/);
 assert.match(converter,/quality:'pal16'/);
 assert.match(converter,/queue\('asset',payload\)/);
 assert.match(converter,/JH2CurtainLastSelection/);
 assert.match(assets,/6400 RGBA bytes/);
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