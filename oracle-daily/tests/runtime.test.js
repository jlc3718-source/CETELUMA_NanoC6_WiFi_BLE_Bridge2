"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {publicResult,chooseForm,contactValue,resolveProfile,entryKey,deadline,isolatedContext,create}=require("../runtime");
const profile={name:"Example Tester",email:"example@invalid.test",phone:"2025550123",street:"123 Example Street",city:"Example",state:"NY",postal_code:"14772"};
test("search and newsletter controls cannot displace a real entry form",()=>{
  const forms=[
    {id:"search",text:"Search",fields:[{name:"q",type:"search"}],buttons:[{text:"Search"}]},
    {id:"newsletter",text:"Subscribe to our newsletter",fields:[{name:"email",type:"email"}],buttons:[{text:"Subscribe"}]},
    {id:"entry",text:"Name Email Subscribe to the newsletter Enter",fields:[{name:"name",type:"text",label:"Your name"},{name:"email",type:"email"}],buttons:[{text:"Enter"}]}
  ];
  assert.equal(chooseForm(forms).id,"entry");
});
test("equally plausible entry forms require an adapter rather than the first submit",()=>{
  const form={text:"Giveaway",fields:[{name:"email",type:"email"}],buttons:[{text:"Enter"}]};
  assert.equal(chooseForm([{...form,id:"a"},{...form,id:"b"}]),null);
});
test("a newsletter asking for a name is still excluded without an entry control",()=>{
  const newsletter={text:"Newsletter",fields:[{name:"name",type:"text"},{name:"email",type:"email"}],buttons:[{text:"Subscribe"}]};
  assert.equal(chooseForm([newsletter]),null);
});
test("email confirmation and state are filled from known contact data",()=>{
  assert.equal(contactValue({name:"emailConfirm",type:"text",id:"",label:"Confirm email",autocomplete:""},profile),profile.email);
  assert.equal(contactValue({name:"state",type:"text",id:"",label:"State",autocomplete:""},profile),"NY");
  assert.equal(contactValue({name:"yearsTrade",type:"text",id:"",label:"Years in trade",autocomplete:""},profile),undefined);
});
test("PA cannot replace an eligible NY residence or invent a missing address",()=>{
  assert.equal(resolveProfile(profile,{}),profile);
  assert.throws(()=>resolveProfile(profile,{residency:"PA",eligibility:{ny:true,pa:true}}),/NY exclusion/);
  assert.throws(()=>resolveProfile(profile,{residency:"PA",eligibility:{ny:false,pa:true}}),/private vault/);
});
test("daily and monthly duplicate keys use the user's local calendar",()=>{
  const job={campaign_id:"sample",frequency:"daily"};
  assert.equal(entryKey(job,new Date("2026-10-11T03:59:00Z")),"sample:2026-10-10");
  assert.equal(entryKey(job,new Date("2026-10-11T04:01:00Z")),"sample:2026-10-11");
  assert.equal(entryKey({...job,frequency:"monthly"},new Date("2026-11-01T03:59:00Z")),"sample:2026-10");
});
test("sanitization preserves caption evidence, query parameters and numeric study IDs",()=>{
  const out=publicResult({url:"https://example.test/study/98633/?model=EV&token=secret",hits:[{snippets:["New giveaway"]}],recent_scanned:5,email:profile.email,text:profile.email});
  assert.match(out.url,/98633/);assert.match(out.url,/model=EV/);assert.doesNotMatch(out.url,/token=secret/);
  assert.equal(out.hits[0].snippets[0],"New giveaway");assert.equal(out.recent_scanned,5);assert.equal(out.email,"[REDACTED]");
});
test("timed out lanes close only their pages and reject late page creation",async()=>{
  let closed=0,otherClosed=false;
  const base={newPage:async()=>({isClosed:()=>false,close:async()=>{closed++;}}),close:async()=>{otherClosed=true;}};
  const lane=isolatedContext(base);await lane.context.newPage();
  await assert.rejects(deadline(new Promise(()=>{}),15,lane.close),/bounded_timeout/);
  assert.equal(closed,1);assert.equal(otherClosed,false);await assert.rejects(lane.context.newPage(),/lane_cancelled/);
});
test("completed jobs survive a restart and repeated IDs do not repeat an action",async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"daily-test-"));
  const deps={dataDir,getLoginState:()=>({}),readEntryProfile:()=>profile};
  const a=create(deps);let calls=0;
  const job={id:"sample-once",task:"test"};
  await a.submit(job,async()=>{calls++;return {status:"confirmed"};});
  const b=create(deps);const again=await b.submit(job,async()=>{calls++;return {status:"confirmed"};});
  assert.equal(calls,1);assert.equal(again.result.status,"confirmed");fs.rmSync(dataDir,{recursive:true,force:true});
});
test("interrupted jobs cannot repeat an unknown action after restart",async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),"daily-interrupted-")),dir=path.join(dataDir,"run-daily");
  fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,"jobs-v2.json"),JSON.stringify({"unknown-action":{id:"unknown-action",task:"test",status:"running"}}));
  const runtime=create({dataDir,getLoginState:()=>({}),readEntryProfile:()=>profile});let calls=0;
  const r=await runtime.submit({id:"unknown-action",task:"test"},async()=>{calls++;return {status:"confirmed"};});
  assert.equal(r.result.status,"interrupted_reconcile_required");assert.equal(calls,0);
  fs.rmSync(dataDir,{recursive:true,force:true});
});
