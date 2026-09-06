import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {createProgress}=await server.ssrLoadModule('/src/progress.ts');
await server.close();

test('elapsed time continues across real phases, stops on completion, and restarts for the next operation',t=>{
  let now=100;
  let tick;
  t.mock.method(performance,'now',()=>now);
  t.mock.method(globalThis,'setInterval',callback=>{tick=callback; return 123;});
  const clear=t.mock.method(globalThis,'clearInterval',()=>{});
  let text;
  const progress=createProgress(value=>{text=value;});
  progress.update(true,'Fetching data...');
  assert.equal(text,'Fetching data... · 0s elapsed');
  now+=65000; tick();
  assert.equal(text,'Fetching data... · 65s elapsed');
  progress.update(true,'Generating webpage image...');
  assert.equal(text,'Generating webpage image... · 65s elapsed');
  progress.update(false,'Page loaded');
  assert.equal(text,'Page loaded');
  assert.equal(clear.mock.calls.at(-1).arguments[0],123);
  progress.update(true,'Interpreting click...');
  assert.equal(text,'Interpreting click... · 0s elapsed');
  progress.update(false,'Error');
  assert.equal(text,'Error');
});

test('disposing clears the timer and ignores late state changes',t=>{
  const interval=t.mock.method(globalThis,'setInterval',()=>123);
  const clear=t.mock.method(globalThis,'clearInterval',()=>{});
  const output=[];
  const progress=createProgress(text=>output.push(text));
  progress.update(true,'Generating...');
  progress.dispose();
  progress.update(true,'Late response');
  assert.equal(interval.mock.callCount(),1);
  assert.equal(clear.mock.calls.at(-1).arguments[0],123);
  assert.equal(output.length,1);
});
