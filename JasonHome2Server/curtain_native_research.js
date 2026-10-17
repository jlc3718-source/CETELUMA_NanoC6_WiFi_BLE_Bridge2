/* Experimental SuperPix DNMX 40x40 frame container. Research only until hardware test succeeds.
   Shape follows recovered SuperPix 4.4.1 preview.js and Ghost Motion Lab v16.
   Does not alter any existing production 4 KB DN1FE uploader. */
(function(root){'use strict';
const CID=83928,W=40,H=40,MAX_FRAMES=24,STRIDE=W*H*3,FRAME_SIZE=500;
const fail=message=>{throw Error(message)};
function normalizeFrame(frame){
 const a=frame?.data||frame;
 if(!a||!Number.isInteger(a.length)||![STRIDE,W*H*4].includes(a.length))fail('Each test frame must be exactly 40×40 RGB or RGBA');
 const rgb=new Uint8Array(STRIDE);
 if(a.length===STRIDE){rgb.set(a);return rgb}
 for(let i=0,j=0;i<a.length;i+=4,j+=3){
  const alpha=Number(a[i+3])/255;rgb[j]=Math.round(Number(a[i])*alpha);rgb[j+1]=Math.round(Number(a[i+1])*alpha);rgb[j+2]=Math.round(Number(a[i+2])*alpha);
 }
 return rgb;
}
function inspect(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 if(b.length<8192||String.fromCharCode(...b.slice(0,4))!=='DNMX')fail('Not a DNMX video candidate');
 const d=new DataView(b.buffer,b.byteOffset,b.byteLength);
 const version=b[4],count=b[5],width=d.getUint16(6,true),height=d.getUint16(8,true),stride=d.getUint32(10,true),cid=d.getUint32(14,true);
 const offset=d.getUint32(128,true),rowStride=d.getUint16(132,true),frames=d.getUint16(134,true),paletteType=b[136];
 if(version!==1||count!==1||width!==W||height!==H||stride!==STRIDE||rowStride!==STRIDE||paletteType!==0||offset!==4096)fail('Unexpected DNMX candidate structure');
 if(cid!==CID)fail('Only the reserved CID 83928 is allowed');
 if(frames<2||frames>MAX_FRAMES||b.length!==8192+frames*STRIDE)fail('DNMX frame length/count mismatch');
 if(d.getUint32(offset+5,false)!==STRIDE||d.getUint16(offset+9,false)!==frames||d.getUint16(offset+11,false)!==W||d.getUint16(offset+13,false)!==H)fail('DNMX internal frame header mismatch');
 return {format:'DNMX',cid,width,height,frames,frameBytes:STRIDE,totalBytes:b.length,paletteType,hardwareVerified:false};
}
function encode(frames){
 if(!Array.isArray(frames)||frames.length<2||frames.length>MAX_FRAMES)fail('Choose 2–24 animation frames for the experiment');
 const count=frames.length,b=new Uint8Array(8192+count*STRIDE),d=new DataView(b.buffer);
 b.set([68,78,77,88,1,1],0);
 d.setUint16(6,W,true);d.setUint16(8,H,true);d.setUint32(10,STRIDE,true);d.setUint32(14,CID,true);
 d.setUint32(128,4096,true);d.setUint16(132,STRIDE,true);d.setUint16(134,count,true);
 // paletteType=0: raw RGB888. Research format from manufacturer preview, not proven uploadable.
 d.setUint32(4096+5,STRIDE,false);d.setUint16(4096+9,count,false);
 d.setUint16(4096+11,W,false);d.setUint16(4096+13,H,false);
 b.set(new TextEncoder().encode('JH2 FRAME TEST'),4096+56);
 for(let i=0;i<count;i++)b.set(normalizeFrame(frames[i]),8192+i*STRIDE);
 inspect(b);
 return b;
}
function varint(n){const a=[];do{let c=n%128;n=Math.floor(n/128);if(n)c|=128;a.push(c)}while(n);return a}
function crc8(data){let crc=0;for(const v of data){crc^=v;for(let i=0;i<8;i++)crc=(crc&128)?((crc<<1)^0x97)&255:(crc<<1)&255}return crc}
function wrap(payload,id,total,left,header=false){
 const b=new Uint8Array(payload.length+8);b.set([id,total>>8,total&255,0x11,0xff,left>>8,left&255],0);b.set(payload,8);
 b[7]=crc8(header?b:payload);return b;
}
function planUpload(data){
 const bytes=data instanceof Uint8Array?data:new Uint8Array(data),meta=inspect(bytes);
 const chunks=Math.ceil(bytes.length/FRAME_SIZE),id=12;
 if(chunks>65535)fail('Too many research upload packets');
 const field=(n,v)=>[(n<<3),...varint(v)];
 // Same confirmed packet transport as type 3, experimental video type 0.
 const start=Uint8Array.from([...field(1,id),...field(2,0),...field(3,bytes.length),...field(4,0),...field(5,chunks),...field(6,FRAME_SIZE),...field(7,0),...field(9,CID)]);
 const request=wrap(start,id,chunks,chunks,true);
 const parts=Array.from({length:chunks},(_,i)=>wrap(bytes.slice(i*FRAME_SIZE,(i+1)*FRAME_SIZE),id,chunks,chunks-i-1));
 let restored=0;
 for(let i=0;i<parts.length;i++){
  const p=parts[i],size=p.length-8;
  if(p[0]!==id||p[3]!==0x11||p[4]!==0xff||p[7]!==crc8(p.slice(8))||p[5]*256+p[6]!==chunks-i-1)fail('Research packet framing/CRC mismatch');
  restored+=size;
 }
 if(restored!==bytes.length)fail('Research upload does not reassemble correctly');
 return {request,parts,meta,chunks,bytes:bytes.length,uploadType:0,crcPolynomial:'0x97',firmwareSupportUnverified:true};
}
function sampleFrames(){
 const make=blink=>{
  const a=new Uint8Array(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const i=(y*W+x)*4;let rgb=[0,0,0];
   if(x>=8&&x<=31&&y>=7&&y<=31)rgb=[239,112,8];
   if(x>=12&&x<=17&&y>=16&&y<= (blink?17:20))rgb=[250,250,250];
   if(x>=23&&x<=28&&y>=16&&y<= (blink?17:20))rgb=[250,250,250];
   if(y>=25&&y<=27&&x>=15&&x<=25)rgb=[22,8,2];
   a.set([...rgb,255],i);
  }return a;
 };return [make(false),make(true),make(false),make(true)];
}
root.JH2NativeResearch=Object.freeze({CID,W,H,MAX_FRAMES,encode,inspect,planUpload,sampleFrames,normalizeFrame});
})(typeof window!=='undefined'?window:globalThis);
