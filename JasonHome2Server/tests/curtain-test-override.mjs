import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const home=dirname(dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(join(home,'curtain_converter.html'),'utf8');
const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const code=scripts.at(-1);

test('Studio removes experimental override without touching established controls',()=>{
  assert.equal(scripts.length,4);
  for(const js of scripts)if(js.trim())new Script(js);
  for(const id of ['sendLive','stopSend','install','build','play','restore','saveDraft','clearDraft'])
    assert.match(html,new RegExp('id="'+id+'"'));
  for(const oldId of ['testSlotOverride','testOverrideStatus'])
    assert.doesNotMatch(html,new RegExp(oldId));
  assert.doesNotMatch(code,/TEST_OVERRIDE_START|TEST_OVERRIDE_ACCEPTED|test-override-verification/);
  assert.match(code,/\$\('play'\)\.onclick=/);
  assert.match(code,/\$\('sendLive'\)\.onclick=/);
});
