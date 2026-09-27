import { EufyClient } from "../src/eufy/client";

const email=process.env.EUFY_EMAIL||"";
const password=process.env.EUFY_PASSWORD||"";
if(!email||!password)throw new Error("EUFY_EMAIL/EUFY_PASSWORD secrets required");

const env:any={EUFY_EMAIL:email,EUFY_PASSWORD:password};
const installId="7f2e4a0b1c3d5e6f8091a2b3c4d5e6f7";
const client=new EufyClient(env,installId);

console.log("LINUX PROBE: authenticating and discovering Eufy devices");
await client.prepare(true);
const names=client.readyNames();
console.log("LINUX PROBE READY:",names.join(", "));
for(const expected of ["Pool","House","Garage","Shed"]){
  if(!names.includes(expected))throw new Error("Missing expected light: "+expected);
}
console.log("LINUX PROBE: requesting Pool status only; no state change will be sent");
const result=await client.status("Pool");
console.log("LINUX MQTT STATUS PASS",JSON.stringify({published:result.published,instance:(result as any).instance||null,report:result.report||null}));
