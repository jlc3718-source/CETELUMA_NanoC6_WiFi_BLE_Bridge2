import assert from "node:assert/strict";
import {buildEffect,OP_SHOW,OP_COLOR} from "../dist/eufy/light-commands.js";
function tags(bytes){const out=new Map();for(let i=0;i<bytes.length;){const tag=bytes[i++],length=bytes[i++];out.set(tag,bytes.slice(i,i+length));i+=length;}return out;}
for(const model of ["T8L00","T8L02"]){
  for(const colors of [[0xff0000],[0xff0000,0x00ff00,0x0000ff]]){
    for(const speed of [1,2,3,4,5]){
      const command=buildEffect(model,"Breath",colors,speed,true);
      assert.equal(command.opcode,OP_SHOW);
      const fields=tags(command.fields),layer=fields.get(0xa9);
      assert.deepEqual([...layer.slice(2,8)],[100,0,0,0,0,0],"full range, no interval/count limit");
      assert.equal(layer[9],0,"brightness modulation layer, not static color transition");
      assert.equal(layer[10],colors.length);
      const trailer=layer.slice(11+colors.length*(model==="T8L02"?5:4));
      assert.deepEqual([...trailer.slice(-5)],[1,100,10,0,0],"brightness must rise/fall with unbounded cycle");
      assert.equal(trailer.length,17);
      assert.equal(fields.get(0xa4)[0],layer[1]);
    }
  }
  assert.equal(buildEffect(model,"Solid / Static",[0xff0000],3,false).opcode,OP_COLOR);
}
console.log("Breath: repeating brightness range, all speeds, both light families, single/multiple colors PASS");
