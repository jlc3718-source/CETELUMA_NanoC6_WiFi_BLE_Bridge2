import { createCipheriv, createDecipheriv, createECDH, createHash, createHmac, randomBytes } from "node:crypto";

export const LOCAL_KEY_HEX = "2500a7d5617812f9d52515b2c8f20a3d";
export const SERVER_PUBLIC_HEX = "04c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a3868d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076";

export function randomId(bytes=16): string { return randomBytes(bytes).toString("hex"); }
export function md5(value: string): string { return createHash("md5").update(value, "utf8").digest("hex"); }
export function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
export function sign(keyHex:string,ts:string,once:string,body:string):string{
  return createHmac("sha256",Buffer.from(keyHex.slice(0,32),"utf8"))
    .update(`${ts}+${once}+${body}`,"utf8").digest("hex");
}
function aesName(key:any):string{
  if(key.length===16)return "aes-128-cbc";
  if(key.length===24)return "aes-192-cbc";
  if(key.length===32)return "aes-256-cbc";
  throw new Error("Unsupported AES key length");
}
export function aesEncryptText(plain:string,keyHex:string):string{
  const key=Buffer.from(keyHex,"hex"),iv=randomBytes(16),cipher=createCipheriv(aesName(key),key,iv);
  const encrypted=Buffer.concat([cipher.update(Buffer.from(plain,"utf8")),cipher.final()]);
  return Buffer.concat([iv,encrypted]).toString("base64");
}
export function aesDecryptText(input:string,keyHex:string):string{
  const raw=Buffer.from(input,"base64");
  if(raw.length<32||raw.length%16!==0)throw new Error("Invalid encrypted body length");
  const key=Buffer.from(keyHex,"hex"),iv=raw.subarray(0,16),dec=createDecipheriv(aesName(key),key,iv);
  return Buffer.concat([dec.update(raw.subarray(16)),dec.final()]).toString("utf8");
}
export function newEcdh():{publicHex:string;secret(serverPublicHex:string):Uint8Array}{
  const ecdh=createECDH("prime256v1");ecdh.generateKeys();
  return {publicHex:ecdh.getPublicKey("hex","uncompressed"),secret(serverPublicHex:string){return new Uint8Array(ecdh.computeSecret(Buffer.from(serverPublicHex,"hex")));}};
}
export function encryptPassword(password:string):{publicKey:string;cipherText:string}{
  const ecdh=newEcdh(),key=Buffer.from(ecdh.secret(SERVER_PUBLIC_HEX)),iv=key.subarray(0,16),cipher=createCipheriv(aesName(key),key,iv);
  const encrypted=Buffer.concat([cipher.update(Buffer.from(password,"utf8")),cipher.final()]);
  return {publicKey:ecdh.publicHex,cipherText:encrypted.toString("base64")};
}
