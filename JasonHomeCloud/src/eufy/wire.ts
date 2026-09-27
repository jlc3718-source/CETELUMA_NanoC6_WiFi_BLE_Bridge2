export function concat(...parts:Uint8Array[]):Uint8Array{
  return new Uint8Array(Buffer.concat(parts.map(p=>Buffer.from(p))));
}
export function tlv(tag:number,value:Uint8Array):Uint8Array{
  if(value.length>255)throw new Error("TLV too long");
  return concat(new Uint8Array([tag,value.length]),value);
}
export function dpCommand(opcode:number,account:string,commandFields:Uint8Array,timestamp:number):Uint8Array{
  if(!account)throw new Error("Account identity missing");
  if((opcode&0xff00)!==0x0200)throw new Error(`Unsupported lighting opcode 0x${opcode.toString(16)}`);
  const ts=new Uint8Array([timestamp&255,(timestamp>>>8)&255,(timestamp>>>16)&255,(timestamp>>>24)&255]);
  const fields=concat(tlv(0xa1,ts),tlv(0xa2,new TextEncoder().encode(account)),commandFields||new Uint8Array());
  const size=10+fields.length;
  const head=new Uint8Array([0xff,9,size&255,(size>>>8)&255,3,0,2,(opcode>>>8)&255,opcode&255]);
  const body=concat(head,fields);
  let xor=0;for(const b of body)xor^=b;
  return concat(body,new Uint8Array([xor]));
}
export function statusFields():Uint8Array{return new Uint8Array([0xa3,2,0xff,0x1f]);}
export function powerFields(on:boolean):Uint8Array{return new Uint8Array([0xa3,1,on?1:0]);}
