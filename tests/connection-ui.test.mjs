import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';

const authKey='banana_chatgpt_v1';
const preferenceKey='banana_connection_mode';
const fakeAuth=JSON.stringify({accessToken:'fake-access',refreshToken:'fake-refresh',accountId:'fake-account',expiresAt:Date.now()+3600000});

async function fixture(t,{mode='chatgpt',auth=true,keys=true}={}) {
  const window=new Window({url:'http://127.0.0.1:5178/banana-browser/'});
  const globals={window,document:window.document,localStorage:window.localStorage,sessionStorage:window.sessionStorage,navigator:{locks:{request:async(_name,work)=>work()}}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,value});
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Live requests are forbidden in connection tests');});
  t.after(async()=>{
    assert.equal(fetch.mock.callCount(),0,'billing controls must not make model requests');
    await window.happyDOM.close();
    for(const [key,descriptor] of previous) {
      if(descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  });
  if(mode) window.localStorage.setItem(preferenceKey,mode);
  if(auth) window.localStorage.setItem(authKey,fakeAuth);
  if(keys) {
    window.localStorage.setItem('gemini_api_key','fake-gemini');
    window.localStorage.setItem('openai_api_key','fake-openai');
  }
  async function reload() {
    window.document.body.innerHTML='<div id="app"></div>';
    const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
    try { await server.ssrLoadModule('/src/main.ts'); }
    finally { await server.close(); }
  }
  await reload();
  return {window,storage:window.localStorage,el:selector=>window.document.querySelector(selector),reload};
}

test('API choice requires confirmation, cancellation preserves credentials, and switching preserves ChatGPT',async t=>{
  const f=await fixture(t);
  assert.match(f.el('#reset-key-btn').textContent,/ChatGPT plan/);
  assert.deepEqual([...f.el('#model-select').options].map(o=>o.value),['gpt-image-2']);
  f.el('#reset-key-btn').click();
  f.el('.api-key-option').open=true;
  f.el('#gemini-key').value='new-fake-gemini';
  f.el('#start-btn').click();
  assert.equal(f.el('#api-confirmation').open,true);
  assert.match(f.el('#api-confirmation').textContent,/Billed to your API keys/);
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
  f.el('#cancel-api').click();
  assert.equal(f.el('#api-confirmation').open,false);
  f.el('#confirm-api').click();
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
  assert.equal(f.storage.getItem('gemini_api_key'),'fake-gemini');

  f.el('#start-btn').click();
  f.el('#confirm-api').click();
  assert.equal(f.storage.getItem(preferenceKey),'api');
  assert.equal(f.storage.getItem('gemini_api_key'),'new-fake-gemini');
  assert.equal(f.storage.getItem(authKey),fakeAuth);
  assert.match(f.el('#reset-key-btn').textContent,/API credits/);
  const models=[...f.el('#model-select').options].map(o=>o.value);
  assert.ok(models.includes('flash-lite')&&models.includes('gpt-image-2'));
  f.el('#model-select').value='flash-lite';
  f.el('#model-select').dispatchEvent(new f.window.Event('change'));
  assert.match(f.el('#price-badge').textContent,/\$/);
  await f.reload();
  assert.match(f.el('#reset-key-btn').textContent,/API credits/);
});

test('switching back to the ChatGPT plan preserves API keys and survives reload',async t=>{
  const f=await fixture(t,{mode:'api'});
  f.el('#reset-key-btn').click();
  f.el('#resume-chatgpt').click();
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
  assert.equal(f.storage.getItem('gemini_api_key'),'fake-gemini');
  assert.equal(f.storage.getItem('openai_api_key'),'fake-openai');
  assert.equal(f.el('#price-badge').textContent,'');
  await f.reload();
  assert.match(f.el('#reset-key-btn').textContent,/ChatGPT plan/);
});

test('an unavailable selected connection opens setup without silently using the other billing source',async t=>{
  const f=await fixture(t,{mode:'chatgpt',auth:false});
  assert.equal(f.el('#go-btn'),null);
  assert.ok(f.el('#connect-chatgpt'));
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
});

test('two existing connections without a preference require a choice',async t=>{
  const f=await fixture(t,{mode:null});
  assert.equal(f.el('#go-btn'),null);
  assert.equal(f.el('#chatgpt-connected').hidden,false);
  assert.equal(f.storage.getItem(preferenceKey),null);
});
