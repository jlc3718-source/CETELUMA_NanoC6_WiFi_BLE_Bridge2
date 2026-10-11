import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';

test('all 88 previews reproduce the supplied SmartDawn screenshots, never procedural images', () => {
  const base=resolve(import.meta.dirname,'..');
  const context={window:{}};
  const manifest=JSON.parse(readFileSync(resolve(base,'curtain_real_manifest.json'),'utf8'));
  assert.equal(Object.keys(manifest).length,88);
  for(let shard=0;shard<11;shard++){
    const filename='curtain_real_'+String(shard).padStart(2,'0')+'.js';
    const script=readFileSync(resolve(base,filename),'utf8');
    runInNewContext(script,context,{timeout:2000,filename});
  }
  const data=context.window.JH2_CURTAIN_IMAGE_SRC;
  assert.equal(Object.keys(data).length,88,'Do not lose or duplicate screenshot tiles');
  for(let i=0;i<88;i++){
    const s=data[String(i)],m=manifest[String(i)];
    assert.ok(m && typeof s==='string' && s.startsWith('data:image/webp;base64,'),'Missing E-'+i);
    const bytes=Buffer.from(s.slice('data:image/webp;base64,'.length),'base64');
    assert.equal(bytes.toString('ascii',0,4),'RIFF','Invalid WebP file E-'+i);
    assert.equal(bytes.toString('ascii',8,12),'WEBP','Invalid WebP file E-'+i);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256,'Wrong screenshot image E-'+i);
    if(i>=57&&i<=62)assert.ok(m.source_coverage<1,'Uncaptured pixels must not be invented');
    else assert.equal(m.source_coverage,1);
  }
  const ui=readFileSync(resolve(base,'curtain.js'),'utf8');
  assert.match(ui,/loadOriginalSmartDawnPreviews/);
  assert.match(ui,/source image for|Source image for/);
  assert.doesNotMatch(ui,/const seed=effect\.id/);
  console.log('Original SmartDawn screenshot previews: 88/88 SHA-256 VERIFIED');
});
