import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('separate web gateway authenticates, serves the UI, and reads the shared calendar',async()=>{
  let calendar={revision:1,settings:{mode:2,enabled:true,categoryMask:32767,on:1020,off:1380,startAtDusk:false,
    schedule2Enabled:true,schedule2EndAtDawn:false,schedule2End:360,overlap:0},events:[
      {id:'evt179',name:'Halloween',kind:'Holiday',rule:'Fixed',month:10,day:31,weekday:0,nth:0,offsetDays:0,durationDays:1,effect:'Flow1',speed:2,colors:[0xff6600,0x8000ff],enabled:true,favorite:false,categoryIndex:0,major:true}
    ],customSchedules:[
      {id:'schedule-leap',name:'Leap Night',enabled:true,annual:false,year:2028,month:2,day:29,effect:'Breath',colors:[0x123456]}
    ],special:[]};
  const reads={status:0,calendar:0};
  const backend=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test-key');
    if(req.url==='/api/status')reads.status++;
    if(req.url==='/api/calendar')reads.calendar++;
    if(req.url==='/api/calendar/sync'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;
      calendar=JSON.parse(raw);res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,revision:calendar.revision}));return;
    }
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url==='/api/calendar'?{ok:true,calendar}:req.url==='/api/status'?{
      eufy:{ready:true,readyNames:['Pool','House','Garage','Shed']},calendar:{current:null},desired:[]
    }:{ok:true}));
  });
  await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
  const port=backend.address().port,frontendPort=port+1,dir=mkdtempSync(join(tmpdir(),'jason-home-2-'));
  const child=spawn(process.execPath,['--no-warnings=ExperimentalWarning',new URL('../server.mjs',import.meta.url).pathname],{
    env:{...process.env,JH2_PORT:String(frontendPort),JH2_DATA_DIR:dir,JH2_UPSTREAM_URL:`http://127.0.0.1:${port}`,JH2_UPSTREAM_TOKEN:'test-key'},stdio:'pipe'});
  try{
    const base=`http://127.0.0.1:${frontendPort}`;
    let ready=false;
    for(let i=0;i<50;i++){
      try{const r=await fetch(base+'/api/health');ready=r.ok;break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}
    }
    assert.ok(ready,'gateway started');
    assert.equal((await fetch(base+'/api/state')).status,401);
    const login=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'wrong'})});
    assert.equal(login.status,401);
    const valid=await fetch(base+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'test-key'})});
    assert.equal(valid.status,200);
    const cookie=valid.headers.get('set-cookie').split(';')[0];
    assert.match(valid.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
    const ui=await fetch(base+'/',{headers:{cookie}});
    const html=await ui.text();assert.match(html,/Jason Home 2/);
    assert.match(html,/night_calendar\.js/);
    const calendarUi=await fetch(base+'/night_calendar.js',{headers:{cookie}});
    const calendarJs=await calendarUi.text();
    assert.match(calendarJs,/\.v3ScheduleCard\{grid-template-columns:minmax\(0,1fr\)!important/);
    assert.match(calendarJs,/cell\.addEventListener\("click",\(\)=>showNight/);
    assert.match(calendarJs,/Show all schedules/);
    assert.match(html,/Restore Built-in Schedule/);
    assert.match(html,/Entire month/);
    assert.match(html,/Use custom time for this event/);
    const events=await fetch(base+'/api/events?year=2026&month=10',{headers:{cookie}});
    let eventRows=(await events.json()).events;
    const halloween=eventRows.find(e=>e.id==='evt179');assert.ok(halloween,JSON.stringify(eventRows));
    assert.equal(halloween.schedule.mode,'default');
    assert.equal(halloween.schedule.customized,false);
    const scheduleSave=await fetch(base+'/api/event',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({
      id:'evt179',schedule:{mode:'month',annual:true,year:2026,startMonth:10,startDay:1,endMonth:10,endDay:31,customTime:true,start:'18:30',end:'23:00'}
    })});
    assert.equal(scheduleSave.status,200);
    eventRows=(await (await fetch(base+'/api/events?year=2026&month=10',{headers:{cookie}})).json()).events;
    const edited=eventRows.find(e=>e.id==='evt179');assert.equal(edited.schedule.mode,'month');assert.equal(edited.schedule.customized,true);
    assert.equal(edited.schedule.start,'18:30');assert.equal(edited.schedule.end,'23:00');assert.match(edited.when,/all month/);assert.match(edited.when,/6:30 PM/);
    assert.equal(calendar.events.find(e=>e.id==='evt179').scheduleOverride.mode,'month');
    const resetSchedule=await fetch(base+'/api/event',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({id:'evt179',resetSchedule:true})});
    assert.equal(resetSchedule.status,200);
    assert.equal(calendar.events.find(e=>e.id==='evt179').scheduleOverride,undefined);
    const ai=await fetch(base+'/api/ai',{headers:{cookie}});
    const aiValue=await ai.json();
    assert.equal(aiValue.configured,false);
    assert.equal(aiValue.draft,null);
    const specialHalloween=aiValue.applied.find(e=>e.id==='ai-once-special-halloween-2026');
    assert.ok(specialHalloween,JSON.stringify(aiValue.applied));
    assert.equal(specialHalloween.name,'Special Halloween');
    assert.equal(specialHalloween.date,'2026-10-31');
    assert.equal(specialHalloween.replaceEventId,'evt179');
    assert.deepEqual(specialHalloween.colors,['#FF0D00','#5B00E6','#000000']);
    assert.equal(specialHalloween.layerCount,8);
    assert.deepEqual(specialHalloween.layers.map(x=>x.effect),['Flow1','Flow2','Flow1','Flow2','Flow1','Flow2','Flow1','Flow2']);
    assert.deepEqual(specialHalloween.layers.map(x=>x.pattern.blocks),[[4,3,1],[2,5,1],[5,2,1],[3,3,2],[4,2,2],[3,4,1],[2,4,2],[5,1,2]]);
    const aiChat=await fetch(base+'/api/ai/chat',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({message:'make a Christmas idea'})});
    assert.equal(aiChat.status,409);
    const state=await fetch(base+'/api/state',{headers:{cookie}});
    const stateValue=await state.json();assert.ok(stateValue.ble,JSON.stringify(stateValue));assert.equal(stateValue.ble.connectedCount,4);
    assert.equal(stateValue.scheduledEvent.name,'Nothing scheduled for tonight');
    const month=await fetch(base+'/api/night-calendar?year=2028&month=2',{headers:{cookie}});
    const summary=await month.json();assert.equal(summary.days.length,29);
    assert.equal(summary.days[0].events.length,0);
    assert.deepEqual(summary.days[28].events[0],{id:'schedule-leap',name:'Leap Night',colors:['#123456'],effect:'Breath',speed:1,type:'Custom event'});
    // Warm both shared GET caches first, then verify concurrent screens do not
    // create additional Oracle reads while those caches are still valid.
    await fetch(base+'/api/state',{headers:{cookie}}).then(r=>r.json());
    const statusBefore=reads.status,calendarBefore=reads.calendar;
    await Promise.all(Array.from({length:6},()=>fetch(base+'/api/state',{headers:{cookie}}).then(r=>r.json())));
    assert.equal(reads.status,statusBefore,'concurrent screens reuse the warm status cache');
    assert.equal(reads.calendar,calendarBefore,'concurrent screens reuse the warm calendar cache');
    assert.equal((await fetch(base+'/api/event',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
  }finally{
    child.kill();backend.close();rmSync(dir,{recursive:true,force:true});
  }
});
