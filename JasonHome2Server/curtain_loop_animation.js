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
const motions=['sway','bounce','orbit','pulse','twinkle','blink'];
function motionForPrompt(prompt){
 const text=String(prompt||'').toLowerCase();
 if(/blink|wink|eye/.test(text))return 'blink';
 if(/sparkle|star|snow|twinkle|glitter/.test(text))return 'twinkle';
 if(/pulse|breath|glow|heart/.test(text))return 'pulse';
 if(/spin|circle|orbit|around/.test(text))return 'orbit';
 if(/jump|bounce|hop|up and down/.test(text))return 'bounce';
 return 'sway';
}
function build(base,{motion='sway',amplitude=2,count=24}={}){
 if(!base||base.length!==COUNT*4)throw Error('Generate a 40x40 image first');
 if(!Number.isInteger(count)||count<2||count>24)throw Error('Frame count must be 2–24');
 motion=motions.includes(motion)?motion:'sway';
 amplitude=clamp(Math.round(Number(amplitude)||2),1,3);
 const output=[],first=new Uint8ClampedArray(base);
 function draw(t){
  const angle=Math.PI*2*t,dx=motion==='sway'?Math.round(amplitude*Math.sin(angle)):
   motion==='orbit'?Math.round(amplitude*(Math.cos(angle)-1)):0;
  const dy=motion==='bounce'?Math.round(amplitude*Math.sin(angle)):
   motion==='orbit'?Math.round(amplitude*Math.sin(angle)):0;
  const frame=new Uint8ClampedArray(COUNT*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const dest=(y*W+x)*4,xx=x-dx,yy=y-dy;
   frame[dest+3]=255;
   if(xx<0||xx>=W||yy<0||yy>=H)continue;
   const src=(yy*W+xx)*4;
   let r=base[src],g=base[src+1],b=base[src+2];
   if(motion==='pulse'&&r+g+b>0){
    const factor=1-.35*(1-Math.cos(angle))/2;
    r=Math.round(r*factor);g=Math.round(g*factor);b=Math.round(b*factor);
   }
   if(motion==='twinkle'&&r+g+b>40){
    const pattern=((xx*73+yy*137)%17);
    if(pattern<3){
     const factor=.52+.48*Math.cos(angle+pattern*2*Math.PI/3);
     r=Math.round(r*factor);g=Math.round(g*factor);b=Math.round(b*factor);
    }
   }
   if(motion==='blink'&&r+g+b<130&&yy>9&&yy<23&&xx>8&&xx<32){
    const intensity=Math.max(0,Math.sin(angle));
    const fill=intensity>.45?0:1;
    if(fill===0){r=255;g=112;b=0;}
   }
   frame[dest]=r;frame[dest+1]=g;frame[dest+2]=b;
  }
  return frame;
 }
 for(let i=0;i<count-1;i++)output.push(i===0?first:draw(i/(count-1)));
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
global.JH2LoopAnimation={quantize,build,validate,deltaCount,motionForPrompt,motions};
})(typeof window!=='undefined'?window:globalThis);
