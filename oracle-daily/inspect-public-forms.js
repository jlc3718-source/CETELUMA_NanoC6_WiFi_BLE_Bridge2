"use strict";
// Oracle-only public DOM diagnostics. No profile, cookies or field values.
const {chromium}=require("/app/node_modules/playwright-core");
(async()=>{
  const browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try{
    const urls=["https://nymag.com/strategist/article/secret-strategist-giveaway-flos-maap-w1.html","https://form.bshpersona.com/Bosch/?cid=BoschtoberLP&promoIdExt=ab522287-930b-4813-acae-076751a2f9b7","https://bit.ly/4qIBPHm","https://www.toolnut.com/pages/tool-nut-monthly-giveaway-win-free-tools","https://www.anker.com/anker-tech","https://www.instagram.com/p/DeO_rXbOX-7","https://www.betabound.com/","https://www.boschtober.com/"];
    const results=await Promise.all(urls.map(async(url)=>{
      const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(2500);
      try{
        await page.goto(url,{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>{});
        await page.waitForTimeout(7000);
        const rulesButton=page.getByRole("button",{name:/view full rules/i});
        if(await rulesButton.count()) await rulesButton.first().click({timeout:2500}).catch(()=>{});
        const frames=await Promise.all(page.frames().map(async(frame)=>({url:frame.url(),...await frame.evaluate(()=>{
          const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=="hidden";};
          return {title:document.title,text:(document.body?.innerText||"").slice(0,16000),forms:[...document.forms].map(f=>({id:f.id,action:f.action,text:f.innerText.slice(0,300)})),
            fields:[...document.querySelectorAll("input,select,textarea")].filter(visible).map(e=>({name:e.name,id:e.id,type:e.type,tag:e.tagName,required:e.required,label:[...(e.labels||[])].map(x=>x.innerText).join(" ").slice(0,100),parent:e.parentElement?.tagName})),
            buttons:[...document.querySelectorAll("button,input[type=submit]")].filter(visible).map(e=>({text:(e.innerText||e.value||"").slice(0,100),type:e.type})),
            application_links:[...document.querySelectorAll("a[href]")].filter(e=>/apply|enter|participate|register|join|study|survey|rules|terms|conditions/i.test(e.innerText)&&visible(e)).map(e=>({text:e.innerText.slice(0,100),url:e.href})).slice(-30)};
        }).catch(e=>({error:e.message}))})));
        return {url,loaded_url:page.url(),frames};
      }finally{await context.close();}
    }));
    console.log(JSON.stringify({checked_at:new Date().toISOString(),results},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
