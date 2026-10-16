// The packet encoders below are copied from the proven SmartDawn Studio implementation.
import {createHash} from 'node:crypto';
const W=40,H=40;
function quantize(pixels,maxColors=16){const rgb=[];const hist=new Map();for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];rgb.push([r,g,b]);const key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);const v=hist.get(key)||{r:0,g:0,b:0,n:0};v.r+=r;v.g+=g;v.b+=b;v.n++;hist.set(key,v);}const boxes=[Array.from(hist.values())];while(boxes.length<maxColors-1){let idx=-1,score=-1;for(let j=0;j<boxes.length;j++){const b=boxes[j];if(b.length<2)continue;let spread=0;for(let z=0;z<3;z++){const col=['r','g','b'][z];let vs=b.map(v=>v[col]/v.n);spread=Math.max(spread,Math.max(...vs)-Math.min(...vs));}if(spread>score){score=spread;idx=j;}}if(idx<0)break;const target=boxes.splice(idx,1)[0],spread=['r','g','b'].map(k=>Math.max(...target.map(v=>v[k]/v.n))-Math.min(...target.map(v=>v[k]/v.n))),col=['r','g','b'][spread.indexOf(Math.max(...spread))];target.sort((a,b)=>(a[col]/a.n)-(b[col]/b.n));let total=target.reduce((s,x)=>s+x.n,0),half=0,cut=1;for(let k=0;k<target.length-1;k++){half+=target[k].n;if(half>=total/2){cut=k+1;break;}}boxes.push(target.slice(0,cut),target.slice(cut));}
 const palette=[[0,0,0]];for(const box of boxes){const n=box.reduce((s,v)=>s+v.n,0);if(n)palette.push(['r','g','b'].map(k=>Math.round(box.reduce((s,v)=>s+v[k],0)/n)));}const indices=new Uint8Array(W*H);for(let i=0;i<rgb.length;i++){const [r,g,b]=rgb[i];if(r+g+b<14){indices[i]=0;continue;}let best=0,err=Infinity;for(let j=0;j<palette.length;j++){const [R,G,B]=palette[j],d=2*(r-R)**2+4*(g-G)**2+3*(b-B)**2;if(d<err){err=d;best=j;}}indices[i]=best;}
 return {palette,indices};}

function quantizeFixed(pixels,palette){
 const indices=new Uint8Array(W*H);
 for(let i=0;i<W*H;i++){const k=i*4,r=pixels[k],g=pixels[k+1],b=pixels[k+2];
  if(r+g+b<14){indices[i]=0;continue;}
  let idx=0,best=Infinity;
  for(let j=0;j<palette.length;j++){const c=palette[j],d=2*(r-c[0])**2+4*(g-c[1])**2+3*(b-c[2])**2;
   if(d<best){best=d;idx=j;}}
  indices[i]=idx;
 }
 return {palette,indices};
}
function globalGifPalette(images,maxColors){
 if(!images.length)return null;
 const sample=new Uint8ClampedArray(6400),n=Math.min(12,images.length);
 for(let y=0;y<H;y++){
  const frame=images[Math.floor(y/H*n)],target=sample.subarray(y*W*4,(y+1)*W*4);
  target.set(frame.subarray(y*W*4,(y+1)*W*4));
 }
 return quantize(sample,maxColors).palette;
}
function refreshGifPalette(){
 const enc=getEncoding();sharedGifPalette=frames.length>1&&$('motion').value==='gif'&&enc.kind==='palette'?
  globalGifPalette(frames,enc.colors):null;
}

function runBytes(index,n){if(n<16)return [(index<<4)|n];let a=[index<<4];let times=Math.floor(n/127),rest=n%127;for(let j=1;j<=times;j++)a.push(rest||j<times?255:127);if(rest)a.push(rest);return a;}
function livePackets(image,maxColors=16,limit=80,fixedPalette=null){
 const {palette,indices:row}=fixedPalette?quantizeFixed(image,fixedPalette):quantize(image,maxColors),indices=[];
 for(let x=0;x<W;x++)for(let y=0;y<H;y++)indices.push(row[y*W+x]);
 const head=[0,0,palette.length,...palette.flat()];if(head.length>=limit)throw Error('Palette too large for selected BLE packet size');
 const runs=[];for(let i=0;i<indices.length;){let j=i+1;while(j<indices.length&&indices[j]===indices[i])j++;runs.push({start:i,bytes:runBytes(indices[i],j-i)});i=j;}
 const packets=[];let i=0;
 while(i<runs.length){const start=runs[i].start,part=[];while(i<runs.length&&head.length+part.length+runs[i].bytes.length<=limit){part.push(...runs[i].bytes);i++;}
 if(!part.length)throw Error('Indexed run exceeds limit');const a=Uint8Array.from([...head,...part]);a[0]=Math.floor(start/H);a[1]=start%H;packets.push(a);}
 return packets;
}
function selectRGBGroups(image,maxColors){
 const colors=[];for(let i=0;i<W*H;i++)colors.push([image[i*4],image[i*4+1],image[i*4+2]]);
 const groups=new Map();
 if(maxColors>=1600){for(let i=0;i<colors.length;i++){const [r,g,b]=colors[i],k=(r<<16)|(g<<8)|b;let arr=groups.get(k);if(!arr){arr=[];groups.set(k,arr);}arr.push((i%W)*H+Math.floor(i/W));}return groups;}
 // Top-color clusters in perceptual RGB buckets, then map the original 24-bit colors to their centroids.
 const histogram=new Map(),q=maxColors>=128?5:maxColors>=64?4:3;
 for(const [r,g,b] of colors){const key=((r>>(8-q))<<(2*q))|((g>>(8-q))<<q)|(b>>(8-q));let h=histogram.get(key);if(!h){h={r:0,g:0,b:0,n:0};histogram.set(key,h);}h.r+=r;h.g+=g;h.b+=b;h.n++;}
 const vals=[...histogram.values()].sort((a,b)=>b.n-a.n).slice(0,maxColors);
 const centers=vals.map(x=>[Math.round(x.r/x.n),Math.round(x.g/x.n),Math.round(x.b/x.n)]);
 if(centers.length===0)return groups;
 for(let i=0;i<colors.length;i++){const [r,g,b]=colors[i];let best=0,error=Infinity;for(let j=0;j<centers.length;j++){const [R,G,B]=centers[j],d=2*(r-R)**2+4*(g-G)**2+3*(b-B)**2;if(d<error){error=d;best=j;}}
 const [R,G,B]=centers[best],key=(R<<16)|(G<<8)|B;let ids=groups.get(key);if(!ids){ids=[];groups.set(key,ids);}ids.push((i%W)*H+Math.floor(i/W));}
 return groups;
}
// Manufacturer TUTU_DOODLE: [0x01,R,G,B,bitmap-run mask]. Each mask covers a chosen subset
// of the column-major 40x40 display; 24-bit colors are sent directly, no 16-color shared palette.
function maskRuns(ids){const out=ids.length&&ids[0]===0?[0]:[];let pos=0;for(let k=0;k<ids.length;){const target=ids[k];let skip=target-pos;while(skip>0){const n=Math.min(skip,127);out.push(n);pos+=n;skip-=n;}
 let run=1;while(k+run<ids.length&&ids[k+run]===target+run&&run<127)run++;
 out.push(0x80|run);pos+=run;k+=run;}
 return out;
}
function makeRGBPackets(image,maxColors){const groups=selectRGBGroups(image,maxColors);const packets=[];
 for(const [color,ids] of groups){ids.sort((a,b)=>a-b);if(color===0)continue;
 let segment=[];
 for(const id of ids){const trial=[...segment,id];const mask=maskRuns(trial);
 if(mask.length>35&&segment.length){packets.push(Uint8Array.from([1,(color>>16)&255,(color>>8)&255,color&255,...maskRuns(segment)]));segment=[id];}
 else segment=trial;
 }
 if(segment.length)packets.push(Uint8Array.from([1,(color>>16)&255,(color>>8)&255,color&255,...maskRuns(segment)]));
 }
 for(const p of packets)if(p.length>40)throw Error('Oversized RGB888 packet '+p.length);
 return packets;
}

export const MAX_ASSET_BYTES=4*1024*1024;
const vi=n=>{const a=[];do{let v=n&127;n>>>=7;a.push(v|(n?128:0));}while(n);return a;};
function ddp(op,params=[],seq=1){const b=Buffer.alloc(24+params.length);b.set([seq&255,1,0,0,240,4,0,seq&255],0);b.writeUInt16BE(op,10);b.set(params,24);return b;}
const record=(channel,b)=>{const h=Buffer.alloc(3);h[0]=channel;h.writeUInt16LE(b.length,1);return Buffer.concat([h,b]);};
export function compileAsset(input){
 const images=input?.frames;if(!Array.isArray(images)||!images.length||images.length>180)throw Error('Supply 1–180 prepared 40×40 RGBA frames');
 const frames=images.map(x=>{if(typeof x!=='string'||x.length>8600)throw Error('Invalid frame');const b=Buffer.from(x,'base64');if(b.length!==6400)throw Error('Each prepared frame must contain 6400 RGBA bytes');return b;});
 const rgb=String(input.quality||'pal16').startsWith('rgb');
 const colors=Number(String(input.quality||'pal16').replace(/^(pal|rgb)/,''));
 const count=String(input.quality)==='rgbfull'?1600:colors;
 if(!(rgb?[16,32,64,128,256,1600]:[4,8,16]).includes(count))throw Error('Unsupported Studio quality');
 const loop=input.loop===true&&frames.length>1,stable=!rgb&&loop?globalGifPalette(frames,count):null;
 const out=[Buffer.from([74,72,67,49,frames.length&255,frames.length>>8,loop?1:0,0])];let packet=0,seq=0;
 for(let i=0;i<frames.length;i++){
  const records=[];
  if(i===0){for(const [op,params] of [[2514,[]],[2701,[8,1]],[2713,[]]])records.push(record(0,ddp(op,params,++seq)));}
  else if(rgb)records.push(record(0,ddp(2713,[],++seq)));
  const parts=rgb?makeRGBPackets(frames[i],count):livePackets(frames[i],count,count<=8?40:80,stable);
  for(const part of parts){const n=Math.ceil(part.length/40),id=(++packet)&255;for(let j=0;j<n;j++)records.push(record(1,Buffer.from([id,n,n-j-1,rgb?1:4,...part.slice(j*40,(j+1)*40)])));}
  const h=Buffer.alloc(6);h.writeUInt32LE(Math.max(40,Math.min(60000,Number(input.delays?.[i])||100)),0);h.writeUInt16LE(records.length,4);out.push(h,...records);
  if(out.reduce((n,b)=>n+b.length,0)>MAX_ASSET_BYTES)throw Error('Prepared animation exceeds the 4 MB relay limit. Use fewer frames or lower color quality; the previous selection is preserved.');
 }
 const bytes=Buffer.concat(out);return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),frames:frames.length,loop,format:'jh2-smartdawn-packets-v1'};
}
