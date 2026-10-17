import assert from 'node:assert/strict';
import {test, beforeEach} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {htmlToScrape,readWebpage,READER_ENDPOINT}=await server.ssrLoadModule('/src/webpage-reader.ts');
const {fetchWebpage,setWebpageOptions}=await server.ssrLoadModule('/src/webpage-fetch.ts');
const {normalizeWebpage}=await server.ssrLoadModule('/src/webpage-source.ts');
const {setFirecrawlKey,loadFirecrawlKey,saveFirecrawlKey,hasFirecrawlKey}=await server.ssrLoadModule('/src/firecrawl-client.ts');
await server.close();
const win=new Window();
globalThis.DOMParser=win.DOMParser;
beforeEach(()=>{setFirecrawlKey('');setWebpageOptions({siteReference:false,fresh:false});});

const page=`<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="Example News"><meta name="description" content="Daily stories.">
<meta property="og:image" content="/social.jpg"><base href="https://news.example.com/section/">
<style>.x{color:red}</style><script>alert('never')</script></head>
<body><nav><a href="/">Home</a> | <a href="sports">Sports</a> <a href="#top">Skip</a> <a href="javascript:void(0)">Menu</a></nav>
<main><a href="/story/1"><div><h2>Big   headline</h2><p>Summary of the story.</p><span>2h · Reporter</span></div></a>
<ul><li><a href="/x"><svg></svg></a></li></ul>
<p>First <strong>paragraph</strong> with <a href="https://other.example/ref?a=(1)">a (source)</a>.</p>
<ul><li>One</li><li>Two <em>items</em></li></ul>
<table><tr><th>Team</th><th>Score</th></tr><tr><td>A</td><td>3</td></tr></table>
<img src="/photo.jpg" srcset="/photo-small.jpg 300w, /photo-large.jpg 1200w" alt="A [photo]">
<img src="/pixel.gif" width="1" height="1"><img src="data:image/png;base64,AAAA">
<div hidden>Hidden text</div><p style="display:none">Invisible</p>
<pre>line 1
  line 2</pre><blockquote>Quoted words</blockquote></main>
<form><input value="secret"></form><noscript>Enable JS</noscript></body></html>`;

test('HTML becomes Firecrawl-shaped markdown, links and images without page scripts or hidden text',()=>{
  const data=htmlToScrape(page,'https://news.example.com/section/today');
  assert.equal(data.metadata.title,'Example News');
  assert.equal(data.metadata.description,'Daily stories.');
  assert.equal(data.metadata.ogImage,'https://news.example.com/social.jpg');
  assert.equal(data.metadata.url,'https://news.example.com/section/today');
  const md=data.markdown;
  assert.match(md,/\[Home\]\(https:\/\/news\.example\.com\/\)/);
  assert.match(md,/\[Sports\]\(https:\/\/news\.example\.com\/section\/sports\)/);
  assert.match(md,/^## \[Big headline\]\(https:\/\/news\.example\.com\/story\/1\)\n\nSummary of the story\. 2h · Reporter$/m);
  assert.doesNotMatch(md,/^-\s*$/m,'icon-only list items are dropped');
  assert.match(md,/First paragraph with \[a \(source\)\]\(<https:\/\/other\.example\/ref\?a=\(1\)>\)\./);
  assert.match(md,/^- One$/m);assert.match(md,/^- Two items$/m);
  assert.match(md,/^\| Team \| Score \|$/m);assert.match(md,/^\| A \| 3 \|$/m);
  assert.match(md,/!\[A \\\[photo\\\]\]\(https:\/\/news\.example\.com\/photo-large\.jpg\)/);
  assert.match(md,/```\nline 1\n  line 2\n```/);
  assert.match(md,/^> Quoted words$/m);
  for(const absent of ['alert','color:red','Hidden text','Invisible','secret','Enable JS','javascript:','#top','pixel.gif','data:image'])assert.ok(!md.includes(absent),absent);
  assert.deepEqual(data.images,['https://news.example.com/photo-large.jpg']);
  assert.ok(data.links.some(link=>link.url==='https://news.example.com/story/1'&&link.title==='Big headline'));
  const source=normalizeWebpage(data,'https://news.example.com/section/today');
  assert.deepEqual(source.imageUrls,['https://news.example.com/social.jpg','https://news.example.com/photo-large.jpg']);
  assert.ok(source.links.some(link=>link.url==='https://other.example/ref?a=(1)'));
});

test('relay request carries no credentials and explains failures, pointing to Firecrawl when it would help',async t=>{
  const calls=[];
  const respond=(status,body)=>t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return typeof body==='string'?new Response(body,{status}):Response.json(body,{status});});
  respond(200,{url:'https://example.com/final',html:'<title>T</title><p>Hello there</p>',truncated:false});
  const data=await readWebpage('https://example.com/start?q=1');
  assert.equal(calls[0].url,`${READER_ENDPOINT}?url=${encodeURIComponent('https://example.com/start?q=1')}`);
  assert.equal(calls[0].init.credentials,'omit');assert.equal(calls[0].init.headers,undefined);
  assert.equal(data.metadata.url,'https://example.com/final');assert.match(data.markdown,/Hello there/);
  t.mock.restoreAll();respond(404,'Not found');
  await assert.rejects(readWebpage('https://example.com/'),/could not be read\. Add a Firecrawl key/);
  t.mock.restoreAll();respond(503,{error:'The reader is busy. Try again shortly.'});
  await assert.rejects(readWebpage('https://example.com/'),/busy/);
  t.mock.restoreAll();respond(502,{error:'The site returned HTTP 403.'});
  await assert.rejects(readWebpage('https://example.com/'),/could not be read: The site returned HTTP 403\. Add a Firecrawl key/);
  t.mock.restoreAll();respond(415,{error:'This address is not an HTML page.'});
  await assert.rejects(readWebpage('https://example.com/data.json'),/not a webpage/);
  t.mock.restoreAll();respond(200,{url:'https://example.com/app',html:'<div id="root"></div><script>render()</script>'});
  await assert.rejects(readWebpage('https://example.com/app'),/no text without JavaScript/);
  t.mock.restoreAll();respond(200,{url:'javascript:alert(1)',html:'<p>x</p>'});
  await assert.rejects(readWebpage('https://example.com/'),/invalid response/);
  t.mock.restoreAll();t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('offline')});
  await assert.rejects(readWebpage('https://example.com/'),/could not be reached/);
});

test('without a key webpages use the reader; with one they use Firecrawl, and the key never reaches the relay',async t=>{
  const urls=[];
  const relayInits=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    urls.push(String(url));
    if(String(url).startsWith(READER_ENDPOINT)){relayInits.push(init);return Response.json({url:'https://example.com/',html:'<h1>Example</h1><a href="/next">Next</a>'});}
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer fc-secret');
    return Response.json({success:true,data:{markdown:'# Example\n\n[Next](https://example.com/next)',metadata:{title:'Example',url:'https://example.com/'}}});
  });
  const usage=[];
  const keyless=await fetchWebpage('https://example.com/',u=>usage.push(u));
  assert.equal(keyless.title,'Example');assert.match(keyless.content,/# Example/);
  assert.ok(keyless.links.some(link=>link.url==='https://example.com/next'));
  assert.deepEqual(usage,[],'the reader records no Firecrawl credits');
  setFirecrawlKey('fc-secret');
  await fetchWebpage('https://example.com/',u=>usage.push(u));
  assert.equal(urls[0].split('?')[0],READER_ENDPOINT);assert.equal(urls[1],'https://api.firecrawl.dev/v2/scrape');
  assert.equal(usage.length,1);
  // With a key saved, a relay read (as in the first call) still never carries it.
  for(const init of relayInits)assert.ok(!JSON.stringify(init).includes('fc-secret'));
  assert.ok(!urls[0].includes('fc-secret'));
});

test('the Firecrawl key is saved with the other keys and a tab-only key carries over once',()=>{
  const storage=()=>{const map=new Map();return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),map};};
  const local=storage(),session=storage();
  session.setItem('firecrawl_api_key',' fc-old ');
  assert.equal(loadFirecrawlKey(local,session),'fc-old');
  assert.equal(local.getItem('firecrawl_api_key'),'fc-old');assert.equal(session.getItem('firecrawl_api_key'),null);
  assert.ok(hasFirecrawlKey());
  saveFirecrawlKey('  ',local);
  assert.equal(local.getItem('firecrawl_api_key'),null);assert.ok(!hasFirecrawlKey());
  session.setItem('firecrawl_api_key','fc-stale');local.setItem('firecrawl_api_key','fc-new');
  assert.equal(loadFirecrawlKey(local,session),'fc-new','a saved key wins over a stale tab key');
});
