import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const content=file=>fs.readFileSync(new URL(file,root),'utf8');
const remote=content('curtain_remote.js');
const app=content('../JasonHome2Android/src/com/jasonhome2/app/MainActivity.java');
const page=content('curtain.js');
const slot=content('curtain_native_slot.js');
const html=content('curtain_native_test.html');

function harness(command){
 const requests=[],status={textContent:''},window={};
 const head=remote.slice(0,remote.indexOf('\n let since=0'));
 assert.ok(head.includes('window.JH2OracleCurtainCall=async'));
 const context={
  window,location:{pathname:'/jason-home-2/'},
  crypto:{randomUUID:()=> 'integration-apk-rpc-test'},
  document:{getElementById:()=>status},
  fetch:async(path,params={})=>{
   requests.push({path,method:params.method,body:params.body});
   return {ok:true,json:async()=>path.endsWith('/call')?{commandId:14930}:{command:{id:14930,...command}}};
  },
  setTimeout:fn=>{fn();return 0;},
  atob:value=>Buffer.from(value,'base64').toString('binary'),
  Uint8Array,Blob,URL,
  console
 };
 vm.runInNewContext(head+'\n})();',context);
 return {call:window.JH2OracleCurtainCall,requests,status};
}

test('the Android APK hosts the Oracle WebView rather than directly uploading over phone BLE',()=>{
 assert.match(app,/private static final String URL = "https:\/\/150\.136\.245\.51\/jason-home-2\/"/);
 assert.match(app,/web\.loadUrl\(URL\)/);
 assert.match(remote,/window\.JH2_ORACLE_CURTAIN=true/);
 assert.match(page,/if\(window\.JH2OracleCurtainCall\)return window\.JH2OracleCurtainCall\(action,data\)/);
 assert.match(page,/jh2-curtain-request/);
 assert.match(html,/N\.smartDawnUpload\(eff,/);
 assert.match(slot,/rpc\('nativeSlotUpload',\{sha256:asset\.sha256\}\)/);
 assert.match(slot,/oracleApi\('\/api\/curtain\/assets',\{nativeEff:b64\(data\)/);
});

test('APK WebView passes native upload digest to the correct Oracle queue and preserves confirmed ACK',async()=>{
 const t=harness({state:'applied',result:{ok:true,bleTransmitted:true,message:'Native saved, test accepted'}});
 const reply=await t.call('nativeSlotUpload',{sha256:'a'.repeat(64)});
 assert.equal(reply.commandId,14930);
 assert.equal(reply.bleTransmitted,true);
 assert.equal(t.requests[0].path,'/jason-home-2/api/curtain/call');
 assert.equal(JSON.parse(t.requests[0].body).action,'nativeSlotUpload');
 assert.equal(JSON.parse(t.requests[0].body).payload.sha256,'a'.repeat(64));
 assert.ok(t.requests[1].path.endsWith('/api/curtain/command?id=14930'));
});

test('APK WebView surfaces the exact controller response rather than generic error',async()=>{
 const t=harness({state:'failed',result:{ok:false,bleTransmitted:false,message:'Controller native 2934 rejected rcode=251'}});
 await assert.rejects(t.call('nativeSlotUpload',{sha256:'b'.repeat(64)}),/2934 rejected rcode=251/);
});
test('APK WebView never reports native upload success without BLE acceptance',async()=>{
 const t=harness({state:'applied',result:{ok:true,bleTransmitted:false,message:'Controller did not accept native bytes'}});
 await assert.rejects(t.call('nativeSlotUpload',{sha256:'c'.repeat(64)}),/did not accept native bytes/);
});
