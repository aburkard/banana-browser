import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser} = await server.ssrLoadModule('/src/browser.ts');
await server.close();
const article = {article:{headline:'Three passages',story:[
  '[Early link](<https://example.com/early>) '+ 'First passage words. '.repeat(40),
  'Second passage words. '.repeat(40),
  'Third passage words. '.repeat(40),
].join('\n\n')}};
function setup(t) {
  t.mock.method(console,'log',()=>{});
  const b = new BananaBrowser('test');
  const calls=[];
  t.mock.method(b,'fetchApiData',async()=>article);
  t.mock.method(b,'logImage',()=>{});
  t.mock.method(b,'generatePageImage',async(url,data)=>{
    calls.push({source:JSON.parse(b.activeSource),prompt:b.buildImagePrompt(url,data),reference:b.sessionImage});
    return `data:image/png;base64,image${calls.length}`;
  });
  t.mock.method(b,'drawPointerOnImage',async()=> 'data:image/png;base64,cG9pbnRlcg==');
  const clicks=[];
  b.geminiAI={models:{generateContent:async request=>{clicks.push(request);return {text:'{"action":"none"}'}}}};
  return {b,calls,clicks};
}

test('article scroll advances once per image, stops locally, and restores cached source/history',async t=>{
  const {b,calls}=setup(t);
  await b.navigate('https://example.com/a');
  assert.equal(calls[0].source.contentWindow.count,3);
  assert.equal(calls[0].source.contentWindow.cursor,0);
  const first=b.state.currentImage;
  await b.scrollDown();
  assert.equal(calls[1].source.contentWindow.cursor,1);
  assert.equal(calls[1].reference,first);
  assert.match(calls[1].prompt,/bottom ~20%/);
  assert.match(calls[1].prompt,/When hasMore is true, do not claim/);
  await b.scrollDown();
  const last=b.state.currentImage;
  assert.equal(b.canScrollDown(),false);
  await b.scrollDown();assert.equal(calls.length,3);
  await b.scrollUp();assert.equal(JSON.parse(b.activeSource).contentWindow.cursor,1);
  await b.scrollDown();assert.equal(b.state.currentImage,last);assert.equal(calls.length,3);
  await b.navigate('https://example.com/b');
  await b.goBack();assert.equal(b.state.currentImage,last);assert.equal(JSON.parse(b.activeSource).contentWindow.cursor,2);
  await b.goForward();assert.equal(JSON.parse(b.activeSource).contentWindow.cursor,0);
  assert.equal(calls.length,4);
});

test('red-pointer clicks retain current and previous passage targets beyond the short context tail',async t=>{
  const {b,clicks}=setup(t);
  await b.navigate('https://example.com/a');await b.scrollDown();
  assert.ok(!JSON.parse(b.activeSource).contentWindow.previousContext.includes('https://example.com/early'));
  await b.handleClick(3,4);
  const prompt=clicks[0].contents[1].text;
  assert.match(prompt,/RED CURSOR/);
  assert.match(prompt,/https:\/\/example.com\/early/);
  assert.match(prompt,/currentView/);assert.match(prompt,/previousView/);
  assert.equal(JSON.parse(b.activeSource).contentWindow.cursor,1);
  await b.scrollUp();await b.handleClick(3,4);
  assert.ok(!clicks[1].contents[1].text.includes('"previousView":'));
});

test('failed and concurrent advancement never skip passages, retry automatically, or replace the visible source',async t=>{
  const {b,calls}=setup(t);await b.navigate('https://example.com/a');
  const source=b.activeSource,image=b.state.currentImage;
  let release;
  const failed=t.mock.method(b,'generatePageImage',()=>new Promise((_,reject)=>{release=()=>reject(new Error('offline'))}));
  const pending=b.scrollDown();await b.scrollDown();release();await pending;
  assert.equal(failed.mock.callCount(),1);assert.equal(b.activeSource,source);assert.equal(b.state.currentImage,image);
  assert.equal(b.state.scrollIndex,0);assert.equal(b.isScrollingDown,false);
  failed.mock.restore();await b.scrollDown();assert.equal(calls[1].source.contentWindow.cursor,1);assert.equal(b.state.error,null);
});

test('style rerender restarts the passage sequence and failed rerender preserves its position',async t=>{
  const {b,calls}=setup(t);await b.navigate('https://example.com/a');await b.scrollDown();
  const source=b.activeSource,image=b.state.currentImage;
  const failed=t.mock.method(b,'generatePageImage',async()=>{throw new Error('offline')});
  await b.rerender();assert.equal(b.activeSource,source);assert.equal(b.state.currentImage,image);assert.equal(b.state.scrollIndex,1);
  failed.mock.restore();await b.rerender();assert.equal(calls.at(-1).source.contentWindow.cursor,0);
  assert.equal(b.state.scrollIndex,0);assert.equal(b.state.scrollDepth,1);
  await b.scrollDown();assert.equal(calls.at(-1).source.contentWindow.cursor,1);
});

test('changing source sections restores each passage position and its click targets without generation',async t=>{
  const {b,calls,clicks}=setup(t);
  t.mock.method(b,'fetchApiData',async()=>({article:{headline:'Long article',story:Array.from({length:14},(_,i)=>`Passage ${i}. ${'Readable paragraph. '.repeat(43)}\n\n`).join('')}}));
  await b.navigate('https://example.com/long');
  assert.ok(b.state.sectionCount>1);
  await b.scrollDown();const firstSectionSource=b.activeSource,firstSectionImage=b.state.currentImage;
  await b.nextSection();await b.scrollDown();
  const secondSource=b.activeSource,secondImage=b.state.currentImage,callCount=calls.length;
  await b.previousSection();assert.equal(b.activeSource,firstSectionSource);assert.equal(b.state.currentImage,firstSectionImage);
  await b.nextSection();assert.equal(b.activeSource,secondSource);assert.equal(b.state.currentImage,secondImage);
  await b.handleClick(3,4);
  const clickSource=JSON.parse(clicks[0].contents[1].text.split('The page was generated from this API data:\n')[1].split('\n\nLook at')[0]);
  assert.deepEqual(clickSource.currentView,JSON.parse(secondSource));
  assert.equal(calls.length,callCount);
});

test('list advancement stops generation at the final records and preserves cached views and red-pointer targets',async t=>{
  const {b,calls,clicks}=setup(t);
  const articles=Array.from({length:7},(_,id)=>({id,headline:`Episode ${id}`,rating:7.1,apiUrl:`https://example.com/episodes/${id}`}));
  t.mock.method(b,'fetchApiData',async()=>({articles}));
  await b.navigate('https://example.com/list');await b.scrollDown();await b.scrollDown();
  assert.deepEqual(calls.flatMap(c=>c.source.articles),articles);
  assert.match(calls[1].prompt,/# LIST PASSAGE/);assert.match(calls[1].prompt,/bottom ~20%/);
  assert.doesNotMatch(calls[1].prompt,/contentWindow|hasMore|previousItems/);
  assert.match(calls[1].prompt,/do not show an end label/);
  assert.match(calls[2].prompt,/These are the final records/);
  assert.equal(b.canScrollDown(),false);await b.scrollDown();assert.equal(calls.length,3);
  const finalSource=b.activeSource,finalImage=b.state.currentImage;
  await b.scrollUp();await b.scrollDown();assert.equal(calls.length,3);assert.equal(b.activeSource,finalSource);assert.equal(b.state.currentImage,finalImage);
  await b.handleClick(3,4);const text=clicks[0].contents[1].text;
  assert.match(text,/RED CURSOR/);assert.match(text,/https:\/\/example.com\/episodes\/3/);assert.match(text,/https:\/\/example.com\/episodes\/6/);
  await b.navigate('https://example.com/detail');await b.goBack();assert.equal(b.activeSource,finalSource);assert.equal(b.state.currentImage,finalImage);
});
