// Betabound physical-product applications. No credentials or responses are checked into Git.
import { chromium } from 'playwright';

const KNOWN = [
  { id: 'GasGrill26', title: 'Gas grill', url: 'https://my.betabound.com/key/GasGrill26' },
  { id: 'HomeDehumidifier', title: 'Home dehumidifier', url: 'https://my.betabound.com/key/HomeDehumidifier' },
  { id: 'PremiumAirPurifierMed', title: 'Premium air purifier', url: 'https://my.betabound.com/key/PremiumAirPurifierMed' }
];
const PHYSICAL = /\b(grill|dehumidifier|air purifier|humidifier|vacuum|mop|refrigerator|dishwasher|washer|dryer|robot|security camera|doorbell|smart lock|power station|solar|inverter|charger|evse|speaker|headphone|tv|television|monitor|router|appliance|lighting|lights|lawn mower|tool|generator|hardware|physical product|air conditioner|thermostat|fan|heater|printer|cooktop|oven)\b/i;
const LOGIN = /(log in|login|sign in|register below|continue with google|sign in with google|log in or register|register to apply)/i;
const SUBMITTED = /(already applied|application (?:was|has been) submitted|application received|you have applied|already registered|thanks for applying)/i;
const CONFIRMED = /(application submitted|application received|thank you for applying|thanks for applying|successfully applied|your application has been received)/i;
const LEGAL = /(non.disclosure|confidentiality agreement|arbitration|waiver of liability|electronic signature|sign the agreement|accept the nda)/i;
const MAX = 30;
const mode = process.env.BETABOUND_MODE === 'apply' ? 'apply' : 'scan';

function fromSecret(value) {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')); }
  catch { throw new Error('Invalid private configuration; expected base64-encoded JSON'); }
}
function errorCode(e) {
  const msg = String(e?.message || e);
  if (/Timeout/.test(msg)) return 'navigation_timeout';
  if (/net::ERR_/.test(msg)) return 'network_error';
  return 'browser_error';
}
function sanitized(s) { return String(s || '').replace(/[^\p{L}\p{N} .,'()\-/?]/gu, ' ').trim().slice(0, 100); }
function redactedReport(data) { return JSON.stringify(data, null, 2); }
const output = { mode, storage_state_supplied: false, profile_supplied: false, results: [], extra_physical_discovered: 0 };
let browser;
try {
  const storage = fromSecret(process.env.BETABOUND_SESSION_B64);
  const profile = fromSecret(process.env.BETABOUND_PROFILE_B64);
  output.storage_state_supplied = !!storage;
  output.profile_supplied = !!profile;
  browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    ...(storage ? { storageState: storage } : {}),
    locale: 'en-US',
    timezoneId: 'America/New_York'
  });
  const publicPage = await context.newPage();
  const targets = [...KNOWN];
  if (storage) {
    try {
      await publicPage.goto('https://my.betabound.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await publicPage.waitForTimeout(1000);
      const discovered = await publicPage.locator('a[href]').evaluateAll(nodes =>
        nodes.map(a => ({ href: a.href, text: (a.innerText || a.textContent || '').slice(0, 120) }))
      );
      for (const a of discovered) {
        if (!a.href.startsWith('https://my.betabound.com/')) continue;
        if (!PHYSICAL.test(a.text + ' ' + a.href)) continue;
        if (targets.some(t => t.url === a.href)) continue;
        if (targets.length >= MAX) break;
        targets.push({ id: 'extra-' + targets.length, title: 'Additional physical-product test', url: a.href });
        output.extra_physical_discovered++;
      }
    } catch { /* The three explicit links remain checkable without discovery. */ }
  }
  await publicPage.close();

  for (const target of targets) {
    const result = { id: target.id, title: target.title, status: 'unchecked', submitted: false, confirmed: false };
    output.results.push(result);
    const page = await context.newPage();
    try {
      const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 18000 });
      await page.waitForTimeout(800);
      if ((response?.status() || 200) >= 400) { result.status = 'page_unavailable'; continue; }
      const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 24000);
      if (SUBMITTED.test(body)) { result.status = 'already_applied'; continue; }
      if (!storage && LOGIN.test(body)) { result.status = 'google_sign_in_needed'; continue; }
      if (storage && LOGIN.test(body) && !/application|apply now|apply for this test/i.test(body)) {
        result.status = 'session_expired_or_login_needed'; continue;
      }
      if (mode === 'scan') { result.status = storage ? 'application_requires_review' : 'public_opportunity_accessible'; continue; }
      if (!storage) { result.status = 'google_sign_in_needed'; continue; }

      // Entry to the form itself; do not select unrelated links or external domains.
      const applyLink = page.getByRole('link', { name: /^(apply|apply now|start application|join test|take survey)$/i }).first();
      const applyButton = page.getByRole('button', { name: /^(apply|apply now|start application|join test|take survey)$/i }).first();
      if (await applyLink.isVisible().catch(() => false)) {
        const href = await applyLink.getAttribute('href');
        if (href && new URL(href, page.url()).origin === 'https://my.betabound.com') await applyLink.click({ timeout: 3000 });
      } else if (await applyButton.isVisible().catch(() => false)) {
        await applyButton.click({ timeout: 3000 });
      }
      if (!page.url().startsWith('https://my.betabound.com/')) {
        result.status = 'external_application_requires_review'; continue;
      }

      let stageFinished = false;
      for (let stage = 0; stage < 7; stage++) {
        await page.waitForTimeout(700);
        const text = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 20000);
        if (SUBMITTED.test(text) || CONFIRMED.test(text)) {
          result.status = SUBMITTED.test(text) ? 'already_applied' : 'confirmed';
          result.confirmed = result.status === 'confirmed';
          stageFinished = true; break;
        }
        if (LEGAL.test(text)) { result.status = 'agreement_requires_personal_review'; stageFinished = true; break; }
        if (LOGIN.test(text) && !(await page.locator('form input:not([type=hidden])').count())) {
          result.status = 'google_sign_in_needed'; stageFinished = true; break;
        }
        const visible = await page.locator('input,textarea,select').evaluateAll(els => els.filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && el.type !== 'hidden';
        }).map(el => {
          const label = (el.labels && [...el.labels].map(x => x.innerText).join(' ')) || el.getAttribute('aria-label') || el.placeholder || el.name || '';
          return { name: el.name, type: el.type, tag: el.tagName, id: el.id, required: el.required, value: el.value, checked: el.checked, label: label.slice(0, 140) };
        }));
        if (!visible.length) { result.status = 'application_form_not_found'; stageFinished = true; break; }
        const unknown = [];
        const p = profile || {};
        const fullname = p.name || [p.first_name, p.last_name].filter(Boolean).join(' ');
        const fields = {
          'first': p.first_name || fullname.split(' ')[0],
          'last': p.last_name || fullname.split(' ').slice(1).join(' '),
          'email': p.email, 'phone': p.phone, 'street': p.street,
          'address': p.street, 'city': p.city, 'zip': p.postal_code || p.zip,
          'postal': p.postal_code || p.zip, 'state': p.state, 'country': p.country || 'United States'
        };
        for (const f of visible) {
          if (['submit','button','reset','file','radio','checkbox'].includes(f.type)) continue;
          if (f.value) continue;
          const desc = (f.name + ' ' + f.label + ' ' + f.id).toLowerCase();
          let answer;
          if (/full.?name|your.?name|^name$/.test(desc)) answer = fullname;
          else for (const [key,value] of Object.entries(fields)) if (desc.includes(key) && value) { answer = value; break; }
          if (answer) {
            const selector = f.id ? '#' + CSS.escape(f.id) : '[name="' + String(f.name).replace(/"/g,'') + '"]';
            // Only fill uniquely matched fields; no default or invented screener answers.
            const loc = page.locator(selector);
            if (await loc.count() === 1) {
              try {
                if (f.tag === 'SELECT') await loc.selectOption({ label: String(answer) });
                else await loc.fill(String(answer));
              } catch { if (f.required) unknown.push(sanitized(f.label)); }
            } else if (f.required) unknown.push(sanitized(f.label));
          } else if (f.required) unknown.push(sanitized(f.label));
        }
        for (const f of visible.filter(x => x.required && ['radio','checkbox'].includes(x.type))) {
          unknown.push(sanitized(f.label) || 'Required choice or agreement');
        }
        if (unknown.length || !profile) {
          result.status = !profile ? 'private_profile_needed' : 'screener_answers_needed';
          result.required_question_count = [...new Set(unknown)].length;
          stageFinished = true; break;
        }
        const submit = page.getByRole('button', { name: /^(submit application|submit|send application|finish application)$/i });
        const next = page.getByRole('button', { name: /^(next|continue)$/i });
        if (await submit.count() === 1 && await submit.first().isEnabled()) {
          await submit.click({ timeout: 5000 });
          result.submitted = true;
          await page.waitForTimeout(1300);
          const after = await page.locator('body').innerText().catch(() => '');
          result.confirmed = CONFIRMED.test(after);
          result.status = result.confirmed ? 'confirmed' : 'submitted_unverified';
          stageFinished = true; break;
        }
        if (await next.count() === 1 && await next.first().isEnabled()) {
          await next.click({ timeout: 4000 });
          continue;
        }
        result.status = 'manual_review_needed';
        stageFinished = true; break;
      }
      if (!stageFinished) result.status = 'multi_step_application_needs_review';
    } catch (e) {
      result.status = errorCode(e);
    } finally {
      await page.close().catch(() => {});
    }
  }
  await context.close();
} catch (e) {
  output.runner_error = errorCode(e);
} finally {
  if (browser) await browser.close().catch(() => {});
}
const summary = {
  mode: output.mode, storage_state_supplied: output.storage_state_supplied, profile_supplied: output.profile_supplied,
  extra_physical_discovered: output.extra_physical_discovered, results: output.results,
  ...(output.runner_error ? { runner_error: output.runner_error } : {})
};
console.log(redactedReport(summary));
if (process.env.GITHUB_STEP_SUMMARY) {
  const fs = await import('node:fs');
  const lines = ['## Betabound physical-test results', '', '| Test | Status |', '| --- | --- |'];
  for (const x of summary.results) lines.push('| ' + x.title + ' | ' + x.status + ' |');
  lines.push('', 'Confirmed applications: ' + summary.results.filter(r => r.confirmed).length,
    'Google session available: ' + summary.storage_state_supplied,
    'Private application profile available: ' + summary.profile_supplied,
    'Other physical tests discovered: ' + summary.extra_physical_discovered);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
