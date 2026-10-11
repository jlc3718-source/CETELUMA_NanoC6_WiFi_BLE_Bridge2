import assert from "node:assert/strict";
import {
  E120_LOW_PURPLE_SOURCE,E120_LOW_PURPLE_BOOST,e120CompensatedPurplePalette,
  e120NeedsPurpleCompensation,effectE120,effectE22,catalogPresetE120
} from "../dist/eufy/light-commands.js";

const purple=0x5B00E6,orange=0xFF0D00,blue=0x0000FF;
const expectedPurple=0x6F00E6;
assert.equal(E120_LOW_PURPLE_SOURCE,purple);
assert.equal(E120_LOW_PURPLE_BOOST,20);
assert.equal(e120NeedsPurpleCompensation([purple],24),true);
assert.equal(e120NeedsPurpleCompensation([purple],25),false);
assert.deepEqual(e120CompensatedPurplePalette([orange,purple,0],10),[orange,expectedPurple,0]);
assert.deepEqual(e120CompensatedPurplePalette([orange,purple,0],25),[orange,purple,0]);
assert.deepEqual(e120CompensatedPurplePalette([blue],10),[blue]);

function tlvs(fields) {
  const found=new Map(),raw=Buffer.from(fields);
  for(let p=0;p<raw.length;) {
    const tag=raw[p++],len=raw[p++];if(len===undefined||p+len>raw.length)throw Error("Malformed native TLV");
    found.set(tag,raw.subarray(p,p+len));p+=len;
  }
  return found;
}
for(const effect of ["Static","Streamlight","Flow1","Twinkle"]){
  const dim=tlvs(effectE120(effect,[purple,orange],4,false,60,24)).get(0xa6);
  const bright=tlvs(effectE120(effect,[purple,orange],4,false,60,25)).get(0xa6);
  assert.equal(dim[0],2);assert.deepEqual([...dim.subarray(1,5)],[0x6F,0,0xE6,0],effect);
  assert.equal(dim[5],0xFF);assert.equal(dim[8],0,effect);
  assert.deepEqual([...bright.subarray(1,5)],[0x5B,0,0xE6,0],effect);
  const e22=tlvs(effectE22(effect,[purple,orange],4,false,60,5)).get(0xa6);
  assert.deepEqual([...e22.subarray(1,6)],[0x5B,0,0xE6,0,0],"E22 must never shift purple");
}
for(const level of [1,10,24,25,50,100]){
  const f=tlvs(catalogPresetE120(20004,10029,5,[purple,orange],60,level));
  assert.equal(f.get(0xa6)[1],level<25?0x6F:0x5B);
  assert.equal(f.get(0xa8)[0],level);
}
console.log("E120-only purple below-25% compensation and E22 unaffected: PASS");
