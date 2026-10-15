import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNanoC6BrightnessSync} from '../nanoc6_sync.mjs';
test('NanoC6 remains OFF and sends nothing until checkbox is explicitly enabled',async()=>{
  const store=new Map(),sent=[];
  let scene={brightness:40,power:true};
  const remote=async (url,args)=>{
    const u=new URL(url);
    sent.push({path:u.pathname,args});
    if(u.pathname==='/api/auth/unlock')return {ok:true,status:200,json:async()=>({ok:true,token:'test-token'})};
    return {ok:true,status:200,json:async()=>({ok:true})};
  };
  const follower=createNanoC6BrightnessSync({
    meta:(k,d)=>store.has(k)?store.get(k):d,
    put:(k,v)=>store.set(k,v),
    upstream:async()=>({calendar:{current:{scene}}}),
    env:{JH2_NANOC6_URL:'http://192.0.2.10/',JH2_NANOC6_JASON_PIN:'1234'},
    fetchFn:remote,logger:{warn:()=>{}}
  });
  try{
    assert.equal(follower.status().enabled,false);
    await follower.poll();assert.equal(sent.length,0);
    await follower.setEnabled(true);
    assert.equal(sent.length,0,'Enable checkbox should never send an immediate command');
    await follower.poll();
    assert.deepEqual(sent.map(x=>x.path),['/api/auth/unlock','/api/control']);
    assert.deepEqual(JSON.parse(sent[1].args.body),{brightness:40});
    await follower.poll();assert.equal(sent.length,2,'Do not resend unchanged brightness');
    scene={brightness:75,power:true};await follower.poll();
    assert.equal(sent.length,3);assert.equal(JSON.parse(sent[2].args.body).brightness,75);
    scene={brightness:2,power:false};await follower.poll();
    assert.equal(sent.length,3,'No brightness writes when the schedule is off');
    await follower.setEnabled(false);scene={brightness:99,power:true};
    await follower.poll();assert.equal(sent.length,3,'Disable immediately suppresses all future writes');
  }finally{follower.close();}
});
test('NanoC6 cannot be enabled without private Oracle network configuration',async()=>{
 const follower=createNanoC6BrightnessSync({
   meta:(k,d)=>d,put:()=>{throw Error('should not write')},upstream:async()=>{throw Error('should not poll')},
   env:{},logger:{warn:()=>{}}
 });
 try{
   assert.equal(follower.status().configured,false);
   await assert.rejects(follower.setEnabled(true),/not configured/);
   await follower.poll();
 }finally{follower.close();}
});