import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {validateCommand,createCurtainBridge} from '../curtain_bridge.mjs';
import {DatabaseSync} from 'node:sqlite';

const slot=fs.readFileSync(new URL('../curtain_native_slot.js',import.meta.url),'utf8');
const research=fs.readFileSync(new URL('../curtain_native_research.js',import.meta.url),'utf8');
function load(){const window={};const context=vm.createContext({window,Uint8Array,Uint8ClampedArray,DataView,TextEncoder,TextDecoder,console,setTimeout,clearTimeout,Date,atob,btoa});vm.runInContext(slot,context);vm.runInContext(research,context);return window;}
const varint=n=>{const out=[];do{let b=n%128;n=Math.floor(n/128);out.push(b|(n?128:0));}while(n);return out;};
function entry(id,slot,cid){const b=[...(id?[8,...varint(id)]:[]),16,1,...(slot?[24,...varint(slot)]:[]),32,...varint(cid)];return [10,...varint(b.length),...b];}
test('zero IDs and high custom IDs survive protobuf decoding',()=>{
 const {JH2NativeSlot:N}=load();const decoded=N.decodeEffects(Uint8Array.from([...entry(0,0,15924),...entry(88,33,83928)]));
 assert.deepEqual(JSON.parse(JSON.stringify(decoded)).map(({id,slot,cid})=>({id,slot,cid})),[{id:0,slot:0,cid:15924},{id:88,slot:33,cid:83928}]);
});
test('partial catalog is sufficient only with final target-section evidence',()=>{
 const {JH2NativeSlot:N}=load();let entries=[];entries.partial=true;
 assert.throws(()=>N.targetState(entries),/Final controller test section/);
 entries.targetSectionComplete=true;entries.targetMatches=[];assert.equal(N.targetState(entries),null);
 entries.targetMatches=[{id:88,slot:33,cid:83928}];assert.equal(N.targetState(entries).slot,33);
 entries.targetMatches.push({id:89,slot:34,cid:83928});assert.throws(()=>N.targetState(entries),/shared/);
});
test('native batch cannot persist as desired state or replay after Nano reboot',()=>{
 const packet=Buffer.alloc(508);packet.set([17,0,9,17,255,0,8]);const payload={packets:[packet.toString('base64')]};
 assert.equal(validateCommand('nativeSlotWrite',payload).packets.length,1);
 assert.throws(()=>validateCommand('nativeSlotWrite',{packets:Array(9).fill(payload.packets[0])}),/1–8/);
 packet[6]=9;assert.throws(()=>validateCommand('nativeSlotWrite',{packets:[packet.toString('base64')]}),/file-data/);
 const db=new DatabaseSync(':memory:');const bridge=createCurtainBridge({db});bridge.pairing();
 bridge.sync({bridgeId:bridge.status().bridgeId,bootId:'a',status:{curtain:{connected:true}},acks:[],notifications:[]});
 const cmd=bridge.enqueue('nativeSlotWrite',payload,'native-batch-one');
 assert.deepEqual(bridge.status().desired,{});
 bridge.sync({bootId:'b',status:{curtain:{connected:true}},acks:[],notifications:[]});
 assert.equal(bridge.command(cmd.id).state,'superseded');bridge.close();db.close();
});
test('actual 40x40 SmartDawn encoder creates correctly framed native upload',()=>{
 const {JH2NativeSlot:N,JH2NativeResearch:R}=load();const frames=R.sampleFrames();const file=R.encodeSmartDawn(frames,{timestamp:1});
 const meta=R.inspectSmartDawnEff(file);assert.equal(meta.cid,83928);assert.equal(meta.frames,4);assert.equal(meta.version,3);
 const plan=N.planVendorEff(file,83928);assert.equal(plan.parts.reduce((n,p)=>n+p.length-8,0),file.length);
 assert.equal(plan.parts[0][3],17);assert.equal(plan.parts[0][4],255);
});
test('native test page scripts parse and show inventory before upload gates',()=>{
 const html=fs.readFileSync(new URL('../curtain_native_test.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 assert.ok(slot.indexOf('progress((result.partial')<slot.indexOf('function targetState'));
 assert.match(html,/test section complete/);
});
