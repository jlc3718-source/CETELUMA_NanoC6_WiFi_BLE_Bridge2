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

 // Use the manufacturer's supported Type-3 image MoveEnum.LEFT (3),
 // rather than incorrectly treating eight simultaneous display layers
 // as a video sequence. Assemble eight original poses in one x-scrollable
 // 240x40 native image; all 8 original poses occur in the strip, and none
 // of the user's existing installed CIDs are touched.
 const win={};
 vm.runInNewContext(fs.readFileSync('/app/web/curtain_native_research.js','utf8'),
  {window:win,Uint8Array,Uint8ClampedArray,DataView,TextEncoder,TextDecoder,Math,Date,console});
 const gif=win.JH2NativeResearch.makeRegistrationGif(quantized,Array(8).fill(125));
 const registered=await req('/api/curtain/smartdawn/register-gif',{gif:Buffer.from(gif).toString('base64')});
 const cid=Number(registered.cid);
 if(!Number.isInteger(cid)||cid<=0||[83927,83928,84268,85369,85391,85397].includes(cid))
  throw Error('Manufacturer-assigned CID is invalid or protected');
 const runtimeRequest=await fetch('https://cdn.daniaokeji.com/data/amx/commons/tuwen.amx',
  {signal:AbortSignal.timeout(25000)});
 if(!runtimeRequest.ok)throw Error('Vendor AMX unavailable');
 const runtime=Buffer.from(await runtimeRequest.arrayBuffer());
 if(runtime.length!==180||crypto.createHash('sha256').update(runtime).digest('hex')!==
   '3a63706b7f45c89f9a162d8c63dc8d7ddac23077893e64c6e55344d693e34020')
  throw Error('Manufacturer runtime hash mismatch');
 const W=240,H=40,partW=30;
 const imageIndices=Buffer.alloc((W*H)/2,0);
 const pal16=Array.from({length:16},(_,i)=>palette[i]||[0,0,0]);
 const map=new Map(palette.map((v,i)=>[v.join(','),i]));
 const counts=Array(8).fill(0);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const f=Math.floor(x/partW), fx=x%partW,srcX=Math.min(39,Math.floor((fx-2)*40/26));
  let index=0;
  if(fx>=2&&fx<28){
   const src=4*(y*40+srcX),q=quantized[f];
   index=map.get([q[src],q[src+1],q[src+2]].join(','));
   if(index===undefined)throw Error('Pose palette lookup mismatch');
  }
  const px=y*W+x;
  if((px&1)===0)imageIndices[px>>1]=index<<4;
  else imageIndices[px>>1]|=index;
  if(index)counts[f]++;
 }
 if(counts.some(n=>n<50))throw Error('Source pose unexpectedly blank');
 const duration=32; // seconds; image moves LEFT at vendor image speed 5.
 const options=Buffer.alloc(61);options.set([253,10,0,0],0);
 options.writeUInt16BE(53,4);options[9]=1;
 options.writeUInt32LE(0,10);options.writeUInt32LE(duration,14);
 options[18]=1; // vendor TypeEnum.image
 options[19]=1; // one image resource index
 options[20]=3; // manufacturer MoveEnum.LEFT -> encoded 3
 options[21]=0; // dir
 options[22]=5; // speed
 options[23]=1; // no rainbow
 // Vendor image descriptor header first: [254, 1, height, width,
 // uint16be palette+indexes bytes, resource-id, palette-count].
 const palBytes=Buffer.from(pal16.flat());
 const payloadBytes=palBytes.length+imageIndices.length;
 const imageHeader=Buffer.from([254,1,H,W,payloadBytes>>8,payloadBytes&255,1,16]);
 const resource=Buffer.concat([imageHeader,palBytes,imageIndices]);
 const data=Buffer.concat([options,resource]);
 const vint=n=>{let a=[];do{let k=n&127;n=Math.floor(n/128);a.push(k|(n?128:0))}while(n);return Buffer.from(a)};
 const varField=(id,value)=>Buffer.concat([vint(id*8),vint(value)]);
 const strField=(id,value)=>Buffer.concat([vint(id*8+2),vint(value.length),value]);
 const name=Buffer.from('Jack Run Moving Strip');
 const meta=Buffer.concat([
  varField(1,0),strField(2,name),strField(3,name),strField(4,Buffer.alloc(0)),
  varField(5,1),varField(6,cid),varField(7,duration*20),
  varField(8,runtime.length),varField(9,data.length),
  strField(10,Buffer.from([8,0])),strField(12,Buffer.from([0])),varField(13,0)
 ]);
 if(meta.length>246)throw Error('TinyProgram protobuf too large');
 const pages=Math.ceil((256+runtime.length+data.length)/4096);
 const binary=Buffer.alloc(pages*4096);
 binary.set([68,78,1,254]);binary.writeUInt32LE(cid,4);binary[8]=pages;
 meta.copy(binary,10);runtime.copy(binary,256);data.copy(binary,256+runtime.length);
 function crc8(b){let c=0;for(const x of b){c^=x;for(let j=0;j<8;j++)c=(c&128)?((c<<1)^0x97)&255:(c<<1)&255;}return c}
 binary[9]=crc8(binary.subarray(10));
 if(binary.length!==8192||binary[8]!==2||crc8(binary.subarray(10))!==binary[9]||
    binary.readUInt32LE(4)!==cid)throw Error('Native file layout invalid');
 // Every original pose is represented in the scroll strip, with a distinct
 // image region and per-pixel index roundtrip (including black gutters).
 for(let f=0;f<8;f++)for(let x=2;x<28;x++)for(let y=0;y<40;y++){
  const targetX=f*partW+x,pos=y*W+targetX,idx=(pos&1)?imageIndices[pos>>1]&15:imageIndices[pos>>1]>>4;
  const originalX=Math.min(39,Math.floor((x-2)*40/26)),k=(y*40+originalX)*4;
  const p=quantized[f],expected=map.get([p[k],p[k+1],p[k+2]].join(','));
  if(idx!==expected)throw Error('Scroll-strip pixel roundtrip wrong '+f+':'+x+':'+y);
 }
 const sha=crypto.createHash('sha256').update(binary).digest('hex');
 fs.writeFileSync('/tmp/jh2-moving-jack-native-type3-newcid.bin',binary);
 out.registration={cid,gifBytes:gif.length};
 out.motionCandidate={cid,bytes:binary.length,sha256:sha,pages,encoding:'Type3 vendor image move left',
  sourcePoseCount:8,bitmapWidth:W,bitmapHeight:H,paletteCount:8,
  colorPixelCountPerPose:counts,
  imageSpeedSetting:5,imageMoveCode:3,programDurationSeconds:duration,
  originalPosePixelsRoundtripped:true,
  actuallyAnimatedOnPhysicalCurtain:false,
  needsNewCIDUpload:true};
 out.result='VENDOR_NATIVE_IMAGE_SCROLL_OFFLINE_VALID_NO_BLE_WRITE';
}catch(e){out.result='VENDOR_NATIVE_IMAGE_SCROLL_OFFLINE_ERROR';out.error=String(e?.message||e);process.exitCode=1}
finally{
 out.bleWrites=0;out.erases=0;out.firmwareChanges=0;out.physicalInstallationVerified=false;
 console.log('JH2_TYPE3_MOVING_STRIP',JSON.stringify(out));
 fs.writeFileSync('/tmp/jh2-moving-strip-report.json',JSON.stringify(out,null,2));
}
