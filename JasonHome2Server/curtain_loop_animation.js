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
// Proven three-frame wink pattern: original image -> tiny pixel edit -> original.
// A 40x40 base image is never AI-regenerated to create animation. Changed
// patches are at most 5x5 pixels, so every Nano delta is at most 25 RGB pixels.
function subjectBox(base){
 let minX=W,minY=H,maxX=-1,maxY=-1,n=0;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const i=(y*W+x)*4;
  if(Math.max(base[i],base[i+1],base[i+2])<38)continue;
  minX=Math.min(minX,x);minY=Math.min(minY,y);
  maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);n++;
 }
 if(n<25)throw Error('Artwork has too few visible pixels to animate');
 return {x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
}
function bodyColor(base,box){
 // Reuse the most common original bright subject color, never invent a new
 // palette or repaint the character or its background.
 const histogram=new Map();
 for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){
  const i=(y*W+x)*4,r=base[i],g=base[i+1],b=base[i+2];
  if(Math.max(r,g,b)<65)continue;
  const key=(r>>4)<<8|(g>>4)<<4|(b>>4);
  const e=histogram.get(key)||{n:0,r:0,g:0,b:0};
  e.n++;e.r+=r;e.g+=g;e.b+=b;histogram.set(key,e);
 }
 const dominant=[...histogram.values()].sort((a,b)=>b.n-a.n)[0];
 if(!dominant)throw Error('Cannot find a visible color to restore');
 return [Math.round(dominant.r/dominant.n),
         Math.round(dominant.g/dominant.n),
         Math.round(dominant.b/dominant.n)];
}
function patchRect(box,which){
 const cx=Math.round(box.x+box.w*(which==='mouth'?.50:.68));
 const cy=Math.round(box.y+box.h*(which==='mouth'?.67:.38));
 const x=clamp(cx-2,Math.max(box.x,0),Math.min(W-5,box.x+Math.max(0,box.w-5)));
 const y=clamp(cy-2,Math.max(box.y,0),Math.min(H-5,box.y+Math.max(0,box.h-5)));
 return {x:Math.round(x),y:Math.round(y)};
}
function editedPatch(base,box,which,color){
 const out=new Uint8ClampedArray(base);
 const {x,y}=patchRect(box,which);
 // Exactly one 5x5 area may change. This is the same method used in the
 // verified blink test; the only full frame is the original initial picture.
 let changed=0;
 for(let dy=0;dy<5;dy++)for(let dx=0;dx<5;dx++){
  const px=x+dx,py=y+dy,k=(py*W+px)*4;
  // Do not modify any pixel outside the original subject bounding box.
  if(px<box.x||px>=box.x+box.w||py<box.y||py>=box.y+box.h)continue;
  const light=Math.max(base[k],base[k+1],base[k+2]);
  // Removing an eye / mouth restores the original nearby body color.
  // Keep bright pixels as-is; focus on the dark cut-out or light contrast.
  if(light<110){
   out[k]=color[0];out[k+1]=color[1];out[k+2]=color[2];
  }
 }
 for(let i=0;i<COUNT*4;i+=4)
  if(out[i]!==base[i]||out[i+1]!==base[i+1]||out[i+2]!==base[i+2])changed++;
 if(changed<3){
  // If the art has no detectable carved hole, draw a 5-pixel eyelid or
  // smile line in the SAME 5x5 patch. Never shift the whole image.
  out.set(base);changed=0;
  for(let dx=0;dx<5;dx++){
   const dy=which==='mouth'?(dx===0||dx===4?1:3):2;
   const px=x+dx,py=y+dy,k=(py*W+px)*4;
   if(px>=box.x&&px<box.x+box.w&&py>=box.y&&py<box.y+box.h){
    out[k]=0;out[k+1]=0;out[k+2]=0;
   }
  }
 }
 return out;
}
function buildSimpleAnimation(base,{prompt='',count=24}={}){
 if(!base||base.length!==COUNT*4)throw Error('Generate a 40x40 image first');
 if(!Number.isInteger(count)||count<4||count>24)
  throw Error('Use 4–24 animation frames');
 const box=subjectBox(base),color=bodyColor(base,box);
 const text=String(prompt||'').toLowerCase();
 const wantsEye=/(wink|blink|eye|eyelid|pumpkin|ghost|face)/.test(text);
 const wantsMouth=/(smil|grin|mouth|laugh|talk|teeth)/.test(text);
 // If no feature is specified, default to the original successful wink.
 const wink=editedPatch(base,box,'eye',color);
 // Four-frame loops use the exact original three-stage wink/restore sequence.
 // Extra mouth actions are enabled only when there is room for a reset frame.
 const mouth=wantsMouth&&count>=5?editedPatch(base,box,'mouth',color):null;
 const frames=[];
 for(let i=0;i<count;i++){
  const t=i/(count-1);
  // Longer holds need no packets. The two visible movements are brief,
  // localized and always followed by an EXACT original-pixel restoration.
  let active=base;
  if(t>=.20&&t<.36)active=wink;
  else if(mouth&&t>=.59&&t<.77)active=mouth;
  else if(!mouth&&!wantsEye&&t>=.59&&t<.77)active=wink;
  frames.push(new Uint8ClampedArray(active));
 }
 frames[0]=new Uint8ClampedArray(base);
 frames[count-1]=new Uint8ClampedArray(base);
 const changes=validate(frames);
 if(changes.some(n=>n>25))throw Error('Animation must change at most 25 pixels per frame');
 return frames;
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
global.JH2LoopAnimation={quantize,buildSimpleAnimation,validate,deltaCount};
})(typeof window!=='undefined'?window:globalThis);
