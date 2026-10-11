import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
test('AI Test Halloween manual brightness does not terminate the running flash sequence',()=>{
  assert.match(source,/if\(!brightnessOnly&&!preserveTestHalloweenPreview\)stopTestHalloweenPreview\(\)/);
  assert.match(source,/if\(brightnessOnly&&testHalloweenPreviewLevels\.size\)/);
  assert.match(source,/for\(const name of names\)testHalloweenPreviewLevels\.set\(name,scenes\[name\]\.brightness\)/);
  assert.match(source,/const sent=await sendTestHalloweenFrame\(name,typeof level==="function"\?level\(\):level,previous\)/);
  assert.match(source,/runTestHalloweenTarget\(name,\(\)=>testHalloweenPreviewLevels\.get\(name\)\?\?level/);
  assert.match(source,/applyTestHalloweenBaseFast\(name,testHalloweenPreviewLevels\.get\(name\)\?\?level,"Test Halloween preview finish"\)/);
  assert.match(source,/function stopTestHalloweenPreview\(\)\{testHalloweenPreviewGeneration\+\+;testHalloweenPreviewLevels\.clear\(\);\}/);
  assert.doesNotMatch(source,/await Promise\.all\(\[\.\.\.DEVICE_NAMES\]\.map\(name=>runTestHalloweenTarget\(name,level,\(\)=>token===testHalloweenPreviewGeneration/);
});

test('AI layer All-target preserves each device brightness in one override',()=>{
  assert.match(source,/const perName=input\?\.scenes&&typeof input\.scenes==="object"/);
  assert.match(source,/const scoped=own&&typeof own==="object"&&!Array\.isArray\(own\)\?\{\.\.\.input,\.\.\.own\}:input/);
  assert.match(source,/out\[name\]=safeScene\(scoped,activeOverrideScene\(name\)\|\|storedScene\(name\)\|\|DEFAULT_SCENE\)/);
  assert.match(source,/scenes,sequence:overrideSequence/);
});

test('AI brightness-only command does not stop any active Halloween flash or queue a full scene',()=>{
  assert.match(source,/if\(!brightnessOnly\)stopCalendarRandomFlash\(\)/);
  assert.match(source,/if\(brightnessOnly\)\{\s*result=await c\.brightness\(name,scene\.brightness\)/);
  assert.match(source,/sequence==null\?await sendScene\(name,scene,brightnessOnly,previewFast\)/);
});
test('wait-mode AI layer uses fast E120 command without bypassing E22 status checks',()=>{
  assert.match(source,/previewFast&&DEVICE_MODELS\[name\]==="E120"\s*\?await c\.sceneFast/);
  assert.match(source,/:await c\.scene\(name,scene\.effect,scene\.colors,scene\.speed,scene\.brightness,scene\.pattern\)/);
});
