/* Jason Home 2 Curtain Studio perceptual 40x40 pipeline.
 * Zero network, no AI identity guessing, no Bluetooth writes. */
(function(root){
"use strict";
const N=160,S=40;
const clamp=(x,a=0,b=255)=>Math.max(a,Math.min(b,x));
const luminance=(r,g,b)=>0.2126*r+0.7152*g+0.0722*b;
function assertStage(p){if(!p||p.length!==N*N*4)throw Error("Expected 160x160 RGBA stage");}
function estimateFocus(p){
 assertStage(p);
 let sx=0,sy=0,weight=0;
 for(let y=5;y<N-5;y+=3)for(let x=5;x<N-5;x+=3){
  const i=(y*N+x)*4,ix=i+4,iy=i+N*4;
  const here=luminance(p[i],p[i+1],p[i+2]);
  const dx=Math.abs(here-luminance(p[ix],p[ix+1],p[ix+2]));
  const dy=Math.abs(here-luminance(p[iy],p[iy+1],p[iy+2]));
  const sat=Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2]);
  const center=Math.max(.15,1-1.2*((x/N-.5)**2+(y/N-.5)**2));
  const w=center*(Math.min(90,dx+dy)*.7+Math.min(60,sat)*.10);
  sx+=x*w;sy+=y*w;weight+=w;
 }
 return weight>30?{x:clamp(sx/weight/N,0.15,0.85),y:clamp(sy/weight/N,0.15,0.85)}:{x:.5,y:.5};
}
function smoothStage(p,options={}){
 assertStage(p);
 const out=new Uint8ClampedArray(p.length);
 const cx=Number.isFinite(options.cx)?options.cx:.5;
 const cy=Number.isFinite(options.cy)?options.cy:.5;
 const radius=Number.isFinite(options.radius)?Math.max(.12,options.radius):.32;
 const strength=Number.isFinite(options.strength)?clamp(options.strength,0,1):.75;
 const sq=radius*radius;
 const lum=new Float32Array(N*N);
 for(let k=0;k<lum.length;k++){const j=k*4;lum[k]=luminance(p[j],p[j+1],p[j+2]);}
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const pos=y*N+x,i=pos*4;
  const l=lum[pos];
  const xx=x/N-cx,yy=y/N-cy;
  const focus=Math.exp(-(xx*xx+yy*yy)/(2*sq));
  const right=lum[y*N+Math.min(x+1,N-1)];
  const down=lum[Math.min(y+1,N-1)*N+x];
  const edge=clamp((Math.abs(right-l)+Math.abs(down-l))/75,0,1);
  // Background texture is smoothed; strong subject contours receive less smoothing.
  const smooth=(.60-.44*focus-.37*edge)*strength;
  let weights=0,rr=0,gg=0,bb=0;
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
   const yy2=clamp(y+oy,0,N-1),xx2=clamp(x+ox,0,N-1),index=yy2*N+xx2,q=index*4;
   const dl=lum[index]-l;
   const spatial=ox===0&&oy===0?1:ox===0||oy===0?.61:.39;
   const w=spatial/(1+(dl*dl)/900); // bilateral, preserves hard edges
   weights+=w;rr+=p[q]*w;gg+=p[q+1]*w;bb+=p[q+2]*w;
  }
  const keep=1-smooth;
  out[i]=clamp(keep*p[i]+smooth*rr/weights);
  out[i+1]=clamp(keep*p[i+1]+smooth*gg/weights);
  out[i+2]=clamp(keep*p[i+2]+smooth*bb/weights);
  out[i+3]=255;
 }
 return out;
}
function areaDownsample(p){
 assertStage(p);
 const out=new Uint8ClampedArray(S*S*4);
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const dst=(y*S+x)*4;
  let r=0,g=0,b=0;
  for(let dy=0;dy<4;dy++)for(let dx=0;dx<4;dx++){
   const q=((y*4+dy)*N+x*4+dx)*4;
   r+=p[q];g+=p[q+1];b+=p[q+2];
  }
  out[dst]=Math.round(r/16);out[dst+1]=Math.round(g/16);out[dst+2]=Math.round(b/16);out[dst+3]=255;
 }
 return out;
}
function outline40(image,options={}){
 const out=image.slice(),cx=(Number(options.cx)||.5)*S,cy=(Number(options.cy)||.5)*S;
 const radius=Math.max(5,(Number(options.radius)||.32)*S);
 for(let y=1;y<S-1;y++)for(let x=1;x<S-1;x++){
  const i=(y*S+x)*4;
  const l=luminance(image[i],image[i+1],image[i+2]);
  const a=(y*S+x-1)*4,b=(y*S+x+1)*4,c=((y-1)*S+x)*4,d=((y+1)*S+x)*4;
  const h=Math.abs(luminance(image[a],image[a+1],image[a+2])-luminance(image[b],image[b+1],image[b+2]));
  const v=Math.abs(luminance(image[c],image[c+1],image[c+2])-luminance(image[d],image[d+1],image[d+2]));
  const edge=clamp((h+v-20)/115,0,1);
  const dist=((x-cx)**2+(y-cy)**2)/(2*radius*radius);
  const gain=.16*edge*(.35+.65*Math.exp(-dist));
  for(let k=0;k<3;k++)out[i+k]=clamp(image[i+k]+gain*(image[i+k]-(image[a+k]+image[b+k]+image[c+k]+image[d+k])/4));
 }
 return out;
}
function processEnhanced(stage,options={}){
 return outline40(areaDownsample(smoothStage(stage,options)),options);
}
function tone(image,settings={}){
 const gamma=Number(settings.gamma)||1,lift=Number(settings.lift)||0,rolloff=Number(settings.rolloff)||0,sat=(Number(settings.saturation)||100)/100,min=Number(settings.minimum)||0;
 if(gamma===1&&lift===0&&rolloff===0&&sat===1&&min===0)return image;
 const out=image.slice();
 for(let i=0;i<out.length;i+=4){
  const r=image[i],g=image[i+1],b=image[i+2],l=luminance(r,g,b);
  if(Math.max(r,g,b)<7){out[i]=r;out[i+1]=g;out[i+2]=b;continue;} // true black stays black
  let mapped=[r,g,b].map(v=>{
   let z=255*Math.pow(v/255,1/gamma);
   z+=lift*(1-z/255)**2;
   z-=rolloff*Math.pow(z/255,3);
   return clamp(z);
  });
  const y=luminance(...mapped);
  mapped=mapped.map(v=>clamp(y+(v-y)*sat));
  if(min>0 && y<min && y>0){const delta=min-y;mapped=mapped.map(v=>clamp(v+delta));}
  out[i]=mapped[0];out[i+1]=mapped[1];out[i+2]=mapped[2];out[i+3]=255;
 }
 return out;
}
function score(image,options={}){
 // Lightly prioritize well-defined outlines, readable foreground contrast,
 // penalize crushed highlights and backgrounds with high-frequency noise.
 const cx=(Number(options.cx)||.5)*S,cy=(Number(options.cy)||.5)*S,radius=(Number(options.radius)||.32)*S;
 let edge=0,backgroundNoise=0,dark=0,clipped=0;
 for(let y=1;y<S-1;y++)for(let x=1;x<S-1;x++){
  const i=(y*S+x)*4,j=(y*S+x+1)*4,k=((y+1)*S+x)*4;
  const l=luminance(image[i],image[i+1],image[i+2]);
  const diff=Math.abs(l-luminance(image[j],image[j+1],image[j+2]))+Math.abs(l-luminance(image[k],image[k+1],image[k+2]));
  const focus=Math.exp(-((x-cx)**2+(y-cy)**2)/(2*radius*radius));
  edge+=Math.min(90,diff)*focus;
  backgroundNoise+=Math.min(90,diff)*(1-focus);
  dark+=l<5?1:0;clipped+=l>250?1:0;
 }
 return Math.round(10*(edge/1500-.16*backgroundNoise/1500-.25*dark/1400-.12*clipped/1400)*100)/100;
}
const api={estimateFocus,smoothStage,areaDownsample,processEnhanced,tone,score};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
root.CurtainQuality=api;
})(typeof window!=="undefined"?window:typeof globalThis!=="undefined"?globalThis:this);
