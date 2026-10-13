// ==UserScript==
// @name         Betabound Physical Test Assistant
// @namespace    https://github.com/jlc3718-source
// @version      0.1.2
// @updateURL    https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/main/betabound/betabound-physical.user.js
// @downloadURL  https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/main/betabound/betabound-physical.user.js
// @description  Fill verified details and queue eligible physical-product tests in your own signed-in browser.
// @match        https://my.betabound.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  const PFX = 'betabound-physical-v1-';
  const BASE = [
    ['Gas grill', 'https://my.betabound.com/key/GasGrill26'],
    ['Home dehumidifier', 'https://my.betabound.com/key/HomeDehumidifier'],
    ['Premium air purifier', 'https://my.betabound.com/key/PremiumAirPurifierMed']
  ];
  const GOODS = /\b(grill|dehumidifier|air purifier|humidifier|vacuum|mop|refrigerator|dishwasher|washer|dryer|robot|camera|doorbell|smart lock|power station|solar|inverter|charger|speaker|headphone|tv|monitor|router|appliance|lighting|lawn mower|tool|generator|hardware|thermostat|fan|heater|printer|oven|cooktop)\b/i;
  const CONFIRM = /(application (?:has been )?(?:submitted|received)|thank you for applying|thanks for applying|successfully applied|we received your application)/i;
  const ALREADY = /(already applied|you have already applied|application previously submitted|your application was received)/i;
  const LEGAL = /(non.disclosure agreement|confidentiality agreement|waiver of liability|electronic signature|accept the nda|arbitration agreement)/i;
  const parse = (key, fallback) => { try { return GM_getValue(PFX + key, fallback); } catch { return fallback; } };
  const store = (key, value) => GM_setValue(PFX + key, value);
  const current = () => location.href.split('#')[0];
  const bodyText = () => (document.body?.innerText || '').slice(0, 24000);
  const visible = el => el && !el.disabled && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const label = el => ([...(el.labels || [])].map(x => x.innerText).join(' ') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id || '').trim();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const state = parse('state', { active: false, queue: [], index: 0, history: {}, submittedPending: null });
  let profile = parse('profile', null);
  let inProgress = false;
  let status = 'Ready';

  function discover() {
    const found = BASE.map(([title, url]) => ({ title, url }));
    for (const a of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(a.href); } catch { continue; }
      if (url.origin !== 'https://my.betabound.com' || !url.pathname.startsWith('/key/')) continue;
      const title = (a.innerText || a.closest('article,li,[class*="card"]')?.innerText || '').slice(0, 140);
      if (!GOODS.test(title)) continue;
      if (!found.some(x => x.url === url.href)) found.push({ title: title.replace(/\s+/g, ' ').slice(0, 75), url: url.href });
      if (found.length >= 40) break;
    }
    return found;
  }

  function save() { store('state', state); draw(); }
  function done(reason) {
    const item = state.queue[state.index];
    if (item) state.history[item.url] = { reason, at: new Date().toISOString() };
    state.submittedPending = null;
    state.index++;
    if (state.index >= state.queue.length) state.active = false;
    save();
    if (state.active) location.assign(state.queue[state.index].url);
    else { status = 'Queue finished. See status below.'; draw(); }
  }
  function inputValue(el, value) {
    if (!value || !visible(el)) return false;
    if (el.tagName === 'SELECT') {
      const options = [...el.options];
      const target = options.find(x => norm(x.value) === norm(value) || norm(x.textContent) === norm(value) ||
        (norm(value) === 'ny' && norm(x.textContent) === 'new york'));
      if (!target) return false;
      el.value = target.value;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, String(value)); else el.value = String(value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function answerFor(el) {
    if (!profile) return null;
    const d = norm([el.name, el.id, label(el), el.autocomplete].join(' '));
    const name = profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(' ');
    if (/(first name|given name|firstname)/.test(d)) return profile.first_name || name.split(' ')[0];
    if (/(last name|family name|surname|lastname)/.test(d)) return profile.last_name || name.split(' ').slice(1).join(' ');
    if (/(full name|your name)/.test(d) || d === 'name') return name;
    if (/email/.test(d) || el.type === 'email') return profile.email;
    if (/phone|telephone|mobile/.test(d) || el.type === 'tel') return profile.phone;
    if (/address line 2|address2/.test(d)) return profile.address_line2;
    if (/street|address line 1|shipping address|mailing address/.test(d)) return profile.street;
    if (/(^| )city( |$)/.test(d)) return profile.city;
    if (/zip|postal/.test(d)) return profile.postal_code || profile.zip;
    if (/state|province/.test(d)) return profile.state;
    if (/country/.test(d)) return profile.country || 'United States';
    return null;
  }
  function required(el) {
    return el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label(el));
  }
  function fill() {
    let updated = 0; const missing = [];
    for (const el of document.querySelectorAll('input,textarea,select')) {
      if (!visible(el) || ['hidden','password','file','submit','button','reset'].includes(el.type)) continue;
      if (['radio','checkbox'].includes(el.type)) {
        if (required(el) && !el.checked) missing.push(label(el) || 'Required choice');
        continue;
      }
      if (!el.value || (el.tagName === 'SELECT' && !norm(el.value))) {
        const v = answerFor(el);
        if (v && inputValue(el, v)) updated++;
      }
      if (required(el) && !String(el.value || '').trim()) missing.push(label(el) || 'Required answer');
    }
    return { updated, missing: [...new Set(missing)] };
  }
  function firstButton(regex) {
    const matching = [...document.querySelectorAll('button,input[type="submit"],a[href]')]
      .filter(visible).filter(el => regex.test((el.innerText || el.value || '').trim()));
    return matching.length === 1 ? matching[0] : null;
  }
  function notices(text) {
    if (CONFIRM.test(text) || ALREADY.test(text)) return 'confirmed';
    if (LEGAL.test(text)) return 'agreement_needs_review';
    if (/(sign in|log in|continue with google|register below)/i.test(text) &&
      !document.querySelector('form input:not([type="hidden"])')) return 'google_sign_in_needed';
    return '';
  }
  async function auto() {
    if (!state.active || inProgress || !state.queue[state.index]) return;
    inProgress = true;
    try {
      const item = state.queue[state.index];
      if (current() !== item.url) {
        // Only navigate within the trusted Betabound origin.
        location.assign(item.url);
        return;
      }
      let page = bodyText(), note = notices(page);
      if (note === 'confirmed') { done('already_applied_or_confirmed'); return; }
      if (state.submittedPending === item.url) {
        status = 'Submission attempted; confirmation not visible. Paused to prevent duplicates.';
        state.active = false; save(); return;
      }
      if (note) { status = note; state.active = false; save(); return; }
      if (!profile) { status = 'Import your contact profile before automatic entries.'; state.active = false; save(); return; }
      const form = document.querySelector('form');
      if (!form) {
        const enter = firstButton(/^(apply now|apply|start application|take survey|join test)$/i);
        if (enter && (!enter.href || new URL(enter.href).origin === location.origin)) {
          enter.click();
          status = 'Opening application'; draw();
        } else { status = 'Application form not yet visible. Select Apply or sign in.'; state.active = false; save(); }
        return;
      }
      const result = fill();
      page = bodyText(); note = notices(page);
      if (note) { status = note; state.active = false; save(); return; }
      if (result.missing.length) {
        status = result.missing.length + ' required questions need your answers. Page prepared.';
        state.active = false; save(); return;
      }
      const submit = firstButton(/^(submit application|submit|send application|finish application)$/i);
      if (submit) {
        state.submittedPending = item.url;
        save();
        submit.click();
        setTimeout(() => {
          if (CONFIRM.test(bodyText())) done('confirmed');
          else { status = 'Submission attempted; verification needed before retrying.'; state.active = false; save(); }
        }, 1600);
        return;
      }
      status = 'Details filled. Continue the questionnaire on this page.';
      state.active = false; save();
    } catch (e) {
      status = 'Stopped at a page that needs review.';
      state.active = false; save();
    } finally { inProgress = false; }
  }
  let panel;
  function button(text, callback) {
    const b = document.createElement('button');
    b.textContent = text; b.type = 'button';
    b.style.cssText = 'font:14px system-ui;padding:9px;border:1px solid #777;border-radius:6px;background:#fff;color:#111';
    b.onclick = callback; return b;
  }
  function draw() {
    if (!panel) return;
    panel.replaceChildren();
    const title = document.createElement('strong'); title.textContent = 'Betabound Physical Tests'; panel.append(title);
    const info = document.createElement('div');
    info.style.cssText = 'font-size:12px;line-height:1.4;margin:6px 0';
    info.textContent = status + ' • Profile: ' + (profile ? 'saved locally' : 'needed') +
      ' • Test ' + Math.min(state.index + 1, state.queue.length) + '/' + state.queue.length +
      ' • Confirmed: ' + Object.values(state.history).filter(x => x.reason === 'confirmed').length;
    panel.append(info);
    const controls = document.createElement('div'); controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
    controls.append(button('Fill Page', () => { const r = fill(); status = r.updated + ' details filled; ' + r.missing.length + ' required unanswered'; draw(); }));
    controls.append(button('Start All', () => {
      state.queue = discover().filter(x => !['confirmed','already_applied_or_confirmed'].includes(state.history[x.url]?.reason));
      state.index = 0; state.active = state.queue.length > 0; state.submittedPending = null;
      status = state.active ? 'Starting physical-product applications' : 'No unprocessed tests';
      save(); if (state.active) auto();
    }));
    controls.append(button('Next Test', () => done('skipped_by_user')));
    controls.append(button('Stop', () => { state.active = false; save(); status = 'Stopped'; draw(); }));
    panel.append(controls);
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'application/json,.json';
    file.id = 'bb-profile-file';
    file.setAttribute('aria-label', 'Choose Betabound Profile JSON file');
    file.style.cssText = 'display:block;max-width:100%;margin-top:8px;padding:7px;background:#fff;color:#111;border:1px solid #555;border-radius:6px';
    const fileHelp = document.createElement('div');
    fileHelp.style.cssText = 'font-size:12px;margin-top:8px;font-weight:600';
    fileHelp.textContent = profile ? 'Profile saved ✓ (choose another file to replace it)' : 'Tap Choose File below to import your saved profile:';
    panel.append(fileHelp);
    // Android Firefox can report a picked document via input or change.
    // Keep this chooser on screen while reading; show meaningful feedback.
    let reading = false;
    const onPick = async () => {
      if (reading) return;
      const selected = file.files && file.files[0];
      if (!selected) {
        status = 'No file selected. Pick the .json file from Downloads.';
        draw(); return;
      }
      reading = true;
      status = 'Reading: ' + selected.name.slice(0, 55);
      info.textContent = status;
      try {
        let content;
        if (typeof selected.text === 'function') content = await selected.text();
        else content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Android file reader could not open the selected file'));
          reader.readAsText(selected, 'UTF-8');
        });
        const value = JSON.parse(String(content).replace(/^\\uFEFF/, '').trim());
        if (!value || typeof value !== 'object' || !value.name || !value.email)
          throw new Error('Selected JSON needs name and email fields');
        profile = value;
        store('profile', value);
        status = 'SUCCESS: Profile imported and saved. Tap Start All.';
      } catch (e) {
        status = 'IMPORT FAILED: ' + String(e?.message || e).slice(0, 130);
      } finally {
        reading = false;
        draw();
      }
    };
    file.addEventListener('change', onPick);
    file.addEventListener('input', onPick);
    panel.append(file);
  }
  function init() {
    if (document.getElementById('bb-assist-panel')) return;
    panel = document.createElement('section'); panel.id = 'bb-assist-panel';
    panel.style.cssText = 'position:fixed;z-index:2147483647;bottom:8px;right:8px;width:min(90vw,340px);max-height:45vh;overflow:auto;padding:12px;background:#f7f7fb;color:#141414;border:2px solid #343458;border-radius:12px;box-shadow:0 5px 22px #0006;font-family:system-ui';
    document.body.append(panel); draw();
    setTimeout(auto, 1700);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
