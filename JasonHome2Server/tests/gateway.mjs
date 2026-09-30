import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('separate web gateway authenticates, serves the UI, and reads the shared calendar',async()=>{
  const calendar={revision:1,settings:{mode:2,enabled:true,categoryMask:32767,on:1020,off:1380,startAtDusk:false,
    schedule2Enabled:true,schedule2EndAtDawn:false,schedule2End:360,overlap:0},events:[],customSchedules:[
      {id:'schedule-leap',name:'Leap Night',enabled:true,annual:false,year:2028,month:2,day:29,effect:'Breath',colors:[0x123456]}
    ],special:[]};
  const reads={status:0,calendar:0};
  const backend=http.createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test-key');
    if(req.url==='/api/status')reads.status++;
    if(req.url==='/api/calendar')reads.calendar++;
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
    const events=await fetch(base+'/api/events',{headers:{cookie}});
    const eventRows=(await events.json()).events;
    assert.equal(eventRows.length,0);
    const ai=await fetch(base+'/api/ai',{headers:{cookie}});
    const aiValue=await ai.json();
    assert.equal(aiValue.configured,false);
    assert.equal(aiValue.draft,null);
    assert.deepEqual(aiValue.applied,[]);
    const aiChat=await fetch(base+'/api/ai/chat',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({message:'make a Christmas idea'})});
    assert.equal(aiChat.status,409);
    const state=await fetch(base+'/api/state',{headers:{cookie}});
    const stateValue=await state.json();assert.ok(stateValue.ble,JSON.stringify(stateValue));assert.equal(stateValue.ble.connectedCount,4);
    assert.equal(stateValue.scheduledEvent.name,'Nothing scheduled for tonight');
    const month=await fetch(base+'/api/night-calendar?year=2028&month=2',{headers:{cookie}});
    const summary=await month.json();assert.equal(summary.days.length,29);
    assert.equal(summary.days[0].events.length,0);
    assert.deepEqual(summary.days[28].events[0],{id:'schedule-leap',name:'Leap Night',colors:['#123456'],effect:'Breath',speed:1,type:'Custom event'});
    await Promise.all(Array.from({length:6},()=>fetch(base+'/api/state',{headers:{cookie}}).then(r=>r.json())));
    assert.equal(reads.status,1,'concurrent screens share one status read');
    assert.equal(reads.calendar,1,'concurrent screens share one calendar read');
    assert.equal((await fetch(base+'/api/event',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
  }finally{
    child.kill();backend.close();rmSync(dir,{recursive:true,force:true});
  }
});
