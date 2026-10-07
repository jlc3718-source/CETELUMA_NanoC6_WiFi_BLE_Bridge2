import sys,re

path=sys.argv[1]
s=open(path,"r",encoding="utf-8").read()

fn=r'''
async function shoppingAddToCart(job = {}) {
  const url = String(job.url || "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Missing valid URL");
  const context = await launchProfile("daily");
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto(url,{waitUntil:"domcontentloaded",timeout:15000}).catch(async()=>{await page.evaluate(()=>window.stop()).catch(()=>{});});
    await page.waitForTimeout(1400);
    const before=(await page.locator("body").innerText().catch(()=>"")).slice(0,60000);
    const walmart=/walmart\.com/i.test(page.url());
    if (walmart && /(Sign In Account|Sign in or create account)/i.test(before)) {
      return {task:"shopping_add_to_cart",status:"login_required",url:page.url()};
    }
    const buttons=page.getByRole("button",{name:/^Add to cart$/i});
    let target=null;
    const n=await buttons.count().catch(()=>0);
    for(let i=0;i<Math.min(n,10);i++){
      const el=buttons.nth(i);
      if(await el.isVisible().catch(()=>false)){target=el;break;}
    }
    if(!target){
      const controls=await page.locator("button").evaluateAll(els=>els.filter(e=>e.offsetParent!==null).map(e=>(e.innerText||e.textContent||"").trim()).filter(Boolean).slice(0,80)).catch(()=>[]);
      return {task:"shopping_add_to_cart",status:"add_to_cart_not_found",url:page.url(),visible_controls:controls};
    }
    await target.click({timeout:5000});
    await page.waitForTimeout(2200);
    const final=(await page.locator("body").innerText().catch(()=>"")).slice(0,60000);
    const confirmed=/(Added to cart|In cart|Go to cart|View cart|1 item in cart|Cart \(1\)|Cart \(2\)|2 items in cart)/i.test(final);
    const challenge=page.frames().some(fr=>/captcha|turnstile|recaptcha|hcaptcha/i.test(fr.url())) || /verify you are human|captcha|turnstile/i.test(final);
    return {task:"shopping_add_to_cart",status:challenge?"manual_challenge":confirmed?"confirmed":"clicked_unconfirmed",url:page.url()};
  } finally {
    await context.close().catch(()=>{});
  }
}
'''

if "async function shoppingAddToCart(job" not in s:
    marker="async function runTask(job) {"
    if marker not in s: raise RuntimeError("runTask marker not found")
    s=s.replace(marker,fn+"\n\n"+marker,1)

if 'task === "shopping_add_to_cart"' not in s:
    marker='if (task === "generic_form_entry") return await fastDaily.genericFormEntry(job);'
    if marker not in s: raise RuntimeError("generic_form_entry route marker not found")
    s=s.replace(marker,marker+'\n  if (task === "shopping_add_to_cart") return await shoppingAddToCart(job);',1)

open(path,"w",encoding="utf-8").write(s)
