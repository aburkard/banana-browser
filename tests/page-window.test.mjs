import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser} = await server.ssrLoadModule('/src/browser.ts');
const {pageFragments, pageWindow, maxScreens, WINDOW_FRAGMENT_CHARS, SOURCE_CHARS_PER_SCREEN} = await server.ssrLoadModule('/src/page-window.ts');
await server.close();

const paragraphs = Array.from({length: 120}, (_, i) => `Paragraph ${i} with a [link ${i}](<https://example.com/${i}>). ` + 'Words of the article. '.repeat(20));
const longPage = {source: 'Web', title: 'Long article', url: 'https://example.com/article', content: paragraphs.join('\n\n')};
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

test('short pages are sent whole; long pages slide a two-fragment window without losing text',()=>{
  assert.deepEqual(pageFragments(shortPage),[JSON.stringify(shortPage)]);
  assert.equal(pageWindow(pageFragments(shortPage),7),JSON.stringify(shortPage));
  assert.equal(maxScreens(pageFragments(shortPage)),3);
  const fragments = pageFragments(longPage);
  assert.ok(fragments.length > 4);
  assert.ok(fragments.every(fragment => fragment.length <= WINDOW_FRAGMENT_CHARS));
  assert.equal(fragments.map(content).join(''),longPage.content,'fragments are lossless');
  const first = pageWindow(fragments,0);
  assert.equal(content(first),content(fragments[0])+content(fragments[1]));
  assert.ok(first.length <= 2 * WINDOW_FRAGMENT_CHARS + 100);
  const slides = Math.ceil(WINDOW_FRAGMENT_CHARS / SOURCE_CHARS_PER_SCREEN);
  assert.equal(pageWindow(fragments,slides - 1),first,'the window holds while the estimate stays in its first fragment');
  assert.equal(content(pageWindow(fragments,slides)),content(fragments[1])+content(fragments[2]));
  assert.equal(content(pageWindow(fragments,10_000)),content(fragments.at(-2))+content(fragments.at(-1)),'the last window stays full');
  assert.ok(maxScreens(fragments) > 50);
});

test('scrolling sends the window and previous image, reuses cached views, and restores history',async t=>{
  const {b,calls} = setup(t,longPage);
  await b.navigate('https://example.com/article');
  const fragments = pageFragments(longPage);
  assert.equal(calls[0].source,pageWindow(fragments,0));
  assert.equal(calls[0].reference,null);
  assert.doesNotMatch(calls[0].prompt,/End of section|contentWindow|source section/);
  assert.match(calls[0].prompt,/whole page or, for a long page, the part around the current scroll position/);
  for (let i = 1; i <= 5; i++) await b.scrollDown();
  assert.equal(calls.length,6);
  assert.equal(calls[5].source,pageWindow(fragments,5));
  assert.notEqual(calls[5].source,calls[0].source,'the window moved with scrolling');
  assert.equal(calls[5].reference,'data:image/png;base64,image5');
  assert.match(calls[5].prompt,/# SCROLL CONTEXT[\s\S]*without skipping or repeating/);
  await b.scrollUp();await b.scrollUp();await b.scrollDown();
  assert.equal(calls.length,6,'cached views need no generation');
  assert.equal(b.activeSource,pageWindow(fragments,4));
  t.mock.method(b,'fetchApiData',async()=>shortPage);
  await b.navigate('https://hacker-news.firebaseio.com/v0/topstories.json');
  await b.goBack();
  assert.equal(b.state.scrollIndex,4);assert.equal(b.state.currentImage,'data:image/png;base64,image5');
  assert.equal(b.activeSource,pageWindow(fragments,4));
  assert.equal('sectionIndex' in b.state,false);
});

test('scrolling stops after the page allows three screens for a short page',async t=>{
  const {b,calls} = setup(t,shortPage);
  await b.navigate('https://hacker-news.firebaseio.com/v0/topstories.json');
  for (let i = 0; i < 5; i++) await b.scrollDown();
  assert.equal(b.state.scrollIndex,2);assert.equal(calls.length,3);assert.equal(b.canScrollDown(),false);
});

test('clicks see the current window with stable text first, then the pointer image and coordinates',async t=>{
  const {b,clicks} = setup(t,longPage);
  await b.navigate('https://example.com/article');
  for (let i = 1; i <= 5; i++) await b.scrollDown();
  b.setClickModel('gemini-3.8-flash');
  await b.handleClick(10,20);await b.handleClick(30,40);
  const [first,second] = clicks.map(request => request.contents);
  assert.ok(first[0].text.includes(content(pageWindow(pageFragments(longPage),5)).slice(0,200)));
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
