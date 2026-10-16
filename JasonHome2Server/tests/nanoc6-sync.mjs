import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNanoC6BrightnessSync} from '../nanoc6_sync.mjs';

test('NanoC6 sync defaults OFF, queues through Oracle only after opt-in, and suppresses duplicate brightness',async()=>{
  const store=new Map(),sent=[];
  let scene={brightness:40,power:true};
  const bridge={enqueue:(action,payload,idempotency,source)=>sent.push({action,payload,idempotency,source})};
  const follower=createNanoC6BrightnessSync({
    meta:(k,d)=>store.has(k)?store.get(k):d,
    put:(k,v)=>store.set(k,v),
    upstream:async()=>({calendar:{current:{scene}}}),
    bridge,
    logger:{warn:()=>{}}
  });
  try{
    assert.equal(follower.status().enabled,false);
    assert.equal(follower.status().configured,true);
    await follower.poll();assert.equal(sent.length,0);
    await follower.setEnabled(true);
    assert.equal(sent.length,0,'Checkbox must not send immediate control commands');
    await follower.poll();
    assert.deepEqual(sent[0],{action:'brightness',payload:{value:40},idempotency:null,source:'brightness-sync'});
    await follower.poll();assert.equal(sent.length,1,'Unchanged brightness must not be resent');
    scene={brightness:75,power:true};await follower.poll();
    assert.deepEqual(sent[1].payload,{value:75});
    scene={brightness:2,power:false};await follower.poll();
    assert.equal(sent.length,2,'Powered-off schedule must not send brightness');
    await follower.setEnabled(false);scene={brightness:99,power:true};
    await follower.poll();assert.equal(sent.length,2,'Disable immediately suppresses future writes');
  }finally{follower.close();}
});

test('NanoC6 sync refuses enable when Oracle bridge is unavailable',async()=>{
  const follower=createNanoC6BrightnessSync({
    meta:(k,d)=>d,put:()=>{throw Error('should not write')},
    upstream:async()=>{throw Error('should not poll')},logger:{warn:()=>{}}
  });
  try{
    assert.equal(follower.status().configured,false);
    await assert.rejects(follower.setEnabled(true),/not configured/);
    await follower.poll();
  }finally{follower.close();}
});

test('Brightness enqueue failures do not mark a failed command as synced',async()=>{
  let warning='',store=new Map([['nanoc6_brightness_sync_enabled_v1',true]]);
  const follower=createNanoC6BrightnessSync({
    meta:(k,d)=>store.has(k)?store.get(k):d,
    put:(k,v)=>store.set(k,v),
    upstream:async()=>({calendar:{current:{scene:{brightness:60,power:true}}}}),
    bridge:{enqueue:()=>{throw Error('Bridge enqueue unavailable');}},
    logger:{warn:s=>{warning=s;}}
  });
  try{
    await follower.poll();
    assert.equal(follower.status().lastApplied,null);
    assert.match(follower.status().error,/Bridge enqueue unavailable/);
    assert.match(warning,/Bridge enqueue unavailable/);
  }finally{follower.close();}
});

import {readFileSync} from 'node:fs';

test('Oracle deployment uses the current brightness follower via curtain bridge',()=>{
 const script=readFileSync(new URL('../../.github/scripts/deploy-curtain-relay.py',import.meta.url),'utf8');
 assert.match(script,/curtain_bridge\.mjs/);
 assert.match(script,/nanoc6_sync\.mjs/);
 assert.match(script,/bridge:curtainRelay/);
 assert.match(script,/live\.index\(bridge_init\)<live\.index\(new_sync\)/);
 assert.match(script,/relay\['pollSeconds'\]==5/);
});
