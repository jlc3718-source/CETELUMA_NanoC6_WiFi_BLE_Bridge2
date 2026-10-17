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
  if(!Array.isArray(pal)||pal.length<2||pal.length>MAX_COLORS||!pal.every(x=>typeof x==="string"&&/^#[0-9a-f]{6}$/i.test(x)))throw Error("AI palette must have 2–12 valid colors");
  if(pal[0].toUpperCase()!=="#000000")throw Error("AI background must be black");
  if(!Array.isArray(rows)||rows.length!==SIZE||!rows.every(x=>typeof x==="string"&&x.length===SIZE))throw Error("AI rows must be exactly 20×20");
  let visible=0;const rgba=Buffer.alloc(LEDS*LEDS*4);
  const colors=pal.map(x=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16)));
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const letter=rows[y][x].toUpperCase(),index=parseInt(letter,36);
    if(!/^[0-9A-B]$/.test(letter)||index>=colors.length)throw Error("AI grid contains an invalid color index");
    if(index>0)visible++;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const offset=((y*2+dy)*LEDS+(x*2+dx))*4;
      rgba[offset]=colors[index][0];rgba[offset+1]=colors[index][1];rgba[offset+2]=colors[index][2];rgba[offset+3]=255;
    }
  }
  if(visible<45)throw Error("AI drew too little detail for a recognizable curtain image");
  return {rgba:rgba.toString("base64"),palette:pal.map(x=>x.toUpperCase()),logicalGrid:"20x20",outputGrid:"40x40",activeBlocks:visible};
}
