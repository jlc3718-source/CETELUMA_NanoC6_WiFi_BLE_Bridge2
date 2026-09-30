import { STYLE_TEMPLATES } from "./style-templates.js";
import { buildFactoryFields, reverseFactoryPresetDirection, rgbcw } from "./factory-presets.js";
export const OP_SETUP=0x0201;
export const OP_COLOR=0x0206;
export const OP_SHOW=0x020d;
const LOCAL_COLOR_ID=20006;
function clamp(v:number,lo:number,hi:number){return Math.max(lo,Math.min(hi,v));}
function concat(...parts:Uint8Array[]):Uint8Array{return new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));}
function tlv(tag:number,value:Uint8Array):Uint8Array{if(value.length>255)throw new Error("TLV too long");return concat(new Uint8Array([tag,value.length]),value);}
function le16(v:number){return new Uint8Array([v&255,(v>>>8)&255]);}
function le32(v:number){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]);}
function isE22(model:string){const m=(model||"").toUpperCase();return m==="E22"||m.startsWith("T8L02");}
function contains(value:string,token:string){return (value||"").toLowerCase().includes(token.toLowerCase());}
export function defaultLampCount(_model:string){return 60;}
export function isSolidEffect(effect:string){return effect==="Solid"||effect==="Solid / Static"||effect==="Static";}
export function brightness(percent:number){return tlv(0xa4,new Uint8Array([clamp(percent,0,100)]));}
function nativeColor(model:string,rgb:number){const r=(rgb>>>16)&255,g=(rgb>>>8)&255,b=rgb&255;return isE22(model)?new Uint8Array([r,g,b,0,0]):new Uint8Array([r,g,b,0]);}
function positions(lamps:number){const out=new Uint8Array(lamps+1);out[0]=lamps;for(let i=0;i<lamps;i++)out[i+1]=i;return out;}
export function color(model:string,rgb:number,lampCount:number):Uint8Array{
  const lamps=clamp(lampCount,1,120),pal=concat(new Uint8Array([1]),nativeColor(model,rgb));
  if(isE22(model))return concat(tlv(0xa3,le16(LOCAL_COLOR_ID)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([5])),tlv(0xa6,concat(new Uint8Array([1]),rgbcw((rgb&0xffffff).toString(16).padStart(6,"0")))),tlv(0xa7,positions(lamps)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,le16(0)),tlv(0xac,le32(0xffffffff)),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));
  return concat(tlv(0xa3,le16(LOCAL_COLOR_ID)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([5])),tlv(0xa6,pal),tlv(0xa7,positions(lamps)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,new Uint8Array([0,0])),tlv(0xac,new Uint8Array([255,255,255,255])),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));
}
function speedValueE22(speed:number){switch(clamp(speed,1,5)){case 1:return 2;case 2:return 4;case 3:return 8;case 4:return 25;default:return 50;}}
export function styleDefinition(effect:string,colors:number[],speed:number,reverse:boolean){
  const alias:Record<string,string>={Flow1:"Chase",Flow2:"Chase",Cycle:"Jump",Streamlight:"Wipe / Fill",Twinkle:"Twinkle / Sparkle",Breathe:"Breath"};
  const source=STYLE_TEMPLATES[alias[effect]||effect];
  if(effect==="Flow2")reverse=!reverse;
  if(!source)throw new Error("Unsupported effect style: "+effect);
  const rawSpeed=speedValueE22(speed),palette=colors.slice(0,8).map(c=>(c&0xffffff).toString(16).padStart(6,"0")).join("|");
  let preset={...source,speed:rawSpeed,layers:source.layers.map(layer=>({
    ...layer,colors:palette,layer_speed:rawSpeed,
    // Single-region twinkle/meteor templates should cover the complete installed string.
    ...(source.layers.length===1?{layer_range:[0,100]}:{}),
    ...(Number(layer.current_layer_type)===1?{color_quantity_range:colors.length}:{})
  }))};
  if(reverse)preset=reverseFactoryPresetDirection(preset);
  return preset;
}
// E120 uses its native 0x0206 animation modes, not the E22 gallery protocol.
// Mode ids captured from Pool's Eufy app selections on 2026-09-29.
export const E120_NATIVE_MODES:Record<string,number>={Flow1:20000,Flow2:20001,Cycle:20002,Streamlight:20003,Twinkle:20004,Breathe:20005,Static:20006};
// Existing gallery labels use their closest available native E120 motion.
export const E120_STYLE_ALIASES:Record<string,string>={
  "Solid":"Static","Solid / Static":"Static",Jump:"Cycle",Breath:"Breathe",Strobe:"Twinkle",Chase:"Flow1",
  "Gradient Sweep":"Flow1","Candy Cane":"Flow1","Twinkle / Sparkle":"Twinkle",
  "Wipe / Fill":"Streamlight","Meteor / Comet":"Streamlight","Rainbow Flow":"Flow1","Pulse Wave":"Breathe"
};
export function e120ModeId(effect:string,reverse:boolean){
  let native=E120_STYLE_ALIASES[effect]||effect;
  if(reverse&&native==="Flow1")native="Flow2";
  else if(reverse&&native==="Flow2")native="Flow1";
  const id=E120_NATIVE_MODES[native];
  if(id===undefined)throw new Error("Unsupported E120 effect style: "+effect);
  return id;
}
function e120Catalog(localId:number,catalogId:number,rawA5:number,colors:number[],lampCount:number){const lamps=clamp(lampCount,1,120),palette=colors?.length?colors:[0xff0000,0x00ff00],pal:number[]=[Math.min(255,palette.length)];for(const c of palette)pal.push(...nativeColor("T8L00",c));return concat(tlv(0xa3,le16(localId)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([clamp(rawA5,0,255)])),tlv(0xa6,new Uint8Array(pal)),tlv(0xa7,positions(lamps)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,new Uint8Array([0,0])),tlv(0xac,le32(catalogId)),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));}
function e120Grouped(localId:number,catalogId:number,rawA5:number,colors:number[],lampCount:number){const lamps=clamp(lampCount,2,120),src=colors?.length?colors:[0xffffff],count=Math.max(1,Math.min(8,src.length)),pal:number[]=[count];for(let i=0;i<count;i++)pal.push(...nativeColor("T8L00",src[i]));const groups:number[]=[];for(let g=0;g<count;g++){const pos:number[]=[];for(let i=g;i<lamps;i+=count)pos.push(i);groups.push(pos.length,...pos);}return concat(tlv(0xa3,le16(localId)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([clamp(rawA5,1,5)])),tlv(0xa6,new Uint8Array(pal)),tlv(0xa7,new Uint8Array(groups)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,new Uint8Array([0,0])),tlv(0xac,le32(catalogId)),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));}
export function effectE120(effect:string,colors:number[],speed:number,reverse:boolean,lampCount:number){const src=colors?.length?colors:[0xffffff],palette=src.slice(0,8),mode=e120ModeId(effect,reverse),sp=clamp(speed,1,5);return palette.length>1?e120Grouped(mode,0xffffffff,sp,palette,lampCount):e120Catalog(mode,0xffffffff,sp,palette,lampCount);}
export function buildEffect(model:string,effect:string,colors:number[],speed:number,reverse:boolean):{opcode:number;fields:Uint8Array}{
  const raw=colors?.length?colors:[0xffffff];
  if(isSolidEffect(effect))return {opcode:OP_COLOR,fields:color(model,raw[0],defaultLampCount(model))};
  if(!isE22(model))return {opcode:OP_COLOR,fields:effectE120(effect,raw,speed,reverse,defaultLampCount(model))};
  // Use actual catalog ids/parameters, not invented 21000-series gallery ids or 300xx colour aliases.
  return {opcode:OP_SHOW,fields:buildFactoryFields(model,styleDefinition(effect,raw,speed,reverse))};
}
