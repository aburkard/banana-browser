import assert from 'node:assert/strict';
import {test} from 'node:test';
import {advancingSources} from './advancing-source.mjs';
const paragraph = (index, length=520) => `Paragraph ${index}: ${'🦋 readable text '.repeat(Math.ceil(length/17))}\n\n`;

test('advancing windows retain every story character once and keep metadata untouched',()=>{
  const story=Array.from({length:6},(_,i)=>paragraph(i)).join('');
  const source={blocks:[{path:['article','story'],value:story,context:{headline:'Article',apiUrl:'https://example.com/exact?a=1&b=2'}},{path:['other'],value:'Untouched'}],source:'Provider'};
  const windows=advancingSources(JSON.stringify(source)).map(JSON.parse);
  assert.equal(windows.length,3);
  assert.equal(windows.map(window=>window.blocks[0].value).join(''),story);
  windows.forEach((window,index)=>{
    assert.deepEqual(window.blocks[0].context,source.blocks[0].context);
    assert.deepEqual(window.blocks[0].path,source.blocks[0].path);
    assert.deepEqual(window.blocks[1],source.blocks[1]);
    assert.equal(window.source,'Provider');
    assert.equal(window.contentWindow.cursor,index);
    assert.equal(window.contentWindow.count,3);
    assert.equal(window.contentWindow.hasMore,index<2);
    assert.ok(window.contentWindow.previousContext.length<=300);
    assert.ok(window.blocks[0].value.isWellFormed());
    if(index)assert.ok(windows[index-1].blocks[0].value.includes(window.contentWindow.previousContext));
  });
  assert.equal(windows[0].contentWindow.previousContext,'');
});

test('long paragraphs and exact links remain atomic, even with paragraph breaks inside a link',()=>{
  const link=`[Label\n\nwith break](<https://example.com/?q=${'x'.repeat(1600)}>)`;
  const story=`Intro.\n\n${link}\n\nFinal 🦋 paragraph.`;
  const windows=advancingSources(JSON.stringify({article:{story,headline:'Title'}})).map(JSON.parse);
  assert.equal(windows.map(window=>window.article.story).join(''),story);
  assert.ok(windows.some(window=>window.article.story.includes(link)));
  assert.equal(windows.at(-1).article.story,'Final 🦋 paragraph.');
  assert.equal(windows.at(-1).contentWindow.previousContext,'','partial long link is omitted from overlap');
});

test('multiple story locations use shared logic and never duplicate stories or reinterpret context',()=>{
  const source={article:{story:paragraph(1)},story:{text:paragraph(2)},context:{story:'Untouched'},description:'Keep me'};
  const windows=advancingSources(JSON.stringify(source)).map(JSON.parse);
  assert.equal(windows.length,2);
  assert.equal(windows.map(window=>window.article.story).join(''),source.article.story);
  assert.equal(windows.map(window=>window.story.text).join(''),source.story.text);
  for(const window of windows){assert.deepEqual(window.context,source.context);assert.equal(window.description,'Keep me');}
  assert.equal(windows[1].contentWindow.previousContext,'','do not carry one article into another');
});

test('empty and non-story source has one terminal window and metadata collisions reject explicitly',()=>{
  for(const source of [{article:{story:''}},{items:[1,2,3]}]){
    const windows=advancingSources(JSON.stringify(source));
    assert.equal(windows.length,1);
    assert.deepEqual(JSON.parse(windows[0]),{...source,contentWindow:{cursor:0,count:1,hasMore:false,previousContext:''}});
  }
  assert.throws(()=>advancingSources('{"contentWindow":{}}'),/already has/);
});

test('context word-boundary selection cannot enter a link label adjacent to prose',()=>{
  const link=`[Label words](<https://example.com/${'x'.repeat(230)}>)`;
  const story=`${'a'.repeat(1300)}prefix${link} suffix\n\nNext paragraph.`;
  const windows=advancingSources(JSON.stringify({story})).map(JSON.parse);
  assert.equal(windows.length,2);
  assert.ok(windows[0].story.includes(link));
  assert.equal(windows[1].contentWindow.previousContext,'suffix');
});
