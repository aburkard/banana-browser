import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser} = await server.ssrLoadModule('/src/browser.ts');
const {pageFragments, pageWindow, imageView, maxScreens, FRAGMENT_CHARS, IMAGE_WINDOW_CHARS, TEXT_CHARS_PER_SCREEN} = await server.ssrLoadModule('/src/page-window.ts');
const {shrinkImage, PHOTO_MAX_SIDE, LAYOUT_MAX_SIDE} = await server.ssrLoadModule('/src/reference-images.ts');
const {SITE_LAYOUT_CAPTION} = await server.ssrLoadModule('/src/webpage-appearance.ts');
await server.close();

// Link-heavy prose, like a reader-mode Wikipedia article: URLs are most of the raw characters.
const paragraphs = Array.from({length: 160}, (_, i) =>
  `Paragraph ${i} about [bananas ${i}](<https://en.wikipedia.org/wiki/Banana_cultivar_${i}_with_a_long_title>) and [plantains](https://en.wikipedia.org/wiki/Plantain_${i}). ` + 'Words of the article. '.repeat(12));
const longPage = {source: 'Web', title: 'Long article', url: 'https://example.com/article', content: paragraphs.join('\n\n'),
  links: Array.from({length: 150}, (_, i) => ({title: `Link ${i}`, url: `https://example.com/${i}`})), imageUrls: ['https://example.com/a.jpg']};
const shortPage = {source: 'Hacker News', stories: [{id: 1, title: 'Short story', apiUrl: 'https://hacker-news.firebaseio.com/v0/item/1.json'}]};
const content = window => (JSON.parse(window).blocks ?? [JSON.parse(window)]).map(block => block.value?.content ?? (block.path?.[0] === 'content' ? block.value : '')).join('');

function setup(t, page) {
  t.mock.method(console,'log',()=>{});
  const b = new BananaBrowser('test');
  const calls = [];
  t.mock.method(b,'fetchApiData',async()=>page);
  t.mock.method(b,'logImage',()=>{});
  t.mock.method(b,'generatePageImage',async(url,data)=>{
    calls.push({source:b.activeSource,prompt:b.buildImagePrompt(url,data),reference:b.sessionImage});
    return `data:image/png;base64,image${calls.length}`;
  });
  t.mock.method(b,'drawPointerOnImage',async()=> 'data:image/png;base64,cG9pbnRlcg==');
  const clicks = [];
  b.geminiAI = {models:{generateContent:async request=>{clicks.push(request);return {text:'{"action":"none"}'}}}};
  return {b,calls,clicks};
}

test('the image view keeps text and labels but drops link targets, markdown images and link lists',()=>{
  const view = JSON.parse(imageView(JSON.stringify({source:'Web', title:'T', url:'https://example.com/',
    content:'See [a \\[note\\]](<https://x.example/a_(b)>) and [b](https://x.example/b "Title") ![logo](https://x.example/l.png) end.',
    links:[{title:'b',url:'https://x.example/b'}], imageUrls:['https://x.example/l.png']})));
  assert.deepEqual(view,{source:'Web',title:'T',url:'https://example.com/',content:'See a [note] and b  end.'});
  const blocks = JSON.parse(imageView(JSON.stringify({blocks:[{path:['content'],value:'[x](https://x.example)'},{path:['links',0,'url'],value:'https://x.example'},{path:['imageUrls',0],value:'https://x.example/p.jpg'}]})));
  assert.deepEqual(blocks,{blocks:[{path:['content'],value:'x'}]});
  const split = JSON.parse(imageView(JSON.stringify({blocks:[{path:['content'],value:'https://x.example/tail) start [a]('},{path:['content'],value:'https://x.example/a) middle [cut]('}]})));
  assert.deepEqual(split,{blocks:[{path:['content'],value:' start a middle cut'}]},'links cut by fragment edges strip cleanly');
  const api = {stories:[{title:'[Not a link]', apiUrl:'https://hacker-news.firebaseio.com/v0/item/1.json'}]};
  assert.deepEqual(JSON.parse(imageView(JSON.stringify(api))),api,'API records and their URLs are untouched');
});

test('short pages are sent whole; long pages slide a window sized by the image view, losslessly',()=>{
  assert.deepEqual(pageFragments(shortPage),[JSON.stringify(shortPage)]);
  assert.equal(pageWindow(pageFragments(shortPage),7),JSON.stringify(shortPage));
  assert.equal(maxScreens(pageFragments(shortPage)),3);
  const fragments = pageFragments(longPage);
  assert.ok(fragments.every(fragment => fragment.length <= FRAGMENT_CHARS));
  assert.equal(fragments.map(content).join(''),longPage.content,'fragments are lossless');
  const first = pageWindow(fragments,0);
  const firstView = imageView(first);
  assert.ok(firstView.length <= IMAGE_WINDOW_CHARS + 200);
  assert.ok(first.length > 1.3 * firstView.length,'the raw window holds more than the image budget');
  assert.ok(content(first).startsWith(paragraphs[0]),'the first window starts at the top');
  const later = pageWindow(fragments,10);
  assert.notEqual(later,first);
  const estimate = 10 * TEXT_CHARS_PER_SCREEN;
  const viewBefore = fragments.map(fragment => imageView(fragment).length);
  const startText = content(later);
  const startIndex = fragments.findIndex(fragment => startText.startsWith(content(fragment)));
  const offset = viewBefore.slice(0, startIndex).reduce((a, b) => a + b, 0);
  assert.ok(offset <= estimate,'windows start at or before the estimated position');
  assert.ok(offset + viewBefore[startIndex] + viewBefore[startIndex + 1] > estimate - 1,'and within a fragment of it');
  const last = pageWindow(fragments,100_000);
  assert.ok(content(last).endsWith(paragraphs.at(-1)),'the last window reaches the end');
  assert.ok(imageView(last).length > IMAGE_WINDOW_CHARS / 2,'the last window stays full');
  assert.ok(maxScreens(fragments) > 20);
});

test('scrolling sends the image view and previous image, reuses cached views, and restores history',async t=>{
  const {b,calls} = setup(t,longPage);
  await b.navigate('https://example.com/article');
  const fragments = pageFragments(longPage);
  assert.equal(calls[0].source,pageWindow(fragments,0));
  assert.equal(calls[0].reference,null);
  assert.doesNotMatch(calls[0].prompt,/https:\/\/en\.wikipedia\.org|"links"|"imageUrls"/,'image prompts carry no link targets');
  assert.match(calls[0].prompt,/Paragraph 0 about bananas 0 and plantains/);
  for (let i = 1; i <= 12; i++) await b.scrollDown();
  assert.equal(calls.at(-1).source,pageWindow(fragments,12));
  assert.notEqual(calls.at(-1).source,calls[0].source,'the window moved with scrolling');
  assert.equal(calls.at(-1).reference,'data:image/png;base64,image12');
  assert.match(calls.at(-1).prompt,/# SCROLL CONTEXT[\s\S]*without skipping or repeating/);
  const count = calls.length;
  await b.scrollUp();await b.scrollUp();await b.scrollDown();
  assert.equal(calls.length,count,'cached views need no generation');
  assert.equal(b.activeSource,pageWindow(fragments,11));
  t.mock.method(b,'fetchApiData',async()=>shortPage);
  await b.navigate('https://hacker-news.firebaseio.com/v0/topstories.json');
  await b.goBack();
  assert.equal(b.state.scrollIndex,11);assert.equal(b.state.currentImage,'data:image/png;base64,image12');
  assert.equal(b.activeSource,pageWindow(fragments,11));
});

test('scrolling stops after three screens for a short page',async t=>{
  const {b,calls} = setup(t,shortPage);
  await b.navigate('https://hacker-news.firebaseio.com/v0/topstories.json');
  for (let i = 0; i < 5; i++) await b.scrollDown();
  assert.equal(b.state.scrollIndex,2);assert.equal(calls.length,3);assert.equal(b.canScrollDown(),false);
});

test('clicks see the window with link targets, stable text first, then the pointer image and coordinates',async t=>{
  const {b,clicks} = setup(t,longPage);
  await b.navigate('https://example.com/article');
  b.setClickModel('gemini-3.8-flash');
  await b.handleClick(10,20);await b.handleClick(30,40);
  const [first,second] = clicks.map(request => request.contents);
  assert.match(first[0].text,/\]\(<https:\/\/en\.wikipedia\.org\/wiki\/Banana_cultivar_0/,'clicks keep link targets');
  assert.doesNotMatch(first[0].text,/clicked at coordinates/);
  assert.equal(first[1].inlineData.data,'cG9pbnRlcg==');
  assert.match(first[2].text,/\(10, 20\)/);assert.match(second[2].text,/\(30, 40\)/);
  assert.equal(first[0].text,second[0].text,'repeated clicks share the cacheable prefix');
});

test('failed and concurrent scrolls keep the visible view, and restyling starts from the top',async t=>{
  const {b,calls} = setup(t,longPage);
  await b.navigate('https://example.com/article');
  const fragments = pageFragments(longPage);
  b.generatePageImage = async()=>{throw new Error('provider down');};
  for (let i = 0; i < 5; i++) await b.scrollDown();
  assert.equal(b.state.scrollIndex,0);assert.equal(b.activeSource,pageWindow(fragments,0));assert.match(b.state.error,/provider down/);
  let release;
  b.generatePageImage = ()=>new Promise(resolve=>{release=()=>resolve('data:image/png;base64,late');});
  const pending = b.scrollDown();await b.scrollDown();release();await pending;
  assert.equal(b.state.scrollIndex,1);assert.equal(b.state.scrollDepth,2);
  b.generatePageImage = async()=>'data:image/png;base64,restyled';
  await b.rerender();
  assert.equal(b.state.scrollIndex,0);assert.equal(b.activeSource,pageWindow(fragments,0));
  assert.equal(calls.length,1);
});

test('reference photos shrink to 256 px JPEG and layout screenshots to 1,024 px; without canvas support they pass through',async t=>{
  const bytes = new Uint8Array([1,2,3]);
  const unchanged = await shrinkImage(bytes,'image/png',PHOTO_MAX_SIDE);
  assert.deepEqual(unchanged,{dataUrl:'data:image/png;base64,AQID',mimeType:'image/png'});
  const drawn = [];
  globalThis.createImageBitmap = async () => ({width:1200,height:600,close(){}});
  globalThis.OffscreenCanvas = class { constructor(width,height){this.width=width;this.height=height;}
    getContext(){return {fillRect:()=>drawn.push('white'),drawImage:(_,x,y,w,h)=>drawn.push([w,h])};}
    async convertToBlob(options){drawn.push(options);return new Blob([new Uint8Array([9,9])]);} };
  t.after(()=>{delete globalThis.createImageBitmap;delete globalThis.OffscreenCanvas;});
  const photo = await shrinkImage(bytes,'image/png',PHOTO_MAX_SIDE);
  assert.deepEqual(photo,{dataUrl:'data:image/jpeg;base64,CQk=',mimeType:'image/jpeg'});
  assert.deepEqual(drawn,['white',[256,128],{type:'image/jpeg',quality:0.85}]);
  drawn.length = 0;
  await shrinkImage(bytes,'image/png',LAYOUT_MAX_SIDE);
  assert.deepEqual(drawn[1],[1024,512]);
  globalThis.createImageBitmap = async () => ({width:200,height:100,close(){}});
  assert.deepEqual(await shrinkImage(bytes,'image/png',PHOTO_MAX_SIDE),unchanged,'small images are not re-encoded');
  // The browser picks the size from the reference's caption.
  t.mock.method(console,'warn',()=>{});
  const b = new BananaBrowser('test');
  const sizes = [];
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}}));
  globalThis.createImageBitmap = async () => ({width:2048,height:1024,close(){}});
  globalThis.OffscreenCanvas = class { constructor(width,height){sizes.push([width,height]);this.width=width;this.height=height;}
    getContext(){return {fillRect(){},drawImage(){}};} async convertToBlob(){return new Blob([new Uint8Array([7])]);} };
  await b.fetchReferenceImages([{url:'https://example.com/photo.jpg',description:'A player'},{url:'https://example.com/shot.png',description:SITE_LAYOUT_CAPTION}],5);
  assert.deepEqual(sizes,[[256,128],[1024,512]]);
});
