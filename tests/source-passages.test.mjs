import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {sourcePassages} = await server.ssrLoadModule('/src/source-passages.ts');
await server.close();
const passages = source => sourcePassages(JSON.stringify(source)).map(JSON.parse);
const paragraph = index => `Paragraph ${index}: ${'🦋 漢字 é readable text '.repeat(22)}\n\n`;

test('passages preserve every paragraph and Unicode character exactly once with bounded prior context',()=>{
  const parts = Array.from({length:7},(_,index)=>paragraph(index));
  const story = parts.join('');
  const windows = passages({article:{story,headline:'Title',apiUrl:'../exact?q=1&b=2'}});
  assert.equal(windows.length,4);
  assert.equal(windows.map(window=>window.article.story).join(''),story);
  for(const part of parts) assert.equal(windows.filter(window=>window.article.story.includes(part)).length,1);
  windows.forEach((window,index)=>{
    assert.equal(window.article.headline,'Title');
    assert.equal(window.article.apiUrl,'../exact?q=1&b=2');
    assert.equal(window.contentWindow.cursor,index);
    assert.equal(window.contentWindow.count,windows.length);
    assert.equal(window.contentWindow.hasMore,index < windows.length-1);
    assert.ok(window.contentWindow.previousContext.length <= 300);
    assert.ok(window.article.story.isWellFormed());
    assert.ok(window.contentWindow.previousContext.isWellFormed());
    if(index) assert.ok(windows[index-1].article.story.trimEnd().endsWith(window.contentWindow.previousContext));
    else assert.equal(window.contentWindow.previousContext,'');
  });
});

test('long paragraphs and links with paragraph breaks are indivisible and overlap never cuts a link',()=>{
  const link = `[Label\n\nwith break](<https://example.com/?q=${'x'.repeat(1600)}>)`;
  const story = `Intro.\n\n${link}\n\nFinal 🦋 paragraph.`;
  const windows = passages({story});
  assert.equal(windows.map(window=>window.story).join(''),story);
  assert.equal(windows.length,3);
  assert.equal(windows[1].story,link+'\n\n');
  assert.equal(windows[2].contentWindow.previousContext,'');
  const adjacent = `[Label words](<https://example.com/${'x'.repeat(230)}>)`;
  assert.equal(passages({story:`${'a'.repeat(1300)}prefix${adjacent} suffix\n\nNext.`})[1].contentWindow.previousContext,'suffix');
});

test('HTML is parsed in detached templates, retaining readable structure and exact inert link targets',t=>{
  const window = new Window();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:window.document,configurable:true});
  t.after(()=>{if(previousDocument) Object.defineProperty(globalThis,'document',previousDocument); else delete globalThis.document;});
  const templates = [];
  const createElement = window.document.createElement.bind(window.document);
  t.mock.method(window.document,'createElement',tag=>{
    assert.equal(tag,'template');
    const template = createElement(tag); templates.push(template); return template;
  });
  const html = '<h2>Team &amp; 🦋</h2><p>First<br>line.</p><p><a href="../next?q=1&amp;x=🦋">Player [one]</a></p><ol start="3"><li>Third</li></ol><script>globalThis.executedSourcePassages=true</script><style>body{color:red}</style><img src="https://example.com/image" alt="Caption"><iframe src="https://example.com/frame"></iframe>';
  assert.equal(passages({article:{story:html}})[0].article.story,'## Team & 🦋\n\nFirst\nline.\n\n[Player \\[one\\]](<../next?q=1&x=🦋>)\n\n3. Third\n\nCaption');
  assert.equal(globalThis.executedSourcePassages,undefined);
  assert.equal(templates.length,1);
  assert.equal(templates[0].isConnected,false);
  assert.equal(templates[0].content.querySelector('iframe').isConnected,false);
  assert.equal(window.document.body.innerHTML,'');
  const blankHtml = JSON.stringify({article:{story:'<p> &nbsp; </p>',headline:'Other content'}},null,2);
  assert.deepEqual(sourcePassages(blankHtml),[blankHtml]);
});

test('section semantic paths select story values while preserving identity, context and other blocks',()=>{
  const source = {blocks:[
    {path:['article','story'],value:paragraph(0)+paragraph(1)+paragraph(2),context:{headline:'Title',apiUrl:'../exact',story:'Do not reinterpret'}},
    {path:['story'],value:{text:paragraph(3),title:'HN title'}},
    {path:['article','description'],value:'Keep description'}
  ]};
  const windows = passages(source);
  assert.equal(windows.map(window=>window.blocks[0].value).join(''),source.blocks[0].value);
  assert.equal(windows.map(window=>window.blocks[1].value.text).join(''),source.blocks[1].value.text);
  windows.forEach(window=>{
    assert.deepEqual(window.blocks[0].context,source.blocks[0].context);
    assert.deepEqual(window.blocks[0].path,source.blocks[0].path);
    assert.equal(window.blocks[1].value.title,'HN title');
    assert.deepEqual(window.blocks[2],source.blocks[2]);
  });
  assert.equal(windows.at(-1).contentWindow.previousContext,'');
});

test('non-story data and listing excerpts remain byte-for-byte unchanged without window metadata',()=>{
  for(const source of [null,[],42,'plain',{items:[1,2,3]},
    {articles:[{story:'<p>Listing excerpt</p>'}]},
    {blocks:[{path:['articles',0,'story'],value:'<p>Listing excerpt</p>'}]},
    {context:{story:'<p>Context</p>'},text:'<p>Other</p>'},
    {blocks:[null,'raw content']},
    {contentWindow:{foreign:'provider metadata'}}]) {
    const input = JSON.stringify(source,null,2)+'\n';
    assert.deepEqual(sourcePassages(input),[input]);
  }
});

test('blank narrative retains existing scrolling and narrative metadata collisions reject explicitly',()=>{
  for (const source of [{story:''},{article:{story:' \n\t ',title:'Other content'}},{blocks:[{path:['story','text'],value:''}]}]) {
    const input = JSON.stringify(source,null,2);
    assert.deepEqual(sourcePassages(input),[input]);
  }
  assert.throws(()=>passages({story:'Text',contentWindow:{}}),/already has/);
});


test('HN detail text advances while nested comments remain source metadata',()=>{
  const source = {story:{text:paragraph(0)+paragraph(1)+paragraph(2),kids:[{text:'Comment text',story:'Comment story'}]}};
  const windows = passages(source);
  assert.equal(windows.length,2);
  assert.equal(windows.map(window=>window.story.text).join(''),source.story.text);
  for(const window of windows) assert.deepEqual(window.story.kids,source.story.kids);
});


test('mixed root and sectioned discussions retain existing scrolling, even for HTML stories',()=>{
  for (const source of [
    {story:{text:'<p>Story</p>'},comments:[{text:'Comment'}]},
    {blocks:[{path:['story','text'],value:'Story'},{path:['comments'],value:[{text:'Comment'}]}]},
    {blocks:[{path:['story'],value:{text:'Story'}},{path:['comments',0,'text'],value:'Comment'}]},
    {blocks:[{path:[],value:{story:{text:'Story'},comments:[{text:'Comment'}]}}]}
  ]) {
    const input = JSON.stringify(source,null,2)+'\n';
    assert.deepEqual(sourcePassages(input),[input]);
  }
  assert.ok(passages({story:{text:'Story'},comments:[]})[0].contentWindow);
  assert.ok(passages({blocks:[{path:['story','text'],value:'Story'},{path:['comments'],value:[]}]})[0].contentWindow);
});
