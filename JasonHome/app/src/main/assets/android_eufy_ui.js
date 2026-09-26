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

    const generalPane=q('.v3SettingsPane[data-settings-pane="general"]');
    const monitor=$("systemMonitorPanel");
    if(generalPane&&monitor){
      monitor.hidden=true;
      monitor.style.display="none";
      if(!$("eufyAndroidStatusPanel")){
        const eufy=document.createElement("div");
        eufy.id="eufyAndroidStatusPanel";
        eufy.className="panel";
        eufy.innerHTML=
          '<div class="row between"><div><strong>Eufy Bluetooth Status</strong>'+
          '<div class="sub">Direct Bluetooth control from this phone • no NanoC6 or device Wi-Fi required</div></div>'+
          '<span class="badge" id="eufyBleBadge">READY</span></div>'+
          '<div class="eufyStatusGrid">'+
          '<div class="eufyStatusCard"><span>Pool</span><strong id="eufyPoolState">Saved</strong><small>E120</small></div>'+
          '<div class="eufyStatusCard"><span>House</span><strong id="eufyHouseState">Saved</strong><small>E120</small></div>'+
          '<div class="eufyStatusCard"><span>Garage</span><strong id="eufyGarageState">Saved</strong><small>E22</small></div>'+
          '<div class="eufyStatusCard"><span>Shed</span><strong id="eufyShedState">Saved</strong><small>E22</small></div>'+
          '</div>'+
          '<div class="card small eufyStatusNote"><strong>Control path</strong><br>'+
          '<span class="sub">Anderson schedules, scenes, brightness, effects and manual controls are translated directly into the proven Jason Home Eufy E10 Bluetooth commands.</span></div>';
        generalPane.insertBefore(eufy,monitor);
      }
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
      if(badge)badge.textContent=connected?connected+" SEEN":"READY";
      cleanDeviceActions();
    }catch(_){}
  }

  // Make Eufy hardware immediately obvious the first time Settings is opened.
  const settingsTab=q('.v3BottomNav [data-tab="settings"]');
  settingsTab?.addEventListener("click",()=>setTimeout(refreshEufyStatus,60));

  const scan=$("scanBle");
  if(scan){
    scan.textContent="Scan Installed Eufy Lights";
    scan.addEventListener("click",()=>setTimeout(refreshEufyStatus,13000));
  }

  const meta=$("bleMeta");
  if(meta&&!meta.textContent.includes("Eufy"))meta.textContent="Eufy E10 • Manual target: All";

  // Android edition wording.
  const conn=$("connectionBadge");
  if(conn)conn.title="Jason Home Android • Eufy Bluetooth";
  refreshEufyStatus();
  setInterval(refreshEufyStatus,5000);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(installAndroidEufyUi,0),{once:true});
else setTimeout(installAndroidEufyUi,0);
})();