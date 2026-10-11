/** Jason Home 2 optional NanoC6 brightness follower.
 * Disabled by default. Secrets and reachable Nano endpoint are environment-only.
 * No Eufy schedule or Nano firmware is modified by this module.
 */
export function createNanoC6BrightnessSync({meta,put,upstream,env=process.env,fetchFn=fetch,logger=console}) {
  const urlString=String(env.JH2_NANOC6_URL||'').trim();
  const pin=String(env.JH2_NANOC6_JASON_PIN||'').trim();
  let base;
  try {
    const parsed=new URL(urlString);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||
       parsed.search||parsed.hash||parsed.pathname!=='/')
      throw Error('Invalid configured NanoC6 endpoint');
    base=parsed;
  } catch {}
  const configured=!!(base&&/^\d{4}$/.test(pin));
  let session='',previousLevel=null,busy=false,checkedAt=null,lastError='',
      lastApplied=null,consecutiveErrors=0,online=false;
  const enabled=()=>meta('nanoc6_brightness_sync_enabled_v1',false)===true;
  const status=()=>({
    enabled:enabled(),configured,online,active:enabled()&&configured&&online,
    lastApplied,lastCheckedAt:checkedAt,error:lastError||null,
    note:configured?'NanoC6 must be reachable from the Oracle server; disabled means no commands sent.':
      'NanoC6 is disabled until a reachable JH2_NANOC6_URL and private JH2_NANOC6_JASON_PIN are configured on Oracle.'
  });
  async function request(path,method='GET',body,withSession=true){
    if(!configured)throw Error('NanoC6 private connection is not configured');
    const target=new URL(path,base);
    const headers={accept:'application/json'};
    if(body!==undefined)headers['content-type']='application/json';
    if(withSession&&session)headers['X-Anderson-Session']=session;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
    try {
      const response=await fetchFn(target,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
      let data;try{data=await response.json();}catch{data={};}
      if(!response.ok||data?.ok===false)throw Error('NanoC6 '+path+' HTTP '+response.status);
      return data;
    } finally {clearTimeout(timer);}
  }
  async function authenticate(){
    if(session)return;
    const result=await request('/api/auth/unlock','POST',{profile:'jason',pin},false);
    session=typeof result?.token==='string'?result.token:'';
  }
  async function writeBrightness(level){
    await authenticate();
    try{return await request('/api/control','POST',{brightness:level});}
    catch(error){
      // PIN sessions expire; refresh at most once. Never retry bad credentials forever.
      if(String(error?.message||'').includes('HTTP 401')){
        session='';await authenticate();return request('/api/control','POST',{brightness:level});
      }
      throw error;
    }
  }
  async function poll(){
    if(busy||!enabled()||!configured)return status();
    busy=true;checkedAt=new Date().toISOString();
    try{
      const state=await upstream('/api/status');
      const scene=state?.override?.active?(state.override.scene||null):(state?.calendar?.current?.scene||null);
      // Brightness follows the actual current Eufy scheduled/manual scene.
      // No scheduled, powered-on scene? Do NOT issue an arbitrary Nano command.
      if(!scene||scene.power===false){lastError='';return status();}
      const level=Math.max(1,Math.min(100,Math.round(Number(scene.brightness)||0)));
      if(!Number.isFinite(Number(scene.brightness))||Number(scene.brightness)<1)return status();
      if(previousLevel===level&&online)return status();
      await writeBrightness(level);
      previousLevel=level;lastApplied=level;lastError='';consecutiveErrors=0;online=true;
    }catch(error){
      online=false;session='';lastError=String(error?.message||error).slice(0,180);
      consecutiveErrors=Math.min(100,consecutiveErrors+1);
      if(consecutiveErrors===1||consecutiveErrors%10===0)logger.warn('NanoC6 sync paused: '+lastError);
    }finally{busy=false;}
    return status();
  }
  async function setEnabled(value){
    if(typeof value!=='boolean')throw Error('Enable must be true or false');
    if(value&&!configured)throw Error('NanoC6 is not configured on Oracle. No sync commands sent.');
    put('nanoc6_brightness_sync_enabled_v1',value);
    if(!value){previousLevel=null;lastError='';online=false;session='';}
    // Deliberately do not send any control command on checkbox change.
    // Commands happen only at the subsequent polling cycle, after checking Eufy scene.
    return status();
  }
  const clock=setInterval(()=>{void poll();},30000);
  if(typeof clock.unref==='function')clock.unref();
  return {poll,setEnabled,status,close:()=>clearInterval(clock)};
}
