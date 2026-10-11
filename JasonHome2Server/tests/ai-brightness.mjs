import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
test('AI brightness persists across layers and can differ per Eufy string',()=>{
  const begin=source.indexOf('const AI_EUFY_TARGETS=');
  const end=source.indexOf('const TEST_HALLOWEEN_NAME=',begin);
  assert.ok(begin>=0&&end>begin,'Gateway brightness controller was removed');
  const sandbox={};
  runInNewContext('let aiPreviewGeneration=1;\n'+source.slice(begin,end)+
    '\nglobalThis.fixture={beginAiPreviewBrightness,overrideAiPreviewBrightness,aiPreviewLayerCommands,stopAiPreviewBrightness};',sandbox);
  const p=sandbox.fixture;
  p.beginAiPreviewBrightness(1,100);
  const base={name:'AI Preview Layer 2',effect:'Flow2',brightness:100,colors:[0xff0000,0x0000ff]};
  let commands=p.aiPreviewLayerCommands(base);
  assert.equal(commands.length,1);assert.equal(commands[0].brightness,100);
  p.overrideAiPreviewBrightness('All',36);
  commands=p.aiPreviewLayerCommands(base);
  assert.equal(commands.length,1);assert.equal(commands[0].brightness,36);
  assert.equal(commands[0].effect,'Flow2');assert.deepEqual(Array.from(commands[0].colors),base.colors);
  p.overrideAiPreviewBrightness('Pool',18);
  commands=p.aiPreviewLayerCommands(base);
  assert.deepEqual(JSON.parse(JSON.stringify(commands.map(c=>[c.target,c.brightness]))),[
    ['Pool',18],['House',36],['Garage',36],['Shed',36]]);
  p.stopAiPreviewBrightness();
  p.beginAiPreviewBrightness(1,50);
  assert.equal(p.aiPreviewLayerCommands(base)[0].brightness,50,'New AI preview starts from its own brightness');
});
test('All AI preview entry points apply brightness dynamically and manual slider saves it',()=>{
  assert.match(source,/if\(brightnessOnly\)overrideAiPreviewBrightness\(target,body\.brightness\)/);
  assert.match(source,/if\(!brightnessOnly&&aiPreviewActiveGeneration===aiPreviewGeneration\)/);
  assert.match(source,/aiPreviewLayerCommands\(layer\)\.map\(command=>upstream\("\/api\/control"/g);
  assert.doesNotMatch(source,/brightness:draft\.brightness\|\|100,effect:p\.effect/);
  assert.doesNotMatch(source,/target:"All",power:true,brightness,effect:p\.effect/);
  assert.match(source,/stopAiPreviewBrightness\(\);put\("running_event_id"/);
});