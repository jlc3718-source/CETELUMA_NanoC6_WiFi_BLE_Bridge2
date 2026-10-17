import {parsePixelGrid} from './curtain_pixel_grid.mjs';
const N=20;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(+v)?+v:lo));
export function renderShapeArt(raw){
 if(typeof raw!=='string'||raw.length>16000)throw Error('Pixel AI response too large');
 const i=raw.indexOf('{'),j=raw.lastIndexOf('}');
 if(i<0||j<=i)throw Error('Pixel AI response lacks JSON');
 let plan;try{plan=JSON.parse(raw.slice(i,j+1));}catch{throw Error('Pixel AI JSON invalid');}
 if(Array.isArray(plan.rows))return parsePixelGrid(raw);
 const palette=plan.palette;
 if(!Array.isArray(palette)||palette.length<2||palette.length>12||
    palette[0]?.toUpperCase()!=='#000000'||
    !palette.every(x=>typeof x==='string'&&/^#[0-9a-f]{6}$/i.test(x)))
  throw Error('AI palette invalid');
 if(!Array.isArray(plan.shapes)||plan.shapes.length<2||plan.shapes.length>45)
  throw Error('AI shapes invalid');
 const grid=Array.from({length:N},()=>Array(N).fill(0));
 const pt=(x,y,c)=>{if(x>=0&&x<N&&y>=0&&y<N)grid[y][x]=c;};
 for(const shape of plan.shapes){
  const type=String(shape.type||shape.kind||'').toLowerCase();
  const c=Number(shape.color??shape.c);
  if(!Number.isInteger(c)||c<0||c>=palette.length)throw Error('AI color invalid');
  const x=clamp(shape.x,0,19),y=clamp(shape.y,0,19),
        w=clamp(shape.w??shape.width??4,0.5,20),h=clamp(shape.h??shape.height??4,0.5,20);
  if(type==='rect'||type==='ellipse'){
   for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const u=(i+.5-x)/w,v=(j+.5-y)/h;
    if(type==='rect'?(u>=0&&u<1&&v>=0&&v<1):((u-.5)**2*4+(v-.5)**2*4<=1))pt(i,j,c);
   }
  }else if(type==='line'){
   const x2=clamp(shape.x2??x+w,0,20),y2=clamp(shape.y2??y+h,0,20),stroke=clamp(shape.stroke??2,1,5);
   const dx=x2-x,dy=y2-y,d2=dx*dx+dy*dy;
   for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const t=d2?clamp(((i+.5-x)*dx+(j+.5-y)*dy)/d2,0,1):0;
    if((i+.5-x-dx*t)**2+(j+.5-y-dy*t)**2<=stroke*stroke/4)pt(i,j,c);
   }
  }else if(type==='poly'||type==='polygon'){
   const coords=shape.points;
   if(!Array.isArray(coords)||coords.length<3||coords.length>18)throw Error('AI polygon invalid');
   const poly=coords.map(q=>{if(!Array.isArray(q)||q.length!==2)throw Error('AI point invalid');return [clamp(q[0],0,20),clamp(q[1],0,20)];});
   for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    let odd=false;for(let p=0,q=poly.length-1;p<poly.length;q=p++){
     const [ax,ay]=poly[p],[bx,by]=poly[q];
     if((ay>j+.5)!=(by>j+.5)&&(i+.5<(bx-ax)*(j+.5-ay)/(by-ay)+ax))odd=!odd;
    }
    if(odd)pt(i,j,c);
   }
  }else throw Error('Unknown AI shape');
 }
 let visible=0,xmin=20,ymin=20,xmax=-1,ymax=-1;
 for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(grid[y][x]>0){
  visible++;xmin=Math.min(xmin,x);ymin=Math.min(ymin,y);xmax=Math.max(xmax,x);ymax=Math.max(ymax,y);
 }
 if(visible<5)throw Error('AI subject not visible');
 const spanX=xmax-xmin+1,spanY=ymax-ymin+1,k=Math.min(18/spanX,18/spanY);
 const outW=Math.max(1,Math.min(20,Math.round(spanX*k))),
       outH=Math.max(1,Math.min(20,Math.round(spanY*k)));
 const left=Math.floor((20-outW)/2),top=Math.floor((20-outH)/2);
 const colors=palette.map(z=>[1,3,5].map(i=>parseInt(z.slice(i,i+2),16)));
 const result=Buffer.alloc(6400);let active=0;
 for(let y=0;y<20;y++)for(let x=0;x<20;x++){
  let index=0;
  if(x>=left&&x<left+outW&&y>=top&&y<top+outH){
   const ix=xmin+Math.floor((x-left)*spanX/outW),iy=ymin+Math.floor((y-top)*spanY/outH);
   index=grid[Math.min(19,iy)][Math.min(19,ix)];
  }
  if(index)active++;
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const p=((2*y+dy)*40+2*x+dx)*4;
   result[p]=colors[index][0];result[p+1]=colors[index][1];result[p+2]=colors[index][2];result[p+3]=255;
  }
 }
 return {rgba:result.toString('base64'),palette:palette.map(s=>s.toUpperCase()),activeBlocks:active,outputGrid:'40x40',logicalGrid:'20x20',autoFramed:true};
}
