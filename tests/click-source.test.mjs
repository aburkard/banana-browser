import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {compactClickSource} = await server.ssrLoadModule('/src/click-source.ts');
const {processApiResponse} = await server.ssrLoadModule('/src/api-processors.ts');
await server.close();

test('click projection preserves navigation, identity, captions, and full overlap prose',()=>{
  const identity = {id:42, headline:'Shared label', name:'Record', label:'Open', apiUrl:'https://example.com/api/42', url:'/relative', permalink:'/story/42', links:[{label:'Next',url:'/next'}], sourceUrl:'https://example.com/source', licenseUrl:'https://example.com/license', imageCaption:'The selected picture'};
  const previousStory = '[Earlier target](<https://example.com/early>) ' + 'Previous passage words. '.repeat(100);
  const source = {
    currentView:{article:{...identity,story:'Current passage',imageUrl:'https://images.example.com/current'},imageUrls:['https://images.example.com/current'],contentWindow:{cursor:1,previousContext:'Short tail'}},
    previousView:{blocks:[{path:['article','story'],value:previousStory,context:{...identity,imageUrl:'https://images.example.com/previous'}}],contentWindow:{cursor:0,previousContext:''}},
  };
  const original = JSON.stringify(source);
  const expected = structuredClone(source);
  delete expected.currentView.article.imageUrl;
  delete expected.currentView.imageUrls;
  delete expected.previousView.blocks[0].context.imageUrl;
  assert.deepEqual(JSON.parse(compactClickSource(original)),expected);
  assert.equal(JSON.stringify(source),original);
  assert.equal(JSON.parse(compactClickSource(original)).previousView.blocks[0].value,previousStory);
});

test('sources without reference fields retain their exact representation and block paths',()=>{
  const source = '{ "blocks": [{"path":["article","imageUrl"],"value":"https://example.com/image"}], "id": 7 }';
  assert.equal(compactClickSource(source),source);
});

test('processed fixtures reduce click source characters while preserving every other field',async()=>{
  const fixtures = [
    ['tv-search','https://api.tvmaze.com/search/shows?q=star%20trek',1245],
    ['tv-show','https://api.tvmaze.com/shows/1',175],
    ['art-gallery','https://api.artic.edu/api/v1/artworks',1710],
    ['artwork','https://api.artic.edu/api/v1/artworks/1',209],
  ];
  for (const [name,url,saved] of fixtures) {
    const raw = JSON.parse(await readFile(new URL(`./fixtures/api-examples/${name}.json`,import.meta.url),'utf8'));
    const source = processApiResponse(url,raw);
    const original = JSON.stringify(source);
    const compact = compactClickSource(original);
    const expected = structuredClone(source);
    delete expected.imageUrls;
    for (const article of expected.articles ?? [expected.article]) delete article.imageUrl;
    assert.deepEqual(JSON.parse(compact),JSON.parse(JSON.stringify(expected)),name);
    assert.equal(original.length-compact.length,saved,name);
  }
});
