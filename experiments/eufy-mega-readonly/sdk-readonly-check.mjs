// One-time read-only eufy Mega SDK smoke test. No commands to physical lights.
// Never print credentials, tokens, device serials, names, IP addresses, or session data.
import {createHash} from "node:crypto";
import {EufyMega, FileSessionStore, LoginStatus} from "@mega-yfue/eufy-sdk";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

const email=process.env.EUFY_EMAIL;
const password=process.env.EUFY_PASSWORD;
if(!email||!password){console.log("JH2_MEGA_TEST: missing credential secrets");process.exit(2);}
const dir=await mkdtemp(join(tmpdir(),"jh2-eufy-mega-"));
const openudid=createHash("sha256").update("jh2-eufy-mega-readonly:2026-11-09:"+String(process.env.GITHUB_RUN_ID||"one-time")).digest("hex").slice(0,40);
const client=new EufyMega({email,password,countryCode:"US",openudid,
 store:new FileSessionStore(join(dir,"session.json"))});
const abort=setTimeout(()=>{console.log("JH2_MEGA_TEST: timeout; no retries");process.exit(124)},90000);
abort.unref();
client.on("error",()=>{console.log("JH2_MEGA_TEST: sdk runtime event (details redacted)")});
client.on("sessionExpired",()=>{console.log("JH2_MEGA_TEST: shadow session expired")});
try {
 const auth=await client.login(); // Exactly one attempt. No CAPTCHA/2FA bypass.
 const s=auth?.status;
 if(s===LoginStatus.Captcha || s===LoginStatus.TwoFactor){
  console.log("JH2_MEGA_TEST: verification required ("+(s===LoginStatus.Captcha?"captcha":"2fa")+")");
  process.exitCode=3;
 } else if(s!==LoginStatus.Ok){
  console.log("JH2_MEGA_TEST: login returned unexpected non-ready status: "+String(s??"unknown").replace(/[^a-z0-9_-]/gi,"").slice(0,32));
  process.exitCode=4;
 } else {
  console.log("JH2_MEGA_TEST: login successful");
  const inventory=await client.getDevices();
  const lights={E120:0,E22:0,other:0};
  for(const d of inventory){
    // Never print identity fields. Model identifiers are not personal data.
    const type=String(d?.model||d?.modelCode||"").toUpperCase();
    if(type.includes("E120"))lights.E120++;
    else if(type.includes("E22"))lights.E22++;
    else lights.other++;
  }
  console.log("JH2_MEGA_TEST: inventory "+JSON.stringify({total:inventory.length,models:lights}));
  console.log("JH2_MEGA_TEST: read-only validation complete; no light control methods invoked");
 }
} catch(error) {
 console.log("JH2_MEGA_TEST: failure at authentication or inventory; type="+String(error?.name||"Error").replace(/[^a-z0-9]/gi,"").slice(0,28));
 process.exitCode=5;
} finally {
 clearTimeout(abort);
 try{await Promise.race([client.disconnect(),new Promise(resolve=>setTimeout(resolve,3000))])}catch{}
 try{await rm(dir,{recursive:true,force:true})}catch{}
}
