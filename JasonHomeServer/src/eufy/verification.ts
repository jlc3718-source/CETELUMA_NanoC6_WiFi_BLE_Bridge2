/** Explicit human verification; no CAPTCHA solving or repeated background logins. */
export function createEufyVerification({createClient,meta,setMeta,commit}:any){
 let pending:any=null,busy=false;
 const requiredKey="eufy_verification_required";
 function view(){return {required:!!meta(requiredKey),type:pending?.type||null,image:pending?.type==="captcha"?pending.image:null,expiresAt:pending?.expiresAt||null};}
 async function handle(input:any){
  if(busy)throw new Error("Eufy verification is already in progress");busy=true;
  try{
   if(input?.action==="start"){
    const c=createClient(),challenge=await c.signed("passport","/passport/generate/captcha",{},false);
    if(typeof challenge?.captcha_id!=="string"||!challenge.captcha_id||typeof challenge.item!=="string"||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(challenge.item)||challenge.item.length>1000000)throw new Error("Eufy did not return a valid verification image");
    pending={type:"captcha",client:c,id:challenge.captcha_id,image:challenge.item,expiresAt:Date.now()+300000};setMeta(requiredKey,"1");return {ok:true,...view()};
   }
   if(!pending||pending.expiresAt<Date.now()){pending=null;throw new Error("Verification expired. Request a new image.");}
   const answer=String(input?.answer||"").trim();if(!answer||answer.length>32)throw new Error("Enter the characters shown by Eufy");
   const c=pending.client,signed=c.signed.bind(c);let loginResult:any=null;
   c.signed=async(service:string,path:string,body:any,...rest:any[])=>{
    if(path==="/passport/login"){
     for(const key of ["answer","captcha_id","verify_code","login_id"])delete body[key];
     if(pending.type==="captcha"){body.answer=answer;body.captcha_id=pending.id;body.verify_code="";body.login_id="";}
     else {body.verify_code=answer;body.login_id="";}
    }
    const result=await signed(service,path,body,...rest);if(path==="/passport/login")loginResult=result;return result;
   };
   try{await c.login(process.env.EUFY_EMAIL||"",process.env.EUFY_PASSWORD||"");}
   catch(error:any){
    if(loginResult?.fa_info?.info){
     c.uid=loginResult.ap_cloud_user_id||loginResult.user_id||loginResult.userId||"";c.accountUid=loginResult.user_id||loginResult.userId||c.uid;c.token=loginResult.auth_token||loginResult.token||"";
     if(!c.uid||!c.token)throw error;
     await signed("push","/app/sendmsg/verify_code",{biz_type:1004,message_type:2,transaction:String(Date.now())},true);
     pending={type:"email",client:c,expiresAt:Date.now()+600000};return {ok:true,...view()};
    }
    throw error;
   }finally{c.signed=signed;}
   await c.prepare();if(c.readyNames().length!==4)throw new Error("Eufy has not confirmed all four saved light strings");
   const result=await commit(c);pending=null;return {ok:true,required:false,type:null,readyNames:c.readyNames(),result};
  }finally{busy=false;}
 }
 return {view,handle};
}
