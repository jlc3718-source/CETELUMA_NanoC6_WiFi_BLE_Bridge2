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
    tab.id="factoryTab";tab.type="button";tab.className="tab";tab.dataset.tab="factory";tab.hidden=true;
    tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></svg><span>Factory</span>';
    const settingsTab=q('.v3BottomNav .tab[data-tab="settings"]')||q('.nav .tab[data-tab="settings"]');
    nav.insertBefore(tab,settingsTab||nav.lastElementChild);

    const page=document.createElement("section");
    page.className="page";page.dataset.page="factory";page.hidden=true;
    page.innerHTML=
      '<div class="v3PageTitle"><span>EUFY FACTORY LAB</span><h2>Factory preset editor</h2></div>'+
      '<div class="panel">'+
        '<div class="row between wraprow"><div><strong>Editable Eufy factory catalog</strong><div class="sub">Factory scenes stay isolated from normal effects and schedules until you deliberately apply them.</div></div><span id="factoryCatalogBadge" class="badge">Not loaded</span></div>'+
        '<div class="note">Pattern shows what each Eufy layer actually does. Edit opens the complete recipe. Apply uses the reliable compatible renderer by default; the editor also keeps an Exact Native Factory mode for full multi-layer testing. Pool and House are E120; Garage and Shed are E22.</div>'+
        '<div class="grid2" style="margin-top:12px"><input id="factorySearch" class="field" type="search" placeholder="Search preset name, ID, or pattern"><button id="factoryRefresh" class="btn" type="button">Refresh Catalog</button></div>'+
        '<div id="factoryCatalogStatus" class="status">Open this tab to load the Eufy factory catalog.</div>'+
      '</div>'+
      '<div class="panel">'+
        '<div class="row between wraprow"><div><strong>Factory layouts</strong><div class="sub">Edit the recipe or apply its compatible pattern to all four strings.</div></div><button id="factoryResume" class="btn" type="button">Resume Schedule</button></div>'+
        '<div id="factoryPresetList" class="presetList"></div>'+
      '</div>';
    wrap.appendChild(page);

    const overlay=document.createElement("div");
    overlay.id="factoryEditorOverlay";overlay.className="factoryEditorOverlay";
    overlay.innerHTML='<div class="factoryEditorCard"><div class="row between"><div><strong id="factoryEditorTitle">Factory preset</strong><div id="factoryEditorPattern" class="sub"></div></div><button id="factoryEditorClose" class="btn" type="button">Done</button></div><div id="factoryEditorBody"></div><div id="factoryEditorResult" class="status"></div><div class="factoryEditorActions"><button id="factoryEditorReset" class="btn danger" type="button">Restore Eufy Original</button><button id="factoryEditorSave" class="btn" type="button">Save Changes</button><button id="factoryEditorApply" class="btn primary" type="button">Save & Apply</button></div></div>';
    document.body.appendChild(overlay);

    const style=document.createElement("style");
    style.textContent=
      '#factoryPresetList{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px;align-items:stretch}.factoryPresetCard{display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px;border:1px solid rgba(120,160,220,.22);border-radius:11px;background:#091327;margin:0}.factoryPresetName{font-size:13px;line-height:1.15;min-height:30px}.factoryPresetMeta{font-size:9px;color:#91a7ca;margin-top:1px}.factoryPattern{font-size:10px;line-height:1.25;color:#d4e5ff;margin-top:2px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.factorySwatches{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}.factorySwatch{width:13px;height:13px;border-radius:50%;border:1px solid rgba(255,255,255,.35)}.factoryFlags{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}.factoryFlag{font-size:8px;border:1px solid rgba(130,175,235,.35);border-radius:999px;padding:1px 4px;color:#aec5e8}.factoryFlag.edited{border-color:#31d89b;color:#7ef2c4}.factoryButtons{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:auto}.factoryButtons .btn{font-size:10px;padding:7px 5px;min-width:0}.factoryTestResult{font-size:9px;line-height:1.25;color:#a9bad5;min-height:0;grid-column:auto}.factoryScheduledEvent{border-color:rgba(49,216,155,.42)!important;box-shadow:inset 3px 0 0 rgba(49,216,155,.65)}.factoryScheduledEvent .factoryScheduleTag{border-color:#31d89b;color:#7ef2c4}.factoryScheduleResult{font-size:10px;color:#a9bad5;margin-top:4px}.factoryScheduleMatch{font-size:10px;color:#7ef2c4;margin-top:3px}.factoryEditorOverlay{position:fixed;inset:0;z-index:22000;background:rgba(0,0,0,.78);display:none;align-items:flex-start;justify-content:center;padding:calc(18px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom));overflow:auto}.factoryEditorOverlay.open{display:flex}.factoryEditorCard{width:min(760px,100%);background:#081526;border:1px solid rgba(92,177,235,.42);border-radius:18px;padding:16px;box-shadow:0 24px 80px rgba(0,0,0,.55)}.factoryEditorGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.factoryLayer{border:1px solid rgba(102,155,214,.25);border-radius:14px;padding:12px;margin-top:12px;background:#091327}.factoryLayerHead{display:flex;justify-content:space-between;gap:8px;align-items:center}.factoryLayerGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.factoryLayer textarea{width:100%;min-height:180px;box-sizing:border-box;background:#050c17;color:#d7e7ff;border:1px solid #304765;border-radius:10px;padding:9px;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.factoryEditorActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px}.factoryLayerActions{display:flex;gap:6px;flex-wrap:wrap}.profile-locked .factoryEditorOverlay{display:none!important}@media(max-width:560px){#factoryPresetList{grid-template-columns:repeat(2,minmax(0,1fr))}.factoryEditorGrid,.factoryLayerGrid{grid-template-columns:1fr}.factoryEditorActions .btn{flex:1 1 100%}}@media(max-width:285px){#factoryPresetList{grid-template-columns:1fr}}@media(min-width:760px){#factoryPresetList{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}}';
    document.head.appendChild(style);

    let presets=[],promotions=[],catalogLoading=false,promotionsLoading=false,editorPreset=null,lastScheduleEvents=[];
    const deep=x=>JSON.parse(JSON.stringify(x));
    function dedupeFactoryByName(items){const best=new Map();for(const p of items||[]){const k=String(p?.name||("id:"+p?.lightId)).trim().toLowerCase().replace(/\s+/g," ");const old=best.get(k);if(!old||Number(p?.lightId||0)<Number(old?.lightId||0))best.set(k,p)}return [...best.values()].sort((a,b)=>Number(a.lightId)-Number(b.lightId))}
    const escapeColor=x=>/^#?[0-9a-fA-F]{6}$/.test(x||"")?"#"+String(x).replace("#",""):"#444";
    const layerName=t=>Number(t)===0?"Flow / Movement":Number(t)===1?"Color Transition / Sequence":Number(t)===2?"Blink / Twinkle":"Unknown Pattern "+String(t??"?");
    const patternSummary=p=>Array.isArray(p?.layers)&&p.layers.length?p.layers.map((l,i)=>(i+1)+". "+layerName(l?.current_layer_type)).join(" + "):"No serializable pattern layers";
    const layerColors=l=>String(l?.colors||"").split("|").map(x=>x.trim()).filter(Boolean);

    function syncFactoryAccess(profile=window.andersonProfile){
      const allowed=profile&&profile.id==="jason";tab.hidden=!allowed;page.hidden=!allowed;
      if(!allowed&&page.classList.contains("active")){overlay.classList.remove("open");const home=q('.v3BottomNav .tab[data-tab="home"]')||q('.nav .tab[data-tab="home"]');home?.click();}
    }
    window.addEventListener("anderson-profile-selected",e=>syncFactoryAccess(e.detail));
    window.addEventListener("anderson-profile-cleared",()=>syncFactoryAccess(null));
    syncFactoryAccess();

    function renderFactory(){
      const root=$("factoryPresetList"),search=($("factorySearch")?.value||"").trim().toLowerCase();
      if(!root)return;root.replaceChildren();
      const shown=presets.filter(p=>!search||String(p.lightId).includes(search)||String(p.name||"").toLowerCase().includes(search)||patternSummary(p).toLowerCase().includes(search));
      if(!shown.length){const empty=document.createElement("div");empty.className="emptyFav";empty.textContent=presets.length?"No factory presets match your search.":"No factory presets loaded yet.";root.appendChild(empty);return;}
      for(const p of shown){
        const card=document.createElement("div");card.className="factoryPresetCard";
        const info=document.createElement("div");
        const name=document.createElement("div");name.className="factoryPresetName";name.textContent=p.name||("Factory "+p.lightId);
        const meta=document.createElement("div");meta.className="factoryPresetMeta";meta.textContent="ID "+p.lightId+" • "+(p.layers?.length||0)+" layer"+((p.layers?.length||0)===1?"":"s")+(p.brightness!=null?" • "+p.brightness+"%":"");
        const pattern=document.createElement("div");pattern.className="factoryPattern";pattern.textContent="Pattern: "+patternSummary(p);
        const swatches=document.createElement("div");swatches.className="factorySwatches";
        const colors=[...new Set((p.layers||[]).flatMap(layerColors))].slice(0,14);
        colors.forEach(col=>{const x=document.createElement("span");x.className="factorySwatch";x.style.background=escapeColor(col);x.title="#"+String(col).replace("#","");swatches.appendChild(x);});
        const flags=document.createElement("div");flags.className="factoryFlags";
        const f1=document.createElement("span");f1.className="factoryFlag";f1.textContent=p.buildableE22?"E22":"E22 !";
        const f2=document.createElement("span");f2.className="factoryFlag";f2.textContent=p.buildableE120Experimental?"E120":"E120 !";
        flags.append(f1,f2);
        if(p.customized){const ed=document.createElement("span");ed.className="factoryFlag edited";ed.textContent="Edited";flags.appendChild(ed);}
        info.append(name,meta,pattern,swatches,flags);
        const buttons=document.createElement("div");buttons.className="factoryButtons";
        const edit=document.createElement("button");edit.className="btn";edit.type="button";edit.textContent="Edit";
        const test=document.createElement("button");test.className="btn primary";test.type="button";test.textContent="Apply All 4";
        const result=document.createElement("div");result.className="factoryTestResult";
        edit.addEventListener("click",()=>openFactoryEditor(p));
        test.addEventListener("click",()=>runFactoryTest(p,test,result,"All","compatible"));
        buttons.append(edit,test);card.append(info,buttons,result);root.appendChild(card);
      }
    }

    async function loadFactoryCatalog(force=false){
      if(catalogLoading)return;catalogLoading=true;
      const statusEl=$("factoryCatalogStatus"),badge=$("factoryCatalogBadge");
      try{
        if(force){if(statusEl)statusEl.textContent="Refreshing Eufy factory catalog on Oracle…";await post("/api/eufy/factory-presets/refresh",{});}
        for(let i=0;i<90;i++){
          const r=await api("/api/eufy/factory-presets?ts="+Date.now(),{},12000);
          if(Array.isArray(r.presets)){
            presets=dedupeFactoryByName(r.presets);
            if(badge)badge.textContent=presets.length+" presets";
            if(statusEl)statusEl.textContent="Loaded "+presets.length+" Factory Lab presets"+(Number(r.promotedCount||0)?" • "+r.promotedCount+" holiday presets moved into Schedules":"")+(Number(r.duplicatesCollapsed||0)?" • "+r.duplicatesCollapsed+" duplicates collapsed":"")+(r.refresh?.state==="running"?" • refresh still running":"")+".";
            renderFactory();if(r.refresh?.state!=="running")break;
          }else if(statusEl)statusEl.textContent="Extracting factory catalog from Eufy…";
          await new Promise(r=>setTimeout(r,1200));
        }
      }catch(e){if(statusEl)statusEl.textContent="Factory catalog failed: "+e.message;if(badge)badge.textContent="Error";}
      finally{catalogLoading=false;}
    }

    function labeled(label,input){
      const box=document.createElement("label");const l=document.createElement("div");l.className="label";l.textContent=label;box.append(l,input);return box;
    }
    function numInput(value,min=0,max=255){
      const x=document.createElement("input");x.className="field";x.type="number";x.min=String(min);x.max=String(max);x.value=String(value??0);return x;
    }
    function syncLayerTextarea(layer,ta){ta.value=JSON.stringify(layer,null,2);}
    function renderEditor(){
      if(!editorPreset)return;
      $("factoryEditorTitle").textContent=(editorPreset.name||("Factory "+editorPreset.lightId))+" • ID "+editorPreset.lightId;
      $("factoryEditorPattern").textContent="Pattern: "+patternSummary(editorPreset);
      const body=$("factoryEditorBody");body.replaceChildren();

      const grid=document.createElement("div");grid.className="factoryEditorGrid";
      const name=document.createElement("input");name.className="field";name.value=editorPreset.name||"";name.addEventListener("input",()=>{editorPreset.name=name.value;$("factoryEditorTitle").textContent=(name.value||("Factory "+editorPreset.lightId))+" • ID "+editorPreset.lightId;});
      const brightness=numInput(editorPreset.brightness??75,1,100);brightness.addEventListener("input",()=>editorPreset.brightness=Number(brightness.value));
      const speed=numInput(editorPreset.speed??0,0,255);speed.addEventListener("input",()=>editorPreset.speed=Number(speed.value));
      const exec=numInput(editorPreset.layerExecutionMode??0,0,255);exec.addEventListener("input",()=>editorPreset.layerExecutionMode=Number(exec.value));
      const target=document.createElement("select");target.id="factoryEditorTarget";target.className="field";["All","Pool","House","Garage","Shed"].forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v==="All"?"All four strings":v+" only";target.appendChild(o);});
      const applyMode=document.createElement("select");applyMode.id="factoryEditorApplyMode";applyMode.className="field";[["compatible","Compatible Pattern — recommended"],["native","Exact Native Factory — experimental"]].forEach(([v,n])=>{const o=document.createElement("option");o.value=v;o.textContent=n;applyMode.appendChild(o);});
      grid.append(labeled("Preset name",name),labeled("Brightness %",brightness),labeled("Factory speed byte (0–255)",speed),labeled("Layer execution mode (0–255)",exec),labeled("Apply target",target),labeled("Apply method",applyMode));
      body.appendChild(grid);

      const explain=document.createElement("div");explain.className="note";explain.style.marginTop="12px";explain.textContent="Layer types: Flow / Movement controls traveling patterns; Color Transition / Sequence controls ordered color changes; Blink / Twinkle controls flash/sparkle behavior. Compatible Pattern translates the dominant layer through the proven Jason Home effect engine. Exact Native Factory sends Eufy’s full multi-layer recipe and remains experimental, especially on E120. Advanced Layer Data exposes every raw Eufy parameter.";
      body.appendChild(explain);

      (editorPreset.layers||[]).forEach((layer,index)=>{
        const card=document.createElement("div");card.className="factoryLayer";
        const head=document.createElement("div");head.className="factoryLayerHead";
        const title=document.createElement("strong");title.textContent="Layer "+(index+1)+" — "+layerName(layer.current_layer_type);
        const actions=document.createElement("div");actions.className="factoryLayerActions";
        const dup=document.createElement("button");dup.className="btn";dup.type="button";dup.textContent="Duplicate";
        dup.onclick=()=>{editorPreset.layers.splice(index+1,0,deep(layer));renderEditor();};
        const del=document.createElement("button");del.className="btn danger";del.type="button";del.textContent="Delete";
        del.disabled=editorPreset.layers.length<=1;del.onclick=()=>{if(editorPreset.layers.length>1){editorPreset.layers.splice(index,1);renderEditor();}};
        actions.append(dup,del);head.append(title,actions);card.appendChild(head);

        const lg=document.createElement("div");lg.className="factoryLayerGrid";
        const family=document.createElement("select");family.className="field";[[0,"Flow / Movement"],[1,"Color Transition / Sequence"],[2,"Blink / Twinkle"]].forEach(([v,n])=>{const o=document.createElement("option");o.value=String(v);o.textContent=n;o.selected=Number(layer.current_layer_type)===v;family.appendChild(o);});
        const colors=document.createElement("input");colors.className="field";colors.value=layerColors(layer).map(x=>"#"+x.replace("#","")).join(", ");
        const pri=numInput(layer.layer_priority??0);const ls=numInput(layer.layer_speed??0);
        lg.append(labeled("Pattern family",family),labeled("Layer colors",colors),labeled("Priority",pri),labeled("Layer speed",ls));card.appendChild(lg);

        const details=document.createElement("details");details.style.marginTop="10px";const sum=document.createElement("summary");sum.textContent="Advanced Layer Data — edit every Eufy field";const ta=document.createElement("textarea");syncLayerTextarea(layer,ta);details.append(sum,ta);card.appendChild(details);

        const syncSimple=()=>{
          layer.current_layer_type=Number(family.value);layer.layer_priority=Number(pri.value);layer.layer_speed=Number(ls.value);
          const parsed=colors.value.split(/[|,\s]+/).map(x=>x.trim().replace(/^#/,"")).filter(Boolean);
          if(parsed.some(x=>!/^[0-9a-fA-F]{6}$/.test(x))){colors.setCustomValidity("Use six-digit RGB colors such as #FF0000");}else{colors.setCustomValidity("");layer.colors=parsed.join("|");}
          title.textContent="Layer "+(index+1)+" — "+layerName(layer.current_layer_type);$("factoryEditorPattern").textContent="Pattern: "+patternSummary(editorPreset);syncLayerTextarea(layer,ta);
        };
        [family,colors,pri,ls].forEach(x=>x.addEventListener("change",syncSimple));
        ta.addEventListener("change",()=>{try{const parsed=JSON.parse(ta.value);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Layer must be a JSON object");editorPreset.layers[index]=parsed;renderEditor();$("factoryEditorResult").textContent="Advanced layer data accepted.";}catch(e){$("factoryEditorResult").textContent="Layer JSON error: "+e.message;}});
        body.appendChild(card);
      });
    }

    function openFactoryEditor(p){
      editorPreset=deep(p);renderEditor();$("factoryEditorResult").textContent=p.customized?"This preset has saved edits on Oracle.":"Editing the original Eufy recipe.";overlay.classList.add("open");document.body.style.overflow="hidden";
    }
    function closeFactoryEditor(){overlay.classList.remove("open");document.body.style.overflow="";editorPreset=null;}
    $("factoryEditorClose").addEventListener("click",closeFactoryEditor);
    overlay.addEventListener("click",e=>{if(e.target===overlay)closeFactoryEditor();});

    async function saveFactoryEditor(apply=false){
      if(!editorPreset)return;
      const selectedTarget=$("factoryEditorTarget")?.value||"All";
      const selectedMode=$("factoryEditorApplyMode")?.value||"compatible";
      const out=$("factoryEditorResult"),save=$("factoryEditorSave"),applyBtn=$("factoryEditorApply");
      save.disabled=applyBtn.disabled=true;out.textContent="Validating and saving factory recipe on Oracle…";
      try{
        const r=await post("/api/eufy/factory-presets/save",{lightId:Number(editorPreset.lightId),preset:editorPreset},12000);
        editorPreset=deep(r.preset);const idx=presets.findIndex(x=>Number(x.lightId)===Number(editorPreset.lightId));if(idx>=0)presets[idx]=deep(editorPreset);renderFactory();renderEditor();await loadFactoryPromotions(false);
        out.textContent="Factory preset saved on Oracle.";
        if(apply)await runFactoryTest(editorPreset,applyBtn,out,selectedTarget,selectedMode);
      }catch(e){out.textContent="Factory save failed: "+e.message;}
      finally{save.disabled=applyBtn.disabled=false;}
    }
    $("factoryEditorSave").addEventListener("click",()=>saveFactoryEditor(false));
    $("factoryEditorApply").addEventListener("click",()=>saveFactoryEditor(true));
    $("factoryEditorReset").addEventListener("click",async()=>{
      if(!editorPreset||!confirm("Restore this preset to the original Eufy factory recipe?"))return;
      const id=Number(editorPreset.lightId),out=$("factoryEditorResult");out.textContent="Restoring original Eufy recipe…";
      try{await post("/api/eufy/factory-presets/reset",{lightId:id});await loadFactoryCatalog(false);await loadFactoryPromotions(false);const fresh=presets.find(x=>Number(x.lightId)===id);if(fresh){editorPreset=deep(fresh);renderEditor();}out.textContent="Original Eufy factory recipe restored.";}catch(e){out.textContent="Restore failed: "+e.message;}
    });

    function factorySceneColorPills(colors){
      const host=document.createElement("div");host.className="chips";
      (colors||[]).forEach(v=>{
        const hex="#"+(Number(v)&0xffffff).toString(16).padStart(6,"0").toUpperCase();
        const chip=document.createElement("span");chip.className="colorNamePill";
        chip.style.background=typeof semanticColorVisual==="function"?semanticColorVisual(hex):hex;
        chip.style.color=typeof semanticColorInk==="function"?semanticColorInk(hex):"#fff";
        chip.textContent=typeof semanticColorName==="function"?semanticColorName(hex):hex;
        host.appendChild(chip);
      });
      return host;
    }
    function promotionCard(p,baseEvent){
      const card=document.createElement("div");card.className="card event factoryScheduledEvent";card.dataset.factoryLightId=String(p.lightId);
      const checks=document.createElement("div");checks.className="eventchecks";checks.style.display="flex";checks.style.flexDirection="column";checks.style.gap="7px";checks.style.minWidth="92px";
      const enabled=document.createElement("input");enabled.type="checkbox";enabled.checked=p.enabled!==false;enabled.title="Enabled";
      const enabledLabel=document.createElement("label");enabledLabel.className="small";enabledLabel.style.display="flex";enabledLabel.style.alignItems="center";enabledLabel.style.gap="6px";enabledLabel.append(enabled,document.createTextNode("Enabled"));checks.appendChild(enabledLabel);

      const info=document.createElement("div");
      const title=document.createElement("div");title.className="small";
      const strong=document.createElement("strong");strong.textContent=p.name||("Factory "+p.lightId);
      const tag=document.createElement("span");tag.className="tag factoryScheduleTag";tag.textContent="Eufy Factory";tag.style.marginLeft="5px";
      title.append(strong,tag);
      const sub=document.createElement("div");sub.className="sub";
      const scene=p.scene||{};
      const speedName=["","Very Slow","Slow","Normal","Fast","Very Fast"][Number(scene.speed)||3]||"Normal";
      sub.textContent=(baseEvent?.when||("Matches "+p.eventName))+" • "+(scene.effect||"Factory Pattern")+" • "+speedName;
      const match=document.createElement("div");match.className="factoryScheduleMatch";match.textContent="Scheduled with "+p.eventName+" • "+p.scheduling;
      const tags=document.createElement("div");tags.className="tags";
      const kind=document.createElement("span");kind.className="tag "+String(baseEvent?.kind||p.event?.kind||"Holiday").toLowerCase();kind.textContent=baseEvent?.kind||p.event?.kind||"Holiday";tags.appendChild(kind);
      info.append(title,sub,match,tags,factorySceneColorPills(scene.colors));

      const actions=document.createElement("div");actions.className="row wraprow";
      const preview=document.createElement("button");preview.className="btn previewEvent";preview.type="button";preview.textContent="Preview";
      const edit=document.createElement("button");edit.className="btn";edit.type="button";edit.textContent="Edit";
      const result=document.createElement("div");result.className="factoryScheduleResult";
      preview.addEventListener("click",async()=>{await runFactoryTest(p.preset,preview,result,"All","compatible");if(typeof status==="function")status((p.name||"Factory preset")+" previewing on all light strings. Use Resume Schedule when finished.");});
      edit.addEventListener("click",()=>openFactoryEditor(p.preset));
      enabled.addEventListener("change",async()=>{
        const wanted=enabled.checked;enabled.disabled=true;result.textContent=(wanted?"Enabling ":"Disabling ")+(p.name||"Factory preset")+"…";
        try{
          const r=await post("/api/eufy/factory-promotions",{lightId:Number(p.lightId),enabled:wanted},12000);
          p.enabled=r.promotion?.enabled!==false;enabled.checked=p.enabled;result.textContent=(p.name||"Factory preset")+" "+(p.enabled?"enabled":"disabled")+" in the schedule.";
          if(typeof loadState==="function")loadState();
        }catch(e){enabled.checked=!wanted;result.textContent="Schedule change failed: "+e.message;}
        finally{enabled.disabled=false;}
      });
      actions.append(preview,edit);card.append(checks,info,actions,result);
      return card;
    }
    function renderFactorySchedulePromotions(events=lastScheduleEvents){
      lastScheduleEvents=Array.isArray(events)?events:[];
      const root=$("eventList");if(!root)return;
      root.querySelectorAll(":scope > .factoryScheduledEvent").forEach(x=>x.remove());
      if(!promotions.length)return;
      const baseCards=[...root.querySelectorAll(":scope > .event:not(.factoryScheduledEvent)")];
      const byId=new Map(lastScheduleEvents.map((e,i)=>[String(e.id),{event:e,card:baseCards[i]}]));
      const grouped=new Map();
      for(const p of promotions){
        if(!grouped.has(String(p.eventId)))grouped.set(String(p.eventId),[]);
        grouped.get(String(p.eventId)).push(p);
      }
      for(const [eventId,list] of grouped){
        const base=byId.get(eventId);
        if(!base?.card)continue;
        let anchor=base.card;
        for(const p of list){const card=promotionCard(p,base.event);anchor.after(card);anchor=card;}
      }
      const query=($("eventSearch")?.value||"").trim().toLowerCase();
      if(query){
        for(const p of promotions){
          if(byId.has(String(p.eventId)))continue;
          if(!String(p.name||"").toLowerCase().includes(query))continue;
          root.appendChild(promotionCard(p,null));
        }
      }
    }
    async function loadFactoryPromotions(redraw=true){
      if(promotionsLoading)return;promotionsLoading=true;
      try{
        const r=await api("/api/eufy/factory-promotions?ts="+Date.now(),{},12000);
        promotions=Array.isArray(r.promotions)?r.promotions:[];
        if(redraw)renderFactorySchedulePromotions(lastScheduleEvents);
      }catch(e){console.warn("Factory schedule promotions unavailable",e);}
      finally{promotionsLoading=false;}
    }
    function installFactorySchedulePromotions(){
      const prior=window.renderEvents;
      if(typeof prior!=="function"||prior._factoryPromotions)return;
      const wrapped=function(events){lastScheduleEvents=Array.isArray(events)?events:[];prior(events);renderFactorySchedulePromotions(lastScheduleEvents);};
      wrapped._factoryPromotions=true;window.renderEvents=wrapped;
      loadFactoryPromotions(false).then(()=>{if(lastScheduleEvents.length)renderFactorySchedulePromotions(lastScheduleEvents);});
    }

    async function runFactoryTest(p,btn,result,target="All",mode="compatible"){
      btn.disabled=true;result.textContent=(mode==="native"?"Sending exact native recipe ":"Applying compatible pattern ")+(p.name||("factory "+p.lightId))+" to "+(target==="All"?"Pool, House, Garage, and Shed":target)+"…";
      try{
        const queued=await post("/api/eufy/factory-test",{lightId:Number(p.lightId),target,mode},12000),job=queued.jobId;
        if(!job)throw new Error("Oracle did not return a factory test job");
        for(let i=0;i<90;i++){
          await new Promise(r=>setTimeout(r,800));
          const j=await api("/api/eufy/factory-test?job="+encodeURIComponent(job)+"&ts="+Date.now(),{},12000);
          if(j.state==="failed")throw new Error(j.error||"Factory test failed");
          if(j.state==="complete"){
            const r=j.result||{},parts=(r.results||[]).map(x=>x.name+" "+(x.ok?"✓":"✕"+(x.error?" "+x.error:"")));
            result.textContent=parts.join(" • ")+" • "+r.sent+"/"+r.attempted+" applied"+(r.mode==="compatible"&&r.compatible?" • Output: "+r.compatible.effect+" • speed "+r.compatible.speed:"")+(r.mode==="native"?" • Exact native recipe; verify the physical multi-layer result.":"");
            return r;
          }
        }
        throw new Error("Factory test did not finish in time");
      }catch(e){result.textContent="Factory test failed: "+e.message;return null;}
      finally{btn.disabled=false;}
    }

    installFactorySchedulePromotions();
    window.addEventListener("anderson-profile-selected",()=>setTimeout(()=>loadFactoryPromotions(true),120));

    tab.addEventListener("click",()=>{
      if(tab.hidden||!window.andersonProfile||window.andersonProfile.id!=="jason")return;
      qa(".v3BottomNav .tab").forEach(x=>x.classList.toggle("active",x===tab));qa(".page").forEach(x=>x.classList.toggle("active",x===page));document.body.dataset.page="factory";window.scrollTo({top:0,behavior:"smooth"});loadFactoryPromotions(false);loadFactoryCatalog(false);
    });
    $("factorySearch")?.addEventListener("input",renderFactory);
    $("factoryRefresh")?.addEventListener("click",()=>loadFactoryCatalog(true));
    $("factoryResume")?.addEventListener("click",async()=>{const b=$("factoryResume");b.disabled=true;try{await post("/api/resume",{});$("factoryCatalogStatus").textContent="Normal Oracle schedule resumed.";}catch(e){$("factoryCatalogStatus").textContent="Could not resume schedule: "+e.message;}finally{b.disabled=false;}});
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