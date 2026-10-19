/* Jason Home 2: deterministic 40x40 pixel-art motion engine.
 * Workers AI provides the source art and constrained motion plan.
 * Exact RGB frames allow sparse changed-pixel transmission without drift.
 */
(function(global){
'use strict';
const W=40,H=40,COUNT=W*H;
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function quantize(source,colors=12){
 if(!source||source.length!==COUNT*4)throw Error('Expected 40x40 RGBA');
 colors=clamp(Math.round(colors),4,16);
 const histogram=new Map();
 for(let i=0;i<source.length;i+=4){
  const r=source[i],g=source[i+1],b=source[i+2];
  if(r+g+b<42)continue;
  const key=((r>>4)<<8)|((g>>4)<<4)|(b>>4);
  const h=histogram.get(key)||{r:0,g:0,b:0,n:0};
  h.r+=r;h.g+=g;h.b+=b;h.n++;histogram.set(key,h);
 }
 const palette=[[0,0,0],...[...histogram.values()].sort((a,b)=>b.n-a.n)
  .slice(0,colors-1).map(v=>[Math.round(v.r/v.n),Math.round(v.g/v.n),Math.round(v.b/v.n)])];
 const result=new Uint8ClampedArray(COUNT*4);
 for(let k=0;k<COUNT;k++){
  const i=k*4,r=source[i],g=source[i+1],b=source[i+2];
  let pick=0,score=Infinity;
  if(r+g+b>=42)for(let j=1;j<palette.length;j++){
   const [R,G,B]=palette[j],e=2*(r-R)**2+4*(g-G)**2+3*(b-B)**2;
   if(e<score){score=e;pick=j;}
  }
  const c=palette[pick];result.set([c[0],c[1],c[2],255],i);
 }
 return result;
}
// Four Cloudflare-drawn key poses create a real animated character. No whole
// image slide, pan, bounce, or affine transform is used to fake animation.
// Bayer-order transitions change only the pixels that differ between poses.
function buildKeyframes(keyframes,{count=24}={}){
 if(!Array.isArray(keyframes)||keyframes.length<3||keyframes.length>8)
  throw Error('AI needs at least three different key poses');
 if(!Number.isInteger(count)||count<4||count>24)
  throw Error('Frame count must be 4–24');
 for(const pose of keyframes)
  if(!pose||pose.length!==COUNT*4)throw Error('Key pose must contain 40x40 RGBA pixels');
 const first=new Uint8ClampedArray(keyframes[0]);
 const poses=[...keyframes,first],output=[];
 // Ordered transition threshold is spatially distributed to avoid ghosting
 // and avoid expensive full-frame RGB blending on the Nano/controller.
 const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 for(let frameIndex=0;frameIndex<count-1;frameIndex++){
  if(frameIndex===0){output.push(new Uint8ClampedArray(first));continue;}
  const cycle=frameIndex/(count-1)*(poses.length-1);
  const index=Math.min(poses.length-2,Math.floor(cycle));
  const t=cycle-index,from=poses[index],to=poses[index+1];
  const result=new Uint8ClampedArray(COUNT*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const p=y*W+x,k=p*4;
   const noise=bayer[(y&3)*4+(x&3)]/16;
   const chosen=t>noise?to:from;
   result[k]=chosen[k];result[k+1]=chosen[k+1];result[k+2]=chosen[k+2];result[k+3]=255;
  }
  output.push(result);
 }
 output.push(new Uint8ClampedArray(first));
 return output;
}
function deltaCount(a,b){
 if(!a||!b||a.length!==COUNT*4||b.length!==COUNT*4)throw Error('Invalid frames');
 let total=0;
 for(let i=0;i<COUNT*4;i+=4)
  if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])total++;
 return total;
}
function validate(frames){
 if(!Array.isArray(frames)||frames.length<2||frames.length>24||
    frames.some(f=>!f||f.length!==COUNT*4))throw Error('Animation must have 2–24 exact 40x40 frames');
 if(deltaCount(frames[0],frames.at(-1))!==0)throw Error('Last frame must match first exactly');
 return frames.slice(1).map((f,i)=>deltaCount(frames[i],f));
}
global.JH2LoopAnimation={quantize,buildKeyframes,validate,deltaCount};
})(typeof window!=='undefined'?window:globalThis);
