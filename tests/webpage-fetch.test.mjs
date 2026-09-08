import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {fetchWebpage}=await server.ssrLoadModule('/src/webpage-fetch.ts');
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
await server.close();
const page={markdown:'# A page\n\n[Next](https://example.com/next)',metadata:{title:'Page',url:'https://example.com/',statusCode:200}};
test('homepage preserves full context and reports real credits without forwarding credentials',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.match(url,/\/web\?url=/);assert.equal(options.credentials,'omit');return Response.json({data:page,usage:{credits:1,cached:false}})});
 const data=await fetchWebpage('https://example.com/',u=>usage.push(u));assert.equal(data.content,page.markdown);assert.equal(data.story,undefined);assert.deepEqual(usage,[{credits:1,cached:false}]);
});
test('failed scrape reports credits and missing usage remains unknown',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async()=>Response.json({error:'provider secret',usage:{credits:1,cached:false}},{status:502}));
 await assert.rejects(fetchWebpage('https://example.com/',u=>usage.push(u)),/could not be loaded/);assert.equal(usage[0].credits,1);
});
test('external HTML fallback keeps history and scrolling without repeated scrapes',async t=>{
 t.mock.method(console,'log',()=>{});const b=new BananaBrowser('test','test');let scrapes=0,images=0;
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('/web?')?(scrapes++,Response.json({data:page,usage:{credits:1,cached:false}})):new Response('<html>Page</html>'));
 t.mock.method(b,'generatePageImage',async()=>`image${++images}`);t.mock.method(b,'logImage',()=>{});
 await b.navigate('https://example.com/');assert.equal(b.state.error,null);await b.scrollDown();assert.equal(scrapes,1);
 await b.navigate('https://example.com/another');await b.goBack();assert.equal(b.state.currentImage,'image2');assert.equal(scrapes,2);assert.equal(b.state.usage.webCredits,2);
});
test('known API errors never trigger a paid scrape',async t=>{
 const b=new BananaBrowser('test');let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('',{status:503})});
 await assert.rejects(b.fetchApiData('https://api.tvmaze.com/shows'),/503/);assert.equal(requests,1);
});
test('malformed and unsuccessful responses record unknown usage exactly once',async t=>{
 for(const response of [new Response('broken'),Response.json(null),Response.json({error:'failed'},{status:502})]) {
  const usage=[];const mock=t.mock.method(globalThis,'fetch',async()=>response);
  await assert.rejects(fetchWebpage('https://example.com/',u=>usage.push(u)));assert.deepEqual(usage,[{credits:null,cached:false}]);mock.mock.restore();
 }
});
test('non-special HN API failures do not scrape',async t=>{
 const b=new BananaBrowser('test');let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('offline')});
 await assert.rejects(b.fetchApiData('https://hacker-news.firebaseio.com/v0/newstories.json'),/offline/);assert.equal(requests,1);
});
test('unchanged extracted content reuses a generated view even on a fresh navigation',async t=>{
 t.mock.method(console,'log',()=>{});const b=new BananaBrowser('test','test');let images=0,scrapes=0;
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('/web?')?Response.json({data:page,usage:{credits:scrapes++?0:1,cached:scrapes>1}}):new Response('<html>Page</html>'));
 t.mock.method(b,'generatePageImage',async()=>`image${++images}`);t.mock.method(b,'logImage',()=>{});
 await b.navigate('https://example.com/');await b.navigate('https://example.com/');assert.equal(images,1);assert.equal(b.state.usage.webCredits,1);
});
