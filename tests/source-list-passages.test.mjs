import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {sourcePassages} = await server.ssrLoadModule('/src/source-passages.ts');
const {sourceSections} = await server.ssrLoadModule('/src/source-sections.ts');
await server.close();
const record = id => ({id,headline:`Episode ${id} 🦋`,date:'1964-04-18',rating:7.8,apiUrl:`https://api.tvmaze.com/episodes/${id}?a=1&b=2`,imageUrl:`https://images.example/${id}.png`,description:'Words '.repeat(35)});
const records = Array.from({length:13},(_,i)=>record(i));
const windows = source => sourcePassages(JSON.stringify(source)).map(JSON.parse);

test('list windows retain ordered whole records, exact navigation and numbers, and bounded overlap',()=>{
  const result = windows({source:'TVmaze',articles:records,imageUrls:records.slice(0,5).map(r=>r.imageUrl),links:[{url:'../next',label:'Next'}]});
  assert.deepEqual(result.flatMap(w=>w.articles),records);
  result.forEach((w,index)=>{
    assert.ok(w.articles.length<=3);
    assert.equal(w.source,'TVmaze');assert.deepEqual(w.links,[{url:'../next',label:'Next'}]);
    assert.equal(w.contentWindow.kind,'list');assert.equal(w.contentWindow.cursor,index);
    assert.equal(w.contentWindow.hasMore,index<result.length-1);
    assert.equal(w.imageUrls,undefined);
  });
});

test('sectioned whole lists retain every identity and all non-list metadata',()=>{
  const sections=sourceSections({source:'TVmaze',articles:records,links:[{url:'../next'}]},1800);
  const all=sections.flatMap(s=>sourcePassages(s).map(JSON.parse));
  const seen=all.flatMap(w=>w.blocks.filter(b=>b.path[0]==='articles').map(b=>b.value));
  assert.deepEqual(seen,records);
  assert.ok(all.some(w=>w.blocks.some(b=>b.path[0]==='links')));
  const whole=windows({blocks:[{path:['articles'],value:records,context:{title:'Show'}}]});
  assert.deepEqual(whole.flatMap(w=>w.blocks.map(b=>b.value)),records);
  assert.deepEqual(whole.flatMap(w=>w.blocks.map(b=>b.path[1])),records.map((_,i)=>i));
});

test('oversized records remain indivisible; unrelated images and unsupported fragments remain intact',()=>{
  const huge={...record(1),description:'Long '.repeat(700)};
  const result=windows({articles:[huge,record(2)],imageUrls:['https://other.example/logo.png']});
  assert.deepEqual(result.map(w=>w.articles),[[huge],[record(2)]]);
  assert.deepEqual(result[0].imageUrls,['https://other.example/logo.png']);
  for(const source of [{articles:[{description:'No identity'}]},{articles:[record(1)],posts:[record(2)]},{blocks:[{path:['articles',1,'description'],value:'Partial record'}]}]) {
    const json=JSON.stringify(source,null,2);assert.deepEqual(sourcePassages(json),[json]);
  }
});

test('related lists do not terminate narrative or discussion scrolling',()=>{
  const story=['First '.repeat(180),'Second '.repeat(150),'Last '.repeat(200)].join('\n\n');
  const result=windows({articles:[record(1)],story});
  assert.equal(result.length,3);assert.equal(result.map(w=>w.story).join(''),story);
  for(const source of [{articles:[record(1)],comments:[{text:'Comment '.repeat(300)}]},
    {blocks:[{path:['articles'],value:[record(1)]},{path:['comments'],value:[{text:'Comment'}]}]}]) {
    const json=JSON.stringify(source);assert.deepEqual(sourcePassages(json),[json]);
  }
});
