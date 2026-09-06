import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {SessionStore,SESSION_KEY,readSession} = await server.ssrLoadModule('/src/chatgpt-session.ts');
const {readModelStream,finishBrowserLogin} = await server.ssrLoadModule('/src/subscription.ts');
await server.close();

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key,value) { this.values.set(key,value); }
  removeItem(key) { this.values.delete(key); }
}
const session = (extra={}) => ({accessToken:'access',refreshToken:'refresh',accountId:'account',expiresAt:Date.now()+3600000,...extra});
function fixture() {
  const persistent = new MemoryStorage(), tab = new MemoryStorage();
  let tail = Promise.resolve();
  const lock = work => { const next = tail.then(work); tail = next.catch(()=>{}); return next; };
  return {persistent,tab,lock,store:new SessionStore(persistent,tab,lock)};
}

test('remembered login survives a new tab; ordinary login stays in its tab', async () => {
  const f = fixture();
  await f.store.save(session(),true);
  assert.equal(new SessionStore(f.persistent,new MemoryStorage(),f.lock).read().accessToken,'access');
  await f.store.save(session({accessToken:'tab-only'}),false);
  assert.equal(new SessionStore(f.persistent,new MemoryStorage(),f.lock).read(),null);
  assert.equal(new SessionStore(f.persistent,f.tab,f.lock).read().accessToken,'tab-only');
  f.store.clear();
  assert.equal(f.store.read(),null);
});

test('concurrent tabs refresh once and persist the rotated token', async () => {
  const f = fixture();
  await f.store.save(session({expiresAt:0}),true);
  const other = new SessionStore(f.persistent,new MemoryStorage(),f.lock);
  let calls = 0;
  const renew = async before => { calls++; assert.equal(before.refreshToken,'refresh'); return session({accessToken:'new',refreshToken:'rotated'}); };
  const results = await Promise.all([f.store.token(renew),other.token(renew),f.store.token(renew,true)]);
  assert.equal(calls,1);
  assert.ok(results.every(value=>value.refreshToken==='rotated'));
  assert.equal(readSession(f.persistent).refreshToken,'rotated');
});

test('disconnect wins over a pending refresh', async () => {
  const f = fixture();
  await f.store.save(session({expiresAt:0}),true);
  const work = f.store.token(async () => { f.store.clear(); return session({refreshToken:'rotated'}); });
  await assert.rejects(work,/connection changed/);
  assert.equal(f.store.read(),null);
});

test('cancelled login cannot save credentials after waiting for the lock', async () => {
  const f = fixture(), controller = new AbortController();
  const save = f.store.save(session(),true,controller.signal);
  controller.abort();
  await assert.rejects(save,{name:'AbortError'});
  assert.equal(f.store.read(),null);
});

test('bad or blocked storage is not mistaken for a login', () => {
  const storage = new MemoryStorage();
  for (const value of ['{','null','{}',JSON.stringify(session({expiresAt:'tomorrow'}))]) {
    storage.setItem(SESSION_KEY,value); assert.equal(readSession(storage),null);
  }
  assert.equal(readSession({getItem(){throw new Error('blocked');}}),null);
});

test('uncertain refresh results require reconnecting rather than reusing the token', async () => {
  const f = fixture();
  await f.store.save(session({expiresAt:0}),true);
  await assert.rejects(f.store.token(async()=>{throw new Error('offline');}),/Reconnect/);
  assert.equal(f.store.read(),null);
});

test('duplicated tab-only sessions never reuse a rotated refresh token', async () => {
  const f = fixture();
  await f.store.save(session({expiresAt:0}),false);
  const duplicate = new MemoryStorage();
  duplicate.setItem(SESSION_KEY,f.tab.getItem(SESSION_KEY));
  const other = new SessionStore(f.persistent,duplicate,f.lock);
  const attempts=[];
  const renew=async before=>{ attempts.push(before.refreshToken); return session({accessToken:'new',refreshToken:'rotated'}); };
  const results=await Promise.allSettled([f.store.token(renew),other.token(renew)]);
  assert.deepEqual(attempts,['refresh']);
  assert.equal(results[0].status,'fulfilled');
  assert.equal(results[1].status,'rejected');
  assert.equal(other.read(),null);
  assert.equal(f.store.read().refreshToken,'rotated');
  assert.ok([...f.persistent.values.entries()].every(([key,value])=>!key.includes('rotated')&&!value.includes('rotated')&&value!=='refresh'));
});

test('a duplicate cannot replay a refresh after the first request times out', async () => {
  const f=fixture();
  await f.store.save(session({expiresAt:0}),false);
  const duplicate=new MemoryStorage();
  duplicate.setItem(SESSION_KEY,f.tab.getItem(SESSION_KEY));
  const other=new SessionStore(f.persistent,duplicate,f.lock);
  let calls=0;
  const renew=async()=>{calls++;throw new Error('response lost');};
  const results=await Promise.allSettled([f.store.token(renew),other.token(renew)]);
  assert.equal(calls,1);
  assert.ok(results.every(result=>result.status==='rejected'));
});

test('successful renewal without token rotation remains usable', async () => {
  const f=fixture();
  await f.store.save(session({expiresAt:0}),false);
  let calls=0;
  const renew=async()=>{calls++;return session();};
  await f.store.token(renew);
  await f.store.token(renew,true);
  assert.equal(calls,2);
});

const stream = events => new Response(new ReadableStream({start(controller) {
  const bytes = new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  for(let n=0;n<bytes.length;n+=7) controller.enqueue(bytes.slice(n,n+7));
  controller.close();
}}));
test('stream preserves finished items and usage across split UTF-8/SSE chunks', async () => {
  const result = await readModelStream(stream([
    {type:'response.output_item.done',item:{type:'message',content:[{type:'output_text',text:'Read 🍌'}]}},
    {type:'response.output_item.done',item:{type:'image_generation_call',status:'completed',result:'aW1hZ2U='}},
    {type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:186,output_tokens:10}}},
  ]));
  assert.equal(result.text,'Read 🍌');
  assert.equal(result.image,'data:image/png;base64,aW1hZ2U=');
  assert.deepEqual(result.usage,{input_tokens:186,output_tokens:10});
});
test('truncated and failed streams never count as success', async () => {
  await assert.rejects(readModelStream(stream([])),/ended early/);
  await assert.rejects(readModelStream(stream([{type:'response.failed'}])),/could not finish/);
});
test('main sign-in rejects a wrong callback or state before loading any transport', async () => {
  const pending = {state:'expected',expiresAt:Date.now()+60000};
  const signal = new AbortController().signal;
  await assert.rejects(finishBrowserLogin('http://evil.example/auth/callback?state=expected&code=abc',pending,false,signal),/localhost/);
  await assert.rejects(finishBrowserLogin('http://localhost:1455/auth/callback?state=other&code=abc',pending,false,signal),/different sign-in/);
});
