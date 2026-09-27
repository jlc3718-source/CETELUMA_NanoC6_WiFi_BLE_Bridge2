(()=>{"use strict";
const $=id=>document.getElementById(id);
const q=s=>document.querySelector(s);
const qa=s=>[...document.querySelectorAll(s)];

function installAndroidEufyUi(){
  // This is the Android/Eufy edition of the current Anderson UI. Remove the
  // NanoC6-only network/firmware surfaces, keep the current Anderson layout,
  // and make the four installed Eufy strings first-class hardware targets.
  document.body.classList.add("android-eufy-edition");

  const settings=q('.page[data-page="settings"]');
  if(settings){
    const ctlTab=q('.v3SettingsTab[data-settings-tab="controllers"]');
    if(ctlTab){
      const label=ctlTab.querySelector(".ah27SectionLabel")||ctlTab;
      label.textContent="Eufy Devices";
      ctlTab.setAttribute("aria-label","Eufy Devices");
    }

    const controllerPane=q('.v3SettingsPane[data-settings-pane="controllers"]');
    if(controllerPane&&!$("eufyAndroidStatusPanel")){
      const eufy=document.createElement("div");
      eufy.id="eufyAndroidStatusPanel";
      eufy.className="panel";
      eufy.innerHTML=
        '<div class="row between"><div><strong>Eufy / Oracle Controller</strong>'+
        '<div class="sub">Choose whether Jason Home controls the lights through Oracle or directly from this phone.</div></div>'+
        '<span class="badge" id="eufyBleBadge">READY</span></div>'+
        '<div class="eufyStatusGrid">'+
        '<div class="eufyStatusCard"><span>Pool</span><strong id="eufyPoolState">Saved</strong><small>E120</small></div>'+
        '<div class="eufyStatusCard"><span>House</span><strong id="eufyHouseState">Saved</strong><small>E120</small></div>'+
        '<div class="eufyStatusCard"><span>Garage</span><strong id="eufyGarageState">Saved</strong><small>E22</small></div>'+
        '<div class="eufyStatusCard"><span>Shed</span><strong id="eufyShedState">Saved</strong><small>E22</small></div>'+
        '</div>'+
        '<div class="card small eufyStatusNote"><strong>Controller path</strong><br>'+
        '<span id="cloudControllerSummary" class="sub">Loading controller mode…</span></div>'+
        '<div class="label">Controller mode</div>'+
        '<select id="cloudControllerMode" class="field"><option value="cloud">Oracle — Internet controller</option><option value="direct">Direct Eufy — phone fallback</option></select>'+
        '<div class="label">Jason Home Oracle API token</div>'+
        '<input id="cloudControllerToken" type="password" class="field" autocomplete="off" placeholder="Enter only to set or replace the saved token">'+
        '<div id="cloudControllerTokenMeta" class="sub" style="margin-top:6px">Token status loading…</div>'+
        '<div class="grid2" style="margin-top:10px"><button id="saveCloudController" class="btn primary" type="button">Save Controller</button><button id="testCloudController" class="btn" type="button">Test Oracle</button></div>'+
        '<div class="grid2" style="margin-top:8px"><button id="reconnectCloudController" class="btn" type="button">Reconnect Eufy</button><button id="reconcileCloudController" class="btn" type="button">Reconcile Schedule</button></div>'+
        '<div id="cloudControllerResult" class="sub" style="margin-top:7px"></div>';
      controllerPane.prepend(eufy);
    }

    const pane=q('.v3SettingsPane[data-settings-pane="controllers"]');
    if(pane){
      const panel=$("bleStatus")?.closest(".panel");
      if(panel){
        panel.querySelector(":scope > strong").textContent="Eufy Light Devices";
        const sub=panel.querySelector(":scope > .sub");
        if(sub)sub.textContent="Your four installed Eufy strings. Schedules and events control all four; manual control can target one string or the whole house.";
      }
    }
  }

  function installFactoryLab(){
    if($("factoryTab"))return;
    const nav=q(".v3BottomNav")||q(".nav"),wrap=q(".wrap");
    if(!nav||!wrap)return;

    const tab=document.createElement("button");
    tab.id="factoryTab";
    tab.type="button";
    tab.className="tab";
    tab.dataset.tab="factory";
    tab.hidden=true;
    tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></svg><span>Factory</span>';
    const settingsTab=q('.v3BottomNav .tab[data-tab="settings"]')||q('.nav .tab[data-tab="settings"]');
    nav.insertBefore(tab,settingsTab||nav.lastElementChild);

    const page=document.createElement("section");
    page.className="page";
    page.dataset.page="factory";
    page.hidden=true;
    page.innerHTML=
      '<div class="v3PageTitle"><span>EUFY FACTORY LAB</span><h2>Factory presets</h2></div>'+
      '<div class="panel">'+
        '<div class="row between wraprow"><div><strong>Isolated factory test catalog</strong><div class="sub">Factory scenes stay separate from your normal effects and schedules.</div></div><span id="factoryCatalogBadge" class="badge">Not loaded</span></div>'+
        '<div class="note">Every test command is sent to all four installed strings: Pool and House (E120) plus Garage and Shed (E22). E22 uses the verified factory 0x020D layout. E120 uses the isolated experimental T8L00 adaptation so we can determine which factory layouts work there without merging them into the main effect system.</div>'+
        '<div class="grid2" style="margin-top:12px"><input id="factorySearch" class="field" type="search" placeholder="Search preset name or ID"><button id="factoryRefresh" class="btn" type="button">Refresh Catalog</button></div>'+
        '<div id="factoryCatalogStatus" class="status">Open this tab to load the Eufy factory catalog.</div>'+
      '</div>'+
      '<div class="panel">'+
        '<div class="row between wraprow"><div><strong>Factory layouts</strong><div class="sub">Tap Test All 4 to send that exact catalog layout to every light string.</div></div><button id="factoryResume" class="btn" type="button">Resume Schedule</button></div>'+
        '<div id="factoryPresetList" class="presetList"></div>'+
      '</div>';
    wrap.appendChild(page);

    const style=document.createElement("style");
    style.textContent=
      '.factoryPresetCard{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:13px;border:1px solid rgba(120,160,220,.22);border-radius:13px;background:#091327;margin:8px 0}.factoryPresetName{font-weight:700}.factoryPresetMeta{font-size:11px;color:#91a7ca;margin-top:4px}.factorySwatches{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.factorySwatch{width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.35)}.factoryFlags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.factoryFlag{font-size:9px;border:1px solid rgba(130,175,235,.35);border-radius:999px;padding:2px 6px;color:#aec5e8}.factoryTestResult{grid-column:1/-1;font-size:11px;color:#a9bad5;min-height:16px}.factoryPresetCard .btn{min-width:92px}@media(max-width:460px){.factoryPresetCard{grid-template-columns:1fr}.factoryPresetCard .btn{width:100%}}';
    document.head.appendChild(style);

    let presets=[],catalogLoading=false;
    function dedupeFactoryByName(items){const best=new Map();for(const p of items||[]){const k=String(p?.name||("id:"+p?.lightId)).trim().toLowerCase().replace(/\s+/g," ");const old=best.get(k);if(!old||Number(p?.lightId||0)<Number(old?.lightId||0))best.set(k,p)}return [...best.values()].sort((a,b)=>Number(a.lightId)-Number(b.lightId))}
    const escapeColor=x=>/^#?[0-9a-fA-F]{6}$/.test(x||"")?"#"+String(x).replace("#",""):"#444";

    function syncFactoryAccess(profile=window.andersonProfile){
      const allowed=profile&&profile.id==="jason";
      tab.hidden=!allowed;page.hidden=!allowed;
      if(!allowed&&page.classList.contains("active")){
        const home=q('.v3BottomNav .tab[data-tab="home"]')||q('.nav .tab[data-tab="home"]');
        home?.click();
      }
    }
    window.addEventListener("anderson-profile-selected",e=>syncFactoryAccess(e.detail));
    window.addEventListener("anderson-profile-cleared",()=>syncFactoryAccess(null));
    syncFactoryAccess();

    function renderFactory(){
      const root=$("factoryPresetList"),search=($("factorySearch")?.value||"").trim().toLowerCase();
      if(!root)return;
      root.replaceChildren();
      const shown=presets.filter(p=>!search||String(p.lightId).includes(search)||String(p.name||"").toLowerCase().includes(search));
      if(!shown.length){
        const empty=document.createElement("div");empty.className="emptyFav";empty.textContent=presets.length?"No factory presets match your search.":"No factory presets loaded yet.";root.appendChild(empty);return;
      }
      for(const p of shown){
        const card=document.createElement("div");card.className="factoryPresetCard";
        const info=document.createElement("div");
        const name=document.createElement("div");name.className="factoryPresetName";name.textContent=p.name||("Factory "+p.lightId);
        const meta=document.createElement("div");meta.className="factoryPresetMeta";meta.textContent="ID "+p.lightId+" • "+(p.layers?.length||0)+" layer"+((p.layers?.length||0)===1?"":"s")+(p.brightness!=null?" • "+p.brightness+"%":"");
        const swatches=document.createElement("div");swatches.className="factorySwatches";
        String(p.colors||"").split("|").filter(Boolean).slice(0,10).forEach(c=>{const x=document.createElement("span");x.className="factorySwatch";x.style.background=escapeColor(c);x.title="#"+String(c).replace("#","");swatches.appendChild(x);});
        const flags=document.createElement("div");flags.className="factoryFlags";
        const f1=document.createElement("span");f1.className="factoryFlag";f1.textContent=p.buildableE22?"E22 ready":"E22 shape?";
        const f2=document.createElement("span");f2.className="factoryFlag";f2.textContent=p.buildableE120Experimental?"E120 testable":"E120 shape?";
        flags.append(f1,f2);
        info.append(name,meta,swatches,flags);
        const btn=document.createElement("button");btn.className="btn primary";btn.type="button";btn.textContent="Test All 4";
        const result=document.createElement("div");result.className="factoryTestResult";
        btn.addEventListener("click",()=>runFactoryTest(p,btn,result));
        card.append(info,btn,result);root.appendChild(card);
      }
    }

    async function loadFactoryCatalog(force=false){
      if(catalogLoading)return;
      catalogLoading=true;
      const statusEl=$("factoryCatalogStatus"),badge=$("factoryCatalogBadge");
      try{
        if(force){
          if(statusEl)statusEl.textContent="Refreshing Eufy factory catalog on Oracle…";
          await post("/api/eufy/factory-presets/refresh",{});
        }
        for(let i=0;i<90;i++){
          const r=await api("/api/eufy/factory-presets?ts="+Date.now(),{},12000);
          if(Array.isArray(r.presets)){
            presets=dedupeFactoryByName(r.presets);
            if(badge)badge.textContent=presets.length+" presets";
            if(statusEl){
              const found=presets.find(x=>Number(x.lightId)===10474);
              statusEl.textContent="Loaded "+presets.length+" unique factory presets"+(Number(r.duplicatesCollapsed||0)?" • "+r.duplicatesCollapsed+" duplicates collapsed":"")+(r.refresh?.state==="running"?" • refresh still running":"")+".";
            }
            renderFactory();
            if(r.refresh?.state!=="running")break;
          }else if(statusEl)statusEl.textContent="Extracting factory catalog from Eufy…";
          await new Promise(r=>setTimeout(r,1200));
        }
      }catch(e){
        if(statusEl)statusEl.textContent="Factory catalog failed: "+e.message;
        if(badge)badge.textContent="Error";
      }finally{catalogLoading=false;}
    }

    async function runFactoryTest(p,btn,result){
      btn.disabled=true;result.textContent="Sending factory "+p.lightId+" to Pool, House, Garage, and Shed…";
      try{
        const queued=await post("/api/eufy/factory-test",{lightId:Number(p.lightId)},12000);
        const job=queued.jobId;
        if(!job)throw new Error("Oracle did not return a factory test job");
        for(let i=0;i<90;i++){
          await new Promise(r=>setTimeout(r,800));
          const j=await api("/api/eufy/factory-test?job="+encodeURIComponent(job)+"&ts="+Date.now(),{},12000);
          if(j.state==="failed")throw new Error(j.error||"Factory test failed");
          if(j.state==="complete"){
            const r=j.result||{},parts=(r.results||[]).map(x=>x.name+" "+(x.ok?"✓":"✕"));
            result.textContent=parts.join(" • ")+" • "+r.sent+"/4 commands sent. Verify the physical layout on both E120 and E22.";
            return;
          }
        }
        throw new Error("Factory test did not finish in time");
      }catch(e){result.textContent="Factory test failed: "+e.message;}
      finally{btn.disabled=false;}
    }

    tab.addEventListener("click",()=>{
      if(tab.hidden||!window.andersonProfile||window.andersonProfile.id!=="jason")return;
      qa(".v3BottomNav .tab").forEach(x=>x.classList.toggle("active",x===tab));
      qa(".page").forEach(x=>x.classList.toggle("active",x===page));
      document.body.dataset.page="factory";
      window.scrollTo({top:0,behavior:"smooth"});
      loadFactoryCatalog(false);
    });
    $("factorySearch")?.addEventListener("input",renderFactory);
    $("factoryRefresh")?.addEventListener("click",()=>loadFactoryCatalog(true));
    $("factoryResume")?.addEventListener("click",async()=>{
      const b=$("factoryResume");b.disabled=true;
      try{await post("/api/resume",{});$("factoryCatalogStatus").textContent="Normal Oracle schedule resumed.";}
      catch(e){$("factoryCatalogStatus").textContent="Could not resume schedule: "+e.message;}
      finally{b.disabled=false;}
    });
  }
  installFactoryLab();

  // Fixed installed devices should not offer Rename/Remove operations.
  const cleanDeviceActions=()=>{
    const root=$("selectedControllers");
    if(!root)return;
    root.querySelectorAll(".bleDevice").forEach(card=>{
      const action=card.querySelector(".row.wraprow");
      if(action)action.remove();
    });
  };
  new MutationObserver(cleanDeviceActions).observe($("selectedControllers")||document.body,{childList:true,subtree:true});
  cleanDeviceActions();

  async function loadCloudControllerConfig(){
    const summary=$("cloudControllerSummary"),mode=$("cloudControllerMode"),meta=$("cloudControllerTokenMeta");
    if(!summary||!mode)return;
    try{
      const cfg=typeof api==="function"?await api("/api/cloud/config?ts="+Date.now()):null;
      if(!cfg)return;
      mode.value=cfg.mode||"direct";
      summary.textContent=(cfg.mode==="cloud"?"Oracle Linux → Eufy MQTT":"Android → Eufy MQTT")+" • "+(cfg.mode==="cloud"?"Oracle server controller":"known-good direct fallback");
      if(meta)meta.textContent=cfg.configured?"Oracle API token saved securely on this phone.":"Oracle API token not saved on this phone.";
      const result=$("cloudControllerResult");
      if(result&&cfg.directStatus)result.textContent="Direct fallback: "+cfg.directStatus;
    }catch(e){summary.textContent="Controller configuration unavailable: "+e.message;}
  }

  async function saveCloudControllerConfig(){
    const mode=$("cloudControllerMode"),token=$("cloudControllerToken"),result=$("cloudControllerResult");
    if(!mode)return;
    try{
      const payload={mode:mode.value};
      if(token&&token.value.trim())payload.token=token.value.trim();
      const cfg=await post("/api/cloud/config",payload);
      if(token)token.value="";
      if(result)result.textContent="Controller saved: "+(cfg.mode==="cloud"?"Oracle":"Direct Eufy")+".";
      await loadCloudControllerConfig();
      await refreshEufyStatus();
      if(typeof loadState==="function")await loadState();
    }catch(e){if(result)result.textContent="Controller save failed: "+e.message;}
  }

  async function testCloudController(){
    const result=$("cloudControllerResult");
    if(result)result.textContent="Testing Oracle and Eufy…";
    try{
      const st=await api("/api/cloud/test?ts="+Date.now(),{},30000);
      const eu=st.eufy||{},names=Array.isArray(eu.readyNames)?eu.readyNames:[];
      if(result)result.textContent="Oracle test: "+(eu.status||"Online")+" • "+names.length+"/4 strings ready.";
    }catch(e){if(result)result.textContent="Oracle test failed: "+e.message;}
  }

  async function reconnectCloudController(){
    const result=$("cloudControllerResult");
    if(result)result.textContent="Reconnecting Oracle to Eufy…";
    try{
      const r=await post("/api/reconnect",{});
      if(result)result.textContent="Eufy reconnect complete"+(r.eufy?.status?" • "+r.eufy.status:".");
      await refreshEufyStatus();
    }catch(e){if(result)result.textContent="Reconnect failed: "+e.message;}
  }

  async function reconcileCloudController(){
    const result=$("cloudControllerResult");
    if(result)result.textContent="Reconciling the Oracle schedule…";
    try{
      await post("/api/reconcile",{});
      if(result)result.textContent="Oracle schedule reconciled.";
      await refreshEufyStatus();
    }catch(e){if(result)result.textContent="Reconcile failed: "+e.message;}
  }

  async function refreshEufyStatus(){
    try{
      const data=typeof api==="function"?await api("/api/state?eufy="+Date.now()):null;
      if(!data)return;
      const byName={};
      (data.ble?.controllers||[]).forEach(x=>{byName[String(x.name||"").toLowerCase()]=x;});
      [["Pool","eufyPoolState"],["House","eufyHouseState"],["Garage","eufyGarageState"],["Shed","eufyShedState"]].forEach(([name,id])=>{
        const x=byName[name.toLowerCase()],el=$(id);
        if(el)el.textContent=x?.connected?"Connected":"Ready";
      });
      const connected=Number(data.ble?.connectedCount||0);
      const badge=$("eufyBleBadge");
      if(badge)badge.textContent=connected?connected+"/4 READY":"READY";
      const summary=$("cloudControllerSummary");
      if(summary)summary.textContent=(data.ble?.connectionMode||"Internet")+" • "+(data.ble?.status||data.ble?.transportStatus||"");
      cleanDeviceActions();
    }catch(_){}
  }

  // Make Eufy hardware immediately obvious the first time Settings is opened.
  const settingsTab=q('.v3BottomNav [data-tab="settings"]');
  settingsTab?.addEventListener("click",()=>setTimeout(()=>{refreshEufyStatus();loadCloudControllerConfig();},60));

  const scan=$("scanBle");
  if(scan){
    scan.textContent="Refresh Eufy Cloud Lights";
    scan.addEventListener("click",()=>setTimeout(refreshEufyStatus,13000));
  }

  const saveCloud=$("saveCloudController");
  if(saveCloud)saveCloud.addEventListener("click",saveCloudControllerConfig);
  const testCloud=$("testCloudController");
  if(testCloud)testCloud.addEventListener("click",testCloudController);
  const reconnectCloud=$("reconnectCloudController");
  if(reconnectCloud)reconnectCloud.addEventListener("click",reconnectCloudController);
  const reconcileCloud=$("reconcileCloudController");
  if(reconcileCloud)reconcileCloud.addEventListener("click",reconcileCloudController);
  loadCloudControllerConfig();

  const meta=$("bleMeta");
  if(meta&&!meta.textContent.includes("Eufy"))meta.textContent="Eufy Cloud MQTT • Manual target: All";

  // Android edition wording.
  const conn=$("connectionBadge");
  if(conn)conn.title="Jason Home Android • Eufy Wi-Fi / Cloud";
  refreshEufyStatus();
  setInterval(()=>{if(!document.hidden)refreshEufyStatus();},20000);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(installAndroidEufyUi,0),{once:true});
else setTimeout(installAndroidEufyUi,0);
})();