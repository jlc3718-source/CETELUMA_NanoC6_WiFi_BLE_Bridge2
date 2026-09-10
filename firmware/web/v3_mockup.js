/* ANDERSON_V3_REFERENCE_LAYOUT_RUNTIME
   Re-composes the existing functional controls without changing their IDs or API bindings. */
(() => {
  'use strict';

  const q = (s, root=document) => root.querySelector(s);
  const qa = (s, root=document) => [...root.querySelectorAll(s)];

  function clickTab(name) {
    const tab = q(`.tab[data-tab="${name}"]`);
    if (!tab || tab.hidden) return;
    tab.click();
    setTimeout(() => window.scrollTo({top:0, behavior:'smooth'}), 0);
  }

  function makeNavButton(icon, label, target, cls='') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.target = target;
    b.innerHTML = `<span class="v3NavIcon" aria-hidden="true">${icon}</span><span>${label}</span>`;
    b.addEventListener('click', () => clickTab(target));
    return b;
  }

  function buildHeader() {
    const actions = q('.headerActions');
    if (!actions || q('.v3MenuButton')) return;

    const activeProfile = document.getElementById('activeProfile');
    const switchProfile = document.getElementById('switchProfile');
    const badge = document.getElementById('connectionBadge');

    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'v3MenuButton';
    menu.setAttribute('aria-label', 'Open navigation');
    menu.setAttribute('aria-expanded', 'false');
    menu.innerHTML = '&#9776;';

    const right = document.createElement('div');
    right.className = 'v3HeaderRight';

    const meta = document.createElement('div');
    meta.className = 'v3HomeMeta';
    const name = document.createElement('div');
    name.className = 'v3HomeName';
    name.textContent = 'My Home';
    meta.appendChild(name);
    if (badge) meta.appendChild(badge);

    if (activeProfile) {
      activeProfile.classList.add('v3ProfileNameHidden');
      activeProfile.setAttribute('aria-hidden', 'true');
    }

    right.appendChild(meta);
    if (switchProfile) {
      switchProfile.title = 'Switch Anderson Home user';
      switchProfile.setAttribute('aria-label', 'Switch Anderson Home user');
      right.appendChild(switchProfile);
    }

    actions.textContent = '';
    actions.append(menu, right);

    const drawer = document.createElement('div');
    drawer.className = 'v3Drawer';
    drawer.setAttribute('aria-label', 'Anderson Home navigation');
    [
      ['⌂','Home','home'],
      ['✦','Lights & Effects','lights'],
      ['◷','Events & Schedules','events'],
      ['⌁','Wi-Fi','wifi'],
      ['⚙','Settings','settings']
    ].forEach(([icon,label,target]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.target = target;
      b.innerHTML = `<span aria-hidden="true" style="display:inline-block;width:30px">${icon}</span>${label}`;
      b.addEventListener('click', () => {
        drawer.classList.remove('open');
        menu.setAttribute('aria-expanded','false');
        clickTab(target);
      });
      drawer.appendChild(b);
    });
    document.body.appendChild(drawer);

    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = drawer.classList.toggle('open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!drawer.contains(e.target) && e.target !== menu) {
        drawer.classList.remove('open');
        menu.setAttribute('aria-expanded','false');
      }
    });
  }

  function buildBottomNav() {
    if (q('.v3BottomNav')) return;
    const nav = document.createElement('nav');
    nav.className = 'v3BottomNav';
    nav.setAttribute('aria-label','Primary navigation');
    nav.append(
      makeNavButton('⌂','Home','home'),
      makeNavButton('✦','Effects','lights'),
      makeNavButton('◷','Schedules','events'),
      makeNavButton('⚙','Settings','settings')
    );
    document.body.appendChild(nav);

    qa('.tab').forEach(tab => tab.addEventListener('click', () => {
      qa('.v3BottomNav button').forEach(b => b.classList.toggle('active', b.dataset.target === tab.dataset.tab));
    }));
    const home = q('.v3BottomNav button[data-target="home"]');
    if (home) home.classList.add('active');
  }

  function syncRoleNavigation() {
    qa('.v3BottomNav button,.v3Drawer button').forEach(b => {
      const original = q(`.tab[data-tab="${b.dataset.target}"]`);
      b.hidden = !original || original.hidden;
    });
    qa('.v3HomeTile').forEach(b => {
      const original = q(`.tab[data-tab="${b.dataset.target}"]`);
      b.hidden = !original || original.hidden;
    });
  }

  function wrapBrightness(panel) {
    const input = document.getElementById('homeBrightness');
    if (!panel || !input || input.closest('.v3BrightnessBlock')) return;
    const label = input.previousElementSibling;
    const block = document.createElement('div');
    block.className = 'v3BrightnessBlock';
    if (label && label.classList.contains('label')) block.appendChild(label);
    block.appendChild(input);
    const master = q('.v3MasterRow', panel);
    if (master) master.insertAdjacentElement('afterend', block);
    else panel.prepend(block);
  }

  function buildFeatureGrid(panel) {
    if (!panel || q('.v3FeatureGrid', panel)) return;

    const effect = document.getElementById('homeEffect');
    const help = document.getElementById('homeEffectHelp');
    if (!effect || !help) return;
    const label = effect.previousElementSibling;

    const effectCard = document.createElement('div');
    effectCard.className = 'v3EffectCard';
    const effectKicker = document.createElement('div');
    effectKicker.className = 'v3CardKicker';
    effectKicker.textContent = 'Current Effect';
    effectCard.appendChild(effectKicker);
    if (label && label.classList.contains('label')) label.remove();
    effectCard.append(effect, help);

    const scheduleCard = document.createElement('div');
    scheduleCard.className = 'v3ScheduleCard';
    const scheduleKicker = document.createElement('div');
    scheduleKicker.className = 'v3CardKicker';
    scheduleKicker.textContent = 'Schedule';
    scheduleCard.appendChild(scheduleKicker);

    const nowTheme = document.getElementById('nowTheme');
    const scheduleWindow = document.getElementById('scheduleWindow');
    const resume = document.getElementById('resumeSchedule');
    if (nowTheme) scheduleCard.appendChild(nowTheme);
    if (scheduleWindow) scheduleCard.appendChild(scheduleWindow);
    if (resume) {
      resume.textContent = 'Resume Schedule';
      scheduleCard.appendChild(resume);
    }

    const grid = document.createElement('div');
    grid.className = 'v3FeatureGrid';
    grid.append(effectCard, scheduleCard);

    const bright = q('.v3BrightnessBlock', panel);
    if (bright) bright.insertAdjacentElement('afterend', grid);
    else panel.appendChild(grid);
  }

  function buildHomeTiles(panel) {
    if (!panel || q('.v3HomeTiles', panel)) return;
    const tiles = document.createElement('div');
    tiles.className = 'v3HomeTiles';
    const defs = [
      ['⌂','Zones','Control by area','lights'],
      ['✦','Effects','Pre-made & custom','lights'],
      ['◷','Schedules','Automate your lights','events'],
      ['⚙','Settings','System & preferences','settings']
    ];
    defs.forEach(([icon,name,sub,target]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'v3HomeTile';
      b.dataset.target = target;
      b.innerHTML = `<span class="v3TileIcon" aria-hidden="true">${icon}</span><span class="v3TileName">${name}</span><span class="v3TileSub">${sub}</span>`;
      b.addEventListener('click', () => clickTab(target));
      tiles.appendChild(b);
    });
    panel.appendChild(tiles);
  }

  function enhanceHome() {
    const home = q('.page[data-page="home"]');
    if (!home) return;
    const hero = q('.andersonHero', home);
    if (hero) {
      hero.setAttribute('aria-label','Anderson Home illuminated house and landscape');
      hero.removeAttribute('role');
    }

    const panel = q(':scope > .panel', home);
    if (!panel) return;

    const row = q(':scope > .row.between', panel);
    if (row) {
      row.classList.add('v3MasterRow');
      const title = row.firstElementChild;
      if (title) {
        title.classList.add('v3MasterTitle');
        const strong = q('strong', title);
        const sub = q('.sub', title);
        if (strong) strong.textContent = 'All Lights';
        if (sub) sub.textContent = 'Control your entire home';
      }
      const buttons = row.lastElementChild;
      if (buttons) buttons.classList.add('v3PowerButtons');
      const on = document.getElementById('homePowerOn');
      const off = document.getElementById('homePowerOff');
      if (on) on.textContent = 'ON';
      if (off) off.textContent = 'OFF';
    }

    wrapBrightness(panel);
    buildFeatureGrid(panel);
    buildHomeTiles(panel);

    const speed = document.getElementById('homeSpeedBlock');
    const feature = q('.v3FeatureGrid', panel);
    if (speed && feature && speed.parentElement !== panel) {
      feature.insertAdjacentElement('afterend', speed);
    } else if (speed && feature && speed.previousElementSibling !== feature) {
      feature.insertAdjacentElement('afterend', speed);
    }
    if (speed) {
      const firstLabel = q('.label', speed);
      if (firstLabel && !firstLabel.dataset.v3Done) {
        firstLabel.dataset.v3Done = '1';
        firstLabel.childNodes[0].textContent = 'Animation Speed ';
      }
    }

    const custom = q('#homeCustomLightList')?.closest('.panel');
    if (custom) {
      const strong = q(':scope > strong', custom);
      const sub = q(':scope > .sub', custom);
      if (strong) strong.textContent = 'My Custom Lighting';
      if (sub) sub.textContent = 'Saved scenes and custom lighting shows.';
    }
    syncRoleNavigation();
  }

  function markPages() {
    const titles = {
      lights:'LIGHTS • EFFECTS • CREATE',
      events:'EVENTS • SCHEDULES',
      wifi:'NETWORK • CONTROLLER',
      settings:'SYSTEM • PREFERENCES'
    };
    Object.entries(titles).forEach(([page,title]) => {
      const el = q(`.page[data-page="${page}"]`);
      if (el) el.dataset.v3Title = title;
    });
  }

  function init() {
    buildHeader();
    buildBottomNav();
    markPages();
    enhanceHome();
    setTimeout(enhanceHome, 40);
    setTimeout(enhanceHome, 220);
    syncRoleNavigation();

    window.addEventListener('anderson-profile-selected', () => {
      setTimeout(() => {
        syncRoleNavigation();
        enhanceHome();
      }, 0);
    });
    window.addEventListener('anderson-profile-cleared', syncRoleNavigation);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
