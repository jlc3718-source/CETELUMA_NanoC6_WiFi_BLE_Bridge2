const {createServer}=require('node:http');
const {readFileSync,existsSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
(async()=>{
 const root=resolve(__dirname,'../.pio/preview'),errors=[],missed=[];
 const scene={power:false,brightness:75,speed:3,firmwareVersion:'Jason Home 2 NanoC6 test',running:{name:'Idle',effect:'Static',colors:['#FFFFFF']},runningNow:{id:'',name:'Idle',effect:'Static',brightness:75,phase:'Idle'},settings:{on:'17:00',off:'23:00',scheduler:false,whiteOverride1:false,whiteOverride2:false,schedule2End:'06:00',dawn:'6:20 AM',dusk:'7:00 PM'},ble:{target:0,ready:false,connected:false,controllers:[]},scheduledEvent:{name:'No event',events:[],enabled:false},localToday:{year:2026,month:10,day:15},resolverAuthority:{inSync:true},nextChange:null};
 const server=createServer((req,res)=>{let p=new URL(req.url,'http://localhost').pathname.replace(/^\/jason-home-2/,'');
  if(p.startsWith('/api/')){
   const routes={
    '/api/state':scene,'/api/nano/status':{activated:false,version:'1.0.0',timeValid:true,eufyStatus:'Not configured'},
    '/api/network/upnp':{enabled:true,status:'Waiting for activation'},'/api/firmware':{autoUpdate:false},'/api/event-categories':{mask:32767,categories:[]},'/api/event-color-theme':{theme:'3.0.29',name:'Expanded'},'/api/colors':{presets:[]},'/api/presets':{presets:[]},'/api/favorites':{events:[]},'/api/events':{events:[]},'/api/events/search':{events:[]},'/api/custom-schedules':{items:[]},'/api/ai':{ok:true,configured:false,thread:[],draft:null,applied:[],usage:{}},'/api/cloud/config':{configured:true,mode:'cloud',automationOwner:'nanoc6'},'/api/night-calendar':{year:2026,month:10,days:[]},'/api/eufy/factory-promotions':{promotions:[]},'/api/eufy/factory-presets':{presets:[]},'/api/curtain/notifications':{notifications:[]},'/api/backup/status':{hasBackup:false},'/api/tonight-options':{options:[]}
   };
   if(!(p in routes))missed.push(p);res.writeHead(p in routes?200:404,{'content-type':'application/json'});res.end(JSON.stringify(routes[p]||{error:'Not mocked'}));return;
  }
  if(p==='/')p='/anderson_home.html';const f=join(root,p);if(existsSync(f)){res.writeHead(200,{'content-type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'});res.end(readFileSync(f));}else{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:412,height:915}});
  page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(1600);
  await page.locator('#jh2CurtainTab').click();await page.waitForTimeout(500);
  const studio=page.locator('button').filter({hasText:/Image \/ GIF Studio/});if(await studio.count())await studio.first().click();await page.waitForTimeout(900);
  if(!(await page.locator('#jh2NanoPanel').count()))throw Error('NanoC6 setup panel missing');
  if(!(await page.locator('#jh2CurtainTab').count()))throw Error('Curtain tab missing');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+4))throw Error('Mobile UI overflows viewport');
  console.log(JSON.stringify({pageErrors:errors,unmocked:[...new Set(missed)],nanoPanel:true,curtainTab:true}));
  if(errors.length||missed.length)process.exitCode=1;
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
