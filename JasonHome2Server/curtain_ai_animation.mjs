// Cloudflare AI draws actual DIFFERENT 40x40 sprite poses, never shifts a still
// image to masquerade as animation. Nano executes encoded deltas independently.
import {createHash} from 'node:crypto';
export function createCurtainAiAnimation({run,chat,text,configured,model}){
 const err=(status,message)=>Object.assign(new Error(message),{status});
 const clean=body=>{
  const description=String(body?.prompt||'').trim();
  if(description.length<3||description.length>400)throw err(400,'Describe your animation in 3–400 characters');
  if(!configured())throw err(409,'Connect Cloudflare Workers AI in the AI tab first');
  return description;
 };
 const seedFor=s=>createHash('sha256').update(s).digest().readUInt32BE(0);
 const basePrompt=description=>
  'Pixel-art character sprite for a 40x40 LED matrix: '+description+'. '+
  'Create ONE large centered cartoon character, full body within canvas, '+
  'strong coherent silhouette, 8-bit game sprite art, precise squared pixel edges, '+
  'SAME fixed camera, SAME character identity, proportions, colors and scale on every image. '+
  'Completely black background, at most 8 distinct vivid colors, NO captions, NO scenery. ';
 return {
  async generate(body){
   const description=clean(body);
   const pose=String(body?.pose||'').trim().slice(0,240);
   const prompt=basePrompt(description)+(pose?
    'THIS FRAME MUST DEPICT A VISIBLY DIFFERENT ACTION POSE, NOT A TRANSLATED IMAGE: '+pose+
    '. Keep the subject centered in the same spot but CHANGE its face, limbs or silhouette to perform that action.':
    'Initial resting pose: expression calm and limbs at rest, neutral animation cycle starting position.');
   // A shared seed helps pose identity remain consistent between requests.
   const result=await run('@cf/black-forest-labs/flux-1-schnell',
    {prompt,steps:4,seed:seedFor(description)},{timeout:90000});
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
   const result=await chat({
    model,messages:[
     {role:'system',content:
      'You are an expert 8-bit GIF animator for one 40x40 LED sprite. '+ 
      'Produce exactly FOUR concrete visual keyframe POSE descriptions that show actual '+ 
      'changes in the SAME character/artwork, not movement of the entire image. '+ 
      'Examples: eyelids close/open, mouth changes smile shape, wings fold/unfold, '+ 
      'arms wave with distinct joint positions, flame changes outline, tail curls or swings. '+ 
      'The input artist supplies the same character. Keep centered silhouette/size and black backdrop. '+ 
      'Return ONLY strict JSON {"poses":["...","...","...","..."],"note":"..."}. '+ 
      'Make the poses a complete visual action cycle that naturally returns to the initial neutral pose. '+ 
      'Do not put left-right translation, horizontal sliding, orbiting, bouncing or whole-sprite panning in any pose. '+ 
      'Each description must specify precisely what part of the character LOOKS DIFFERENT.'},
     {role:'user',content:description}
    ],max_completion_tokens:430,temperature:0.35
   },{timeout:45000});
   const raw=String(text(result)||''),start=raw.indexOf('{'),end=raw.lastIndexOf('}');
   let plan={};if(start>=0&&end>start)try{plan=JSON.parse(raw.slice(start,end+1));}catch{}
   const poses=Array.isArray(plan.poses)?plan.poses.map(x=>String(x||'').trim()).filter(x=>x.length>=8&&x.length<=240):[];
   if(poses.length!==4||new Set(poses.map(x=>x.toLowerCase())).size!==4)
    throw err(502,'AI animation pose plan incomplete; retry Animate');
   return {ok:true,poses,note:String(plan.note||'Four distinct character action poses').slice(0,140),method:'AI-drawn-keyframes'};
  }
 };
}
