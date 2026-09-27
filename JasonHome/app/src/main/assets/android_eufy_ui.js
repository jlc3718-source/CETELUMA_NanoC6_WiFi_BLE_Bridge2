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
    const wifiTab=q('.v3SettingsTab[data-settings-tab="wifi"]');
    const wifiPane=q('.v3SettingsPane[data-settings-pane="wifi"]');
    if(wifiTab){wifiTab.hidden=true;wifiTab.style.display="none";}
    if(wifiPane){wifiPane.hidden=true;wifiPane.style.display="none";}

    const fwTab=q('.v3SettingsTab[data-settings-tab="firmware"]');
    const fwPane=q('.v3SettingsPane[data-settings-pane="firmware"]');
    if(fwTab){fwTab.hidden=true;fwTab.style.display="none";}
    if(fwPane){fwPane.hidden=true;fwPane.style.display="none";}

    const ctlTab=q('.v3SettingsTab[data-settings-tab="controllers"]');
    if(ctlTab){
      const label=ctlTab.querySelector(".ah27SectionLabel")||ctlTab;
      label.textContent="Eufy Devices";
      ctlTab.setAttribute("aria-label","Eufy Devices");
    }

    const monitor=$("systemMonitorPanel");
    if(monitor){monitor.hidden=true;monitor.style.display="none";}

    const controllerPane=q('.v3SettingsPane[data-settings-pane="controllers"]');
    if(controllerPane&&!$("eufyAndroidStatusPanel")){
      const eufy=document.createElement("div");
      eufy.id="eufyAndroidStatusPanel";
      eufy.className="panel";
      eufy.innerHTML=
        '<div class="row between"><div><strong>Eufy / Cloud Controller</strong>'+
        '<div class="sub">Choose whether Jason Home controls the lights through Cloudflare or directly from this phone.</div></div>'+
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
        '<select id="cloudControllerMode" class="field"><option value="cloud">Cloudflare — Internet controller</option><option value="direct">Direct Eufy — phone fallback</option></select>'+
        '<div class="label">Jason Home Cloud API token</div>'+
        '<input id="cloudControllerToken" type="password" class="field" autocomplete="off" placeholder="Enter only to set or replace the saved token">'+
        '<div id="cloudControllerTokenMeta" class="sub" style="margin-top:6px">Token status loading…</div>'+
        '<div class="grid2" style="margin-top:10px"><button id="saveCloudController" class="btn primary" type="button">Save Controller</button><button id="testCloudController" class="btn" type="button">Test Cloud</button></div>'+
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

  // The standalone NanoC6 Wi-Fi page is not part of the Android/Eufy app.
  const wifiPage=q('.page[data-page="wifi"]');
  if(wifiPage){wifiPage.hidden=true;wifiPage.style.display="none";}
  qa('.v3BottomNav [data-tab="wifi"], .nav [data-tab="wifi"]').forEach(x=>{x.hidden=true;x.style.display="none";});

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
      summary.textContent=(cfg.mode==="cloud"?"Cloudflare Worker → Eufy MQTT":"Android → Eufy MQTT")+" • "+(cfg.mode==="cloud"?"server controller":"known-good direct fallback");
      if(meta)meta.textContent=cfg.configured?"Cloud API token saved securely on this phone.":"Cloud API token not saved on this phone.";
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
      if(result)result.textContent="Controller saved: "+(cfg.mode==="cloud"?"Cloudflare":"Direct Eufy")+".";
      await loadCloudControllerConfig();
      await refreshEufyStatus();
      if(typeof loadState==="function")await loadState();
    }catch(e){if(result)result.textContent="Controller save failed: "+e.message;}
  }

  async function testCloudController(){
    const result=$("cloudControllerResult");
    if(result)result.textContent="Testing Cloudflare and Eufy…";
    try{
      const st=await api("/api/cloud/test?ts="+Date.now(),{},30000);
      const eu=st.eufy||{},names=Array.isArray(eu.readyNames)?eu.readyNames:[];
      if(result)result.textContent="Cloud test: "+(eu.status||"Online")+" • "+names.length+"/4 strings ready.";
    }catch(e){if(result)result.textContent="Cloud test failed: "+e.message;}
  }

  async function reconnectCloudController(){
    const result=$("cloudControllerResult");
    if(result)result.textContent="Reconnecting Cloudflare to Eufy…";
    try{
      const r=await post("/api/reconnect",{});
      if(result)result.textContent="Eufy reconnect complete"+(r.eufy?.status?" • "+r.eufy.status:".");
      await refreshEufyStatus();
    }catch(e){if(result)result.textContent="Reconnect failed: "+e.message;}
  }

  async function reconcileCloudController(){
    const result=$("cloudControllerResult");
    if(result)result.textContent="Reconciling the cloud schedule…";
    try{
      await post("/api/reconcile",{});
      if(result)result.textContent="Cloud schedule reconciled.";
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
  setInterval(refreshEufyStatus,5000);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(installAndroidEufyUi,0),{once:true});
else setTimeout(installAndroidEufyUi,0);
})();