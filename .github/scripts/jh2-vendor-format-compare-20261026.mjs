// Exact original Jack-o'-Lantern Run -> 40x40 -> vendor registration GIF
// -> vendor AVI converter format comparison; NO BLE controller write.
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


 // Manufacturer-converter trial: original eight quantized poses, uncompressed 40x40 AVI.
 const js=fs.readFileSync('/app/web/curtain_native_research.js','utf8');
 const sb={Uint8Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Buffer};
 sb.globalThis=sb;
 vm.runInNewContext(js,sb,{timeout:4000,filename:'curtain_native_research.js'});
 if(!sb.JH2NativeResearch?.makeAvi||!sb.JH2NativeResearch?.inspectAvi)throw Error('Live AVI encoder missing');
 const sample=sb.JH2NativeResearch.makeAvi(quantized,250);
 const validated=sb.JH2NativeResearch.inspectAvi(sample.bytes);
 out.avi={bytes:sample.bytes.length,sha256:crypto.createHash('sha256').update(Buffer.from(sample.bytes)).digest('hex'),frames:validated.frames,delayMs:sample.delayMs};
 const started=await req('/api/curtain/vendor-video/start',{avi:Buffer.from(sample.bytes).toString('base64')});
 out.vendorStart={ok:started.ok,state:started.state,jobId:started.jobId};
 if(!started.jobId)throw Error('Vendor converter did not provide jobId');
 for(let i=0;i<22;i++){
  await new Promise(r=>setTimeout(r,8000));
  const s=await req('/api/curtain/vendor-video/status?id='+encodeURIComponent(started.jobId));
  if(s.state==='ready'){
   const native=Buffer.from(s.eff,'base64');
   out.converted={state:s.state,cid:s.cid,format:s.format,bytes:s.bytes,
    sha256:crypto.createHash('sha256').update(native).digest('hex'),
    headerFirst64Hex:native.subarray(0,64).toString('hex'),
    bytes4096to4128Hex:native.subarray(4096,4128).toString('hex'),
    cidLEat14:native.length>=18?native.readUInt32LE(14):null,
    expectedEightPoses:8,
    effectSavedOnController:false,
    controllerWrites:0};
   break;
  }
  out.vendorPolls=i+1;
 }
 if(!out.converted)out.result='VENDOR_NOT_READY_IN_WINDOW_NO_BLE_WRITE';
 else out.result='VENDOR_FORMAT_CAPTURED_NO_BLE_WRITE';
}catch(e){out.result='VENDOR_TRIAL_FAILED_NO_BLE_WRITE';out.error=String(e?.message||e);process.exitCode=1}
finally{
 out.bleWrites=0;out.erases=0;out.firmwareChanges=0;out.physicalInstallationVerified=false;
 console.log('JH2_VENDOR_FORMAT_DIAGNOSTIC',JSON.stringify(out));
 fs.writeFileSync('/tmp/jh2-2010-vendor-format-diagnostic.json',JSON.stringify(out,null,2));
}
