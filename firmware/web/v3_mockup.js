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
    q('.andersonBrand').classList.add('v3SubBrand');
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
    features.append(fx,schedule); panel.appendChild(features);
    const favorites=el('div','v3Favorites'), grid=byId('homeFavoriteColorGrid'); grid.previousElementSibling.remove();
    const heading=el('div','v3FavoriteHeading',`<span>${icon('heart')}<strong id="v3ColorHeading">Favorite Colors</strong></span>`);
    const edit=el('button','v3TextButton',`Edit ${icon('arrow')}`); edit.type='button';edit.setAttribute('aria-label','Edit favorite colors');
    const openColors=()=> { const chip=el('button',''); chip.dataset.color='#004BC6'; openRgbWheel(chip); };
    edit.addEventListener('click',openColors); heading.append(edit);
    const paletteRow=el('div','v3PaletteRow'), plus=el('button','v3AddColor',icon('plus')); plus.type='button';plus.setAttribute('aria-label','Add a favorite color');plus.addEventListener('click',openColors);
    paletteRow.append(grid,plus);favorites.append(heading,paletteRow);panel.appendChild(favorites);
    const speed=byId('homeSpeedBlock'), speedLabel=q('.label',speed);
    const detail=el('details','v3Speed'), summary=el('summary','',`<span>Animation speed</span>`);
    summary.appendChild(byId('homeSpeedVal'));speedLabel.remove();detail.append(summary,speed);panel.appendChild(detail);
    byId('homeSpeed').setAttribute('aria-label','Animation speed');
    panel.appendChild(el('div','v3HomeTiles'));
    const live=el('details','v3Live panel'), liveSummary=el('summary','',`${icon('home')}<span>Live light preview</span>`);
    live.append(liveSummary,q('.housePreview',oldRunning)); oldRunning.replaceWith(live);
    const next=byId('nextEvent').closest('.card');next.classList.add('v3Next');next.prepend(el('span','v3NextIcon',icon('clock')));
    const favoritesPanel=byId('favoriteGrid').closest('.panel'); favoritesPanel.classList.add('v3SavedScenes');q('strong',favoritesPanel).textContent='Favorite scenes';
    const custom=byId('homeCustomLightList').closest('.panel');custom.classList.add('v3SavedScenes');q('strong',custom).textContent='Your custom shows';q('.sub',custom).textContent='Saved lighting, ready to play.';
    function colorsChanged() {
      const swatches=qa('.savedSwatch',grid);byId('v3ColorHeading').textContent=swatches.length?'Favorite Colors':'Quick Colors';
      if(!swatches.length && !q('.v3QuickColor',grid)) {
        grid.replaceChildren();
        ['#FF0000','#FF3000','#FFFF00','#00FF00','#00FFFF','#0000FF','#23018C','#FF00FF'].forEach(c=>{
          const b=el('button','v3QuickColor');b.type='button';b.style.background=displayColor(c);b.style.color=displayColor(c);b.setAttribute('aria-label','Use '+(LED_COLOR_NAME[c]||c));
          b.addEventListener('click',()=>manual({name:LED_COLOR_NAME[c]||'Color',colors:[c],effect:'Solid',brightness,speed:1}));grid.appendChild(b);
        });
      }
    }
    new MutationObserver(colorsChanged).observe(grid,{childList:true}); colorsChanged();
    const syncPower=()=>{ const on=byId('homePowerOn').classList.contains('primary');panel.dataset.power=on?'on':'off';byId('homePowerOn').setAttribute('aria-pressed',String(on));byId('homePowerOff').setAttribute('aria-pressed',String(!on)); };
    new MutationObserver(syncPower).observe(byId('homePowerOn'),{attributes:true,attributeFilter:['class']});syncPower();
    const syncEffect=()=>{byId('homeEffectHelp').textContent=byId('homeEffect').value==='Solid'?'Holds the first color steady.':'Use your current colors.';};
    byId('homeEffect').addEventListener('change',syncEffect);new MutationObserver(syncEffect).observe(byId('nowTheme'),{childList:true});
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
  function init() { navigation();composeHome();profiles();syncRole();window.addEventListener('anderson-profile-selected',()=>{syncRole();window.scrollTo(0,0);});window.addEventListener('anderson-profile-cleared',syncRole); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
