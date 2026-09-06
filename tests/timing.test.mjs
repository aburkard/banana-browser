import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {startTiming,timed}=await server.ssrLoadModule('/src/timing.ts');
await server.close();

test('timing records cumulative milestones once without payloads',t=>{
  let now=100;
  t.mock.method(performance,'now',()=>now);
  const log=t.mock.method(console,'info',()=>{});
  const mark=startTiming('ChatGPT image');
  now=250;mark('First stream event');
  now=500;mark('First stream event');mark('Image output received');
  assert.equal(log.mock.callCount(),2);
  assert.equal(log.mock.calls[0].arguments[1].elapsedMs,150);
  assert.equal(log.mock.calls[1].arguments[1].elapsedMs,400);
  assert.deepEqual(Object.keys(log.mock.calls[0].arguments[1]).sort(),['elapsedMs','id','phase','scope']);
});

test('timed work returns its result or original failure without retrying or logging the error',async t=>{
  const log=t.mock.method(console,'info',()=>{});
  assert.equal(await timed('Source data',async()=>42),42);
  const error=new Error('sensitive request data');
  let calls=0;
  await assert.rejects(timed('Source data',async()=>{calls++;throw error;}),value=>value===error);
  assert.equal(calls,1);
  assert.equal(log.mock.calls[1].arguments[1].phase,'failed');
  assert.doesNotMatch(JSON.stringify(log.mock.calls.map(call=>call.arguments)),/sensitive/);
});
