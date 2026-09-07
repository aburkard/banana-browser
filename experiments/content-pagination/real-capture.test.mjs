import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {capture,SOURCES} from './real-capture.mjs';
test('capture makes only two bounded source requests and writes a manifest using production processors',async()=>{
 const outputDirectory=await mkdtemp(path.join(tmpdir(),'banana-capture-unit-'));const requests=[];
 try{
  const manifest=await capture({outputDirectory,fetchImpl:async(url,options)=>{requests.push({url,options});return Response.json(url.includes('espn')?{articles:[]}:[]);}});
  assert.deepEqual(requests.map(request=>request.url),SOURCES.map(source=>source.url));assert.ok(requests.every(request=>request.options.signal&&request.options.redirect==='error'));
  assert.equal(manifest.sources.length,2);assert.ok(manifest.sources.every(source=>source.sha256.length===64&&source.sections===1));assert.deepEqual(manifest.allowedDetailUrls,[]);
  assert.deepEqual(JSON.parse(await readFile(path.join(outputDirectory,'manifest.json'),'utf8')),manifest);
 }finally{await rm(outputDirectory,{recursive:true,force:true});}
});
test('capture does not retry failed public requests',async()=>{
 let count=0;await assert.rejects(capture({fetchImpl:async()=>{count++;return new Response('',{status:503});}}));assert.equal(count,1);
});
