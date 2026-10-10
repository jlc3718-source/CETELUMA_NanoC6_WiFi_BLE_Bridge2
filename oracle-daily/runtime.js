"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const UNHANDLED = Symbol("unhandled");
const VERSION = "2026.10.10.1";
const ENTRY_CONFIRM = /(?:thanks? you for entering|thanks for entering|entry (?:has been )?(?:received|confirmed)|successfully entered|you['’]?re entered|submission received)/i;

function publicResult(value, key = "") {
  if (/^(password|secret|token|api_key|cookies|headers|storageState|email|phone|street|postal_code|address|values|coupon_code|gift_card_code)$/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.slice(0,100).map(v=>publicResult(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,publicResult(v,k)]));
  if (typeof value !== "string") return value;
  if (/^https?:\/\//.test(value)) {
    try { const u=new URL(value); for (const k of [...u.searchParams.keys()]) if (/token|password|email|phone|signature|secret|key/i.test(k)) u.searchParams.set(k,"REDACTED"); return u.href; } catch {}
  }
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED_EMAIL]")
    .replace(/(?<!\d)(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)/g,"[REDACTED_PHONE]")
    .replace(/\b\d{1,6}\s+[A-Za-z .]+\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b/gi,"[REDACTED_ADDRESS]").slice(0,5000);
}
function atomic(file,value) { fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700}); const temp=file+".tmp"; fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600}); fs.renameSync(temp,file); }
function read(file,fallback) { try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return structuredClone(fallback); } }
function entryKey(job,date=new Date()) {
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
  const period=job.frequency==="daily"?day:job.frequency==="monthly"?day.slice(0,7):"once";
  const campaign=job.campaign_id||crypto.createHash("sha256").update(String(job.url)).digest("hex").slice(0,24);
  return campaign+":"+period;
}
async function deadline(promise,ms,cancel) {
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(async()=>{try{await cancel?.();}finally{const e=new Error("bounded_timeout");e.code="BOUNDED_TIMEOUT";reject(e);}},ms);});
  try { return await Promise.race([promise,timeout]); } finally { clearTimeout(timer); }
}
async function navigate(page,url,ms=10000) {
  page.setDefaultTimeout(1800);
  page.setDefaultNavigationTimeout(ms);
  let response;
  try { response=await page.goto(url,{waitUntil:"domcontentloaded",timeout:ms}); }
  catch(e) { if(page.url()==="about:blank") throw e; await page.evaluate(()=>window.stop()).catch(()=>{}); }
  await page.waitForTimeout(450);
  const title=await page.title().catch(()=>"");
  const body=(await page.locator("body").innerText().catch(()=>"")).slice(0,45000);
  const status=response?.status();
  const denied=status===401||status===403||/access (?:to this page has been )?denied|request rejected|not authorized|temporarily blocked|pardon our interruption/i.test(title+" "+body);
  return {url:page.url(),title,http_status:status,access_denied:denied,body};
}
async function challengeVisible(page) {
  if (await page.getByText(/verify (?:that )?you are human|complete the security check/i).first().isVisible().catch(()=>false)) return true;
  for(const frame of page.frames()) {
    if(!/captcha|turnstile/i.test(frame.url()))continue;
    try {
      const el=await frame.frameElement(),box=await el.boundingBox();
      if (!box||box.width<100||box.height<60)continue;
      if (/anchor/.test(frame.url()) && await frame.locator('[role="checkbox"][aria-checked="true"]').count()) continue;
      if(await el.isVisible())return true;
    }catch{}
  }
  return false;
}
function rankForm(f) {
  const text=(f.text||"").toLowerCase();
  const identity=f.fields.some(x=>/first|last|full.?name|given-name|family-name|your.?name|\bname\b/i.test(x.name+" "+x.autocomplete+" "+x.label));
  const entryButton=f.buttons.some(x=>/enter|submit|apply|next|continue/i.test(x.text));
  if ((/search|sign in|log in/.test(text)||(/newsletter|subscribe/.test(text)&&(!identity||!entryButton))) && !/giveaway|sweepstakes|enter to win|application/.test(text)) return -100;
  let score=0;
  if(f.fields.some(x=>x.type==="email"||/email/i.test(x.name+" "+x.label)))score+=4;
  if(identity)score+=4;
  if(/giveaway|sweepstakes|enter to win|application|feedback|survey/i.test(text))score+=4;
  if(f.buttons.some(x=>/enter|submit|apply|next|continue/i.test(x.text)))score+=2;
  if(f.fields.every(x=>/search|^q$/i.test(x.name)||x.type==="hidden"))return -100;
  return score;
}
function chooseForm(forms,selector) {
  const ranked=forms.map(x=>({...x,score:rankForm(x)})).filter(x=>selector||x.score>=8).sort((a,b)=>b.score-a.score);
  if(!ranked.length)return null;
  if(!selector&&ranked.length>1&&ranked[0].score===ranked[1].score)return null;
  return ranked[0];
}
async function identifyForm(page,job={}) {
  const candidates=[];
  for(const [fi,frame] of page.frames().entries()) {
    const forms=await frame.evaluate(({selector})=>{
      const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=="hidden";};
      let roots=selector?[...document.querySelectorAll(selector)]:[...document.querySelectorAll("form,[role='form']")];
      if(!selector) {
        for(const email of document.querySelectorAll('input[type="email"],input[name*="email" i]')) {
          if(!visible(email)||email.closest("form,[role='form']"))continue;
          let p=email.parentElement;
          for(let i=0;p&&i<7;i++,p=p.parentElement) {
            if(p.querySelectorAll("input").length>=2&&p.querySelector("button,input[type='submit']")) {roots.push(p);break;}
          }
        }
      }
      roots=[...new Set(roots)].filter(visible);
      return roots.map((root,i)=>{
        const id="daily-v2-"+i;root.setAttribute("data-daily-v2-form",id);
        const fields=[...root.querySelectorAll("input,select,textarea")].filter(e=>visible(e)&&e.type!=="hidden").map((e,n)=>{
          e.setAttribute("data-daily-v2-field",String(n));
          const label=[...(e.labels||[])].map(x=>x.innerText).join(" ")||e.getAttribute("aria-label")||e.placeholder||"";
          return {index:n,name:e.name,id:e.id,type:e.type,tag:e.tagName,required:e.required,autocomplete:e.autocomplete,label:label.slice(0,180)};
        });
        const buttons=[...root.querySelectorAll("button,input[type='submit']")].filter(visible).map((e,n)=>{e.setAttribute("data-daily-v2-button",String(n));return {index:n,text:(e.innerText||e.value||"").trim().slice(0,150),type:e.type};});
        return {id,text:root.innerText.slice(0,1600),fields,buttons};
      });
    },{selector:job.form_selector||null}).catch(()=>[]);
    for(const f of forms)candidates.push({...f,frame_index:fi});
  }
  const selected=chooseForm(candidates,job.form_selector);
  if(!selected)return null;
  return {...selected,frame:page.frames()[selected.frame_index]};
}
function contactValue(field,profile,job={}) {
  const desc=(field.name+" "+field.id+" "+field.label+" "+field.autocomplete).toLowerCase();
  const parts=String(profile.name||"").trim().split(/\s+/);
  if(/email/.test(desc)||field.type==="email")return profile.email;
  if(/given-name|first.?name|firstname/.test(desc))return profile.first_name||parts[0];
  if(/family-name|last.?name|lastname|surname/.test(desc))return profile.last_name||parts.slice(1).join(" ");
  if(/full.?name|your.?name/.test(desc)||/^(name|your name)$/.test(field.name||field.label))return profile.name;
  if(field.type==="tel"||/phone|telephone/.test(desc))return profile.phone;
  if(/address-line2|address2|address 2/.test(desc))return profile.address_line2;
  if(/address-line1|street|address1|address 1|\baddress\b/.test(desc))return profile.street;
  if(/address-level2|city/.test(desc))return profile.city;
  if(/postal|zip/.test(desc))return profile.postal_code||profile.zip;
  if(/address-level1|state|province/.test(desc))return profile.state||(job.residency!=="PA"?"NY":undefined);
  if(/country/.test(desc))return profile.country||"United States";
}
function resolveProfile(profile,job) {
  if(job.residency!=="PA")return profile;
  if(job.eligibility?.ny!==false||job.eligibility?.pa!==true)throw new Error("PA fallback requires explicit NY exclusion and PA eligibility");
  const pa=profile.pa_address||profile.addresses?.PA;
  if(!pa)throw new Error("PA contact details are not present in the private vault");
  return {...profile,...pa,state:"PA"};
}
async function fillContact(page,form,profile,job) {
  const root=form.frame.locator('[data-daily-v2-form="'+form.id+'"]');
  const filled=[];
  for(const field of form.fields) {
    if(["checkbox","radio","password","file","hidden"].includes(field.type))continue;
    const value=contactValue(field,profile,job);
    if(value==null||value==="")continue;
    const el=root.locator('[data-daily-v2-field="'+field.index+'"]');
    try {
      if(field.tag==="SELECT") {
        const options=await el.locator("option").evaluateAll(els=>els.map(o=>({label:o.label,value:o.value})));
        const normalized=String(value).toLowerCase();
        const option=options.find(o=>o.value.toLowerCase()===normalized||o.label.toLowerCase()===normalized||
          (normalized==="united states"&&/^(us|usa|united states(?: of america)?)$/i.test(o.value+""))||
          (normalized==="ny"&&/^new york$/i.test(o.label))||(normalized==="pa"&&/^pennsylvania$/i.test(o.label)));
        if(option)await el.selectOption(option.value);
        else continue;
      }else await el.fill(String(value));
      filled.push(field.name||field.id||field.label);
    }catch{}
  }
  for(const [selector,value] of Object.entries(job.fields||{})) {
    const el=root.locator(selector);
    if(await el.count()!==1||!(await el.isVisible().catch(()=>false)))continue;
    const tag=await el.evaluate(e=>e.tagName);
    if(tag==="SELECT")await el.selectOption(String(value)).catch(()=>{});
    else if(await el.getAttribute("type")==="checkbox") {
      if(value===true)await el.check().catch(()=>{});
    }else await el.fill(String(value)).catch(()=>{});
  }
  for(const field of form.fields.filter(x=>x.type==="checkbox"&&x.required)) {
    const text=field.label+" "+field.name;
    if(/sms|text message|recurring|marketing|newsletter|promotional/i.test(text))continue;
    if(/agree|terms|rules/i.test(text)||(/18|age/i.test(text)&&job.eligibility?.age_verified===true))await root.locator('[data-daily-v2-field="'+field.index+'"]').check().catch(()=>{});
  }
  const missing=await root.locator("input,select,textarea").evaluateAll(els=>{
    const groups=new Set();
    return els.filter(e=>{
      if(e.offsetParent===null||!e.required)return false;
      if(e.type==="checkbox")return !e.checked;
      if(e.type==="radio"){if(groups.has(e.name))return false;groups.add(e.name);return ![...e.form?.elements||e.closest('[data-daily-v2-form]')?.querySelectorAll("input")||[]].some(x=>x.type==="radio"&&x.name===e.name&&x.checked);}
      return !String(e.value||"").trim();
    }).map(e=>e.name||e.id||e.getAttribute("aria-label")||e.type);
  });
  return {filled:[...new Set(filled)],missing:[...new Set(missing)],root};
}
async function inspectAndFill(page,job,profile) {
  const title=await page.title().catch(()=>"");
  const body=await page.locator("body").innerText().catch(()=>"");
  if(/access (?:to this page has been )?denied|request rejected|not authorized|pardon our interruption/i.test(title+" "+body))return {status:"entry_page_access_denied",prepared:false,url:page.url(),title};
  if(page.frames().some(f=>/gleam\.io/i.test(f.url())))return {status:"excluded_gleam",prepared:false,url:page.url()};
  let form=await identifyForm(page,job);
  const until=Date.now()+6500;
  while(!form&&Date.now()<until){
    await page.waitForTimeout(350);
    form=await identifyForm(page,job);
  }
  const challenge=await challengeVisible(page);
  if(!form){
    const applicationLogin=page.getByRole("link",{name:/login to apply|register to apply/i}).first();
    const loginRequired=await applicationLogin.isVisible().catch(()=>false)||/^(?:log ?in|sign ?in)(?:\s|$)/i.test(title);
    return {status:challenge?"manual_verification_required":loginRequired?"login_required":"entry_form_not_found",prepared:false,challenge,url:page.url(),title,
      ...(loginRequired?{login_url:await applicationLogin.getAttribute("href").then(u=>new URL(u,page.url()).href).catch(()=>page.url())}:{})};
  }
  const filled=await fillContact(page,form,profile,job);
  return {status:challenge?"manual_verification_required":filled.missing.length?"missing_required_fields":"prepared",
    prepared:filled.filled.length>0,challenge,url:page.url(),title,filled:filled.filled,missing:filled.missing,form,root:filled.root};
}
function isolatedContext(context) {
  let closed=false;
  const pages=new Set();
  const close=async()=>{closed=true;await Promise.allSettled([...pages].map(p=>p.close()));};
  const proxy=new Proxy(context,{get(target,key){
    if(key==="newPage")return async()=>{if(closed)throw new Error("lane_cancelled");const p=await target.newPage();if(closed){await p.close();throw new Error("lane_cancelled");}pages.add(p);return p;};
    if(key==="pages")return ()=>[...pages].filter(p=>!p.isClosed());
    if(key==="close")return close;
    const value=target[key];return typeof value==="function"?value.bind(target):value;
  }});
  return {context:proxy,close,pages};
}
function create(deps) {
  const dir=path.join(deps.dataDir,"run-daily"),jobsFile=path.join(dir,"jobs-v2.json"),sessionFile=path.join(dir,"manual-session-v2.json"),entriesFile=path.join(dir,"entries-v2.json");
  const jobs=read(jobsFile,{});
  for(const j of Object.values(jobs))if(j.status==="running"||j.status==="queued"){j.status="interrupted";j.error="agent_restarted";}
  let queue=Promise.resolve();
  const remember=()=>{const entries=Object.entries(jobs).slice(-100);atomic(jobsFile,Object.fromEntries(entries));};
  const active=()=>Boolean(deps.getLoginState()?.context);
  function loginStatus() {
    const s=deps.getLoginState();
    return {task:"login_status",status:s?.context?(s.url?"ready":"starting"):"closed",active:Boolean(s?.context),profile:s?.profile||null,login_url:s?.url||null,targets:s?.targets||[],viewport:{width:1280,height:850},version:VERSION};
  }
  async function startLogin(job) {
    const profile=deps.safeProfile(job.profile||"daily");
    let state=deps.getLoginState();
    if(state?.context&&state.profile!==profile){await deps.stopLogin();state=deps.getLoginState();}
    if(!state?.context) {
      const userDataDir=path.join(deps.dataDir,"profiles",profile);
      fs.mkdirSync(userDataDir,{recursive:true});
      const launch=()=>deps.chromium.launchPersistentContext(userDataDir,{executablePath:deps.chrome,headless:false,viewport:{width:1280,height:850},screen:{width:1280,height:850},env:{...process.env,DISPLAY:deps.display},timeout:18000,args:["--no-sandbox","--disable-dev-shm-usage","--no-first-run","--no-default-browser-check","--window-size=1280,850"]});
      let context;
      try{context=await launch();}catch(e){
        if(!/profile appears to be in use|process_singleton|SingletonLock/i.test(String(e.message)))throw e;
        if(deps.getLoginState()?.context)throw e;
        deps.clearProfileLocks?.(userDataDir);
        context=await launch();
      }
      state={context,tunnel:null,profile,target:null,targets:[],url:null,activePage:0,prepared_day:entryKey({frequency:"daily",campaign_id:"manual"}).slice(7)};
      deps.setLoginState(state);
      const tunnel=deps.spawn("/usr/local/bin/cloudflared",["tunnel","--url","http://127.0.0.1:6081","--no-autoupdate"],{stdio:["ignore","pipe","pipe"]});
      state.tunnel=tunnel;
      state.url=await deadline(new Promise((resolve,reject)=>{
        let text="";
        const data=x=>{text+=x.toString();const match=text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);if(match)resolve(match[0]+"/control");};
        tunnel.stdout.on("data",data);tunnel.stderr.on("data",data);tunnel.once("exit",()=>{if(!state.url)reject(new Error("login_tunnel_exited"));});
      }),22000,()=>deps.stopLogin());
      atomic(sessionFile,loginStatus());
    }
    const urls=[...new Set((job.urls?.length?job.urls:[job.url||"about:blank"]).map(String))].slice(0,12);
    if(urls.some(u=>u!=="about:blank"&&!/^https?:\/\//i.test(u)))throw new Error("invalid_manual_url");
    const reserved=new Set();
    const opened=await Promise.all(urls.map(async(url)=>{
      let page=state.context.pages().find(p=>p.url()===url);
      if(!page) {
        page=state.context.pages().find(p=>p.url()==="about:blank"&&!reserved.has(p))||await state.context.newPage();
        reserved.add(page);
        if(url!=="about:blank")await navigate(page,url,8000).catch(()=>{});
      }
      if(!state.targets.includes(url))state.targets.push(url);
      return page;
    }));
    state.target=urls[0];state.activePage=Math.max(0,state.context.pages().indexOf(opened[0]));
    state.prepared_day=entryKey({frequency:"daily",campaign_id:"manual"}).slice(7);
    atomic(sessionFile,loginStatus());
    return {...loginStatus(),task:"login_start",status:"ready",pages:opened.map(p=>({url:p.url()}))};
  }
  async function prepare(job) {
    const started=Date.now();
    const session=await startLogin(job);
    const profile=resolveProfile(deps.readEntryProfile(),job);
    const urls=new Set(session.pages.map(p=>p.url));
    const pages=deps.getLoginState().context.pages().filter(p=>urls.has(p.url()));
    const result=await Promise.all(pages.map(async(page)=>{
      try { const r=await deadline(inspectAndFill(page,{...job,submit:false},profile),Math.max(1000,45000-(Date.now()-started)),()=>Promise.resolve());
        const {form,root,...safe}=r;return safe;
      }catch(e){return {url:page.url(),status:"preparation_timeout",prepared:false,error:e.message};}
    }));
    const output={...session,task:"prepare_restricted",status:"ready_for_manual_action",pages:result,submitted:false,confirmed:false};
    atomic(sessionFile,publicResult(output));
    return output;
  }
  async function formEntry(job) {
    const key=entryKey(job),entries=read(entriesFile,{});
    if(entries[key]&&["confirmed","submitted_unconfirmed","submitting"].includes(entries[key].status))return {task:"generic_form_entry",status:entries[key].status==="confirmed"?"already_entered":"prior_submission_needs_verification",entry_key:key,submitted:false,confirmed:false,prior:entries[key]};
    const manual=deps.getLoginState();
    if(job.submit===true&&manual?.context&&manual.targets?.includes(job.url)&&
      (job.frequency!=="daily"||!manual.prepared_day||manual.prepared_day===entryKey({frequency:"daily",campaign_id:"manual"}).slice(7)))
      return {...loginStatus(),task:"generic_form_entry",status:"manual_entry_pending",submitted:false,confirmed:false};
    const profile=resolveProfile(deps.readEntryProfile(),job);
    const borrowed=Boolean(manual?.context&&manual.profile==="daily");
    const context=borrowed?manual.context:await deps.launchProfile("daily");
    const page=borrowed?await context.newPage():context.pages()[0]||await context.newPage();
    let clicked=false;
    const work=(async()=>{
      const initial=await navigate(page,job.url,10000);
      if(initial.access_denied||initial.http_status>=400)return {task:"generic_form_entry",status:"entry_page_access_denied",prepared:false,submitted:false,url:page.url(),title:initial.title,http_status:initial.http_status};
      const allowedHosts=[new URL(job.url).hostname.replace(/^www\./,""),...(job.allowed_entry_hosts||[])];
      if(!allowedHosts.includes(new URL(page.url()).hostname.replace(/^www\./,"")))return {task:"generic_form_entry",status:"unexpected_entry_redirect",prepared:false,submitted:false,url:page.url(),source_url:job.url,title:initial.title};
      const r=await inspectAndFill(page,job,profile),{form,root,...out}=r;
      const base={task:"generic_form_entry",...out,submitted:false,confirmed:false};
      if(!form||out.challenge||out.missing?.length||job.submit!==true)return base;
      if(job.automation_allowed===false)return {...base,status:"manual_submission_required_by_rules"};
      if(job.rules_verified!==true)return {...base,status:"rules_verification_required"};
      const buttons=form.buttons.filter(b=>/enter|submit|apply|join|register|sign up/i.test(b.text)&&!/newsletter|subscribe|search|login|log in|next|continue/i.test(b.text));
      if(buttons.length!==1)return {...base,status:"submit_control_ambiguous"};
      const before=(await page.locator("body").innerText()).split("\n").filter(x=>ENTRY_CONFIRM.test(x)).map(x=>x.trim());
      const submit=root.locator('[data-daily-v2-button="'+buttons[0].index+'"]');
      entries[key]={status:"submitting",at:new Date().toISOString(),url:job.url,frequency:job.frequency||"once"};
      atomic(entriesFile,entries);
      await submit.click({timeout:2200});
      clicked=true;
      await page.waitForTimeout(1300);
      if(await challengeVisible(page)){delete entries[key];atomic(entriesFile,entries);return {...base,status:"manual_verification_required",challenge:true,submitted:true};}
      const after=(await page.locator("body").innerText().catch(()=>"")).split("\n").map(x=>x.trim());
      const confirmation=after.find(x=>ENTRY_CONFIRM.test(x)&&!before.includes(x));
      entries[key]={...entries[key],status:confirmation?"confirmed":"submitted_unconfirmed",confirmation:confirmation?.slice(0,300)||null};
      atomic(entriesFile,entries);
      return {...base,status:confirmation?"confirmed":"submitted_unconfirmed",submitted:true,confirmed:Boolean(confirmation),confirmation:confirmation?.slice(0,300)||null};
    })();
    try { return await deadline(work,45000,()=>borrowed?page.close().catch(()=>{}):context.close().catch(()=>{})); }
    catch(e){return {task:"generic_form_entry",status:e.code==="BOUNDED_TIMEOUT"?"timeout_cancelled":"browser_error",prepared:false,submitted:clicked,confirmed:false,error:e.message,url:job.url};}
    finally {await page.close().catch(()=>{});if(!borrowed)await context.close().catch(()=>{});}
  }
  async function instagram(context,job={}) {
    const handles=job.handles||["roborockglobal","dreametech","movatech.usa","narwalrobot","tinecoglobal","eufyofficial","goveeofficial","navimow","mammotiontech","ecovacsrobotics"];
    const keywords=/giveaway|win\b|beta|tester|testing|free product|sample|apply|early access|mystery|lucky|spin|sweepstakes|contest|prize/i;
    const results=[];
    await Promise.all(handles.map(async(handle)=>{
      const page=await context.newPage(),item={handle,status:"started",profile_url:"https://www.instagram.com/"+handle+"/",recent_scanned:0,posts:[],hits:[]};results.push(item);
      try {
        const n=await navigate(page,item.profile_url,6500);
        if(n.access_denied){item.status="access_denied";return;}
        await page.locator('a[href*="/p/"],a[href*="/reel/"]').first().waitFor({state:"attached",timeout:5000}).catch(()=>{});
        const links=await page.locator('a[href*="/p/"],a[href*="/reel/"]').evaluateAll(els=>[...new Map(els.map(a=>[a.href,{url:a.href,preview:(a.querySelector("img")?.alt||a.innerText||"").slice(0,1500)}])).values()].slice(0,5));
        if(!links.length){item.status=/log in|sign up/i.test(n.body)?"login_required":"posts_unavailable";return;}
        const finish=Date.now()+28000;
        for(const link of links) {
          if(Date.now()>finish){item.status="partial_timeout";break;}
          const post={...link,caption:null,checked:false};item.posts.push(post);
          try {
            const d=await navigate(page,link.url,4500);
            const caption=(await page.locator("article").innerText().catch(()=>""))||d.body;
            post.caption=caption.slice(0,3000);post.checked=true;item.recent_scanned++;
            if(keywords.test(caption+" "+link.preview))item.hits.push({url:link.url,snippets:caption.split("\n").filter(x=>keywords.test(x)).slice(0,8),preview:link.preview});
          }catch(e){post.status="post_unavailable";}
        }
        if(item.status==="started")item.status=item.recent_scanned?"scanned":"captions_unavailable";
      }catch(e){item.status="browser_error";item.error=e.message;}
      finally{await page.close().catch(()=>{});}
    }));
    return {task:"instagram_brand_scan",authenticated:results.some(x=>x.recent_scanned>0),results,coverage:{handles_requested:handles.length,handles_scanned:results.filter(x=>x.recent_scanned>0).length,posts_scanned:results.reduce((n,x)=>n+x.recent_scanned,0)}};
  }
  async function batch(job) {
    const started=Date.now(),manual=deps.getLoginState(),borrowed=Boolean(manual?.context&&manual.profile==="daily");
    const context=borrowed?manual.context:await deps.launchProfile("daily");
    const tasks=[...new Set(job.tasks||["jml_scan","instagram_brand_scan","roborock_wheel_diag","eufy_alt_free_spin","bluetti_safe_spin","mova_widget_api_diag","navimow_round2_check"])];
    const timeout=Math.max(1000,Math.min(Number(job.lane_timeout_ms)||45000,52000-(Date.now()-started)));
    try {
      const results=await Promise.all(tasks.map(async(task)=>{
        const lane=isolatedContext(context);
        try {
          const diagnostic=job.read_only?({eufy_alt_free_spin:"eufy_alt_draw_diag",bluetti_safe_spin:"bluetti_wheel_state",roborock_spin:"roborock_wheel_diag"}[task]||task):task;
          const work=task==="instagram_brand_scan"?instagram(lane.context,job):deps.taskWithContext(lane.context,diagnostic);
          const result=await deadline(work,timeout,lane.close);
          return {task,ok:true,result};
        }catch(e){return {task,ok:false,result:{task,status:e.code==="BOUNDED_TIMEOUT"?"timeout_cancelled":"browser_error",timeout_ms:timeout,error:e.message}};}
        finally {await lane.close();}
      }));
      const file=path.join(dir,"state.json"),state=read(file,{version:1,lanes:{},campaigns:{}});
      state.last_run_at=new Date().toISOString();state.lanes||={};
      for(const entry of results){const prev=state.lanes[entry.task]||{};state.lanes[entry.task]={...prev,status:entry.result.status||"checked",last_seen_at:state.last_run_at,last_result:publicResult(entry.result)};}
      atomic(file,state);
      return {task:"batch",parallel:true,lane_timeout_ms:timeout,elapsed_ms:Date.now()-started,results,last_run_at:state.last_run_at,manual_session_preserved:borrowed};
    }finally {if(!borrowed)await context.close().catch(()=>{});}
  }
  async function recall(job) {
    const make=job.make||"CHEVROLET",model=job.model||"SILVERADO EV",year=job.year||2025;
    const url=new URL("https://api.nhtsa.gov/recalls/recallsByVehicle");url.search=new URLSearchParams({make,model,modelYear:String(year)}).toString();
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(9000),headers:{"Accept":"application/json"}});
      if(!response.ok)return {task:"recall_check",status:"source_http_error",url:url.href,http_status:response.status,verified:false};
      const j=await response.json();
      if(!Array.isArray(j.results))return {task:"recall_check",status:"invalid_source_response",url:url.href,verified:false};
      return {task:"recall_check",status:"verified",verified:true,url:url.href,make,model,year,count:j.results.length,results:j.results,vin_specific:false,checked_at:new Date().toISOString()};
    }catch(e){return {task:"recall_check",status:"source_unavailable",verified:false,url:url.href,error:e.message};}
  }
  async function dispatch(job) {
    switch(job.task) {
      case "login_status":return loginStatus();
      case "job_status":return jobs[String(job.job_id||job.id)]||{status:"unknown_job"};
      case "login_start":return startLogin(job);
      case "prepare_restricted":return prepare(job);
      case "generic_form_entry":return formEntry(job);
      case "batch":return batch(job);
      case "run_daily_fast":return {...await batch(job),task:"run_daily_fast"};
      case "recall_check":return recall(job);
      case "agent_selfcheck":return {task:job.task,status:"ready",version:VERSION,profile_fields:Object.keys(deps.readEntryProfile()).filter(k=>!/pass|secret|token/i.test(k)),login_active:active(),persistent_jobs:true,scoped_forms:true,parallel_handoff:true};
      default:return UNHANDLED;
    }
  }
  async function submit(job,execute) {
    const id=String(job.id||crypto.randomUUID());
    if(job.task==="login_status"||job.task==="job_status"||job.task==="health"||job.task==="agent_selfcheck")return {id,ok:true,result:await execute(job)};
    if(jobs[id]&&jobs[id].status==="completed")return jobs[id].response;
    if(jobs[id]&&["running","queued"].includes(jobs[id].status))return {id,ok:true,result:{task:"job_status",status:jobs[id].status,job_id:id}};
    jobs[id]={id,task:job.task,status:"queued",queued_at:new Date().toISOString()};remember();
    const p=queue.then(async()=>{
      jobs[id].status="running";jobs[id].started=new Date().toISOString();remember();
      let response;
      try{const result=await execute(job);response={id,ok:true,agent_version:VERSION,started:jobs[id].started,finished:new Date().toISOString(),result:publicResult(result)};}
      catch(e){response={id,ok:false,started:jobs[id].started,finished:new Date().toISOString(),error:String(e.message).slice(0,300)};}
      jobs[id]={...jobs[id],status:"completed",finished:response.finished,response};remember();return response;
    });
    queue=p.then(()=>undefined,()=>undefined);
    if(job.async===true)return {id,ok:true,result:{task:"job_status",status:"queued",job_id:id}};
    return p;
  }
  return {UNHANDLED,VERSION,dispatch,submit,loginStatus,formEntry,prepare,batch,recall};
}
module.exports={create,VERSION,publicResult,rankForm,chooseForm,contactValue,resolveProfile,entryKey,deadline,isolatedContext,navigate,challengeVisible,identifyForm,inspectAndFill};
