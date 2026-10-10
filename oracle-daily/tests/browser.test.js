"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),http=require("node:http"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{PassThrough}=require("node:stream"),{EventEmitter}=require("node:events");
const {chromium}=require("/app/node_modules/playwright-core");
const {create}=require("../runtime");
const profile={name:"Example Tester",email:"example@invalid.test",phone:"2025550123",street:"123 Example Street",city:"Example",state:"NY",postal_code:"14772"};
let browser,server,base,temp,posted=[];
const markup=(extra="",message="")=>`<form><input required name="q" type="search"><button type="submit">Search</button></form>
<form id="entry" action="/submit" method="post"><h2>Giveaway entry</h2>
<label>First name<input name="firstName" required></label><label>Last name<input name="lastName" required></label>
<label>Email<input name="email" type="email" required></label><label>Confirm email<input name="emailConfirm" type="email" required></label>
<label>State<select name="state" required><option value="">Choose</option><option value="NY">New York</option><option value="PA">Pennsylvania</option></select></label>
<label><input name="rules" type="checkbox" required>I agree to the official rules</label>
<label><input name="marketing" type="checkbox">Newsletter offers</label>${extra}<button type="submit">Enter now</button></form>
<form><h2>Newsletter</h2><input type="email"><button type="submit">Subscribe</button></form>${message}`;
test.before(async()=>{
  temp=fs.mkdtempSync(path.join(os.tmpdir(),"oracle-browser-regression-"));
  browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  server=http.createServer((req,res)=>{
    res.setHeader("Content-Type","text/html; charset=utf-8");
    if(req.method==="POST"){let body="";req.on("data",x=>body+=x);req.on("end",()=>{posted.push(new URLSearchParams(body));res.end(req.url==="/ambiguous-submit"?markup("","<p>You're entered</p>"):"<p>Entry received for the fixture giveaway</p>");});return;}
    if(req.url==="/denied"){res.writeHead(403);res.end("<title>Access to this page has been denied</title>");return;}
    if(req.url.startsWith("/slow/")){setTimeout(()=>res.end(markup()),180);return;}
    if(req.url==="/challenge"){res.end(markup('<iframe src="/captcha-anchor" width="304" height="78"></iframe>'));return;}
    if(req.url==="/captcha-anchor"){res.end('<div role="checkbox" aria-checked="false">Human verification fixture</div>');return;}
    if(req.url==="/badge"){res.end(markup('<iframe src="/captcha-badge" width="60" height="18" style="visibility:hidden"></iframe>'));return;}
    if(req.url==="/captcha-badge"){res.end("badge");return;}
    if(req.url==="/unknown"){res.end(markup('<label><input required type="radio" name="workType" value="electrician">Electrician</label><label><input required type="radio" name="workType" value="other">Other</label>'));return;}
    if(req.url==="/ambiguous"){res.end(markup("","<p>You're entered</p>").replace('action="/submit"','action="/ambiguous-submit"'));return;}
    res.end(markup());
  });
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  base="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));fs.rmSync(temp,{recursive:true,force:true});});
function agent(){
  let state={};
  const deps={dataDir:fs.mkdtempSync(path.join(temp,"agent-")),getLoginState:()=>state,setLoginState:x=>{state=x;},readEntryProfile:()=>profile,
    launchProfile:()=>browser.newContext(),safeProfile:x=>x,chrome:"/usr/bin/chromium",display:":99",
    chromium:{launchPersistentContext:()=>browser.newContext()},
    stopLogin:async()=>{await state.context?.close();state={};},
    spawn:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();process.nextTick(()=>child.stderr.write("https://fixture-session.trycloudflare.com"));return child;}};
  return {runtime:create(deps),deps};
}
test("real browser fills both emails, ignores q, checks rules and submits only the entry form",async()=>{
  const {runtime}=agent(),before=posted.length;
  const r=await runtime.formEntry({url:base+"/entry",submit:true,rules_verified:true,frequency:"daily",campaign_id:"fixture"});
  assert.equal(r.status,"confirmed");assert.equal(posted.length,before+1);
  const fields=posted.at(-1);assert.equal(fields.get("email"),profile.email);assert.equal(fields.get("emailConfirm"),profile.email);
  assert.equal(fields.get("state"),"NY");assert.equal(fields.get("marketing"),null);assert.equal(fields.get("q"),null);
  const second=await runtime.formEntry({url:base+"/entry",submit:true,rules_verified:true,frequency:"daily",campaign_id:"fixture"});
  assert.equal(second.status,"already_entered");assert.equal(posted.length,before+1);
});
test("an access-denied page cannot report prepared",async()=>{
  const {runtime}=agent();const r=await runtime.formEntry({url:base+"/denied",submit:false});
  assert.equal(r.status,"entry_page_access_denied");assert.equal(r.prepared,false);
});
test("visible human verification stops submission",async()=>{
  const {runtime}=agent(),before=posted.length;const r=await runtime.formEntry({url:base+"/challenge",submit:true,rules_verified:true});
  assert.equal(r.challenge,true);assert.equal(r.submitted,false);assert.equal(posted.length,before);
});
test("a hidden badge does not pretend that a human challenge is visible",async()=>{
  const {runtime}=agent();const r=await runtime.formEntry({url:base+"/badge",submit:false});
  assert.equal(r.challenge,false);assert.equal(r.status,"prepared");
});
test("unchecked required radio groups prevent invented screener answers",async()=>{
  const {runtime}=agent(),before=posted.length;const r=await runtime.formEntry({url:base+"/unknown",submit:true,rules_verified:true});
  assert.equal(r.status,"missing_required_fields");assert.ok(r.missing.includes("workType"));assert.equal(posted.length,before);
});
test("a confirmation already visible before the click cannot confirm a new entry",async()=>{
  const {runtime}=agent();const r=await runtime.formEntry({url:base+"/ambiguous",submit:true,rules_verified:true});
  assert.equal(r.status,"submitted_unconfirmed");assert.equal(r.confirmed,false);
  const second=await runtime.formEntry({url:base+"/ambiguous",submit:true,rules_verified:true});
  assert.equal(second.status,"prior_submission_needs_verification");
});
test("multi-tab preparation is parallel, returns a retrievable URL and retains filled pages",async()=>{
  const {runtime,deps}=agent();const urls=[base+"/slow/a",base+"/slow/b",base+"/slow/c"];
  const r=await runtime.prepare({profile:"daily",urls});
  assert.equal(r.login_url,"https://fixture-session.trycloudflare.com/control");assert.equal(r.pages.length,3);
  assert.equal(new Set(r.pages.map(p=>p.url)).size,3);assert.ok(r.pages.every(p=>p.filled.includes("emailConfirm")));
  const status=await runtime.dispatch({task:"login_status"});assert.equal(status.active,true);assert.equal(status.login_url,r.login_url);
  for(const page of deps.getLoginState().context.pages())assert.equal(await page.locator('[name="emailConfirm"]').inputValue(),profile.email);
  const preserved=await runtime.formEntry({url:urls[0],submit:true,rules_verified:true});
  assert.equal(preserved.status,"manual_entry_pending");assert.equal((await runtime.dispatch({task:"login_status"})).active,true);
  await deps.stopLogin();
});
