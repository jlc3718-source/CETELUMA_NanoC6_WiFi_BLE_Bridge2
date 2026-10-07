"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function createFastDaily(deps) {
  const {
    dataDir,
    getLoginState,
    stopLogin,
    launchProfile,
    taskWithContext,
    prepareRestrictedSession,
    readEntryProfile
  } = deps;

  const dir = path.join(dataDir, "run-daily");
  const stateFile = path.join(dir, "state.json");
  const manualFile = path.join(dir, "manual-queue.json");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const DEFAULT_TASKS = [
    "jml_scan",
    "instagram_brand_scan",
    "navimow_round2_check",
    "roborock_wheel_diag",
    "eufy_alt_free_spin",
    "bluetti_safe_spin",
    "mova_widget_api_diag"
  ];

  const clone = (v) => JSON.parse(JSON.stringify(v));

  function readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return clone(fallback);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return clone(fallback);
    }
  }

  function writeJsonAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function readState() {
    const state = readJson(stateFile, {
      version: 1,
      created_at: new Date().toISOString(),
      last_run_at: null,
      lanes: {},
      campaigns: {}
    });
    state.lanes ||= {};
    state.campaigns ||= {};
    return state;
  }

  function readManualQueue() {
    const q = readJson(manualFile, { version: 1, items: [] });
    q.items = Array.isArray(q.items) ? q.items : [];
    return q;
  }

  function stripVolatile(value) {
    if (Array.isArray(value)) return value.map(stripVolatile);
    if (!value || typeof value !== "object") return value;
    const out = {};
    const volatile = /^(started|finished|time|at|login_url|timestamp|updated_at|last_seen_at)$/i;
    for (const key of Object.keys(value).sort()) {
      if (volatile.test(key)) continue;
      out[key] = stripVolatile(value[key]);
    }
    return out;
  }

  function fingerprint(value) {
    return crypto.createHash("sha256")
      .update(JSON.stringify(stripVolatile(value)))
      .digest("hex");
  }

  function clamp(n, lo, hi, fallback) {
    const x = Number(n);
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;
  }

  function laneResultTask(entry) {
    return String(entry?.task || entry?.result?.task || "unknown");
  }

  function compactLaneResult(entry) {
    if (!entry) return entry;
    if (entry.ok === false) return { task: entry.task, ok: false, error: String(entry.error || "unknown error") };
    const r = entry.result ?? entry;
    return stripVolatile(r);
  }

  function campaignVisible(campaign) {
    const status = String(campaign?.status || "").toLowerCase();
    return ![
      "confirmed",
      "submitted",
      "completed",
      "suppressed",
      "expired",
      "closed",
      "blocked_suppress",
      "already_entered"
    ].includes(status);
  }

  async function runDailyFast(job = {}) {
    let manualSessionClosed = false;
    const login = getLoginState();
    if ((login?.context || login?.tunnel) && job.close_stale_manual !== false) {
      await stopLogin();
      manualSessionClosed = true;
    }

    const tasks = Array.isArray(job.tasks) && job.tasks.length
      ? [...new Set(job.tasks.map(String))]
      : DEFAULT_TASKS.slice();

    // Fast by default: one slow site cannot hold the entire daily sweep hostage.
    const laneTimeoutMs = clamp(job.lane_timeout_ms, 8000, 25000, 18000);
    const context = await launchProfile("daily");
    let settled;
    try {
      const runLane = (task) => Promise.race([
        taskWithContext(context, task),
        new Promise(resolve => setTimeout(() => resolve({
          task,
          status: "timeout_skipped",
          timeout_ms: laneTimeoutMs
        }), laneTimeoutMs))
      ]);
      settled = await Promise.allSettled(tasks.map(runLane));
    } finally {
      await context.close().catch(() => {});
    }

    const results = settled.map((r, i) => r.status === "fulfilled"
      ? { task: tasks[i], ok: true, result: r.value }
      : { task: tasks[i], ok: false, error: String(r.reason) });

    const state = readState();
    const now = new Date().toISOString();
    const changes = [];
    let unchangedCount = 0;

    for (const entry of results) {
      const task = laneResultTask(entry);
      const compact = compactLaneResult(entry);
      const fp = fingerprint(compact);
      const prev = state.lanes[task];
      const changed = !prev || prev.fingerprint !== fp;
      state.lanes[task] = {
        fingerprint: fp,
        last_seen_at: now,
        last_changed_at: changed ? now : (prev?.last_changed_at || now),
        status: String(compact?.status || compact?.result?.status || ""),
        result: compact
      };
      if (changed) changes.push({ task, result: compact });
      else unchangedCount++;
    }

    state.last_run_at = now;
    writeJsonAtomic(stateFile, state);

    const queue = readManualQueue();
    const visibleCampaigns = Object.values(state.campaigns).filter(campaignVisible);

    return {
      task: "run_daily_fast",
      status: "complete",
      parallel: true,
      profile: "daily",
      lane_timeout_ms: laneTimeoutMs,
      manual_session_closed: manualSessionClosed,
      scanned_lanes: tasks.length,
      changed_lanes: changes,
      unchanged_lanes: unchangedCount,
      errors: results.filter(x => !x.ok).map(x => ({ task:x.task, error:x.error })),
      unresolved_campaigns: visibleCampaigns,
      manual_queue_count: queue.items.length
    };
  }

  function promoStatePatch(job = {}) {
    const state = readState();
    const items = Array.isArray(job.items) ? job.items : [];
    const now = new Date().toISOString();

    for (const raw of items) {
      const id = String(raw?.id || raw?.url || raw?.title || "").trim();
      if (!id) continue;
      const prior = state.campaigns[id] || {};
      state.campaigns[id] = {
        ...prior,
        ...stripVolatile(raw),
        id,
        updated_at: now
      };
    }

    writeJsonAtomic(stateFile, state);
    return {
      task:"promo_state_patch",
      status:"stored",
      updated:items.length,
      campaign_count:Object.keys(state.campaigns).length
    };
  }

  function promoStateGet() {
    const state = readState();
    return {
      task:"promo_state_get",
      status:"ready",
      last_run_at:state.last_run_at,
      campaigns:Object.values(state.campaigns),
      lanes:Object.fromEntries(Object.entries(state.lanes).map(([k,v])=>[k,{
        last_seen_at:v.last_seen_at,
        last_changed_at:v.last_changed_at,
        status:v.status
      }]))
    };
  }

  function manualQueueAdd(job = {}) {
    const queue = readManualQueue();
    const items = Array.isArray(job.items) ? job.items : [];
    const now = new Date().toISOString();
    const byKey = new Map(queue.items.map(x => [String(x.id || x.url), x]));

    for (const raw of items) {
      const url = String(raw?.url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      const key = String(raw?.id || url);
      byKey.set(key, {
        ...byKey.get(key),
        id:key,
        title:String(raw?.title || byKey.get(key)?.title || url),
        url,
        reason:String(raw?.reason || byKey.get(key)?.reason || "manual final action"),
        source:String(raw?.source || byKey.get(key)?.source || ""),
        added_at:byKey.get(key)?.added_at || now,
        updated_at:now
      });
    }

    queue.items = [...byKey.values()].slice(0, 30);
    writeJsonAtomic(manualFile, queue);
    return { task:"manual_queue_add", status:"stored", count:queue.items.length, items:queue.items };
  }

  function manualQueueClear(job = {}) {
    const queue = readManualQueue();
    const ids = new Set((Array.isArray(job.ids) ? job.ids : []).map(String));
    if (!ids.size) queue.items = [];
    else queue.items = queue.items.filter(x => !ids.has(String(x.id || x.url)));
    writeJsonAtomic(manualFile, queue);
    return { task:"manual_queue_clear", status:"stored", count:queue.items.length };
  }

  async function manualQueueOpen(job = {}) {
    const queue = readManualQueue();
    if (!queue.items.length) return { task:"manual_queue_open", status:"empty", count:0 };

    const maxTabs = clamp(job.max_tabs, 1, 20, 12);
    const selected = queue.items.slice(0, maxTabs);
    const session = await prepareRestrictedSession({
      kind:"queue",
      urls:selected.map(x => x.url)
    });

    return {
      ...session,
      task:"manual_queue_open",
      status:"ready_for_manual_action",
      queue_count:queue.items.length,
      opened:selected.map((x,i)=>({index:i,title:x.title,url:x.url,reason:x.reason,id:x.id}))
    };
  }

  async function genericFormEntry(job = {}) {
    const url = String(job.url || "");
    if (!/^https?:\/\//i.test(url)) throw new Error("Missing valid form URL");
    const profile = readEntryProfile();
    const context = await launchProfile("daily");
    const page = context.pages()[0] || await context.newPage();

    try {
      await page.goto(url, { waitUntil:"domcontentloaded", timeout:12000 }).catch(async()=>{ await page.evaluate(()=>window.stop()).catch(()=>{}); });
      await page.waitForTimeout(800);

      const fillOne = async (selectors, value) => {
        if (value == null || value === "") return false;
        for (const sel of selectors) {
          const loc = page.locator(sel);
          const n = await loc.count().catch(()=>0);
          for (let i=0;i<Math.min(n,10);i++) {
            const el=loc.nth(i);
            if (!(await el.isVisible().catch(()=>false))) continue;
            try {
              const cur=await el.inputValue().catch(()=>"");
              if (!cur) await el.fill(String(value));
              return true;
            } catch {}
          }
        }
        return false;
      };

      const names=String(profile.name||"").trim().split(/\s+/);
      await fillOne(['input[autocomplete="given-name"]','input[name*="first" i]','input[placeholder*="first" i]'],names[0]||"");
      await fillOne(['input[autocomplete="family-name"]','input[name*="last" i]','input[placeholder*="last" i]'],names.slice(1).join(" "));
      await fillOne(['input[type="email"]','input[autocomplete="email"]','input[name*="email" i]'],profile.email);
      await fillOne(['input[type="tel"]','input[autocomplete="tel"]','input[name*="phone" i]'],profile.phone);
      await fillOne(['input[autocomplete="address-line1"]','input[name*="address" i]','input[placeholder*="street" i]'],profile.street);
      await fillOne(['input[autocomplete="address-level2"]','input[name*="city" i]'],profile.city);
      await fillOne(['input[autocomplete="postal-code"]','input[name*="zip" i]','input[name*="postal" i]'],profile.postal_code);

      const supplied = job.fields && typeof job.fields === "object" ? job.fields : {};
      for (const [selector,value] of Object.entries(supplied)) {
        const loc=page.locator(selector).first();
        if (!(await loc.count().catch(()=>0))) continue;
        const tag=await loc.evaluate(el=>el.tagName).catch(()=>"");
        if (tag==="SELECT") await loc.selectOption(String(value)).catch(()=>{});
        else await loc.fill(String(value)).catch(()=>{});
      }

      // Only required terms/rules checkboxes are selected automatically; optional marketing remains untouched.
      const requiredChecks=page.locator('input[type="checkbox"][required]');
      for(let i=0;i<Math.min(await requiredChecks.count().catch(()=>0),15);i++){
        const c=requiredChecks.nth(i);
        if(await c.isVisible().catch(()=>false) && !(await c.isChecked().catch(()=>false))) await c.check().catch(()=>{});
      }

      const body=(await page.locator("body").innerText().catch(()=>"")).slice(0,40000);
      const challenge=page.frames().some(fr=>/captcha|turnstile|recaptcha|hcaptcha/i.test(fr.url())) ||
        /verify you are human|captcha|turnstile/i.test(body);

      const requiredEmpty=await page.locator('input[required],select[required],textarea[required]').evaluateAll(els=>
        els.filter(e=>e.offsetParent!==null && !String(e.value||"").trim() && e.type!=="checkbox")
          .map(e=>e.name||e.id||e.placeholder||e.type)
      ).catch(()=>[]);

      if (requiredEmpty.length || challenge || job.submit !== true) {
        return {
          task:"generic_form_entry",
          status:challenge?"manual_final_required_challenge":requiredEmpty.length?"missing_required_fields":"prepared",
          url:page.url(),
          missing:[...new Set(requiredEmpty)].slice(0,20),
          challenge,
          prepared:true
        };
      }

      const submit=page.locator('button[type="submit"],input[type="submit"]').filter({visible:true}).first();
      if (!(await submit.count().catch(()=>0))) return {task:"generic_form_entry",status:"submit_control_not_found",url:page.url(),prepared:true};
      await submit.click({timeout:3500});
      await page.waitForTimeout(1800);
      const final=(await page.locator("body").innerText().catch(()=>"")).slice(0,30000);
      const confirmed=/(thank you|thanks for entering|entry received|successfully entered|submission received|you.?re entered)/i.test(final);
      return {
        task:"generic_form_entry",
        status:confirmed?"confirmed":"submitted_unconfirmed",
        url:page.url(),
        confirmation:confirmed?(final.match(/.{0,100}(thank you|thanks for entering|entry received|successfully entered|submission received|you.?re entered).{0,160}/i)?.[0]||null):null
      };
    } finally {
      await context.close().catch(()=>{});
    }
  }

  async function instagramCommentEntry(job = {}) {
    const url=String(job.url||"");
    const comment=String(job.comment||"").trim();
    if (!/^https:\/\/(www\.)?instagram\.com\/(p|reel)\//i.test(url)) throw new Error("Exact Instagram post/reel URL required");
    if (!comment) throw new Error("Comment text required");

    const context=await launchProfile("daily");
    const page=context.pages()[0] || await context.newPage();
    try{
      await page.goto(url,{waitUntil:"domcontentloaded",timeout:12000}).catch(async()=>{await page.evaluate(()=>window.stop()).catch(()=>{});});
      await page.waitForTimeout(1000);
      const body=(await page.locator("body").innerText().catch(()=>"")).slice(0,30000);
      if (/log in|sign up/i.test(body) && !/add a comment/i.test(body)) {
        return {task:"instagram_comment_entry",status:"login_required",url:page.url()};
      }
      if (body.includes(comment)) return {task:"instagram_comment_entry",status:"already_entered",url:page.url()};

      const candidates=[
        page.locator('textarea[aria-label*="comment" i]'),
        page.locator('textarea[placeholder*="comment" i]'),
        page.locator('[contenteditable="true"][aria-label*="comment" i]')
      ];
      let field=null;
      for(const loc of candidates){
        const n=await loc.count().catch(()=>0);
        for(let i=0;i<Math.min(n,8);i++){
          const el=loc.nth(i);
          if(await el.isVisible().catch(()=>false)){field=el;break;}
        }
        if(field) break;
      }
      if(!field) return {task:"instagram_comment_entry",status:"comment_field_not_found",url:page.url()};

      try{await field.fill(comment);}catch{await field.click();await page.keyboard.type(comment,{delay:3});}
      const post=page.getByText(/^Post$/i,{exact:true});
      let clicked=false;
      for(let i=0;i<Math.min(await post.count().catch(()=>0),8);i++){
        const b=post.nth(i);
        if(!(await b.isVisible().catch(()=>false))) continue;
        try{await b.click({timeout:2500});clicked=true;break;}catch{}
      }
      if(!clicked) await page.keyboard.press("Enter").catch(()=>{});
      await page.waitForTimeout(1500);
      const final=(await page.locator("body").innerText().catch(()=>"")).slice(0,35000);
      return {task:"instagram_comment_entry",status:final.includes(comment)?"confirmed":"submitted_unconfirmed",url:page.url()};
    }finally{
      await context.close().catch(()=>{});
    }
  }

  return {
    runDailyFast,
    promoStatePatch,
    promoStateGet,
    manualQueueAdd,
    manualQueueClear,
    manualQueueOpen,
    genericFormEntry,
    instagramCommentEntry
  };
}

module.exports = { createFastDaily };
