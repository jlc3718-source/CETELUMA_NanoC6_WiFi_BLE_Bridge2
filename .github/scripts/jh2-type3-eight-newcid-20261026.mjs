// Exact original Jack-o'-Lantern Run -> 40x40 -> vendor registration GIF
// -> NEW Type-3 AMX multi-image timed native effect; offline validation only.
// NO controller command: no BLE writes, erases, OTA, play or reboot.
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
const base='http://127.0.0.1:8081', sourceId='jacklanternanimated-8e3f74948a71e03508d7eaea';
const out={at:new Date().toISOString(),sourceId,sourceFrames:8,bleWrites:0,erases:0,firmwareChanges:0,physicalInstallationVerified:false};
let cookie='';
async function req(path,body){
 const headers={'content-type':'application/json',...(cookie?{cookie}:{})};
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,
  body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path.includes('register-gif')?95000:25000)});
 if(path==='/api/session')cookie=(response.headers.get('set-cookie')||'').split(';')[0];
 const text=await response.text();
 let data;try{data=JSON.parse(text)}catch{throw Error('Unexpected Oracle response '+response.status+' for '+path)}
 if(!response.ok||data.ok===false)throw Error((data.error||response.status)+' at '+path);
 return data;
}
function decodePng(bytes){
 const b=Buffer.from(bytes);
 if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Not original PNG');
 let p=8,w=0,h=0,bit=0,kind=0;const idats=[];
 while(p+12<=b.length){
  const n=b.readUInt32BE(p),tag=b.toString('ascii',p+4,p+8);
  if(p+12+n>b.length)throw Error('PNG chunk length invalid');
  const block=b.subarray(p+8,p+8+n);
  if(tag==='IHDR'){w=block.readUInt32BE(0);h=block.readUInt32BE(4);bit=block[8];kind=block[9];}
  if(tag==='IDAT')idats.push(block);
  p+=12+n;if(tag==='IEND')break;
 }
 if(w<40||h<40||w>4096||h>4096||bit!==8||kind!==6||idats.length===0)throw Error('Unsupported original PNG frame');
 const compressed=zlib.inflateSync(Buffer.concat(idats)),stride=w*4;
 if(compressed.length!==h*(stride+1))throw Error('PNG scanline count invalid');
 const rgba=Buffer.alloc(h*stride);
 let at=0;
 for(let y=0;y<h;y++){
  const filter=compressed[at++];
  if(filter>4)throw Error('Unsupported PNG filter');
  for(let x=0;x<stride;x++){
   const sample=compressed[at++];
   const left=x>=4?rgba[y*stride+x-4]:0;
   const up=y?rgba[(y-1)*stride+x]:0;
   const aboveLeft=y&&x>=4?rgba[(y-1)*stride+x-4]:0;
   let correction=0;
   if(filter===1)correction=left;
   if(filter===2)correction=up;
   if(filter===3)correction=Math.floor((left+up)/2);
   if(filter===4){
    const predictor=left+up-aboveLeft;
    const a=Math.abs(predictor-left),c=Math.abs(predictor-up),d=Math.abs(predictor-aboveLeft);
    correction=a<=c&&a<=d?left:c<=d?up:aboveLeft;
   }
   rgba[y*stride+x]=(sample+correction)&255;
  }
 }
 // Match Chromium ctx.fillRect(black), imageSmoothingEnabled=false, drawImage.
 const tiny=new Uint8Array(40*40*4);
 for(let y=0;y<40;y++)for(let x=0;x<40;x++){
  const px=Math.min(w-1,Math.floor((x+.5)*w/40)),py=Math.min(h-1,Math.floor((y+.5)*h/40));
  const src=(py*w+px)*4,dst=(y*40+x)*4,alpha=rgba[src+3]/255;
  tiny[dst]=Math.round(rgba[src]*alpha);
  tiny[dst+1]=Math.round(rgba[src+1]*alpha);
  tiny[dst+2]=Math.round(rgba[src+2]*alpha);
  tiny[dst+3]=255;
 }
 return {tiny,w,h};
}
try{
 if(!process.env.JH2_TEST_TOKEN)throw Error('Oracle session token not provided by running service');
 await req('/api/session',{token:process.env.JH2_TEST_TOKEN});
 const before=await req('/api/curtain/status');
 if(before.firmware!=='2.0.10'||before.online!==true||before.curtain?.connected!==true)
  throw Error('Nano 2.0.10 live/connected preflight failed');
 const frames=[];
 for(let i=0;i<8;i++){
  const rsp=await fetch(base+'/api/curtain/internet-art/gif?id='+sourceId+'&frame='+i,
    {headers:{cookie},signal:AbortSignal.timeout(30000)});
  if(!rsp.ok)throw Error('Original PNG frame '+i+' GET '+rsp.status);
  const img=decodePng(await rsp.arrayBuffer());
  if(img.w!==579||img.h!==763)throw Error('Original artwork dimensions changed');
  frames.push(img.tiny);
 }
 // Match the original Internet Art global 8-color quantizer, across ALL frames.
 const freq=new Map();
 for(const frame of frames)for(let i=0;i<6400;i+=4){
  const rr=frame[i],gg=frame[i+1],bb=frame[i+2];
  if(Math.max(rr,gg,bb)<35)continue;
  const key=[rr>>4,gg>>4,bb>>4].join(',');
  const v=freq.get(key)||{r:0,g:0,b:0,n:0};
  v.r+=rr;v.g+=gg;v.b+=bb;v.n++;freq.set(key,v);
 }
 const palette=[[0,0,0],...[...freq.values()].sort((a,b)=>b.n-a.n).slice(0,7)
  .map(v=>[Math.round(v.r/v.n),Math.round(v.g/v.n),Math.round(v.b/v.n)])];
 const quantized=frames.map(frame=>{
  const copy=Uint8Array.from(frame);
  for(let i=0;i<6400;i+=4){
   let best=0,minimum=Infinity;
   if(Math.max(frame[i],frame[i+1],frame[i+2])>=35)
    for(let n=1;n<palette.length;n++){
     const col=palette[n],delta=2*(frame[i]-col[0])**2+
      3*(frame[i+1]-col[1])**2+2*(frame[i+2]-col[2])**2;
     if(delta<minimum){minimum=delta;best=n}
    }
   copy.set([...palette[best],255],i);
  }
  return copy;
 });


 // Genuine vendor Type-3 "TinyProgram": 8 independent image resources + timed
 // options. 1 second minimum per image is a research assumption, not a verified
 // on-controller animation; NO upload/erase/controller command here.
 const periodSeconds=1, nFrames=8;
 // Allocate one manufacturer-owned CID from the original eight-frame
 // registration GIF, without touching the live controller.
 const win={};
 vm.runInNewContext(fs.readFileSync('/app/web/curtain_native_research.js','utf8'),
  {window:win,Uint8Array,Uint8ClampedArray,DataView,TextEncoder,TextDecoder,Math,Date,console});
 const gif=win.JH2NativeResearch.makeRegistrationGif(quantized,Array(8).fill(125));
 const registration=await req('/api/curtain/smartdawn/register-gif',
  {gif:Buffer.from(gif).toString('base64')});
 const cid=Number(registration.cid);
 if(!Number.isInteger(cid)||cid<=0||[83928,84268,85369,85391].includes(cid))
  throw Error('Manufacturer allocated an occupied or unsafe CID');
 out.registration={cid,gifBytes:gif.length,sourceFrames:8};

 const rtResp=await fetch('https://cdn.daniaokeji.com/data/amx/commons/tuwen.amx',{signal:AbortSignal.timeout(25000)});
 if(!rtResp.ok)throw Error('Manufacturer AMX download HTTP '+rtResp.status);
 const runtime=Buffer.from(await rtResp.arrayBuffer());
 if(runtime.length!==180||crypto.createHash('sha256').update(runtime).digest('hex')!=='3a63706b7f45c89f9a162d8c63dc8d7ddac23077893e64c6e55344d693e34020')
  throw Error('Manufacturer runtime identity mismatch');
 const vi=n=>{const a=[];do{let b=n&127;n=Math.floor(n/128);a.push(n?b|128:b);}while(n);return Buffer.from(a)};
 const proto=Buffer.concat([
   Buffer.from([0x08,0]),Buffer.from([0x12]),vi(27),Buffer.from('Jack Run Eight Native Poses'),
   Buffer.from([0x1a]),vi(25),Buffer.from('Jack Run Eight Native Poses'),
   Buffer.from([0x22,0,0x28,1,0x30]),vi(cid),
   Buffer.from([0x38]),vi(nFrames*periodSeconds*20),
   Buffer.from([0x40]),vi(runtime.length),
   Buffer.from([0x48]),vi(0), // rewritten with final data byte count below
   Buffer.from([0x52,2,8,0,0x62,1,0,0x68,0])
 ]);
 const label=Buffer.from('Jack Run Eight Native Poses');
 if(label.length!==27)throw Error('Header label size assumption invalid '+label.length);
 // Global 8-color palette, padded to 16 vendor palette entries.
 const palette16=Array.from({length:16},(_,i)=>palette[i]||[0,0,0]);
 const optionHeader=Buffer.alloc(10+51*nFrames);
 optionHeader.set([253,10,0,0],0);
 optionHeader.writeUInt16BE(2+51*nFrames,4);
 optionHeader[9]=nFrames;
 const images=[];
 for(let f=0;f<nFrames;f++){
  const p=10+f*51, start=f*periodSeconds;
  optionHeader.writeUInt32LE(start,p);
  optionHeader.writeUInt32LE(periodSeconds,p+4);
  optionHeader[p+8]=1; // TypeEnum.image
  optionHeader[p+9]=f+1; // image resource id
  optionHeader[p+10]=0; optionHeader[p+11]=0;
  optionHeader[p+12]=5; optionHeader[p+13]=1;
  const rgb=Buffer.from(palette16.flat());
  const pixels=Buffer.alloc(800);
  const q=quantized[f], indexMap=new Map(palette.map((c,i)=>[c.join(','),i]));
  for(let px=0;px<1600;px++){
   const id=indexMap.get([q[px*4],q[px*4+1],q[px*4+2]].join(','));
   if(id===undefined||id<0||id>15)throw Error('Invalid exact-frame palette index');
   if(px%2===0)pixels[px>>1]=id<<4;else pixels[px>>1]|=id;
  }
  const resource=Buffer.alloc(8);
  resource.set([254,1,40,40],0);
  resource.writeUInt16BE(rgb.length+pixels.length,4);
  resource[6]=f+1;resource[7]=16;
  images.push(Buffer.concat([resource,rgb,pixels]));
 }
 const data=Buffer.concat([optionHeader,...images]);
 // Full explicit TinyProgram protobuf, preserving genuine app field order.
 const field=(id,num)=>Buffer.concat([vi(id<<3),vi(num)]);
 const len=(id,str)=>Buffer.concat([vi((id<<3)|2),vi(str.length),str]);
 const meta=Buffer.concat([field(1,0),len(2,label),len(3,label),len(4,Buffer.alloc(0)),
  field(5,1),field(6,cid),field(7,nFrames*periodSeconds*20),
  field(8,runtime.length),field(9,data.length),len(10,Buffer.from([8,0])),
  len(12,Buffer.from([0])),field(13,0)]);
 if(meta.length>246)throw Error('Too many metadata bytes');
 const pages=Math.ceil((256+runtime.length+data.length)/4096);
 const native=Buffer.alloc(4096*pages);
 native.set([68,78,1,254],0);native.writeUInt32LE(cid,4);native[8]=pages;
 meta.copy(native,10);runtime.copy(native,256);data.copy(native,256+runtime.length);
 function crc8(a){let c=0;for(const b of a){c^=b;for(let k=0;k<8;k++)c=c&128?((c<<1)^0x97)&255:(c<<1)&255;}return c;}
 native[9]=crc8(native.subarray(10));
 if(native.readUInt32LE(4)!==cid||native[8]!==pages||crc8(native.subarray(10))!==native[9])throw Error('Native header checksum/cid invalid');
 // Round-trip all 8 40x40 indexed images, exact expected palette, IDs, start/duration.
 for(let f=0;f<nFrames;f++){
  const opt=10+f*51;
  if(optionHeader.readUInt32LE(opt)!==f||optionHeader.readUInt32LE(opt+4)!==1||optionHeader[opt+8]!==1||optionHeader[opt+9]!==f+1)
   throw Error('Option schedule corrupt');
  const resource=images[f],indices=resource.subarray(56),q=quantized[f];
  if(resource[2]!==40||resource[3]!==40||resource[6]!==f+1||resource[7]!==16||indices.length!==800)
   throw Error('Image header invalid');
  for(let px=0;px<1600;px++){
   const idx=(px&1)?(indices[px>>1]&15):(indices[px>>1]>>4);
   const color=palette16[idx],off=px*4;
   if(color[0]!==q[off]||color[1]!==q[off+1]||color[2]!==q[off+2])throw Error('Frame pixel mismatch '+f+':'+px);
  }
 }
 fs.writeFileSync('/tmp/jh2-type3-jack-eight-newcid-OFFLINE.bin',native);
 out.candidate={cid,nativeType:3,format:'DN1FE',originalFrames:8,pages,totalBytes:native.length,
  headerBytes:256,runtimeBytes:runtime.length,dataBytes:data.length,options:8,
  imageResources:images.length,perFrameSize:images[0].length,crc8:native[9],
  sha256:crypto.createHash('sha256').update(native).digest('hex'),
  optionSeconds:periodSeconds,loopAutonomouslyUnproven:true,
  originalPixelsRoundtripped:true,manufacturerRuntimeVerified:true};
 out.result='OFFLINE_EIGHT_IMAGE_TYPE3_VALIDATED_NO_BLE_UPLOAD';
}catch(e){out.result='OFFLINE_TYPE3_FAILED';out.error=String(e?.message||e);process.exitCode=1}
finally{out.bleWrites=0;out.erases=0;out.firmwareChanges=0;out.physicalInstallationVerified=false;
 console.log('JH2_TYPE3_EIGHT_NEW_CID_CANDIDATE',JSON.stringify(out));
 fs.writeFileSync('/tmp/jh2-type3-eight-image-newcid-report.json',JSON.stringify(out,null,2));
}
