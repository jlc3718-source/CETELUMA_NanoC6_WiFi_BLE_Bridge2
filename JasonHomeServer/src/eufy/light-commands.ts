export const OP_SETUP=0x0201;
export const OP_COLOR=0x0206;
export const OP_SHOW=0x020d;
const LOCAL_COLOR_ID=20006;
const E120_EFFECT_CARRIER_ID=10474;
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
  if(isE22(model))return concat(tlv(0xa3,le16(LOCAL_COLOR_ID)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([1])),tlv(0xa6,pal),tlv(0xa7,positions(lamps)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));
  return concat(tlv(0xa3,le16(LOCAL_COLOR_ID)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([5])),tlv(0xa6,pal),tlv(0xa7,positions(lamps)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,new Uint8Array([0,0])),tlv(0xac,new Uint8Array([255,255,255,255])),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));
}
function speedValue(speed:number){switch(clamp(speed,1,5)){case 1:return 20;case 2:return 35;case 3:return 50;case 4:return 70;default:return 90;}}
function speedValueE22(speed:number){switch(clamp(speed,1,5)){case 1:return 2;case 2:return 4;case 3:return 8;case 4:return 25;default:return 50;}}
function layerType(name:string){if(contains(name,"Strobe")||contains(name,"Twinkle"))return 2;if(contains(name,"Chase")||contains(name,"Gradient")||contains(name,"Candy")||contains(name,"Wipe")||contains(name,"Meteor")||contains(name,"Rainbow")||contains(name,"Pulse"))return 0;return 1;}
function effectIndex(name:string){const names=["Solid / Static","Jump","Breath","Strobe","Chase","Gradient Sweep","Candy Cane","Twinkle / Sparkle","Wipe / Fill","Meteor / Comet","Rainbow Flow","Pulse Wave"];const i=names.indexOf(name);return i<0?0:i;}
function encodeLayer(model:string,type:number,effect:string,colors:number[],speed:number,reverse:boolean):Uint8Array{
  const out:number[]=[0,speed,100,0,1,1,0,1,0,type,colors.length&255];for(const c of colors)out.push(...nativeColor(model,c));
  if(type===0){const chase=contains(effect,"Chase")||contains(effect,"Candy")||contains(effect,"Meteor"),gradient=contains(effect,"Gradient")||contains(effect,"Rainbow"),wipe=contains(effect,"Wipe"),pulse=contains(effect,"Pulse");out.push(wipe?1:0,gradient?1:0,reverse?1:0,0,0,gradient?8:0,chase?1:0,contains(effect,"Candy")?4:(contains(effect,"Meteor")?3:2),contains(effect,"Meteor")?1:0,0,contains(effect,"Meteor")?9:0,0,pulse?1:0,100,pulse?20:100,0,0);}
  else if(type===1){const breath=contains(effect,"Breath"),jump=contains(effect,"Jump");out.push(100,1,Math.max(1,colors.length),breath?2:0,jump?1:0,0,0,colors.length>1?1:0,0,0);}
  else{const twinkle=contains(effect,"Twinkle");out.push(0,100,20,1,twinkle?1:0,twinkle?6:2,twinkle?2:1,twinkle?Math.min(255,Math.max(3,colors.length*3)):255,twinkle?1:0,colors.length>1?2:0,0,0);}
  return new Uint8Array(out);
}
export function show(model:string,effect:string,colors:number[],speed:number,reverse:boolean):Uint8Array{
  const palette=colors?.length?colors:[0xffffff],rawSpeed=isE22(model)?speedValueE22(speed):speedValue(speed),showId=isE22(model)?21000+effectIndex(effect):E120_EFFECT_CARRIER_ID,layer=encodeLayer(model,layerType(effect),effect,palette,rawSpeed,reverse);
  return concat(tlv(0xa3,le32(showId)),tlv(0xa4,new Uint8Array([rawSpeed])),tlv(0xa5,new Uint8Array([1])),tlv(0xa6,new Uint8Array([0])),tlv(0xa8,new Uint8Array([0])),tlv(0xa9,layer));
}
function e120ModeId(effect:string,reverse:boolean){if(isSolidEffect(effect))return 30014;if(contains(effect,"Breath"))return 30011;if(contains(effect,"Twinkle")||contains(effect,"Strobe"))return 30006;if(contains(effect,"Meteor"))return 30012;if(contains(effect,"Rainbow")||contains(effect,"Pulse"))return 30013;if(contains(effect,"Gradient")||contains(effect,"Wipe"))return 30007;if(contains(effect,"Jump"))return 30009;if(contains(effect,"Candy")||contains(effect,"Chase"))return reverse?30008:30010;return 30010;}
function e120Catalog(localId:number,catalogId:number,rawA5:number,colors:number[],lampCount:number){const lamps=clamp(lampCount,1,120),palette=colors?.length?colors:[0xff0000,0x00ff00],pal:number[]=[Math.min(255,palette.length)];for(const c of palette)pal.push(...nativeColor("T8L00",c));return concat(tlv(0xa3,le16(localId)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([clamp(rawA5,0,255)])),tlv(0xa6,new Uint8Array(pal)),tlv(0xa7,positions(lamps)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,new Uint8Array([0,0])),tlv(0xac,le32(catalogId)),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));}
function e120Grouped(localId:number,catalogId:number,rawA5:number,colors:number[],lampCount:number){const lamps=clamp(lampCount,2,120),src=colors?.length?colors:[0xffffff],count=Math.max(1,Math.min(8,src.length)),pal:number[]=[count];for(let i=0;i<count;i++)pal.push(...nativeColor("T8L00",src[i]));const groups:number[]=[];for(let g=0;g<count;g++){const pos:number[]=[];for(let i=g;i<lamps;i+=count)pos.push(i);groups.push(pos.length,...pos);}return concat(tlv(0xa3,le16(localId)),tlv(0xa4,le16(0)),tlv(0xa5,new Uint8Array([clamp(rawA5,1,5)])),tlv(0xa6,new Uint8Array(pal)),tlv(0xa7,new Uint8Array(groups)),tlv(0xa8,new Uint8Array([100])),tlv(0xa9,new Uint8Array([0,0,0,0,0])),tlv(0xaa,new Uint8Array([0])),tlv(0xab,new Uint8Array([0,0])),tlv(0xac,le32(catalogId)),tlv(0xad,new Uint8Array([0])),tlv(0xae,new Uint8Array([0])),tlv(0xaf,new Uint8Array([0])),tlv(0xb0,new Uint8Array([0])));}
export function effectE120(effect:string,colors:number[],speed:number,reverse:boolean,lampCount:number){const src=colors?.length?colors:[0xffffff],palette=src.slice(0,8),mode=e120ModeId(effect,reverse),sp=clamp(speed,1,5);return palette.length>1?e120Grouped(mode,10034,sp,palette,lampCount):e120Catalog(mode,10034,sp,palette,lampCount);}
export function buildEffect(model:string,effect:string,colors:number[],speed:number,reverse:boolean):{opcode:number;fields:Uint8Array}{const safe=colors?.length?colors:[0xffffff];if(isSolidEffect(effect))return {opcode:OP_COLOR,fields:color(model,safe[0],defaultLampCount(model))};if(isE22(model))return {opcode:OP_SHOW,fields:show(model,effect,safe,speed,reverse)};return {opcode:OP_COLOR,fields:effectE120(effect,safe,speed,reverse,defaultLampCount(model))};}
