import assert from 'node:assert/strict';
import { streamlightPalette,buildEffect,styleDefinition } from '../dist/eufy/light-commands.js';
assert.deepEqual(streamlightPalette('Streamlight',[0x5b00e6]),[0x5b00e6,0x000000]);
assert.deepEqual(streamlightPalette('Wipe / Fill',[0xff0d00]),[0xff0d00,0x000000]);
assert.deepEqual(streamlightPalette('Streamlight',[0xff0d00,0x5b00e6]),[0xff0d00,0x5b00e6]);
assert.deepEqual(streamlightPalette('Static',[0xff0d00]),[0xff0d00]);
for(const model of ['E120','E22']){
  const one=buildEffect(model,'Streamlight',[0xff0d00],3,false,100,60);
  const two=buildEffect(model,'Streamlight',[0xff0d00,0x000000],3,false,100,60);
  assert.equal(one.opcode,two.opcode);
  assert.deepEqual([...one.fields],[...two.fields],model+' must transmit real black second color');
}
const e22One=styleDefinition('Streamlight',[0x5b00e6],3,false);
const e22Two=styleDefinition('Streamlight',[0x5b00e6,0],3,false);
assert.deepEqual(e22One,e22Two,'E22 factory style template must use two colors');
console.log('Streamlight black second color, E120 and E22: PASS');
