import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const bundle=(await build({entryPoints:[fileURLToPath(new URL('./live.mjs',import.meta.url))],bundle:true,platform:'browser',format:'iife',write:false})).outputFiles[0].text;
function setup(fail=false){
 const nodes=new Map(),storage=new Map([['gemini_api_key','fake-gemini'],['openai_api_key','fake-openai']]),calls=[];
 let pointerStrokes=0;
 const drawing={drawImage(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){pointerStrokes++},arc(){}};
 const node=()=>({disabled:false,getContext:()=>drawing,getBoundingClientRect:()=>({left:0,top:0,width:768,height:512}),toDataURL:()=> 'data:image/png;base64,cG9pbnRlcg=='});
 const context=vm.createContext({
  document:{querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s)},createElement:node},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
  Image:class{width=768;height=512;naturalWidth=768;naturalHeight=512;set src(_){queueMicrotask(()=>this.onload())}},
  console:{log(){},warn(){},info(){},error(){}},URL,Headers,Response,AbortSignal,AbortController,setTimeout,clearTimeout,performance,
  fetch:async(url,options)=>{
   const body=JSON.parse(options.body);calls.push({url:String(url),body});
   if(fail)return new Response('{"error":{"message":"fake error"}}',{status:503});
   if(String(url).includes('generativelanguage'))return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:'aW1hZ2U='}}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:747}});
   return Response.json({output:[{type:'message',content:[{type:'output_text',text:'{"action":"navigate","url":"https://api.tvmaze.com/shows/118"}'}]}],usage:{input_tokens:100,output_tokens:20}});
  }
 });vm.runInContext(bundle,context);
 return {nodes,storage,calls,strokes:()=>pointerStrokes,report:()=>JSON.parse(nodes.get('#report').textContent)};
}
test('production section prompts, later continuity and red-pointer click stay bounded',async()=>{
 const h=setup();await h.nodes.get('#generate').onclick();assert.equal(h.calls.length,2);assert.equal(h.report().state,'awaiting-selected-click');assert.ok(h.report().sectionCount>=2);
 assert.ok(h.report().checks.every(check=>check.sourceMatches));
 for(const call of h.calls){assert.equal(call.body.generationConfig.maxOutputTokens,2048);assert.equal(call.body.generationConfig.imageConfig.imageSize,'512');}
 assert.ok(h.calls[1].body.contents.some(content=>content.parts.some(part=>part.inlineData)),'last section receives prior image');
 await h.nodes.get('#last').onclick({clientX:100,clientY:100});await h.nodes.get('#last').onclick({clientX:200,clientY:200});await h.nodes.get('#generate').onclick();
 assert.equal(h.calls.length,3);assert.equal(h.calls[2].body.max_output_tokens,512);assert.equal(h.calls[2].body.model,'gpt-5.6-luna');assert.equal(h.strokes(),2);assert.equal(h.report().state,'completed');
 assert.equal(h.report().imageFetchAttempts,2);assert.equal(h.report().clickAttempts,1);assert.doesNotMatch(h.nodes.get('#report').textContent,/fake-gemini|fake-openai|aW1hZ2U|cG9pbnRlcg/);
});
test('first failure stops the experiment without retry or enabled click',async()=>{
 const h=setup(true);await h.nodes.get('#generate').onclick();await h.nodes.get('#generate').onclick();await h.nodes.get('#last').onclick({clientX:1,clientY:1});assert.equal(h.calls.length,1);assert.equal(h.report().state,'stopped');
});
