'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const path=require('node:path');
const base=process.env.EUFY_TEST_FIXTURE_DIR||path.join(__dirname,'../src');
const clientPath=base.endsWith('/src')?path.join(base,'eufy/client.ts'):path.join(base,'client.ts');
const serverPath=path.join(base,'server.ts');
let clientJS=stripTypeScriptTypes(fs.readFileSync(clientPath,'utf8'),{mode:'transform'});
let serverJS=stripTypeScriptTypes(fs.readFileSync(serverPath,'utf8'),{mode:'transform'});
clientJS=clientJS.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
function extract(src,head){
  const start=src.indexOf(head);assert(start>=0,'missing '+head);
  const open=src.indexOf('{',start);let depth=0;
  for(let i=open;i<src.length;i++){
    if(src[i]==='{')depth++;
    if(src[i]==='}'&&--depth===0)return src.slice(start,i+1);
  }
  throw Error('Unclosed '+head);
}
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9aV1LXAAAAABJRU5ErkJggg==';
const fakeCrypto={
  aesDecryptText:(x)=>x,aesEncryptText:x=>x,
  encryptPassword:()=>({cipherText:'MOCK_ENCRYPTED',publicKey:'MOCK_PUBLIC'}),
  md5:()=> 'mockhash',newEcdh:()=>({publicHex:'MOCK_PUBLIC',secret:()=>Buffer.from('abcdefghijklmnop')}),
  randomId:()=> 'fixed-test-id',sign:()=> 'signed-in-memory',LOCAL_KEY_HEX:'FAKE_LOCAL_KEY',
};
const clientCtx=vm.createContext({...fakeCrypto,Buffer,Date,Math,Error,JSON,String,Number,RegExp,Set,Map,AbortController,fetch:()=>{throw Error('REAL NETWORK FORBIDDEN');}});
vm.runInContext(clientJS+'\nthis.TestClient=EufyClient;this.Captcha=EufyCaptchaRequired;this.Email=EufyEmailCodeRequired;',clientCtx);
const Client=clientCtx.TestClient;
let checks=[];
function ok(label,fn){fn();checks.push(label);}
async function run(){
  const session={region:'us-pr',bootstrap:'',token:'mock-token',uid:'uid',accountUid:'account',
    share:'abcdefabcdefabcdefabcdefabcdefab',ident:'key-1',keyCreatedAt:Date.now(),
    tokenExpiresAt:Math.floor(Date.now()/1000)+3600,openudid:'fixture-id'};
  const restored=new Client('fixture-id',session);
  ok('Restored token and negotiated key without network',()=>{
    assert.equal(restored.authed,true);assert.equal(restored.share,session.share);assert.equal(restored.ident,session.ident);
  });
  ok('Session round-trip includes stable identity and key expiration',()=>{
    const copy=restored.exportSession();assert.equal(copy.openudid,'fixture-id');assert.equal(copy.keyCreatedAt,session.keyCreatedAt);
  });
  ok('Expired token not considered authenticated',()=>{
    const c=new Client('fixture-id',{...session,tokenExpiresAt:Math.floor(Date.now()/1000)-120});assert.equal(c.authed,false);
  });
  ok('Different device identity not authorized to reuse token',()=>{
    const c=new Client('another-id',session);assert.equal(c.authed,false);
  });
  ok('Expired negotiated key invalidated while retaining eligible token',()=>{
    const c=new Client('fixture-id',{...session,keyCreatedAt:Date.now()-13*3600_000});
    assert.equal(c.authed,true);assert.equal(c.share,'');
  });
  const cap=new Client('fixture-id');cap.share=session.share;cap.ident='key-1';
  let paths=[];
  cap.raw=async(host,p)=>{paths.push(p);
    if(p==='/passport/login')return{_http:200,code:100032,data:null};
    if(p==='/passport/generate/captcha')return{_http:200,code:0,data:{captcha_id:'cap-id',item:PNG}};
    throw Error('Unexpected mock request: '+p);
  };
  await assert.rejects(cap.signed('passport','/passport/login',{},false),e=>e instanceof clientCtx.Captcha&&e.captchaId==='cap-id'&&e.image===PNG);
  ok('100032 fetches CAPTCHA via separate passport endpoint',()=>assert.deepEqual(paths,['/passport/login','/passport/generate/captcha']));
  const throttled=new Client('fixture-id');throttled.share=session.share;throttled.ident='key-1';
  let calls=0;
  throttled.raw=async(host,p)=>{calls++;return {_http:200,code:100028,msg:'Failed to request'};};
  await assert.rejects(throttled.signed('passport','/passport/login',{},false),/100028/);
  ok('100028 never triggers CAPTCHA fetch or a retry',()=>assert.equal(calls,1));
  const inline=new Client('fixture-id');inline.share=session.share;inline.ident='key-1';
  let inlineCount=0;
  inline.raw=async()=>{inlineCount++;return {_http:200,code:100033,data:{captcha_id:'inline-id',item:PNG}};};
  await assert.rejects(inline.signed('passport','/passport/login',{},false),e=>e instanceof clientCtx.Captcha&&e.captchaId==='inline-id');
  ok('Valid inline challenge avoids unnecessary generation request',()=>assert.equal(inlineCount,1));
  const malformed=new Client('fixture-id');malformed.share=session.share;malformed.ident='key-1';
  malformed.raw=async(host,p)=>p==='/passport/login'?{_http:200,code:100032,data:null}:{_http:200,code:0,data:{captcha_id:'yes',item:'https://unsafe.invalid/img'}};
  await assert.rejects(malformed.signed('passport','/passport/login',{},false),/no usable challenge image/);
  checks.push('Unsafe remote-image challenge rejected');

  const email=new Client('fixture-id');
  let loginRequests=0,codeEmails=0,estimates=0,exchanges=0,limitedAuth=false;
  email.raw=async(host,p,body,headers)=>{
    if(p==='/passport/estimate_domain'){estimates++;return {_http:200,code:0,data:{domain:'app-openapi-us-pr.eufy.com'}};}
    if(p==='/openapi/oauth/key/exchange'){exchanges++;return {_http:200,code:0,data:{server_public_key:'MOCK_SERVER'}};}
    if(p==='/passport/login'){
      loginRequests++;const req=JSON.parse(body);
      if(req.verify_code){
        limitedAuth=headers['x-auth-token']==='limited-token';
        return {_http:200,code:0,data:{ap_cloud_user_id:'cloud-id',user_id:'user-id',auth_token:'full-token',token_expires_at:Math.floor(Date.now()/1000)+7200}};
      }
      return {_http:200,code:0,data:{ap_cloud_user_id:'cloud-id',user_id:'user-id',auth_token:'limited-token',fa_info:{info:'required'}}};
    }
    if(p==='/app/sendmsg/verify_code'){
      codeEmails++;assert.equal(headers['x-auth-token'],'limited-token');return {_http:200,code:0,data:{}};
    }
    throw Error('Unexpected mock path '+p);
  };
  await assert.rejects(email.login('tester@example.invalid','fixture-password'),e=>e instanceof clientCtx.Email);
  ok('Email 2FA sends exactly one code with limited-token authentication',()=>{
    assert.equal(codeEmails,1);assert.equal(email.authed,false);assert.equal(estimates,1);
  });
  await email.login('tester@example.invalid','fixture-password',undefined,'123456');
  ok('Email 2FA reuses negotiated key and limited token',()=>{
    assert.equal(limitedAuth,true);assert.equal(loginRequests,2);assert.equal(estimates,1);
  });
  ok('Successful email verification renews bound key and persists full session',()=>{
    assert.equal(email.authed,true);assert.equal(email.token,'full-token');assert.equal(exchanges,2);
    const stored=email.exportSession();assert.equal(stored.token,'full-token');assert.ok(stored.share);assert.ok(stored.ident);
  });
  const backend=vm.createContext({
    eufy:null,eufyReady:false,readyNames:[],preparing:null,eufyStatus:'',pendingEufyVerification:null,
    EufyCaptchaRequired:clientCtx.Captcha,EufyEmailCodeRequired:clientCtx.Email,
    resetPersistentMqtt:()=>{},eufyAuthRetryAt:()=>0,
    beginEufyLoginTrace:()=>{},recordEufyLoginTrace:()=>{},recordEufyLoginFailure:()=>{},
    eufyAutoLoginPaused:()=>true,eufyAuthFailureDelay:()=>0,
    meta:key=>key==='install_id'?'fixture-id':key==='eufy_session'?JSON.stringify({token:'stored'}):null,
    setMeta:()=>{},delMeta:()=>{},
    DEFAULT_INSTALL:'fixture-id',EMAIL:'test@example.invalid',PASSWORD:'fixture',DEVICE_NAMES:['Pool','House','Garage','Shed'],
    EUFY_AUTO_PAUSE_UNTIL_KEY:'pause',EUFY_AUTH_RETRY_AT_KEY:'retry',EUFY_AUTH_RETRY_REASON_KEY:'reason',
    console,Math,Date,Error,JSON,String,Number,Promise,
  });
  let logins=0;
  class MockClient{
    constructor(_,session){this.authed=!!session;}
    async login(){logins++;}
    async prepare(){throw Error('Session rejected HTTP 401');}
    readyNames(){return['Pool','House','Garage','Shed'];}
  }
  backend.EufyClient=MockClient;
  vm.runInContext(extract(serverJS,'async function ensureEufy('),backend);
  await assert.rejects(vm.runInContext('ensureEufy(false)',backend),/paused/);
  ok('Paused automatic backend makes zero login attempts',()=>assert.equal(logins,0));
  backend.eufyAutoLoginPaused=()=>false;
  await assert.rejects(vm.runInContext('ensureEufy(false)',backend),/Session rejected/);
  ok('Rejected saved session does not trigger any replacement login',()=>assert.equal(logins,0));
  await assert.rejects(vm.runInContext('ensureEufy(true)',backend),/Session rejected/);
  ok('Manual reconnect performs at most one password login',()=>assert.equal(logins,1));
  console.log(JSON.stringify({passed:checks.length,checks,realNetworkCalls:0},null,2));
}
run().catch(e=>{console.error(e);process.exitCode=1});

