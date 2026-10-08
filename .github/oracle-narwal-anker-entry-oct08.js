"use strict";
const {chromium}=require("/app/node_modules/playwright-core");
const fs=require("fs");
const output={runAt:new Date().toISOString(),source:"oracle-persistent-daily",narwal:{status:"not_attempted"},anker:{status:"not_attempted"}};
const COMMENT_NARWAL="@250rskylar @kellvb90210 I'd choose the Black Edition! I love the clean, sleek look and how well it would fit in my home.";
const COMMENT_ANKER="What scares me most during a power outage is losing reliable power for essential equipment during an extended outage. Having a dependable backup supply makes all the difference.";
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function goto(p,url,timeout=12000){
  try{await p.goto(url,{waitUntil:"domcontentloaded",timeout});}catch(e){if(p.url()==="about:blank") throw e;await p.evaluate(()=>window.stop()).catch(()=>{});}
  await sleep(900);
}
async function body(p,max=18000){return String(await p.locator("body").innerText().catch(()=>"")).slice(0,max)}
async function maybeClick(loc){
  const n=await loc.count().catch(()=>0);
  for(let i=0;i<Math.min(n,8);i++){const el=loc.nth(i);if(await el.isVisible().catch(()=>false)){try{await el.click({timeout:2200});return true;}catch{}}}
  return false;
}
function hasLoginText(t){return /log in to instagram|log in to continue|log in to facebook|you must log in|enter your password|log into facebook/i.test(t);}
async function narwalEntry(ctx){
  const res={status:"started",account:"narwalrobot",follow:"unknown",liked:false,commentSubmitted:false,commentConfirmed:false,post_url:null,candidatesChecked:0};
  const p=await ctx.newPage();
  try{
    await goto(p,"https://www.instagram.com/narwalrobot/");
    let t=await body(p);
    if(hasLoginText(t)&&!/followers|posts/i.test(t)){res.status="instagram_login_required";return res;}
    const follow=p.getByRole("button",{name:/^Follow$/i});
    if(await maybeClick(follow)){res.follow="clicked"}else{res.follow="already_following_or_button_unavailable"}
    await sleep(800);
    const links=await p.locator('a[href*="/p/"],a[href*="/reel/"]').evaluateAll(els=>{
      const seen=new Set(),out=[];
      for(const a of els){const h=a.href;if(!h||seen.has(h)||!/^https:\/\/www\.instagram\.com\/(p|reel)\//.test(h))continue;seen.add(h);const im=a.querySelector('img');out.push({url:h,preview:(im?.alt||"").slice(0,500)});if(out.length>=30)break;}
      return out;
    }).catch(()=>[]);
    res.postsFound=links.length;
    let chosen=null;
    const start=Date.now();
    for(const link of links){
      if(Date.now()-start>92000)break;
      res.candidatesChecked++;
      const preview=link.preview||"";
      try{await goto(p,link.url,9000);}catch{continue;}
      t=await body(p,22000);
      const match=/(flow\s*2|flow2)/i.test(preview+" "+t)&&/(giveaway|win a flow|win.*robot vacuum|enter to win|chance to win)/i.test(preview+" "+t)&&/(prime day|fall|october\s*9|giveaway)/i.test(preview+" "+t);
      if(match){chosen=link.url;break;}
    }
    if(!chosen){res.status="specific_giveaway_post_not_found";return res;}
    res.post_url=chosen;
    t=await body(p,26000);
    if(t.includes(COMMENT_NARWAL.slice(0,55))){res.status="already_commented";res.commentConfirmed=true;return res;}
    const unlike=p.locator('svg[aria-label="Unlike"]');
    if(await unlike.count().catch(()=>0)){res.liked=true}
    else{
      res.liked=await maybeClick(p.locator('svg[aria-label="Like"]').locator('xpath=ancestor::button[1]'))||
         await maybeClick(p.getByRole('button',{name:/^Like$/i}));
    }
    let field=null;
    for(const loc of [
      p.locator('textarea[aria-label*="comment" i]'),p.locator('textarea[placeholder*="comment" i]'),
      p.locator('[contenteditable="true"][aria-label*="comment" i]'),p.locator('textarea')
    ]){
      for(let i=0;i<Math.min(await loc.count().catch(()=>0),7);i++){const el=loc.nth(i);if(await el.isVisible().catch(()=>false)){field=el;break;}}if(field)break;
    }
    if(!field){res.status="verified_post_comment_field_not_found";return res;}
    try{await field.fill(COMMENT_NARWAL)}catch{await field.click();await p.keyboard.type(COMMENT_NARWAL,{delay:4})}
    if(await maybeClick(p.getByText(/^Post$/i,{exact:true})))res.commentSubmitted=true;
    else {await p.keyboard.press("Enter").catch(()=>{});res.commentSubmitted=true;}
    await sleep(1900);
    t=await body(p,33000);
    res.commentConfirmed=t.includes(COMMENT_NARWAL.slice(0,55));
    res.status=res.commentConfirmed?"confirmed_comment_visible":"submitted_unconfirmed";
    return res;
  }catch(err){res.status="browser_error";res.error=String(err.message||err).slice(0,170);return res;}
  finally{await p.close().catch(()=>{});}
}
async function ankerEntry(ctx){
  const res={status:"started"};
  const p=await ctx.newPage();
  try{
    await goto(p,"https://www.facebook.com/groups/ankersolixusers/",13000);
    const t=await body(p,21000);
    if(/facebook\.com\/login/.test(p.url())||hasLoginText(t)){
      res.status="facebook_login_required";
      return res;
    }
    res.status="facebook_authenticated_but_exact_giveaway_post_unverified";
    // Never comment on a random community post; target only verified original giveaway URLs.
    return res;
  }catch(err){res.status="browser_error";res.error=String(err.message||err).slice(0,170);return res;}
  finally{await p.close().catch(()=>{});}
}
(async()=>{
  let ctx=null;
  try{
    ctx=await chromium.launchPersistentContext("/data/profiles/daily",{
      executablePath:"/usr/bin/chromium",headless:false,viewport:{width:1024,height:700},
      timeout:30000,args:["--no-sandbox","--disable-dev-shm-usage","--disable-blink-features=AutomationControlled","--no-first-run","--no-default-browser-check"]
    });
    output.narwal=await narwalEntry(ctx);
    output.anker=await ankerEntry(ctx);
  }catch(err){output.fatal=String(err.message||err).slice(0,240);}
  finally{if(ctx)await ctx.close().catch(()=>{});}
  fs.writeFileSync("/tmp/oracle-social-entry-oct08-result.json",JSON.stringify(output,null,2));
  console.log(JSON.stringify({status:"results_written",narwal:output.narwal.status,anker:output.anker.status,fatal:output.fatal||null}));
})();
