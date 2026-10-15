import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const headers=require('../curtain_image_headers.js');
const converter=readFileSync(join(root,'curtain_converter.html'),'utf8');
const server=readFileSync(join(root,'server.mjs'),'utf8');

test('JPEG dimensions are detected from bytes even when filename says .png',()=>{
 const exif=Buffer.from([0xff,0xd8,0xff,0xe0,0,4,0,0,
   0xff,0xc0,0,17,8,0x05,0xdc,0x06,0,3,1,0x11,0,2,0x11,0,3,0x11,0,
   0xff,0xd9]);
 const result=headers.sniff(exif);
 assert.deepEqual(result,{width:1536,height:1500,mime:'image/jpeg'});
});
test('PNG, GIF and WebP dimension detection',()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,4,0,0,0,2,0]);
 assert.deepEqual(headers.sniff(png),{width:1024,height:512,mime:'image/png'});
 const gif=Buffer.from('GIF89a\x28\x00\x28\x00','binary');
 assert.deepEqual(headers.sniff(gif),{width:40,height:40,mime:'image/gif'});
 const webp=Buffer.from([82,73,70,70,50,0,0,0,87,69,66,80,86,80,56,88,10,0,0,0,0,0,0,0,39,0,0,39,0,0]);
 assert.deepEqual(headers.sniff(webp),{width:40,height:40,mime:'image/webp'});
});
test('Large image dimension probe reads only 1MB instead of full picture',async()=>{
 let endRead=-1;
 const file={size:35_000_000,slice(start,end){
  endRead=end;
  return {async arrayBuffer(){
   const bytes=new Uint8Array(24);
   bytes.set([137,80,78,71,13,10,26,10],0);
   bytes.set([0,0,0,13,73,72,68,82],8);
   bytes.set([0,0,23,112,0,0,11,184],16);
   return bytes.buffer;
  }};
 }};
 const dim=await headers.dimensions(file);
 assert.equal(endRead,1048576);
 assert.deepEqual(dim,{width:6000,height:3000,mime:'image/png'});
});
test('Hosted converter does not need a blob URL to read common photo dimensions',()=>{
 assert.match(converter,/CurtainImageHeaders\.dimensions\(file\)/);
 assert.match(converter,/const source=mime&&file\.type!==mime\?new Blob/);
 assert.match(converter,/const \{width,height,mime\}=await imageDimensions\(file\)/);
 assert.match(server,/img-src 'self' blob: data:/);
});
