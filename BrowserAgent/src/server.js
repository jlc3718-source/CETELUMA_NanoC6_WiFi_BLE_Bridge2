const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 8932);
const DATA_DIR = process.env.DATA_DIR || "/data";
const CHROME = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

fs.mkdirSync(path.join(DATA_DIR, "profiles"), { recursive: true });

let queue = Promise.resolve();

function cleanText(s, max = 12000) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function launchProfile(name) {
  const safe = String(name || "default").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const userDataDir = path.join(DATA_DIR, "profiles", safe);
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

async function jmlScan() {
  const context = await launchProfile("anker-jml");
  try {
    const page = await pageFor(context);
    await goto(page, "https://www.anker-jml.com/");
    const body = cleanText(await page.locator("body").innerText().catch(() => ""), 30000);
    const loginRequired = /sign in to unlock more testing opportunities/i.test(body);

    const opportunities = await page.locator("a,button").evaluateAll((els) => {
      const out = [];
      const seen = new Set();
      for (const el of els) {
        const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (!/(Join Now|Under Review|Applied|Recruit|Beta|Test|Survey)/i.test(label)) continue;
        let p = el;
        let text = label;
        for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
          const t = (p.innerText || "").replace(/\s+/g, " ").trim();
          if (t.length > text.length && t.length <= 1200) text = t;
        }
        text = text.slice(0, 1200);
        if (!seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
      }
      return out.slice(0, 30);
    }).catch(() => []);

    return {
      task: "jml_scan",
      authenticated: !loginRequired,
      login_required: loginRequired,
      url: page.url(),
      opportunities
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function roborockSpin() {
  const context = await launchProfile("roborock");
  try {
    const page = await pageFor(context);
    await goto(page, "https://us.roborock.com/pages/points");
    let body = cleanText(await page.locator("body").innerText().catch(() => ""), 30000);
    if (/log in|sign in/i.test(body) && /account-us\.roborock\.com/i.test(page.url())) {
      return { task: "roborock_spin", status: "login_required", url: page.url() };
    }

    const before = body;
    const candidates = page.getByText(/lucky|spin|draw/i);
    const count = await candidates.count().catch(() => 0);
    let clickedEntry = false;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const el = candidates.nth(i);
      if (await el.isVisible().catch(() => false)) {
        try {
          await el.click({ timeout: 2500 });
          clickedEntry = true;
          await page.waitForTimeout(1500);
          break;
        } catch {}
      }
    }

    const spinButtons = page.getByRole("button", { name: /spin|draw|start|go/i });
    const bc = await spinButtons.count().catch(() => 0);
    let spun = false;
    for (let i = 0; i < Math.min(bc, 10); i++) {
      const b = spinButtons.nth(i);
      if (await b.isVisible().catch(() => false)) {
        try {
          await b.click({ timeout: 2500 });
          spun = true;
          await page.waitForTimeout(5000);
          break;
        } catch {}
      }
    }

    body = cleanText(await page.locator("body").innerText().catch(() => ""), 30000);
    const lines = body.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
    const resultLines = lines.filter(s => /(congrat|won|winner|prize|points|coupon|sorry|better luck|spin)/i.test(s)).slice(0, 20);

    return {
      task: "roborock_spin",
      status: spun ? "spin_attempted" : "spin_control_not_found",
      clicked_entry: clickedEntry,
      spun,
      url: page.url(),
      result_lines: resultLines,
      diagnostic: spun ? undefined : cleanText(before, 4000)
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runTask(job) {
  const task = String(job.task || "");
  if (task === "health") {
    return { task: "health", ok: true, time: new Date().toISOString() };
  }
  if (task === "jml_scan") return await jmlScan();
  if (task === "roborock_spin") return await roborockSpin();
  throw new Error("Unsupported task: " + task);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "oracle-browser-agent", time: new Date().toISOString() });
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`oracle-browser-agent listening on ${PORT}`);
});
