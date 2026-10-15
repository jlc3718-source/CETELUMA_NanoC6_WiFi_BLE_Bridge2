import {stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname),temp=mkdtempSync(join(tmpdir(),'jh2-ref-'));
for(const [name,input] of Object.entries({'light-commands':'reference-light-commands.ts','factory-presets':'reference-factory-presets.ts','wire':'reference-wire.ts','style-templates':'style-templates.ts'})){
 const source=readFileSync(join(root,input),'utf8');
 writeFileSync(join(temp,name+'.mjs'),stripTypeScriptTypes(source).replace(/\.\/([\w-]+)\.js/g,'./$1.mjs'));
}
const {buildEffect}=await import(join(temp,'light-commands.mjs'));
const {dpCommand}=await import(join(temp,'wire.mjs'));
const patterns=[null,{blocks:[5,3],offset:4,mirror:true},{positions:[0,4,8,9,17]}];
const lines=[];
for(const model of ['T8L00','T8L02'])for(const effect of ['Flow1','Flow2','Cycle','Streamlight','Twinkle','Breathe','Static'])for(const speed of [1,2,3,4,5,6,7,8,9,10])for(const reverse of [false,true])for(const colors of [[0x5b00e6],[0xff0000,0x5b00e6],[0xffffff,0x00bd4c,0xe08700]])for(const lamps of [30,60])for(let pi=0;pi<patterns.length;pi++){
 const pattern=patterns[pi],input={model,effect,colors,speed,reverse,lamps,level:76,pattern};
 const fx=buildEffect(model,effect,colors,speed,reverse,76,lamps,pattern||undefined);
 const hex=Buffer.from(fx.fields).toString('hex');
 lines.push([model,effect,speed,reverse?1:0,colors.map(x=>x.toString(16)).join(','),lamps,76,pi,hex].join('\t'));
}
writeFileSync(process.argv[2],lines.join('\n')+'\n');
writeFileSync(process.argv[2]+'.command',Buffer.from(dpCommand(0x201,'123456789',new Uint8Array([0xa3,1,1]),1792022400)).toString('hex'));
console.log(lines.length+' production Eufy reference vectors generated');
