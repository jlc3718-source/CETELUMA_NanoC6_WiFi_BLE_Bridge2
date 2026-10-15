(function(root){
"use strict";
// Inspect image magic bytes, not filenames or Android's sometimes incorrect MIME labels.
// Only the first 1MB is read, even for very large phone photos.
function sniff(data){
 const a=data instanceof Uint8Array?data:new Uint8Array(data);
 const be=(i)=>((a[i]<<8)|a[i+1])>>>0;
 const le=(i)=>((a[i])|(a[i+1]<<8))>>>0;
 if(a.length>=24 && a[0]===137 && a[1]===80 && a[2]===78 && a[3]===71 &&
    a[4]===13 && a[5]===10 && a[6]===26 && a[7]===10){
  const width=((a[16]<<24)|(a[17]<<16)|(a[18]<<8)|a[19])>>>0;
  const height=((a[20]<<24)|(a[21]<<16)|(a[22]<<8)|a[23])>>>0;
  if(width&&height)return {width,height,mime:'image/png'};
 }
 if(a.length>=10 && a[0]===71 && a[1]===73 && a[2]===70 && a[3]===56 &&
    a[4]===55 || a.length>=10 && a[0]===71 && a[1]===73 && a[2]===70 && a[3]===56 && a[4]===57){
  const width=le(6),height=le(8);if(width&&height)return {width,height,mime:'image/gif'};
 }
 if(a.length>=4 && a[0]===255 && a[1]===216){
  let at=2;
  while(at+9<a.length){
   if(a[at]!==255){at++;continue;}
   let marker=a[at+1];at+=2;
   if(marker===255)continue;
   if(marker===216||marker===217||marker===1||(marker>=208&&marker<=215))continue;
   if(at+2>a.length)break;
   const seg=be(at);
   if(seg<2||at+seg>a.length)break;
   if([192,193,194,195,198,199,201,202,203,205,206,207].includes(marker) && seg>=7){
    const height=be(at+3),width=be(at+5);
    if(width&&height)return {width,height,mime:'image/jpeg'};
   }
   at+=seg;
  }
 }
 if(a.length>=30 && String.fromCharCode(...a.slice(0,4))==='RIFF' &&
    String.fromCharCode(...a.slice(8,12))==='WEBP'){
  const fourcc=String.fromCharCode(...a.slice(12,16));
  if(fourcc==='VP8X'){
   const width=1+a[24]+(a[25]<<8)+(a[26]<<16),height=1+a[27]+(a[28]<<8)+(a[29]<<16);
   if(width&&height)return {width,height,mime:'image/webp'};
  }
  if(fourcc==='VP8L'&&a[20]===47){
   const width=1+(((a[22]&63)<<8)|a[21]);
   const height=1+(((a[24]&15)<<10)|(a[23]<<2)|((a[22]&192)>>6));
   if(width&&height)return {width,height,mime:'image/webp'};
  }
  if(fourcc==='VP8 '&&a[23]===157&&a[24]===1&&a[25]===42){
   const width=le(26)&0x3fff,height=le(28)&0x3fff;
   if(width&&height)return {width,height,mime:'image/webp'};
  }
 }
 return null;
}
async function dimensions(file){
 const bytes=new Uint8Array(await file.slice(0,Math.min(file.size,1048576)).arrayBuffer());
 return sniff(bytes);
}
const api={sniff,dimensions};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.CurtainImageHeaders=api;
})(typeof window!=='undefined'?window:globalThis);
