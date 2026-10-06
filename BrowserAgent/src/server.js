const express = require("express");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const httpProxy = require("http-proxy");
const { chromium } = require("playwright-core");

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 8932);
const DATA_DIR = process.env.DATA_DIR || "/data";
const CHROME = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const LOGIN_HASH = String(process.env.LOGIN_PASSWORD_SHA256 || "");
const DISPLAY = process.env.DISPLAY || ":99";

fs.mkdirSync(path.join(DATA_DIR, "profiles"), { recursive: true });

let queue = Promise.resolve();
let loginState = { browser: null, tunnel: null, profile: null, target: null, targets: [], url: null };

function cleanText(s, max = 12000) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeProfile(name) {
  return String(name || "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function authOk(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Basic ")) return false;
  try {
    const raw = Buffer.from(h.slice(6), "base64").toString("utf8");
    const i = raw.indexOf(":");
    const user = i >= 0 ? raw.slice(0, i) : "";
    const pass = i >= 0 ? raw.slice(i + 1) : "";
    return user === "jason" && LOGIN_HASH && sha256(pass) === LOGIN_HASH;
  } catch {
    return false;
  }
}

const proxy = httpProxy.createProxyServer({ target: "http://127.0.0.1:6080", ws: true });
const loginProxy = http.createServer((req, res) => {
  if (!authOk(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Oracle Browser Login"' });
    res.end("Authentication required");
    return;
  }
  proxy.web(req, res);
});
loginProxy.on("upgrade", (req, socket, head) => {
  if (!authOk(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head);
});
loginProxy.listen(6081, "0.0.0.0");

async function launchProfile(name) {
  const userDataDir = path.join(DATA_DIR, "profiles", safeProfile(name));
  fs.mkdirSync(userDataDir, { recursive: true });
  return chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1365, height: 850 },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
}

async function pageFor(context) {
  const pages = context.pages();
  return pages[0] || await context.newPage();
}

async function goto(page, url, timeout = 30000) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForTimeout(1200);
}

function killChild(child) {
  if (!child) return;
  try { child.kill("SIGTERM"); } catch {}
}

async function stopLogin() {
  killChild(loginState.tunnel);
  killChild(loginState.browser);
  loginState = { browser: null, tunnel: null, profile: null, target: null, targets: [], url: null };
  await new Promise(r => setTimeout(r, 1200));
  return { task: "login_stop", status: "stopped" };
}

async function startLogin(job) {
  await stopLogin();
  const profile = safeProfile(job.profile || "daily");
  const targets = Array.isArray(job.urls) && job.urls.length
    ? job.urls.map(String).filter(Boolean)
    : [String(job.url || "about:blank")];
  const target = targets[0] || "about:blank";
  const userDataDir = path.join(DATA_DIR, "profiles", profile);
  fs.mkdirSync(userDataDir, { recursive: true });

  const browser = spawn(CHROME, [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1365,850",
    `--user-data-dir=${userDataDir}`,
    ...targets
  ], { env: { ...process.env, DISPLAY }, stdio: ["ignore", "ignore", "pipe"] });

  const tunnel = spawn("/usr/local/bin/cloudflared", [
    "tunnel", "--url", "http://127.0.0.1:6081", "--no-autoupdate"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  loginState = { browser, tunnel, profile, target, targets, url: null };

  const url = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Timed out starting temporary login tunnel")), 25000);
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        clearTimeout(timer);
        resolve(m[0] + "/vnc.html?autoconnect=1&resize=scale");
      }
    };
    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);
    tunnel.once("exit", code => {
      if (!loginState.url) {
        clearTimeout(timer);
        reject(new Error("cloudflared exited before tunnel URL, code " + code));
      }
    });
  });

  loginState.url = url;
  return {
    task: "login_start",
    status: "ready",
    profile,
    target,
    targets,
    login_url: url,
    username: "jason",
    note: "Open the temporary URL, enter the Oracle Browser Login credentials, finish the website login, then run login_stop."
  };
}

async function jmlScanWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://www.anker-jml.com/");
    await page.waitForTimeout(2500);
    const body = cleanText(await page.locator("body").innerText().catch(() => ""), 30000);
    const loginRequired = /sign in to unlock more testing opportunities/i.test(body);
    const opportunities = await page.locator("a,button").evaluateAll((els) => {
      const out = [];
      const seen = new Set();
      for (const el of els) {
        const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (!/(Join Now|Under Review|Applied|Recruit|Beta|Test|Survey)/i.test(label)) continue;
        let p = el, text = label;
        for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
          const t = (p.innerText || "").replace(/\s+/g, " ").trim();
          if (t.length > text.length && t.length <= 1200) text = t;
        }
        text = text.slice(0, 1200);
        if (!seen.has(text)) { seen.add(text); out.push(text); }
      }
      return out.slice(0, 30);
    }).catch(() => []);
    return { task: "jml_scan", authenticated: !loginRequired, login_required: loginRequired, url: page.url(), opportunities };
  } finally {
    await page.close().catch(() => {});
  }
}

async function jmlScan() {
  if (loginState.browser) return { task: "jml_scan", status: "login_session_active" };
  const context = await launchProfile("daily");
  try { return await jmlScanWithContext(context); }
  finally { await context.close().catch(() => {}); }
}

async function roborockSpinWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://us.roborock.com/pages/points");
    let body = cleanText(await page.locator("body").innerText().catch(() => ""), 30000);
    if (/account-us\.roborock\.com\/login/i.test(page.url()) || (/log in|sign in/i.test(body) && /roborock/i.test(body))) {
      return { task: "roborock_spin", status: "login_required", url: page.url() };
    }
    const candidates = page.getByText(/lucky|spin|draw/i);
    const count = await candidates.count().catch(() => 0);
    let clickedEntry = false;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const el = candidates.nth(i);
      if (await el.isVisible().catch(() => false)) {
        try { await el.click({ timeout: 2500 }); clickedEntry = true; await page.waitForTimeout(1500); break; } catch {}
      }
    }
    const spinButtons = page.getByRole("button", { name: /spin|draw|start|go/i });
    const bc = await spinButtons.count().catch(() => 0);
    let spun = false;
    for (let i = 0; i < Math.min(bc, 10); i++) {
      const b = spinButtons.nth(i);
      if (await b.isVisible().catch(() => false)) {
        try { await b.click({ timeout: 2500 }); spun = true; await page.waitForTimeout(5000); break; } catch {}
      }
    }
    body = cleanText(await page.locator("body").innerText().catch(() => ""), 30000);
    const lines = body.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
    const resultLines = lines.filter(s => /(congrat|won|winner|prize|points|coupon|sorry|better luck|spin)/i.test(s)).slice(0, 20);
    return { task: "roborock_spin", status: spun ? "spin_attempted" : "spin_control_not_found", clicked_entry: clickedEntry, spun, url: page.url(), result_lines: resultLines };
  } finally {
    await page.close().catch(() => {});
  }
}

async function roborockSpin() {
  if (loginState.browser) return { task: "roborock_spin", status: "login_session_active" };
  const context = await launchProfile("daily");
  try { return await roborockSpinWithContext(context); }
  finally { await context.close().catch(() => {}); }
}


async function pageBody(page, max = 30000) {
  return cleanText(await page.locator("body").innerText().catch(() => ""), max);
}

async function reolinkSubscribeWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://reolink.com/lp/reolink-day/");
    await page.waitForTimeout(1800);
    const bodyBefore = await pageBody(page);
    const email = page.locator('input[type="email"]').first();
    if (!(await email.count().catch(() => 0))) {
      return { task: "reolink_subscribe", status: "email_field_not_found", url: page.url() };
    }
    await email.fill("jlc3718@gmail.com");
    const checks = page.locator('input[type="checkbox"]');
    const cc = await checks.count().catch(() => 0);
    for (let i = 0; i < Math.min(cc, 6); i++) {
      const c = checks.nth(i);
      if (await c.isVisible().catch(() => false) && !(await c.isChecked().catch(() => false))) {
        await c.check().catch(() => {});
      }
    }
    const buttons = page.getByRole("button", { name: /subscribe|enter|sign up|join/i });
    const bc = await buttons.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < Math.min(bc, 12); i++) {
      const b = buttons.nth(i);
      if (await b.isVisible().catch(() => false)) {
        try { await b.click({ timeout: 3000 }); clicked = true; break; } catch {}
      }
    }
    if (!clicked) {
      const submit = page.locator('button[type="submit"],input[type="submit"]').first();
      if (await submit.count().catch(() => 0)) {
        try { await submit.click({ timeout: 3000 }); clicked = true; } catch {}
      }
    }
    await page.waitForTimeout(2500);
    const body = await pageBody(page);
    const success = /(thank|success|subscribed|already subscribed|entered|you're in|you are in)/i.test(body) &&
                    !/(invalid email|required field|please enter)/i.test(body);
    return {
      task: "reolink_subscribe",
      status: success ? "submitted_or_already_subscribed" : (clicked ? "submitted_unconfirmed" : "submit_control_not_found"),
      url: page.url(),
      confirmation: body.match(/.{0,80}(thank|success|subscribed|already subscribed|entered|you're in).{0,120}/i)?.[0] || null,
      page_hint: success ? null : cleanText(bodyBefore, 2500)
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function eufyLuckyWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://www.eufy.com/app_primeday");
    await page.waitForTimeout(2500);
    let body = await pageBody(page);
    if (/log in\s*to take part|login\s*to take part|sign in\s*to take part/i.test(body)) {
      return { task: "eufy_lucky", status: "login_required", url: page.url() };
    }
    const m = body.match(/Entries Left:\s*(\d+)/i);
    const entries = m ? Number(m[1]) : null;
    if (entries === 0) return { task: "eufy_lucky", status: "no_free_entries", url: page.url() };
    const goButtons = page.getByRole("button", { name: /^(GO|Spin|Spin Now|Draw|Start)$/i });
    const bc = await goButtons.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < Math.min(bc, 12); i++) {
      const b = goButtons.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const txt = cleanText(await b.innerText().catch(() => ""));
      const parent = cleanText(await b.locator("xpath=..").innerText().catch(() => ""), 800);
      if (/100\s*eufycredits|redeem/i.test(txt + " " + parent)) continue;
      try { await b.click({ timeout: 3000 }); clicked = true; break; } catch {}
    }
    if (!clicked) return { task: "eufy_lucky", status: "free_spin_control_not_found", entries_left: entries, url: page.url() };
    await page.waitForTimeout(4500);
    body = await pageBody(page);
    const lines = body.split(/\n+/).map(x => cleanText(x, 300)).filter(x => /(congrat|won|prize|coupon|credit|better luck|thank)/i.test(x)).slice(0, 15);
    return { task: "eufy_lucky", status: "free_spin_attempted", entries_left_before: entries, url: page.url(), result_lines: lines };
  } finally {
    await page.close().catch(() => {});
  }
}

async function bluettiLuckyWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://www.bluettipower.com/pages/prime-day/");
    await page.waitForTimeout(2200);
    let body = await pageBody(page);
    if (/sign in|log in/i.test(body) && /lucky draw|spin/i.test(body)) {
      const memberSignals = page.getByText(/sign in|log in/i);
      if (await memberSignals.count().catch(() => 0)) {
        return { task: "bluetti_lucky", status: "login_may_be_required", url: page.url() };
      }
    }
    const candidates = page.getByRole("button", { name: /spin|draw|try|start|go/i });
    const bc = await candidates.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < Math.min(bc, 16); i++) {
      const b = candidates.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const parent = cleanText(await b.locator("xpath=..").innerText().catch(() => ""), 900);
      if (/(bucks|points).{0,30}(spend|cost|redeem)|purchase|required|pay/i.test(parent)) continue;
      if (!/(lucky|spin|draw|free|chance)/i.test(parent + " " + cleanText(await b.innerText().catch(() => "")))) continue;
      try { await b.click({ timeout: 3000 }); clicked = true; break; } catch {}
    }
    if (!clicked) return { task: "bluetti_lucky", status: "free_spin_not_confirmed", url: page.url() };
    await page.waitForTimeout(4500);
    body = await pageBody(page);
    const lines = body.split(/\n+/).map(x => cleanText(x, 300)).filter(x => /(congrat|won|prize|gift card|points|better luck|coupon)/i.test(x)).slice(0, 15);
    return { task: "bluetti_lucky", status: "free_spin_attempted", url: page.url(), result_lines: lines };
  } finally {
    await page.close().catch(() => {});
  }
}

async function wyzeSurveyProbeWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://forms.gle/HwgTL8mbuzHoFAPS8");
    await page.waitForTimeout(2200);
    let body = await pageBody(page, 40000);
    if (/you've already responded|already submitted|response has been recorded/i.test(body)) {
      return { task: "wyze_survey", status: "already_submitted", url: page.url() };
    }

    const blocks = page.locator('[role="listitem"]');
    async function block(prefix) {
      const c = blocks.filter({ hasText: prefix });
      const n = await c.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const t = cleanText(await c.nth(i).innerText().catch(() => ""), 1400);
        if (t.startsWith(prefix) || t.includes(prefix)) return c.nth(i);
      }
      return c.first();
    }
    async function radio(prefix, label) {
      const q = await block(prefix);
      const r = q.getByRole("radio", { name: label, exact: true });
      await r.first().click({ timeout: 4000 });
    }
    async function check(prefix, labels) {
      const q = await block(prefix);
      for (const label of labels) {
        const c = q.getByRole("checkbox", { name: label, exact: true });
        if (await c.count().catch(() => 0)) await c.first().click({ timeout: 3000 });
      }
    }
    async function fill(prefix, value) {
      const q = await block(prefix);
      const input = q.locator('input[type="text"],textarea').first();
      await input.fill(value);
    }

    await check("1.", ["Driveway / Garage", "Backyard", "Front door / Porch"]);
    await radio("2.", "Not sure");
    await fill("3.", "I’m evaluating an outdoor setup focused on driveway/garage, backyard, and front door coverage, with strong night visibility and useful local smart detection.");
    await radio("4.", "Somewhat prefer seeing finer details");
    await radio("5.", "Strongly prefer a tracking view follow person/vehicle as they move");
    await radio("6.", "D");
    await radio("7.", "Fixed wide view + tracking Pan/Tilt close-up view");
    await radio("8.", "A - The wide view stays fixed on the area, while the close-up view shifts to track activity");
    await radio("9.", "C");
    await radio("10.", "B");
    await radio("11.", "Fixed wide view + moving close-up view - $119");
    await radio("12.", "The added features are worth the extra cost");
    await fill("Any additional things", "Local recording, reliable person/vehicle detection without a required subscription, RTSP or Home Assistant support, strong night image quality, and fast notifications matter most to me.");
    await fill("Please enter your Name & Email", "Jason Craumer - jlc3718@gmail.com");

    const submit = page.getByRole("button", { name: /^Submit$/i });
    await submit.first().click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    body = await pageBody(page, 15000);
    const ok = /response has been recorded|thank you|submitted/i.test(body);
    return {
      task: "wyze_survey",
      status: ok ? "submitted" : "submitted_unconfirmed",
      url: page.url(),
      confirmation: body.match(/.{0,100}(response has been recorded|thank you|submitted).{0,160}/i)?.[0] || null
    };
  } catch (err) {
    return { task: "wyze_survey", status: "blocked", error: String(err) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function taskWithContext(context, task) {
  if (task === "jml_scan") return await jmlScanWithContext(context);
  if (task === "roborock_spin") return await roborockSpinWithContext(context);
  if (task === "reolink_subscribe") return await reolinkSubscribeWithContext(context);
  if (task === "eufy_lucky") return await eufyLuckyWithContext(context);
  if (task === "bluetti_lucky") return await bluettiLuckyWithContext(context);
  if (task === "wyze_survey") return await wyzeSurveyProbeWithContext(context);
  throw new Error("Unsupported context task: " + task);
}

async function runTask(job) {
  const task = String(job.task || "");
  if (task === "health") return { task: "health", ok: true, time: new Date().toISOString() };
  if (task === "login_start") return await startLogin(job);
  if (task === "login_stop") return await stopLogin();
  if (task === "jml_scan") return await jmlScan();
  if (task === "roborock_spin") return await roborockSpin();
  if (task === "reolink_subscribe" || task === "eufy_lucky" || task === "bluetti_lucky" || task === "wyze_survey") {
    if (loginState.browser || loginState.tunnel) await stopLogin();
    const context = await launchProfile("daily");
    try { return await taskWithContext(context, task); }
    finally { await context.close().catch(() => {}); }
  }
  if (task === "batch") {
    if (loginState.browser || loginState.tunnel) await stopLogin();
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];
    const allowed = tasks.filter(t => ["jml_scan", "roborock_spin", "reolink_subscribe", "eufy_lucky", "bluetti_lucky", "wyze_survey"].includes(String(t)));
    const context = await launchProfile("daily");
    try {
      const settled = await Promise.allSettled(allowed.map(t => taskWithContext(context, t)));
      return {
        task: "batch",
        parallel: true,
        shared_profile: "daily",
        results: settled.map((r, i) => r.status === "fulfilled"
          ? { task: allowed[i], ok: true, result: r.value }
          : { task: allowed[i], ok: false, error: String(r.reason) })
      };
    } finally {
      await context.close().catch(() => {});
    }
  }
  throw new Error("Unsupported task: " + task);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "oracle-browser-agent", login_active: Boolean(loginState.browser), time: new Date().toISOString() });
});

app.post("/run", async (req, res) => {
  const job = req.body || {};
  const id = String(job.id || "job");
  const started = new Date().toISOString();
  const execute = async () => {
    try {
      const result = await runTask(job);
      return { id, ok: true, started, finished: new Date().toISOString(), result };
    } catch (err) {
      return { id, ok: false, started, finished: new Date().toISOString(), error: String(err && err.stack || err) };
    }
  };
  const p = queue.then(execute, execute);
  queue = p.then(() => undefined, () => undefined);
  res.json(await p);
});

app.listen(PORT, "0.0.0.0", () => console.log(`oracle-browser-agent listening on ${PORT}`));
