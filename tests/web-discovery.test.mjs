import assert from 'node:assert/strict';import {test,beforeEach} from 'node:test';import {createServer as createHttpServer} from 'node:http';import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {addressTarget,searchAddress,mapAddress,displayAddress,fetchDiscovery}=await server.ssrLoadModule('/src/web-discovery.ts');
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
const {setFirecrawlKey}=await server.ssrLoadModule('/src/firecrawl-client.ts');await server.close();
beforeEach(()=>setFirecrawlKey('test-firecrawl-key'));
test('address input distinguishes web URLs, queries and existing internal search history',()=>{
 assert.equal(addressTarget('example.com/articles'),'https://example.com/articles');assert.equal(addressTarget('https://example.com/'),'https://example.com/');
 assert.equal(addressTarget(' best programming essays '),searchAddress('best programming essays'));assert.equal(displayAddress(searchAddress('a & b')),'a & b');
 assert.equal(displayAddress(mapAddress('https://example.com/long/path')),'https://example.com/');
});
test('search directly calls Firecrawl, normalizes safe links and reports native credits',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.firecrawl.dev/v2/search');assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-firecrawl-key');
  assert.equal(JSON.parse(options.body).query,'query');
  return Response.json({success:true,data:{web:[{title:'Real',url:'https://example.com/post',description:'A post'},{url:'javascript:alert(1)'},{url:'https://example.com/post'}]},metadata:{creditsUsed:2}});
 });
 const data=await fetchDiscovery('search','query',u=>usage.push(u));assert.equal(data.links.length,1);assert.equal(data.links[0].title,'Real');assert.deepEqual(usage,[{credits:2,cached:false}]);
});
test('native map links distinguish discovery from fetched content and missing usage is unknown',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.firecrawl.dev/v2/map');assert.equal(JSON.parse(options.body).url,'https://example.com/');assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-firecrawl-key');
  return Response.json({success:true,links:[{url:'https://example.com/post',title:'Post'}]});
 });
 const data=await fetchDiscovery('map','https://example.com/',u=>usage.push(u));assert.match(data.description,/not yet/);assert.equal(data.links[0].url,'https://example.com/post');assert.deepEqual(usage,[{credits:null,cached:false}]);
});
test('search navigation and cached history require no intermediate external fetch',async t=>{
 t.mock.method(console,'log',()=>{});const b=new BananaBrowser('test','test');let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(url,'https://api.firecrawl.dev/v2/search');calls++;return Response.json({success:true,data:{web:[{url:'https://example.com/article',title:'Article'}]},creditsUsed:2})});
 t.mock.method(b,'generatePageImage',async()=> 'image');t.mock.method(b,'logImage',()=>{});
 await b.navigate(searchAddress('first'));await b.navigate(searchAddress('second'));await b.goBack();assert.equal(calls,2);assert.equal(b.state.currentUrl,searchAddress('first'));assert.equal(b.state.currentApiData.links[0].url,'https://example.com/article');assert.equal(b.state.usage.webCredits,4);
});
test('search operators remain queries and bare host ports remain URLs',()=>{
 assert.equal(addressTarget('site:example.com words'),searchAddress('site:example.com words'));
 assert.equal(addressTarget('example.com:443/path'),'https://example.com:443/path');
});
