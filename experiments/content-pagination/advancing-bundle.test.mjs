import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Window} from 'happy-dom';
const variants=[
 {directory:'advancing-article-check',target:1400,count:3,lock:'banana-advancing-article-v1',sizing:false},
 {directory:'advancing-article-1000',target:1000,count:4,lock:'banana-advancing-size-v1-1000',sizing:true},
 {directory:'advancing-article-2200',target:2200,count:2,lock:'banana-advancing-size-v1-2200',sizing:true},
];
for(const variant of variants){
 let bundle;try{bundle=await readFile(new URL(`../../public/tmp/${variant.directory}/advancing.js`,import.meta.url),'utf8');}catch{}
 test(`${variant.directory}: manual progression, exact source, exhaustion, cached navigation and reload lock`,{skip:!bundle},async()=>{
  const nodes=new Map(),storage=new Map([['gemini_api_key','fake-gemini']]);let images=0;
  const document=new Window().document;
  const drawing={drawImage(){}};
  const context=vm.createContext({document:{createElement:document.createElement.bind(document),querySelector(s){if(!nodes.has(s))nodes.set(s,{getContext:()=>drawing});return nodes.get(s)}},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  Image:class{naturalWidth=1536;naturalHeight=1024;set src(_){queueMicrotask(()=>this.onload())}},console:{log(){},info(){},warn(){},error(){}},URL,Headers,Response,AbortController,AbortSignal,setTimeout,clearTimeout,performance,
  fetch:async(url,options)=>{if(String(url).includes('generativelanguage')){images++;const body=JSON.parse(options.body);assert.equal(body.generationConfig.imageConfig.imageSize,'1K');assert.equal(body.generationConfig.maxOutputTokens,2048);return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:1120}});}return new Response('',{status:404});}
  });vm.runInContext(bundle,context);
  assert.equal(images,0,'loading a page must not call a model');assert.equal(storage.has(variant.lock),false);
  assert.match(nodes.get('#headings').textContent,/Jacksonville/);
  assert.match(nodes.get('#experiment-summary').textContent,new RegExp(`${variant.target}-character target · ${variant.count} passages`));
  await nodes.get('#generate').onclick();assert.equal(images,1);
  for(let index=1;index<variant.count;index++)await nodes.get('#scroll').onclick();
  await nodes.get('#scroll').onclick();await nodes.get('#history').onclick();await nodes.get('#generate').onclick();
  const report=JSON.parse(nodes.get('#report').textContent);
  assert.equal(report.variant,variant.sizing?'advancing-size':'advancing-source');assert.equal(report.targetChars,variant.target);assert.equal(report.maxImages,variant.sizing?5:3);
  assert.equal(report.state,'completed');assert.equal(report.images,variant.count);assert.equal(images,variant.count);assert.equal(report.scroll,variant.count-1);
  assert.ok(report.checks.every(check=>check.matches));assert.ok(report.checks.some(check=>check.scrollPrompt));assert.doesNotMatch(nodes.get('#report').textContent,/fake-gemini|aW1hZ2U=/);
  assert.deepEqual(report.checks.filter(check=>check.kind==='input-source').map(check=>check.window.hasMore),Array.from({length:variant.count},(_,index)=>index<variant.count-1));
  assert.equal(JSON.parse(storage.get(variant.lock)).images,variant.count);
  vm.runInContext(bundle,context);assert.equal(nodes.get('#generate').disabled,true);await nodes.get('#generate').onclick();assert.equal(images,variant.count,'saved variant lock prevents another run');
 });
}
