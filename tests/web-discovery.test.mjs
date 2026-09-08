import assert from 'node:assert/strict';import {test} from 'node:test';import {createServer as createHttpServer} from 'node:http';import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {addressTarget,searchAddress,mapAddress,displayAddress,fetchDiscovery}=await server.ssrLoadModule('/src/web-discovery.ts');
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');await server.close();
test('address input distinguishes web URLs, queries and existing internal search history',()=>{
 assert.equal(addressTarget('example.com/articles'),'https://example.com/articles');assert.equal(addressTarget('https://example.com/'),'https://example.com/');
 assert.equal(addressTarget(' best programming essays '),searchAddress('best programming essays'));assert.equal(displayAddress(searchAddress('a & b')),'a & b');
 assert.equal(displayAddress(mapAddress('https://example.com/long/path')),'https://example.com/');
});
test('search normalizes only safe result links and reports credits',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.match(url,/\/search\?q=/);assert.equal(options.credentials,'omit');return Response.json({data:{web:[{title:'Real',url:'https://example.com/post',description:'A post'},{url:'javascript:alert(1)'},{url:'https://example.com/post'}]},usage:{credits:2,cached:false}})});
 const data=await fetchDiscovery('search','query',u=>usage.push(u));assert.equal(data.links.length,1);assert.equal(data.links[0].title,'Real');assert.equal(usage[0].credits,2);
});
test('map results distinguish discovery from fetched content and unknown usage is not zero',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async()=>Response.json({data:{links:[{url:'https://example.com/post',title:'Post'}]}}));
 const data=await fetchDiscovery('map','https://example.com/',u=>usage.push(u));assert.match(data.description,/not yet/);assert.equal(usage[0].credits,null);
});
test('search navigation, cached history and page links require no intermediate external fetch',async t=>{
 t.mock.method(console,'log',()=>{});const b=new BananaBrowser('test','test');let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{assert.match(url,/\/search\?q=/);calls++;return Response.json({data:{web:[{url:'https://example.com/article',title:'Article'}]},usage:{credits:2,cached:false}})});
 t.mock.method(b,'generatePageImage',async()=> 'image');t.mock.method(b,'logImage',()=>{});
 await b.navigate(searchAddress('first'));await b.navigate(searchAddress('second'));await b.goBack();assert.equal(calls,2);assert.equal(b.state.currentUrl,searchAddress('first'));assert.equal(b.state.currentApiData.links[0].url,'https://example.com/article');assert.equal(b.state.usage.webCredits,4);
});
test('search operators remain queries and bare host ports remain URLs',()=>{
 assert.equal(addressTarget('site:example.com words'),searchAddress('site:example.com words'));
 assert.equal(addressTarget('example.com:443/path'),'https://example.com:443/path');
});
