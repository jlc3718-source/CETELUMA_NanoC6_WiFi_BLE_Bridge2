import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('separate web gateway authenticates, serves the UI, and reads the shared calendar',async()=>{
  const calendar={revision:1,settings:{mode:2,enabled:true,categoryMask:32767},events:[],customSchedules:[],special:[]};
  const backend=http.createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test-key');
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
    assert.match(await ui.text(),/Jason Home 2/);
    const events=await fetch(base+'/api/events',{headers:{cookie}});
    assert.equal((await events.json()).events.length,0);
    const state=await fetch(base+'/api/state',{headers:{cookie}});
    assert.equal((await state.json()).ble.connectedCount,4);
    assert.equal((await fetch(base+'/api/event',{method:'POST',headers:{cookie,origin:'https://evil.example','content-type':'application/json'},body:'{}'})).status,403);
  }finally{
    child.kill();backend.close();rmSync(dir,{recursive:true,force:true});
  }
});
