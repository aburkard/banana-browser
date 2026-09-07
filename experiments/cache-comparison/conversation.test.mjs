import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('./conversation.html',import.meta.url),'utf8');
const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'');
function harness({failAt=0,noImage=false,storage=new Map([['gemini_api_key','fake-test-key']])}={}){
  const nodes=new Map();
  const calls=[];
  const parts=[{text:'private model state',thoughtSignature:'private-signature'},{inlineData:{mimeType:'image/png',data:'ZmFrZQ=='}}];
  const context=vm.createContext({
    document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    performance:{now:()=>100},
    GoogleGenAI:class{models={generateContent:async args=>{
      calls.push(args);
      if(calls.length===failAt)throw new Error('private provider error fake-test-key');
      return {candidates:[{content:{parts:noImage?[]:parts}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:747}};
    }};},
    normalizeUsage:()=>({inputTokens:100,outputTokens:747}),estimateUsageCost:()=>({totalCost:0.045}),
    BananaBrowser:{PRICING:{'flash-2':{}}},
  });
  vm.runInContext(source,context);
  return {nodes,calls,parts,storage,run:()=>nodes.get('#run').onclick()};
}

test('exactly three calls, full candidate history, bounded config and duplicate guard',async()=>{
  const h=harness();await Promise.all([h.run(),h.run()]);await h.run();
  assert.equal(h.calls.length,3);
  for(const call of h.calls){assert.equal(call.config.maxOutputTokens,2048);assert.equal(call.config.candidateCount,1);assert.equal(call.config.httpOptions.timeout,90000);assert.equal(call.config.imageConfig.imageSize,'512');}
  assert.equal(h.calls[1].contents[0].parts[0].thoughtSignature,undefined);
  assert.equal(h.calls[2].contents[1].parts,h.parts);
  const report=h.nodes.get('#result').textContent;
  assert.doesNotMatch(report,/fake-test-key|private-signature|private model state|ZmFrZQ/);
  assert.equal(JSON.parse(report).state,'completed');
  const reloaded=harness({storage:h.storage});await reloaded.run();assert.equal(reloaded.calls.length,0);
});
test('errors stop immediately without retry or error disclosure',async()=>{
  for(const failAt of [1,2,3]){const h=harness({failAt});await h.run();await h.run();assert.equal(h.calls.length,failAt);assert.equal(JSON.parse(h.nodes.get('#result').textContent).state,'stopped');assert.doesNotMatch(h.nodes.get('#result').textContent,/fake-test-key|private provider error/);}
});
test('missing images stop after seed; missing credentials never call',async()=>{
  const h=harness({noImage:true});await h.run();assert.equal(h.calls.length,1);
  const empty=harness({storage:new Map()});await empty.run();assert.equal(empty.calls.length,0);
});

test('installed browser SDK does not retry generateContent HTTP failures',async()=>{
  const {GoogleGenAI}=await import('../../node_modules/@google/genai/dist/web/index.mjs');
  const originalFetch=globalThis.fetch;let attempts=0;
  globalThis.fetch=async()=>{attempts++;return new Response('{"error":{"message":"test failure","code":503}}',{status:503,headers:{'content-type':'application/json'}});};
  try{const sdk=new GoogleGenAI({apiKey:'fake-test-key'});await assert.rejects(sdk.models.generateContent({model:'gemini-3.1-flash-image',contents:'offline test',config:{httpOptions:{timeout:100}}}));assert.equal(attempts,1);}
  finally{globalThis.fetch=originalFetch;}
});

test('installed browser SDK aborts timeout without retry',async()=>{
  const {GoogleGenAI}=await import('../../node_modules/@google/genai/dist/web/index.mjs');
  const originalFetch=globalThis.fetch;let attempts=0;
  const keepAlive=setTimeout(()=>{},1000);
  globalThis.fetch=async(_url,options)=>{attempts++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));};
  try{const sdk=new GoogleGenAI({apiKey:'fake-test-key'});await assert.rejects(sdk.models.generateContent({model:'gemini-3.1-flash-image',contents:'offline test',config:{httpOptions:{timeout:10}}}));assert.equal(attempts,1);}
  finally{clearTimeout(keepAlive);globalThis.fetch=originalFetch;}
});
