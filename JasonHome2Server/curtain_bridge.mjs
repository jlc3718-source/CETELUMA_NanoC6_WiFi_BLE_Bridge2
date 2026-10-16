// Durable Oracle-owned curtain transport. All bridge traffic is initiated outbound.
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {compileAsset} from './curtain_asset.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(status,message)=>Object.assign(Error(message),{status});
const int=(v,a,b)=>Number.isInteger(v)&&v>=a&&v<=b;
const UUIDS=new Set(['01020074-1972-1925-3022-077119514e44','02020074-1972-1925-3022-077119514e44','27923001-2072-1925-3022-077119514e44']);
export function validateCommand(action,p={}){
 if(!p||typeof p!=='object'||Array.isArray(p))throw fail(400,'Invalid command payload');
 if(['connect','disconnect','scan','status','sequenceStop','assetStop',
      'nanoInfo','nanoFirmwareCheck','nanoInstallUpdate','nanoReboot','nanoResumeOracle'].includes(action))return {};
 if(action==='nanoAutoUpdate'){if(typeof p.enabled!=='boolean')throw fail(400,'Auto-update must be boolean');return {enabled:p.enabled};}
 if(action==='power'){const on=p.on??p.value;if(typeof on!=='boolean')throw fail(400,'Power must be boolean');return {on};}
 if(action==='brightness'||action==='speed'){if(!int(p.value,action==='brightness'?0:1,100))throw fail(400,'Value must be 0–100 (speed 1–100)');return {value:p.value};}
 if(action==='layout'){if(![0,4,5,6].includes(p.value))throw fail(400,'Unsupported layout');return {value:p.value};}
 if(action==='nativePlay'){if(p.cid!==83928||!int(p.slot,0,255))throw fail(400,'Only the verified CID 83928 slot is supported');return {cid:p.cid,slot:p.slot};}
 if(action==='effect'){if(!int(p.id,0,87))throw fail(400,'Only captured E-0 through E-87 are supported');return {id:p.id};}
 if(action==='sequenceStart'){if(!Array.isArray(p.effects)||p.effects.length<2||p.effects.length>88||!p.effects.every(x=>int(x,0,87))||!int(p.intervalSeconds,5,3600))throw fail(400,'Invalid native effect sequence');return {effects:p.effects,intervalSeconds:p.intervalSeconds};}
 if(action==='asset'){if(!/^[a-f0-9]{64}$/.test(p.sha256))throw fail(400,'Invalid asset digest');return {sha256:p.sha256};}
 if(action==='rawWrite'){const uuid=String(p.uuid).toLowerCase(),bytes=Buffer.from(String(p.data||''),'base64');if(!UUIDS.has(uuid)||bytes.length<1||bytes.length>508)throw fail(400,'Unsupported characteristic or packet size');return {uuid,data:bytes.toString('base64')};}
 if(action==='subscribeRaw'){if(String(p.uuid).toLowerCase()!=='01010074-1972-1925-3022-077119514e44')throw fail(400,'Unsupported notification characteristic');return {uuid:p.uuid};}
 throw fail(400,'Unsupported curtain action');
}
export function createCurtainBridge({db,now=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS curtain_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS curtain_commands(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',created INTEGER NOT NULL,expires INTEGER NOT NULL,result TEXT,idempotency TEXT UNIQUE,source TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS curtain_assets(sha TEXT PRIMARY KEY,bytes BLOB NOT NULL,metadata TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS curtain_schedules(id TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS curtain_asset_slots(target TEXT PRIMARY KEY,active_sha TEXT,pending_sha TEXT,pending_command INTEGER,pending_at INTEGER,active_at INTEGER,generation INTEGER NOT NULL DEFAULT 0,phase TEXT NOT NULL DEFAULT 'idle',physical_confirmed INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '');`);
 const get=(k,d=null)=>{const r=db.prepare('SELECT value FROM curtain_meta WHERE key=?').get(k);return r?JSON.parse(r.value):d;};
 const put=(k,v)=>db.prepare('INSERT INTO curtain_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v));

 const TARGET='curtain0',STAGED_TTL=15*60*1000;
 // Atomic references; database stores the original prepared packet stream.
 const slot=()=>db.prepare('SELECT * FROM curtain_asset_slots WHERE target=?').get(TARGET);
 const hasAsset=sha=>!!(sha&&db.prepare('SELECT sha FROM curtain_assets WHERE sha=?').get(sha));
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};

 function assetManifest(sha){const r=db.prepare('SELECT length(bytes) size,metadata FROM curtain_assets WHERE sha=?').get(sha);return r?{sha256:sha,bytes:r.size,...JSON.parse(r.metadata)}:null;}
 function garbageCollect(){
  db.prepare('DELETE FROM curtain_assets WHERE sha NOT IN (SELECT active_sha FROM curtain_asset_slots WHERE active_sha IS NOT NULL UNION SELECT pending_sha FROM curtain_asset_slots WHERE pending_sha IS NOT NULL)').run();
 }
 function retained(){
  const r=slot(),item=sha=>sha?assetManifest(sha):null;
  const row=db.prepare('SELECT count(*) n,coalesce(sum(length(bytes)),0) total FROM curtain_assets').get();
  return {target:TARGET,generation:r.generation,active:item(r.active_sha),pending:item(r.pending_sha),
   pendingCommandId:r.pending_command,phase:r.phase,physicalPlaybackConfirmed:!!r.physical_confirmed,
   lastError:r.last_error,retainedFiles:row.n,retainedBytes:row.total,maxFilesPerTarget:2,
   maxFileBytes:4194304,pendingTimeoutSeconds:STAGED_TTL/1000};
 }
 function transition(sha,commandId,phase,confirmed=false){
  if(confirmed){
   db.prepare("UPDATE curtain_asset_slots SET active_sha=?,pending_sha=NULL,pending_command=NULL,pending_at=NULL,active_at=?,generation=generation+1,phase=?,physical_confirmed=1,last_error='' WHERE target=?")
     .run(sha,now(),phase,TARGET);
  }else{
   db.prepare("UPDATE curtain_asset_slots SET phase=?,pending_command=?,last_error='' WHERE target=?").run(phase,commandId,TARGET);
  }
  garbageCollect();
 }
 function expireStaging(){
  const r=slot();if(!r?.pending_sha||!r.pending_at||now()-r.pending_at<STAGED_TTL)return;
  const c=r.pending_command&&db.prepare('SELECT state FROM curtain_commands WHERE id=?').get(r.pending_command);
  // An in-flight stream or a delivered image must retain its data.
  if(c&&['queued','downloaded','applied'].includes(c.state))return;
  transaction(()=>{db.prepare("UPDATE curtain_asset_slots SET pending_sha=NULL,pending_command=NULL,pending_at=NULL,phase='expired',last_error='Unused replacement staging expired' WHERE target=?").run(TARGET);garbageCollect();});
 }
 function confirmDisplayed(id){
  if(!int(id,1,Number.MAX_SAFE_INTEGER))throw fail(400,'Valid curtain command ID required');
  const c=command(id),r=slot();
  if(c.state!=='applied'||c.result?.bleTransmitted!==true)
   throw fail(409,'Curtain command was not transmitted');
  if(c.action!=='asset'||r.pending_command!==id||r.pending_sha!==c.payload.sha256)
   throw fail(409,'Only the current staged image can be confirmed');
  transaction(()=>{
   transition(c.payload.sha256,id,'confirmed_displayed',true);
   const result={...(c.result||{}),physicalPlaybackConfirmed:true,confirmedBy:'user-observed-curtain',confirmedAt:now()};
   db.prepare('UPDATE curtain_commands SET result=? WHERE id=?').run(JSON.stringify(result),id);
  });
  signal();return {ok:true,...retained()};
 }
 if(!slot()){
  // Preserve one recoverable legacy content reference; don't assert physical
  // confirmation based merely on existing desired-state metadata.
  const desired=get('desired',{}),sha=desired.visual?.action==='asset'?desired.visual?.payload?.sha256:null;
  const active=hasAsset(sha)?sha:null;
  db.prepare('INSERT INTO curtain_asset_slots(target,active_sha,active_at,phase,physical_confirmed) VALUES(?,?,?,?,0)')
    .run(TARGET,active,active?now():null,active?'legacy_unconfirmed':'idle');
 }
 expireStaging();transaction(garbageCollect);
 let wake=new Set(),subscribers=new Set();
 // Active outbound Nano connections receive a push immediately on enqueue.
 function signal(){for(const f of wake)f();wake.clear();for(const f of subscribers)f();}
 function subscribeWake(fn){subscribers.add(fn);return ()=>subscribers.delete(fn);}
 function revision(){return Number(db.prepare('SELECT coalesce(max(id),0) n FROM curtain_commands').get().n);}
 function pairing(){const token=randomBytes(32).toString('hex'),id=get('bridgeId')||randomBytes(8).toString('hex');put('bridgeId',id);put('tokenHash',hash(token));put('pendingTokenHash','');put('rotateCredential',false);return {ok:true,endpoint:'https://150.136.245.51/jason-home-2',bridgeId:id,token};}
 function requestToken(req){
  const bearer=String(req.headers.authorization||'').replace(/^Bearer /,''),alternate=String(req.headers['x-jh2-bridge-token']||'').trim();
  // Reject conflicting credentials instead of guessing which proxy path is authoritative.
  return bearer&&alternate&&bearer!==alternate?'':alternate||bearer;
 }
 function authenticate(req){const token=requestToken(req);if(token.length!==64)return null;const actual=Buffer.from(hash(token));for(const [slot,key] of [['current','tokenHash'],['pending','pendingTokenHash']]){const expected=get(key);if(typeof expected==='string'&&expected.length===64&&timingSafeEqual(actual,Buffer.from(expected)))return slot;}return null;}
 function authorized(req){return authenticate(req)!==null;}
 function requestRotation(){if(!get('tokenHash'))throw fail(409,'Pair NanoC6 before rotating its bridge credential');put('rotateCredential',true);signal();return {ok:true,pending:true};}
 function versionAtLeast(value,wanted){const a=String(value||'').split('.').map(Number),b=wanted.split('.').map(Number);if(a.length!==3||a.some(x=>!Number.isInteger(x)||x<0))return false;for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return true;}
 function status(){const s=get('status',{}),last=db.prepare('SELECT id,action,state,result,created FROM curtain_commands ORDER BY id DESC LIMIT 1').get();return {ok:true,configured:!!get('tokenHash'),bridgeId:get('bridgeId'),online:now()-(get('lastSeen',0))<90000,lastSeen:get('lastSeen'),lastSync:get('lastSync'),pollSeconds:5,lowLatency:'outbound-long-poll',credentialRotationPending:get('rotateCredential',false)===true,...s,lastCommand:last?{...last,result:last.result?JSON.parse(last.result):null}:null,queued:Number(db.prepare("SELECT count(*) n FROM curtain_commands WHERE state IN ('queued','downloaded')").get().n),assetLimitBytes:4194304,assetStorage:"oracle",relayBufferBytes:10240,assetRetention:retained(),desired:get('desired',{}),manualUntil:get('manualUntil',0),scheduleRevision:get('scheduleRevision',0)};}
 function enqueue(action,payload={},idempotency=null,source='manual'){
  payload=validateCommand(action,payload);if(idempotency&&!/^[\w:.-]{1,100}$/.test(idempotency))throw fail(400,'Invalid idempotency key');
  if(idempotency){const r=db.prepare('SELECT * FROM curtain_commands WHERE idempotency=?').get(idempotency);if(r)return view(r);}
  const transient=['rawWrite','subscribeRaw','scan','connect','disconnect','status','nanoInfo','nanoFirmwareCheck','nanoInstallUpdate','nanoReboot','nanoResumeOracle','nanoAutoUpdate'].includes(action);
  if(action==='asset'&&!db.prepare('SELECT sha FROM curtain_assets WHERE sha=?').get(payload.sha256))throw fail(404,'Asset is missing');
  if(action==='asset'&&![slot().active_sha,slot().pending_sha].includes(payload.sha256))throw fail(409,'Asset is no longer staged or active');
  const key=['asset','effect','nativePlay','sequenceStart','sequenceStop','assetStop'].includes(action)?'visual':action;
  if(!transient){
   const desired=get('desired',{});desired[key]={action,payload};put('desired',desired);
   const old=db.prepare("SELECT id,action FROM curtain_commands WHERE state='queued'").all();for(const c of old)if((['asset','effect','nativePlay','sequenceStart','sequenceStop','assetStop'].includes(c.action)?'visual':c.action)===key)db.prepare("UPDATE curtain_commands SET state='superseded' WHERE id=?").run(c.id);
  }
  if(source==='manual'&&!['status','scan','subscribeRaw','connect'].includes(action)){put('manualUntil',now()+15*60000);put('scheduleActive',null);put('overrideRevision',get('overrideRevision',0)+1);}
  db.prepare("DELETE FROM curtain_commands WHERE state NOT IN ('queued','downloaded') AND id NOT IN (SELECT id FROM curtain_commands ORDER BY id DESC LIMIT 2000)").run();
  if(Number(db.prepare("SELECT count(*) n FROM curtain_commands WHERE state IN ('queued','downloaded')").get().n)>=256)throw fail(429,'Curtain queue is full');
  const r=db.prepare('INSERT INTO curtain_commands(action,payload,created,expires,idempotency,source) VALUES(?,?,?,?,?,?)').run(action,JSON.stringify(payload),now(),transient?now()+60000:now()+86400000,idempotency,source);
  if(action==='asset'&&slot().pending_sha===payload.sha256)db.prepare("UPDATE curtain_asset_slots SET pending_command=?,phase='queued' WHERE target=?").run(Number(r.lastInsertRowid),TARGET);
  signal();return view(db.prepare('SELECT * FROM curtain_commands WHERE id=?').get(r.lastInsertRowid));
 }
 function view(r){return {...r,payload:JSON.parse(r.payload),result:r.result?JSON.parse(r.result):null,physicalPlaybackConfirmed:false};}
 function command(id){const r=db.prepare('SELECT * FROM curtain_commands WHERE id=?').get(id);if(!r)throw fail(404,'Command missing');return view(r);}
 function tick(){
  if(get('manualUntil',0)>now())return;
  const all=schedules().filter(s=>s.enabled&&s.start<=now()&&s.end>now()).sort((a,b)=>b.start-a.start),active=all[0];
  const key=active?active.id+':'+active.start:'off';if(get('scheduleActive')===key)return;
  // Never turn anything off merely because an installation has no curtain schedules.
  if(!active&&!get('scheduleActive'))return;
  put('scheduleActive',key);
  if(active)enqueue(active.action,active.payload,'schedule:'+key+':'+get('overrideRevision',0),'schedule');else enqueue('power',{on:false},'schedule:off:'+get('scheduleRevision',0)+':'+now(),'schedule');
 }
 function schedules(){return db.prepare('SELECT value FROM curtain_schedules').all().map(x=>JSON.parse(x.value));}
 function saveSchedule(s){
  if(!/^[\w-]{1,80}$/.test(s.id||'')||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.end<=s.start||s.end-s.start>31*86400000)throw fail(400,'Supply a valid start and end date');
  const payload=validateCommand(s.action,s.payload);if(!['asset','effect','nativePlay','sequenceStart','power'].includes(s.action))throw fail(400,'Unsupported scheduled action');
  if(s.action==='asset'&&!db.prepare('SELECT sha FROM curtain_assets WHERE sha=?').get(payload.sha256))throw fail(404,'Scheduled asset is missing');
  const value={id:s.id,name:String(s.name||'Curtain scene').slice(0,100),enabled:s.enabled!==false,start:s.start,end:s.end,action:s.action,payload};db.prepare('INSERT INTO curtain_schedules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(s.id,JSON.stringify(value));put('scheduleRevision',get('scheduleRevision',0)+1);put('scheduleActive','changed');tick();signal();return value;
 }
 function resume(){put('manualUntil',0);put('scheduleActive',null);tick();for(const d of Object.values(get('desired',{})))enqueue(d.action,d.payload,null,'recovery');signal();return status();}
 function sync(body,credential='current'){
  tick();const at=now();put('lastSeen',at);put('lastSync',at);
  if(credential==='pending'){
   const pending=get('pendingTokenHash');if(pending){put('tokenHash',pending);put('pendingTokenHash','');put('rotateCredential',false);put('credentialRotatedAt',at);}
  }
  const bleReconnected=get('status',{}).curtain?.connected===false&&body.status?.curtain?.connected===true;
  const endedOverride=get('localOverride',0)>0&&Number(body.localOverrideUntil||0)<=at;
  const reboot=typeof body.bootId==='string'&&body.bootId!==get('bootId');
  put('localOverride',Number(body.localOverrideUntil||0));
  if(reboot){put('bootId',body.bootId);put('notifications',[]);}
  if((reboot||endedOverride||bleReconnected||body.recoverDesired===true)&&get('localOverride',0)<=at){
   const desired=get('desired',{});for(const key of ['visual','brightness','speed','layout','power'])if(desired[key]){const d=desired[key];const pending=db.prepare("SELECT id FROM curtain_commands WHERE action=? AND payload=? AND state IN ('queued','downloaded')").get(d.action,JSON.stringify(d.payload));if(!pending)enqueue(d.action,d.payload,null,'recovery');}
  }

  if(body.status&&typeof body.status==='object')put('status',JSON.parse(JSON.stringify(body.status).length<=12000?JSON.stringify(body.status):'{}'));
  if(Array.isArray(body.notifications))put('notifications',body.notifications.slice(-48));
  for(const ack of (body.acks||[]).slice(0,32)){
   if(!int(ack.id,1,Number.MAX_SAFE_INTEGER)||!['downloaded','applied','failed'].includes(ack.state))continue;
   const old=db.prepare('SELECT state,action,payload FROM curtain_commands WHERE id=?').get(ack.id);
   if(!old||!['queued','downloaded'].includes(old.state))continue;
   const result=ack.result&&typeof ack.result==='object'?ack.result:{};
   db.prepare('UPDATE curtain_commands SET state=?,result=? WHERE id=?').run(ack.state,JSON.stringify(result).slice(0,12000),ack.id);
   const displaySelection=['asset','effect','nativePlay','sequenceStart','sequenceStop','assetStop'].includes(old.action)||
    (old.action==='power'&&JSON.parse(old.payload)?.on===false);
   if(old.action==='asset'&&slot().pending_command===ack.id){
    if(ack.state==='applied'&&result.bleTransmitted===true){
     if(result.physicalPlaybackConfirmed===true)transition(JSON.parse(old.payload).sha256,ack.id,'confirmed_displayed',true);
     else transition(null,ack.id,'transferred_unconfirmed');
    }else if(ack.state==='failed'){
     db.prepare("UPDATE curtain_asset_slots SET pending_sha=NULL,pending_command=NULL,pending_at=NULL,phase='failed',last_error=? WHERE target=?")
       .run(String(result.error||'Transfer failed').slice(0,250),TARGET);
     garbageCollect();
    }else if(ack.state==='downloaded')transition(null,ack.id,'transferring');
   }else if(displaySelection&&ack.state==='applied'&&result.physicalPlaybackConfirmed===true){
    // A builtin/off command only frees the active file after a supported
    // positive activation signal, not merely BLE delivery.
    transition(null,ack.id,'confirmed_builtin_or_off',true);
   }
  }
  db.prepare("UPDATE curtain_commands SET state='expired' WHERE state IN ('queued','downloaded') AND expires<?").run(at);
  let rows=db.prepare("SELECT * FROM curtain_commands WHERE state IN ('queued','downloaded') ORDER BY id LIMIT 8").all();
  // A local direct-BLE test blocks scheduled commands, but never traps an explicit remote manual command for 15 minutes.
  if(Number(body.localOverrideUntil)>at)rows=rows.filter(row=>row.source==='manual');
  const desired=get('desired',{}),assetIds=new Set([desired.visual?.payload?.sha256,...schedules().map(s=>s.payload?.sha256)].filter(Boolean));
  const assets=[...assetIds].map(sha=>assetManifest(sha)).filter(Boolean);
  let credentialUpdate=null;
  if(credential==='current'&&get('rotateCredential',false)===true&&versionAtLeast(body.status?.firmware,'1.1.2')){
   const next=randomBytes(32).toString('hex');put('pendingTokenHash',hash(next));credentialUpdate={endpoint:'https://150.136.245.51/jason-home-2',bridgeId:get('bridgeId'),token:next};
  }
  return {ok:true,serverTime:at,pollSeconds:5,commands:rows.map(view),assets,desired,scheduleRevision:get('scheduleRevision',0),schedule:schedules().filter(s=>s.enabled&&s.end>at&&s.start<at+86400000).slice(0,32),manualUntil:get('manualUntil',0),scheduleActive:get('scheduleActive'),revision:Number(db.prepare('SELECT coalesce(max(id),0) n FROM curtain_commands').get().n),credential:credentialUpdate};
 }

 function upload(input){
  let a;try{a=compileAsset(input);}catch(e){throw fail(413,e.message);}
  if(input?.target&&input.target!==TARGET)throw fail(400,'Unknown curtain target');
  const metadata={format:a.format,frames:a.frames,loop:a.loop,name:String(input.name||'Curtain asset').slice(0,100)};
  return transaction(()=>{
   const r=slot(),sameActive=r.active_sha===a.sha256,samePending=r.pending_sha===a.sha256;
   if(!sameActive&&!samePending&&r.pending_sha){
    const c=r.pending_command&&db.prepare('SELECT state FROM curtain_commands WHERE id=?').get(r.pending_command);
    if(c&&['queued','downloaded','applied'].includes(c.state))
     throw fail(409,'Replacement is still transferring or awaiting visual confirmation');
   }
   db.prepare('INSERT OR IGNORE INTO curtain_assets VALUES(?,?,?,?)').run(a.sha256,a.bytes,JSON.stringify(metadata),now());
   if(!sameActive&&!samePending)
    db.prepare("UPDATE curtain_asset_slots SET pending_sha=?,pending_at=?,pending_command=NULL,phase='staged',last_error='' WHERE target=?")
      .run(a.sha256,now(),TARGET);
   garbageCollect();
   return {ok:true,...assetManifest(a.sha256),retention:retained(),alreadyActive:sameActive};
  });
 }
 async function wait(after,signalObj,seconds=20){if(Number(db.prepare('SELECT coalesce(max(id),0) n FROM curtain_commands').get().n)>after)return;await new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);wake.delete(finish);signalObj?.removeEventListener('abort',finish);resolve();};wake.add(finish);timer=setTimeout(finish,Math.max(1,Math.min(20,seconds))*1000);signalObj?.addEventListener('abort',finish,{once:true});});}
 const timer=setInterval(()=>{try{tick();expireStaging();}catch(error){put('storageTickError',String(error.message).slice(0,180));}},1000);timer.unref();
 return {status,pairing,authenticate,authorized,requestRotation,enqueue,command,sync,schedules,saveSchedule,resume,upload,retained,confirmDisplayed,assetManifest,asset:sha=>db.prepare('SELECT bytes FROM curtain_assets WHERE sha=?').get(sha)?.bytes,notifications:()=>get('notifications',[]),revision,subscribeWake,wait,close:()=>{clearInterval(timer);signal();subscribers.clear();},tick};
}
