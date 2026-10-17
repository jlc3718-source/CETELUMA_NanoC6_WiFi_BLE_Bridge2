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
// Standards-compliant uncompressed RGB24 AVI export for the manufacturer
// /upload/video -> /webs/encode/video conversion workflow. NOT a .eff
// and never sent directly to BLE. Preserves 40x40 frames and exact ms timing.
function makeAvi(frames,frameDelayMs=400){
 if(!Array.isArray(frames)||frames.length<2||frames.length>MAX_FRAMES)fail('AVI export requires 2–24 complete animation frames');
 const delay=Number(frameDelayMs);
 if(!Number.isInteger(delay)||delay<100||delay>5000)fail('AVI frame delay must be an integer from 100–5000 ms');
 const count=frames.length,rowStride=Math.ceil(W*3/4)*4,frameSize=rowStride*H;
 const buffer=new ArrayBuffer(1024+count*(frameSize+24)),v=new DataView(buffer);
 let p=0;const offsets=[];
 const fcc=s=>{if(s.length!==4)fail('Bad AVI FourCC');for(let i=0;i<4;i++)v.setUint8(p++,s.charCodeAt(i));};
 const u8=n=>v.setUint8(p++,n&255);
 const u16=n=>{v.setUint16(p,n,true);p+=2;};
 const i16=n=>{v.setInt16(p,n,true);p+=2;};
 const u32=n=>{v.setUint32(p,n>>>0,true);p+=4;};
 const begin=id=>{fcc(id);const at=p;u32(0);return at;};
 const end=at=>{v.setUint32(at,p-at-4,true);if(p&1)u8(0);};
 fcc('RIFF');const riffLenAt=p;u32(0);fcc('AVI ');
 const hdrl=begin('LIST');fcc('hdrl');
 const avih=begin('avih');
 u32(delay*1000);u32(Math.ceil(frameSize*1000/delay));u32(0);u32(0x10);
 u32(count);u32(0);u32(1);u32(frameSize);u32(W);u32(H);
 for(let i=0;i<4;i++)u32(0);end(avih);
 const strl=begin('LIST');fcc('strl');
 const strh=begin('strh');fcc('vids');fcc('DIB ');
 u32(0);u16(0);u16(0);u32(0);
 u32(delay);u32(1000); // exact frame duration as time_base=delay/1000.
 u32(0);u32(count);u32(frameSize);u32(0xffffffff);u32(0);
 i16(0);i16(0);i16(W);i16(H);end(strh);
 const strf=begin('strf');
 u32(40);u32(W);u32(H);u16(1);u16(24);u32(0);u32(frameSize);
 u32(0);u32(0);u32(0);u32(0);end(strf);
 end(strl);end(hdrl);
 const movi=begin('LIST');fcc('movi');const moviTypeAt=p-4;
 for(const frame of frames){
  const rgb=normalizeFrame(frame),start=p,chunk=begin('00db');
  // Positive BITMAPINFOHEADER height means bottom-up BGR scanlines.
  for(let y=H-1;y>=0;y--){
   for(let x=0;x<W;x++){const i=(y*W+x)*3;u8(rgb[i+2]);u8(rgb[i+1]);u8(rgb[i]);}
   for(let i=W*3;i<rowStride;i++)u8(0);
  }
  end(chunk);offsets.push({offset:start-moviTypeAt,length:frameSize});
 }
 end(movi);
 const idx=begin('idx1');
 for(const item of offsets){fcc('00db');u32(0x10);u32(item.offset);u32(item.length);}
 end(idx);v.setUint32(riffLenAt,p-8,true);
 const bytes=new Uint8Array(buffer,0,p);
 if(String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='AVI '||v.getUint32(4,true)!==p-8)fail('AVI container validation failed');
 return {bytes,frames:count,delayMs:delay,seconds:count*delay/1000,width:W,height:H,pixelFormat:'RGB24 / uncompressed DIB',intendedUse:'video source for manufacturer converter; NOT direct controller .eff'};
}
// Strict header and frame-count checks for a controlled raw AVI experiment.
// The manufacturer normally sends a converted .eff instead of raw AVI.
function inspectAvi(data){
 const b=data instanceof Uint8Array?data:new Uint8Array(data);
 if(b.length<256||b.length>8192+MAX_FRAMES*STRIDE)fail('AVI is empty, oversized, or has more than 24 RGB24 frames');
 const str=(i,n=4)=>String.fromCharCode(...b.subarray(i,i+n));
 const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(str(0)!=='RIFF'||str(8)!=='AVI '||dv.getUint32(4,true)+8!==b.length)fail('Invalid AVI RIFF container');
 const find=tag=>{for(let i=12;i+4<=b.length;i++)if(str(i)===tag)return i;return -1};
 const head=find('avih'),stream=find('strh'),bitmap=find('strf'),movi=find('movi'),index=find('idx1');
 if(head<0||stream<0||bitmap<0||movi<0||index<0||!(head<stream&&stream<bitmap&&bitmap<movi&&movi<index))fail('AVI headers/index missing');
 const frames=dv.getUint32(head+24,true),width=dv.getUint32(head+40,true),height=dv.getUint32(head+44,true);
 const bmpWidth=dv.getUint32(bitmap+12,true),bmpHeight=dv.getUint32(bitmap+16,true);
 const codec=str(stream+12),bits=dv.getUint16(bitmap+22,true),compression=dv.getUint32(bitmap+24,true);
 if(codec!=='DIB '||frames<2||frames>MAX_FRAMES||width!==W||height!==H||bmpWidth!==W||bmpHeight!==H||bits!==24||compression!==0)fail('AVI must contain 2–24 uncompressed 40x40 RGB24 frames');
 const frameBytes=Math.ceil(W*3/4)*4*H;
 if(dv.getUint32(index+4,true)!==frames*16)fail('AVI frame index does not match its frame count');
 let chunks=0;
 for(let at=movi+4;at<index;){
  if(str(at)==='00db'){
   if(dv.getUint32(at+4,true)!==frameBytes||at+8+frameBytes>index)fail('AVI video frame length is not 4800 bytes');
   chunks++;at+=8+frameBytes;
  }else if(str(at)==='idx1')break;
  else if(str(at)==='movi')at+=4;
  else if(at+8<=index&&str(at)==='JUNK'){at+=8+dv.getUint32(at+4,true);}
  else {at++;if(at>index)break}
 }
 if(chunks!==frames)fail('AVI container frame count failed verification');
 return {format:'AVI',cid:CID,width,height,frames,frameBytes,totalBytes:b.length,pixelFormat:'RGB24 uncompressed',hardwareVerified:false,rawVideoUploadUnsupportedByManufacturerWorkflow:true};
}
function planAviUpload(data){
 const b=data instanceof Uint8Array?data:new Uint8Array(data);
 const meta=inspectAvi(b);
 const chunks=Math.ceil(b.length/FRAME_SIZE),id=12;
 if(chunks>65535)fail('AVI upload packet count overflow');
 const field=(n,v)=>[(n<<3),...varint(v)];
 // The captured SuperPix upload request declares field 8 = storage path.
 // Test the raw AVI under its actual extension, never misrepresent it as .eff.
 const path='83928.avi',pathBytes=new TextEncoder().encode(path);
 const start=Uint8Array.from([...field(1,id),...field(2,0),...field(3,b.length),...field(4,0),...field(5,chunks),...field(6,FRAME_SIZE),...field(7,0),(8<<3)|2,...varint(pathBytes.length),...pathBytes,...field(9,CID)]);
 const request=wrap(start,id,chunks,chunks,true);
 const parts=Array.from({length:chunks},(_,i)=>wrap(b.slice(i*FRAME_SIZE,(i+1)*FRAME_SIZE),id,chunks,chunks-i-1));
 let at=0;
 for(let i=0;i<chunks;i++){
  const p=parts[i],payload=p.slice(8);
  if(p[7]!==crc8(payload)||p[5]*256+p[6]!==chunks-i-1)fail('AVI packet integrity check failed');
  for(let j=0;j<payload.length;j++)if(payload[j]!==b[at++])fail('AVI reassembled bytes differ');
 }
 if(at!==b.length)fail('AVI packet byte count mismatch');
 return {request,parts,meta,chunks,bytes:b.length,uploadType:0,path,experimentalRawAvi:true};
}
// SmartDawn 1.2.4 EffectLocalMaker-compatible local video encoder.
// Reverse engineered from bundled assets/HTML/assets/index-CL_jUmAY.js:
// startExec => DNMX v3 + directory, writeItemHeader => DNX2 v3,
// encode => X-major / Y-minor RGB888, 4096 byte final alignment.
// No cloud connection, video transcription or new controller CID allocation.
function readAviFrames(data){
 const b=data instanceof Uint8Array?data:new Uint8Array(data),meta=inspectAvi(b);
 const str=(at,n=4)=>String.fromCharCode(...b.subarray(at,at+n));
 const dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
 let movi=-1,stop=-1;
 // Traverse RIFF chunks and LISTs; do not hunt arbitrary pixel bytes for FourCCs.
 for(let at=12;at+8<=b.length;){
  const id=str(at),size=dv.getUint32(at+4,true),end=at+8+size;
  if(end>b.length)fail('AVI RIFF chunk crosses file boundary');
  if(id==='LIST'&&str(at+8)==='movi'){movi=at+12;stop=end;break;}
  at=end+(size&1);
 }
 if(movi<0||stop<0)fail('AVI has no video frames');
 const frames=[],rowSize=Math.ceil(W*3/4)*4,frameSize=rowSize*H;
 for(let at=movi;at+8<=stop;){
  const id=str(at),size=dv.getUint32(at+4,true);
  if(at+8+size>stop)fail('AVI frame exceeds movi chunk');
  if(id==='00db'){
   if(size!==frameSize)fail('AVI frame payload mismatch');
   const rgba=new Uint8Array(W*H*4),start=at+8;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const input=start+(H-1-y)*rowSize+x*3,output=(y*W+x)*4;
    rgba[output]=b[input+2];rgba[output+1]=b[input+1];rgba[output+2]=b[input];rgba[output+3]=255;
   }
   frames.push(rgba);
  }
  at+=8+size+(size&1);
 }
 if(frames.length!==meta.frames)fail('AVI decoded frame count differs from header');
 return frames;
}
function inspectSmartDawnEff(data){
 const b=data instanceof Uint8Array?data:new Uint8Array(data);
 if(b.length<8192||b.length%4096!==0||b.length>1048576)fail('SmartDawn native effect requires 4096-byte alignment');
 const name=(at,n)=>String.fromCharCode(...b.subarray(at,at+n)),d=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(name(0,4)!=='DNMX'||b[4]!==3||b[5]!==1||name(4096,4)!=='DNX2'||b[4100]!==3)fail('Not a SmartDawn DNMX v3 / DNX2 v3 file');
 const cid=d.getUint32(14,true),width=d.getUint16(6,true),height=d.getUint16(8,true),stride=d.getUint32(10,true);
 const offset=d.getUint32(128,true),entryStride=d.getUint16(132,true),count=d.getUint16(134,true);
 const itemStride=d.getUint32(4096+5,true),itemCount=d.getUint32(4096+9,true),itemWidth=d.getUint16(4096+13,true),itemHeight=d.getUint16(4096+15,true);
 if(cid!==CID||width!==W||height!==H||stride!==STRIDE||offset!==4096||entryStride!==STRIDE||itemStride!==STRIDE||itemWidth!==W||itemHeight!==H)
  fail('SmartDawn native file CID, directory or dimensions do not match reserved 40x40 test');
 if(count<2||count>MAX_FRAMES||itemCount!==count||b[136]!==0||b[138]!==1||b[4096+157]!==1||b[4096+158]!==20)
  fail('SmartDawn native v3 frame count or effect flags mismatch');
 const used=8192+count*STRIDE,expected=Math.ceil(used/4096)*4096;
 if(b.length!==expected)fail('SmartDawn native frame data or end padding mismatch');
 for(let i=used;i<expected;i++)if(b[i]!==0)fail('Native effect has nonzero padding');
 return {format:'DNMX',version:3,itemHeader:'DNX2',itemVersion:3,cid,width,height,frames:count,frameBytes:STRIDE,pixels:'column-major RGB888',bytes:b.length,hardwareVerified:false};
}
function encodeSmartDawn(frames,{cid=CID,name='JH2 NATIVE TEST',timestamp=0}={}){
 if(cid!==CID)fail('Only disposable reserved CID 83928 can be encoded');
 if(!Array.isArray(frames)||frames.length<2||frames.length>MAX_FRAMES)fail('SmartDawn encoder requires 2–24 video frames');
 if(!Number.isInteger(timestamp)||timestamp<0||timestamp>0xffffffff)fail('Invalid native timestamp');
 const count=frames.length,used=8192+count*STRIDE,b=new Uint8Array(Math.ceil(used/4096)*4096),d=new DataView(b.buffer);
 b.set([68,78,77,88,3,1]);  // DNMX, version 3, one effect
 d.setUint16(6,W,true);d.setUint16(8,H,true);d.setUint32(10,STRIDE,true);
 d.setUint32(14,CID,true);d.setUint32(18,timestamp,true);
 const title=new TextEncoder().encode(String(name));b.set(title.subarray(0,24),38);
 b[124]=20;
 d.setUint32(128,4096,true);d.setUint16(132,STRIDE,true);d.setUint16(134,count,true);
 b[136]=0;b[137]=0;b[138]=1;b[141]=0;
 b.set([68,78,88,50,3],4096);   // DNX2 item, version 3
 d.setUint32(4101,STRIDE,true);d.setUint32(4105,count,true);
 d.setUint16(4109,W,true);d.setUint16(4111,H,true);
 b.set(title.subarray(0,32),4096+56);b[4096+157]=1;b[4096+158]=20;
 for(let n=0;n<count;n++){
  const frame=frames[n]?.data||frames[n];
  if(!frame||frame.length!==W*H*4)fail('SmartDawn encoder expects exact 40x40 RGBA frames');
  let dst=8192+n*STRIDE;
  // The manufacturer's encoder runs x outer / y inner, *not* usual row-major.
  for(let x=0;x<W;x++)for(let y=0;y<H;y++){
   const at=(x+y*W)*4,alpha=Number(frame[at+3])/255;
   b[dst++]=Math.round(frame[at]*alpha);
   b[dst++]=Math.round(frame[at+1]*alpha);
   b[dst++]=Math.round(frame[at+2]*alpha);
  }
 }
 inspectSmartDawnEff(b);
 return b;
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
root.JH2NativeResearch=Object.freeze({CID,W,H,MAX_FRAMES,encode,inspect,planUpload,sampleFrames,normalizeFrame,makeAvi,inspectAvi,planAviUpload,readAviFrames,encodeSmartDawn,inspectSmartDawnEff});
})(typeof window!=='undefined'?window:globalThis);
