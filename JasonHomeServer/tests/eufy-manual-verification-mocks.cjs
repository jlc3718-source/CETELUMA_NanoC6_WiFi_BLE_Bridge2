'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const sourcePath=process.env.EUFY_TEST_FIXTURE_DIR?path.join(process.env.EUFY_TEST_FIXTURE_DIR,'server.ts'):path.join(__dirname,'../src/server.ts');
const code=stripTypeScriptTypes(fs.readFileSync(sourcePath,'utf8'),{mode:'transform'});
const start=code.indexOf('let pendingEufyVerification = null;'),end=code.indexOf('function nativeFactoryLightId',start);
assert(start>=0&&end>start,'Expected verification handlers');
const block=code.slice(start,end);
let loginCalls=0,prepares=0,writes=0,challengeEmails=0;
class Captcha extends Error{constructor(id,image){super('CAPTCHA');this.captchaId=id;this.image=image;}}
class Email extends Error{constructor(){super('Email code required');}}
class FakeClient {
 constructor(){this.authed=false;}
 async login(_email,_password,captcha,code){
  loginCalls++;
  if(code==='123456'){this.authed=true;return;}
  if(code)throw Error('Eufy invalid email code');
  if(captcha&&captcha.answer==='HELLO'){this.authed=true;return;}
  if(!captcha){challengeEmails++;throw new Email();}
  throw Error('CAPTCHA rejected');
 }
 async prepare(){prepares++;}
 readyNames(){return['Pool','House','Garage','Shed'];}
 exportSession(){return{test:'only'};}
}
const fixture={
  EufyClient:FakeClient,EufyCaptchaRequired:Captcha,EufyEmailCodeRequired:Email,
  meta:()=>null,setMeta:()=>{writes++;},delMeta:()=>{},
  beginEufyLoginTrace:()=>{},recordEufyLoginTrace:()=>{},recordEufyLoginFailure:()=>{},
  DEFAULT_INSTALL:'fixture-id',EMAIL:'test@example.invalid',PASSWORD:'not-a-real-password',
  DEVICE_NAMES:['Pool','House','Garage','Shed'],EUFY_AUTH_RETRY_AT_KEY:'retry',EUFY_AUTH_RETRY_REASON_KEY:'reason',
  EUFY_AUTH_LOCKOUT_MS:86400000,
  eufyReady:false,eufy:null,eufyStatus:'',readyNames:[],console,Date,Error,Math,JSON,String,
};
const ctx=vm.createContext(fixture);
vm.runInContext(block,ctx);
(async()=>{
 const first=await vm.runInContext('manualEufyVerification("start","")',ctx);
 assert.equal(first.required,true);assert.equal(first.type,'email');assert.equal(first.image,null);
 assert.equal(loginCalls,1);assert.equal(challengeEmails,1);
 const again=await vm.runInContext('manualEufyVerification("start","")',ctx);
 assert.equal(again.type,'email');assert.equal(loginCalls,1,'must NOT restart login with challenge pending');
 const wrong=await vm.runInContext('manualEufyVerification("answer","000000")',ctx).catch(e=>e);
 assert.match(String(wrong.message),/invalid email code/);
 const pending=vm.runInContext('verificationStatus()',ctx);
 assert.equal(pending.type,'email','wrong code should preserve pending challenge');
 const done=await vm.runInContext('manualEufyVerification("answer","123456")',ctx);
 assert.equal(done.required,false);assert.equal(fixture.eufyReady,true);
 assert.equal(prepares,1);assert.equal(writes,1);
 assert.equal(vm.runInContext('verificationStatus()',ctx).required,false);
 console.log(JSON.stringify({pass:true,checks:['email challenge surfaced in GET status','repeated start does not trigger another login','invalid email code retains pending session','valid one-time email code finishes same session','successful login persists only completed session','verification UI closes once four strings ready'],networkRequests:0},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

