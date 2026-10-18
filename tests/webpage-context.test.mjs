import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as http} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:http()}}});
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
const {fetchWebpage,setWebpageOptions}=await server.ssrLoadModule('/src/webpage-fetch.ts');
const {setFirecrawlKey}=await server.ssrLoadModule('/src/firecrawl-client.ts');
const {pageFragments,pageWindow,WINDOW_FRAGMENT_CHARS,SOURCE_CHARS_PER_SCREEN}=await server.ssrLoadModule('/src/page-window.ts');
await server.close();

// Synthetic shapes from popular sites, without live requests or copied articles.
const layouts=[
 {name:'news homepage',path:'/',body:'# Latest headlines\n\n[Top story](/news/story)\n\n'},
 {name:'encyclopedia article',path:'/wiki/Example',body:'# Example article\n\nAn explanation with café 漢字 🦋.\n\n'},
 {name:'documentation section',path:'/en-US/docs/Web/Example',body:'# Example guide\n\n```js\nconst literal = "<div>";\n```\n\n'},
 {name:'repository',path:'/owner/project',body:'# Project README\n\n[Install](../install) and [Releases](/owner/project/releases).\n\n'},
 {name:'product page',path:'/dp/example',body:'# Example product\n\n| Size | Price |\n| --- | --- |\n| Small | $10 |\n\n'},
];
for(const layout of layouts)test(`${layout.name}: first render includes body; the window, scroll and history retain context`,async t=>{
 t.mock.method(console,'log',()=>{});
 setFirecrawlKey('test-only');setWebpageOptions({siteReference:false,fresh:false});
 const url=`https://example.com${layout.path}`;
 const navigation=Array.from({length:65},(_,i)=>`- [Menu ${i}](/section/${i})\n`).join('');
 const markdown=`${navigation}\n${layout.body.repeat(900)}\nFooter: [About](/about)\n`;
 t.mock.method(globalThis,'fetch',async endpoint=>{
  assert.equal(endpoint,'https://api.firecrawl.dev/v2/scrape');
  return Response.json({success:true,data:{markdown,metadata:{title:layout.name,url},links:['/about']}});
 });
 const source=await fetchWebpage(url,()=>{});
 assert.equal(source.content,markdown);assert.equal(source.story,undefined);
 const fragments=pageFragments(source);
 assert.ok(fragments.length>2);
 assert.ok(fragments.every(fragment=>fragment.length<=WINDOW_FRAGMENT_CHARS));
 const prose=json=>{const data=JSON.parse(json);return data.content??data.blocks.filter(block=>block.path[0]==='content').map(block=>block.value).join('');};
 assert.equal(fragments.map(prose).join(''),markdown);
 assert.ok(prose(pageWindow(fragments,0)).includes(layout.body));
 assert.ok(source.links.some(link=>link.url==='https://example.com/about'));
 const browser=new BananaBrowser(undefined,'test-only','gpt-image-2.5-flare');
 t.mock.method(browser,'fetchApiData',async()=>source);
 t.mock.method(browser,'logImage',()=>{});
 const prompts=[];
 t.mock.method(browser,'openAIImageRequest',async(_url,request)=>{
  prompts.push(request.body instanceof FormData?request.body.get('prompt'):JSON.parse(request.body).prompt);
  return {data:[{b64_json:Buffer.from(`image${prompts.length}`).toString('base64')}]};
 });
 await browser.navigate(url);
 assert.equal(browser.state.error,null);
 const first=JSON.parse(prompts[0].split('# DATA\n')[1].split('\n\n# REMINDER')[0]);
 assert.equal(JSON.stringify(first),pageWindow(fragments,0));
 assert.match(prompts[0],/# INITIAL VIEW/);
 const initial=browser.state.currentImage;
 await browser.scrollDown();
 assert.equal(browser.state.error,null);assert.match(prompts[1],/# SCROLL CONTEXT/);
 const scrolled=browser.state.currentImage;
 await browser.scrollUp();assert.equal(browser.state.currentImage,initial);
 await browser.scrollDown();assert.equal(browser.state.currentImage,scrolled);assert.equal(prompts.length,2);
 const slide=Math.ceil(WINDOW_FRAGMENT_CHARS/SOURCE_CHARS_PER_SCREEN);
 while(browser.state.scrollIndex<slide)await browser.scrollDown();
 assert.equal(browser.state.error,null);
 const later=JSON.parse(prompts.at(-1).split('# DATA\n')[1].split('\n\n# REMINDER')[0]);
 assert.equal(JSON.stringify(later),pageWindow(fragments,slide));
 assert.notEqual(JSON.stringify(later),JSON.stringify(first),'the window followed the scroll');
 const count=prompts.length, last=browser.state.currentImage;
 await browser.navigate('https://example.com/destination');
 await browser.goBack();assert.equal(browser.state.currentImage,last);assert.equal(browser.state.viewTransition,'back');
 await browser.goForward();assert.equal(browser.state.viewTransition,'forward');assert.equal(prompts.length,count+1);
});
