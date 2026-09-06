import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paginate} from '../experiments/content-pagination/paginate.mjs';

test('offline article pagination preserves every paragraph, tail and target within valid JSON budgets',()=>{
  const blocks=Array.from({length:100},(_,i)=>({id:`p${i}`,text:`Paragraph ${i}: ${'Prose with "quotes", newlines\n and emoji 🍌. '.repeat(60)}`,links:[{label:`Story ${i}`,url:`https://example.com/stories/${i}`}]}));
  const pages=paginate(blocks);
  assert.ok(pages.length>1);
  const restored=pages.flatMap(page=>{assert.ok(page.length<=6000);return JSON.parse(page).blocks;});
  for(const block of blocks) {
    const pieces=restored.filter(item=>item.id===block.id);
    assert.equal(pieces.map(item=>item.text).join(''),block.text);
    assert.ok(pieces.every(piece=>JSON.stringify(piece.links)===JSON.stringify(block.links)));
  }
  assert.equal(restored.at(-1).id,'p99');
});

test('oversized paragraphs split without corrupting Unicode, escapes, whitespace or URLs',()=>{
  const block={id:'long',text:'🍌 "\\\n '.repeat(3000),links:[{label:'Next',url:'https://example.com/next?a=1&b=2'}]};
  const pages=paginate([block],400);
  const pieces=pages.flatMap(page=>{assert.ok(page.length<=400);return JSON.parse(page).blocks;});
  assert.equal(pieces.map(piece=>piece.text).join(''),block.text);
  assert.ok(pieces.every(piece=>!piece.text.includes('\uFFFD')));
  for(const piece of pieces) assert.deepEqual(piece.links,block.links);
});

test('small blocks stay intact and final or empty source never creates another page',()=>{
  assert.deepEqual(paginate([]),[]);
  const blocks=[{id:'one',text:'First paragraph'},{id:'two',text:'Second paragraph'}];
  assert.deepEqual(JSON.parse(paginate(blocks)[0]).blocks,blocks.map(block=>({...block,links:[]})));
});

test('invalid identities, unsafe links and oversized metadata fail explicitly',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hello','https://user:pass@example.com','/relative']) {
    assert.throws(()=>paginate([{id:'p',text:'test',links:[{label:'bad',url}]}]));
  }
  assert.throws(()=>paginate([{id:'p',text:'one'},{id:'p',text:'two'}]));
  assert.throws(()=>paginate([{id:'p',text:'test',links:[{label:'large'.repeat(300),url:'https://example.com'}]}],256),/metadata/);
  assert.throws(()=>paginate([],NaN),/budget/);
});
