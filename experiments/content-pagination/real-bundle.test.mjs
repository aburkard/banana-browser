import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
let bundle;
try{bundle=await readFile(new URL('../../public/tmp/real-content-check/real.js',import.meta.url),'utf8');}catch{}
test('captured real fixtures exercise production navigation, scroll, click detail and history offline',{skip:!bundle},async()=>{
 const tv=JSON.parse(await readFile(new URL('../../tmp/real-content-fixtures/tvmaze.json',import.meta.url),'utf8'));
 const episode=tv.find(item=>item.id===67390);assert.ok(episode);
 const nodes=new Map(),storage=new Map([['gemini_api_key','fake-gemini'],['openai_api_key','fake-openai']]),calls=[];
 const drawing={drawImage(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},arc(){}};
 const node=()=>({disabled:false,getContext:()=>drawing,getBoundingClientRect:()=>({left:0,top:0,width:768,height:512}),toDataURL:()=> 'data:image/png;base64,cG9pbnRlcg=='});
 const context=vm.createContext({
  document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},createElement:node},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  Image:class{width=768;height=512;naturalWidth=768;naturalHeight=512;set src(_){queueMicrotask(()=>this.onload())}},
  console:{log(){},warn(){},info(){},error(){}},crypto:webcrypto,TextEncoder,URL,Headers,Response,AbortSignal,AbortController,setTimeout,clearTimeout,performance,btoa,
  fetch:async(url,options={})=>{
   calls.push(String(url));
   if(String(url).includes('generativelanguage'))return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:747}});
   if(String(url)==='https://api.openai.com/v1/responses')return Response.json({output:[{type:'message',content:[{type:'output_text',text:'{"action":"navigate","url":"https://api.tvmaze.com/episodes/67390"}'}]}],usage:{input_tokens:100,output_tokens:20}});
   if(String(url)==='https://api.tvmaze.com/episodes/67390')return Response.json(episode);
   return new Response('',{status:404});
  }
 });vm.runInContext(bundle,context);
 const click=selector=>nodes.get(selector).onclick();
 await click('#espn');await click('#later');await click('#scroll');
 let report=JSON.parse(nodes.get('#report').textContent);assert.equal(report.espn.images,3);assert.equal(report.espn.view.section,11);assert.equal(report.espn.view.scroll,1);assert.equal(report.espn.stopped,false);assert.ok(report.espn.checks.some(check=>check.kind==='scroll-source-unchanged'&&check.matches));
 await click('#done');await click('#tvmaze');await click('#later');await nodes.get('#image').onclick({clientX:100,clientY:100});await click('#history');
 report=JSON.parse(nodes.get('#report').textContent);assert.equal(report.tvmaze.images,3);assert.equal(report.tvmaze.clicks,1);assert.equal(report.tvmaze.details,1);assert.equal(report.tvmaze.stopped,false);assert.equal(report.tvmaze.view.sections,2);
 const history=report.tvmaze.checks.find(check=>check.kind==='history');assert.ok(history.back&&history.forward&&history.finalBack&&history.noCalls);
 assert.doesNotMatch(nodes.get('#report').textContent,/fake-gemini|fake-openai|aW1hZ2U|cG9pbnRlcg/);assert.equal(calls.filter(url=>url.includes('generativelanguage')).length,6);
});
