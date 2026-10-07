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
const LOGIN_DISPLAY = process.env.LOGIN_DISPLAY || ":100";

fs.mkdirSync(path.join(DATA_DIR, "profiles"), { recursive: true });

let queue = Promise.resolve();
let loginState = { context: null, tunnel: null, profile: null, target: null, targets: [], url: null, activePage: 0 };
let dreameOtpState = { context:null, page:null, privateKey:null, started:null };

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


function activeLoginPage() {
  if (!loginState.context) return null;
  const pages = loginState.context.pages().filter(p => !p.isClosed());
  if (!pages.length) return null;
  if (loginState.activePage >= pages.length) loginState.activePage = pages.length - 1;
  return pages[Math.max(0, loginState.activePage)];
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => {
      data += c;
      if (data.length > 65536) reject(new Error("request too large"));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const CONTROL_HTML = String.raw`<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Oracle Browser</title>
<style>
  html,body{margin:0;background:#111;color:#fff;font-family:system-ui,sans-serif;height:100%;overflow:hidden}
  #top{height:48px;display:flex;align-items:center;gap:6px;padding:4px 6px;box-sizing:border-box;background:#1b1b1b;overflow-x:auto;white-space:nowrap}
  button{font-size:16px;min-height:38px;padding:6px 10px;border-radius:8px;border:0;background:#333;color:#fff}
  #screenWrap{position:absolute;top:48px;bottom:58px;left:0;right:0;overflow:auto;background:#222;touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch}
  #screen{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none;touch-action:pan-x pan-y;max-width:none}
  #bottom{position:absolute;bottom:0;left:0;right:0;height:58px;display:flex;gap:6px;padding:6px;box-sizing:border-box;background:#1b1b1b}
  #text{flex:1;font-size:17px;border-radius:8px;border:1px solid #555;padding:8px;background:#fff;color:#000;min-width:0}
  #status{font-size:12px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
</style>
</head>
<body>
<div id="top">
  <button onclick="cmd('/back')">←</button>
  <button onclick="cmd('/reload')">↻</button>
  <button onclick="scrollByRemote(-520)">↑</button>
  <button onclick="scrollByRemote(520)">↓</button>
  <button onclick="zoomOut()">−</button>
  <button onclick="zoomFit()">Fit</button>
  <button onclick="zoomIn()">＋</button>
  <button onclick="prevTab()">◀Tab</button>
  <button onclick="nextTab()">Tab▶</button>
  <span id="status">Connecting…</span>
</div>
<div id="screenWrap"><img id="screen" alt="Remote browser"></div>
<div id="bottom">
  <input id="text" autocomplete="off" autocapitalize="none" placeholder="Tap a field above, type here">
  <button onclick="sendText()">Type</button>
  <button onclick="sendKey('Enter')">Enter</button>
</div>
<script>
const img=document.getElementById('screen'), statusEl=document.getElementById('status'), text=document.getElementById('text');
let busy=false, tabIndex=0, tabCount=1, zoom=1;
async function post(path,obj={}){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}).then(r=>r.json()).catch(()=>({}));}
async function cmd(path){await post(path); refresh();}
async function sendKey(key){await post('/key',{key}); refresh();}
async function sendText(){if(!text.value)return; await post('/text',{text:text.value}); text.value=''; refresh();}
async function scrollByRemote(dy){await post('/scroll',{dy}); refresh();}
async function tabs(){
  const r=await fetch('/tabs',{cache:'no-store'}).then(r=>r.json()).catch(()=>({pages:[]}));
  tabCount=Math.max(1,(r.pages||[]).length); tabIndex=r.active||0;
  const p=(r.pages||[])[tabIndex]; if(p) statusEl.textContent=(tabIndex+1)+'/'+tabCount+' '+(p.title||p.url||'');
}
async function prevTab(){tabIndex=(tabIndex-1+tabCount)%tabCount;await post('/select-tab',{index:tabIndex});refresh();}
async function nextTab(){tabIndex=(tabIndex+1)%tabCount;await post('/select-tab',{index:tabIndex});refresh();}
function applyZoom(){img.style.width=(zoom*100)+'%';}
function zoomIn(){zoom=Math.min(3,zoom+0.25);applyZoom();}
function zoomOut(){zoom=Math.max(0.75,zoom-0.25);applyZoom();}
function zoomFit(){zoom=1;applyZoom();const w=document.getElementById('screenWrap');w.scrollLeft=0;w.scrollTop=0;}
async function clickAt(ev){
  ev.preventDefault();
  if(busy)return; busy=true;
  const rect=img.getBoundingClientRect();
  const pt=ev.touches?ev.touches[0]:ev;
  const x=(pt.clientX-rect.left)*(img.naturalWidth/rect.width);
  const y=(pt.clientY-rect.top)*(img.naturalHeight/rect.height);
  await post('/click',{x,y});
  busy=false; setTimeout(refresh,120);
}
img.addEventListener('click',clickAt,{passive:false});
function refresh(){img.src='/frame.jpg?t='+Date.now();}
img.onload=()=>tabs();
setInterval(refresh,850);
setInterval(tabs,2500);
refresh();
</script>
</body></html>`;

const loginProxy = http.createServer(async (req, res) => {
  if (!authOk(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Oracle Browser Login"' });
    res.end("Authentication required");
    return;
  }
  const u = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/control")) {
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
      res.end(CONTROL_HTML); return;
    }
    const page = activeLoginPage();
    if (!page && u.pathname !== "/tabs") {
      res.writeHead(503, {"Content-Type":"application/json"});
      res.end(JSON.stringify({ok:false,error:"No active browser page"})); return;
    }
    if (req.method === "GET" && u.pathname === "/frame.jpg") {
      const buf = await page.screenshot({type:"jpeg",quality:72});
      res.writeHead(200, {"Content-Type":"image/jpeg","Cache-Control":"no-store","Content-Length":buf.length});
      res.end(buf); return;
    }
    if (req.method === "GET" && u.pathname === "/tabs") {
      const pages = loginState.context ? loginState.context.pages().filter(p=>!p.isClosed()) : [];
      const out = [];
      for (const p of pages) out.push({title:await p.title().catch(()=>""),url:p.url()});
      res.writeHead(200, {"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({active:loginState.activePage,pages:out})); return;
    }
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (u.pathname === "/click") {
        await page.mouse.click(Number(body.x)||0, Number(body.y)||0);
      } else if (u.pathname === "/scroll") {
        await page.mouse.wheel(0, Number(body.dy)||0);
      } else if (u.pathname === "/key") {
        await page.keyboard.press(String(body.key||"Enter"));
      } else if (u.pathname === "/text") {
        await page.keyboard.insertText(String(body.text||""));
      } else if (u.pathname === "/back") {
        await page.goBack({waitUntil:"domcontentloaded",timeout:10000}).catch(()=>{});
      } else if (u.pathname === "/reload") {
        await page.reload({waitUntil:"domcontentloaded",timeout:10000}).catch(()=>{});
      } else if (u.pathname === "/select-tab") {
        const pages=loginState.context ? loginState.context.pages().filter(p=>!p.isClosed()) : [];
        const i=Math.max(0,Math.min(pages.length-1,Number(body.index)||0));
        loginState.activePage=i;
        if(pages[i]) await pages[i].bringToFront().catch(()=>{});
      } else {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, {"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({ok:true})); return;
    }
    res.writeHead(404); res.end();
  } catch (err) {
    res.writeHead(500, {"Content-Type":"application/json"});
    res.end(JSON.stringify({ok:false,error:String(err)}));
  }
});
loginProxy.listen(6081, "0.0.0.0");

function clearStaleChromiumProfileLocks(userDataDir) {
  for (const name of ["SingletonLock","SingletonCookie","SingletonSocket"]) {
    try { fs.unlinkSync(path.join(userDataDir, name)); } catch {}
  }
}

async function launchProfile(name) {
  const userDataDir = path.join(DATA_DIR, "profiles", safeProfile(name));
  fs.mkdirSync(userDataDir, { recursive: true });

  const launch = () => chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1024, height: 700 },
    timeout: 30000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  try {
    return await launch();
  } catch (err) {
    const msg=String(err && err.stack || err);
    if (!/profile appears to be in use|process_singleton|SingletonLock/i.test(msg)) throw err;
    clearStaleChromiumProfileLocks(userDataDir);
    await new Promise(r=>setTimeout(r,500));
    return await launch();
  }
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
  if (loginState.context) {
    try { await loginState.context.close(); } catch {}
  }
  loginState = { context: null, tunnel: null, profile: null, target: null, targets: [], url: null, activePage: 0 };
  await new Promise(r => setTimeout(r, 900));
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
  clearStaleChromiumProfileLocks(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 430, height: 760 },
    screen: { width: 430, height: 760 },
    env: { ...process.env, DISPLAY: LOGIN_DISPLAY },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--window-size=430,760"
    ]
  });
  const first = context.pages()[0] || await context.newPage();
  await goto(first, target).catch(()=>{});
  for (const extra of targets.slice(1)) {
    const p = await context.newPage();
    await goto(p, extra).catch(()=>{});
  }
  context.on("page", p => {
    const pages=context.pages().filter(x=>!x.isClosed());
    loginState.activePage=Math.max(0,pages.indexOf(p));
  });

  const tunnel = spawn("/usr/local/bin/cloudflared", [
    "tunnel", "--url", "http://127.0.0.1:6081", "--no-autoupdate"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  loginState = { context, tunnel, profile, target, targets, url: null, activePage: 0 };

  const url = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Timed out starting temporary login tunnel")), 25000);
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m) {
        clearTimeout(timer);
        resolve(m[0] + "/control");
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
  if (loginState.context) return { task: "jml_scan", status: "login_session_active" };
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
  if (loginState.context) return { task: "roborock_spin", status: "login_session_active" };
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
    fields: required
  };
}


function patchEncryptedEntryProfile(job) {
  const p = ensureVaultKeypair();
  if (!fs.existsSync(p.profile)) throw new Error("Secure entry profile is not stored");
  const ciphertext = Buffer.from(String(job.ciphertext_b64 || ""), "base64");
  if (!ciphertext.length) throw new Error("Missing ciphertext_b64");
  const privateKey = fs.readFileSync(p.privateKey, "utf8");
  const plaintext = crypto.privateDecrypt({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  }, ciphertext);
  const patch = JSON.parse(plaintext.toString("utf8"));
  const allowed = ["phone"];
  const current = JSON.parse(fs.readFileSync(p.profile, "utf8"));
  const updated = [];
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k) && String(patch[k] || "").trim()) {
      current[k] = String(patch[k]).trim();
      updated.push(k);
    }
  }
  if (!updated.length) throw new Error("No supported profile fields supplied");
  fs.writeFileSync(p.profile, JSON.stringify(current), { mode: 0o600 });
  return { task:"vault_patch", status:"stored", fields:updated };
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
    await gotoLoose(page, "https://us.mova.tech/pages/mova-prime-day-sale");
    await page.addScriptTag({url:"https://ext.spinwheelapp.com/external/v1/7bdb4ac5233e8720/spps.js?shop=mova-us.myshopify.com"}).catch(()=>{});
    await page.waitForTimeout(9000);

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
      const c=sc.locator('input[type="email"],input:not([type="checkbox"]):not([type="radio"])[name*="email" i],input:not([type="checkbox"]):not([type="radio"])[placeholder*="email" i],input[autocomplete="email"]');
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
          const c=sc.locator('input[type="email"],input:not([type="checkbox"]):not([type="radio"])[name*="email" i],input:not([type="checkbox"]):not([type="radio"])[placeholder*="email" i],input[autocomplete="email"]');
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
    const url="https://us.forum.dreametech.com/forum.php?mod=viewthread&tid=11245&back=index&pa=1&mobile=2#reply";
    await gotoLoose(page,url);
    await page.waitForTimeout(1800);
    let body=await pageBody(page,35000);

    const entryText="The Dreame Aero Wet Dry Vacuum is on my fall wishlist. I already use Dreame robot cleaning at home, and a wet/dry vacuum would make quick cleanup of tracked-in dirt and spills much easier without pulling out a separate vacuum and mop.";

    // Avoid duplicate post if it is already present.
    if(body.includes("The Dreame Aero Wet Dry Vacuum is on my fall wishlist")){
      return {task:"dreame_entry_path",status:"already_submitted",url:page.url()};
    }

    const editors=page.locator(
      'textarea[name="message"],textarea[id*="message"],textarea[name*="message"],textarea[name*="reply"],textarea,[contenteditable="true"]'
    );
    const ec=await editors.count().catch(()=>0);
    let editor=null;
    for(let i=0;i<Math.min(ec,30);i++){
      const e=editors.nth(i);
      if(await e.isVisible().catch(()=>false)){editor=e;break;}
    }

    if(!editor){
      return {
        task:"dreame_entry_path",
        status:/log in|sign in|login/i.test(body)?"login_required":"reply_editor_not_available",
        url:page.url(),
        need:/log in|sign in|login/i.test(body)?"Dreame login":"Dreame reply form not exposed"
      };
    }

    const tag=await editor.evaluate(e=>e.tagName).catch(()=>"");
    if(tag==="TEXTAREA"||tag==="INPUT") await editor.fill(entryText);
    else await editor.fill(entryText).catch(async()=>{await editor.click();await page.keyboard.type(entryText);});

    let submitted=false;
    let method=null;

    const selectors=[
      'button[name="replysubmit"]',
      'input[name="replysubmit"]',
      '#postsubmit',
      'button[id*="postsubmit"]',
      'input[id*="postsubmit"]',
      'button[type="submit"]',
      'input[type="submit"]',
      '[role="button"]'
    ];
    for(const sel of selectors){
      const loc=page.locator(sel);
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,25);i++){
        const b=loc.nth(i);
        if(!(await b.isVisible().catch(()=>false))) continue;
        const label=cleanText(
          (await b.innerText().catch(()=>''))+" "+
          (await b.getAttribute("value").catch(()=>''))+" "+
          (await b.getAttribute("name").catch(()=>''))+" "+
          (await b.getAttribute("id").catch(()=>''))
        ,180);
        if(sel==='[role="button"]' && !/(reply|post|submit)/i.test(label)) continue;
        try{await b.click({timeout:3500});submitted=true;method=sel;break;}catch{}
      }
      if(submitted) break;
    }

    // Last resort: submit the form containing the editor itself.
    if(!submitted){
      const form=editor.locator("xpath=ancestor::form[1]");
      if(await form.count().catch(()=>0)){
        try{
          await form.evaluate(f=>{
            if(typeof f.requestSubmit==="function") f.requestSubmit();
            else f.submit();
          });
          submitted=true;
          method="form.requestSubmit";
        }catch{}
      }
    }

    if(!submitted){
      const forms=await page.locator("form").evaluateAll(fs=>fs.map((f,i)=>({
        i,action:f.action,method:f.method,id:f.id,name:f.getAttribute("name")||"",
        text:(f.innerText||"").replace(/\s+/g," ").trim().slice(0,1200)
      })).filter(x=>/reply|post|message|submit/i.test(x.action+" "+x.id+" "+x.name+" "+x.text)).slice(0,20)).catch(()=>[]);
      return {task:"dreame_entry_path",status:"submit_control_not_found",url:page.url(),forms};
    }

    await page.waitForTimeout(3500);
    body=await pageBody(page,40000);
    const ok=body.includes("The Dreame Aero Wet Dry Vacuum is on my fall wishlist");
    const loginReturned=/log in|sign in/i.test(body) && !/home\.php\?mod=space&uid=/i.test(body);
    return {
      task:"dreame_entry_path",
      status:ok?"submitted":(loginReturned?"login_lost_after_submit":"submitted_unconfirmed"),
      url:page.url(),
      submit_method:method
    };
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
      const loc=sc.locator('input[type="email"],input:not([type="checkbox"]):not([type="radio"])[name*="email" i],input:not([type="checkbox"]):not([type="radio"])[placeholder*="email" i]');
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
        const loc=sc.locator('input[type="email"],input:not([type="checkbox"]):not([type="radio"])[name*="email" i],input:not([type="checkbox"]):not([type="radio"])[placeholder*="email" i]');
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
      const loc=sc.locator('input[type="email"],input:not([type="checkbox"]):not([type="radio"])[name*="email" i],input:not([type="checkbox"]):not([type="radio"])[placeholder*="email" i]');
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

async function dreameAuthDiagWithContext(context) {
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://us.forum.dreametech.com/member.php?mod=logging&action=login");
    await page.waitForTimeout(1800);
    const body=await pageBody(page,30000);
    const inputs=await page.locator('input,select,textarea').evaluateAll(els=>els.map((e,i)=>({
      i,tag:e.tagName,type:e.getAttribute('type')||'',name:e.getAttribute('name')||'',
      id:e.id||'',placeholder:e.getAttribute('placeholder')||'',autocomplete:e.getAttribute('autocomplete')||'',
      value:(e.value||'').slice(0,120),visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)
    })).filter(x=>x.visible).slice(0,80)).catch(()=>[]);
    const controls=await page.locator('button,a,[role="button"],input[type="submit"],input[type="button"]').evaluateAll(els=>els.map((e,i)=>({
      i,tag:e.tagName,text:(e.innerText||e.textContent||e.value||'').replace(/\s+/g,' ').trim().slice(0,220),
      href:e.getAttribute('href')||'',id:e.id||'',cls:(typeof e.className==='string'?e.className:'')||'',
      visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)
    })).filter(x=>x.visible && (x.text||x.href)).slice(0,120)).catch(()=>[]);
    const forms=await page.locator('form').evaluateAll(els=>els.map((e,i)=>({
      i,action:e.action||'',method:e.method||'',id:e.id||'',name:e.getAttribute('name')||'',
      text:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,900)
    })).slice(0,30)).catch(()=>[]);
    return {
      task:"dreame_auth_diag",
      url:page.url(),
      title:await page.title().catch(()=>""),
      snippets:body.split(/\n+/).map(x=>cleanText(x,400)).filter(x=>/(login|log in|register|google|facebook|apple|email|password|verification|captcha)/i.test(x)).slice(0,50),
      inputs,controls,forms
    };
  } finally { await page.close().catch(()=>{}); }
}

async function promoPlumbingDiagWithContext(context, task) {
  const urls={
    eufy_plumbing_diag:"https://www.eufy.com/app_primeday",
    bluetti_plumbing_diag:"https://www.bluettipower.com/pages/prime-day/",
    mova_plumbing_diag:"https://us.mova.tech/pages/mova-prime-day-sale"
  };
  const url=urls[task];
  if(!url) throw new Error("Unknown plumbing task");
  const page=await context.newPage();
  const captured=[];
  const onResponse=async(resp)=>{
    try{
      const u=resp.url();
      if(/lucky|spin|wheel|draw|prize|promo|campaign|reward|raffle|sweep|lottery/i.test(u)){
        captured.push({url:u,status:resp.status(),type:resp.request().resourceType()});
      }
    }catch{}
  };
  page.on("response",onResponse);
  try{
    await gotoLoose(page,url);
    await page.waitForTimeout(4500);
    const body=await pageBody(page,60000);
    const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name)).catch(()=>[]);
    const scripts=await page.locator('script[src]').evaluateAll(els=>els.map(e=>e.src).filter(Boolean)).catch(()=>[]);
    const forms=await page.locator('form').evaluateAll(els=>els.map((e,i)=>({
      i,action:e.action||'',method:e.method||'',id:e.id||'',cls:(typeof e.className==='string'?e.className:'')||'',
      text:(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,1200)
    })).filter(x=>/(lucky|spin|wheel|draw|prize|promo|campaign|email|entry)/i.test(x.text+x.action+x.id+x.cls)).slice(0,30)).catch(()=>[]);
    const promoElements=await page.evaluate(()=>{
      const re=/(lucky|spin|wheel|draw|prize|100%\s*chance|entries left|free entry|exclusive event)/i;
      const out=[];
      for(const e of document.querySelectorAll('body *')){
        const attrs=[e.id,e.className, ...[...e.attributes||[]].map(a=>a.name+'='+a.value)].join(' ');
        const txt=(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim();
        if(!re.test(attrs+' '+txt)) continue;
        const r=e.getBoundingClientRect();
        out.push({
          tag:e.tagName,id:e.id||'',cls:typeof e.className==='string'?e.className:'',
          visible:r.width>0&&r.height>0,
          text:txt.slice(0,900),
          html:e.outerHTML.slice(0,3500)
        });
        if(out.length>=80) break;
      }
      return out;
    }).catch(()=>[]);
    const html=await page.content().catch(()=>"");
    const htmlHits=[];
    const re=/(lucky|spin|wheel|draw|prize|100%\s*chance|entries left|free entry|exclusive event)/ig;
    let m;
    while((m=re.exec(html)) && htmlHits.length<30){
      htmlHits.push(html.slice(Math.max(0,m.index-500),Math.min(html.length,m.index+1200)).replace(/\s+/g,' '));
      re.lastIndex=m.index+Math.max(1,m[0].length);
    }
    return {
      task,
      url:page.url(),
      title:await page.title().catch(()=>""),
      snippets:body.split(/\n+/).map(x=>cleanText(x,450)).filter(x=>/(lucky|spin|wheel|draw|prize|100% Chance|entries left|free entry|exclusive event)/i.test(x)).slice(0,50),
      captured_responses:[...new Map(captured.map(x=>[x.url,x])).values()].slice(0,80),
      resource_urls:resources.filter(u=>/lucky|spin|wheel|draw|prize|promo|campaign|reward|raffle|sweep|lottery/i.test(u)).slice(0,120),
      script_urls:scripts.filter(u=>/promo|campaign|reward|lucky|spin|wheel|draw|app|widget/i.test(u)).slice(0,100),
      forms,promo_elements:promoElements,html_hits:htmlHits
    };
  } finally {
    page.off("response",onResponse);
    await page.close().catch(()=>{});
  }
}

async function stopDreameOtpState() {
  try { if (dreameOtpState.page && !dreameOtpState.page.isClosed()) await dreameOtpState.page.close().catch(()=>{}); } catch {}
  try { if (dreameOtpState.context) await dreameOtpState.context.close().catch(()=>{}); } catch {}
  dreameOtpState={context:null,page:null,privateKey:null,started:null};
}

async function dreameOtpStart() {
  await stopDreameOtpState();
  if (loginState.context || loginState.tunnel) return {task:"dreame_otp_start",status:"manual_login_session_active"};

  const context=await launchProfile("daily");
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://us-account.dreame.tech/login?lang=en&country=US&client_id=eu_discover_web&tenantId=000000&redirect_url=https%3A%2F%2Fus.forum.dreametech.com%2Fapi%2Fdreame%2Fcallback.php");
    await page.waitForTimeout(1200);

    let codeTab=page.getByRole("button",{name:/Code Login/i}).first();
    if(!(await codeTab.count().catch(()=>0))){
      codeTab=page.getByText(/^Code Login$/i,{exact:true}).first();
    }
    if(await codeTab.count().catch(()=>0)) await codeTab.click({timeout:3000});
    await page.waitForTimeout(900);

    const allInputs=page.locator('input');
    const ic=await allInputs.count().catch(()=>0);
    let email=null;
    for(let i=0;i<Math.min(ic,20);i++){
      const el=allInputs.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const ph=String(await el.getAttribute("placeholder").catch(()=>null)||"");
      const type=String(await el.getAttribute("type").catch(()=>null)||"");
      if(/email|dreame id/i.test(ph) || type==="email"){email=el;break;}
    }
    if(!email) throw new Error("Dreame code-login email field not found");
    await email.fill("jlc3718@gmail.com");

    const checks=page.locator('input[type="checkbox"],[role="checkbox"]');
    const cc=await checks.count().catch(()=>0);
    for(let i=0;i<Math.min(cc,8);i++){
      const c=checks.nth(i);
      if(!(await c.isVisible().catch(()=>false))) continue;
      const checked=await c.isChecked().catch(()=>false);
      if(!checked) await c.check().catch(async()=>{await c.click().catch(()=>{});});
    }

    let sent=false, sentLabel=null;
    const exactCode=page.getByText(/^Get Verification Code$/i,{exact:true});
    const exactCount=await exactCode.count().catch(()=>0);
    for(let i=0;i<Math.min(exactCount,10);i++){
      const b=exactCode.nth(i);
      if(!(await b.isVisible().catch(()=>false))) continue;
      try { await b.click({timeout:3000}); sent=true; sentLabel="Get Verification Code"; break; } catch {}
    }
    if(!sent){
      const controls=page.locator('button,[role="button"],a,span');
      const n=await controls.count().catch(()=>0);
      for(let i=0;i<Math.min(n,120);i++){
        const b=controls.nth(i);
        if(!(await b.isVisible().catch(()=>false))) continue;
        const label=cleanText(await b.innerText().catch(()=>""),160);
        if(!/^(Get Verification Code|Send Code|Get Code|Send Verification Code)$/i.test(label)) continue;
        try { await b.click({timeout:3000}); sent=true; sentLabel=label; break; } catch {}
      }
    }
    if(!sent){
      const body=await pageBody(page,20000);
      await page.close().catch(()=>{});
      await context.close().catch(()=>{});
      return {task:"dreame_otp_start",status:"send_code_control_not_found",url:page.url(),snippets:body.split(/\n+/).filter(x=>/code|email|verification/i.test(x)).slice(0,20)};
    }

    await page.waitForTimeout(1200);

    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa",{
      modulusLength:2048,
      publicKeyEncoding:{type:"spki",format:"pem"},
      privateKeyEncoding:{type:"pkcs8",format:"pem"}
    });
    dreameOtpState={context,page,privateKey,started:Date.now()};

    return {
      task:"dreame_otp_start",
      status:"code_requested",
      sent_control:sentLabel,
      public_key_pem:publicKey,
      expires_seconds:300
    };
  } catch(err){
    await page.close().catch(()=>{});
    await context.close().catch(()=>{});
    throw err;
  }
}

async function dreameOtpFinish(job) {
  if(!dreameOtpState.context || !dreameOtpState.page || !dreameOtpState.privateKey){
    return {task:"dreame_otp_finish",status:"no_active_otp_session"};
  }
  if(Date.now()-Number(dreameOtpState.started||0)>300000){
    await stopDreameOtpState();
    return {task:"dreame_otp_finish",status:"otp_session_expired"};
  }

  const cipher=Buffer.from(String(job.ciphertext_b64||""),"base64");
  if(!cipher.length) return {task:"dreame_otp_finish",status:"missing_ciphertext"};
  const plain=crypto.privateDecrypt({
    key:dreameOtpState.privateKey,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:"sha256"
  },cipher).toString("utf8");
  const payload=JSON.parse(plain);
  const code=String(payload.code||"").replace(/\D/g,"");
  if(code.length<4 || code.length>10) return {task:"dreame_otp_finish",status:"invalid_code_shape"};

  const page=dreameOtpState.page;
  const context=dreameOtpState.context;
  try{
    const inputs=page.locator('input');
    const n=await inputs.count().catch(()=>0);
    let codeInput=null;
    for(let i=0;i<Math.min(n,20);i++){
      const el=inputs.nth(i);
      if(!(await el.isVisible().catch(()=>false))) continue;
      const ph=String(await el.getAttribute("placeholder").catch(()=>null)||"");
      const type=String(await el.getAttribute("type").catch(()=>null)||"");
      if(/code|verification|otp/i.test(ph) || type==="number" || type==="tel"){codeInput=el;break;}
    }
    if(!codeInput){
      const body=await pageBody(page,20000);
      return {task:"dreame_otp_finish",status:"code_input_not_found",snippets:body.split(/\n+/).filter(x=>/code|verification|email/i.test(x)).slice(0,20)};
    }
    await codeInput.fill(code);

    const buttons=page.locator('button,[role="button"]');
    const bc=await buttons.count().catch(()=>0);
    let clicked=false;
    for(let i=0;i<Math.min(bc,30);i++){
      const b=buttons.nth(i);
      if(!(await b.isVisible().catch(()=>false))) continue;
      const label=cleanText(await b.innerText().catch(()=>""),120);
      if(!/^(Log In|Login|Sign In|Continue)$/i.test(label)) continue;
      try{await b.click({timeout:3500});clicked=true;break;}catch{}
    }
    if(!clicked) return {task:"dreame_otp_finish",status:"login_submit_not_found"};

    await page.waitForTimeout(4000);
    const body=await pageBody(page,25000);
    if(/invalid|incorrect|expired|try again/i.test(body) && /code/i.test(body)){
      return {task:"dreame_otp_finish",status:"code_rejected",url:page.url()};
    }

    const entry=await dreameEntryPathWithContext(context);
    return {task:"dreame_otp_finish",status:"login_completed",entry};
  } finally {
    await stopDreameOtpState();
  }
}

async function finishDiagWithContext(context, task) {
  if(task==="dreame_forum_diag"){
    const page=await context.newPage();
    try{
      await gotoLoose(page,"https://us.forum.dreametech.com/forum.php?mod=viewthread&tid=11245");
      await page.waitForTimeout(1800);
      const body=await pageBody(page,30000);
      const editorData=await page.locator('textarea,[contenteditable="true"]').evaluateAll(els=>els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        let p=e, ancestors=[];
        for(let j=0;j<5&&p;j++,p=p.parentElement){
          ancestors.push({tag:p.tagName,id:p.id||"",cls:typeof p.className==="string"?p.className:"",
            text:(p.innerText||p.textContent||"").replace(/\s+/g," ").trim().slice(0,1800),
            html:p.outerHTML.slice(0,5000)});
        }
        return {i,tag:e.tagName,id:e.id||"",name:e.getAttribute("name")||"",cls:typeof e.className==="string"?e.className:"",
          visible:r.width>0&&r.height>0,ancestors};
      }).filter(x=>x.visible).slice(0,20)).catch(()=>[]);
      const controls=await page.locator('button,input,a,[role="button"],div[onclick],span[onclick]').evaluateAll(els=>els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        const text=(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,300);
        return {i,tag:e.tagName,type:e.getAttribute("type")||"",name:e.getAttribute("name")||"",id:e.id||"",
          cls:typeof e.className==="string"?e.className:"",text,onclick:e.getAttribute("onclick")||"",
          href:e.getAttribute("href")||"",visible:r.width>0&&r.height>0};
      }).filter(x=>x.visible && (x.text||x.onclick||x.type==="submit")).slice(0,250)).catch(()=>[]);
      const forms=await page.locator('form').evaluateAll(els=>els.map((e,i)=>({
        i,id:e.id||"",name:e.getAttribute("name")||"",action:e.action||"",method:e.method||"",
        text:(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,1800),
        html:e.outerHTML.slice(0,7000)
      })).filter(x=>/reply|post|message|submit|comment/i.test(x.text+x.id+x.name+x.action)).slice(0,20)).catch(()=>[]);
      return {task,url:page.url(),title:await page.title().catch(()=>""),authenticated:!/us-account\.dreame\.tech\/login/i.test(page.url()),
        snippets:body.split(/\n+/).map(x=>cleanText(x,350)).filter(x=>/reply|post|comment|message|login/i.test(x)).slice(0,40),
        editor_data:editorData,controls,forms};
    } finally {await page.close().catch(()=>{});}
  }

  if(task==="eufy_alt_draw_diag"){
    const page=await context.newPage();
    try{
      await gotoLoose(page,"https://www.eufy.com/landingpage_app_test");
      await page.waitForTimeout(3000);
      const body=await pageBody(page,45000);
      const controls=await page.locator('button,a,[role="button"],div,span').evaluateAll(els=>els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        const text=(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,400);
        return {i,tag:e.tagName,id:e.id||"",cls:typeof e.className==="string"?e.className:"",text,
          visible:r.width>0&&r.height>0};
      }).filter(x=>x.visible && /(GO|Spin|Draw|Lucky|Chance|Redeem|Entries Left|eufyCredits)/i.test(x.text)).slice(0,120)).catch(()=>[]);
      return {task,url:page.url(),title:await page.title().catch(()=>""),snippets:body.split(/\n+/).map(x=>cleanText(x,450))
        .filter(x=>/(100% Chance|Lucky Draw|GO|Spin|Entries Left|eufyCredits|Cam S4|Robot Vacuum E25|Outdoor Lights)/i.test(x)).slice(0,60),
        controls};
    }finally{await page.close().catch(()=>{});}
  }

  if(task==="promo_script_diag"){
    const req=context.request;
    const targets=[
      {name:"mova_spinwheel",url:"https://ext.spinwheelapp.com/external/v1/7bdb4ac5233e8720/spps.js?shop=mova-us.myshopify.com"},
      {name:"mova_tada",url:"https://cdn.trytadapp.com/loader.js?shop=mova-us.myshopify.com"},
      {name:"bluetti_wheel",url:"https://checkout.bluettipower.com/cdn/shop/t/255/assets/bluetti.bluetti-wheel.CiUULCTI.min.js"},
      {name:"bluetti_actions",url:"https://checkout.bluettipower.com/cdn/shop/t/255/assets/bluetti.bluetti-wheel-actions.D466ZcGa.min.js"},
      {name:"bluetti_template",url:"https://checkout.bluettipower.com/cdn/shop/t/255/assets/bluetti.wheel-template.CGwWaLsf.min.js"}
    ];
    const out=[];
    for(const t of targets){
      try{
        const resp=await req.get(t.url,{timeout:15000});
        const body=await resp.text();
        const urls=[...body.matchAll(/https?:\/\/[^"'\s)]+/g)].map(m=>m[0]).filter(u=>/api|spin|wheel|draw|lottery|prize|campaign|activity/i.test(u)).slice(0,80);
        const paths=[...body.matchAll(/["'](\/[^"']{2,220})["']/g)].map(m=>m[1]).filter(u=>/api|spin|wheel|draw|lottery|prize|campaign|activity/i.test(u)).slice(0,100);
        const snippets=[];
        const re=/(spin|wheel|draw|lottery|prize|campaign|activityapi|trytad|api\.)/ig;
        let m;
        while((m=re.exec(body)) && snippets.length<60){
          snippets.push(body.slice(Math.max(0,m.index-240),Math.min(body.length,m.index+650)).replace(/\s+/g," "));
          re.lastIndex=m.index+Math.max(1,m[0].length);
        }
        out.push({name:t.name,status:resp.status(),length:body.length,urls:[...new Set(urls)],paths:[...new Set(paths)],snippets});
      }catch(e){out.push({name:t.name,error:String(e)});}
    }
    return {task,assets:out};
  }

  if(task==="housework_diag"){
    const page=await context.newPage();
    try{
      await gotoLoose(page,"https://shop.housework.com/products/fall-cleaning-challenge-2026");
      await page.waitForTimeout(1400);
      const body=await pageBody(page,25000);
      const controls=await page.locator('button,a,input,[role="button"]').evaluateAll(els=>els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        return {i,tag:e.tagName,type:e.getAttribute("type")||"",name:e.getAttribute("name")||"",
          text:(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,300),
          href:e.getAttribute("href")||"",visible:r.width>0&&r.height>0};
      }).filter(x=>x.visible && /(download|add to cart|checkout|free|challenge|buy)/i.test(x.text+x.href)).slice(0,100)).catch(()=>[]);
      return {task,url:page.url(),snippets:body.split(/\n+/).map(x=>cleanText(x,400)).filter(x=>/(free|download|challenge|\$0|cart)/i.test(x)).slice(0,50),controls};
    }finally{await page.close().catch(()=>{});}
  }
  throw new Error("Unknown finish diag task");
}

async function eufyAltFreeSpinWithContext(context){
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://www.eufy.com/landingpage_app_test");
    const exact=page.getByRole("button",{name:/^GO$/i}).first();
    if(!(await exact.count().catch(()=>0))) return {task:"eufy_alt_free_spin",status:"go_control_not_found",url:page.url()};
    await exact.scrollIntoViewIfNeeded().catch(()=>{});
    await page.waitForTimeout(2500);

    const readState=async()=>{
      const body=await pageBody(page,45000);
      const entryRaw=body.match(/Entries Left:\s*([0-9-]+)/i)?.[1]||null;
      const credits=body.match(/EufyCredits:\s*([0-9-]+)/i)?.[1]||null;
      const prizeLines=body.split(/\n+/).map(x=>cleanText(x,320)).filter(x=>/(congrat|you won|prize|coupon|gift card|better luck|Cam S4|Robot Vacuum E25|Outdoor Lights E22|Month Plus)/i.test(x)).slice(0,30);
      return {body,entryRaw,credits,prizeLines};
    };

    let st=await readState();
    // The user-specific stats load lazily when the draw is brought into view.
    for(let i=0;i<8 && (!st.entryRaw || st.entryRaw==="-");i++){
      await page.waitForTimeout(1000);
      st=await readState();
    }

    // If still unloaded, one GO interaction initializes the widget without consuming credits.
    if(!st.entryRaw || st.entryRaw==="-"){
      await exact.click({timeout:3500,force:true});
      await page.waitForTimeout(4500);
      st=await readState();
    }

    const freeCount=/^\d+$/.test(String(st.entryRaw||""))?Number(st.entryRaw):null;
    if(freeCount===0) return {task:"eufy_alt_free_spin",status:"no_free_entries",entries_left:st.entryRaw,eufy_credits:st.credits,url:page.url()};
    if(freeCount===null) return {task:"eufy_alt_free_spin",status:"free_entry_state_unresolved",entries_left:st.entryRaw,eufy_credits:st.credits,url:page.url()};

    // Only the standalone GO button is clicked. Never touch "Redeem 200 eufyCredits".
    await exact.click({timeout:3500,force:true});
    await page.waitForTimeout(6000);
    const fin=await readState();
    return {
      task:"eufy_alt_free_spin",
      status:"free_spin_attempted",
      entries_left_before:freeCount,
      entries_left_after:fin.entryRaw,
      eufy_credits:fin.credits,
      url:page.url(),
      result_lines:fin.prizeLines
    };
  }finally{await page.close().catch(()=>{});}
}

async function bluettiWheelStateWithContext(context){
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://www.bluettipower.com/pages/prime-day/");
    await page.waitForTimeout(3500);
    const id="6ab35678be3169c2d7a45d38";
    const info=await page.evaluate(async(id)=>{
      const safe=async(u)=>{try{const r=await fetch(u,{credentials:"include"});return {status:r.status,json:await r.json()};}catch(e){return {error:String(e)}}};
      return {
        lottery:await safe("https://api.bluettipower.com/activityapi/lottery/getLotteryInfo/"+id),
        user:await safe("https://api.bluettipower.com/activityapi/admin/lottery/userInfoAggregation/"+id)
      };
    },id).catch(e=>({error:String(e)}));

    const wheel=await page.locator('bluetti-wheel').first().evaluate(e=>({
      attrs:Object.fromEntries([...e.attributes].map(a=>[a.name,a.value])),
      text:(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,3500)
    })).catch(()=>null);
    const btn=await page.locator('[start-lottery]').first().evaluate(e=>({
      tag:e.tagName,disabled:!!e.disabled,text:(e.innerText||e.textContent||"").replace(/\s+/g," ").trim().slice(0,300),
      attrs:Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]))
    })).catch(()=>null);

    const sanitize=(obj)=>{
      const j=obj?.json?.data ?? obj?.json ?? null;
      if(!j||typeof j!=="object") return {status:obj?.status||null,error:obj?.error||null};
      const keys=["status","consumptionType","limitUser","lotteryId","id","totalTimes","surplusTimes","todaySurplusTimes","isLimitDaily","isSubscribe","isNewUser","points","userConsumption","startTime","endTime","activityName","lotteryName"];
      const out={http_status:obj?.status||null};
      for(const k of keys) if(k in j) out[k]=j[k];
      if(j.lottery && typeof j.lottery==="object") for(const k of keys) if(k in j.lottery) out["lottery_"+k]=j.lottery[k];
      if(j.customer && typeof j.customer==="object") for(const k of keys) if(k in j.customer) out["customer_"+k]=j.customer[k];
      return out;
    };
    return {task:"bluetti_wheel_state",url:page.url(),lottery:sanitize(info.lottery),user:sanitize(info.user),wheel,button:btn};
  }finally{await page.close().catch(()=>{});}
}

async function movaRevealDiagWithContext(context){
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://us.mova.tech/pages/mova-prime-day-sale");
    await page.addScriptTag({url:"https://ext.spinwheelapp.com/external/v1/7bdb4ac5233e8720/spps.js?shop=mova-us.myshopify.com"}).catch(()=>{});
    await page.waitForTimeout(9000);
    const body=await pageBody(page,50000);
    const frames=page.frames().map(f=>({url:f.url(),name:f.name()})).filter(x=>/spin|wheel|promo|app|mova/i.test(x.url));
    const els=await page.locator('body *').evaluateAll(els=>{
      const re=/(spin|wheel|prize|enter|email|chance|coupon|win)/i,out=[];
      for(const e of els){
        const r=e.getBoundingClientRect(),txt=(e.innerText||e.textContent||"").replace(/\s+/g," ").trim();
        const attrs=[e.id,typeof e.className==="string"?e.className:"",...[...e.attributes].map(a=>a.name+"="+a.value)].join(" ");
        if(!(r.width>0&&r.height>0)||!re.test(txt+" "+attrs)) continue;
        out.push({tag:e.tagName,id:e.id||"",cls:typeof e.className==="string"?e.className:"",text:txt.slice(0,650),html:e.outerHTML.slice(0,2200)});
        if(out.length>=100) break;
      }
      return out;
    }).catch(()=>[]);
    return {task:"mova_reveal_diag",url:page.url(),frames,snippets:body.split(/\n+/).map(x=>cleanText(x,400)).filter(x=>/(spin|wheel|prize|enter|email|chance|coupon|win)/i.test(x)).slice(0,60),elements:els};
  }finally{await page.close().catch(()=>{});}
}

async function houseworkCheckoutProbeWithContext(context){
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://shop.housework.com/products/fall-cleaning-challenge-2026");
    await page.waitForTimeout(1000);
    const buy=page.getByRole("button",{name:/BUY IT NOW/i}).first();
    if(await buy.count().catch(()=>0)){
      await buy.click({timeout:4000}).catch(()=>{});
    }else{
      const add=page.getByRole("button",{name:/ADD TO CART/i}).first();
      if(await add.count().catch(()=>0)) await add.click({timeout:4000}).catch(()=>{});
      await page.waitForTimeout(800);
      await page.goto("https://shop.housework.com/cart",{waitUntil:"domcontentloaded",timeout:15000}).catch(()=>{});
      const co=page.getByRole("button",{name:/check out|checkout/i}).first();
      if(await co.count().catch(()=>0)) await co.click({timeout:4000}).catch(()=>{});
    }
    await page.waitForTimeout(2500);

    const email=page.locator('input[type="email"],input[autocomplete="email"]').first();
    if(await email.count().catch(()=>0)) await email.fill("jlc3718@gmail.com").catch(()=>{});
    const first=page.locator('input[autocomplete="given-name"],input[name*="first" i]').first();
    if(await first.count().catch(()=>0)) await first.fill("Jason").catch(()=>{});
    const last=page.locator('input[autocomplete="family-name"],input[name*="last" i]').first();
    if(await last.count().catch(()=>0)) await last.fill("Craumer").catch(()=>{});

    const fields=await page.locator('input,select,textarea').evaluateAll(els=>els.map((e,i)=>{
      const r=e.getBoundingClientRect();
      if(!(r.width>0&&r.height>0)) return null;
      return {i,tag:e.tagName,type:e.getAttribute("type")||"",name:e.getAttribute("name")||"",
        autocomplete:e.getAttribute("autocomplete")||"",placeholder:e.getAttribute("placeholder")||"",
        aria:e.getAttribute("aria-label")||"",required:!!e.required,value:(e.value||"").slice(0,100)};
    }).filter(Boolean).slice(0,100)).catch(()=>[]);
    const controls=await page.locator('button,[role="button"],input[type="submit"]').evaluateAll(els=>els.map((e,i)=>{
      const r=e.getBoundingClientRect();
      return {i,text:(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,220),
        disabled:!!e.disabled,visible:r.width>0&&r.height>0};
    }).filter(x=>x.visible).slice(0,80)).catch(()=>[]);
    const body=await pageBody(page,25000);
    return {task:"housework_checkout_probe",url:page.url(),
      snippets:body.split(/\n+/).map(x=>cleanText(x,350)).filter(x=>/(total|\$0|free|contact|delivery|shipping|payment|complete order|pay now|download|thank)/i.test(x)).slice(0,50),
      fields,controls};
  }finally{await page.close().catch(()=>{});}
}

async function reolinkConfirmedEntryWithContext(context){
  const page=await context.newPage();
  const captured=[];
  const onResp=async(resp)=>{
    try{
      const req=resp.request(),u=resp.url();
      if(req.method()!=="GET" || /subscribe|newsletter|email|reolink|contact|form/i.test(u)){
        if(req.method()!=="GET") {
          let txt="";
          try{txt=cleanText(await resp.text(),1200);}catch{}
          captured.push({method:req.method(),url:u,status:resp.status(),body:txt});
        }
      }
    }catch{}
  };
  page.on("response",onResp);
  try{
    await gotoLoose(page,"https://reolink.com/__/lp/reolink-day/");
    await page.waitForTimeout(1800);
    const scopes=[page,...page.frames().filter(f=>f!==page.mainFrame())];
    let email=null,scope=null;
    for(const sc of scopes){
      const loc=sc.locator('input[type="email"],input:not([type="checkbox"]):not([type="radio"])[name*="email" i],input:not([type="checkbox"]):not([type="radio"])[placeholder*="email" i]');
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,10);i++){
        const el=loc.nth(i);
        if(await el.isVisible().catch(()=>false)){email=el;scope=sc;break;}
      }
      if(email) break;
    }
    if(!email) return {task:"reolink_confirmed_entry",status:"email_field_not_found",url:page.url()};
    await email.fill("jlc3718@gmail.com");

    const checks=scope.locator('input[type="checkbox"],[role="checkbox"]');
    const cc=await checks.count().catch(()=>0);
    for(let i=0;i<Math.min(cc,10);i++){
      const c=checks.nth(i);
      if(!(await c.isVisible().catch(()=>false))) continue;
      if(!(await c.isChecked().catch(()=>false))) await c.check().catch(async()=>{await c.click().catch(()=>{});});
    }

    const submits=scope.locator('button,input[type="submit"],[role="button"]');
    const scount=await submits.count().catch(()=>0);
    let clicked=false;
    for(let i=0;i<Math.min(scount,40);i++){
      const b=submits.nth(i); if(!(await b.isVisible().catch(()=>false))) continue;
      const label=cleanText((await b.innerText().catch(()=>''))||(await b.getAttribute("value").catch(()=>'')),180);
      if(!/(subscribe|enter|sign up|join|submit)/i.test(label)) continue;
      try{await b.click({timeout:3500});clicked=true;break;}catch{}
    }
    if(!clicked) return {task:"reolink_confirmed_entry",status:"submit_control_not_found",url:page.url()};
    await page.waitForTimeout(3500);
    const texts=[];
    for(const sc of scopes) texts.push(cleanText(await sc.locator("body").innerText().catch(()=>""),12000));
    const body=texts.join(" ");
    const successText=body.match(/.{0,100}(thank|success|subscribed|already subscribed|entered|submission received).{0,180}/i)?.[0]||null;
    const goodResponse=captured.find(x=>x.status>=200&&x.status<300&&/(success|true|subscribed|ok|entered)/i.test(x.body||""));
    return {task:"reolink_confirmed_entry",status:goodResponse||successText?"confirmed":"submitted_unconfirmed",
      url:page.url(),confirmation:successText,response_confirmation:goodResponse||null,
      post_responses:captured.slice(0,20)};
  }finally{
    page.off("response",onResp);
    await page.close().catch(()=>{});
  }
}

async function bluettiSafeSpinWithContext(context){
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://www.bluettipower.com/pages/prime-day/");
    await page.waitForTimeout(3500);
    const id="6ab35678be3169c2d7a45d38";
    const raw=await page.evaluate(async(id)=>{
      const get=async u=>{try{const r=await fetch(u,{credentials:"include"});return await r.json()}catch(e){return {error:String(e)}}};
      return {
        lottery:await get("https://api.bluettipower.com/activityapi/lottery/getLotteryInfo/"+id),
        user:await get("https://api.bluettipower.com/activityapi/admin/lottery/userInfoAggregation/"+id)
      };
    },id).catch(e=>({error:String(e)}));

    const deepFind=(obj,key)=>{
      const seen=new Set();
      const walk=o=>{
        if(!o||typeof o!=="object"||seen.has(o)) return undefined;
        seen.add(o);
        if(Object.prototype.hasOwnProperty.call(o,key)) return o[key];
        for(const v of Object.values(o)){const r=walk(v);if(r!==undefined)return r;}
      };
      return walk(obj);
    };
    const consumptionType=Number(deepFind(raw.lottery,"consumptionType") ?? deepFind(raw.user,"consumptionType") ?? 0);
    const status=Number(deepFind(raw.lottery,"status") ?? 0);
    const surplus=Number(deepFind(raw.user,"surplusTimes") ?? deepFind(raw.user,"todaySurplusTimes") ?? deepFind(raw.user,"totalTimes") ?? 0);
    const points=Number(deepFind(raw.user,"points") ?? 0);
    const subscribed=Boolean(deepFind(raw.user,"isSubscribe"));

    const wheel=page.locator('bluetti-wheel').first();
    if(await wheel.count().catch(()=>0)) await wheel.scrollIntoViewIfNeeded().catch(()=>{});
    await page.waitForTimeout(800);
    const btn=page.locator('button[start-lottery],[start-lottery]').first();
    if(!(await btn.count().catch(()=>0))) return {task:"bluetti_safe_spin",status:"spin_control_not_found",consumption_type:consumptionType,surplus_times:surplus,points,subscribed,url:page.url()};
    const disabled=await btn.isDisabled().catch(()=>false);
    const label=cleanText(await btn.innerText().catch(()=>""),200);
    const nearby=cleanText(await wheel.innerText().catch(()=>""),2500);

    // Never consume BLUETTI points, make a purchase, or redeem an order-based chance with no earned spin.
    if(consumptionType===4 || /(spend|redeem).{0,30}(buck|point)/i.test(nearby)){
      return {task:"bluetti_safe_spin",status:"points_required_no_action",consumption_type:consumptionType,surplus_times:surplus,points,button:label,url:page.url()};
    }
    if(disabled) return {task:"bluetti_safe_spin",status:"no_available_spin",consumption_type:consumptionType,surplus_times:surplus,points,button:label,url:page.url()};
    if(consumptionType===2 && surplus<=0){
      return {task:"bluetti_safe_spin",status:"purchase_or_order_chance_required_no_action",consumption_type:consumptionType,surplus_times:surplus,url:page.url()};
    }

    await btn.click({timeout:3500,force:true});
    await page.waitForTimeout(5500);
    const body=await pageBody(page,40000);
    const resultLines=body.split(/\n+/).map(x=>cleanText(x,320)).filter(x=>/(congrat|won|prize|coupon|gift|bucks|better luck|again|my prize)/i.test(x)).slice(0,30);
    const log=await page.evaluate(async(id)=>{
      try{
        const r=await fetch("https://api.bluettipower.com/activityapi/lottery/getUserLotteryLogByUser?current=1&size=10&lotteryId="+id+"&type=[2,3,4,5,6,7]",{credentials:"include"});
        const j=await r.json();
        const data=j?.data?.records||j?.data?.list||j?.data||[];
        const arr=Array.isArray(data)?data:[];
        return arr.slice(0,3).map(x=>({
          awardName:x.awardName||x.prizeName||x.name||null,
          awardType:x.awardType||x.type||null,
          createdAt:x.createdAt||x.createTime||x.createdTime||null
        }));
      }catch(e){return []}
    },id).catch(()=>[]);
    return {task:"bluetti_safe_spin",status:"spin_attempted",consumption_type:consumptionType,surplus_times_before:surplus,points_before:points,url:page.url(),result_lines:resultLines,latest_prizes:log};
  }finally{await page.close().catch(()=>{});}
}

async function movaWidgetApiDiagWithContext(context){
  const scriptUrl="https://ext.spinwheelapp.com/external/v1/7bdb4ac5233e8720/spps.js?shop=mova-us.myshopify.com";
  try{
    const resp=await context.request.get(scriptUrl,{timeout:12000,failOnStatusCode:false});
    const js=await resp.text().catch(()=>"");
    const urls=[...new Set((js.match(/https?:\/\/[^"'\s)]+/g)||[]))]
      .filter(u=>/spin|wheel|api|campaign|prize|external|shopify/i.test(u)).slice(0,80);
    const paths=[...new Set((js.match(/["']\/(?:[^"'\s]{1,180})/g)||[]).map(x=>x.slice(1)))]
      .filter(p=>/api|spin|wheel|campaign|prize|entry|customer|submit|play/i.test(p)).slice(0,100);
    const snippets=[];
    const re=/(fetch\(|axios|XMLHttpRequest|campaign|spin|wheel|prize|entry|customer|submit|play)/ig;
    let m;
    while((m=re.exec(js))&&snippets.length<80){
      snippets.push(js.slice(Math.max(0,m.index-260),Math.min(js.length,m.index+700)).replace(/\s+/g," "));
      re.lastIndex=m.index+Math.max(1,m[0].length);
    }
    return {task:"mova_widget_api_diag",status:resp.status(),script_url:scriptUrl,script_bytes:js.length,urls,paths,snippets};
  }catch(err){
    return {task:"mova_widget_api_diag",status:"request_failed",error:String(err)};
  }
}

async function navimowRound2CheckWithContext(context){
  const api="https://www.reddit.com/r/Navimow_Segway/about.json";
  let subscribers=null, apiStatus=null, error=null;
  try{
    const resp=await context.request.get(api,{
      timeout:12000,
      failOnStatusCode:false,
      headers:{"User-Agent":"Mozilla/5.0 OracleBrowserAgent/1.0"}
    });
    apiStatus=resp.status();
    const j=await resp.json().catch(()=>null);
    const n=Number(j?.data?.subscribers);
    if(Number.isFinite(n)&&n>=0) subscribers=n;
  }catch(e){error=String(e)}
  if(subscribers===null){
    const page=await context.newPage();
    try{
      await gotoLoose(page,"https://www.reddit.com/r/Navimow_Segway/");
      const body=await pageBody(page,20000);
      const m=body.match(/([0-9][0-9,.]*[Kk]?)\s+(?:members|member)/i);
      if(m){
        const raw=m[1].replace(/,/g,"").toLowerCase();
        subscribers=raw.endsWith("k")?Math.round(parseFloat(raw)*1000):Number(raw);
      }
    }finally{await page.close().catch(()=>{});}
  }
  return {
    task:"navimow_round2_check",
    status:subscribers===null?"count_unresolved":(subscribers>=11000?"trigger_reached":"waiting"),
    subscribers,
    threshold:11000,
    remaining:subscribers===null?null:Math.max(0,11000-subscribers),
    round2_unlocked:subscribers!==null&&subscribers>=11000,
    official_post:"https://www.reddit.com/r/Navimow_Segway/comments/1vw6ff9/join_rnavimow_segway_for_mowing_tips_updates_and/",
    api_status:apiStatus,
    error:error
  };
}

async function houseworkCompleteWithContext(context){
  const profile=readEntryProfile();
  const page=await context.newPage();
  try{
    const productUrl="https://shop.housework.com/products/fall-cleaning-challenge-2026";
    await gotoLoose(page,productUrl);
    await page.waitForTimeout(700);

    // Prefer the normal Shopify product form. The accelerated "Buy It Now" path
    // can leave a headless/automated session on an empty cart.
    let added=false;
    const form=page.locator('form[action*="/cart/add"]').first();
    if(await form.count().catch(()=>0)){
      const variant=await form.locator('input[name="id"],select[name="id"]').first().inputValue().catch(()=>"");
      if(variant){
        const addResult=await page.evaluate(async(id)=>{
          try{
            const r=await fetch("/cart/add.js",{
              method:"POST",
              headers:{"Content-Type":"application/json","Accept":"application/json"},
              credentials:"include",
              body:JSON.stringify({items:[{id:Number(id),quantity:1}]})
            });
            let data=null; try{data=await r.json();}catch{}
            return {ok:r.ok,status:r.status,data};
          }catch(e){return {ok:false,error:String(e)}}
        },variant).catch(e=>({ok:false,error:String(e)}));
        added=Boolean(addResult&&addResult.ok);
      }
    }
    if(!added){
      const add=page.getByRole("button",{name:/ADD TO CART/i}).first();
      if(await add.count().catch(()=>0)){
        await add.click({timeout:4000}).catch(()=>{});
        await page.waitForTimeout(1200);
      }
    }

    const cart=await page.evaluate(async()=>{
      try{
        const r=await fetch("/cart.js",{credentials:"include"});
        const j=await r.json();
        return {item_count:j.item_count||0,items:(j.items||[]).map(x=>({title:x.product_title||x.title,handle:x.handle,price:x.final_line_price}))};
      }catch(e){return {item_count:0,error:String(e),items:[]}}
    }).catch(e=>({item_count:0,error:String(e),items:[]}));
    const hasChallenge=(cart.items||[]).some(x=>/fall cleaning challenge 2026/i.test(String(x.title||""))||/fall-cleaning-challenge-2026/i.test(String(x.handle||"")));
    if(!hasChallenge) return {task:"housework_complete",status:"cart_add_failed",url:page.url(),cart_item_count:cart.item_count||0};

    await page.goto("https://shop.housework.com/checkout",{waitUntil:"domcontentloaded",timeout:15000}).catch(()=>{});
    await page.waitForTimeout(2200);

    const fillFirst=async(selectors,value)=>{
      for(const sel of selectors){
        const loc=page.locator(sel);
        const n=await loc.count().catch(()=>0);
        for(let i=0;i<Math.min(n,8);i++){
          const el=loc.nth(i);
          if(!(await el.isVisible().catch(()=>false))) continue;
          if(await el.inputValue().catch(()=>"")) return true;
          await el.fill(String(value)).catch(()=>{});
          return true;
        }
      }
      return false;
    };
    const parts=String(profile.name).trim().split(/\s+/);
    await fillFirst(['input[type="email"]','input[autocomplete="email"]'],profile.email);
    await fillFirst(['input[autocomplete="given-name"]','input[name*="first" i]'],parts[0]||"Jason");
    await fillFirst(['input[autocomplete="family-name"]','input[name*="last" i]'],parts.slice(1).join(" ")||"Craumer");
    await fillFirst(['input[autocomplete="address-line1"]','input[name*="address1" i]','input[name*="address_1" i]'],profile.street);
    await fillFirst(['input[autocomplete="address-level2"]','input[name*="city" i]'],profile.city);
    await fillFirst(['input[autocomplete="postal-code"]','input[name*="zip" i]','input[name*="postal" i]'],profile.postal_code);

    const country=page.locator('select[autocomplete="country"],select[name*="country" i]').first();
    if(await country.count().catch(()=>0)&&await country.isVisible().catch(()=>false)){
      await country.selectOption({label:/United States/i}).catch(async()=>await country.selectOption("US").catch(()=>{}));
    }
    const state=page.locator('select[autocomplete="address-level1"],select[name*="state" i],select[name*="province" i]').first();
    if(await state.count().catch(()=>0)&&await state.isVisible().catch(()=>false)){
      await state.selectOption({label:/Pennsylvania/i}).catch(async()=>await state.selectOption("PA").catch(()=>{}));
    } else await fillFirst(['input[autocomplete="address-level1"]','input[name*="state" i]'],profile.state);

    await page.waitForTimeout(1200);
    const required=await page.locator('input[required],select[required],textarea[required]').evaluateAll(els=>els.map(e=>{
      const r=e.getBoundingClientRect(),v=e.value||"";
      return r.width>0&&r.height>0&&!v?((e.getAttribute("autocomplete")||e.getAttribute("name")||e.getAttribute("placeholder")||"required field")):null;
    }).filter(Boolean)).catch(()=>[]);
    const unknown=required.filter(x=>!/email|given|first|family|last|address|city|postal|zip|state|province|country/i.test(x));
    if(unknown.some(x=>/phone|tel/i.test(x))) return {task:"housework_complete",status:"phone_required",required_fields:[...new Set(unknown)].slice(0,20),url:page.url()};
    if(unknown.length) return {task:"housework_complete",status:"other_required_fields",required_fields:[...new Set(unknown)].slice(0,20),url:page.url()};

    const bodyBefore=await pageBody(page,30000);
    // A $0 digital challenge must never incur a charge. Stop if a positive total is clearly shown.
    const money=[...bodyBefore.matchAll(/\$\s*([0-9]+(?:\.[0-9]{2})?)/g)].map(m=>Number(m[1]));
    const maxMoney=money.length?Math.max(...money):0;
    const hasZero=/Total.{0,80}\$\s*0(?:\.00)?|\$\s*0\.00.{0,80}Total/i.test(bodyBefore);
    if(maxMoney>0 && !hasZero) return {task:"housework_complete",status:"nonzero_checkout_no_action",max_visible_amount:maxMoney,url:page.url()};

    const submit=page.getByRole("button",{name:/complete order|pay now|place order|submit order|continue/i});
    const n=await submit.count().catch(()=>0);
    let clicked=false,label=null;
    for(let i=0;i<Math.min(n,20);i++){
      const b=submit.nth(i); if(!(await b.isVisible().catch(()=>false))||await b.isDisabled().catch(()=>false)) continue;
      const t=cleanText(await b.innerText().catch(()=>""),160);
      if(/continue to (shipping|payment)/i.test(t)){try{await b.click({timeout:3500});await page.waitForTimeout(1200);continue}catch{}}
      if(/complete order|pay now|place order|submit order/i.test(t)){try{await b.click({timeout:3500});clicked=true;label=t;break}catch{}}
    }
    if(!clicked) return {task:"housework_complete",status:"final_submit_not_found",url:page.url()};
    await page.waitForTimeout(3500);
    const body=await pageBody(page,30000);
    const ok=/thank you|order confirmed|order is confirmed|download your|download now/i.test(body)||/thank_you|orders\//i.test(page.url());
    return {task:"housework_complete",status:ok?"confirmed":"submitted_unconfirmed",submit_label:label,url:page.url(),
      confirmation:body.match(/.{0,100}(thank you|order confirmed|order is confirmed|download your|download now).{0,200}/i)?.[0]||null};
  }finally{await page.close().catch(()=>{});}
}



async function husqvarna450xEntryWithContext(context) {
  const profile=readEntryProfile();
  const missing=["name","email","phone"].filter(k=>!String(profile[k]||"").trim());
  if(missing.length) return {task:"husqvarna_450x_entry",status:"missing_profile_fields",fields:missing};
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://na-pages.husqvarna.com/us-450x-giveaway-26");
    await page.waitForTimeout(1200);

    const termsLink=page.getByRole("link",{name:/giveaway terms/i}).first();
    let termsText="", termsUrl=null, termsStatus=null;
    if(await termsLink.count().catch(()=>0)){
      termsUrl=await termsLink.getAttribute("href").catch(()=>null);
      if(termsUrl){
        try{
          const resp=await context.request.get(termsUrl,{timeout:12000});
          termsStatus=resp.status();
          termsText=cleanText(await resp.text(),50000);
        }catch{}
      }
    }
    const automationBan=/(automated|automation|script|macro|bot|robotic|mechanical)\s+(entry|entries|system|means|method|device)/i.test(termsText) ||
      /(entries|entry).{0,120}(automated|script|macro|bot|robotic|mechanical)/i.test(termsText);

    const parts=String(profile.name).trim().split(/\s+/);
    const first=parts[0]||"";
    const last=parts.slice(1).join(" ");
    const fill=async(sel,val)=>{
      const el=page.locator(sel).first();
      if(await el.count().catch(()=>0)){await el.fill(String(val)).catch(()=>{});return true;}
      return false;
    };
    await fill('input[name="firstName"]',first);
    await fill('input[name="lastName"]',last);
    await fill('input[name="emailAddress"]',profile.email);
    await fill('input[name="mobilePhone"]',profile.phone);

    const usage=page.locator('select[name="usageWhoareyou1"]').first();
    if(await usage.count().catch(()=>0)){
      await usage.selectOption({label:"Residential / Homeowner"}).catch(async()=>await usage.selectOption("Residential / Homeowner").catch(()=>{}));
    }

    // Do not opt into the optional newsletter unless explicitly requested.
    const newsletter=page.locator('input[type="checkbox"][name="singleCheckbox"]').first();
    if(await newsletter.count().catch(()=>0) && await newsletter.isChecked().catch(()=>false)) await newsletter.uncheck().catch(()=>{});

    const requiredMissing=[];
    for(const sel of ['input[name="firstName"]','input[name="lastName"]','input[name="emailAddress"]','input[name="mobilePhone"]','select[name="usageWhoareyou1"]']){
      const el=page.locator(sel).first();
      if(!(await el.count().catch(()=>0)) || !String(await el.inputValue().catch(()=>"")).trim()) requiredMissing.push(sel);
    }
    if(requiredMissing.length) return {task:"husqvarna_450x_entry",status:"form_incomplete",missing:requiredMissing,url:page.url()};

    if(automationBan){
      return {task:"husqvarna_450x_entry",status:"manual_submit_required_by_rules",url:page.url(),terms_url:termsUrl,terms_status:termsStatus};
    }

    const submit=page.locator('input[type="submit"],button[type="submit"],button').filter({hasText:/submit|enter/i}).first();
    if(!(await submit.count().catch(()=>0))) return {task:"husqvarna_450x_entry",status:"submit_control_not_found",url:page.url()};
    await submit.click({timeout:5000}).catch(()=>{});
    await page.waitForTimeout(3500);
    const body=await pageBody(page,30000);
    const confirmed=/(thank you|thanks for entering|entry received|successfully entered|submission received)/i.test(body);
    return {task:"husqvarna_450x_entry",status:confirmed?"confirmed":"submitted_unconfirmed",url:page.url(),
      confirmation:body.match(/.{0,120}(thank you|thanks for entering|entry received|successfully entered|submission received).{0,180}/i)?.[0]||null};
  }finally{await page.close().catch(()=>{});}
}

async function prepareRestrictedSession(job) {
  const profile=readEntryProfile();
  const kind=String(job.kind||"");
  const targets={
    reolink:"https://reolink.com/__/lp/reolink-day/",
    gleam_lenovo_monitor:"https://gleam.io/2mt9X/win-a-custom-valheim-lenovo-legion-ultrawide-gaming-monitor",
    gleam_lenovo_chromebook:"https://gleam.io/GUZoP/lenovo-slim-3-chromebook-giveaway"
  };
  const url=targets[kind]||String(job.url||"");
  if(!url) throw new Error("Missing restricted-entry URL");
  const session=await startLogin({profile:"daily",url});
  const page=activeLoginPage();
  if(!page) return {...session,status:"browser_started_but_page_missing"};
  await page.waitForTimeout(1800);

  const fillVisible=async(selectors,value)=>{
    for(const sel of selectors){
      const loc=page.locator(sel);
      const n=await loc.count().catch(()=>0);
      for(let i=0;i<Math.min(n,12);i++){
        const el=loc.nth(i);
        if(!(await el.isVisible().catch(()=>false))) continue;
        try{await el.fill(String(value));return true;}catch{}
      }
    }
    return false;
  };

  const parts=String(profile.name||"").trim().split(/\s+/);
  await fillVisible(['input[type="email"]','input[autocomplete="email"]','input[name*="email" i]'],profile.email||"");
  await fillVisible(['input[autocomplete="given-name"]','input[name*="first" i]','input[placeholder*="first" i]'],parts[0]||"");
  await fillVisible(['input[autocomplete="family-name"]','input[name*="last" i]','input[placeholder*="last" i]'],parts.slice(1).join(" "));
  if(profile.phone) await fillVisible(['input[type="tel"]','input[name*="phone" i]','input[autocomplete="tel"]'],profile.phone);

  const buttons=await page.locator('button,input[type="submit"],[role="button"]').evaluateAll(els=>els.map((e,i)=>{
    const r=e.getBoundingClientRect();
    return {i,text:(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,180),visible:r.width>0&&r.height>0};
  }).filter(x=>x.visible&&/(submit|enter|continue|login|log in|verify|complete|done)/i.test(x.text)).slice(0,30)).catch(()=>[]);
  const body=await pageBody(page,12000);
  return {...session,task:"prepare_restricted",status:"ready_for_manual_action",kind,url:page.url(),buttons,
    note:/gleam/i.test(page.url()+body)?"Gleam final retry prepared; complete the visible final action manually.":"Form prepared; complete the visible final submit manually."};
}

async function freshOpportunityDiagWithContext(context, task) {
  const targets = {
    powernation_diag: "https://generaltire.powernationtv.com/",
    mammotion_vanguard_diag: "https://mammotion.com/pages/vanguard-survey",
    husqvarna_450x_diag: "https://na-pages.husqvarna.com/us-450x-giveaway-26"
  };
  const url=targets[task];
  if(!url) throw new Error("Unknown fresh opportunity diagnostic");
  const page=await context.newPage();
  try{
    await gotoLoose(page,url);
    await page.waitForTimeout(2500);
    const body=await pageBody(page,40000);
    const fields=await page.locator("input,select,textarea").evaluateAll(els=>els.map((e,i)=>{
      const r=e.getBoundingClientRect();
      const opts=e.tagName==="SELECT"?Array.from(e.options||[]).slice(0,30).map(o=>(o.textContent||"").replace(/\s+/g," ").trim()).filter(Boolean):[];
      return {
        i,tag:e.tagName,type:e.getAttribute("type")||"",name:e.getAttribute("name")||"",
        id:e.id||"",placeholder:e.getAttribute("placeholder")||"",autocomplete:e.getAttribute("autocomplete")||"",
        aria:e.getAttribute("aria-label")||"",required:e.required===true,visible:r.width>0&&r.height>0,
        options:opts
      };
    }).filter(x=>x.visible).slice(0,120)).catch(()=>[]);
    const controls=await page.locator("button,a,[role=button],input[type=submit]").evaluateAll(els=>els.map((e,i)=>{
      const r=e.getBoundingClientRect();
      return {i,tag:e.tagName,text:(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,250),
        href:e.getAttribute("href")||"",visible:r.width>0&&r.height>0};
    }).filter(x=>x.visible && /(enter|submit|apply|next|continue|sweep|giveaway|terms)/i.test(x.text+x.href)).slice(0,80)).catch(()=>[]);
    const snippets=body.split(/\n+/).map(x=>cleanText(x,500))
      .filter(x=>/(enter|submit|apply|giveaway|sweepstakes|phone|email|address|usage|lawn|acre|yard|tester|vanguard|terms)/i.test(x)).slice(0,80);
    return {task,status:"inspected",url:page.url(),title:await page.title().catch(()=>""),fields,controls,snippets};
  } finally { await page.close().catch(()=>{}); }
}


async function husqvarnaTermsDiagWithContext(context) {
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://na-pages.husqvarna.com/us-450x-giveaway-26");
    await page.waitForTimeout(1200);
    const terms=page.getByRole("link",{name:/giveaway terms/i}).first();
    if(!(await terms.count().catch(()=>0))) return {task:"husqvarna_terms_diag",status:"terms_link_not_found",url:page.url()};
    await terms.click({timeout:5000}).catch(async()=>{ const href=await terms.getAttribute("href"); if(href) await gotoLoose(page,href); });
    await page.waitForTimeout(2500);
    const body=await pageBody(page,50000);
    return {
      task:"husqvarna_terms_diag",status:"inspected",url:page.url(),
      automation_prohibition:/(automated|automation|script|macro|bot|robotic)\s+(system|entry|entries|means|method)/i.test(body),
      snippets:body.split(/\n+/).map(x=>cleanText(x,700))
        .filter(x=>/(automated|automation|script|macro|bot|entry|eligib|october|phone|one entry|limit)/i.test(x)).slice(0,80)
    };
  } finally { await page.close().catch(()=>{}); }
}

async function powernationDeepDiagWithContext(context) {
  const page=await context.newPage();
  try{
    await gotoLoose(page,"https://generaltire.powernationtv.com/");
    await page.waitForTimeout(7000);
    const frameData=[];
    for(const fr of page.frames()){
      const fields=await fr.locator("input,select,textarea").evaluateAll(els=>els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        return {i,tag:e.tagName,type:e.getAttribute("type")||"",name:e.getAttribute("name")||"",id:e.id||"",
          placeholder:e.getAttribute("placeholder")||"",required:e.required===true,visible:r.width>0&&r.height>0,
          label:(e.labels&&e.labels.length?Array.from(e.labels).map(x=>(x.innerText||x.textContent||"").replace(/\\s+/g," ").trim()).join(" | "):""),
          parent:(e.parentElement?(e.parentElement.innerText||e.parentElement.textContent||"").replace(/\\s+/g," ").trim().slice(0,500):""),
          options:e.tagName==="SELECT"?Array.from(e.options||[]).map(o=>({text:(o.textContent||"").replace(/\\s+/g," ").trim(),value:o.value})).slice(0,80):[]};
      }).filter(x=>x.visible).slice(0,120)).catch(()=>[]);
      const controls=await fr.locator("button,a,[role=button],input[type=submit]").evaluateAll(els=>els.map((e,i)=>{
        const r=e.getBoundingClientRect();
        return {i,tag:e.tagName,text:(e.innerText||e.textContent||e.value||"").replace(/\s+/g," ").trim().slice(0,240),
          href:e.getAttribute("href")||"",visible:r.width>0&&r.height>0};
      }).filter(x=>x.visible).slice(0,100)).catch(()=>[]);
      const body=await fr.locator("body").innerText().catch(()=>"");
      frameData.push({url:fr.url(),name:fr.name(),fields,controls:controls.filter(x=>/(enter|submit|next|continue|rules|sweep|general|tire)/i.test(x.text+x.href)).slice(0,50),
        snippets:body.split(/\n+/).map(x=>cleanText(x,500)).filter(x=>/(enter|submit|rules|sweep|general tire|name|email|phone|address|zip)/i.test(x)).slice(0,60)});
    }
    return {task:"powernation_deep_diag",status:"inspected",url:page.url(),frames:frameData};
  } finally { await page.close().catch(()=>{}); }
}

async function taskWithContext(context, task) {
  if (task === "husqvarna_450x_entry") return await husqvarna450xEntryWithContext(context);
  if (task === "husqvarna_terms_diag") return await husqvarnaTermsDiagWithContext(context);
  if (task === "powernation_deep_diag") return await powernationDeepDiagWithContext(context);
  if (["powernation_diag","mammotion_vanguard_diag","husqvarna_450x_diag"].includes(task)) return await freshOpportunityDiagWithContext(context, task);
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
  if (task === "housework_complete") return await houseworkCompleteWithContext(context);
  if (task === "bluetti_safe_spin") return await bluettiSafeSpinWithContext(context);
  if (task === "reolink_confirmed_entry") return await reolinkConfirmedEntryWithContext(context);
  if (task === "housework_checkout_probe") return await houseworkCheckoutProbeWithContext(context);
  if (task === "mova_reveal_diag") return await movaRevealDiagWithContext(context);
  if (task === "mova_widget_api_diag") return await movaWidgetApiDiagWithContext(context);
  if (task === "navimow_round2_check") return await navimowRound2CheckWithContext(context);
  if (task === "bluetti_wheel_state") return await bluettiWheelStateWithContext(context);
  if (task === "eufy_alt_free_spin") return await eufyAltFreeSpinWithContext(context);
  if (["dreame_forum_diag","eufy_alt_draw_diag","promo_script_diag","housework_diag"].includes(task)) return await finishDiagWithContext(context,task);
  if (task === "dreame_auth_diag") return await dreameAuthDiagWithContext(context);
  if (["eufy_plumbing_diag","bluetti_plumbing_diag","mova_plumbing_diag"].includes(task)) return await promoPlumbingDiagWithContext(context,task);
  throw new Error("Unsupported context task: " + task);
}

async function runTask(job) {
  const task = String(job.task || "");
  if (task === "health") return { task: "health", ok: true, time: new Date().toISOString() };
  if (task === "entry_profile_key") return initSecureVault();
  if (task === "entry_profile_store") return storeEncryptedEntryProfile(job);
  if (task === "vault_init") return initSecureVault();
  if (task === "vault_store") return storeEncryptedEntryProfile(job);
  if (task === "vault_patch") return patchEncryptedEntryProfile(job);
  if (task === "dreame_otp_start") return await dreameOtpStart();
  if (task === "dreame_otp_finish") return await dreameOtpFinish(job);
  if (task === "login_start") return await startLogin(job);
  if (task === "login_stop") return await stopLogin();
  if (task === "prepare_restricted") return await prepareRestrictedSession(job);
  if (["reolink_subscribe","reolink_day_entry","reolink_confirmed_entry"].includes(task)) {
    return { task, status:"manual_only_rules_prohibit_automation", need:"Complete the Reolink entry manually; Oracle will not submit it." };
  }
  if (task === "jml_scan") return await jmlScan();
  if (["husqvarna_450x_entry"].includes(task)) {
    if (loginState.context || loginState.tunnel) return { task, status:"manual_login_session_active" };
    const context = await launchProfile("daily");
    try { return await taskWithContext(context, task); } finally { await context.close().catch(() => {}); }
  }
  if (task === "roborock_spin") return await roborockSpin();
  if (task === "reolink_subscribe" || task === "eufy_lucky" || task === "bluetti_lucky" || task === "wyze_survey" || task === "eufy_login_and_spin" || task === "instagram_diag" || task === "roborock_google_login_and_spin" || task === "roborock_wheel_diag" || task === "instagram_brand_scan" || task === "mova_prize_wheel" || task === "housework_challenge" || task === "dreame_aero_giveaway" || task === "dreame_entry_path" || task === "eufy_deep_entry" || task === "bluetti_robust_entry" || task === "mova_direct_entry" || task === "reolink_day_entry" || ["bluetti_safe_spin","housework_complete"].includes(task) || ["housework_checkout_probe","reolink_confirmed_entry"].includes(task) || ["eufy_alt_free_spin","bluetti_wheel_state","mova_reveal_diag","mova_widget_api_diag","navimow_round2_check"].includes(task) || ["dreame_forum_diag","eufy_alt_draw_diag","promo_script_diag","housework_diag"].includes(task) || task === "dreame_auth_diag" || ["eufy_plumbing_diag","bluetti_plumbing_diag","mova_plumbing_diag"].includes(task) || ["roborock_diag","eufy_diag","bluetti_diag","mova_diag"].includes(task)) {
    if (loginState.context || loginState.tunnel) return { task, status:"manual_login_session_active" };
    const context = await launchProfile("daily");
    try { return await taskWithContext(context, task); }
    finally { await context.close().catch(() => {}); }
  }
  if (task === "batch") {
    if (loginState.context || loginState.tunnel) return { task:"batch", status:"manual_login_session_active", parallel:false };
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];
    const allowed = tasks.filter(t => ["jml_scan", "roborock_spin", "eufy_lucky", "bluetti_lucky", "wyze_survey", "roborock_diag", "eufy_diag", "bluetti_diag", "mova_diag", "eufy_login_and_spin", "instagram_diag", "roborock_google_login_and_spin", "roborock_wheel_diag", "instagram_brand_scan", "mova_prize_wheel", "housework_challenge", "dreame_aero_giveaway", "dreame_entry_path", "eufy_deep_entry", "bluetti_robust_entry", "mova_direct_entry", "dreame_auth_diag", "eufy_plumbing_diag", "bluetti_plumbing_diag", "mova_plumbing_diag", "dreame_forum_diag", "eufy_alt_draw_diag", "promo_script_diag", "housework_diag", "eufy_alt_free_spin", "bluetti_wheel_state", "mova_reveal_diag", "mova_widget_api_diag", "navimow_round2_check", "housework_checkout_probe", "bluetti_safe_spin", "housework_complete", "powernation_diag", "mammotion_vanguard_diag", "husqvarna_450x_diag", "husqvarna_terms_diag", "powernation_deep_diag", "husqvarna_450x_entry"].includes(String(t)));
    const context = await launchProfile("daily");
    try {
      const requestedTimeout = Number(job.lane_timeout_ms || 50000);
      const laneTimeoutMs = Math.max(10000, Math.min(55000, Number.isFinite(requestedTimeout) ? requestedTimeout : 50000));
      const runLane = (t) => Promise.race([
        taskWithContext(context, t),
        new Promise(resolve => setTimeout(() => resolve({
          task: String(t),
          status: "timeout_skipped",
          timeout_ms: laneTimeoutMs
        }), laneTimeoutMs))
      ]);
      const settled = await Promise.allSettled(allowed.map(t => runLane(t)));
      return {
        task: "batch",
        parallel: true,
        shared_profile: "daily",
        lane_timeout_ms: laneTimeoutMs,
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
