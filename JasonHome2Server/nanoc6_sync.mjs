/** Jason Home 2 optional NanoC6 brightness follower.
 * Disabled by default. Secrets and reachable Nano endpoint are environment-only.
 * No Eufy schedule or Nano firmware is modified by this module.
 */
export function createNanoC6BrightnessSync({meta,put,upstream,bridge,logger=console}) {
  // Oracle owns the authenticated outbound NanoC6 bridge; no inbound Nano URL or PIN.
  const configured=!!bridge;
  let session='',previousLevel=null,busy=false,checkedAt=null,lastError='',
      lastApplied=null,consecutiveErrors=0,online=false;
  const enabled=()=>meta('nanoc6_brightness_sync_enabled_v1',false)===true;
  const status=()=>({
    enabled:enabled(),configured,online,active:enabled()&&configured&&online,
    lastApplied,lastCheckedAt:checkedAt,error:lastError||null,
    note:configured?'Brightness commands are queued through the Oracle curtain bridge.':
      'Oracle curtain bridge unavailable.'
  });
  async function writeBrightness(level){
    if(!bridge)throw Error('Oracle curtain bridge unavailable');
    bridge.enqueue('brightness',{value:level},null,'brightness-sync');
    return {ok:true,queued:true};
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
    if(!value){previousLevel=null;lastError='';online=false;}
    // Deliberately do not send any control command on checkbox change.
    // Commands happen only at the subsequent polling cycle, after checking Eufy scene.
    return status();
  }
  const clock=setInterval(()=>{void poll();},5000);
  if(typeof clock.unref==='function')clock.unref();
  return {poll,setEnabled,status,close:()=>clearInterval(clock)};
}
