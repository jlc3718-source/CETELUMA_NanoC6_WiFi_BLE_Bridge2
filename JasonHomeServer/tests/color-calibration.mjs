import assert from 'node:assert/strict';
import {buildEffect,calibratedColor} from '../dist/eufy/light-commands.js';

const pair=(input,e120,e22,label)=>{
  for(const model of ['E120','T8L00'])assert.equal(calibratedColor(model,input),e120,label+' House/Pool '+model);
  for(const model of ['E22','T8L02'])assert.equal(calibratedColor(model,input),e22,label+' Garage/Shed '+model);
};
pair(0x0d00ff,0x0d00ff,0x0000ff,'blue');
pair(0x5b00e6,0x4800ff,0x1800ff,'purple');
pair(0xff0024,0xff0080,0xff0024,'pink');
pair(0x00ffb8,0x00ffb8,0x00ffff,'aqua');
pair(0xdc143c,0xdc143c,0xa40008,'crimson');
pair(0xff0d00,0xff0a00,0xff0a00,'legacy orange');
pair(0xff7a00,0xff0a00,0xff7a00,'actual saved Halloween orange');
pair(0xf08000,0xf08000,0xf08000,'previously accepted distinct amber-gold');
pair(0x000000,0x000000,0x000000,'black gap');
pair(0xffffff,0xffffff,0xffffff,'white');
pair(0xff0000,0xff0000,0xff0000,'red');

for(const model of ['E120','T8L00']){
 const actual=buildEffect(model,'Flow1',[0xff7a00,0x5b00e6,0],5,false,100,60,{blocks:[4,3,1],offset:0,mirror:false});
 const verified=buildEffect(model,'Flow1',[0xff0a00,0x4800ff,0],5,false,100,60,{blocks:[4,3,1],offset:0,mirror:false});
 assert.deepEqual([...actual.fields],[...verified.fields],model+' Flow1 must correct saved Halloween orange and purple at command encoder');
}
for(const model of ['E22','T8L02']){
 const actual=buildEffect(model,'Flow1',[0xff7a00,0x5b00e6,0],5,false,100,60,{blocks:[4,3,1],offset:0,mirror:false});
 const verified=buildEffect(model,'Flow1',[0xff7a00,0x1800ff,0],5,false,100,60,{blocks:[4,3,1],offset:0,mirror:false});
 assert.deepEqual([...actual.fields],[...verified.fields],model+' Flow1 must preserve E22 orange and historical purple');
}
console.log('Historical family calibration, real Halloween palette, black gaps, and native E120/E22 commands: PASS');
