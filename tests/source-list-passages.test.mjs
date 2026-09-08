import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {sourcePassages} = await server.ssrLoadModule('/src/source-passages.ts');
const {sourceSections, LIST_SECTION_BUDGET, SOURCE_SECTION_BUDGET} = await server.ssrLoadModule('/src/source-sections.ts');
await server.close();
const records = Array.from({length:25},(_,id)=>({id,title:`Story ${id}`,permalink:`/r/example/comments/${id}/story/`,description:'Words '.repeat(65)}));

test('a 25-story homepage stays available to the model across visual scrolls',()=>{
  for (const key of ['articles','stories','posts']) {
    const source={source:'Example',[key]:records};
    const sections=sourceSections(source);
    assert.equal(sections.length,1);
    assert.ok(sections[0].length>SOURCE_SECTION_BUDGET);
    assert.deepEqual(JSON.parse(sections[0]),source);
    assert.deepEqual(sourcePassages(sections[0]),sections);
    assert.equal(JSON.parse(sections[0]).contentWindow,undefined);
  }
});

test('large homepages remain bounded without dropping or reordering records',()=>{
  const source={posts:Array.from({length:100},(_,id)=>({...records[0],id}))};
  const sections=sourceSections(source);
  assert.ok(sections.length>1);
  assert.ok(sections.every(s=>s.length<=LIST_SECTION_BUDGET));
  assert.deepEqual(sections.flatMap(s=>JSON.parse(s).blocks.map(b=>b.value)),source.posts);
  sections.forEach(s=>assert.deepEqual(sourcePassages(s),[s]));
});

test('discussion and explicit section budgets remain unchanged',()=>{
  const source={posts:records,comments:[{body:'A comment'}]};
  assert.ok(sourceSections(source).every(s=>s.length<=SOURCE_SECTION_BUDGET));
  assert.ok(sourceSections({posts:records},2000).every(s=>s.length<=2000));
});
