import assert from 'node:assert/strict';
import {test, beforeEach} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {fetchWebpage,setWebpageOptions}=await server.ssrLoadModule('/src/webpage-fetch.ts');
const {sourceSections}=await server.ssrLoadModule('/src/source-sections.ts');
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
const {setFirecrawlKey,firecrawlRequest}=await server.ssrLoadModule('/src/firecrawl-client.ts');
await server.close();
beforeEach(()=>{setFirecrawlKey('test-firecrawl-key');setWebpageOptions({siteReference:false,fresh:false});});
const endpoint='https://api.firecrawl.dev/v2/scrape';
const page={markdown:'# A page\n\n[Next](https://example.com/next)',metadata:{title:'Page',url:'https://example.com/',statusCode:200,creditsUsed:1}};
const success=()=>Response.json({success:true,data:page});
test('site reference is opt-in, keeps article text and follows source sections',async t=>{
 const requests=[];
 t.mock.method(globalThis,'fetch',async(_url,options)=>{requests.push(JSON.parse(options.body));return Response.json({success:true,data:{...page,metadata:{...page.metadata,url:'https://example.com/article'},markdown:'Article words. '.repeat(1400),screenshot:'https://images.example.com/site.png',branding:{colors:{primary:'#ff6600'},fonts:[{family:'Verdana'}]}}});});
 const ordinary=await fetchWebpage('https://example.com/article',()=>{});
 assert.equal(ordinary.imageUrl,undefined);assert.equal(requests[0].maxAge,3600000);assert.ok(!requests[0].formats.includes('screenshot'));
 setWebpageOptions({siteReference:true,fresh:true});
 const reference=await fetchWebpage('https://example.com/article',()=>{});
 assert.equal(reference.imageUrl,'https://images.example.com/site.png');assert.equal(requests[1].maxAge,0);assert.ok(requests[1].formats.includes('branding'));
 const browser=new BananaBrowser('test');
 assert.equal(browser.extractImageInfo(reference)[0].url,reference.imageUrl);
 for(const section of sourceSections(reference)) {
   const data=JSON.parse(section);
   assert.ok(browser.extractImageInfo(data).some(image=>image.url===reference.imageUrl));
   assert.ok(section.includes('#FF6600'));
 }
});
test('homepage keeps full context and sends its key only to the fixed Firecrawl endpoint',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,endpoint);assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-firecrawl-key');
  assert.equal(new Headers(options.headers).get('cookie'),null);
  assert.equal(JSON.parse(options.body).url,'https://example.com/');assert.ok(!options.body.includes('test-firecrawl-key'));
  return success();
 });
 const data=await fetchWebpage('https://example.com/',u=>usage.push(u));assert.equal(data.content,page.markdown);assert.equal(data.story,undefined);assert.deepEqual(usage,[{credits:1,cached:false}]);
});
test('provider errors are sanitized while reported charges remain visible',async t=>{
 const usage=[];t.mock.method(globalThis,'fetch',async()=>Response.json({success:false,error:'secret-provider-detail test-firecrawl-key',data:{metadata:{creditsUsed:1}}},{status:502}));
 await assert.rejects(fetchWebpage('https://example.com/',u=>usage.push(u)),error=>{
  assert.ok(!error.message.includes('secret-provider-detail'));assert.ok(!error.message.includes('test-firecrawl-key'));return true;
 });assert.deepEqual(usage,[{credits:1,cached:false}]);
});
test('external HTML fallback keeps credentials isolated, history and scrolling without repeat scrapes',async t=>{
 t.mock.method(console,'log',()=>{});const b=new BananaBrowser('test','test');let scrapes=0,images=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url===endpoint){scrapes++;assert.equal(new Headers(options.headers).get('authorization'),'Bearer test-firecrawl-key');return success();}
  assert.equal(new Headers(options?.headers).get('authorization'),null);assert.ok(!String(url).includes('test-firecrawl-key'));return new Response('<html>Page</html>');
 });
 t.mock.method(b,'generatePageImage',async()=>`image${++images}`);t.mock.method(b,'logImage',()=>{});
 await b.navigate('https://example.com/');assert.equal(b.state.error,null);await b.scrollDown();assert.equal(scrapes,1);
 await b.navigate('https://example.com/another');await b.goBack();assert.equal(b.state.currentImage,'image2');assert.equal(scrapes,2);assert.equal(b.state.usage.webCredits,2);
});
test('known API errors never trigger a paid scrape',async t=>{
 const b=new BananaBrowser('test');let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('',{status:503})});
 await assert.rejects(b.fetchApiData('https://api.tvmaze.com/shows'),/503/);assert.equal(requests,1);
});
test('malformed and unsuccessful responses record unknown usage exactly once',async t=>{
 for(const response of [new Response('broken'),Response.json(null),Response.json({success:false,error:'failed'},{status:502})]) {
  const usage=[];const mock=t.mock.method(globalThis,'fetch',async()=>response);
  await assert.rejects(fetchWebpage('https://example.com/',u=>usage.push(u)));assert.deepEqual(usage,[{credits:null,cached:false}]);mock.mock.restore();
 }
});
test('non-special HN API failures do not scrape',async t=>{
 const b=new BananaBrowser('test');let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('offline')});
 await assert.rejects(b.fetchApiData('https://hacker-news.firebaseio.com/v0/newstories.json'),/offline/);assert.equal(requests,1);
});
test('unchanged extracted content reuses its generated view but records both direct scrape charges',async t=>{
 t.mock.method(console,'log',()=>{});const b=new BananaBrowser('test','test');let images=0,scrapes=0;
 t.mock.method(globalThis,'fetch',async url=>url===endpoint?(scrapes++,success()):new Response('<html>Page</html>'));
 t.mock.method(b,'generatePageImage',async()=>`image${++images}`);t.mock.method(b,'logImage',()=>{});
 await b.navigate('https://example.com/');await b.navigate('https://example.com/');assert.equal(images,1);assert.equal(scrapes,2);assert.equal(b.state.usage.webCredits,2);
});
test('missing Firecrawl key prevents all direct provider requests and records no usage',async t=>{
 setFirecrawlKey('');let calls=0;const usage=[];t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not fetch')});
 for(const kind of ['scrape','search','map'])await assert.rejects(firecrawlRequest(kind,{},u=>usage.push(u)));
 assert.equal(calls,0);assert.deepEqual(usage,[]);
});
test('each supported native credit location is recorded and invalid credits stay unknown',async t=>{
 for(const [fields,credits] of [[{metadata:{creditsUsed:2}},2],[{creditsUsed:3},3],[{data:{metadata:{creditsUsed:4}}},4],[{creditsUsed:0},0],[{creditsUsed:-1},null],[{creditsUsed:'2'},null],[{},null]]) {
  const usage=[];const mock=t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,...fields}));
  await firecrawlRequest('scrape',{},u=>usage.push(u));assert.deepEqual(usage,[{credits,cached:false}]);mock.mock.restore();
 }
});

test('large homepage sends page text before the extracted link index',async t=>{
 const markdown='# Sports headlines\n\nPatriots season opener. '.repeat(1000);
 const links=Array.from({length:200},(_,i)=>({title:`Sports destination ${i}`,url:`https://example.com/sports/${i}`}));
 t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,data:{...page,markdown,links}}));
 const data=await fetchWebpage('https://example.com/',()=>{});
 const sections=sourceSections(data);
 assert.ok(sections.length>1);
 assert.ok(sections[0].includes('Patriots season opener'));
 assert.ok(Object.keys(data).indexOf('content')<Object.keys(data).indexOf('links'));
});
