// AI generates the actual curtain grid rather than a high-definition image.
// The returned RGBA bytes are the only pixels that preview and BLE will use.
const SIZE=20,LEDS=40,MAX_COLORS=12;
export function parsePixelGrid(raw){
  if(typeof raw!=="string"||raw.length>18000)throw Error("AI pixel grid response is invalid");
  let text=raw.trim();
  if(text.startsWith("```"))text=text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
  const start=text.indexOf("{"),end=text.lastIndexOf("}");
  if(start<0||end<start)throw Error("AI did not return a pixel grid");
  let value;try{value=JSON.parse(text.slice(start,end+1));}catch{throw Error("AI returned malformed grid JSON");}
  const pal=value?.palette,rows=value?.rows;
  if(!Array.isArray(pal)||pal.length<2||pal.length>MAX_COLORS||
     !pal.every(x=>typeof x==="string"&&/^#[0-9a-f]{6}$/i.test(x)))
    throw Error("AI palette must have 2–12 valid colors");
  if(pal[0].toUpperCase()!=="#000000")throw Error("AI background must be black");
  if(!Array.isArray(rows)||rows.length<16||rows.length>24||
     !rows.every(x=>typeof x==="string"&&x.length>=14&&x.length<=26))
    throw Error("AI rows must be approximately 20×20");
  // Center and clip only blank border instead of accidentally clipping the sprite.
  const align=row=>{
    const s=row.toUpperCase().replace(/[^0-9A-B]/g,"0");
    return s.length>=SIZE?s.slice(Math.floor((s.length-SIZE)/2),Math.floor((s.length-SIZE)/2)+SIZE):
      "0".repeat(Math.floor((SIZE-s.length)/2))+s+"0".repeat(Math.ceil((SIZE-s.length)/2));
  };
  const aligned=rows.map(align);
  if(aligned.length>SIZE)aligned.splice(0,Math.floor((aligned.length-SIZE)/2));
  while(aligned.length<SIZE)aligned.unshift("0".repeat(SIZE));
  const values=aligned.map(row=>[...row].map(char=>{
    const index=parseInt(char,36);
    if(!Number.isInteger(index)||index>=pal.length)throw Error("AI used a color outside its palette");
    return index;
  }));
  let minX=SIZE,minY=SIZE,maxX=-1,maxY=-1,sourceVisible=0;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(values[y][x]>0){
    sourceVisible++;minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY);
  }
  if(sourceVisible<6)throw Error("AI returned no usable subject");
  // Fit the model's colored silhouette to the 20x20 logical LED canvas.
  // Sparse-but-recognizable art no longer fails an arbitrary 45-cell threshold.
  const spanX=maxX-minX+1,spanY=maxY-minY+1;
  const scale=Math.min(17/spanX,17/spanY);
  const width=Math.min(SIZE,Math.max(1,Math.round(spanX*scale)));
  const height=Math.min(SIZE,Math.max(1,Math.round(spanY*scale)));
  const x0=Math.floor((SIZE-width)/2),y0=Math.floor((SIZE-height)/2);
  const colors=pal.map(hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));
  const rgba=Buffer.alloc(LEDS*LEDS*4);
  let visible=0;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    let index=0;
    if(x>=x0&&x<x0+width&&y>=y0&&y<y0+height){
      const sx=minX+Math.min(spanX-1,Math.floor((x-x0)*spanX/width));
      const sy=minY+Math.min(spanY-1,Math.floor((y-y0)*spanY/height));
      index=values[sy][sx];
    }
    if(index)visible++;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const offset=((2*y+dy)*LEDS+2*x+dx)*4;
      rgba[offset]=colors[index][0];rgba[offset+1]=colors[index][1];rgba[offset+2]=colors[index][2];rgba[offset+3]=255;
    }
  }
  return {rgba:rgba.toString("base64"),palette:pal.map(x=>x.toUpperCase()),
    logicalGrid:"20x20",outputGrid:"40x40",activeBlocks:visible,sourceBlocks:sourceVisible,
    autoFramed:scale!==1};
}
