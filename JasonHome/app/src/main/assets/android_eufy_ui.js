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
    tab.id="factoryTab";tab.type="button";tab.className="tab";tab.dataset.tab="factory";tab.hidden=false;
    tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/></svg><span>Factory</span>';
    const settingsTab=q('.v3BottomNav .tab[data-tab="settings"]')||q('.nav .tab[data-tab="settings"]');
    nav.insertBefore(tab,settingsTab||nav.lastElementChild);

    const page=document.createElement("section");
    page.className="page";page.dataset.page="factory";page.hidden=true;
    page.innerHTML=
      '<div class="v3PageTitle"><span>EUFY FACTORY LAB</span><h2>Factory preset editor</h2></div>'+
      '<div class="panel">'+
        '<div class="row between wraprow"><div><strong>Editable Eufy factory catalog</strong><div class="sub">Factory scenes stay isolated from normal effects and schedules until you deliberately apply them.</div></div><span id="factoryCatalogBadge" class="badge">Not loaded</span></div>'+
        '<div class="note">Pattern shows what each Eufy layer actually does. Edit opens the complete recipe. Apply and Preview use Exact Native Factory experimental mode for the original Eufy multi-layer recipe on every factory preset. Pool and House are E120; Garage and Shed are E22.</div>'+
        '<div class="grid2" style="margin-top:12px"><input id="factorySearch" class="field" type="search" placeholder="Search preset name, ID, or pattern"><button id="factoryRefresh" class="btn" type="button">Refresh Catalog</button></div>'+
        '<div id="factoryCatalogStatus" class="status">Open this tab to load the Eufy factory catalog.</div>'+
      '</div>'+
      '<div class="panel">'+
        '<div class="row between wraprow"><div><strong>Factory layouts</strong><div class="sub">Edit the recipe or apply its exact native Eufy factory pattern to all four strings.</div></div><button id="factoryResume" class="btn" type="button">Resume Schedule</button></div>'+
        '<div id="factoryPresetList" class="presetList"></div>'+
      '</div>';
    wrap.appendChild(page);

    const overlay=document.createElement("div");
    overlay.id="factoryEditorOverlay";overlay.className="factoryEditorOverlay";
    overlay.innerHTML='<div class="factoryEditorCard"><div class="row between"><div><strong id="factoryEditorTitle">Factory preset</strong><div id="factoryEditorPattern" class="sub"></div></div><button id="factoryEditorClose" class="btn" type="button">Done</button></div><div id="factoryEditorBody"></div><div id="factoryEditorResult" class="status"></div><div class="factoryEditorActions"><button id="factoryEditorReset" class="btn danger" type="button">Restore Eufy Original</button><button id="factoryEditorSave" class="btn" type="button">Save Changes</button><button id="factoryEditorApply" class="btn primary" type="button">Save & Apply</button></div></div>';
    document.body.appendChild(overlay);

    const style=document.createElement("style");
    style.textContent=
      '#factoryPresetList{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px;align-items:stretch}#eventList{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:8px!important;align-items:stretch}#eventList>.card.event{display:flex!important;flex-direction:column!important;gap:6px!important;min-width:0!important;padding:9px!important;border-radius:11px!important;margin:0!important}#eventList>.card.event>.eventchecks{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;gap:6px!important;min-width:0!important;order:1}#eventList>.card.event>.eventchecks label{font-size:9px!important;gap:4px!important}#eventList>.card.event>.eventchecks input{transform:scale(.9)}#eventList>.card.event>div:nth-child(2){order:2;min-width:0}#eventList>.card.event>div:nth-child(2) .small{font-size:12px!important;line-height:1.15}#eventList>.card.event>div:nth-child(2) .sub{font-size:9px!important;line-height:1.25;margin-top:2px}#eventList>.card.event>div:nth-child(2) .tags{margin-top:3px}#eventList>.card.event>div:nth-child(2) .tag{font-size:8px!important;padding:1px 4px!important}#eventList>.card.event>div:nth-child(2) .chips{display:flex!important;gap:3px!important;flex-wrap:wrap!important;margin-top:4px}#eventList>.card.event>div:nth-child(2) .colorNamePill{font-size:8px!important;min-height:18px!important;padding:2px 5px!important}#eventList>.card.event>.row.wraprow{order:3;display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px!important;margin-top:auto}#eventList>.card.event>.row.wraprow .btn{font-size:10px!important;padding:7px 5px!important;min-width:0!important}#eventList>.factoryScheduleResult{order:4;font-size:9px!important;line-height:1.25}#eventList .factoryScheduleMatch{font-size:9px!important;line-height:1.25}.factoryPresetCard{display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px;border:1px solid rgba(120,160,220,.22);border-radius:11px;background:#091327;margin:0}.factoryPresetName{font-size:13px;line-height:1.15;min-height:30px}.factoryPresetMeta{font-size:9px;color:#91a7ca;margin-top:1px}.factoryPattern{font-size:10px;line-height:1.25;color:#d4e5ff;margin-top:2px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.factorySwatches{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}.factorySwatch{width:13px;height:13px;border-radius:50%;border:1px solid rgba(255,255,255,.35)}.factoryFlags{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}.factoryFlag{font-size:8px;border:1px solid rgba(130,175,235,.35);border-radius:999px;padding:1px 4px;color:#aec5e8}.factoryFlag.edited{border-color:#31d89b;color:#7ef2c4}.factoryButtons{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:auto}.factoryButtons .btn{font-size:10px;padding:7px 5px;min-width:0}.factoryTestResult{font-size:9px;line-height:1.25;color:#a9bad5;min-height:0;grid-column:auto}.factoryScheduledEvent{border-color:rgba(49,216,155,.42)!important;box-shadow:inset 3px 0 0 rgba(49,216,155,.65)}.factoryScheduledEvent .factoryScheduleTag{border-color:#31d89b;color:#7ef2c4}.factoryScheduleResult{font-size:10px;color:#a9bad5;margin-top:4px}.factoryScheduleMatch{font-size:10px;color:#7ef2c4;margin-top:3px}.factoryEditorOverlay{position:fixed;inset:0;z-index:22000;background:rgba(0,0,0,.78);display:none;align-items:flex-start;justify-content:center;padding:calc(18px + env(safe-area-inset-top)) 12px calc(18px + env(safe-area-inset-bottom));overflow:auto}.factoryEditorOverlay.open{display:flex}.factoryEditorCard{width:min(760px,100%);background:#081526;border:1px solid rgba(92,177,235,.42);border-radius:18px;padding:16px;box-shadow:0 24px 80px rgba(0,0,0,.55)}.factoryEditorGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.factoryLayer{border:1px solid rgba(102,155,214,.25);border-radius:14px;padding:12px;margin-top:12px;background:#091327}.factoryLayerHead{display:flex;justify-content:space-between;gap:8px;align-items:center}.factoryLayerGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.factoryLayer textarea{width:100%;min-height:180px;box-sizing:border-box;background:#050c17;color:#d7e7ff;border:1px solid #304765;border-radius:10px;padding:9px;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.factoryEditorActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px}.factoryLayerActions{display:flex;gap:6px;flex-wrap:wrap}@media(max-width:560px){#factoryPresetList,#eventList{grid-template-columns:repeat(2,minmax(0,1fr))}.factoryEditorGrid,.factoryLayerGrid{grid-template-columns:1fr}.factoryEditorActions .btn{flex:1 1 100%}}@media(max-width:285px){#factoryPresetList,#eventList{grid-template-columns:1fr}}@media(min-width:760px){#factoryPresetList,#eventList{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}}';
    document.head.appendChild(style);

    let presets=[],promotions=[],catalogLoading=false,promotionsLoading=false,editorPreset=null,lastScheduleEvents=[];
    const deep=x=>JSON.parse(JSON.stringify(x));
    function dedupeFactoryByName(items){const best=new Map();for(const p of items||[]){const k=String(p?.name||("id:"+p?.lightId)).trim().toLowerCase().replace(/\s+/g," ");const old=best.get(k);if(!old||Number(p?.lightId||0)<Number(old?.lightId||0))best.set(k,p)}return [...best.values()].sort((a,b)=>String(a?.name||"").localeCompare(String(b?.name||""),undefined,{sensitivity:"base",numeric:true})||Number(a.lightId)-Number(b.lightId))}
    const escapeColor=x=>/^#?[0-9a-fA-F]{6}$/.test(x||"")?"#"+String(x).replace("#",""):"#444";
    const layerName=t=>Number(t)===0?"Flow / Movement":Number(t)===1?"Color Transition / Sequence":Number(t)===2?"Blink / Twinkle":"Unknown Pattern "+String(t??"?");
    const patternSummary=p=>Array.isArray(p?.layers)&&p.layers.length?p.layers.map((l,i)=>(i+1)+". "+layerName(l?.current_layer_type)).join(" + "):"No serializable pattern layers";
    const layerColors=l=>String(l?.colors||"").split("|").map(x=>x.trim()).filter(Boolean);

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
        test.addEventListener("click",()=>runFactoryTest(p,test,result,"All","native"));
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
      const applyMode=document.createElement("select");applyMode.id="factoryEditorApplyMode";applyMode.className="field";[["native","Exact Native Factory — experimental"]].forEach(([v,n])=>{const o=document.createElement("option");o.value=v;o.textContent=n;applyMode.appendChild(o);});
      grid.append(labeled("Preset name",name),labeled("Preview brightness %",brightness),labeled("Factory speed byte (0–255 • mapped in Compatible)",speed),labeled("Layer execution mode (0–255 • Native only)",exec),labeled("Apply target",target),labeled("Apply method",applyMode));
      body.appendChild(grid);

      const explain=document.createElement("div");explain.className="note";explain.style.marginTop="12px";explain.textContent="Layer types: Flow / Movement controls traveling patterns; Color Transition / Sequence controls ordered color changes; Blink / Twinkle controls flash/sparkle behavior. Compatible Pattern uses the dominant layer’s family/colors/priority/speed, maps the Factory speed to Jason Home’s 1–5 speed range, and uses Preview brightness when you manually Preview/Apply. Scheduled holiday playback uses the normal Schedule 1 brightness and Schedule 2 overnight brightness instead. Exact Native Factory sends Eufy’s full multi-layer recipe and remains experimental, especially on E120. Advanced Layer Data exposes every raw Eufy parameter; fields not used by the Compatible translation affect only Exact Native Factory.";
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
      const selectedMode=$("factoryEditorApplyMode")?.value||"native";
      const out=$("factoryEditorResult"),save=$("factoryEditorSave"),applyBtn=$("factoryEditorApply");
      save.disabled=applyBtn.disabled=true;out.textContent="Validating and saving factory recipe on Oracle…";
      try{
        const r=await post("/api/eufy/factory-presets/save",{lightId:Number(editorPreset.lightId),preset:editorPreset},12000);
        editorPreset=deep(r.preset);const idx=presets.findIndex(x=>Number(x.lightId)===Number(editorPreset.lightId));if(idx>=0)presets[idx]=deep(editorPreset);renderFactory();renderEditor();await loadFactoryPromotions(true);
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
      try{await post("/api/eufy/factory-presets/reset",{lightId:id});await loadFactoryCatalog(false);await loadFactoryPromotions(true);const fresh=presets.find(x=>Number(x.lightId)===id);if(fresh){editorPreset=deep(fresh);renderEditor();}out.textContent="Original Eufy factory recipe restored.";}catch(e){out.textContent="Restore failed: "+e.message;}
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
      preview.addEventListener("click",async()=>{await runFactoryTest(p.preset,preview,result,"All","native");if(typeof status==="function")status((p.name||"Factory preset")+" previewing on all light strings. Use Resume Schedule when finished.");});
      edit.addEventListener("click",()=>openFactoryEditor(p.preset));
      enabled.addEventListener("change",async()=>{
        const wanted=enabled.checked;enabled.disabled=true;result.textContent=(wanted?"Enabling ":"Disabling ")+(p.name||"Factory preset")+"…";
        try{
          const r=await post("/api/eufy/factory-promotions",{lightId:Number(p.lightId),enabled:wanted},12000);
          p.enabled=r.promotion?.enabled!==false;enabled.checked=p.enabled;window.dispatchEvent(new CustomEvent("factory-promotions-changed",{detail:{lightId:Number(p.lightId),enabled:p.enabled}}));result.textContent=(p.name||"Factory preset")+" "+(p.enabled?"enabled":"disabled")+" in the schedule.";
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

    async function runFactoryTest(p,btn,result,target="All",mode="native"){
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
    window.addEventListener("factory-promotions-changed",()=>setTimeout(()=>loadFactoryPromotions(true),80));

    tab.addEventListener("click",()=>{
      if(tab.hidden)return;
      page.hidden=false;
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


  function installCurtainTab(){
    if($("curtainTab"))return;
    const nav=q(".v3BottomNav")||q(".nav"),wrap=q(".wrap");
    if(!nav||!wrap)return;
    const EFFECTS=[{"id":0,"name":"E-0","group":15924,"index":0,"type":3,"img":"curtain_effects/e00.jpg"},{"id":1,"name":"E-1","group":15924,"index":1,"type":3,"img":"curtain_effects/e01.jpg"},{"id":2,"name":"E-2","group":15924,"index":2,"type":3,"img":"curtain_effects/e02.jpg"},{"id":3,"name":"E-3","group":15924,"index":3,"type":3,"img":"curtain_effects/e03.jpg"},{"id":4,"name":"E-4","group":15924,"index":4,"type":3,"img":"curtain_effects/e04.jpg"},{"id":5,"name":"E-5","group":15924,"index":5,"type":3,"img":"curtain_effects/e05.jpg"},{"id":6,"name":"E-6","group":15924,"index":6,"type":3,"img":"curtain_effects/e06.jpg"},{"id":7,"name":"E-7","group":15924,"index":7,"type":3,"img":"curtain_effects/e07.jpg"},{"id":8,"name":"E-8","group":15924,"index":8,"type":3,"img":"curtain_effects/e08.jpg"},{"id":9,"name":"E-9","group":15924,"index":9,"type":3,"img":"curtain_effects/e09.jpg"},{"id":10,"name":"E-10","group":15924,"index":10,"type":3,"img":"curtain_effects/e10.jpg"},{"id":11,"name":"E-11","group":15924,"index":11,"type":3,"img":"curtain_effects/e11.jpg"},{"id":12,"name":"E-12","group":15924,"index":12,"type":3,"img":"curtain_effects/e12.jpg"},{"id":13,"name":"E-13","group":15924,"index":13,"type":3,"img":"curtain_effects/e13.jpg"},{"id":14,"name":"E-14","group":15924,"index":14,"type":3,"img":"curtain_effects/e14.jpg"},{"id":15,"name":"E-15","group":15924,"index":15,"type":3,"img":"curtain_effects/e15.jpg"},{"id":16,"name":"E-16","group":15924,"index":16,"type":3,"img":"curtain_effects/e16.jpg"},{"id":17,"name":"E-17","group":15924,"index":17,"type":3,"img":"curtain_effects/e17.jpg"},{"id":18,"name":"E-18","group":15924,"index":18,"type":3,"img":"curtain_effects/e18.jpg"},{"id":19,"name":"E-19","group":15924,"index":19,"type":3,"img":"curtain_effects/e19.jpg"},{"id":20,"name":"E-20","group":15924,"index":20,"type":3,"img":"curtain_effects/e20.jpg"},{"id":21,"name":"E-21","group":15924,"index":21,"type":3,"img":"curtain_effects/e21.jpg"},{"id":22,"name":"E-22","group":15924,"index":22,"type":3,"img":"curtain_effects/e22.jpg"},{"id":23,"name":"E-23","group":15924,"index":23,"type":3,"img":"curtain_effects/e23.jpg"},{"id":24,"name":"E-24","group":15924,"index":24,"type":3,"img":"curtain_effects/e24.jpg"},{"id":25,"name":"E-25","group":15924,"index":25,"type":3,"img":"curtain_effects/e25.jpg"},{"id":26,"name":"E-26","group":15924,"index":26,"type":3,"img":"curtain_effects/e26.jpg"},{"id":27,"name":"E-27","group":15924,"index":27,"type":3,"img":"curtain_effects/e27.jpg"},{"id":28,"name":"E-28","group":15924,"index":28,"type":3,"img":"curtain_effects/e28.jpg"},{"id":29,"name":"E-29","group":15924,"index":29,"type":3,"img":"curtain_effects/e29.jpg"},{"id":30,"name":"E-30","group":15924,"index":30,"type":3,"img":"curtain_effects/e30.jpg"},{"id":31,"name":"E-31","group":15924,"index":31,"type":3,"img":"curtain_effects/e31.jpg"},{"id":32,"name":"E-32","group":15924,"index":32,"type":3,"img":"curtain_effects/e32.jpg"},{"id":33,"name":"E-33","group":15924,"index":33,"type":3,"img":"curtain_effects/e33.jpg"},{"id":34,"name":"E-34","group":15924,"index":34,"type":3,"img":"curtain_effects/e34.jpg"},{"id":35,"name":"E-35","group":15924,"index":35,"type":3,"img":"curtain_effects/e35.jpg"},{"id":36,"name":"E-36","group":15924,"index":36,"type":3,"img":"curtain_effects/e36.jpg"},{"id":37,"name":"E-37","group":15924,"index":37,"type":3,"img":"curtain_effects/e37.jpg"},{"id":38,"name":"E-38","group":15924,"index":38,"type":3,"img":"curtain_effects/e38.jpg"},{"id":39,"name":"E-39","group":15924,"index":39,"type":3,"img":"curtain_effects/e39.jpg"},{"id":40,"name":"E-40","group":15924,"index":40,"type":3,"img":"curtain_effects/e40.jpg"},{"id":41,"name":"E-41","group":15924,"index":41,"type":3,"img":"curtain_effects/e41.jpg"},{"id":42,"name":"E-42","group":15924,"index":42,"type":3,"img":"curtain_effects/e42.jpg"},{"id":43,"name":"E-43","group":15924,"index":43,"type":3,"img":"curtain_effects/e43.jpg"},{"id":44,"name":"E-44","group":15924,"index":44,"type":3,"img":"curtain_effects/e44.jpg"},{"id":45,"name":"E-45","group":15924,"index":45,"type":3,"img":"curtain_effects/e45.jpg"},{"id":46,"name":"E-46","group":15924,"index":46,"type":3,"img":"curtain_effects/e46.jpg"},{"id":47,"name":"E-47","group":15924,"index":47,"type":3,"img":"curtain_effects/e47.jpg"},{"id":48,"name":"E-48","group":15924,"index":48,"type":3,"img":"curtain_effects/e48.jpg"},{"id":49,"name":"E-49","group":15924,"index":49,"type":3,"img":"curtain_effects/e49.jpg"},{"id":50,"name":"E-50","group":15924,"index":50,"type":3,"img":"curtain_effects/e50.jpg"},{"id":51,"name":"E-51","group":15924,"index":51,"type":3,"img":"curtain_effects/e51.jpg"},{"id":52,"name":"E-52","group":15924,"index":52,"type":3,"img":"curtain_effects/e52.jpg"},{"id":53,"name":"E-53","group":15924,"index":53,"type":3,"img":"curtain_effects/e53.jpg"},{"id":54,"name":"E-54","group":15924,"index":54,"type":3,"img":"curtain_effects/e54.jpg"},{"id":55,"name":"E-55","group":15193,"index":0,"type":1,"img":"curtain_effects/e55.jpg"},{"id":56,"name":"E-56","group":15194,"index":1,"type":1,"img":"curtain_effects/e56.jpg"},{"id":57,"name":"E-57","group":15195,"index":2,"type":1,"img":"curtain_effects/e57.jpg"},{"id":58,"name":"E-58","group":15196,"index":3,"type":1,"img":"curtain_effects/e58.jpg"},{"id":59,"name":"E-59","group":15197,"index":4,"type":1,"img":"curtain_effects/e59.jpg"},{"id":60,"name":"E-60","group":15198,"index":5,"type":1,"img":"curtain_effects/e60.jpg"},{"id":61,"name":"E-61","group":15199,"index":6,"type":1,"img":"curtain_effects/e61.jpg"},{"id":62,"name":"E-62","group":15200,"index":7,"type":1,"img":"curtain_effects/e62.jpg"},{"id":63,"name":"E-63","group":15201,"index":8,"type":1,"img":"curtain_effects/e63.jpg"},{"id":64,"name":"E-64","group":15202,"index":9,"type":1,"img":"curtain_effects/e64.jpg"},{"id":65,"name":"E-65","group":15203,"index":10,"type":1,"img":"curtain_effects/e65.jpg"},{"id":66,"name":"E-66","group":15204,"index":11,"type":1,"img":"curtain_effects/e66.jpg"},{"id":67,"name":"E-67","group":15205,"index":12,"type":1,"img":"curtain_effects/e67.jpg"},{"id":68,"name":"E-68","group":15206,"index":13,"type":1,"img":"curtain_effects/e68.jpg"},{"id":69,"name":"E-69","group":15207,"index":14,"type":1,"img":"curtain_effects/e69.jpg"},{"id":70,"name":"E-70","group":15208,"index":15,"type":1,"img":"curtain_effects/e70.jpg"},{"id":71,"name":"E-71","group":15209,"index":16,"type":1,"img":"curtain_effects/e71.jpg"},{"id":72,"name":"E-72","group":15210,"index":17,"type":1,"img":"curtain_effects/e72.jpg"},{"id":73,"name":"E-73","group":15211,"index":18,"type":1,"img":"curtain_effects/e73.jpg"},{"id":74,"name":"E-74","group":15212,"index":19,"type":1,"img":"curtain_effects/e74.jpg"},{"id":75,"name":"E-75","group":15213,"index":20,"type":1,"img":"curtain_effects/e75.jpg"},{"id":76,"name":"E-76","group":15214,"index":21,"type":1,"img":"curtain_effects/e76.jpg"},{"id":77,"name":"E-77","group":15215,"index":22,"type":1,"img":"curtain_effects/e77.jpg"},{"id":78,"name":"E-78","group":15216,"index":23,"type":1,"img":"curtain_effects/e78.jpg"},{"id":79,"name":"E-79","group":15217,"index":24,"type":1,"img":"curtain_effects/e79.jpg"},{"id":80,"name":"E-80","group":15218,"index":25,"type":1,"img":"curtain_effects/e80.jpg"},{"id":81,"name":"E-81","group":15219,"index":26,"type":1,"img":"curtain_effects/e81.jpg"},{"id":82,"name":"E-82","group":15220,"index":27,"type":1,"img":"curtain_effects/e82.jpg"},{"id":83,"name":"E-83","group":15221,"index":28,"type":1,"img":"curtain_effects/e83.jpg"},{"id":84,"name":"E-84","group":15222,"index":29,"type":1,"img":"curtain_effects/e84.jpg"},{"id":85,"name":"E-85","group":15223,"index":30,"type":1,"img":"curtain_effects/e85.jpg"},{"id":86,"name":"E-86","group":15224,"index":31,"type":1,"img":"curtain_effects/e86.jpg"},{"id":87,"name":"E-87","group":15225,"index":32,"type":1,"img":"curtain_effects/e87.jpg"}];
    const UUID={service:"00000074-1972-1925-3022-077119514e44",write:"01020074-1972-1925-3022-077119514e44",notify:"01010074-1972-1925-3022-077119514e44",heartbeatWrite:"02020074-1972-1925-3022-077119514e44",heartbeatNotify:"02010074-1972-1925-3022-077119514e44"};
    const OP={info:0x00cd,cap:0x00a7,on:0x09d2,off:0x09d3,brightness:0x09cd,effectMode:0x096a,effect:0x0a2e,speed:0x09db,layout:0x09c6};
    const LAYOUT={reset:0,rotate180:4,flipTopBottom:5,flipLeftRight:6};
    let seq=1,tx=1,device=null,server=null,writer=null,heartbeatWriter=null,reader=null,hbReader=null,queue=Promise.resolve(),heartbeatTimer=null,currentEffect=null;
    const tab=document.createElement("button");
    tab.id="curtainTab";tab.type="button";tab.className="tab";tab.dataset.tab="curtain";
    tab.innerHTML='<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16"/><path d="M6 4v16"/><path d="M10 4v16"/><path d="M14 4v16"/><path d="M18 4v16"/><path d="M4 20h16"/></svg><span>Curtain</span>';
    const settingsTab=q('.v3BottomNav .tab[data-tab="settings"]')||q('.nav .tab[data-tab="settings"]');
    nav.insertBefore(tab,settingsTab||nav.lastElementChild);
    const page=document.createElement("section");page.className="page";page.dataset.page="curtain";page.hidden=true;
    page.innerHTML='<div class="v3PageTitle"><span>SMARTDAWN CURTAIN</span><h2>Curtain lights</h2></div>'+ 
      '<div class="panel curtainPanel"><div class="row between wraprow"><div><strong>Controller path</strong><div class="sub">Direct Bluetooth works now. Nano C6 / local bridge is prepped for the controller you are buying.</div></div><span id="curtainStatusBadge" class="badge">Offline</span></div>'+ 
      '<div class="curtainModeGrid"><label class="curtainCheck"><input id="curtainModeDirect" type="checkbox"> Direct Bluetooth</label><label class="curtainCheck"><input id="curtainModeNano" type="checkbox"> Nano C6 / Local control</label></div>'+ 
      '<div class="grid2"><button id="curtainConnect" class="btn primary" type="button">Connect DN5E58</button><button id="curtainDisconnect" class="btn" type="button">Disconnect</button></div>'+ 
      '<div class="curtainNanoBox"><div class="label">Nano C6 / local URL</div><input id="curtainNanoUrl" class="field" placeholder="http://curtain.local or http://192.168.1.50"><div class="grid2" style="margin-top:8px"><button id="curtainSaveMode" class="btn" type="button">Save Mode</button><button id="curtainTestLocal" class="btn" type="button">Test Local</button></div></div><div id="curtainStatus" class="status">Choose a controller path.</div></div>'+ 
      '<div class="panel curtainPanel"><div class="row between wraprow"><div><strong>Power and live settings</strong><div class="sub">These are direct SmartDawn commands decoded from your captures.</div></div><button id="curtainRefresh" class="btn" type="button">Refresh</button></div>'+ 
      '<div class="curtainControls"><button id="curtainOn" class="btn primary" type="button">On</button><button id="curtainOff" class="btn" type="button">Off</button><label>Brightness <output id="curtainBrightnessVal">100%</output><input id="curtainBrightness" type="range" min="0" max="100" value="100"></label><label>Speed <output id="curtainSpeedVal">88%</output><input id="curtainSpeed" type="range" min="1" max="100" value="88"></label></div></div>'+ 
      '<div class="panel curtainPanel"><div class="row between wraprow"><div><strong>Layout correction</strong><div class="sub">Matches SmartDawn: flip left/right, flip top/bottom, rotate, reset.</div></div></div><div class="curtainLayoutGrid"><button class="btn" data-curtain-layout="flipLeftRight" type="button">Flip Left/Right</button><button class="btn" data-curtain-layout="flipTopBottom" type="button">Flip Top/Bottom</button><button class="btn" data-curtain-layout="rotate180" type="button">Rotate 180°</button><button class="btn primary" data-curtain-layout="reset" type="button">Reset Layout</button></div></div>'+ 
      '<div class="panel curtainPanel"><div class="row between wraprow"><div><strong>Effect list</strong><div class="sub">SmartDawn effects E-0 through E-87 from your app list. Tap a picture to send it.</div></div><input id="curtainSearch" class="field curtainSearch" type="search" placeholder="Search E-55"></div><div id="curtainEffectGrid" class="curtainEffectGrid"></div></div>';
    wrap.appendChild(page);
    const style=document.createElement("style");style.id="curtainTabStyle";style.textContent='.curtainPanel{overflow:hidden}.curtainModeGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}.curtainCheck{display:flex;align-items:center;gap:8px;border:1px solid rgba(150,190,245,.24);border-radius:12px;background:#081527;padding:11px;font-size:12px}.curtainCheck input{width:20px;height:20px;accent-color:#bcd5ff}.curtainNanoBox{margin-top:12px}.curtainControls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.curtainControls label{grid-column:1/-1;font-size:12px;color:#d7e7ff}.curtainControls input[type=range]{width:100%;accent-color:#bcd5ff}.curtainLayoutGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.curtainSearch{max-width:190px}.curtainEffectGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:9px;margin-top:12px}.curtainEffect{position:relative;min-height:124px;border:1px solid rgba(150,190,245,.22);border-radius:13px;overflow:hidden;background:#020307;color:#fff;text-align:left;padding:0;box-shadow:inset 0 -45px 42px rgba(0,0,0,.45)}.curtainEffect img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}.curtainEffect span{position:absolute;left:9px;bottom:8px;font-weight:700;text-shadow:0 1px 4px #000}.curtainEffect small{position:absolute;right:8px;bottom:8px;font-size:9px;color:#c6d7f6;text-shadow:0 1px 4px #000}.curtainEffect.active{outline:3px solid #bcd5ff;outline-offset:2px}.curtainEffect:disabled{opacity:.55}.curtainStatusOk{color:#7ef2c4}.curtainStatusBad{color:#ffb7ae}@media(max-width:560px){.curtainModeGrid,.curtainControls,.curtainLayoutGrid{grid-template-columns:1fr}.curtainEffectGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.curtainEffect{min-height:auto}.curtainSearch{max-width:none;width:100%}}';document.head.appendChild(style);
    const savedMode=localStorage.getItem("jason-curtain-mode")||"direct",savedUrl=localStorage.getItem("jason-curtain-nano-url")||"";
    const status=(msg,ok)=>{const s=$("curtainStatus"),b=$("curtainStatusBadge");if(s){s.textContent=msg;s.className="status "+(ok===true?"curtainStatusOk":ok===false?"curtainStatusBad":"");}if(b)b.textContent=connected()?"Connected":(mode()==="nano"?"Local":"Offline");};
    const mode=()=>$("curtainModeNano")?.checked?"nano":"direct";
    const nativeCurtain=()=>!!(window.AndroidAnderson&&typeof AndroidAnderson.request==="function");
    const nativePost=async (path,body={})=>{const raw=AndroidAnderson.request("POST",path,JSON.stringify(body),"");let data={};try{data=JSON.parse(raw||"{}");}catch{}if(data&&data.ok===false)throw new Error(data.error||"Native curtain bridge failed");return data;};
    const nativeGet=async path=>{const raw=AndroidAnderson.request("GET",path,"","");let data={};try{data=JSON.parse(raw||"{}");}catch{}if(data&&data.ok===false)throw new Error(data.error||"Native curtain bridge failed");return data;};
    const connected=()=>nativeCurtain()?nativeConnected:!!server?.connected&&!!writer;
    let nativeConnected=false;
    const setMode=m=>{$("curtainModeDirect").checked=m!=="nano";$("curtainModeNano").checked=m==="nano";localStorage.setItem("jason-curtain-mode",mode());status(mode()==="nano"?"Local/Nano C6 mode selected. Commands will POST to the local bridge URL.":"Direct Bluetooth mode selected.");};
    const setBusy=busy=>qa('#curtainConnect,#curtainDisconnect,#curtainOn,#curtainOff,#curtainRefresh,#curtainEffectGrid button,[data-curtain-layout],#curtainTestLocal').forEach(x=>x.disabled=!!busy);
    const varint=n=>{const out=[];do{const b=n%128;n=Math.floor(n/128);out.push(b|(n?128:0));}while(n);return out;};
    const frame=(opcode,payload=[])=>{const bytes=new Uint8Array(24+payload.length);bytes.set([seq,1,0,0,0xf0,4]);bytes[6]=tx>>>8;bytes[7]=tx&255;bytes[10]=opcode>>>8;bytes[11]=opcode&255;bytes.set(payload,24);seq=(seq+1)&255;tx=(tx+1)&65535;return bytes;};
    const enqueue=fn=>{queue=queue.then(fn,fn);return queue;};
    const sendDirect=(opcode,payload=[])=>enqueue(async()=>{if(nativeCurtain())return; if(!connected())throw new Error("Curtain Bluetooth is not connected");await writer.writeValueWithResponse(frame(opcode,payload));});
    const localPost=async body=>{const base=($("curtainNanoUrl")?.value||"").trim().replace(/\/$/,"");if(!base)throw new Error("Enter the Nano C6/local URL first");const r=await fetch(base+"/api/curtain/control",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});if(!r.ok)throw new Error("Local controller returned HTTP "+r.status);return r.json().catch(()=>({ok:true}));};
    const command=async (body,direct)=>{try{setBusy(true);if(mode()==="nano")await localPost(body);else if(nativeCurtain()){const r=await nativePost("/api/curtain/control",body);nativeConnected=!!r.connected;}else await direct();status((body.label||"Curtain command")+" sent.",true);}catch(e){status(e.message||String(e),false);}finally{setBusy(false);renderEffects();}};
    async function connect(){try{if(mode()==="nano")return await testLocal();setBusy(true);if(nativeCurtain()){const r=await nativePost("/api/curtain/connect",{});nativeConnected=!!r.connected;return status(nativeConnected?"Connected to DN5E58 via Android Bluetooth.":(r.status||"Curtain bridge responded."),nativeConnected);}if(!navigator.bluetooth)throw new Error("This WebView/Browser does not expose Web Bluetooth and native curtain bridge is unavailable.");seq=1;tx=1;device=await navigator.bluetooth.requestDevice({filters:[{name:"DN5E58"}],optionalServices:[UUID.service]});server=await device.gatt.connect();const svc=await server.getPrimaryService(UUID.service);writer=await svc.getCharacteristic(UUID.write);reader=await svc.getCharacteristic(UUID.notify);heartbeatWriter=await svc.getCharacteristic(UUID.heartbeatWrite);hbReader=await svc.getCharacteristic(UUID.heartbeatNotify);await reader.startNotifications();await hbReader.startNotifications();await sendDirect(OP.info);await sendDirect(OP.cap);clearInterval(heartbeatTimer);heartbeatTimer=setInterval(()=>{if(connected()&&heartbeatWriter)heartbeatWriter.writeValueWithResponse(new Uint8Array(4)).catch(()=>{});},6000);status("Connected to DN5E58.",true);}catch(e){status(e.message||String(e),false);}finally{setBusy(false);}}
    function disconnect(){clearInterval(heartbeatTimer);heartbeatTimer=null;if(nativeCurtain())nativePost("/api/curtain/disconnect",{}).catch(()=>{});nativeConnected=false;try{device?.gatt?.disconnect?.();}catch{} device=server=writer=reader=heartbeatWriter=hbReader=null;status("Curtain disconnected.");}
    async function testLocal(){try{const base=($("curtainNanoUrl")?.value||"").trim().replace(/\/$/,"");if(!base)throw new Error("Enter the Nano C6/local URL first");const r=await fetch(base+"/api/curtain/status",{cache:"no-store"});if(!r.ok)throw new Error("Local controller returned HTTP "+r.status);status("Local controller responded.",true);}catch(e){status("Local test failed: "+(e.message||e),false);}}
    function renderEffects(){const root=$("curtainEffectGrid"),term=($("curtainSearch")?.value||"").trim().toLowerCase();if(!root)return;root.replaceChildren();for(const e of EFFECTS){if(term&&!e.name.toLowerCase().includes(term)&&!String(e.id).includes(term))continue;const btn=document.createElement("button");btn.type="button";btn.className="curtainEffect"+(currentEffect===e.id?" active":"");btn.innerHTML='<img alt="'+e.name+' preview" src="'+e.img+'"><span>'+e.name+'</span><small>'+(e.type===3?'scene':'pattern')+'</small>';btn.addEventListener("click",()=>{currentEffect=e.id;command({action:"effect",id:e.id,name:e.name,group:e.group,index:e.index,label:e.name},async()=>{await sendDirect(OP.effectMode);await sendDirect(OP.effect,[8,...varint(e.group),16,...varint(e.index)]);});});root.appendChild(btn);}}
    function saveMode(){localStorage.setItem("jason-curtain-mode",mode());localStorage.setItem("jason-curtain-nano-url",$("curtainNanoUrl").value.trim());status("Curtain controller preference saved.",true);}
    $("curtainModeDirect").addEventListener("change",()=>setMode("direct"));$("curtainModeNano").addEventListener("change",()=>setMode("nano"));$("curtainNanoUrl").value=savedUrl;$("curtainConnect").addEventListener("click",connect);$("curtainDisconnect").addEventListener("click",disconnect);$("curtainSaveMode").addEventListener("click",saveMode);$("curtainTestLocal").addEventListener("click",testLocal);$("curtainRefresh").addEventListener("click",()=>command({action:"refresh",label:"Refresh"},()=>sendDirect(OP.info)));$("curtainOn").addEventListener("click",()=>command({action:"power",value:true,label:"On"},()=>sendDirect(OP.on)));$("curtainOff").addEventListener("click",()=>command({action:"power",value:false,label:"Off"},()=>sendDirect(OP.off)));$("curtainBrightness").addEventListener("input",()=>$("curtainBrightnessVal").textContent=$("curtainBrightness").value+"%");$("curtainBrightness").addEventListener("change",()=>{const v=Number($("curtainBrightness").value);command({action:"brightness",value:v,label:"Brightness "+v+"%"},()=>sendDirect(OP.brightness,[8,...varint(Math.round(v*255/100))]));});$("curtainSpeed").addEventListener("input",()=>$("curtainSpeedVal").textContent=$("curtainSpeed").value+"%");$("curtainSpeed").addEventListener("change",()=>{const v=Number($("curtainSpeed").value);command({action:"speed",value:v,label:"Speed "+v+"%"},()=>sendDirect(OP.speed,[8,...varint(v)]));});qa("[data-curtain-layout]").forEach(b=>b.addEventListener("click",()=>{const key=b.dataset.curtainLayout,value=LAYOUT[key];command({action:"layout",value,key,label:b.textContent.trim()},()=>sendDirect(OP.layout,[8,...varint(value)]));}));$("curtainSearch").addEventListener("input",renderEffects);
    tab.addEventListener("click",()=>{qa(".v3BottomNav .tab").forEach(x=>x.classList.toggle("active",x===tab));qa(".page").forEach(x=>{const active=x===page;x.classList.toggle("active",active);x.hidden=!active;});document.body.dataset.page="curtain";window.scrollTo({top:0,behavior:"smooth"});renderEffects();});
    setMode(savedMode);renderEffects();
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
  installCurtainTab();

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