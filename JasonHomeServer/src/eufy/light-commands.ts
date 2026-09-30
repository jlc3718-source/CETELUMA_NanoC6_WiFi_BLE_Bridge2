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
export function isSolidEffect(effect:string){return effect==="Solid"||effect==="Solid / Static";}
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
  const source=STYLE_TEMPLATES[effect];
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
export function buildEffect(model:string,effect:string,colors:number[],speed:number,reverse:boolean):{opcode:number;fields:Uint8Array}{
  const raw=colors?.length?colors:[0xffffff];
  if(isSolidEffect(effect))return {opcode:OP_COLOR,fields:color(model,raw[0],defaultLampCount(model))};
  // Use actual catalog ids/parameters, not invented 21000-series gallery ids or 300xx colour aliases.
  return {opcode:OP_SHOW,fields:buildFactoryFields(model,styleDefinition(effect,raw,speed,reverse))};
}
