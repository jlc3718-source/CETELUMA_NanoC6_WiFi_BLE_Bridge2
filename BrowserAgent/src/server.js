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
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeout, 16000) });
  } catch (err) {
    // Heavy promo pages often keep third-party assets open after the usable DOM is present.
    // If navigation reached the requested host, stop the remaining load and continue.
    const current = String(page.url() || "");
    let targetHost = "";
    try { targetHost = new URL(url).host; } catch {}
    let currentHost = "";
    try { currentHost = new URL(current).host; } catch {}
    if (!current || current === "about:blank" || (targetHost && currentHost !== targetHost && !currentHost.endsWith("." + targetHost))) {
      throw err;
    }
    await page.evaluate(() => window.stop()).catch(() => {});
  }
  await page.waitForTimeout(1400);
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
    await page.waitForTimeout(2200);

    // Open the Lucky Draw tab explicitly; the GO control is hidden until this tab is activated.
    const luckyTabs = page.getByText(/^Lucky Draw$/i, { exact: true });
    const ltc = await luckyTabs.count().catch(() => 0);
    for (let i=0;i<Math.min(ltc,12);i++) {
      const el=luckyTabs.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      try { await el.click({timeout:2500}); await page.waitForTimeout(1600); break; } catch {}
    }

    let body = await pageBody(page, 50000);
    if (/log in\s*to take part|login\s*to take part|sign in\s*to take part/i.test(body)) {
      return { task: "eufy_lucky", status: "login_required", url: page.url() };
    }

    const before = body.match(/Entries Left:\s*(\d+|-)/i)?.[1] ?? null;
    if (before === "0") return { task: "eufy_lucky", status: "no_free_entries", url: page.url() };

    // Find the smallest visible exact-text GO node and click it. Avoid Redeem/credits controls.
    const clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll("button,a,[role=button],div,span")];
      const candidates = els.filter(el => {
        const txt = (el.innerText || el.textContent || "").replace(/\s+/g," ").trim();
        if (txt !== "GO") return false;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || st.visibility === "hidden" || st.display === "none") return false;
        const ptxt = (el.parentElement?.innerText || "").replace(/\s+/g," ");
        return !/Redeem|eufyCredits/i.test(ptxt);
      }).sort((a,b) => {
        const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
        return (ar.width*ar.height)-(br.width*br.height);
      });
      if (!candidates.length) return false;
      candidates[0].scrollIntoView({block:"center",inline:"center"});
      candidates[0].click();
      return true;
    }).catch(()=>false);

    if (!clicked) {
      return {
        task:"eufy_lucky",
        status:"free_spin_control_not_found",
        entries_left:before,
        url:page.url(),
        snippets:body.split(/\n+/).map(x=>x.trim()).filter(x=>/(100% Chance|Entries Left|Lucky Draw|My prizes|GO)/i.test(x)).slice(0,25)
      };
    }

    await page.waitForTimeout(5000);
    body = await pageBody(page, 50000);
    const after = body.match(/Entries Left:\s*(\d+|-)/i)?.[1] ?? null;
    const lines = body.split(/\n+/).map(x=>cleanText(x,320))
      .filter(x=>/(congrat|won|prize|coupon|gift card|credits|outdoor lights|Cam S4|Robot Vacuum E25|1-Month Plus|better luck)/i.test(x))
      .slice(0,30);
    const confirmed = (before && after && /^\d+$/.test(before) && /^\d+$/.test(after) && Number(after) < Number(before)) || lines.length>0;
    return {
      task:"eufy_lucky",
      status:confirmed ? "spin_completed" : "spin_clicked_unconfirmed",
      entries_left_before:before,
      entries_left_after:after,
      url:page.url(),
      result_lines:lines
    };
  } finally {
    await page.close().catch(()=>{});
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
    bluetti_diag: "https://www.bluettipower.com/pages/prime-day/",
    mova_diag: "https://us.mova.tech/pages/mova-prime-day-sale"
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

async function instagramBrandScanWithContext(context) {
  const handles = [
    "roborockglobal",
    "dreametech",
    "movatech.usa",
    "narwalrobot",
    "tinecoglobal",
    "eufyofficial",
    "goveeofficial",
    "navimow",
    "mammotiontech",
    "ecovacsrobotics"
  ];
  const keywords = /(giveaway|win\b|winner|beta|tester|testing|review program|free\b|free product|sample|trial|apply|application|launch|early access|mystery|lucky|spin|sweepstakes|contest|prize|campaign|ambassador|prototype)/i;

  async function scanHandle(handle) {
    const page = await context.newPage();
    try {
      await goto(page, "https://www.instagram.com/" + handle + "/");
      await page.waitForTimeout(2200);
      const profileBody = cleanText(await page.locator("body").innerText().catch(()=>""),18000);
      if (/log in|sign up/i.test(profileBody) && !/(posts|followers|following)/i.test(profileBody)) {
        return {handle,status:"login_required",url:page.url(),hits:[]};
      }

      const links = await page.locator('a[href*="/p/"],a[href*="/reel/"]').evaluateAll((els)=>{
        const seen=new Set(), out=[];
        for(const a of els){
          const href=a.href;
          if(!href || seen.has(href)) continue;
          seen.add(href);
          const img=a.querySelector("img");
          const alt=(img?.getAttribute("alt")||"").replace(/\s+/g," ").trim();
          const text=(a.innerText||a.textContent||"").replace(/\s+/g," ").trim();
          const aria=(a.getAttribute("aria-label")||"").trim();
          out.push({href,preview:(alt+" "+text+" "+aria).trim().slice(0,1200)});
          if(out.length>=6) break;
        }
        return out;
      }).catch(()=>[]);

      const hits=[];
      // Open recent posts to inspect captions because Instagram profile grids often hide caption text.
      for (const item of links.slice(0,5)) {
        let txt=item.preview||"";
        if (!keywords.test(txt)) {
          try {
            await page.goto(item.href,{waitUntil:"domcontentloaded",timeout:12000});
            await page.waitForTimeout(1300);
            txt=cleanText(await page.locator("body").innerText().catch(()=>""),12000);
          } catch {}
        }
        if(keywords.test(txt)){
          const snippets = txt.split(/(?<=[.!?])\s+|\n+/)
            .map(x=>cleanText(x,500))
            .filter(x=>keywords.test(x))
            .slice(0,12);
          hits.push({url:item.href,snippets,preview:item.preview});
        }
      }
      return {handle,status:"ok",profile_url:"https://www.instagram.com/"+handle+"/",recent_scanned:Math.min(links.length,5),hits};
    } finally {
      await page.close().catch(()=>{});
    }
  }

  const settled=await Promise.allSettled(handles.map(scanHandle));
  return {
    task:"instagram_brand_scan",
    authenticated:true,
    results:settled.map((r,i)=>r.status==="fulfilled"
      ? r.value
      : {handle:handles[i],status:"error",error:String(r.reason),hits:[]})
  };
}

async function houseworkChallengeEntryWithContext(context) {
  const page = await context.newPage();
  try {
    await goto(page,"https://shop.housework.com/products/fall-cleaning-challenge-2026");
    await page.waitForTimeout(1800);
    const body=await pageBody(page,30000);
    if(/sold out|unavailable/i.test(body)) return {task:"housework_challenge",status:"not_available",url:page.url()};

    const addBtn = page.getByRole("button",{name:/add to cart/i});
    if(await addBtn.count().catch(()=>0)) {
      await addBtn.first().click({timeout:4000}).catch(()=>{});
      await page.waitForTimeout(1200);
    }

    const checkout = page.getByRole("button",{name:/check out|checkout/i});
    if(await checkout.count().catch(()=>0)) {
      await checkout.first().click({timeout:4000}).catch(()=>{});
    } else {
      await page.goto("https://shop.housework.com/cart",{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>{});
      const co=page.getByRole("button",{name:/check out|checkout/i});
      if(await co.count().catch(()=>0)) await co.first().click({timeout:4000}).catch(()=>{});
    }

    await page.waitForTimeout(2500);
    let txt=await pageBody(page,35000);

    const email=page.locator('input[type="email"],input[name*="email" i],input[autocomplete="email"]').first();
    if(await email.count().catch(()=>0)) await email.fill("jlc3718@gmail.com").catch(()=>{});

    const first=page.locator('input[name*="first" i],input[autocomplete="given-name"]').first();
    if(await first.count().catch(()=>0)) await first.fill("Jason").catch(()=>{});
    const last=page.locator('input[name*="last" i],input[autocomplete="family-name"]').first();
    if(await last.count().catch(()=>0)) await last.fill("Craumer").catch(()=>{});

    const requiredUnknown=[];
    const reqInputs=page.locator('input[required],select[required],textarea[required]');
    const rc=await reqInputs.count().catch(()=>0);
    for(let i=0;i<Math.min(rc,40);i++){
      const el=reqInputs.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const val=await el.inputValue().catch(()=>"");
      if(val) continue;
      const nm=(await el.getAttribute("name").catch(()=>null))||"";
      const ac=(await el.getAttribute("autocomplete").catch(()=>null))||"";
      const ph=(await el.getAttribute("placeholder").catch(()=>null))||"";
      const lab=(await el.getAttribute("aria-label").catch(()=>null))||"";
      const desc=(nm+" "+ac+" "+ph+" "+lab).trim();
      if(/email|first|given|last|family/i.test(desc)) continue;
      requiredUnknown.push(desc||"required field");
    }

    if(requiredUnknown.length){
      return {task:"housework_challenge",status:"blocked_missing_required_fields",url:page.url(),required_fields:[...new Set(requiredUnknown)].slice(0,20)};
    }

    const submit=page.getByRole("button",{name:/complete order|pay now|submit order|place order|download|continue/i});
    const sc=await submit.count().catch(()=>0);
    let clicked=false;
    for(let i=0;i<Math.min(sc,15);i++){
      const b=submit.nth(i);
      if(!(await b.isVisible().catch(()=>false))) continue;
      const label=cleanText(await b.innerText().catch(()=>""),180);
      if(/continue to (shipping|payment)/i.test(label)) continue;
      try{await b.click({timeout:4000});clicked=true;break;}catch{}
    }
    if(clicked) await page.waitForTimeout(3000);
    txt=await pageBody(page,30000);
    const ok=/(thank you|order is confirmed|download|your order|confirmation)/i.test(txt) &&
             !/(required|please enter|invalid)/i.test(txt);
    return {
      task:"housework_challenge",
      status:ok?"submitted":"submitted_unconfirmed",
      url:page.url(),
      confirmation:txt.match(/.{0,100}(thank you|order is confirmed|download|confirmation).{0,180}/i)?.[0]||null
    };
  } finally { await page.close().catch(()=>{}); }
}

async function dreameAeroGiveawayWithContext(context) {
  const page=await context.newPage();
  try{
    await goto(page,"https://us.forum.dreametech.com/forum.php?mod=viewthread&tid=11245");
    await page.waitForTimeout(2200);
    let body=await pageBody(page,30000);

    if(/log in|sign in/i.test(body) && !/(reply|post reply|quick reply)/i.test(body)){
      return {task:"dreame_aero_giveaway",status:"login_required",url:page.url()};
    }

    const entryText="The Dreame Aero Wet Dry Vacuum is on my fall wishlist. I already use Dreame robot cleaning at home, and a wet/dry vacuum would make quick cleanup of tracked-in dirt and spills much easier without pulling out a separate vacuum and mop.";

    const editors=[
      page.locator('textarea[name="message"]'),
      page.locator('textarea[id*="message"]'),
      page.locator('textarea'),
      page.locator('[contenteditable="true"]')
    ];
    let editor=null;
    for(const loc of editors){
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,8);i++){
        const e=loc.nth(i);
        if(await e.isVisible().catch(()=>false)){editor=e;break;}
      }
      if(editor) break;
    }
    if(!editor) return {task:"dreame_aero_giveaway",status:"reply_editor_not_found",url:page.url()};

    const tag=await editor.evaluate(e=>e.tagName).catch(()=>"");
    if(tag==="TEXTAREA"||tag==="INPUT") await editor.fill(entryText);
    else await editor.fill(entryText).catch(async()=>{await editor.click();await page.keyboard.type(entryText);});

    const submitters=[
      page.getByRole("button",{name:/reply|post|submit/i}),
      page.locator('button[type="submit"],input[type="submit"]')
    ];
    let clicked=false;
    for(const loc of submitters){
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,12);i++){
        const b=loc.nth(i);
        if(!(await b.isVisible().catch(()=>false))) continue;
        const label=cleanText((await b.innerText().catch(()=>''))||(await b.getAttribute("value").catch(()=>'')),140);
        if(!/(reply|post|submit)/i.test(label)) continue;
        try{await b.click({timeout:4000});clicked=true;break;}catch{}
      }
      if(clicked) break;
    }
    if(!clicked) return {task:"dreame_aero_giveaway",status:"submit_control_not_found",url:page.url()};
    await page.waitForTimeout(3000);
    body=await pageBody(page,30000);
    const found=body.includes("The Dreame Aero Wet Dry Vacuum is on my fall wishlist");
    return {task:"dreame_aero_giveaway",status:found?"submitted":"submitted_unconfirmed",url:page.url()};
  } finally { await page.close().catch(()=>{}); }
}

function vaultPaths() {
  const dir = path.join(DATA_DIR, "secure");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    dir,
    privateKey: path.join(dir, "private.pem"),
    publicKey: path.join(dir, "public.pem"),
    profile: path.join(dir, "entry-profile.json")
  };
}

function ensureVaultKeypair() {
  const p = vaultPaths();
  if (!fs.existsSync(p.privateKey) || !fs.existsSync(p.publicKey)) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 3072,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" }
    });
    fs.writeFileSync(p.privateKey, privateKey, { mode: 0o600 });
    fs.writeFileSync(p.publicKey, publicKey, { mode: 0o644 });
  }
  return p;
}

function initSecureVault() {
  const p = ensureVaultKeypair();
  const publicKey = fs.readFileSync(p.publicKey, "utf8");
  return {
    task: "vault_init",
    status: "ready",
    public_key_pem: publicKey,
    fingerprint_sha256: sha256(publicKey)
  };
}

function storeEncryptedEntryProfile(job) {
  const p = ensureVaultKeypair();
  const ciphertext = Buffer.from(String(job.ciphertext_b64 || ""), "base64");
  if (!ciphertext.length) throw new Error("Missing ciphertext_b64");
  const privateKey = fs.readFileSync(p.privateKey, "utf8");
  const plaintext = crypto.privateDecrypt({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  }, ciphertext);
  const data = JSON.parse(plaintext.toString("utf8"));
  const required = ["name","email","street","city","state","postal_code"];
  for (const k of required) if (!String(data[k] || "").trim()) throw new Error("Missing profile field: " + k);
  fs.writeFileSync(p.profile, JSON.stringify(data), { mode: 0o600 });
  return {
    task: "vault_store",
    status: "stored",
    fields: required,
    state: String(data.state),
    postal_prefix: String(data.postal_code).slice(0,3)
  };
}

function readEntryProfile() {
  const p = vaultPaths();
  if (!fs.existsSync(p.profile)) throw new Error("Secure entry profile is not stored");
  return JSON.parse(fs.readFileSync(p.profile, "utf8"));
}

async function movaPrizeWheelWithContext(context) {
  const profile = readEntryProfile();
  const page = await context.newPage();
  try {
    await goto(page, "https://us.mova.tech/pages/mova-prime-day-sale");
    await page.waitForTimeout(3000);

    let body = await pageBody(page, 50000);
    if (/already (entered|participated)|already spun|one spin per/i.test(body)) {
      return {task:"mova_prize_wheel",status:"already_entered_or_spun",url:page.url()};
    }

    // Move to the prize wheel / exclusive event section if a matching control exists.
    const sectionLinks = page.getByText(/Prize Wheel|Spin|Exclusive Event/i,{exact:false});
    const slc = await sectionLinks.count().catch(()=>0);
    for(let i=0;i<Math.min(slc,20);i++){
      const el=sectionLinks.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      try {
        await el.scrollIntoViewIfNeeded().catch(()=>{});
        await el.click({timeout:2500}).catch(()=>{});
        await page.waitForTimeout(1200);
        break;
      } catch {}
    }

    // Search main page plus embedded frames for a free-entry form.
    const scopes=[page,...page.frames().filter(fr=>fr!==page.mainFrame())];
    let scope=null;
    let emailField=null;
    for(const sc of scopes){
      const c=sc.locator('input[type="email"],input[name*="email" i],input[placeholder*="email" i],input[autocomplete="email"]');
      const n=await c.count().catch(()=>0);
      for(let i=0;i<Math.min(n,10);i++){
        const el=c.nth(i);
        if(await el.isVisible().catch(()=>false)){scope=sc;emailField=el;break;}
      }
      if(emailField) break;
    }

    // If no form is immediately visible, click likely free-spin/start controls once to reveal it.
    if(!emailField){
      const candidates=page.locator('button,[role="button"],a,div').filter({hasText:/spin|try now|start|free entry|enter now|play/i});
      const cc=await candidates.count().catch(()=>0);
      for(let i=0;i<Math.min(cc,80);i++){
        const el=candidates.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        const txt=cleanText(await el.innerText().catch(()=>""),180);
        const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),800);
        if(/purchase|buy|checkout|redeem|pay/i.test(txt+" "+parent)) continue;
        try{await el.click({timeout:2500});await page.waitForTimeout(1200);}catch{continue;}
        for(const sc of [page,...page.frames().filter(fr=>fr!==page.mainFrame())]){
          const c=sc.locator('input[type="email"],input[name*="email" i],input[placeholder*="email" i],input[autocomplete="email"]');
          const n=await c.count().catch(()=>0);
          for(let j=0;j<Math.min(n,10);j++){
            const f=c.nth(j);
            if(await f.isVisible().catch(()=>false)){scope=sc;emailField=f;break;}
          }
          if(emailField) break;
        }
        if(emailField) break;
      }
    }

    if(!emailField){
      body=await pageBody(page,50000);
      return {
        task:"mova_prize_wheel",
        status:"entry_form_not_found",
        url:page.url(),
        snippets:body.split(/\n+/).map(x=>cleanText(x,450)).filter(x=>/(prize wheel|spin|free entry|email|mova v50|p10 pro)/i.test(x)).slice(0,40)
      };
    }

    await emailField.fill(String(profile.email));

    const fillFirst = async (selectors,value) => {
      for(const sel of selectors){
        const loc=scope.locator(sel);
        const n=await loc.count().catch(()=>0);
        for(let i=0;i<Math.min(n,8);i++){
          const el=loc.nth(i);
          if(await el.isVisible().catch(()=>false)){
            const current=await el.inputValue().catch(()=>"");
            if(!current) await el.fill(String(value)).catch(()=>{});
            return true;
          }
        }
      }
      return false;
    };

    const nameParts=String(profile.name).trim().split(/\s+/);
    await fillFirst(['input[name*="first" i]','input[autocomplete="given-name"]','input[placeholder*="first" i]'],nameParts[0]||"Jason");
    await fillFirst(['input[name*="last" i]','input[autocomplete="family-name"]','input[placeholder*="last" i]'],nameParts.slice(1).join(" ")||"Craumer");
    await fillFirst(['input[name="name" i]','input[name*="full" i]','input[placeholder*="name" i]'],String(profile.name));
    await fillFirst(['input[name*="address1" i]','input[name*="address_1" i]','input[autocomplete="address-line1"]','input[placeholder*="street" i]','input[placeholder*="address" i]'],String(profile.street));
    await fillFirst(['input[name*="city" i]','input[autocomplete="address-level2"]','input[placeholder*="city" i]'],String(profile.city));
    await fillFirst(['input[name*="zip" i]','input[name*="postal" i]','input[autocomplete="postal-code"]','input[placeholder*="zip" i]'],String(profile.postal_code));

    // State selectors / text inputs.
    const stateSelect=scope.locator('select[name*="state" i],select[name*="province" i],select[autocomplete="address-level1"]').first();
    if(await stateSelect.count().catch(()=>0) && await stateSelect.isVisible().catch(()=>false)){
      await stateSelect.selectOption({label:/Pennsylvania/i}).catch(async()=>{await stateSelect.selectOption("PA").catch(()=>{});});
    } else {
      await fillFirst(['input[name*="state" i]','input[autocomplete="address-level1"]','input[placeholder*="state" i]'],String(profile.state));
    }

    // Do not opt into marketing unless required; required rules/terms boxes may be checked.
    const checks=scope.locator('input[type="checkbox"],[role="checkbox"]');
    const kc=await checks.count().catch(()=>0);
    for(let i=0;i<Math.min(kc,20);i++){
      const c=checks.nth(i);
      if(!(await c.isVisible().catch(()=>false))) continue;
      const meta=cleanText(
        (await c.getAttribute("name").catch(()=>null))+" "+
        (await c.getAttribute("aria-label").catch(()=>null))+" "+
        (await c.locator("xpath=..").innerText().catch(()=>"")),700);
      if(/newsletter|marketing|promotional|offers|email me/i.test(meta)) continue;
      if(/terms|rules|privacy|agree|eligib/i.test(meta)){
        const checked=await c.isChecked().catch(()=>false);
        if(!checked) await c.check().catch(async()=>{await c.click().catch(()=>{});});
      }
    }

    // Submit free entry.
    const submits=scope.locator('button,input[type="submit"],[role="button"]');
    const scount=await submits.count().catch(()=>0);
    let submitted=false;
    for(let i=0;i<Math.min(scount,50);i++){
      const el=submits.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const label=cleanText((await el.innerText().catch(()=>''))||(await el.getAttribute("value").catch(()=>''))+" "+(await el.getAttribute("aria-label").catch(()=>'')),220);
      if(!/(submit|enter|continue|spin|try now|start|play)/i.test(label)) continue;
      if(/purchase|buy|checkout|redeem|pay|subscribe/i.test(label)) continue;
      try{await el.click({timeout:3500});submitted=true;break;}catch{}
    }
    if(!submitted) return {task:"mova_prize_wheel",status:"submit_control_not_found",url:page.url()};

    await page.waitForTimeout(2500);
    body=await pageBody(page,50000);

    // After successful entry, the wheel may expose a separate spin/start control.
    let spun=false;
    let clickedLabel=null;
    const spinControls=page.locator('button,[role="button"],a,div').filter({hasText:/^(spin|spin now|start|play|go|try now)$/i});
    const spc=await spinControls.count().catch(()=>0);
    for(let i=0;i<Math.min(spc,60);i++){
      const el=spinControls.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const label=cleanText(await el.innerText().catch(()=>""),120);
      const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),700);
      if(/purchase|buy|checkout|pay|redeem/i.test(label+" "+parent)) continue;
      try{await el.click({timeout:3500});spun=true;clickedLabel=label;break;}catch{}
    }

    if(spun) await page.waitForTimeout(5000);
    body=await pageBody(page,50000);
    const resultLines=body.split(/\n+/).map(x=>cleanText(x,350))
      .filter(x=>/(congrat|won|winner|prize|coupon|off|v50 ultra|p10 pro|better luck|thank)/i.test(x))
      .slice(0,30);

    return {
      task:"mova_prize_wheel",
      status:spun?"spin_attempted":(/thank|success|entry/i.test(body)?"entry_submitted_spin_not_found":"entry_submitted_unconfirmed"),
      spun,
      clicked_control:clickedLabel,
      url:page.url(),
      result_lines:resultLines
    };
  } finally {
    await page.close().catch(()=>{});
  }
}

async function gotoLoose(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 14000 });
  } catch (err) {
    if (!/Timeout/i.test(String(err))) throw err;
  }
  await page.waitForTimeout(3500);
}

async function dreameEntryPathWithContext(context) {
  const page=await context.newPage();
  try {
    const url="https://us.forum.dreametech.com/forum.php?mod=viewthread&tid=11245";
    await gotoLoose(page,url);
    let body=await pageBody(page,35000);

    const editors=page.locator('textarea[name="message"],textarea[id*="message"],textarea,[contenteditable="true"]');
    const ec=await editors.count().catch(()=>0);
    let editor=null;
    for(let i=0;i<Math.min(ec,20);i++){
      const e=editors.nth(i);
      if(await e.isVisible().catch(()=>false)){editor=e;break;}
    }

    if(!editor){
      const loginLinks=page.locator('a[href*="login"],a[href*="logging"],a[href*="member.php"]');
      const lc=await loginLinks.count().catch(()=>0);
      let loginUrl=null;
      for(let i=0;i<Math.min(lc,30);i++){
        const a=loginLinks.nth(i);
        const txt=cleanText(await a.innerText().catch(()=>""),120);
        const href=await a.getAttribute("href").catch(()=>null);
        if(!href) continue;
        if(/log in|login|sign in/i.test(txt+" "+href)){ loginUrl=new URL(href,page.url()).href; break; }
      }
      return {
        task:"dreame_entry_path",
        status:/log in|sign in|login/i.test(body)?"login_required":"reply_editor_not_available",
        url:page.url(),
        login_url:loginUrl,
        need:"A one-time Dreame Forum login in the Oracle daily profile"
      };
    }

    const entryText="The Dreame Aero Wet Dry Vacuum is on my fall wishlist. I already use Dreame robot cleaning at home, and a wet/dry vacuum would make quick cleanup of tracked-in dirt and spills much easier without pulling out a separate vacuum and mop.";
    const tag=await editor.evaluate(e=>e.tagName).catch(()=>"");
    if(tag==="TEXTAREA"||tag==="INPUT") await editor.fill(entryText);
    else await editor.fill(entryText).catch(async()=>{await editor.click();await page.keyboard.type(entryText);});

    const buttons=page.locator('button[type="submit"],input[type="submit"],button,[role="button"]');
    const bc=await buttons.count().catch(()=>0);
    let submitted=false;
    for(let i=0;i<Math.min(bc,50);i++){
      const b=buttons.nth(i);
      if(!(await b.isVisible().catch(()=>false))) continue;
      const label=cleanText((await b.innerText().catch(()=>''))||(await b.getAttribute("value").catch(()=>'')),120);
      if(!/(reply|post|submit)/i.test(label)) continue;
      try{await b.click({timeout:3500});submitted=true;break;}catch{}
    }
    if(!submitted) return {task:"dreame_entry_path",status:"submit_control_not_found",url:page.url()};
    await page.waitForTimeout(2500);
    body=await pageBody(page,35000);
    const ok=body.includes("The Dreame Aero Wet Dry Vacuum is on my fall wishlist");
    return {task:"dreame_entry_path",status:ok?"submitted":"submitted_unconfirmed",url:page.url()};
  } finally { await page.close().catch(()=>{}); }
}

async function eufyDeepEntryWithContext(context) {
  const page=await context.newPage();
  try {
    await gotoLoose(page,"https://www.eufy.com/app_primeday");
    let body=await pageBody(page,50000);

    const scopes=[page,...page.frames().filter(fr=>fr!==page.mainFrame())];
    // First try exact visible text from the live promo.
    const triggers=[
      /100%\s*Chance\s*to\s*Win/i,
      /Click\s*to\s*win\s*prizes/i,
      /^GO$/i,
      /Lucky\s*Draw/i
    ];
    let opened=false;
    for(const sc of scopes){
      for(const re of triggers){
        const loc=sc.getByText(re,{exact:false});
        const n=await loc.count().catch(()=>0);
        for(let i=0;i<Math.min(n,20);i++){
          const el=loc.nth(i);
          if(!(await el.isVisible().catch(()=>false))) continue;
          const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),1000);
          if(/redeem|100\s*eufycredits|buy|purchase/i.test(parent)) continue;
          try{await el.scrollIntoViewIfNeeded().catch(()=>{});await el.click({timeout:2500,force:true});opened=true;await page.waitForTimeout(1200);break;}catch{}
        }
        if(opened) break;
      }
      if(opened) break;
    }

    // Re-scan for a safe free-spin control after opening the widget.
    const rescopes=[page,...page.frames().filter(fr=>fr!==page.mainFrame())];
    for(const sc of rescopes){
      const cand=sc.locator('button,[role="button"],a,div,span').filter({hasText:/^(GO|Spin|Spin Now|Start|Draw)$/i});
      const n=await cand.count().catch(()=>0);
      for(let i=0;i<Math.min(n,60);i++){
        const el=cand.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        const txt=cleanText(await el.innerText().catch(()=>""),100);
        const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),1000);
        if(/redeem|100\s*eufycredits|buy|purchase/i.test(txt+" "+parent)) continue;
        try{
          await el.click({timeout:3000,force:true});
          await page.waitForTimeout(4500);
          body=await pageBody(page,50000);
          const lines=body.split(/\n+/).map(x=>cleanText(x,300)).filter(x=>/(congrat|won|prize|coupon|better luck|Cam S4|Robot Vacuum E25)/i.test(x)).slice(0,25);
          return {task:"eufy_deep_entry",status:"free_spin_attempted",url:page.url(),result_lines:lines};
        }catch{}
      }
    }

    const frameUrls=page.frames().map(fr=>fr.url()).filter(Boolean);
    return {
      task:"eufy_deep_entry",
      status:"widget_found_but_spin_control_not_exposed",
      url:page.url(),
      frame_urls:frameUrls.filter(u=>/eufy|anker|promo|draw|spin|widget|app/i.test(u)).slice(0,30),
      snippets:body.split(/\n+/).map(x=>cleanText(x,350)).filter(x=>/(100% Chance|Lucky Draw|Click to win|GO|eufycredits)/i.test(x)).slice(0,30)
    };
  } finally { await page.close().catch(()=>{}); }
}

async function bluettiRobustEntryWithContext(context) {
  const page=await context.newPage();
  try {
    await gotoLoose(page,"https://www.bluettipower.com/pages/prime-day/");
    let body=await pageBody(page,50000);
    const scopes=[page,...page.frames().filter(fr=>fr!==page.mainFrame())];

    for(const sc of scopes){
      const lucky=sc.getByText(/Lucky Draw/i,{exact:false});
      const n=await lucky.count().catch(()=>0);
      for(let i=0;i<Math.min(n,20);i++){
        const el=lucky.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        await el.scrollIntoViewIfNeeded().catch(()=>{});
        await el.click({timeout:2500}).catch(()=>{});
        await page.waitForTimeout(1000);
        break;
      }
    }

    for(const sc of [page,...page.frames().filter(fr=>fr!==page.mainFrame())]){
      const cand=sc.locator('button,[role="button"],a,div,span').filter({hasText:/^(Spin|Spin Now|Draw|Start|Go|Try Now|Play)$/i});
      const n=await cand.count().catch(()=>0);
      for(let i=0;i<Math.min(n,80);i++){
        const el=cand.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),900);
        if(/purchase|buy|redeem|spend|cost|pay|\d+\s*(bucks|points)/i.test(parent)) continue;
        try{
          await el.click({timeout:3000,force:true});
          await page.waitForTimeout(4500);
          body=await pageBody(page,50000);
          return {
            task:"bluetti_robust_entry",
            status:"free_spin_attempted",
            url:page.url(),
            result_lines:body.split(/\n+/).map(x=>cleanText(x,300)).filter(x=>/(congrat|won|prize|gift card|coupon|better luck|bucks)/i.test(x)).slice(0,25)
          };
        }catch{}
      }
    }
    return {
      task:"bluetti_robust_entry",
      status:"lucky_draw_present_but_control_not_exposed",
      url:page.url(),
      snippets:body.split(/\n+/).map(x=>cleanText(x,350)).filter(x=>/(Lucky Draw|spin|chance|prize)/i.test(x)).slice(0,30)
    };
  } finally { await page.close().catch(()=>{}); }
}

async function movaDirectEntryWithContext(context) {
  const page=await context.newPage();
  try {
    await gotoLoose(page,"https://us.mova.tech/pages/mova-prime-day-sale");
    let body=await pageBody(page,50000);
    const scopes=[page,...page.frames().filter(fr=>fr!==page.mainFrame())];

    let emailField=null, scope=null;
    for(const sc of scopes){
      const loc=sc.locator('input[type="email"],input[name*="email" i],input[placeholder*="email" i]');
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,20);i++){
        const el=loc.nth(i);
        if(await el.isVisible().catch(()=>false)){emailField=el;scope=sc;break;}
      }
      if(emailField) break;
    }

    if(!emailField){
      const texts=page.getByText(/Prize Wheel|Free Entry|Exclusive Event|Spin/i,{exact:false});
      const n=await texts.count().catch(()=>0);
      for(let i=0;i<Math.min(n,30);i++){
        const el=texts.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        try{await el.scrollIntoViewIfNeeded().catch(()=>{});await el.click({timeout:2200,force:true}).catch(()=>{});await page.waitForTimeout(800);}catch{}
      }
      for(const sc of [page,...page.frames().filter(fr=>fr!==page.mainFrame())]){
        const loc=sc.locator('input[type="email"],input[name*="email" i],input[placeholder*="email" i]');
        const n2=await loc.count().catch(()=>0);
        for(let j=0;j<Math.min(n2,20);j++){
          const el=loc.nth(j);
          if(await el.isVisible().catch(()=>false)){emailField=el;scope=sc;break;}
        }
        if(emailField) break;
      }
    }

    if(!emailField){
      const frameUrls=page.frames().map(fr=>fr.url()).filter(Boolean);
      return {
        task:"mova_direct_entry",
        status:"official_free_entry_widget_not_exposed",
        url:page.url(),
        frame_urls:frameUrls.filter(u=>/mova|promo|spin|draw|wheel|widget|app/i.test(u)).slice(0,40),
        need:"No user data needed; handler needs the live widget endpoint or it must be exposed by MOVA"
      };
    }

    await emailField.fill("jlc3718@gmail.com");
    const submits=scope.locator('button,input[type="submit"],[role="button"]');
    const scount=await submits.count().catch(()=>0);
    let submitted=false;
    for(let i=0;i<Math.min(scount,50);i++){
      const el=submits.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const label=cleanText((await el.innerText().catch(()=>''))||(await el.getAttribute("value").catch(()=>'')),150);
      if(!/(submit|enter|continue|spin|start|play)/i.test(label)) continue;
      if(/newsletter|purchase|buy|checkout|pay|redeem/i.test(label)) continue;
      try{await el.click({timeout:3000});submitted=true;break;}catch{}
    }
    if(!submitted) return {task:"mova_direct_entry",status:"email_form_found_submit_not_found",url:page.url()};

    await page.waitForTimeout(1600);
    for(const sc of [page,...page.frames().filter(fr=>fr!==page.mainFrame())]){
      const spin=sc.locator('button,[role="button"],a,div,span').filter({hasText:/^(Spin|Spin Now|Start|Play|Go|Try Now)$/i});
      const n=await spin.count().catch(()=>0);
      for(let i=0;i<Math.min(n,50);i++){
        const el=spin.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        const parent=cleanText(await el.locator("xpath=..").innerText().catch(()=>""),900);
        if(/purchase|buy|pay|redeem/i.test(parent)) continue;
        try{
          await el.click({timeout:3000,force:true});
          await page.waitForTimeout(4500);
          body=await pageBody(page,50000);
          return {
            task:"mova_direct_entry",
            status:"spin_attempted",
            url:page.url(),
            result_lines:body.split(/\n+/).map(x=>cleanText(x,320)).filter(x=>/(congrat|won|prize|coupon|V50|P10|better luck|\$10|\$20|\$100|\$300|30%)/i.test(x)).slice(0,30)
          };
        }catch{}
      }
    }
    return {task:"mova_direct_entry",status:"entry_submitted_spin_control_not_found",url:page.url()};
  } finally { await page.close().catch(()=>{}); }
}

async function reolinkDayEntryWithContext(context) {
  const page=await context.newPage();
  try {
    await gotoLoose(page,"https://reolink.com/__/lp/reolink-day/");
    const scopes=[page,...page.frames().filter(fr=>fr!==page.mainFrame())];
    let email=null, scope=null;
    for(const sc of scopes){
      const loc=sc.locator('input[type="email"],input[name*="email" i],input[placeholder*="email" i]');
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,20);i++){
        const el=loc.nth(i);
        if(await el.isVisible().catch(()=>false)){email=el;scope=sc;break;}
      }
      if(email) break;
    }
    if(!email) return {task:"reolink_day_entry",status:"email_field_not_found",url:page.url()};
    await email.fill("jlc3718@gmail.com");
    const btns=scope.locator('button,input[type="submit"],[role="button"]');
    const n=await btns.count().catch(()=>0);
    for(let i=0;i<Math.min(n,40);i++){
      const b=btns.nth(i);
      if(!(await b.isVisible().catch(()=>false))) continue;
      const label=cleanText((await b.innerText().catch(()=>''))||(await b.getAttribute("value").catch(()=>'')),150);
      if(!/(subscribe|enter|sign up|submit|join)/i.test(label)) continue;
      try{
        await b.click({timeout:3000});
        await page.waitForTimeout(2500);
        const body=await pageBody(page,30000);
        return {
          task:"reolink_day_entry",
          status:/(thank|success|subscribed|you're in|you are in|already subscribed)/i.test(body)?"submitted_or_already_subscribed":"submitted_unconfirmed",
          url:page.url(),
          confirmation:body.match(/.{0,100}(thank|success|subscribed|already subscribed|you're in|you are in).{0,180}/i)?.[0]||null
        };
      }catch{}
    }
    return {task:"reolink_day_entry",status:"submit_control_not_found",url:page.url()};
  } finally { await page.close().catch(()=>{}); }
}

async function taskWithContext(context, task) {
  if (task === "jml_scan") return await jmlScanWithContext(context);
  if (task === "roborock_spin") return await roborockSpinWithContext(context);
  if (task === "reolink_subscribe") return await reolinkSubscribeWithContext(context);
  if (task === "eufy_lucky") return await eufyLuckyWithContext(context);
  if (task === "bluetti_lucky") return await bluettiLuckyWithContext(context);
  if (task === "wyze_survey") return await wyzeSurveyProbeWithContext(context);
  if (["roborock_diag","eufy_diag","bluetti_diag","mova_diag"].includes(task)) return await diagnosticsWithContext(context, task);
  if (task === "eufy_login_and_spin") return await eufyLoginAndSpinWithContext(context);
  if (task === "instagram_diag") return await instagramDiagWithContext(context);
  if (task === "roborock_google_login_and_spin") return await roborockGoogleLoginAndSpinWithContext(context);
  if (task === "roborock_wheel_diag") return await roborockWheelDiagWithContext(context);
  if (task === "instagram_brand_scan") return await instagramBrandScanWithContext(context);
  if (task === "mova_prize_wheel") return await movaPrizeWheelWithContext(context);
  if (task === "housework_challenge") return await houseworkChallengeEntryWithContext(context);
  if (task === "dreame_aero_giveaway") return await dreameAeroGiveawayWithContext(context);
  if (task === "dreame_entry_path") return await dreameEntryPathWithContext(context);
  if (task === "eufy_deep_entry") return await eufyDeepEntryWithContext(context);
  if (task === "bluetti_robust_entry") return await bluettiRobustEntryWithContext(context);
  if (task === "mova_direct_entry") return await movaDirectEntryWithContext(context);
  if (task === "reolink_day_entry") return await reolinkDayEntryWithContext(context);
  throw new Error("Unsupported context task: " + task);
}

async function runTask(job) {
  const task = String(job.task || "");
  if (task === "health") return { task: "health", ok: true, time: new Date().toISOString() };
  if (task === "vault_init") return initSecureVault();
  if (task === "vault_store") return storeEncryptedEntryProfile(job);
  if (task === "login_start") return await startLogin(job);
  if (task === "login_stop") return await stopLogin();
  if (task === "jml_scan") return await jmlScan();
  if (task === "roborock_spin") return await roborockSpin();
  if (task === "reolink_subscribe" || task === "eufy_lucky" || task === "bluetti_lucky" || task === "wyze_survey" || task === "eufy_login_and_spin" || task === "instagram_diag" || task === "roborock_google_login_and_spin" || task === "roborock_wheel_diag" || task === "instagram_brand_scan" || task === "mova_prize_wheel" || task === "housework_challenge" || task === "dreame_aero_giveaway" || task === "dreame_entry_path" || task === "eufy_deep_entry" || task === "bluetti_robust_entry" || task === "mova_direct_entry" || task === "reolink_day_entry" || ["roborock_diag","eufy_diag","bluetti_diag","mova_diag"].includes(task)) {
    if (loginState.browser || loginState.tunnel) return { task, status:"manual_login_session_active" };
    const context = await launchProfile("daily");
    try { return await taskWithContext(context, task); }
    finally { await context.close().catch(() => {}); }
  }
  if (task === "batch") {
    if (loginState.browser || loginState.tunnel) return { task:"batch", status:"manual_login_session_active", parallel:false };
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];
    const allowed = tasks.filter(t => ["jml_scan", "roborock_spin", "reolink_subscribe", "eufy_lucky", "bluetti_lucky", "wyze_survey", "roborock_diag", "eufy_diag", "bluetti_diag", "mova_diag", "eufy_login_and_spin", "instagram_diag", "roborock_google_login_and_spin", "roborock_wheel_diag", "instagram_brand_scan", "mova_prize_wheel", "housework_challenge", "dreame_aero_giveaway", "dreame_entry_path", "eufy_deep_entry", "bluetti_robust_entry", "mova_direct_entry", "reolink_day_entry"].includes(String(t)));
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
