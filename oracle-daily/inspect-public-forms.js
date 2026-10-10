"use strict";
// Oracle-only public DOM diagnostics. No profile, cookies or field values.
const {chromium}=require("/app/node_modules/playwright-core");
(async()=>{
  const browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  try{
    const urls=["https://concretetoolsdirect.com/pages/sweepstakes","https://www.focusgroupplacement.com/study/98633/feedback-opportunity-for-skilled-trades-professionals"];
    const results=await Promise.all(urls.map(async(url)=>{
      const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(2500);
      try{
        await page.goto(url,{waitUntil:"domcontentloaded",timeout:12000}).catch(()=>{});
        await page.waitForTimeout(7000);
        const frames=await Promise.all(page.frames().map(async(frame)=>({url:frame.url(),...await frame.evaluate(()=>{
          const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=="hidden";};
          return {title:document.title,text:(document.body?.innerText||"").slice(0,1800),forms:[...document.forms].map(f=>({id:f.id,action:f.action,text:f.innerText.slice(0,300)})),
            fields:[...document.querySelectorAll("input,select,textarea")].filter(visible).map(e=>({name:e.name,id:e.id,type:e.type,tag:e.tagName,required:e.required,label:[...(e.labels||[])].map(x=>x.innerText).join(" ").slice(0,100),parent:e.parentElement?.tagName})),
            buttons:[...document.querySelectorAll("button,input[type=submit]")].filter(visible).map(e=>({text:(e.innerText||e.value||"").slice(0,100),type:e.type})),
            application_links:[...document.querySelectorAll("a[href]")].filter(e=>/apply|enter|participate|register|join|study|survey/i.test(e.innerText)&&visible(e)).map(e=>({text:e.innerText.slice(0,100),url:e.href})).slice(-15)};
        }).catch(e=>({error:e.message}))})));
        return {url,loaded_url:page.url(),frames};
      }finally{await context.close();}
    }));
    console.log(JSON.stringify({checked_at:new Date().toISOString(),results},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
