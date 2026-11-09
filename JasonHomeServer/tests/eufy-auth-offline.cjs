const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const server=fs.readFileSync(path.join(__dirname,'../src/server.ts'),'utf8');
const client=fs.readFileSync(path.join(__dirname,'../src/eufy/client.ts'),'utf8');
function extract(src,head){
 const p=src.indexOf(head);assert(p>=0,'missing: '+head);
 const open=src.indexOf('{',p);let depth=0;
 for(let i=open;i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&--depth===0)return src.slice(p,i+1);}
 throw Error('unclosed '+head);
}
let values=new Map();
const ctx={meta:(k)=>values.get(k)??null,setMeta:(k,v)=>values.set(k,v),delMeta:(k)=>values.delete(k),Date,Error,Number,String,Math};
vm.createContext(ctx);
function declare(source,head,patch){let c=extract(source,head);for(const [x,y] of patch)c=c.replace(x,y);vm.runInContext(c,ctx);return c;}
const pauseKey="eufy_auto_pause_until_v1";
declare(server,'function eufyAutoLoginPaused()',[["):boolean{","){"]]);
declare(server,'function eufyAutoPauseStatus()',[]);
declare(server,'function eufyAuthRetryAt()',[["):number{","){"]]);
declare(server,'function eufyAuthFailureDelay(',[['error:unknown','error'],['(error as any)','error'],['):number{','){']]);
vm.runInContext('const EUFY_AUTO_PAUSE_UNTIL_KEY="eufy_auto_pause_until_v1";const EUFY_AUTH_RETRY_AT_KEY="eufy_auth_retry_at_v1";const EUFY_AUTH_LOCKOUT_MS=86400000;const EUFY_AUTH_OTHER_MS=1800000;',ctx);
values.set(pauseKey,String(Date.now()-1000));
assert.equal(vm.runInContext('eufyAutoLoginPaused()',ctx),true,'expired 24h pause must remain until manual enable');
assert.equal(vm.runInContext('eufyAutoPauseStatus().paused',ctx),true);
values.set(pauseKey,"0");
assert.equal(vm.runInContext('eufyAutoLoginPaused()',ctx),false,'manual enable lifts pause');
values.set("eufy_auth_retry_at_v1",String(Date.now()+100000));
assert.ok(vm.runInContext('eufyAuthRetryAt()',ctx)>Date.now(),'persisted retry limiter is active');
assert.equal(vm.runInContext('eufyAuthFailureDelay(new Error("Eufy /passport/login failed: HTTP 200, code 100028"))',ctx),86400000);
assert.equal(vm.runInContext('eufyAuthFailureDelay(new Error("Login failed: HTTP 401"))',ctx),1800000);
assert.equal(vm.runInContext('eufyAuthFailureDelay(new Error("Eufy network timeout"))',ctx),0);
assert.match(server,/if\(!force&&eufyAutoLoginPaused\(\)\)/,'force manual bypass');
assert.match(server,/method==="GET"&&path==="\/api\/status"/);
assert.match(server,/statusPayload\(false\)/,'GET status must not cause login');
assert.match(server,/path==="\/api\/eufy\/verification"/,'captcha API installed in patch');
assert.match(server,/pendingEufyCaptcha=\{client,id:error\.captchaId,image:error\.image,expiresAt:Date\.now\(\)\+5\*60\*1000\}/,'challenge expiry');
const captchaBlock=extract(client,'if(path==="/passport/login"){');
const code=captchaBlock.replace(/let challenge:any=/,'let challenge=').replace('const id=String(', 'const id=String(').replace('throw new EufyCaptchaRequired(id,image);', 'throw new EufyCaptchaRequired(id,image);');
class Captcha extends Error{constructor(id,image){super('captcha');this.captchaId=id;this.image=image;}}
const capctx={EufyCaptchaRequired:Captcha,aesDecryptText:()=>{throw Error('no encrypted fixture');},JSON,String,Error,console};
vm.createContext(capctx);
let fakeimg='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9aV1LXAAAAABJRU5ErkJggg==';
function checkCaptcha(responseCode,value){
 capctx.path='/passport/login';capctx.code=responseCode;capctx.r={data:value};
 try{vm.runInContext('(()=>{'+code+'})()',capctx);return null;}
 catch(err){if(err instanceof Captcha)return err;throw err;}
}
let challenge=checkCaptcha(100032,{captcha_id:'fixture-id',item:fakeimg});
assert.equal(challenge?.captchaId,'fixture-id','100032 must expose image + ID');
assert.equal(challenge?.image,fakeimg);
assert.equal(checkCaptcha(100028,{message:'Failed to request'}),null,'100028 alone MUST NOT generate fake CAPTCHA');
assert.equal(checkCaptcha(100033,{captcha_id:'fixture',item:'not-an-image'}),null,'malformed image must be rejected');
const detected=checkCaptcha(100033,{captcha_id:'fixture-id',item:fakeimg});
assert.ok(detected,'100033 valid image captured');
console.log(JSON.stringify({pass:true,checks:['persistent pause after 24h','manual reenable','persisted auth limiter','100028 24h cooldown','401 30m cooldown','network timeout no auth cooldown','manual bypass static','status does not initiate login','CAPTCHA API static','5 minute challenge TTL','CAPTCHA 100032 image and ID','100028 does not fabricate image','malformed CAPTCHA rejected','CAPTCHA 100033 image and ID'],networkRequests:0},null,2));
