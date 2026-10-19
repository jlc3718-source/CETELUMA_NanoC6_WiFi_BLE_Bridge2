// Cloudflare AI draws actual DIFFERENT 40x40 sprite poses, never shifts a still
// image to masquerade as animation. Nano executes encoded deltas independently.
// Editing these two text guides changes AI behavior immediately, without
// source edits, firmware builds or restarting Oracle.
export const CURTAIN_AI_DEFAULT_GUIDES=Object.freeze({styleGuide:'',motionGuide:''});
export function normalizeCurtainAiGuides(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid animation tuning settings');
 const allowed=new Set(['styleGuide','motionGuide']);
 if(Object.keys(value).some(k=>!allowed.has(k)))throw Error('Unsupported animation setting');
 const guides={};
 for(const [name,max] of [['styleGuide',500],['motionGuide',700]]){
  const content=value[name]??'';
  if(typeof content!=='string'||content.length>max||/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/.test(content))
   throw Error('Animation '+name+' must be text under '+max+' characters');
  guides[name]=content.trim();
 }
 return guides;
}
function fallbackPoses(description){
 const text=String(description||'').toLowerCase();
 let subject='the same character',parts=[
  'Close both eyelids completely while keeping the head, outline, and position fixed',
  'Open both eyes wide and change the mouth into an unmistakable open O expression',
  'Raise one arm or appendage clearly while making a big toothy grin; do not translate the subject',
  'Lower the appendage halfway and return to a small smile with one eye winking'
 ];
 if(/pumpkin|jack.o.lantern|gourd/.test(text)){
  subject='the same orange pumpkin';
  parts=[
   'Both carved triangle eyes squeeze shut and the carved mouth becomes a thin straight line',
   'The left triangle eye opens while the right stays shut; open the mouth into a large glowing O',
   'Both triangle eyes open wide and the carved mouth stretches into a broad jagged toothy grin',
   'The right triangle eye winks again while the mouth narrows to a small crooked smile'
  ];
 }else if(/butterfly|bird|wing|bat/.test(text)){
  subject='the same winged character';
  parts=[
   'Fold both wings tightly inward toward the body while keeping the body anchored',
   'Spread both wings open halfway; wing tips are visibly farther from the center',
   'Extend wings fully upward and outward with pronounced new wing silhouettes',
   'Lower both wings in a clearly different diagonal position toward the resting pose'
  ];
 }else if(/flame|fire|candle/.test(text)){
  subject='the same animated flame';
  parts=[
   'Split the flame tip into two distinct curling tongues, keeping its base fixed',
   'Merge the tips into one short rounded flame with a bright small center',
   'Stretch the top into three jagged tall fire tongues while the bottom stays anchored',
   'Turn the central flame tip into a rounded hook, with two short side tongues'
  ];
 }else if(/ghost/.test(text)){
  subject='the same ghost';
  parts=[
   'Squint both eyes to slits and purse the mouth into a tiny closed line',
   'Open the mouth into a large surprised O, with wide round eyes',
   'Widen the two ghost arms/side flaps outward while curving the mouth into a big grin',
   'Lower the arms and wink one eye while returning the mouth toward neutral'
  ];
 }else if(/tree|flower|plant/.test(text)){
  subject='the same plant';
  parts=[
   'Fold leaves or branches inward and slightly close petals, while keeping the stem fixed',
   'Unfurl half the leaves or petals around the anchored center',
   'Fully expand the leaves or petals into a visibly different open silhouette',
   'Curl two leaves or petals back inward while returning toward the resting shape'
  ];
 }
 return parts.map((pose,i)=>'Pose '+(i+1)+' for '+subject+': '+pose+'. Preserve character identity, color palette, fixed camera, original body center and solid black background.');
}
function parsePosePlan(raw){
 const value=String(raw||'').trim();
 let object=null;
 const start=value.indexOf('{'),end=value.lastIndexOf('}');
 if(start>=0&&end>start)try{object=JSON.parse(value.slice(start,end+1));}catch{}
 if(!object&&value.startsWith('['))try{object={poses:JSON.parse(value)};}catch{}
 let poses=Array.isArray(object?.poses)?object.poses:Array.isArray(object?.frames)?object.frames:[];
 poses=poses.map(p=>typeof p==='string'?p:typeof p?.description==='string'?p.description:typeof p?.pose==='string'?p.pose:'');
 if(!poses.length){
  poses=value.split(/\\n/).map(line=>line.replace(/^\\s*(?:[-*]|(?:pose\\s*)?[1-9][.):-])\\s*/i,'').trim())
   .filter(line=>line.length>=12&&!/[{}\\[\\]]/.test(line)).slice(0,4);
 }
 const unique=[],seen=new Set();
 for(const text of poses){
  const trimmed=String(text||'').replace(/\\s+/g,' ').trim().slice(0,240);
  const key=trimmed.toLowerCase();
  if(trimmed.length>=8&&!seen.has(key)){unique.push(trimmed);seen.add(key);}
 }
 return {poses:unique.slice(0,4),note:String(object?.note||'').slice(0,140)};
}

export function createCurtainAiAnimation({run,chat,text,configured,model,guides=()=>CURTAIN_AI_DEFAULT_GUIDES}){
 const err=(status,message)=>Object.assign(new Error(message),{status});
 const clean=body=>{
  const description=String(body?.prompt||'').trim();
  if(description.length<3||description.length>400)throw err(400,'Describe your animation in 3–400 characters');
  if(!configured())throw err(409,'Connect Cloudflare Workers AI in the AI tab first');
  return description;
 };
 const basePrompt=description=>
  'Pixel-art character sprite for a 40x40 LED matrix: '+description+'. '+
  'Create ONE large centered cartoon character, full body within canvas, '+
  'strong coherent silhouette, 8-bit game sprite art, precise squared pixel edges, '+
  'SAME fixed camera, SAME character identity, proportions, colors and scale on every image. '+
  'Completely black background, at most 8 distinct vivid colors, NO captions, NO scenery. ';
 return {
  async generate(body){
   const description=clean(body);
   const tuning=normalizeCurtainAiGuides(guides());
   const pose=String(body?.pose||'').trim().slice(0,240);
   const prompt=basePrompt(description)+(tuning.styleGuide?' Style tuning: '+tuning.styleGuide+'. ':'')+(pose?
    'THIS FRAME MUST DEPICT A VISIBLY DIFFERENT ACTION POSE, NOT A TRANSLATED IMAGE: '+pose+
    '. Keep the subject centered in the same spot but CHANGE its face, limbs or silhouette to perform that action.':
    'Initial resting pose: expression calm and limbs at rest, neutral animation cycle starting position.');
   // Cloudflare FLUX.1 Schnell rejects seed. Keep character identity through prompt only.
   const result=await run('@cf/black-forest-labs/flux-1-schnell',
    {prompt,steps:4},{timeout:90000});
   const image=result?.result?.image??result?.image;
   if(typeof image!=='string'||image.length>5000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))
    throw err(502,'AI did not return valid pixel artwork');
   const bytes=Buffer.from(image,'base64');
   if(bytes.length<500||bytes.length>3750000||bytes[0]!==255||bytes[1]!==216)
    throw err(502,'AI returned invalid JPEG artwork');
   return {ok:true,image:'data:image/jpeg;base64,'+image,
    sourceModel:'@cf/black-forest-labs/flux-1-schnell',
    keyPose:pose||'initial pose',width:40,height:40};
  },
  async motion(body){
   const description=clean(body);
   const tuning=normalizeCurtainAiGuides(guides());
   const fallbacks=fallbackPoses(description);
   let response='';
   try{
    const result=await chat({
     model,messages:[
      {role:'system',content:
       'You are an 8-bit GIF character animator for a 40 by 40 LED curtain. '+
       'Output only JSON with a poses array containing exactly FOUR short concrete visual actions. '+
       'Each frame changes facial expressions, eyes, mouth, arms, wings or silhouette while the '+
       'same subject and center remain fixed. Distinct expressions, no entire-image sliding. '+
       'Example: {"poses":["Both eyes closed","Left eye winking and open O mouth",'+
       '"Both eyes open and wide toothy grin","One eye half open with small smile"]}. '+
       (tuning.motionGuide?'Additional direction: '+tuning.motionGuide+'. ':'')+
       'No introductory text; never animate the entire image moving left/right.'},
      {role:'user',content:description}
     ],max_completion_tokens:1000,temperature:0.2
    },{timeout:45000});
    response=String(text(result)||'');
   }catch(error){
    // Quota, permission and authentication errors should not trigger four
    // costly image calls. For malformed/empty AI text, use real drawn poses.
    if([401,402,403,429].includes(Number(error?.status)))throw error;
   }
   const parsed=parsePosePlan(response);
   const poses=parsed.poses.slice(),usedFallback=poses.length<4;
   for(const candidate of fallbacks){
    if(poses.length>=4)break;
    if(!poses.some(p=>p.toLowerCase()===candidate.toLowerCase()))poses.push(candidate);
   }
   return {ok:true,poses:poses.slice(0,4),note:usedFallback?
     'Generated a compatible four-pose storyboard from your description':
     (parsed.note||'Four distinct character action poses'),
    method:'AI-drawn-keyframes',posePlanSource:usedFallback?'recovered':'cloudflare'};
  }
 };
}
