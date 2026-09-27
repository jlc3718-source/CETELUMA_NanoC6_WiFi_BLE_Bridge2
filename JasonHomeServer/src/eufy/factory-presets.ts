import { concat, tlv } from "./wire.js";

export interface EufyFactoryPreset {
  lightId:number;
  name?:string;
  colors?:string;
  brightness?:number;
  speed?:unknown;
  layerExecutionMode?:unknown;
  layers:Array<Record<string,unknown>>;
  raw:Record<string,unknown>;
  buildableE22:boolean;
  buildableE120Experimental:boolean;
}

export function collectFactoryEffectIds(node:unknown,out=new Set<number>()):Set<number>{
  if(Array.isArray(node)){for(const v of node)collectFactoryEffectIds(v,out);return out;}
  if(!node||typeof node!=="object")return out;
  for(const [k,v] of Object.entries(node as Record<string,unknown>)){
    if((k==="scene_id"||k==="light_id")&&typeof v==="number"&&Number.isFinite(v))out.add(v);
    else collectFactoryEffectIds(v,out);
  }
  return out;
}

function parseParams(entry:Record<string,unknown>):{params:Record<string,unknown>;brightness?:number;colors?:string}{
  const effect0=Array.isArray(entry.light_effect)&&entry.light_effect.length
    ? entry.light_effect[0] as Record<string,unknown>
    : undefined;
  const rawParams=(effect0?.params??entry.params) as unknown;
  let parsed:unknown=rawParams;
  if(typeof rawParams==="string"){
    try{parsed=JSON.parse(rawParams||"{}");}catch{parsed={};}
  }
  const params=parsed&&typeof parsed==="object"&&!Array.isArray(parsed)
    ? parsed as Record<string,unknown>
    : {};
  const b=effect0?.brightness??entry.brightness;
  const c=effect0?.rgb_hex??entry.rgb_hex;
  return {
    params,
    brightness:typeof b==="number"&&Number.isFinite(b)?b:undefined,
    colors:typeof c==="string"&&c?c:undefined
  };
}

export function normalizeFactoryEntry(entry:Record<string,unknown>):EufyFactoryPreset|undefined{
  const id=typeof entry.light_id==="number"&&Number.isFinite(entry.light_id)?entry.light_id:undefined;
  if(id===undefined)return undefined;
  const {params,brightness,colors}=parseParams(entry);
  const layers=Array.isArray(params.layer)
    ? params.layer.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)) as Array<Record<string,unknown>>
    : [];
  const base={
    lightId:id,
    name:typeof entry.name==="string"?entry.name:undefined,
    colors,
    brightness,
    speed:params.light_effect_speed,
    layerExecutionMode:params.layer_execution_mode,
    layers,
    raw:entry
  };
  return {
    ...base,
    buildableE22:canBuildFactoryFields("T8L02",base),
    buildableE120Experimental:canBuildFactoryFields("T8L00",base)
  };
}

export function dedupeFactoryPresetsByName(presets:EufyFactoryPreset[]):EufyFactoryPreset[]{
  const norm=(s:string)=>s.trim().toLowerCase().replace(/\\s+/g," ");
  const score=(p:EufyFactoryPreset)=>(p.buildableE22?8:0)+(p.buildableE120Experimental?8:0)+(p.layers.length?4:0)+(p.colors?2:0)+(typeof p.brightness==="number"?1:0);
  const chosen=new Map<string,EufyFactoryPreset>();
  for(const p of presets){
    const key=norm(p.name||"")||("id:"+p.lightId);
    const old=chosen.get(key);
    if(!old||score(p)>score(old)||(score(p)===score(old)&&p.lightId<old.lightId))chosen.set(key,p);
  }
  return [...chosen.values()].sort((a,b)=>a.lightId-b.lightId);
}

function b8(v:unknown):number{
  if(v===undefined||v===null)return 0;
  const n=typeof v==="number"?v:typeof v==="string"?Number(v):NaN;
  if(!Number.isFinite(n))throw new Error("Factory preset contains a non-scalar byte field");
  return n&255;
}
function range2(v:unknown):number[]{
  if(v===undefined||v===null)return [0,0];
  if(Array.isArray(v)){
    if(v.length<2)throw new Error("Factory preset range is incomplete");
    return [b8(v[1]),b8(v[0])];
  }
  return [b8(v),0];
}
function le32(v:number){return new Uint8Array([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]);}
const HEX=/^[0-9a-fA-F]{6}$/;

const RGBCW_CH:Record<"R"|"G"|"B"|"W"|"C",[number,number,number]>={
  R:[15.932,0.7035,0.294],G:[39.83,0.1629,0.7208],B:[2.2404,0.1472,0.0309],
  W:[66.28,0.4681,0.4182],C:[73.58,0.3166,0.3397]
};
const RGBCW_X:Record<string,[number,number,number]>=Object.fromEntries(Object.entries(RGBCW_CH).map(([k,[Y,x,y]])=>[k,[(x*Y)/y,Y,((1-x-y)*Y)/y]]));
const GAMMA=2.2,SAT=1.65;
const dec=(b:number)=>Math.pow(b/255,GAMMA);
const enc=(v:number)=>Math.round(255*Math.pow(Math.max(0,Math.min(1,v)),1/GAMMA));
function mul3(m:number[][],v:number[]){return [m[0][0]*v[0]+m[0][1]*v[1]+m[0][2]*v[2],m[1][0]*v[0]+m[1][1]*v[1]+m[1][2]*v[2],m[2][0]*v[0]+m[2][1]*v[1]+m[2][2]*v[2]];}
function inv3(m:number[][]){
  const [a,b,c,d,e,f,g,h,i]=[m[0][0],m[0][1],m[0][2],m[1][0],m[1][1],m[1][2],m[2][0],m[2][1],m[2][2]];
  const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C;
  return [[A/det,-(b*i-c*h)/det,(b*f-c*e)/det],[B/det,(a*i-c*g)/det,-(a*f-c*d)/det],[C/det,-(a*h-b*g)/det,(a*e-b*d)/det]];
}
const MRGB=[[RGBCW_X.R[0],RGBCW_X.G[0],RGBCW_X.B[0]],[RGBCW_X.R[1],RGBCW_X.G[1],RGBCW_X.B[1]],[RGBCW_X.R[2],RGBCW_X.G[2],RGBCW_X.B[2]]];
const MRGB_INV=inv3(MRGB);
function rgbcw(hex:string):Uint8Array{
  if(!HEX.test(hex))throw new Error("Factory preset color is not six-digit RGB");
  const r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
  const target=mul3(MRGB,[dec(r),dec(g),dec(b)]);
  const warm=Math.max(0,Math.min(1,((r-b)/255)*2+0.42));
  let best={rgb:[dec(r),dec(g),dec(b)],w:0,c:0};
  for(let t=0;t<=1.7;t+=0.005){
    const w=t*warm,c=t*(1-warm);if(w>1.15||c>1.15)break;
    const rgb=mul3(MRGB_INV,[target[0]-(w*RGBCW_X.W[0]+c*RGBCW_X.C[0]),target[1]-(w*RGBCW_X.W[1]+c*RGBCW_X.C[1]),target[2]-(w*RGBCW_X.W[2]+c*RGBCW_X.C[2])]);
    if(rgb[0]<-1e-6||rgb[1]<-1e-6||rgb[2]<-1e-6)break;
    best={rgb,w,c};
  }
  const m=Math.max(best.rgb[0],best.rgb[1],best.rgb[2],1e-9),sat=best.rgb.map(x=>m*Math.pow(Math.max(0,x)/m,SAT));
  return new Uint8Array([enc(sat[0]),enc(sat[1]),enc(sat[2]),enc(best.w),enc(best.c)]);
}
function rgb4(hex:string):Uint8Array{
  if(!HEX.test(hex))throw new Error("Factory preset color is not six-digit RGB");
  return new Uint8Array([parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),0]);
}
function layerHeader(l:Record<string,unknown>):number[]{
  return [b8(l.layer_priority),b8(l.layer_speed),...range2(l.layer_range),b8(l.interval_type),b8(l.interval_value),b8(l.light_effect_post_cycle_status),b8(l.layer_execution_parameter)];
}
function layerTrailer(l:Record<string,unknown>):number[]{
  const exec=()=>b8(l.execution_parameter??l.is_lights_move_with_people);
  switch(b8(l.current_layer_type)){
    case 0:return [b8(l.color_pick_mode),b8(l.gradient_value),b8(l.flow_direction),b8(l.direction_change_mode),b8(l.length_range),b8(l.color_fill_mode),b8(l.insert_block_mode),...range2(l.insert_block_range),b8(l.insert_black_block_mode),...range2(l.insert_black_block_range),b8(l.brightness_variation_type),...range2(l.brightness_range),b8(l.light_effect_cycle_method),exec()];
    case 1:return [b8(l.brightness_value),b8(l.display_mode),b8(l.color_quantity_range),b8(l.transition_mode),b8(l.unit_transition_duration),b8(l.color_switch_mode),b8(l.switch_count),b8(l.color_pick_sequence),0,b8(l.execution_parameter)];
    case 2:return [b8(l.brightness_variation_type),...range2(l.brightness_range),b8(l.blink_cycle_count),b8(l.blink_position_mode),...range2(l.blink_interval),b8(l.blink_quantity),b8(l.blink_asynchrony),b8(l.blink_color_switch_mode),b8(l.light_effect_cycle_method),exec()];
    default:throw new Error("Factory preset has an unknown layer type");
  }
}
function layerBlob(model:string,l:Record<string,unknown>):Uint8Array{
  const colors=String(l.colors??"").split("|").filter(Boolean);
  if(!colors.length)throw new Error("Factory preset layer has no colors");
  const blocks=colors.map(c=>model.toUpperCase()==="T8L02"?rgbcw(c):rgb4(c));
  return concat(new Uint8Array(layerHeader(l)),new Uint8Array([0,b8(l.current_layer_type),colors.length&255]),...blocks,new Uint8Array(layerTrailer(l)));
}

export function buildFactoryFields(model:string,preset:Pick<EufyFactoryPreset,"lightId"|"speed"|"layerExecutionMode"|"layers">):Uint8Array{
  if(!preset.layers.length)throw new Error("Factory preset has no serializable layers");
  const fields:Uint8Array[]=[
    tlv(0xa3,le32(preset.lightId)),
    tlv(0xa4,new Uint8Array([b8(preset.speed)])),
    tlv(0xa5,new Uint8Array([preset.layers.length&255])),
    tlv(0xa6,new Uint8Array([b8(preset.layerExecutionMode)])),
    tlv(0xa8,new Uint8Array([0]))
  ];
  preset.layers.forEach((l,i)=>{
    if(0xa9+i>0xff)throw new Error("Too many factory preset layers");
    fields.push(tlv(0xa9+i,layerBlob(model,l)));
  });
  return concat(...fields);
}

export function canBuildFactoryFields(model:string,preset:Pick<EufyFactoryPreset,"lightId"|"speed"|"layerExecutionMode"|"layers">):boolean{
  try{buildFactoryFields(model,preset);return true;}catch{return false;}
}
