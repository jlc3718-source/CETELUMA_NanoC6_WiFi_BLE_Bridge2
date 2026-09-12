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
    const defs = {home:['home','Home'], lights:['effects','Effects'], events:['clock','Schedules'], wifi:['wifi','Wi-Fi'], settings:['settings','Settings']};
    qa('.tab', nav).forEach(tab => {
      const [symbol, label] = defs[tab.dataset.tab]; tab.innerHTML = icon(symbol) + `<span>${label}</span>`;
      tab.addEventListener('click', syncPage);
    });
    document.body.appendChild(nav);
    const actions = q('.headerActions'), meta = el('div','v3HomeMeta','<span class="v3HomeName">My Home</span>');
    meta.appendChild(byId('connectionBadge'));
    const profile = byId('activeProfile'); profile.className = 'v3ProfileName';
    const switcher = byId('switchProfile'); switcher.innerHTML = icon('user'); switcher.setAttribute('aria-label','Switch user'); switcher.title = 'Switch user';
    actions.replaceChildren(meta, profile, switcher);
    const wifi = routeButton('v3SettingsLink','wifi',`${icon('wifi')}<span><strong>Wi-Fi</strong><small>Network & connection</small></span>${icon('arrow')}`);
    q('.page[data-page="settings"]').prepend(wifi);
    byId('bleStatus').closest('.panel').id = 'v3Controllers';
    qa('.page:not([data-page="home"])').forEach(page => {
      const titles = {lights:['Make it yours','Effects & colors'],events:['Every occasion, illuminated','Your schedules'],settings:['Your home, your way','Settings'],wifi:['Keep your home connected','Wi-Fi']};
      const [sub,title] = titles[page.dataset.page]; page.prepend(el('div','v3PageTitle',`<span>${sub}</span><h2>${title}</h2>`));
    });
  }
  function composeHome() {
    ensureExtraControls();
    const home = q('.page[data-page="home"]'), panel = q(':scope > .panel',home);
    q('.andersonHero',home).classList.add('v3Scene');
    q('.andersonHero',home).setAttribute('aria-label','Anderson Home rainbow roof logo above the illuminated house');
    panel.classList.add('v3Dashboard');
    const master = q(':scope > .row',panel); master.classList.add('v3MasterRow');
    const title = master.firstElementChild; title.className = 'v3MasterTitle';
    title.innerHTML = '<span class="v3Eyebrow">HOME LIGHTS <i></i></span><h2>All Lights</h2><span class="sub">Your whole home</span>';
    master.lastElementChild.className = 'v3PowerButtons';
    ['On','Off'].forEach(v => { const b=byId('homePower'+v); b.innerHTML=icon('power')+`<span>${v.toUpperCase()}</span>`; b.setAttribute('aria-label','Turn all lights '+v.toLowerCase()); });
    const bright = el('div','v3BrightnessBlock'), slider=byId('homeBrightness'), label=slider.previousElementSibling;
    label.firstElementChild.insertAdjacentHTML('afterbegin',icon('sun')); slider.setAttribute('aria-label','Home brightness');
    bright.append(label,slider); panel.appendChild(bright);
    const effect=byId('homeEffect'), effectLabel=effect.previousElementSibling;
    if(effectLabel?.classList.contains('label')) effectLabel.remove(); effect.setAttribute('aria-label','Current effect');
    const features=el('div','v3FeatureGrid'), fx=el('div','v3EffectCard',`<div class="v3CardKicker">${icon('spark')}<span>Current Effect</span></div><div class="v3EffectArt" aria-hidden="true"></div>`);
    const help=byId('homeEffectHelp');help.textContent='Use your current colors.';fx.append(effect,help);
    const schedule=el('div','v3ScheduleCard');
    schedule.append(routeButton('v3CardKicker','events',`${icon('clock')}<span>Schedule</span>${icon('arrow')}`));
    const oldRunning = byId('nowTheme').closest('.panel');
    schedule.append(byId('nowTheme'),byId('scheduleWindow'),byId('resumeSchedule'));
    const live=el('div','v3LiveCard',`<div class="v3CardKicker">${icon('home')}<span>Live lights</span><i class="v3LiveDot" aria-hidden="true"></i></div>`);
    live.append(q('.housePreview',oldRunning),el('div','v3LiveCaption','<span id="v3LiveEffect">Current lights</span>'));
    features.append(fx,live);panel.append(features,schedule);
    oldRunning.remove();
    const favorites=el('div','v3Favorites'), grid=byId('homeFavoriteColorGrid'); grid.previousElementSibling.remove();
    const heading=el('div','v3FavoriteHeading',`<span>${icon('heart')}<strong id="v3ColorHeading">Favorite Colors</strong></span>`);
    const edit=el('button','v3TextButton',`Edit ${icon('arrow')}`); edit.type='button';edit.setAttribute('aria-label','Edit favorite colors');
    const openColors=()=> { const chip=el('button',''); chip.dataset.color='#0D00FF'; openRgbWheel(chip); };
    edit.addEventListener('click',openColors); heading.append(edit);
    const paletteRow=el('div','v3PaletteRow'), plus=el('button','v3AddColor',icon('plus')); plus.type='button';plus.setAttribute('aria-label','Add a favorite color');plus.addEventListener('click',openColors);
    paletteRow.append(grid,plus);favorites.append(heading,paletteRow);panel.appendChild(favorites);
    const speed=byId('homeSpeedBlock'), speedLabel=q('.label',speed);
    const detail=el('details','v3Speed'), summary=el('summary','',`<span>Animation speed</span>`);
    summary.appendChild(byId('homeSpeedVal'));speedLabel.remove();detail.append(summary,speed);panel.appendChild(detail);
    byId('homeSpeed').setAttribute('aria-label','Animation speed');
    panel.appendChild(el('div','v3HomeTiles'));
    const next=byId('nextEvent').closest('.card');next.classList.add('v3Next');next.prepend(el('span','v3NextIcon',icon('clock')));
    const favoritesPanel=byId('favoriteGrid').closest('.panel'); favoritesPanel.classList.add('v3SavedScenes');q('strong',favoritesPanel).textContent='Favorite scenes';
    const custom=byId('homeCustomLightList').closest('.panel');custom.classList.add('v3SavedScenes');q('strong',custom).textContent='Your custom shows';q('.sub',custom).textContent='Saved lighting, ready to play.';
    function colorsChanged() {
      const swatches=qa('.savedSwatch',grid);byId('v3ColorHeading').textContent=swatches.length?'Favorite Colors':'Quick Colors';
      if(!swatches.length && !q('.v3QuickColor',grid)) {
        grid.replaceChildren();
        ['#FF0000','#FF0D00','#FF0024','#FFFF44','#28FF00','#00BD4C','#0D00FF','#5B00E6','#FFFFFA'].forEach(c=>{
          const b=el('button','v3QuickColor');b.type='button';b.style.background=displayColor(c);b.style.color=displayColor(c);b.setAttribute('aria-label','Use '+(LED_COLOR_NAME[c]||c));
          b.addEventListener('click',()=>manual({name:LED_COLOR_NAME[c]||'Color',colors:[c],effect:'Solid',brightness,speed:1}));grid.appendChild(b);
        });
      }
    }
    new MutationObserver(colorsChanged).observe(grid,{childList:true}); colorsChanged();
    const syncLive=()=>{const on=byId('homePowerOn').classList.contains('primary'),effect=running.effect,label=on?`${effect==='Solid'?'Solid / Static':effect} · ${byId('homeBrightVal').textContent}`:'Lights off';byId('v3LiveEffect').textContent=label;live.dataset.power=on?'on':'off';q('svg',q('.housePreview',live)).setAttribute('aria-label',`Live house preview: ${label}`);};
    const syncPower=()=>{ const on=byId('homePowerOn').classList.contains('primary');panel.dataset.power=on?'on':'off';byId('homePowerOn').setAttribute('aria-pressed',String(on));byId('homePowerOff').setAttribute('aria-pressed',String(!on));syncLive(); };
    new MutationObserver(syncPower).observe(byId('homePowerOn'),{attributes:true,attributeFilter:['class']});syncPower();
    const syncEffect=()=>{byId('homeEffectHelp').textContent=byId('homeEffect').value==='Solid'?'Holds the first color steady.':'Use your current colors.';syncLive();};
    byId('homeEffect').addEventListener('change',syncEffect);new MutationObserver(syncEffect).observe(byId('nowTheme'),{childList:true});
    new MutationObserver(syncLive).observe(byId('homeBrightVal'),{childList:true});
  }
  function effectPreviews() {
    const values=['Jump','Breath','Strobe','Gradient','Solid'];
    const labels={Jump:'Jump',Breath:'Breath',Strobe:'Strobe',Gradient:'Gradient',Solid:'Solid'};
    const hints={Jump:'Snaps between colors',Breath:'Gently fades in and out',Strobe:'Flashes on and off',Gradient:'Flows through the palette',Solid:'Holds one color steady'};
    if(!byId('v3EffectPreviewStyle')) {
      const style=document.createElement('style');style.id='v3EffectPreviewStyle';style.textContent=`
.v3EffectNative{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;clip-path:inset(50%)!important}
.v3EffectPicker{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin:9px 0 4px;min-width:0}
.v3EffectButton{min-width:0;min-height:66px;padding:7px 5px 6px;border:1px solid #79bde644;border-radius:12px;background:linear-gradient(155deg,#122943d9,#071426f2);color:#dceeff;box-shadow:inset 0 1px 0 #eaf8ff14,0 4px 12px #0003;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;transition:border-color .18s,background .18s,box-shadow .18s,transform .12s}
.v3EffectButton:active{transform:scale(.97)}.v3EffectButton[aria-pressed="true"]{border-color:#79e9ff;background:radial-gradient(ellipse at 50% 0,#35cfff38,transparent 72%),linear-gradient(145deg,#164c78e8,#08213bea);box-shadow:inset 0 1px 0 #e8fbff38,0 0 0 1px #22cfff33,0 0 16px #08a9ff28}
.v3EffectMini{width:100%;max-width:66px;min-height:20px;display:grid;grid-template-columns:repeat(5,1fr);align-items:center;gap:3px;padding:5px 6px;border-radius:99px;background:#020914c9;border:1px solid #8fdfff26;overflow:hidden}
.v3EffectMini i{display:block;width:100%;aspect-ratio:1;border-radius:50%;background:#42d8ff;box-shadow:0 0 6px currentColor;color:#42d8ff}
.v3EffectName{font-size:10px;font-weight:720;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.v3EffectButton[data-effect="Jump"] .v3EffectMini i{animation:v3FxJump 2000ms steps(1,end) infinite}
.v3EffectButton[data-effect="Breath"] .v3EffectMini i{animation:v3FxBreath 2000ms ease-in-out infinite;background:#45d9ff;color:#45d9ff}
.v3EffectButton[data-effect="Strobe"] .v3EffectMini i{animation:v3FxStrobe 1000ms steps(1,end) infinite;background:#f3fbff;color:#f3fbff}
.v3EffectButton[data-effect="Gradient"] .v3EffectMini i{animation:v3FxGradient 2500ms linear infinite}.v3EffectButton[data-effect="Gradient"] .v3EffectMini i:nth-child(1){animation-delay:0ms}.v3EffectButton[data-effect="Gradient"] .v3EffectMini i:nth-child(2){animation-delay:-500ms}.v3EffectButton[data-effect="Gradient"] .v3EffectMini i:nth-child(3){animation-delay:-1000ms}.v3EffectButton[data-effect="Gradient"] .v3EffectMini i:nth-child(4){animation-delay:-1500ms}.v3EffectButton[data-effect="Gradient"] .v3EffectMini i:nth-child(5){animation-delay:-2000ms}
.v3EffectButton[data-effect="Solid"] .v3EffectMini i{background:#45d9ff;color:#45d9ff}
@keyframes v3FxJump{0%,24.9%{background:#42d8ff;color:#42d8ff}25%,49.9%{background:#ff4ebd;color:#ff4ebd}50%,74.9%{background:#ffd24a;color:#ffd24a}75%,100%{background:#7cff74;color:#7cff74}}
@keyframes v3FxBreath{0%,100%{opacity:.22;filter:brightness(.65)}50%{opacity:1;filter:brightness(1.35)}}
@keyframes v3FxStrobe{0%,49.9%{opacity:1}50%,100%{opacity:.08}}
@keyframes v3FxGradient{0%{background:#42d8ff;color:#42d8ff}20%{background:#7cff74;color:#7cff74}40%{background:#ffd24a;color:#ffd24a}60%{background:#ff4ebd;color:#ff4ebd}80%{background:#7c72ff;color:#7c72ff}100%{background:#42d8ff;color:#42d8ff}}
.v3EffectCard .v3EffectPicker{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:7px}.v3EffectCard .v3EffectButton{min-height:54px;padding:5px 4px;gap:4px}.v3EffectCard .v3EffectButton:last-child{grid-column:1/-1}.v3EffectCard .v3EffectMini{max-width:58px;min-height:18px;padding:4px 5px}.v3EffectCard .v3EffectName{font-size:9px}
@media(max-width:520px){.page:not([data-page="home"]) .v3EffectPicker{grid-template-columns:repeat(3,minmax(0,1fr))}.page:not([data-page="home"]) .v3EffectButton{min-height:62px}}
@media(prefers-reduced-motion:reduce){.v3EffectMini i{animation:none!important}.v3EffectButton{transition:none}}
`;document.head.appendChild(style);
    }
    const sync=select=>{
      const picker=select.nextElementSibling?.classList.contains('v3EffectPicker')?select.nextElementSibling:null;if(!picker)return;
      qa('.v3EffectButton',picker).forEach(b=>{const active=b.dataset.effect===select.value;b.setAttribute('aria-pressed',String(active));b.classList.toggle('active',active)});
    };
    const enhance=select=>{
      if(!(select instanceof HTMLSelectElement)||select.dataset.v3EffectPreview==='1')return;
      const options=[...select.options].map(o=>o.value);if(!values.every(v=>options.includes(v)))return;
      select.dataset.v3EffectPreview='1';select.classList.add('v3EffectNative');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
      const picker=el('div','v3EffectPicker');picker.setAttribute('role','group');picker.setAttribute('aria-label',select.getAttribute('aria-label')||'Effect type');
      values.forEach(value=>{const b=el('button','v3EffectButton',`<span class="v3EffectMini" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="v3EffectName">${labels[value]}</span>`);b.type='button';b.dataset.effect=value;b.title=hints[value];b.setAttribute('aria-label',`${value==='Solid'?'Solid / Static':value}: ${hints[value]}`);b.addEventListener('click',()=>{if(select.value===value){sync(select);return}select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));sync(select)});picker.appendChild(b)});
      select.insertAdjacentElement('afterend',picker);select.addEventListener('change',()=>sync(select));sync(select);
    };
    const scan=root=>{if(root instanceof HTMLSelectElement)enhance(root);qa('select',root instanceof Element?root:document).forEach(enhance)};
    scan(document);
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node instanceof Element)scan(node)}))).observe(document.body,{childList:true,subtree:true});
    setInterval(()=>qa('select[data-v3-effect-preview="1"]').forEach(sync),350);
  }
  function syncRole() {
    q('.v3BottomNav').hidden=!window.andersonProfile;
    const admin=window.andersonProfile?.role==='admin' && window.andersonProfile?.id==='jason';
    const tiles=q('.v3HomeTiles'); tiles.replaceChildren();tiles.hidden=!admin;
    if(admin) [ ['home','Zones','By controller','settings','v3Controllers'],['effects','Effects','Make it yours','lights'],['clock','Schedules','Your calendar','events'],['settings','Settings','Your home','settings'] ].forEach(([symbol,label,sub,target,anchor])=>{
      if(canOpen(target))tiles.append(routeButton('v3HomeTile',target,`${icon(symbol)}<strong>${label}</strong><small>${sub}</small>${icon('arrow')}`,anchor));
    });
    byId('switchProfile').setAttribute('aria-label',window.andersonProfile ? `Switch user, currently ${window.andersonProfile.name}`:'Switch user'); syncPage();
  }
  function profiles() {
    const brand=q('.profileBrand');brand.classList.add('v3Scene'); brand.setAttribute('role','img');brand.setAttribute('aria-label','Anderson Home illuminated house and rainbow roof logo');
    brand.after(el('div','v3Welcome','<span class="v3Eyebrow">LIGHTS · CONTROL · CREATE</span><h2>Welcome home.</h2><p>Choose your profile</p>'));
    qa('.profileChoice').forEach(b=>b.insertAdjacentHTML('beforeend',icon('arrow')));
    const pin=byId('profilePinForm');new MutationObserver(()=>{ if(!pin.hidden)pin.scrollIntoView({behavior:'smooth',block:'nearest'}); }).observe(pin,{attributes:true,attributeFilter:['hidden']});
  }
  function init() { navigation();composeHome();effectPreviews();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
