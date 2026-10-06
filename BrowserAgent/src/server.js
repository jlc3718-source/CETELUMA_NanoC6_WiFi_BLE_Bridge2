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
let loginState = { browser: null, tunnel: null, profile: null, target: null, url: null };

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
  loginState = { browser: null, tunnel: null, profile: null, target: null, url: null };
  await new Promise(r => setTimeout(r, 1200));
  return { task: "login_stop", status: "stopped" };
}

async function startLogin(job) {
  await stopLogin();
  const profile = safeProfile(job.profile || "default");
  const target = String(job.url || "about:blank");
  const userDataDir = path.join(DATA_DIR, "profiles", profile);
  fs.mkdirSync(userDataDir, { recursive: true });

  const browser = spawn(CHROME, [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1365,850",
    `--user-data-dir=${userDataDir}`,
    target
  ], { env: { ...process.env, DISPLAY }, stdio: ["ignore", "ignore", "pipe"] });

  const tunnel = spawn("/usr/local/bin/cloudflared", [
    "tunnel", "--url", "http://127.0.0.1:6081", "--no-autoupdate"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  loginState = { browser, tunnel, profile, target, url: null };

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
    login_url: url,
    username: "jason",
    note: "Open the temporary URL, enter the Oracle Browser Login credentials, finish the website login, then run login_stop."
  };
}

async function jmlScan() {
  if (loginState.browser) return { task: "jml_scan", status: "login_session_active" };
  const context = await launchProfile("anker-jml");
  try {
    const page = await pageFor(context);
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
    await context.close().catch(() => {});
  }
}

async function roborockSpin() {
  if (loginState.browser) return { task: "roborock_spin", status: "login_session_active" };
  const context = await launchProfile("roborock");
  try {
    const page = await pageFor(context);
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
    await context.close().catch(() => {});
  }
}

async function runTask(job) {
  const task = String(job.task || "");
  if (task === "health") return { task: "health", ok: true, time: new Date().toISOString() };
  if (task === "login_start") return await startLogin(job);
  if (task === "login_stop") return await stopLogin();
  if (task === "jml_scan") return await jmlScan();
  if (task === "roborock_spin") return await roborockSpin();
  if (task === "batch") {
    if (loginState.browser || loginState.tunnel) await stopLogin();
    const tasks = Array.isArray(job.tasks) ? job.tasks : [];
    const allowed = tasks.filter(t => ["jml_scan", "roborock_spin"].includes(String(t)));
    const settled = await Promise.allSettled(allowed.map(t => runTask({ task: t })));
    return {
      task: "batch",
      parallel: true,
      results: settled.map((r, i) => r.status === "fulfilled"
        ? { task: allowed[i], ok: true, result: r.value }
        : { task: allowed[i], ok: false, error: String(r.reason) })
    };
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
