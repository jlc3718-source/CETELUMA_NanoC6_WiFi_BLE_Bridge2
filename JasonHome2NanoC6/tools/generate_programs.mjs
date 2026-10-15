import {stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),temp=mkdtempSync(join(tmpdir(),'jh2-programs-'));
for(const name of ['calendar','effects','scheduler']){
 let source=readFileSync(join(root,'tests/reference-'+name+'.ts'),'utf8');
 if(name==='calendar')source=source.replace('function creativeProgram(','export function creativeProgram(');
 writeFileSync(join(temp,name+'.mjs'),stripTypeScriptTypes(source).replace(/\.\/([\w-]+)\.js/g,'./$1.mjs'));
}
const {creativeProgram}=await import(join(temp,'calendar.mjs'));
const {canonicalEffect}=await import(join(temp,'effects.mjs'));
const catalog=JSON.parse(readFileSync(join(root,'../JasonHome2Server/catalog.json'),'utf8'));
const fx=['Static','Flow1','Flow2','Cycle','Streamlight','Twinkle','Breathe'];
const programs=[];
for(let mode=0;mode<3;mode++){
 const rows=[];
 for(const original of catalog.events){
  const p=original.profiles,old=mode===2?p.expandedSpeed:original.speed;
  const event={...original,colors:p[['major','basic','expanded'][mode]],effect:canonicalEffect(mode===2?p.expandedEffect:original.effect),speed:[1,3,5,8,10][old-1]};
  const phases=creativeProgram(event);if(phases.length>8)throw Error('Too many phases');
  const field=key=>'{'+phases.map(x=>key==='effect'?fx.indexOf(x.effect):x[key]||0).join(',')+'}';
  rows.push('{'+phases.length+','+field('effect')+','+field('speed')+','+field('minutes')+','+field('shift')+'}');
 }
 programs.push('{'+rows.join(',')+'}');
}
writeFileSync(join(root,'include/Programs.h'),'#pragma once\nstruct DefaultProgram{uint8_t count,effect[8],speed[8],minutes[8];int8_t shift[8];};\nstatic const DefaultProgram DEFAULT_PROGRAMS[3]['+catalog.events.length+']={'+programs.join(',')+'};\n');
console.log('Generated '+(catalog.events.length*3)+' exact production creative programs');
