// Cloudflare Workers AI creates the 40x40 base sprite and concise motion plan.
// Frame interpolation, preview, delta encoding and loop timing are deterministic;
// no Workers AI calls occur after the animation has reached Nano storage.
export function createCurtainAiAnimation({run,chat,text,configured,model}){
 const err=(status,message)=>Object.assign(new Error(message),{status});
 const clean=(body)=>{
  const description=String(body?.prompt||'').trim();
  if(description.length<3||description.length>400)
   throw err(400,'Describe your animation in 3–400 characters');
  if(!configured())throw err(409,'Connect Cloudflare Workers AI in the AI tab first');
  return description;
 };
 return {
  async generate(body){
   const description=clean(body);
   const prompt='Sprite artwork for exactly a 40x40 LED light curtain. '+
    'One large recognizable centered subject, deliberately simple 8-bit block pixel art, '+
    'crisp edges, no gradients, no texture, pure black background, at most 12 bright colors, '+
    'no small features or tiny details, no words, no borders or scenery. Description: '+description;
   const result=await run('@cf/black-forest-labs/flux-1-schnell',
     {prompt,steps:4},{timeout:90000});
   const image=result?.result?.image??result?.image;
   if(typeof image!=='string'||image.length>5000000||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(image))
    throw err(502,'AI returned an invalid image');
   const jpeg=Buffer.from(image,'base64');
   if(jpeg.length<500||jpeg.length>3750000||jpeg[0]!==255||jpeg[1]!==216)
    throw err(502,'AI returned an invalid JPEG');
   return {ok:true,image:'data:image/jpeg;base64,'+image,
     sourceModel:'@cf/black-forest-labs/flux-1-schnell',width:40,height:40};
  },
  async motion(body){
   const description=clean(body);
   const result=await chat({model,messages:[
    {role:'system',content:'Plan one 40x40 LED sprite animation. Return ONLY JSON with keys motion, amplitude, note. '+
      'motion must be sway, bounce, orbit, pulse, twinkle, or blink. amplitude must be integer 1, 2 or 3. '+
      'Choose the most fitting recognizable movement for the description. Seamless start/end required. '+
      'No scenery, text, second subject, or video frames.'},
    {role:'user',content:description}
   ],max_completion_tokens:180,temperature:0.2},{timeout:45000});
   const raw=String(text(result)||''),start=raw.indexOf('{'),end=raw.lastIndexOf('}');
   let plan={};if(start>=0&&end>start)try{plan=JSON.parse(raw.slice(start,end+1));}catch{}
   const possible=new Set(['sway','bounce','orbit','pulse','twinkle','blink']);
   const motion=possible.has(plan.motion)?plan.motion:'sway';
   const amplitude=Number.isInteger(plan.amplitude)?Math.max(1,Math.min(3,plan.amplitude)):2;
   return {ok:true,motion,amplitude,note:String(plan.note||'Seamless loop').slice(0,100)};
  }
 };
}
