import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
let bundle;try{bundle=await readFile(new URL('../../public/tmp/article-fix-check/article-fix.js',import.meta.url),'utf8');}catch{}
test('actual article source selection and production scroll run twice with a mocked provider',{skip:!bundle},async()=>{
 const nodes=new Map(),storage=new Map([['gemini_api_key','fake-gemini']]);let images=0;
 const drawing={drawImage(){}};
 const context=vm.createContext({document:{querySelector(s){if(!nodes.has(s))nodes.set(s,{getContext:()=>drawing});return nodes.get(s)}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
 Image:class{naturalWidth=1536;naturalHeight=1024;set src(_){queueMicrotask(()=>this.onload())}},console:{log(){},info(){},warn(){},error(){}},URL,Headers,Response,AbortController,AbortSignal,setTimeout,clearTimeout,performance,
 fetch:async(url,options)=>{if(String(url).includes('generativelanguage')){images++;const body=JSON.parse(options.body);assert.equal(body.generationConfig.imageConfig.imageSize,'1K');assert.equal(body.generationConfig.maxOutputTokens,2048);return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:1120}});}return new Response('',{status:404});}
 });vm.runInContext(bundle,context);
 assert.match(nodes.get('#headings').textContent,/Jacksonville/);await nodes.get('#generate').onclick();await nodes.get('#scroll').onclick();await nodes.get('#scroll').onclick();await nodes.get('#generate').onclick();
 const report=JSON.parse(nodes.get('#report').textContent);assert.equal(report.state,'completed');assert.equal(report.images,2);assert.equal(images,2);assert.equal(report.scroll,1);assert.ok(report.checks.every(check=>check.matches));assert.ok(report.checks.some(check=>check.scrollPrompt));assert.doesNotMatch(nodes.get('#report').textContent,/fake-gemini|aW1hZ2U=/);
 console.log(JSON.stringify({section:report.section,sectionCount:report.sectionCount,sourceChars:report.checks.find(check=>check.kind==='input-source').sourceChars,teamHeadings:report.teamHeadings}));
});
