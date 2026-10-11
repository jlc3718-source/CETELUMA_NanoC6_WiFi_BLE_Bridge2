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
