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
    await goto(page, "https://reolink.club/reolinkday-com");
    await page.waitForTimeout(2600);

    const scopes = [page, ...page.frames().filter(f => f !== page.mainFrame())];
    let scope = null;
    let email = null;
    for (const sc of scopes) {
      const candidates = sc.locator('input[type="email"], input[placeholder*="email" i], input[name*="email" i]');
      if (await candidates.count().catch(() => 0)) {
        const c = candidates.first();
        if (await c.isVisible().catch(() => false)) { scope = sc; email = c; break; }
      }
    }
    if (!email) {
      return { task: "reolink_subscribe", status: "email_field_not_found", url: page.url(), title: await page.title().catch(() => "") };
    }

    await email.fill("jlc3718@gmail.com");

    const checks = scope.locator('input[type="checkbox"], [role="checkbox"]');
    const cc = await checks.count().catch(() => 0);
    for (let i = 0; i < Math.min(cc, 8); i++) {
      const c = checks.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      const checked = await c.isChecked().catch(() => false);
      if (!checked) {
        await c.check().catch(async () => { await c.click().catch(() => {}); });
      }
    }

    const submitters = scope.locator('button, input[type="submit"]');
    const scount = await submitters.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < Math.min(scount, 30); i++) {
      const b = submitters.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      const txt = cleanText((await b.innerText().catch(() => "")) || (await b.getAttribute("value").catch(() => "")), 200);
      if (!/(subscribe|enter|sign up|join|submit)/i.test(txt)) continue;
      try { await b.click({ timeout: 3500 }); clicked = true; break; } catch {}
    }
    if (!clicked) return { task: "reolink_subscribe", status: "submit_control_not_found", url: page.url() };

    await page.waitForTimeout(3500);
    const texts = [];
    for (const sc of scopes) texts.push(cleanText(await sc.locator("body").innerText().catch(() => ""), 12000));
    const body = texts.join(" ");
    const success = /(thank|success|subscribed|already subscribed|entered|you're in|you are in|submission received)/i.test(body) &&
                    !/(invalid email|required field|please enter)/i.test(body);
    return {
      task: "reolink_subscribe",
      status: success ? "submitted_or_already_subscribed" : "submitted_unconfirmed",
      url: page.url(),
      confirmation: body.match(/.{0,90}(thank|success|subscribed|already subscribed|entered|you're in|submission received).{0,160}/i)?.[0] || null
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function eufyLuckyWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://www.eufy.com/app_primeday");
    await page.waitForTimeout(3500);
    let body = await pageBody(page, 50000);

    if (/log in\s*to take part|login\s*to take part|sign in\s*to take part/i.test(body)) {
      return { task: "eufy_lucky", status: "login_required", url: page.url() };
    }

    const m = body.match(/Entries Left:\s*(\d+|-)/i);
    const entriesRaw = m ? m[1] : null;
    const entries = entriesRaw && /^\d+$/.test(entriesRaw) ? Number(entriesRaw) : null;
    if (entries === 0) return { task: "eufy_lucky", status: "no_free_entries", url: page.url() };

    // The current promo page exposes a standalone "GO" for the free wheel.
    // Never click "Redeem" or controls mentioning eufyCredits.
    const exactGo = page.getByText(/^GO$/i, { exact: true });
    const gc = await exactGo.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < Math.min(gc, 12); i++) {
      let el = exactGo.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const txt = cleanText(await el.innerText().catch(() => ""));
      if (!/^GO$/i.test(txt)) continue;
      try {
        await el.click({ timeout: 3500 });
        clicked = true;
        break;
      } catch {
        const parent = el.locator("xpath=..");
        const ptxt = cleanText(await parent.innerText().catch(() => ""), 800);
        if (/redeem|eufycredits/i.test(ptxt)) continue;
        try { await parent.click({ timeout: 3500 }); clicked = true; break; } catch {}
      }
    }

    if (!clicked) {
      const candidates = page.locator('button,[role="button"],a,div').filter({ hasText: /^GO$/i });
      const cc = await candidates.count().catch(() => 0);
      for (let i=0;i<Math.min(cc,30);i++) {
        const el=candidates.nth(i);
        if (!(await el.isVisible().catch(()=>false))) continue;
        const txt=cleanText(await el.innerText().catch(()=>""),100);
        if (!/^GO$/i.test(txt)) continue;
        const contextText=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),900);
        if (/redeem|eufycredits/i.test(contextText)) continue;
        try { await el.click({timeout:3500}); clicked=true; break; } catch {}
      }
    }

    if (!clicked) {
      return {
        task:"eufy_lucky",
        status:"free_spin_control_not_found",
        entries_left: entriesRaw,
        url:page.url(),
        snippets: body.split(/\n+/).map(x=>cleanText(x,400)).filter(x=>/(100% Chance|Entries Left|GO|Redeem|eufyCredits|Lucky Draw)/i.test(x)).slice(0,30)
      };
    }

    await page.waitForTimeout(5500);
    body = await pageBody(page, 50000);
    const lines = body.split(/\n+/).map(x => cleanText(x, 300)).filter(x => /(congrat|won|prize|coupon|credit|better luck|gift card|month plus|outdoor lights|Cam S4|Robot Vacuum E25)/i.test(x)).slice(0, 25);
    const after = body.match(/Entries Left:\s*(\d+|-)/i)?.[1] ?? null;
    return {
      task:"eufy_lucky",
      status:"free_spin_attempted",
      entries_left_before:entriesRaw,
      entries_left_after:after,
      url:page.url(),
      result_lines:lines
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function bluettiLuckyWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://www.bluettipower.com/pages/prime-day/");
    await page.waitForTimeout(3500);
    let body = await pageBody(page, 50000);

    // Account is considered logged in when a logout link is present.
    const logoutCount = await page.locator('a[href*="logout"]').count().catch(()=>0);
    const loggedIn = logoutCount > 0;

    // Navigate specifically to the Lucky Draw section first.
    const luckyText = page.getByText(/Lucky Draw/i);
    const lc = await luckyText.count().catch(()=>0);
    for (let i=0;i<Math.min(lc,10);i++) {
      const el=luckyText.nth(i);
      if (!(await el.isVisible().catch(()=>false))) continue;
      try { await el.click({timeout:2500}); await page.waitForTimeout(1600); break; } catch {}
    }

    body = await pageBody(page, 50000);
    const clickable = page.locator('button,[role="button"],a');
    const cc = await clickable.count().catch(()=>0);
    let clicked=false;
    let clickedLabel=null;
    for (let i=0;i<Math.min(cc,180);i++) {
      const el=clickable.nth(i);
      if (!(await el.isVisible().catch(()=>false))) continue;
      const txt=cleanText((await el.innerText().catch(()=>'')) || (await el.getAttribute('aria-label').catch(()=>'')),220);
      const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>''),900);
      const all=txt+" "+parent;
      if (!/(spin|draw|try now|play|start|go|chance)/i.test(all)) continue;
      if (/(spend|redeem|cost|purchase|required|pay|\b\d+\s*(bucks|points)\b)/i.test(all)) continue;
      if (!/(lucky|spin|draw|free|chance)/i.test(all)) continue;
      try { await el.click({timeout:3000}); clicked=true; clickedLabel=txt || parent.slice(0,180); break; } catch {}
    }

    if (!clicked) {
      return {
        task:"bluetti_lucky",
        status:"free_spin_not_confirmed",
        logged_in:loggedIn,
        url:page.url(),
        snippets:body.split(/\n+/).map(x=>cleanText(x,450)).filter(x=>/(Lucky Draw|Spin|Win|Bucks|chance|prize)/i.test(x)).slice(0,40)
      };
    }

    await page.waitForTimeout(5500);
    body=await pageBody(page,50000);
    const lines=body.split(/\n+/).map(x=>cleanText(x,300)).filter(x=>/(congrat|won|prize|gift card|bucks|better luck|coupon)/i.test(x)).slice(0,25);
    return {
      task:"bluetti_lucky",
      status:"free_spin_attempted",
      logged_in:loggedIn,
      clicked:clickedLabel,
      url:page.url(),
      result_lines:lines
    };
  } finally {
    await page.close().catch(()=>{});
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

async function diagnosticsWithContext(context, task) {
  const urls = {
    roborock_diag: "https://us.roborock.com/pages/points",
    eufy_diag: "https://www.eufy.com/app_primeday",
    bluetti_diag: "https://www.bluettipower.com/pages/prime-day/"
  };
  const url = urls[task];
  if (!url) throw new Error("Unknown diagnostic task");
  const page = await context.newPage();
  try {
    await goto(page, url);
    await page.waitForTimeout(3200);
    const body = await pageBody(page, 50000);
    const controls = await page.locator('button,a,[role="button"],input[type="button"],input[type="submit"]').evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName,
        text: (el.innerText || el.textContent || el.value || "").replace(/\s+/g," ").trim().slice(0,220),
        href: el.getAttribute("href") || "",
        aria: el.getAttribute("aria-label") || ""
      })).filter(x => x.text || x.href || x.aria).slice(0,120)
    ).catch(() => []);
    const snippets = body
      .split(/(?<=[.!?])\s+|\n+/)
      .map(x => cleanText(x, 500))
      .filter(x => /(lucky|spin|draw|entries|points|credits|bucks|login|log in|sign in|redeem|chance|prize|anniversary)/i.test(x))
      .slice(0,60);
    return {
      task,
      url: page.url(),
      title: await page.title().catch(()=>""),
      snippets,
      controls
    };
  } finally {
    await page.close().catch(()=>{});
  }
}

function readSimpleEnvFile(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0,i).trim()] = line.slice(i+1);
  }
  return out;
}

async function eufyLoginAndSpinWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://www.eufy.com/app_primeday");
    await page.waitForTimeout(2200);

    let body = await pageBody(page, 30000);
    const accountMenu = page.locator('[aria-label="account"]').first();
    const loggedOut = /existing user\?\s*log in/i.test(body) || /sign up\s*existing user\?\s*log in/i.test(body);

    if (loggedOut) {
      const creds = readSimpleEnvFile("/run/secrets/eufy-login.env");
      const email = creds.EUFY_EMAIL || "";
      const password = creds.EUFY_PASSWORD || "";
      if (!email || !password) return { task:"eufy_login_and_spin", status:"credential_file_missing" };

      if (await accountMenu.count().catch(()=>0)) {
        await accountMenu.click({ timeout:3000 }).catch(()=>{});
        await page.waitForTimeout(800);
      }

      // Click a visible "Log in" control if present.
      const loginText = page.getByText(/^Log in$/i);
      const lc = await loginText.count().catch(()=>0);
      for (let i=0;i<Math.min(lc,8);i++) {
        const el = loginText.nth(i);
        if (await el.isVisible().catch(()=>false)) {
          try { await el.click({timeout:3000}); break; } catch {}
        }
      }
      await page.waitForTimeout(1200);

      // Work across any auth iframe/modal.
      const scopes = [page, ...page.frames().filter(fr => fr !== page.mainFrame())];
      let authScope = null;
      let emailInput = null;
      for (const sc of scopes) {
        const cands = sc.locator('input[type="email"],input[name*="email" i],input[autocomplete="username"],input[placeholder*="email" i]');
        if (await cands.count().catch(()=>0)) {
          const c = cands.first();
          if (await c.isVisible().catch(()=>false)) { authScope=sc; emailInput=c; break; }
        }
      }
      if (!emailInput) return { task:"eufy_login_and_spin", status:"email_field_not_found", url:page.url() };

      await emailInput.fill(email);

      // Some eufy auth flows require Continue before password appears.
      let passInput = authScope.locator('input[type="password"]').first();
      if (!(await passInput.count().catch(()=>0)) || !(await passInput.isVisible().catch(()=>false))) {
        const cont = authScope.getByRole("button",{name:/continue|next|log in|sign in/i});
        const cc = await cont.count().catch(()=>0);
        for (let i=0;i<Math.min(cc,6);i++) {
          const b=cont.nth(i);
          if (await b.isVisible().catch(()=>false)) {
            try { await b.click({timeout:3000}); break; } catch {}
          }
        }
        await page.waitForTimeout(1000);
        passInput = authScope.locator('input[type="password"]').first();
      }

      if (!(await passInput.count().catch(()=>0))) {
        return { task:"eufy_login_and_spin", status:"password_field_not_found", url:page.url() };
      }
      await passInput.fill(password);

      // Tick required terms/privacy checkbox if present.
      const checks = authScope.locator('input[type="checkbox"],[role="checkbox"]');
      const nchecks = await checks.count().catch(()=>0);
      for(let i=0;i<Math.min(nchecks,6);i++) {
        const c=checks.nth(i);
        if (!(await c.isVisible().catch(()=>false))) continue;
        const checked=await c.isChecked().catch(()=>false);
        if(!checked) await c.check().catch(async()=>{await c.click().catch(()=>{});});
      }

      const submit = authScope.getByRole("button",{name:/log in|sign in|continue/i});
      const scount = await submit.count().catch(()=>0);
      let submitted=false;
      for(let i=0;i<Math.min(scount,8);i++) {
        const b=submit.nth(i);
        if(await b.isVisible().catch(()=>false)) {
          try { await b.click({timeout:4000}); submitted=true; break; } catch {}
        }
      }
      if(!submitted) return { task:"eufy_login_and_spin", status:"login_submit_not_found", url:page.url() };

      await page.waitForTimeout(3500);
      body = await pageBody(page,30000);
      if (/captcha|verification code|verify/i.test(body) && /log in|sign in|code/i.test(body)) {
        return { task:"eufy_login_and_spin", status:"human_verification_required", url:page.url() };
      }
      if (/existing user\?\s*log in/i.test(body)) {
        return { task:"eufy_login_and_spin", status:"login_failed", url:page.url() };
      }
    }

    // Navigate/scroll to the Lucky Draw section.
    const lucky = page.getByText(/^Lucky Draw$/i);
    const lcnt = await lucky.count().catch(()=>0);
    for(let i=0;i<Math.min(lcnt,8);i++) {
      const el=lucky.nth(i);
      if(await el.isVisible().catch(()=>false)) {
        try { await el.click({timeout:2500}); } catch { await el.scrollIntoViewIfNeeded().catch(()=>{}); }
        await page.waitForTimeout(1200);
        break;
      }
    }

    body = await pageBody(page,40000);
    const em = body.match(/Entries Left:\s*(\d+)/i);
    const entries = em ? Number(em[1]) : null;
    if(entries === 0) return { task:"eufy_login_and_spin", status:"no_free_entries", entries_left:0, url:page.url() };

    const candidates = page.locator('button,[role="button"],a,div').filter({hasText:/^(GO|Spin|Spin Now|Draw|Start)$/i});
    const cc = await candidates.count().catch(()=>0);
    let clicked=false;
    for(let i=0;i<Math.min(cc,30);i++) {
      const el=candidates.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const txt=cleanText(await el.innerText().catch(()=>""),100);
      const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),900);
      if(/100\s*eufycredits|redeem|buy|purchase/i.test(txt+" "+parent)) continue;
      if(!/(lucky|draw|spin|chance|entries left|100% chance)/i.test(parent+" "+body)) continue;
      try { await el.click({timeout:3000}); clicked=true; break; } catch {}
    }

    if(!clicked) {
      const snippets = body.split(/(?<=[.!?])\s+|\n+/).map(x=>cleanText(x,400))
        .filter(x=>/(lucky|draw|spin|entries left|credit|100% chance)/i.test(x)).slice(0,30);
      return {task:"eufy_login_and_spin",status:"free_spin_control_not_found",entries_left:entries,url:page.url(),snippets};
    }

    await page.waitForTimeout(4500);
    body = await pageBody(page,30000);
    const resultLines=body.split(/\n+/).map(x=>cleanText(x,300))
      .filter(x=>/(congrat|won|prize|coupon|credit|better luck|thank)/i.test(x)).slice(0,15);
    return {task:"eufy_login_and_spin",status:"free_spin_attempted",entries_left_before:entries,url:page.url(),result_lines:resultLines};
  } finally {
    await page.close().catch(()=>{});
  }
}

async function instagramDiagWithContext(context) {
  const page=await context.newPage();
  try {
    await goto(page,"https://www.instagram.com/");
    await page.waitForTimeout(2500);
    const body=await pageBody(page,20000);
    const loginRequired = /log in|sign up/i.test(body) && /instagram/i.test(body) &&
      !/(home|search|explore|reels|messages|notifications|create|profile)/i.test(body);
    return {
      task:"instagram_diag",
      authenticated:!loginRequired,
      login_required:loginRequired,
      url:page.url(),
      markers:body.split(/\n+/).map(x=>cleanText(x,200)).filter(x=>/(log in|home|search|explore|reels|messages|notifications|profile)/i.test(x)).slice(0,15)
    };
  } finally {
    await page.close().catch(()=>{});
  }
}

async function roborockGoogleLoginAndSpinWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page, "https://account-us.roborock.com/login?service=https://us.roborock.com/pages/points");
    await page.waitForTimeout(1800);

    // Required privacy/user-agreement checkbox if present.
    const checks = page.locator('input[type="checkbox"],[role="checkbox"]');
    const cc = await checks.count().catch(()=>0);
    for (let i=0;i<Math.min(cc,6);i++) {
      const c=checks.nth(i);
      if (!(await c.isVisible().catch(()=>false))) continue;
      const checked=await c.isChecked().catch(()=>false);
      if (!checked) await c.check().catch(async()=>{await c.click().catch(()=>{});});
    }

    const candidates = [
      page.getByRole("button",{name:/sign in with google|continue with google|google/i}),
      page.getByText(/sign in with google/i,{exact:false}),
      page.locator('[aria-label*="Google" i]'),
      page.locator('[class*="google" i]')
    ];
    let popup=null;
    let clicked=false;
    let matchedText=null;

    // Roborock sometimes renders Google auth as a div/span instead of a semantic button.
    for (const google of candidates) {
      const gc = await google.count().catch(()=>0);
      for(let i=0;i<Math.min(gc,12);i++) {
        const b=google.nth(i);
        if(!(await b.isVisible().catch(()=>false))) continue;
        const txt=cleanText(await b.innerText().catch(()=>""),200);
        if(txt && !/google/i.test(txt)) continue;
        try {
          const popupPromise=context.waitForEvent("page",{timeout:5000}).catch(()=>null);
          await b.click({timeout:3500,force:true});
          popup=await popupPromise;
          clicked=true;
          matchedText=txt || "Google control";
          break;
        } catch {}
      }
      if(clicked) break;
    }

    if(!clicked) {
      // Last fallback: click the smallest visible element whose own text includes "Sign in with Google".
      const raw=page.locator('div,span,p');
      const rc=await raw.count().catch(()=>0);
      for(let i=0;i<Math.min(rc,1200);i++) {
        const el=raw.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        const txt=cleanText(await el.innerText().catch(()=>""),200);
        if(!/^sign in with google$/i.test(txt)) continue;
        try {
          const popupPromise=context.waitForEvent("page",{timeout:5000}).catch(()=>null);
          await el.click({timeout:3000,force:true});
          popup=await popupPromise;
          clicked=true;
          matchedText=txt;
          break;
        } catch {}
      }
    }

    if(!clicked) return {task:"roborock_google_login_and_spin",status:"google_control_not_clickable",url:page.url()};

    const authPage=popup || page;
    await authPage.waitForTimeout(1800).catch(()=>{});
    let authBody=cleanText(await authPage.locator("body").innerText().catch(()=>""),20000);

    // If an account chooser appears, select the user's known Google account.
    const account = authPage.getByText(/jlc3718@gmail\.com/i);
    if(await account.count().catch(()=>0)) {
      const a=account.first();
      if(await a.isVisible().catch(()=>false)) {
        await a.click({timeout:3500}).catch(()=>{});
        await authPage.waitForTimeout(1800).catch(()=>{});
        authBody=cleanText(await authPage.locator("body").innerText().catch(()=>""),20000);
      }
    }

    // Do not attempt passwords, passkeys, CAPTCHA or 2FA.
    if (/(enter your password|verify it's you|2-step verification|captcha|passkey|security key|check your phone|enter code)/i.test(authBody)) {
      return {task:"roborock_google_login_and_spin",status:"human_google_verification_required",url:authPage.url()};
    }

    // Allow OAuth redirect to complete.
    await Promise.race([
      page.waitForURL(/us\.roborock\.com/, {timeout:12000}).catch(()=>{}),
      popup ? popup.waitForEvent("close",{timeout:12000}).catch(()=>{}) : Promise.resolve()
    ]);
    await page.waitForTimeout(1800);

    // Navigate explicitly to points center, then reuse the authorized one-spin logic.
    await goto(page,"https://us.roborock.com/pages/points");
    let body=await pageBody(page,30000);
    if(/account-us\.roborock\.com\/login/i.test(page.url()) || (/log in|sign in/i.test(body) && /roborock/i.test(body))) {
      return {task:"roborock_google_login_and_spin",status:"login_not_persisted",url:page.url()};
    }

    const spinLinks=page.getByText(/lucky|spin|draw/i);
    const count=await spinLinks.count().catch(()=>0);
    let clickedEntry=false;
    for(let i=0;i<Math.min(count,20);i++) {
      const el=spinLinks.nth(i);
      if(await el.isVisible().catch(()=>false)) {
        try { await el.click({timeout:2500}); clickedEntry=true; await page.waitForTimeout(1200); break; } catch {}
      }
    }

    // Look broadly for the actual spin control, but never click purchase/redeem controls other than the authorized 100-point Lucky Spin.
    const buttons=page.locator('button,[role="button"],a,div');
    const bc=await buttons.count().catch(()=>0);
    let spun=false;
    let clickedText=null;
    for(let i=0;i<Math.min(bc,400);i++) {
      const b=buttons.nth(i);
      if(!(await b.isVisible().catch(()=>false))) continue;
      const txt=cleanText(await b.innerText().catch(()=>""),160);
      if(!/(spin|lucky|draw|go|start)/i.test(txt)) continue;
      const parent=cleanText(await b.locator("xpath=..").innerText().catch(()=>""),900);
      if(/purchase|buy now|checkout/i.test(parent)) continue;
      if(!/(100\s*(points?|pts)|lucky\s*spin|spin)/i.test(parent+" "+txt)) continue;
      try { await b.click({timeout:2500}); spun=true; clickedText=txt; break; } catch {}
    }

    if(!spun) {
      const snippets=body.split(/(?<=[.!?])\s+|\n+/).map(x=>cleanText(x,400))
        .filter(x=>/(lucky|spin|draw|points|prize)/i.test(x)).slice(0,30);
      return {task:"roborock_google_login_and_spin",status:"spin_control_not_found",clicked_entry:clickedEntry,url:page.url(),snippets};
    }

    await page.waitForTimeout(5000);
    body=await pageBody(page,30000);
    const lines=body.split(/\n+/).map(x=>cleanText(x,300))
      .filter(x=>/(congrat|won|winner|prize|points|coupon|sorry|better luck|spin)/i.test(x)).slice(0,20);
    return {task:"roborock_google_login_and_spin",status:"spin_attempted",clicked_entry:clickedEntry,clicked_control:clickedText,url:page.url(),result_lines:lines};
  } finally {
    await page.close().catch(()=>{});
  }
}

async function roborockWheelDiagWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page,"https://us.roborock.com/pages/points");
    await page.waitForTimeout(2200);
    let body=await pageBody(page,40000);
    if(/account-us\.roborock\.com\/login/i.test(page.url())) {
      return {task:"roborock_wheel_diag",status:"login_required",url:page.url()};
    }

    const luckyMatches=page.getByText(/lucky\s*spin|lucky\s*draw|spin/i,{exact:false});
    const lm=await luckyMatches.count().catch(()=>0);
    const luckyDetails=[];
    for(let i=0;i<Math.min(lm,30);i++){
      const el=luckyMatches.nth(i);
      const vis=await el.isVisible().catch(()=>false);
      const txt=cleanText(await el.innerText().catch(()=>""),300);
      const html=await el.evaluate(e=>e.outerHTML.slice(0,2500)).catch(()=>"");
      const anc=await el.evaluate(e=>{
        let p=e; const out=[];
        for(let j=0;j<5 && p;j++,p=p.parentElement){
          out.push({
            tag:p.tagName,
            cls:p.className||"",
            id:p.id||"",
            text:(p.innerText||p.textContent||"").replace(/\s+/g," ").trim().slice(0,1200),
            html:p.outerHTML.slice(0,3500)
          });
        }
        return out;
      }).catch(()=>[]);
      luckyDetails.push({i,visible:vis,text:txt,html,ancestors:anc});
    }

    // Click the most promising visible Lucky Spin/Lucky Draw element.
    let clicked=false;
    let clickedIndex=null;
    for(let i=0;i<Math.min(lm,30);i++){
      const el=luckyMatches.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const txt=cleanText(await el.innerText().catch(()=>""),300);
      if(!/(lucky\s*spin|lucky\s*draw|spin)/i.test(txt)) continue;
      try { await el.scrollIntoViewIfNeeded().catch(()=>{}); await el.click({timeout:3000,force:true}); clicked=true; clickedIndex=i; break; } catch {}
    }
    await page.waitForTimeout(2500);

    const frames=page.frames().map(fr=>({url:fr.url(),name:fr.name()}));
    const frameData=[];
    for(const fr of page.frames()){
      try{
        const fbody=cleanText(await fr.locator("body").innerText().catch(()=>""),12000);
        const ctrls=await fr.locator('button,[role="button"],a,input,canvas,svg').evaluateAll((els)=>els.map((e,idx)=>({
          idx,tag:e.tagName,text:(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,300),
          aria:e.getAttribute("aria-label")||"",cls:e.className?.baseVal||e.className||"",id:e.id||"",
          href:e.getAttribute("href")||"",
          width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,
          x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y
        })).filter(x=>x.width>0&&x.height>0).slice(0,250)).catch(()=>[]);
        frameData.push({url:fr.url(),name:fr.name(),snippets:fbody.split(/\n+/).map(x=>x.trim()).filter(x=>/(lucky|spin|draw|100\s*points|100\s*pts|prize|chance|start|go)/i.test(x)).slice(0,80),controls:ctrls});
      }catch{}
    }

    const canvases=await page.locator('canvas').evaluateAll((els)=>els.map((e,idx)=>({
      idx,cls:e.className||"",id:e.id||"",width:e.width,height:e.height,
      rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height},
      parentText:(e.parentElement?.innerText||"").replace(/\s+/g," ").trim().slice(0,1500),
      parentHtml:e.parentElement?.outerHTML.slice(0,4000)||""
    }))).catch(()=>[]);

    const dialogs=await page.locator('[role="dialog"],dialog,.modal,[class*="modal" i],[class*="drawer" i],[class*="popup" i]').evaluateAll((els)=>els.map((e,idx)=>({
      idx,tag:e.tagName,cls:e.className||"",id:e.id||"",
      text:(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,4000),
      html:e.outerHTML.slice(0,6000)
    })).filter(x=>/(lucky|spin|draw|points|prize)/i.test(x.text+x.html)).slice(0,30)).catch(()=>[]);

    return {
      task:"roborock_wheel_diag",
      status:"inspected",
      url:page.url(),
      clicked,
      clicked_index:clickedIndex,
      lucky_details:luckyDetails,
      frames,
      frame_data:frameData,
      canvases,
      dialogs
    };
  } finally {
    await page.close().catch(()=>{});
  }
}

async function taskWithContext(context, task) {
  if (task === "jml_scan") return await jmlScanWithContext(context);
  if (task === "roborock_spin") return await roborockSpinWithContext(context);
  if (task === "reolink_subscribe") return await reolinkSubscribeWithContext(context);
  if (task === "eufy_lucky") return await eufyLuckyWithContext(context);
  if (task === "bluetti_lucky") return await bluettiLuckyWithContext(context);
  if (task === "wyze_survey") return await wyzeSurveyProbeWithContext(context);
  if (["roborock_diag","eufy_diag","bluetti_diag"].includes(task)) return await diagnosticsWithContext(context, task);
  if (task === "eufy_login_and_spin") return await eufyLoginAndSpinWithContext(context);
  if (task === "instagram_diag") return await instagramDiagWithContext(context);
  if (task === "roborock_google_login_and_spin") return await roborockGoogleLoginAndSpinWithContext(context);
  if (task === "roborock_wheel_diag") return await roborockWheelDiagWithContext(context);
  throw new Error("Unsupported context task: " + task);
}

async function runTask(job) {
  const task = String(job.task || "");
  if (task === "health") return { task: "health", ok: true, time: new Date().toISOString() };
  if (task === "login_start") return await startLogin(job);
  if (task === "login_stop") return await stopLogin();
  if (task === "jml_scan") return await jmlScan();
  if (task === "roborock_spin") return await roborockSpin();
  if (task === "reolink_subscribe" || task === "eufy_lucky" || task === "bluetti_lucky" || task === "wyze_survey" || task === "eufy_login_and_spin" || task === "instagram_diag" || task === "roborock_google_login_and_spin" || task === "roborock_wheel_diag" || ["roborock_diag","eufy_diag","bluetti_diag"].includes(task)) {
    if (loginState.browser || loginState.tunnel) await stopLogin();
    const context = await launchProfile("daily");
    try { return await taskWithContext(context, task); }
    finally { await context.close().catch(() => {}); }
  }
  if (task === "batch") {
    if (loginState.browser || loginState.tunnel) await stopLogin();
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];
    const allowed = tasks.filter(t => ["jml_scan", "roborock_spin", "reolink_subscribe", "eufy_lucky", "bluetti_lucky", "wyze_survey", "roborock_diag", "eufy_diag", "bluetti_diag", "eufy_login_and_spin", "instagram_diag", "roborock_google_login_and_spin", "roborock_wheel_diag"].includes(String(t)));
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
