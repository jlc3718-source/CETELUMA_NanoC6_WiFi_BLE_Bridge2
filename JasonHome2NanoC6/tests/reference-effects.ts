export const NATIVE_EFFECTS=["Static","Flow1","Flow2","Cycle","Streamlight","Twinkle","Breathe"] as const;
const aliases:Record<string,string>={Solid:"Static","Solid / Static":"Static",Jump:"Cycle",Breath:"Breathe",Strobe:"Twinkle",Chase:"Flow1","Gradient Sweep":"Flow1","Candy Cane":"Flow1","Twinkle / Sparkle":"Twinkle","Wipe / Fill":"Streamlight","Meteor / Comet":"Streamlight","Rainbow Flow":"Flow1","Pulse Wave":"Breathe"};
export function canonicalEffect(value:unknown):string{
  const name=String(value||"Static");
  return (NATIVE_EFFECTS as readonly string[]).includes(name)?name:aliases[name]||"Flow1";
}
