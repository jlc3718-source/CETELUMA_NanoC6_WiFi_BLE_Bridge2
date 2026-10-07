import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    s = f.read()

fn = r'''
async function clickTextEntry(job = {}) {
  const url = String(job.url || "");
  const label = String(job.label || "").trim();
  if (!/^https?:\/\//i.test(url) || !label) throw new Error("Missing valid URL or label");
  const context = await launchProfile("daily");
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto(url, { waitUntil:"domcontentloaded", timeout:12000 }).catch(async()=>{ await page.evaluate(()=>window.stop()).catch(()=>{}); });
    await page.waitForTimeout(900);
    const before = (await page.locator("body").innerText().catch(()=>"")).slice(0,50000);
    const esc = v => v.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
    const re = new RegExp(esc(label), "i");
    const pools = [
      page.getByRole("button", { name: re }),
      page.getByRole("link", { name: re }),
      page.getByText(re, { exact: true })
    ];
    let target = null;
    for (const loc of pools) {
      const n = await loc.count().catch(()=>0);
      for (let i=0; i<Math.min(n,12); i++) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(()=>false)) { target = el; break; }
      }
      if (target) break;
    }
    if (!target) {
      const labels = await page.locator("button,a").evaluateAll(
        els => els.filter(e=>e.offsetParent!==null).map(e=>(e.innerText||e.textContent||"").trim()).filter(Boolean).slice(0,60)
      ).catch(()=>[]);
      return { task:"click_text_entry", status:"click_control_not_found", url:page.url(), label, visible_controls:labels };
    }
    await target.click({ timeout:4000 });
    await page.waitForTimeout(1800);
    const final = (await page.locator("body").innerText().catch(()=>"")).slice(0,50000);
    const confirmRe = /(you.?re entered|you are entered|thanks for entering|entry received|successfully entered|submission received|entry confirmed)/i;
    const m = final.match(confirmRe);
    const confirmed = Boolean(m) && !confirmRe.test(before);
    const challenge = page.frames().some(fr=>/captcha|turnstile|recaptcha|hcaptcha/i.test(fr.url())) ||
      /verify you are human|captcha|turnstile/i.test(final);
    const loginRequired = !confirmed &&
      /(log in to enter|sign in to enter|please log in|please sign in|create an account to enter|join to enter)/i.test(final);
    return {
      task:"click_text_entry",
      status:challenge ? "manual_final_required_challenge" : confirmed ? "confirmed" : loginRequired ? "login_required" : "clicked_unconfirmed",
      url:page.url(),
      label,
      confirmation:confirmed ? m[0] : null
    };
  } finally {
    await context.close().catch(()=>{});
  }
}
'''

if "async function clickTextEntry(job" not in s:
    marker = "async function runTask(job) {"
    if marker not in s:
        raise RuntimeError("runTask marker not found")
    s = s.replace(marker, fn + "\n\n" + marker, 1)

if 'task === "click_text_entry"' not in s:
    marker = 'if (task === "generic_form_entry") return await fastDaily.genericFormEntry(job);'
    if marker not in s:
        raise RuntimeError("generic_form_entry route marker not found")
    s = s.replace(marker, marker + '\n  if (task === "click_text_entry") return await clickTextEntry(job);', 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(s)
