declare module "node:crypto" {
  export function createHash(name:string): any;
  export function createHmac(name:string,key:any): any;
  export function createCipheriv(name:string,key:any,iv:any): any;
  export function createDecipheriv(name:string,key:any,iv:any): any;
  export function createECDH(curve:string): any;
  export function randomBytes(size:number): any;
}
declare module "node:tls" {
  export function connect(options:any, callback?:()=>void): any;
  export function checkServerIdentity(hostname:string, cert:any): Error | undefined;
}
declare module "node:dns" {
  export const promises:any;
}
declare const Buffer: any;
type Buffer = any;
