/* Jason Home 2 SmartDawn DN5E58. Standalone tab: does not change Eufy, AI, Factory or schedules. */
(()=>{'use strict';
const patternGroups=[15193,15194,15195,15196,15197,15198,15199,15200,15201,15202,15203,15204,15205,15206,15207,15208,15209,15210,15211,15212,15213,15214,15215,15216,15217,15218,15219,15220,15221,15222,15224,15225,83494];
const patternIndexes=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,33];
const catalog=Array.from({length:87},(_,id)=>({id,name:`E-${id}`,group:id<55?15924:patternGroups[id-55],index:id<55?id:patternIndexes[id-55],type:id<55?3:1,verified:true}));

const $=id=>document.getElementById(id);
const create=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e};
let selected=null,connected=false,busy=false;
let serial=0;const requests=new Map();
window.__curtainNativeResult=(id,result)=>{const p=requests.get(id);if(!p)return;requests.delete(id);let data=result;try{if(typeof data==='string')data=JSON.parse(data)}catch{data={ok:false,error:'Malformed native Bluetooth response'}};if(data?.ok)p.resolve(data);else{const err=new Error(data?.error||`Bluetooth request failed${data?.status?' ('+data.status+')':''}`);err.devices=Array.isArray(data?.devices)?data.devices:[];p.reject(err);}};
function call(action,data={}){if(window.JH2OracleCurtainCall)return window.JH2OracleCurtainCall(action,data);return new Promise((resolve,reject)=>{if(!window.AndroidCurtain||typeof AndroidCurtain.call!=='function')return reject(new Error('Updated Jason Home 2 APK required for direct Bluetooth.'));const id=String(++serial);requests.set(id,{resolve,reject});try{AndroidCurtain.call(id,action,JSON.stringify(data));}catch(e){requests.delete(id);reject(e)}setTimeout(()=>{if(requests.has(id)){requests.delete(id);reject(new Error('Bluetooth '+action+' timed out. Try disconnecting SmartDawn and reconnecting.'))}},action==='connect'?65000:30000);});}
function init(){if($('jh2CurtainTab'))return;const nav=document.querySelector('.v3BottomNav')||document.querySelector('.nav');const container=document.querySelector('.wrap');if(!nav||!container)return;
  const tab=create('button','tab');tab.id='jh2CurtainTab';tab.type='button';tab.dataset.tab='curtain';tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 4h18M5 4v17m14-17v17M8 5v15m4-15v15m4-15v15"/></svg><span>Curtain</span>';
  const settings=nav.querySelector('.tab[data-tab="settings"]');nav.insertBefore(tab,settings||null);nav.style.gridTemplateColumns='repeat('+nav.querySelectorAll('.tab').length+',minmax(0,1fr))';
  const page=create('section','page jh2-curtain-page');page.dataset.page='curtain';page.hidden=true;
  page.innerHTML='<div class="v3PageTitle"><span>SMARTDAWN DN5E58</span><h2>Curtain Lights</h2></div>'+
    '<div class="panel"><strong>Power, brightness and speed</strong><div class="jh2-curtain-row" style="margin-top:12px"><button id="jh2CurtainOn" class="btn primary" type="button">On</button><button id="jh2CurtainOff" class="btn" type="button">Off</button></div><label class="jh2-curtain-label" for="jh2CurtainBrightness">Brightness <output id="jh2CurtainBrightnessOutput">100 / 100</output></label><input id="jh2CurtainBrightness" type="range" min="1" max="100" value="100"><div class="sub">Brightness 1 = actual curtain level 4 (lowest usable level). Brightness levels below 4 are never sent.</div><label class="jh2-curtain-label" for="jh2CurtainSpeed">Speed <output id="jh2CurtainSpeedOutput">100 / 100</output></label><input id="jh2CurtainSpeed" type="range" min="1" max="100" value="100"><div class="sub">Speed uses the original controller range of 1–100, unchanged.</div><div id="jh2CurtainStatus" class="jh2-curtain-status" role="status"></div></div>'+
    '<div class="panel"><strong>Effect sequence</strong><div class="sub">Enable selection mode to choose multiple original SmartDawn effects. Arrange their playback order, then choose the number of seconds each should play. Playback runs through NanoC6 and continues after closing the app.</div><label class="jh2-sequence-enable"><input type="checkbox" id="jh2CurtainSequenceEnable"> Enable effect sequence selection</label><label class="jh2-curtain-label" for="jh2CurtainSequenceSeconds">Time per effect (seconds, 5–3600)</label><input class="field" id="jh2CurtainSequenceSeconds" type="number" min="5" max="3600" step="1" value="60"><div id="jh2CurtainSequenceList" class="jh2-curtain-sequence-list"></div><div class="jh2-curtain-row"><button class="btn primary" type="button" id="jh2CurtainSequenceStart">Play sequence</button><button class="btn" type="button" id="jh2CurtainSequenceStop">Stop sequence</button></div><div class="sub" id="jh2CurtainSequenceStatus" role="status">Disabled • select two or more effects</div></div>'+
    '<div class="panel"><strong>87 SmartDawn effects</strong><div class="sub">Captured catalog: E-0 through E-86 (87 effects). Captured still preview images are recovered directly from your original SmartDawn screenshots.</div><input id="jh2CurtainSearch" class="field" placeholder="Find effect (e.g. E-55)" style="margin-top:10px" aria-label="Search curtain effects"><div id="jh2CurtainEffects" class="jh2-curtain-effect-grid"></div></div>';
  // Curtain Controls remain independent of Oracle Studio; redundant Nano tools removed.
  const heading=page.querySelector('.v3PageTitle');
  const controls=create('div','jh2-curtain-subpanel');
  controls.id='jh2CurtainOriginalControls';
  while(heading.nextSibling)controls.appendChild(heading.nextSibling);
  const subnav=create('div','jh2-curtain-subnav');
  subnav.setAttribute('role','tablist');
  subnav.setAttribute('aria-label','Curtain tools');
  const oldButton=create('button','btn jh2-curtain-subtab active','Curtain controls');
  oldButton.type='button';oldButton.id='jh2CurtainControlsTab';oldButton.setAttribute('role','tab');
  const studioButton=create('button','btn jh2-curtain-subtab','Image / GIF Studio');
  studioButton.type='button';studioButton.id='jh2CurtainStudioTab';studioButton.setAttribute('role','tab');
  const studio=create('div','jh2-curtain-subpanel jh2-curtain-converter-panel');
  studio.id='jh2CurtainStudioPanel';studio.hidden=true;
  const studioFrame=document.createElement('iframe');
  studioFrame.id='jh2CurtainStudioFrame';studioFrame.title='SmartDawn image and GIF quality converter';
  studioFrame.loading='lazy';studioFrame.setAttribute('referrerpolicy','same-origin');
  studio.appendChild(studioFrame);
  // Native Animation Test is an isolated research workspace. Never replace the
  // stable Studio iframe or its verified DN1FE installer.
  const testButton=create('button','btn jh2-curtain-subtab','🧪 Native test');
  testButton.type='button';testButton.id='jh2CurtainNativeTestTab';testButton.setAttribute('role','tab');
  const testPanel=create('div','jh2-curtain-subpanel jh2-curtain-converter-panel');
  testPanel.id='jh2CurtainNativeTestPanel';testPanel.hidden=true;
  const testFrame=document.createElement('iframe');
  testFrame.id='jh2CurtainNativeTestFrame';testFrame.title='SmartDawn experimental DNMX native animation testing';
  testFrame.loading='lazy';testFrame.setAttribute('referrerpolicy','same-origin');
  testPanel.appendChild(testFrame);
  subnav.append(oldButton,studioButton,testButton);
  page.append(subnav,controls,studio,testPanel);
  let pendingNativeTest=null;
  function deliverNativeTest(){
    if(pendingNativeTest&&testFrame.contentWindow&&testFrame.getAttribute('src'))
      testFrame.contentWindow.postMessage({kind:'jh2-native-test-frames',frames:pendingNativeTest.frames,delay:pendingNativeTest.delay},location.origin);
  }
  function selectCurtainSubtab(which){
    controls.hidden=which!=='controls';studio.hidden=which!=='studio';testPanel.hidden=which!=='test';
    controls.style.display=which==='controls'?'':'none';
    studio.style.display=which==='studio'?'':'none';
    testPanel.style.display=which==='test'?'':'none';
    for(const [node,active] of [[oldButton,which==='controls'],[studioButton,which==='studio'],[testButton,which==='test']]){
      node.classList.toggle('active',active);
      node.setAttribute('aria-selected',String(active));
    }
    if(which==='studio'&&!studioFrame.getAttribute('src'))studioFrame.src='curtain_converter.html';
    if(which==='test'&&!testFrame.getAttribute('src'))testFrame.src='curtain_native_test.html';
  }
  oldButton.addEventListener('click',()=>selectCurtainSubtab('controls'));
  studioButton.addEventListener('click',()=>selectCurtainSubtab('studio'));
  testButton.addEventListener('click',()=>selectCurtainSubtab('test'));
  // The two iframes share only the authenticated, allowlisted BLE transport.
  // All messages must originate from our exact same-origin child frames.
  window.addEventListener('message',async event=>{
    if(event.origin!==location.origin)return;
    const sender=event.source===studioFrame.contentWindow?studioFrame:event.source===testFrame.contentWindow?testFrame:null;
    if(!sender)return;
    const data=event.data||{};
    if(data.kind==='jh2-curtain-height'){
      const height=Number(data.height);
      if(Number.isFinite(height)&&height>=500&&height<=50000)sender.style.height=Math.ceil(height+16)+'px';
      return;
    }
    if(sender===studioFrame&&data.kind==='jh2-native-test-open'){
      const frames=data.frames,delay=Number(data.delay);
      if(!Array.isArray(frames)||frames.length<2||frames.length>24||frames.some(f=>!(f instanceof Uint8Array||f instanceof Uint8ClampedArray||Array.isArray(f))||f.length!==6400))return;
      pendingNativeTest={frames:frames.map(f=>new Uint8ClampedArray(f)),delay:Number.isFinite(delay)?delay:400};
      selectCurtainSubtab('test');
      // Frame transfer is completed by test iframe's ready handshake.
      if(testFrame.dataset.ready==='true')deliverNativeTest();
      return;
    }
    if(sender===testFrame&&data.kind==='jh2-native-test-ready'){
      testFrame.dataset.ready='true';deliverNativeTest();return;
    }
    if(data.kind!=='jh2-curtain-request')return;
    const id=String(data.id||'');
    if(!/^cv[0-9]{1,8}$/.test(id))return;
    try{
      const result=await call(data.action,data.payload||{});
      sender.contentWindow.postMessage({kind:'jh2-curtain-response',id,ok:true,result},location.origin);
    }catch(err){
      sender.contentWindow.postMessage({kind:'jh2-curtain-response',id,ok:false,error:err.message},location.origin);
    }
  });
  window.__jh2CurtainRawNotify=(uuid,data)=>{
    for(const frame of [studioFrame,testFrame]){
      if(frame.contentWindow&&frame.getAttribute('src'))frame.contentWindow.postMessage({kind:'jh2-curtain-notify',uuid,data},location.origin);
    }
  };
  selectCurtainSubtab('controls');
  container.appendChild(page);
  const status=(message,level='')=>{const n=$('jh2CurtainStatus');n.textContent=message;n.className='jh2-curtain-status '+level};
  const setBusy=b=>{busy=b;page.querySelectorAll('button').forEach(x=>x.disabled=b)};
  let playlist=[],sequencePlaying=false;
  try{
    const saved=JSON.parse(localStorage.getItem('jh2-smartdawn-sequence-v1')||'{}');
    if(Array.isArray(saved.effects))playlist=[...new Set(saved.effects.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=86))];
    $('jh2CurtainSequenceSeconds').value=String(Number.isInteger(saved.seconds)&&saved.seconds>=5&&saved.seconds<=3600?saved.seconds:60);
    $('jh2CurtainSequenceEnable').checked=saved.enabled===true;
  }catch(_){}
  function persistSequence(){
    try{localStorage.setItem('jh2-smartdawn-sequence-v1',JSON.stringify({
      enabled:$('jh2CurtainSequenceEnable').checked,
      effects:playlist,seconds:Number($('jh2CurtainSequenceSeconds').value)
    }));}catch(_){}
  }
  function renderSequence(){
    const list=$('jh2CurtainSequenceList');list.replaceChildren();
    for(let index=0;index<playlist.length;index++){
      const id=playlist[index],item=create('div','jh2-curtain-sequence-item'),name=create('strong','',String(index+1)+'. E-'+id);
      const up=create('button','btn','↑'),down=create('button','btn','↓'),remove=create('button','btn','×');
      for(const b of [up,down,remove])b.type='button';
      up.disabled=index===0;down.disabled=index===playlist.length-1;
      up.addEventListener('click',()=>{[playlist[index-1],playlist[index]]=[playlist[index],playlist[index-1]];persistSequence();renderSequence();render();});
      down.addEventListener('click',()=>{[playlist[index+1],playlist[index]]=[playlist[index],playlist[index+1]];persistSequence();renderSequence();render();});
      remove.addEventListener('click',()=>{playlist.splice(index,1);persistSequence();renderSequence();render();});
      item.append(name,up,down,remove);list.append(item);
    }
    const enabled=$('jh2CurtainSequenceEnable').checked;
    $('jh2CurtainSequenceStatus').textContent=sequencePlaying?'Sequence playing • '+playlist.map(id=>'E-'+id).join(' → '):
      enabled?playlist.length+' effects selected — tap preview tiles to add/remove':'Sequence selection disabled — individual effects play normally';
    $('jh2CurtainSequenceStart').disabled=playlist.length<2||!enabled;
  }
  $('jh2CurtainSequenceEnable').addEventListener('change',()=>{persistSequence();renderSequence();render();});
  $('jh2CurtainSequenceSeconds').addEventListener('change',()=>{persistSequence();renderSequence();});
  $('jh2CurtainSequenceStart').addEventListener('click',async()=>{
    if(playlist.length<2||!$('jh2CurtainSequenceEnable').checked){status('Enable sequence mode and select at least two captured effects.','error');return;}
    const seconds=Number($('jh2CurtainSequenceSeconds').value);
    if(!Number.isInteger(seconds)||seconds<5||seconds>3600){status('Select a whole-number interval of 5 to 3600 seconds.','error');return;}
    persistSequence();
    const answer=await perform('sequenceStart',{effects:[...playlist],intervalSeconds:seconds},'Play sequence');
    if(answer){sequencePlaying=answer.sequenceRunning===true;renderSequence();}
  });
  $('jh2CurtainSequenceStop').addEventListener('click',async()=>{
    const answer=await perform('sequenceStop',{},'Stop sequence');
    if(answer){sequencePlaying=false;renderSequence();}
  });

  const perform=async (action,data,label)=>{
    if(busy)return;
    setBusy(true);status(`${label}…`);
    try{
      const r=await call(action,data);
      connected=!!r.connected;
      if(typeof r.sequenceRunning==='boolean'){sequencePlaying=r.sequenceRunning;renderSequence();}
      status(`${label}: ${r.message||'Command delivered. Check the curtain lights.'}`,'success');
      return r;
    }catch(e){
      status(e.message,'error');
    }finally{setBusy(false)}
  };
  $('jh2CurtainOn').addEventListener('click',()=>perform('power',{value:true},'Power on'));
  $('jh2CurtainOff').addEventListener('click',()=>perform('power',{value:false},'Power off'));
  for(const k of ['Brightness','Speed']){
    const field=$('jh2Curtain'+k),out=$('jh2Curtain'+k+'Output');field.addEventListener('input',()=>out.textContent=field.value+' / 100');field.addEventListener('change',()=>perform(k.toLowerCase(),{value:Number(field.value)},k));
  }
  function previewIcon(effect){
    // One-to-one still-image crop of the user-supplied SmartDawn screenshot,
    // NOT an invented animated pattern.
    if(!effect.verified) {
      const label=create('div','jh2-effect-preview missing-preview','?');
      label.setAttribute('aria-label','Unverified effect image is unavailable');
      return label;
    }
    const src=(window.JH2_CURTAIN_IMAGE_SRC||{})[String(effect.id)];
    if(!src){
      const loading=create('div','jh2-effect-preview missing-preview',previewsReady?'Missing image':'Loading image');
      loading.setAttribute('aria-label','Source image for '+effect.name+' unavailable');
      return loading;
    }
    const image=document.createElement('img');
    image.className='jh2-effect-preview real-preview';
    image.alt=effect.name+' · original SmartDawn screenshot preview';
    image.loading='lazy';
    image.decoding='async';
    image.width=156;image.height=156;
    image.src=src;
    return image;
  }
  let previewsReady=false,previewLoad=null;
  function loadOriginalSmartDawnPreviews(){
    if(previewLoad)return previewLoad;
    previewLoad=Promise.all(Array.from({length:11},(_,i)=>new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='curtain_real_'+String(i).padStart(2,'0')+'.js?v=real-captured-20261011';
      script.async=true;
      script.onload=resolve;
      script.onerror=()=>reject(new Error('Original image shard '+i+' failed to load'));
      document.head.appendChild(script);
    }))).then(()=>{
      if(Object.keys(window.JH2_CURTAIN_IMAGE_SRC||{}).length!==88)
        throw new Error('Incomplete screenshot catalog. Expected all 88 pictures');
      previewsReady=true;render();
    });
    return previewLoad;
  }
    const list=$('jh2CurtainEffects');
  function render(){
    const needle=$('jh2CurtainSearch').value.trim().toLowerCase();list.replaceChildren();
    catalog.filter(x=>!needle||x.name.toLowerCase().includes(needle)||String(x.id).includes(needle)).forEach(e=>{
      const b=create('button','jh2-curtain-effect'+(selected===e.id?' active':'')+(!e.verified?' unverified':''));
      b.type='button';b.dataset.effect=String(e.id);
      b.setAttribute('aria-label',e.verified?`${e.name} original SmartDawn screenshot preview`:`${e.name} is not in the captured device catalog`);
      b.append(previewIcon(e),create('strong','',e.name),create('small','',!e.verified?'Not captured':e.type===3?'Scene':'Pattern'));
      const at=playlist.indexOf(e.id);
      if(at>=0){b.classList.add('in-sequence');b.append(create('small','jh2-sequence-position','#'+String(at+1)));}
      b.addEventListener('click',async()=>{
        
        if($('jh2CurtainSequenceEnable').checked){
          const at=playlist.indexOf(e.id);
          if(at>=0)playlist.splice(at,1);
          else playlist.push(e.id);
          persistSequence();renderSequence();render();
          return;
        }
        selected=e.id;render();await perform('effect',{id:e.id,group:e.group,index:e.index},e.name);
      });
      list.append(b);
    });
  }
  $('jh2CurtainSearch').addEventListener('input',render);render();renderSequence();
  // Switch with the existing .page.active router. Do not set [hidden] on the
  // Home, AI, Schedules or Factory pages: those contain independently animated
  // previews, and [hidden] can keep them invisible after a later navigation.
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p===page));
    page.hidden=false;
    nav.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===tab));
    document.body.dataset.page='curtain';
    loadOriginalSmartDawnPreviews().catch(err=>status(err.message,'error'));
    window.scrollTo({top:0,behavior:'smooth'});
  });
  nav.querySelectorAll('.tab:not([data-tab="curtain"])').forEach(b=>b.addEventListener('click',()=>{
    page.classList.remove('active');page.hidden=true;
    // Avoid touching the visibility of any original preview-containing page.
    if(typeof window.kickAnimation==='function')window.kickAnimation();
  }));
  if(!window.AndroidCurtain&&!window.JH2_ORACLE_CURTAIN)status('Install the Jason Home 2 curtain-enabled APK to connect directly over Bluetooth.');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));else setTimeout(init,0);
})();