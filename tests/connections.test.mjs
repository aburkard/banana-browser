import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {resolveStartupConnection,readPreferredConnection}=await server.ssrLoadModule('/src/connections.ts');
await server.close();

test('a saved billing choice wins even when both connections are available',()=>{
  assert.equal(resolveStartupConnection('api',{chatgpt:true,api:true}),'api');
  assert.equal(resolveStartupConnection('chatgpt',{chatgpt:true,api:true}),'chatgpt');
});
test('missing selected credentials never silently change the billing source',()=>{
  assert.equal(resolveStartupConnection('api',{chatgpt:true,api:false}),null);
  assert.equal(resolveStartupConnection('chatgpt',{chatgpt:false,api:true}),null);
});
test('first-time users with two connections must choose; legacy single connections still work',()=>{
  assert.equal(resolveStartupConnection(null,{chatgpt:true,api:true}),null);
  assert.equal(resolveStartupConnection(null,{chatgpt:false,api:false}),null);
  assert.equal(resolveStartupConnection(null,{chatgpt:false,api:true}),'api');
  assert.equal(resolveStartupConnection(null,{chatgpt:true,api:false}),'chatgpt');
});
test('unknown preference values do not authorize a billing source',()=>{
  assert.equal(readPreferredConnection({getItem:()=>'<invalid>'}),null);
});
