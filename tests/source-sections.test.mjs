import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {sourceSections} = await server.ssrLoadModule('/src/source-sections.ts');
const {BananaBrowser} = await server.ssrLoadModule('/src/browser.ts');
await server.close();
const story = ('Unicode 🦋 漢字 é and "quoted" text.\n').repeat(550);
const source = {article:{id:42, headline:'Full story',apiUrl:'https://example.com/article/42',story}};

test('web article first section contains prose, not just its metadata',()=>{
  const article = {source:'Web',title:'Introducing Transcript Search — PMT DB',url:'https://www.pmtdb.com/blog/introducing-transcript-search',story:('Every word is searchable. [Read more](https://example.com/transcripts)\n\n').repeat(150),links:[{title:'Read more',url:'https://example.com/transcripts'}]};
  const sections=sourceSections(article);
  const first=JSON.parse(sections[0]);
  assert.ok(first.blocks.some(block=>block.path.join('.')==='story' && block.value.includes('Every word')));
  const fragments=sections.flatMap(section=>{assert.ok(section.length<=8000);return JSON.parse(section).blocks}).filter(block=>block.path.join('.')==='story');
  assert.equal(fragments.map(block=>block.value).join(''),article.story);
});

test('sections retain long text, Unicode, record identity and intact long links',()=>{
  const url='https://example.com/?query='+'x'.repeat(1200);
  const text=story+' '+url+' '+story;
  const sections=sourceSections({article:{id:42,apiUrl:url,story:text}},2000);
  const blocks=sections.flatMap(section=>{assert.ok(section.length<=2000);return JSON.parse(section).blocks});
  const fragments=blocks.filter(block=>block.path.join('.')==='article.story');
  assert.equal(fragments.map(block=>block.value).join(''),text);
  assert.ok(blocks.some(block=>block.value===url));
  for(const block of fragments) { assert.equal(block.value.isWellFormed(),true); assert.equal(block.context.id,42); }
  assert.ok(fragments.some(block=>block.value.includes(url)));
  assert.throws(()=>sourceSections({url:'https://example.com/'+'x'.repeat(3000)},1000),/exceeds section budget/);
});

function setup(t) {
  t.mock.method(console,'log',()=>{});
  const browser = new BananaBrowser('test');
  const prompts=[];
  t.mock.method(browser,'logImage',()=>{});
  t.mock.method(browser,'fetchApiData',async()=>({article:{id:42,headline:'Long non-article data',body:story}}));
  t.mock.method(browser,'generatePageImage',async(url,data)=>{prompts.push(browser.buildImagePrompt(url,data));return `data:image/png;base64,image${prompts.length}`});
  t.mock.method(browser,'drawPointerOnImage',async()=> 'data:image/png;base64,cG9pbnRlcg==');
  let clickPrompt;
  browser.geminiAI={models:{generateContent:async request=>{clickPrompt=request.contents[1].text;return {text:'{"action":"none"}'}}}};
  return {browser,prompts,click:()=>clickPrompt};
}
function promptSource(prompt) { return prompt.split('# DATA\n')[1].split('\n\n# REMINDER')[0]; }

test('image and pointer-click use identical section data; sections restore scroll and history for free',async t=>{
  const {browser:b,prompts,click}=setup(t);
  await b.navigate('https://example.com/a');
  assert.ok(b.state.sectionCount>1);
  await b.scrollDown();
  assert.match(prompts[1],/bottom ~20%/);
  assert.match(prompts[1],/only facts and records in the current source section/);
  assert.match(prompts[1],/screenshot is visual context only, not a source of facts/);
  assert.match(prompts[1],/End of section/);
  assert.match(prompts[1],/Do not invent a continuation/);
  await b.nextSection();
  const sectionSource=promptSource(prompts.at(-1));
  assert.notEqual(sectionSource,promptSource(prompts[0]));
  await b.handleClick(3,4);
  assert.equal(click().split('The page was generated from this API data:\n')[1].split('\n\nLook at')[0],sectionSource);
  await b.scrollDown();
  const sectionImage=b.state.currentImage;
  await b.previousSection(); assert.equal(b.state.scrollIndex,1);
  await b.nextSection(); assert.equal(b.state.currentImage,sectionImage);
  assert.equal(prompts.length,4);
  await b.navigate('https://example.com/b');
  await b.goBack();
  assert.equal(b.state.sectionIndex,1);assert.equal(b.state.scrollIndex,1);
  await b.handleClick(3,4); assert.ok(click().includes(sectionSource));
  await b.previousSection();await b.nextSection();assert.equal(prompts.length,5);
  await b.goForward(); assert.equal(b.state.sectionIndex,0);
});

test('failed section and page generation restore source/image and allow one explicit retry',async t=>{
  const {browser:b,prompts,click}=setup(t);
  await b.navigate('https://example.com/a');await b.scrollDown();
  const image=b.state.currentImage, data=promptSource(prompts[0]);
  const generate=t.mock.method(b,'generatePageImage',async()=>{throw new Error('offline')});
  await b.nextSection();
  assert.equal(b.state.sectionIndex,0);assert.equal(b.state.currentImage,image);assert.equal(b.state.scrollIndex,1);
  await b.handleClick(0,0);assert.ok(click().includes(data));
  t.mock.method(b,'fetchApiData',async()=>({article:{headline:'Different source',story:'replacement '.repeat(1800)}}));
  await b.navigate('https://example.com/failure');
  assert.equal(b.state.currentUrl,'https://example.com/a');assert.equal(b.state.currentImage,image);
  await b.handleClick(0,0);assert.ok(click().includes(data));
  assert.equal(generate.mock.callCount(),2);
  generate.mock.restore();await b.nextSection();assert.equal(b.state.sectionIndex,1);
});

test('duplicate section actions while generating make one request',async t=>{
  const {browser:b}=setup(t);await b.navigate('https://example.com/a');
  let release;
  const generate=t.mock.method(b,'generatePageImage',()=>new Promise(resolve=>{release=resolve}));
  const pending=b.nextSection();await b.nextSection();await b.previousSection();
  release('next');await pending;
  assert.equal(generate.mock.callCount(),1);assert.equal(b.state.sectionIndex,1);
  await b.previousSection();await b.nextSection();assert.equal(generate.mock.callCount(),1);
});


test('section reference photos come from its records, including split article text',async t=>{
  const {browser:b}=setup(t);
  const data={imageUrls:['https://example.com/0.jpg'],articles:Array.from({length:35},(_,id)=>({id,headline:`Record ${id}`,imageUrl:`https://example.com/${id}.jpg`,story:'body '.repeat(150)}))};
  const sections=sourceSections(data);
  assert.ok(sections.length>1);
  const refs=b.extractImageInfo(JSON.parse(sections.at(-1)));
  assert.ok(refs.some(ref=>ref.url==='https://example.com/34.jpg'));
  assert.ok(!refs.some(ref=>ref.url==='https://example.com/0.jpg'));
  const articleSections=sourceSections({article:{headline:'Photo story',imageUrl:'https://example.com/photo.jpg',story}});
  for(const section of articleSections) assert.ok(b.extractImageInfo(JSON.parse(section)).some(ref=>ref.url==='https://example.com/photo.jpg'));
});


test('oversized empty-container paths reject explicitly and raw blocks are not section metadata',async t=>{
  for (const value of [[],{},'']) assert.throws(()=>sourceSections({['x'.repeat(8100)]:value}),/exceeds section budget/);
  const {browser:b}=setup(t);
  assert.deepEqual(b.extractImageInfo({blocks:[null, 'raw content']}),[]);
});

test('HTML sections preserve paragraphs, headings, and complete anchors at thematic breaks',()=>{
  const url='https://example.com/player?query='+'x'.repeat(240);
  const groups=Array.from({length:8},(_,index)=>`<hr><p><a name="team${index}"></a></p><h2>Team ${index}</h2>\n<p>Stats ${index}: <a data-note="quoted > value" href="${url}&team=${index}">Player ${index}</a> ${'Complete 🦋 prose. '.repeat(15)}</p>\n<p>Further details ${index}.</p>\n`);
  const html=groups.join('');
  const sections=sourceSections({article:{headline:'League preview',story:html}},1600);
  const fragments=sections.flatMap(section=>{assert.ok(section.length<=1600);return JSON.parse(section).blocks}).filter(b=>b.path.join('.')==='article.story').map(b=>b.value);
  assert.equal(fragments.join(''),html);
  for(const group of groups)assert.ok(fragments.includes(group),'whole team group stays together');
  for(const fragment of fragments)assert.equal(fragment.isWellFormed(),true);
});

test('oversized HTML paragraph splits prose without splitting an anchor or its attributes',()=>{
  const anchor='<a href="https://example.com/player?x=1&amp;y=2">A linked player</a>';
  const html=`<p>${'before '.repeat(250)}${anchor}${' after 🦋 '.repeat(250)}</p>`;
  const sections=sourceSections({story:html},1000);
  const fragments=sections.flatMap(section=>JSON.parse(section).blocks).filter(b=>b.path.join('.')==='story').map(b=>b.value);
  assert.equal(fragments.join(''),html);
  assert.ok(fragments.some(fragment=>fragment.includes(anchor)));
  assert.ok(fragments.every(fragment=>!fragment.startsWith('href=')));
});
