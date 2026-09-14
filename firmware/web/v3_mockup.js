/* ANDERSON_V3_REFERENCE_LAYOUT_RUNTIME
   Compose supplied artwork with real controls, preserving IDs and API bindings. */
(() => {
  'use strict';
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];
  const byId = id => document.getElementById(id);
  const paths = {
    home: '<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z"/>',
    effects: '<path d="m14 3 7 7-10 10-7 1 1-7zM12 5l7 7M3 3v4M1 5h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    settings: '<path d="m9 3 1-2h4l1 2 2 1 2-.2 2 3-1 2v3l1 2-2 3-2-.2-2 1-1 3h-4l-1-3-2-1-2 .2-2-3 1-2V9L3 7l2-3 2 .2z"/><circle cx="12" cy="10.5" r="3"/>',
    power: '<path d="M12 2v9M6 5a9 9 0 1 0 12 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
    heart: '<path d="M20 4c-3-2-6-1-8 2-2-3-5-4-8-2-6 5 2 12 8 16 6-4 14-11 8-16Z"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
    wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>', plus: '<path d="M12 4v16M4 12h16"/>',
    spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>'
  };
  const icon = name => `<svg class="v3Icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
  function el(tag, cls, html = '') { const n = document.createElement(tag); n.className = cls; n.innerHTML = html; return n; }
  function canOpen(target) { const tab = q(`.tab[data-tab="${target}"]`); return !!window.andersonProfile && !!tab && !tab.hidden; }
  function openPage(target, anchor) {
    if (!canOpen(target)) return;
    q(`.tab[data-tab="${target}"]`).click();
    if (anchor) byId(anchor)?.scrollIntoView({behavior:'smooth', block:'start'});
    else window.scrollTo({top:0, behavior:'smooth'});
  }
  function routeButton(cls, target, html, anchor) {
    const b = el('button', cls, html); b.type = 'button'; b.dataset.target = target;
    b.addEventListener('click', () => openPage(target, anchor)); return b;
  }
  function syncPage() {
    const page = q('.page.active')?.dataset.page || 'home';
    document.body.dataset.page = page;
    qa('.v3BottomNav .tab').forEach(tab => {
      const active = tab.dataset.tab === page || (page === 'wifi' && tab.dataset.tab === 'settings');
      tab.classList.toggle('active', active);
      if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    });
  }
  function navigation() {
    const nav = q('.nav');
    nav.className = 'nav v3BottomNav'; nav.setAttribute('role', 'navigation'); nav.setAttribute('aria-label', 'Primary navigation');
    const defs = {home:['home','Home'], lights:['effects','Effects'], events:['clock','Schedules'], favorites:['heart','Favorites'], wifi:['wifi','Wi-Fi'], settings:['settings','Settings']};
    qa('.tab', nav).forEach(tab => {
      const [symbol, label] = defs[tab.dataset.tab]; tab.innerHTML = icon(symbol) + `<span>${label}</span>`;
      tab.addEventListener('click', syncPage);
    });
    document.body.appendChild(nav);
    const actions = q('.headerActions'), badge = byId('connectionBadge'), profile = byId('activeProfile');
    badge.style.display = 'none';
    profile.className = 'v3ProfileName'; profile.style.display = 'none';
    const switcher = byId('switchProfile'); switcher.className = 'tab v3LogoutTab'; switcher.innerHTML = icon('logout') + '<span>Logout</span>'; switcher.setAttribute('aria-label','Logout'); switcher.title = 'Logout';
    actions.replaceChildren(badge, profile); nav.appendChild(switcher);
    const wifi = routeButton('v3SettingsLink','wifi',`${icon('wifi')}<span><strong>Wi-Fi</strong><small>Network & connection</small></span>${icon('arrow')}`);
    q('.page[data-page="settings"]').prepend(wifi);
    byId('bleStatus').closest('.panel').id = 'v3Controllers';
    qa('.page:not([data-page="home"])').forEach(page => {
      const titles = {lights:['Make it yours','Effects & colors'],events:['Every occasion, illuminated','Your schedules'],favorites:['Saved just for you','Favorites'],settings:['Your home, your way','Settings'],wifi:['Keep your home connected','Wi-Fi']};
      const [sub,title] = titles[page.dataset.page]; page.prepend(el('div','v3PageTitle',`<span>${sub}</span><h2>${title}</h2>`));
    });
  }
  function composeHome() {
    ensureExtraControls();
    const home = q('.page[data-page="home"]'), panel = q(':scope > .panel',home);
    panel.classList.add('v3Dashboard');
    const master = q(':scope > .row',panel); master.classList.add('v3MasterRow');
    const title = master.firstElementChild; title.className = 'v3MasterTitle';
    title.innerHTML = '<span class="v3Eyebrow">HOME LIGHTS <i></i></span><h2>All Lights</h2><span class="sub">Your whole home</span>';
    master.lastElementChild.className = 'v3PowerButtons';
    ['On','Off'].forEach(v => { const b=byId('homePower'+v); b.innerHTML=icon('power')+`<span>${v.toUpperCase()}</span>`; b.setAttribute('aria-label','Turn all lights '+v.toLowerCase()); });
    const bright = el('div','v3BrightnessBlock'), slider=byId('homeBrightness'), label=slider.previousElementSibling;
    label.firstElementChild.insertAdjacentHTML('afterbegin',icon('sun')); slider.setAttribute('aria-label','Home brightness');
    bright.append(label,slider);
    const speedBlock=el('div','v3HomeSpeedBlock','<div class="label">Effect Speed <span id="homeSpeedVal" class="muted">Normal</span></div><input id="homeSpeed" type="range" min="1" max="5" value="3" aria-label="Home effect speed">');
    speedBlock.style.marginTop='12px'; bright.appendChild(speedBlock); panel.appendChild(bright); syncSpeedControls(speed); bindSpeedControl('homeSpeed');
    const effect=byId('homeEffect'), effectLabel=effect.previousElementSibling;
    if(effectLabel?.classList.contains('label')) effectLabel.remove(); effect.setAttribute('aria-label','Current effect');
    const features=el('div','v3FeatureGrid'), fx=el('div','v3EffectCard',`<div class="v3CardKicker">${icon('spark')}<span>Current Effect</span></div>`);
    const help=byId('homeEffectHelp');help.textContent='Use your current colors.';fx.append(effect,help);
    const schedule=el('div','v3ScheduleCard');
    schedule.append(routeButton('v3CardKicker','events',`${icon('clock')}<span>Schedule</span>${icon('arrow')}`));
    const oldRunning = byId('nowTheme').closest('.panel');
    schedule.append(byId('nowTheme'),byId('scheduleWindow'),byId('resumeSchedule'));
    const live=el('div','v3LiveCard',`<div class="v3CardKicker">${icon('home')}<span>Live lights</span><i class="v3LiveDot" aria-hidden="true"></i></div>`);
    live.append(q('.housePreview',oldRunning),el('div','v3LiveCaption','<span id="v3LiveEffect">Current lights</span>'));
    features.append(fx,live);panel.append(features,schedule);
    oldRunning.remove();
    const next=byId('nextEvent').closest('.card');next.classList.add('v3Next');next.prepend(el('span','v3NextIcon',icon('clock')));
    const favoritesPanel=byId('favoriteGrid').closest('.panel'); favoritesPanel.classList.add('v3SavedScenes');q('strong',favoritesPanel).textContent='Favorite scenes';
    const custom=byId('homeCustomLightList').closest('.panel');custom.classList.add('v3SavedScenes');q('strong',custom).textContent='Your custom shows';q('.sub',custom).textContent='Saved lighting, ready to play.';
    const syncLive=()=>{const on=byId('homePowerOn').classList.contains('primary'),effect=running.effect,label=on?`${effect==='Solid'?'Solid / Static':effect} · ${byId('homeBrightVal').textContent}`:'Lights off';byId('v3LiveEffect').textContent=label;live.dataset.power=on?'on':'off';q('svg',q('.housePreview',live)).setAttribute('aria-label',`Live house preview: ${label}`);};
    const syncPower=()=>{ const on=byId('homePowerOn').classList.contains('primary');panel.dataset.power=on?'on':'off';byId('homePowerOn').setAttribute('aria-pressed',String(on));byId('homePowerOff').setAttribute('aria-pressed',String(!on));syncLive(); };
    new MutationObserver(syncPower).observe(byId('homePowerOn'),{attributes:true,attributeFilter:['class']});syncPower();
    const syncEffect=()=>{byId('homeEffectHelp').textContent=byId('homeEffect').value==='Solid'?'Holds the first color steady.':'Use your current colors.';syncLive();};
    byId('homeEffect').addEventListener('change',syncEffect);new MutationObserver(syncEffect).observe(byId('nowTheme'),{childList:true});
    new MutationObserver(syncLive).observe(byId('homeBrightVal'),{childList:true});
  }
  function effectPreviews() {
    const values=['Jump','Breath','Strobe','Solid'];
    const labels={Jump:'Jump',Breath:'Breath',Strobe:'Strobe',Solid:'Solid'};
    const hints={Jump:'Whole string steps from one color to the next',Breath:'Smoothly fades the current colors brighter and dimmer',Strobe:'Color on, off, then the next color',Solid:'Holds one color steady'};
    const palette=['#42d8ff','#ff4ebd','#E08700','#7cff74','#7c72ff'];
    if(!byId('v3EffectPreviewStyle')) {
      const style=document.createElement('style');style.id='v3EffectPreviewStyle';style.textContent=`
.v3EffectNative{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;clip-path:inset(50%)!important}
.v3EffectPicker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:9px 0 4px;min-width:0}
.v3EffectButton{min-width:0;min-height:66px;padding:7px 5px 6px;border:1px solid #79bde644;border-radius:12px;background:linear-gradient(155deg,#122943d9,#071426f2);color:#dceeff;box-shadow:inset 0 1px 0 #eaf8ff14,0 4px 12px #0003;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;transition:border-color .18s,background .18s,box-shadow .18s,transform .12s}
.v3EffectButton:active{transform:scale(.97)}.v3EffectButton[aria-pressed="true"]{border-color:#79e9ff;background:radial-gradient(ellipse at 50% 0,#35cfff38,transparent 72%),linear-gradient(145deg,#164c78e8,#08213bea);box-shadow:inset 0 1px 0 #e8fbff38,0 0 0 1px #22cfff33,0 0 16px #08a9ff28}
.v3EffectMini{width:100%;max-width:66px;min-height:20px;display:grid;grid-template-columns:repeat(5,1fr);align-items:center;gap:3px;padding:5px 6px;border-radius:99px;background:#020914c9;border:1px solid #8fdfff26;overflow:hidden}
.v3EffectMini i{display:block;width:100%;aspect-ratio:1;border-radius:50%;background:#42d8ff;box-shadow:0 0 7px currentColor;color:#42d8ff;will-change:opacity,transform,filter}
.v3EffectName{font-size:10px;font-weight:720;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.v3EffectCard .v3EffectPicker{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-top:7px}.v3EffectCard .v3EffectButton{min-height:58px;padding:5px 3px;gap:4px}.v3EffectCard .v3EffectMini{max-width:56px;min-height:19px;padding:4px}.v3EffectCard .v3EffectName{font-size:9px}
@media(max-width:520px){.v3EffectPicker,.page:not([data-page="home"]) .v3EffectPicker,.v3EffectCard .v3EffectPicker{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.v3EffectButton,.page:not([data-page="home"]) .v3EffectButton{min-height:58px;padding:5px 3px}.v3EffectMini{padding:4px;gap:2px}.v3EffectName{font-size:9px}}
`;document.head.appendChild(style);
    }
    const paintButton=(button,now)=>{
      const dots=qa('i',button);if(!dots.length)return;
      const effect=button.dataset.effect;
      dots.forEach((dot,i)=>{dot.style.background=palette[i];dot.style.color=palette[i];dot.style.opacity='1';dot.style.transform='scale(1)';dot.style.filter='none'});
      if(effect==='Jump'){
        const color=palette[Math.floor(now/360)%palette.length];
        dots.forEach(dot=>{dot.style.background=color;dot.style.color=color;dot.style.opacity='1';dot.style.transform='scale(1)';dot.style.filter='brightness(1.2)'});
      }else if(effect==='Breath'){
        const wave=.22+.78*((Math.sin(now/430)+1)/2);
        dots.forEach(dot=>{dot.style.background='#45d9ff';dot.style.color='#45d9ff';dot.style.opacity=String(wave);dot.style.transform=`scale(${.78+wave*.24})`;dot.style.filter=`brightness(${.65+wave*.7})`});
      }else if(effect==='Strobe'){
        const phase=Math.floor(now/240),on=phase%2===0,color=palette[Math.floor(phase/2)%palette.length];
        dots.forEach(dot=>{dot.style.background=color;dot.style.color=color;dot.style.opacity=on?'1':'.04';dot.style.transform=on?'scale(1.08)':'scale(.82)';dot.style.filter=on?'brightness(1.45)':'brightness(.4)'});
      }else{
        dots.forEach(dot=>{dot.style.background='#45d9ff';dot.style.color='#45d9ff';dot.style.opacity='1';dot.style.transform='scale(1)';dot.style.filter='brightness(1.15)'});
      }
    };
    const animate=now=>{qa('.v3EffectButton').forEach(button=>paintButton(button,now));requestAnimationFrame(animate)};
    const sync=select=>{
      const picker=select.nextElementSibling?.classList.contains('v3EffectPicker')?select.nextElementSibling:null;if(!picker)return;
      qa('.v3EffectButton',picker).forEach(button=>{const active=button.dataset.effect===select.value;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active)});
    };
    const enhance=select=>{
      if(!(select instanceof HTMLSelectElement)||select.dataset.v3EffectPreview==='1')return;
      const options=[...select.options].map(o=>o.value);if(!values.every(v=>options.includes(v)))return;
      select.dataset.v3EffectPreview='1';select.classList.add('v3EffectNative');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
      const picker=el('div','v3EffectPicker');picker.setAttribute('role','group');picker.setAttribute('aria-label',select.getAttribute('aria-label')||'Effect type');
      values.forEach(value=>{const button=el('button','v3EffectButton',`<span class="v3EffectMini" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="v3EffectName">${labels[value]}</span>`);button.type='button';button.dataset.effect=value;button.title=hints[value];button.setAttribute('aria-label',`${value==='Solid'?'Solid / Static':value}: ${hints[value]}`);button.addEventListener('click',()=>{if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))}sync(select)});picker.appendChild(button)});
      select.insertAdjacentElement('afterend',picker);select.addEventListener('change',()=>sync(select));sync(select);
    };
    const scan=root=>{if(root instanceof HTMLSelectElement)enhance(root);qa('select',root instanceof Element?root:document).forEach(enhance)};
    scan(document);
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node instanceof Element)scan(node)}))).observe(document.body,{childList:true,subtree:true});
    requestAnimationFrame(animate);
  }

  /* ANDERSON_BACKUP_RESTORE_UI_V3_1_13 */
  const backupCategories=[['schedule','Scheduling & timezone',1],['controllers','Light controllers',2],['custom','Custom shows & schedules',4],['favorites','Favorite colors',8],['events','Events & favorites',16]];
  function backupMaskFromUi(){return backupCategories.reduce((m,[id,,bit])=>m+(byId('backup-'+id)?.checked?bit:0),0)}
  function backupDate(epoch){if(!epoch)return 'Not yet';try{return new Date(epoch*1000).toLocaleString()}catch(_){return 'Unknown'}}
  async function refreshBackupStatus(){const line=byId('backupStatus');if(!line)return;try{const d=await api('/api/backup/status',{cache:'no-store'});backupCategories.forEach(([id,,bit])=>{const box=byId('backup-'+id);if(box)box.checked=!!(d.mask&bit)});byId('backupLast').textContent=d.hasBackup?backupDate(d.lastBackup):'No backup saved yet';byId('backupNext').textContent=d.lastAutomatic?backupDate(d.nextAutomatic):'Will run after time sync';byId('backupRestore').disabled=!d.hasBackup;line.textContent=d.lastOk||!d.hasBackup?'Weekly automatic backup is enabled for the selected settings.':'The last backup attempt did not complete.'}catch(e){line.textContent='Backup status is available to Jason only.'}}
  function buildBackupPane(root){if(!root||byId('backupSettingsPanel'))return;const panel=el('div','panel');panel.id='backupSettingsPanel';panel.innerHTML=`<strong>Custom Settings Backup</strong><div class="sub">Choose what Anderson Home protects. The controller automatically saves these settings once a week. Wi-Fi passwords and profile PINs are intentionally excluded.</div><div class="v3BackupChoices">${backupCategories.map(([id,label])=>`<label class="v3BackupChoice"><input id="backup-${id}" type="checkbox"><span>${label}</span></label>`).join('')}</div><div class="v3BackupMeta"><div><span>Last backup</span><strong id="backupLast">Loading…</strong></div><div><span>Next automatic</span><strong id="backupNext">Loading…</strong></div></div><div class="row wraprow v3BackupActions"><button id="backupSaveSelection" class="btn" type="button">Save Selection</button><button id="backupNow" class="btn primary" type="button">Back Up Now</button><button id="backupRestore" class="btn" type="button">Restore Last Backup</button></div><div id="backupStatus" class="sub">Loading backup status…</div>`;root.appendChild(panel);byId('backupSaveSelection').addEventListener('click',async()=>{try{await post('/api/backup/settings',{mask:backupMaskFromUi()});status('Backup selection saved.');await refreshBackupStatus()}catch(e){status('Could not save backup selection: '+e.message)}});byId('backupNow').addEventListener('click',async()=>{try{byId('backupNow').disabled=true;await post('/api/backup/manual',{mask:backupMaskFromUi()});status('Custom settings backup saved.');await refreshBackupStatus()}catch(e){status('Manual backup failed: '+e.message)}finally{byId('backupNow').disabled=false}});byId('backupRestore').addEventListener('click',async()=>{if(!confirm('Restore the last saved Anderson Home settings backup? The controller will reboot after restore.'))return;try{byId('backupRestore').disabled=true;await post('/api/backup/restore',{});status('Backup restored. Anderson Home is rebooting…');setTimeout(()=>location.reload(),5000)}catch(e){status('Restore failed: '+e.message);byId('backupRestore').disabled=false}});refreshBackupStatus();}
  window.addEventListener('anderson-profile-selected',event=>{if(event.detail?.id==='jason')setTimeout(refreshBackupStatus,0)});
  window.addEventListener('anderson-profile-cleared',()=>{const last=byId('backupLast'),next=byId('backupNext'),line=byId('backupStatus');if(last)last.textContent='Sign in as Jason to load';if(next)next.textContent='Sign in as Jason to load';if(line)line.textContent='Backup status is available to Jason only.'});
  function settingsSubTabs() {
    const page=q('.page[data-page="settings"]');
    if(!page || byId('v3SettingsTabs'))return;
    const title=q(':scope > .v3PageTitle',page);
    const original=[...page.children].filter(node=>node!==title);
    const defs=[['general','General'],['wifi','Wi-Fi'],['lighting','Lighting'],['preview','Live Preview'],['schedules','Schedules'],['controllers','Controllers'],['backup','Backup & Restore'],['security','Users & Security'],['firmware','Firmware']];
    const tabs=el('div','v3SettingsTabs');tabs.id='v3SettingsTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Settings sections');
    const panes=new Map(),buttons=new Map();
    defs.forEach(([id,label])=>{
      const button=el('button','v3SettingsTab',label);button.type='button';button.dataset.settingsTab=id;button.setAttribute('role','tab');button.setAttribute('aria-controls','v3SettingsPane-'+id);tabs.appendChild(button);buttons.set(id,button);
      const pane=el('div','v3SettingsPane');pane.id='v3SettingsPane-'+id;pane.dataset.settingsPane=id;pane.setAttribute('role','tabpanel');panes.set(id,pane);
    });
    if(title)title.insertAdjacentElement('afterend',tabs);else page.prepend(tabs);
    defs.forEach(([id])=>page.appendChild(panes.get(id)));
    buildBackupPane(panes.get('backup'));
    const category=node=>{
      if(node.classList.contains('v3SettingsLink'))return 'wifi';
      if(node.id==='systemMonitorPanel')return 'general';
      if(node.id==='liveColorTunerPanel')return 'preview';
      const heading=q(':scope > strong',node)?.textContent.trim()||'';
      if(heading==='Overlap Behavior')return 'lighting';
      if(heading==='Scheduling Rules'||heading==='Priority')return 'schedules';
      if(heading==='Bluetooth Light Controllers')return 'controllers';
      if(heading==='Profile PINs')return 'security';
      if(heading==='Firmware Update'||heading==='Firmware Revision')return 'firmware';
      return 'general';
    };
    original.forEach(node=>panes.get(category(node)).appendChild(node));
    const activate=id=>{
      defs.forEach(([key])=>{
        const active=key===id,button=buttons.get(key),pane=panes.get(key);
        button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
        pane.classList.toggle('active',active);pane.hidden=!active;
      });
      if(id==='backup'&&window.andersonProfile?.id==='jason')refreshBackupStatus();
    };
    buttons.forEach((button,id)=>button.addEventListener('click',()=>activate(id)));
    tabs.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const ids=defs.map(([id])=>id),current=ids.findIndex(id=>buttons.get(id)===document.activeElement);let next=current<0?0:current;
      if(event.key==='ArrowRight')next=(next+1)%ids.length;else if(event.key==='ArrowLeft')next=(next-1+ids.length)%ids.length;else if(event.key==='Home')next=0;else next=ids.length-1;
      activate(ids[next]);buttons.get(ids[next]).focus();
    });
    activate('general');
  }
  function syncRole() {
  q('.v3BottomNav').hidden=!window.andersonProfile;
  byId('switchProfile').setAttribute('aria-label',window.andersonProfile ? `Logout ${window.andersonProfile.name}`:'Logout'); syncPage();
}
function profiles() {
    const brand=q('.profileBrand');brand.classList.add('v3Scene'); brand.setAttribute('role','img');brand.setAttribute('aria-label','Anderson Home illuminated house and rainbow roof logo');
    brand.after(el('div','v3Welcome','<span class="v3Eyebrow">LIGHTS · CONTROL · CREATE</span><h2>Welcome home.</h2><p>Choose your profile</p>'));
    qa('.profileChoice').forEach(b=>b.insertAdjacentHTML('beforeend',icon('arrow')));
    const pin=byId('profilePinForm');new MutationObserver(()=>{ if(!pin.hidden)pin.scrollIntoView({behavior:'smooth',block:'nearest'}); }).observe(pin,{attributes:true,attributeFilter:['hidden']});
  }
  function init() { navigation();composeHome();effectPreviews();settingsSubTabs();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* ANDERSON_ATELIER_3_1_27 — presentation composition only.
   Move the original live nodes; never duplicate controls or replace their handlers. */
(() => {
  'use strict';
  const q = s => document.querySelector(s), byId = id => document.getElementById(id);
  function node(tag, cls, html='') { const n=document.createElement(tag); n.className=cls; n.innerHTML=html; return n; }
  function composeAtelier() {
    document.body.classList.add('ah27');
    const home=q('.page[data-page="home"]'), dashboard=q('.v3Dashboard');
    const live=q('.v3LiveCard'), fx=q('.v3EffectCard'), bright=q('.v3BrightnessBlock');
    const master=q('.v3MasterRow'), schedule=q('.v3ScheduleCard'), next=q('.v3Next');
    const hero=node('div','ah27Hero');
    const introduction=node('div','ah27Introduction','<div class="ah27Overline"><span class="ah27Diamond" aria-hidden="true"></span> THE ANDERSON LIGHT STUDIO <span class="ah27Edition">01 / HOME</span></div><h1>Make an<br><em>entrance.</em></h1>');
    const scene=q('.housePreview');
    const sceneLabel=node('div','ah27SceneLabel','<span class="ah27Overline">ON THE HOUSE</span><strong id="ah27SceneName"></strong>');
    live.prepend(sceneLabel);
    const originalKicker=live.querySelector('.v3CardKicker');
    originalKicker.querySelector('span').textContent='Live preview';
    live.append(originalKicker);
    hero.append(introduction,live,fx);
    const console=node('div','ah27Console','<div class="ah27ConsoleTitle"><span class="ah27Overline">MASTER CONTROL</span><strong>Your atmosphere.</strong><span>One home. Every light.</span></div>');
    const dial=node('div','ah27Dial');
    const readout=byId('homeBrightVal');
    const dialLabel=node('div','ah27DialLabel','<span>INTENSITY</span>');
    dialLabel.prepend(readout);
    dial.append(dialLabel);
    const originalLabel=bright.querySelector(':scope > .label');
    originalLabel.remove();
    const tempo=q('.v3HomeSpeedBlock');
    bright.prepend(dial);
    master.querySelector('.v3MasterTitle').remove();
    master.classList.add('ah27Power');
    console.append(bright,master,tempo);
    dashboard.replaceChildren(hero,console);
    const scheduleBand=node('div','ah27ScheduleBand');
    scheduleBand.append(schedule,next);
    const palette=node('div','ah27Palette','<div class="ah27PaletteTitle"><span class="ah27Overline">THE COLOR COLLECTION</span><strong>A shade for every mood.</strong><span>Tap a color to light your home.</span></div><div id="homeFavoriteColorGrid" class="ah27ColorCollection"></div>');
    dashboard.after(scheduleBand,palette);
    renderHomeFavoriteGrid();
    const sync=()=>{
      const pct=Math.max(0,Math.min(100,parseFloat(readout.textContent)||0));
      dial.style.setProperty('--intensity',pct);
      byId('ah27SceneName').textContent=running.name||byId('nowTheme').textContent||'Your lights';
    };
    new MutationObserver(sync).observe(readout,{childList:true,subtree:true,characterData:true});
    new MutationObserver(sync).observe(byId('nowTheme'),{childList:true,subtree:true,characterData:true});
    sync();
    byId('connectionBadge').style.display='';
    byId('activeProfile').style.display='';
    const header=q('.header');
    header.querySelector('.ahBrandSub').textContent='LIGHT STUDIO';
    const headerBrand=q('.profileBrand .ahBrandSub');
    if(headerBrand)headerBrand.textContent='A DIFFERENT KIND OF HOME';
    const welcome=q('.v3Welcome');
    welcome.innerHTML='<span class="ah27Overline">WELCOME TO YOUR LIGHT STUDIO</span><h2>Extraordinary<br>starts <em>at home.</em></h2><p>Choose your space. Set the mood.</p>';
    const installation=node('div','ah27Installation','<i></i><i></i><i></i><i></i><i></i><i></i><i></i><span>ANDERSON / AFTER DARK</span>');
    installation.setAttribute('aria-hidden','true');
    q('.profileBrand').after(installation);
    const brand=q('.profileBrand');brand.removeAttribute('role');brand.removeAttribute('aria-label');
    const chapterNames={lights:['02 / CREATE','The light lab.'],events:['03 / AUTOMATE','Perfectly timed.'],favorites:['04 / COLLECT','Your greatest hits.'],settings:['05 / REFINE','Behind the scenes.'],wifi:['06 / CONNECT','Stay connected.']};
    document.querySelectorAll('.v3PageTitle').forEach(title=>{
      const d=chapterNames[title.closest('.page').dataset.page];
      if(d){title.querySelector('span').textContent=d[0];title.querySelector('h2').textContent=d[1];}
    });
    q('.v3SettingsTabs').setAttribute('aria-orientation','horizontal');
    document.querySelectorAll('.v3SettingsTab').forEach((tab,i)=>{
      const label=tab.textContent;
      tab.replaceChildren(node('span','ah27SectionNumber',String(i+1).padStart(2,'0')),node('span','ah27SectionLabel'));
      tab.lastElementChild.textContent=label;
    });
    const navLabels={home:'Home',lights:'Create',events:'Schedules',favorites:'Favorites',settings:'Settings'};
    document.querySelectorAll('.v3BottomNav [data-tab]').forEach(tab=>{
      const label=navLabels[tab.dataset.tab];if(label)tab.querySelector('span').textContent=label;
    });
    document.querySelectorAll('.page[data-page="lights"] > .panel').forEach((panel,i)=>panel.classList.add('ah27Lab'+i));
    const refreshRole=()=>{
      home.setAttribute('aria-label','Anderson Home light studio');
      const profile=window.andersonProfile;
      if(profile)header.dataset.profileName=profile.name;
    };
    window.addEventListener('anderson-profile-selected',refreshRole);refreshRole();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',composeAtelier);else composeAtelier();
})();
