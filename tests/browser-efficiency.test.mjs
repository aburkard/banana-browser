import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser} = await server.ssrLoadModule('/src/browser.ts');
const {BoundedCache} = await server.ssrLoadModule('/src/cache.ts');
await server.close();
function setup(t) {
  t.mock.method(console,'log',()=>{});
  const browser = new BananaBrowser('test', 'test');
  let version=1, calls=0;
  t.mock.method(browser,'fetchApiData',async url=>({url,version}));
  t.mock.method(browser,'generatePageImage',async()=>`image-${++calls}`);
  return {browser, calls:()=>calls, change:()=>version++};
}
test('Back/Forward retain paid scroll views and position without another model call',async t=>{
  const {browser:b,calls}=setup(t);
  await b.navigate('https://example.com/a');
  await b.scrollDown(); await b.scrollDown();
  await b.navigate('https://example.com/b'); await b.scrollDown();
  await b.goBack();
  assert.equal(b.state.currentImage,'image-3'); assert.equal(b.state.scrollDepth,3);
  await b.scrollUp(); await b.scrollDown();
  await b.goForward();
  assert.equal(b.state.currentImage,'image-5'); assert.equal(b.state.scrollIndex,1);
  assert.equal(calls(),5);
});
test('render cache checks current data, options, click context, and instance',async t=>{
  const {browser:b,calls,change}=setup(t);
  const url='https://example.com/a';
  await b.navigate(url); await b.navigate(url); assert.equal(calls(),1);
  b.setImageOptions({quality:'high'}); await b.navigate(url); assert.equal(calls(),2);
  change(); await b.navigate(url); assert.equal(calls(),3);
  await b.navigate(url,false); assert.equal(calls(),4);
  const other=setup(t); await other.browser.navigate(url); assert.equal(other.calls(),1);
});
test('failed navigation preserves URL, source and all scroll images',async t=>{
  const {browser:b}=setup(t);
  await b.navigate('https://example.com/a'); await b.scrollDown();
  t.mock.method(b,'fetchApiData',async()=>{throw new Error('offline')});
  await b.navigate('https://example.com/b');
  assert.equal(b.state.currentUrl,'https://example.com/a'); assert.equal(b.state.currentImage,'image-2');
  assert.equal(b.state.currentApiData.url,'https://example.com/a'); assert.equal(b.state.error,'offline');
  await b.scrollUp(); assert.equal(b.state.currentImage,'image-1');
});
test('concurrent navigation starts only one source/model request',async t=>{
  const {browser:b,calls}=setup(t);
  let release;
  const source=t.mock.method(b,'fetchApiData',()=>new Promise(resolve=>{release=resolve}));
  const first=b.navigate('https://example.com/a');
  await b.navigate('https://example.com/b');
  release({title:'a'}); await first;
  assert.equal(source.mock.callCount(),1); assert.equal(calls(),1);
});
test('reference photos deduplicate, preserve order, and reuse encoded bytes',async t=>{
  const {browser:b}=setup(t);
  const fetch=t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}}));
  const refs=[{url:'https://example.com/1.jpg',description:'one'},{url:'https://example.com/1.jpg',description:'same'},{url:'https://example.com/2.jpg',description:'two'}];
  const first=await b.fetchReferenceImages(refs,5);
  assert.equal(first.length,2); assert.match(first[0].description,/one/); assert.equal(first[1].description,'two');
  await b.fetchReferenceImages(refs,5); assert.equal(fetch.mock.callCount(),2);
  assert.equal(b.extractImageInfo({article:{headline:'Story',imageUrl:refs[0].url},imageUrls:[refs[0].url,refs[2].url]}).length,2);
});
test('invalid and oversized reference responses are omitted',async t=>{
  const {browser:b}=setup(t); t.mock.method(console,'warn',()=>{});
  t.mock.method(globalThis,'fetch',async url=>new Response(url.endsWith('html')?'html':new Uint8Array(8*1024*1024+1),{headers:{'content-type':url.endsWith('html')?'text/html':'image/png'}}));
  assert.deepEqual(await b.fetchReferenceImages([{url:'https://example.com/html',description:'bad'},{url:'https://example.com/large',description:'large'}],5),[]);
});
test('Gemini chooses final image instead of thought preview',async t=>{
  const {browser:b}=setup(t);
  b.geminiAI={models:{generateContent:async()=>({candidates:[{content:{parts:[{thought:true,inlineData:{mimeType:'image/png',data:'draft'}},{inlineData:{mimeType:'image/png',data:'final'}}]}}]})}};
  assert.equal(await b.generateWithGemini('test'),'data:image/png;base64,final');
});
test('bounded cache evicts least recently used entries and expires bytes',t=>{
  let now=100; t.mock.method(Date,'now',()=>now);
  const cache=new BoundedCache(6,3,10);
  cache.set('a','a',3); cache.set('b','b',3); cache.get('a'); cache.set('c','c',3);
  assert.equal(cache.get('b'),undefined); assert.equal(cache.get('a'),'a');
  cache.set('huge','huge',7); assert.equal(cache.get('huge'),undefined);
  now=111; assert.equal(cache.get('a'),undefined); assert.equal(cache.get('c'),undefined);
});
test('settings cannot change a running request or poison its cached identity',async t=>{
  const {browser:b}=setup(t);
  const original=b.getImageOptions();
  let release;
  const generate=t.mock.method(b,'generatePageImage',()=>new Promise(resolve=>{release=()=>resolve(JSON.stringify(b.getImageOptions()))}));
  const pending=b.navigate('https://example.com/a');
  while(!release) await new Promise(resolve=>setImmediate(resolve));
  b.setImageOptions({quality:'high'}); b.setModel('gpt-image-2'); b.setStyle('new style');
  assert.deepEqual(b.getImageOptions(),original); assert.equal(b.getCurrentModel(),'flash-lite');
  release(); await pending;
  await b.navigate('https://example.com/a');
  assert.equal(generate.mock.callCount(),1); assert.equal(b.state.currentImage,JSON.stringify(original));
});

test('address commits distinguish same-URL history and cached navigation from progress and failures',async t=>{
  const {browser:b,calls}=setup(t);
  assert.equal(b.state.navigationRevision,0);
  await b.navigate('https://example.com/a');
  assert.equal(b.state.navigationRevision,1);
  await b.navigate('https://example.com/a');
  assert.equal(calls(),1);assert.equal(b.state.navigationRevision,2);
  await b.goBack();assert.equal(b.state.navigationRevision,3);
  await b.goForward();assert.equal(b.state.navigationRevision,4);
  await b.scrollDown();assert.equal(b.state.navigationRevision,4);
  t.mock.method(b,'fetchApiData',async()=>{throw new Error('Offline fixture');});
  await b.navigate('https://example.com/b');
  assert.equal(b.state.navigationRevision,4);assert.equal(b.state.currentUrl,'https://example.com/a');
});
