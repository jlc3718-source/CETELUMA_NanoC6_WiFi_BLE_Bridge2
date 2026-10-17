/** Jason Home 2 Eufy-master schedule follower for SmartDawn NanoC6.
 * Follows current Eufy power and brightness automatically whenever the
 * Oracle bridge has Eufy master mode enabled. Never modifies Eufy.
 * All actions travel over the existing authenticated Oracle -> Nano bridge.
 */
export function createNanoC6BrightnessSync({meta,put,upstream,bridge,logger=console}) {
  const configured=!!bridge;
  let previousLevel=null,previousPower=null,busy=false,checkedAt=null,lastError='',
      lastApplied=null,lastQueuedPower=null,consecutiveErrors=0,online=false,
      lastUptime=null,pendingPower=null,pendingBrightness=null;
  const master=()=>bridge?.eufyMasterEnabled?.()===true;
  const enabled=()=>master()||meta('nanoc6_brightness_sync_enabled_v1',false)===true;
  const bridgeOnline=()=>{
    const current=typeof bridge?.status==='function'?bridge.status():null;
    return current?.online!==false;
  };
  const status=()=>({
    enabled:enabled(),eufyMasterSchedule:master(),configured,online:configured&&bridgeOnline()&&online,
    active:enabled()&&configured&&bridgeOnline()&&online,
    lastApplied,lastQueuedPower,lastCheckedAt:checkedAt,error:lastError||null,
    note:configured?'Follows Eufy on/off and brightness; queued commands require Nano ACK.':'Oracle curtain bridge unavailable.'
  });
  // A missing Eufy scene is "off" ONLY when the calendar explicitly reports
  // no current schedule. A failed/partial upstream response is never "off".
  function scheduledScene(state){
    const override=state?.override?.active===true;
    const scene=override?state.override?.scene:state?.calendar?.current?.scene;
    if(scene&&typeof scene==='object')
      return {known:true,on:scene.power!==false,brightness:scene.brightness};
    if(override)return {known:false};
    if(state?.calendar&&Object.hasOwn(state.calendar,'current')&&state.calendar.current===null)
      return {known:true,on:false};
    if(typeof state?.power==='boolean')return {known:true,on:state.power,brightness:state.brightness};
    return {known:false};
  }
  function confirmPending(key){
    const item=key==='power'?pendingPower:pendingBrightness;
    if(!item?.id||typeof bridge?.command!=='function')return;
    const state=bridge.command(item.id)?.state;
    if(state==='failed'||state==='expired'||state==='superseded'){
      if(key==='power'){previousPower=null;pendingPower=null;}
      else{previousLevel=null;pendingBrightness=null;}
    }else if(state==='applied'){
      if(key==='power')pendingPower=null;
      else pendingBrightness=null;
    }
  }
  function submit(action,payload,key){
    const result=bridge.enqueue(action,payload,null,'eufy-sync');
    if(key==='power')pendingPower={id:result?.id??null};
    else pendingBrightness={id:result?.id??null};
    return result;
  }
  async function poll(){
    if(busy||!enabled()||!configured)return status();
    busy=true;checkedAt=new Date().toISOString();
    try{
      const state=await upstream('/api/status'),desired=scheduledScene(state);
      if(!desired.known){lastError='Eufy schedule power state not available';online=bridgeOnline();return status();}
      const live=typeof bridge?.status==='function'?bridge.status():null;
      if(live&&Number.isFinite(live.uptimeSeconds)){
        if(lastUptime!==null&&live.uptimeSeconds+5<lastUptime){
          previousPower=null;previousLevel=null;pendingPower=null;pendingBrightness=null;
        }
        lastUptime=live.uptimeSeconds;
      }
      if(!bridgeOnline()||(typeof bridge?.manualHoldActive==='function'&&bridge.manualHoldActive())){
        // Any disconnected/manual interval can change actual curtain power.
        // Reconcile the current Eufy state when Nano ownership returns.
        previousPower=null;previousLevel=null;pendingPower=null;pendingBrightness=null;
        online=bridgeOnline();lastError='';return status();
      }
      confirmPending('power');confirmPending('brightness');
      if(previousPower!==desired.on){
        submit('power',{on:desired.on},'power');
        previousPower=desired.on;lastQueuedPower=desired.on;
        // Force brightness reconciliation after the curtain powers back on.
        if(desired.on)previousLevel=null;
        else{previousLevel=null;pendingBrightness=null;}
      }
      if(desired.on){
        const number=Number(desired.brightness);
        if(Number.isFinite(number)&&number>=1&&number<=100){
          const level=Math.round(number);
          if(previousLevel!==level){
            submit('brightness',{value:level},'brightness');
            previousLevel=level;lastApplied=level;
          }
        }
      }
      online=true;lastError='';consecutiveErrors=0;
    }catch(error){
      online=false;lastError=String(error?.message||error).slice(0,180);
      consecutiveErrors=Math.min(100,consecutiveErrors+1);
      if(consecutiveErrors===1||consecutiveErrors%10===0)logger.warn('NanoC6 Eufy schedule sync paused: '+lastError);
    }finally{busy=false;}
    return status();
  }
  async function setEnabled(value){
    if(typeof value!=='boolean')throw Error('Enable must be true or false');
    if(master()&&!value)throw Error('Curtain follows the Eufy master schedule; edit the Eufy scheduler to change on/off times.');
    if(value&&!configured)throw Error('NanoC6 is not configured on Oracle. No sync commands sent.');
    put('nanoc6_brightness_sync_enabled_v1',value);
    previousPower=null;previousLevel=null;pendingPower=null;pendingBrightness=null;
    if(!value){lastError='';online=false;}
    return status();
  }
  const clock=setInterval(()=>{void poll();},5000);
  if(typeof clock.unref==='function')clock.unref();
  return {poll,setEnabled,status,close:()=>clearInterval(clock)};
}
