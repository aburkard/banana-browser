import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {POKEMON_URL,pokemonListUrl,isPokemonApiUrl,normalizePokemonApiUrl,processPokemon} = await server.ssrLoadModule('/src/pokemon.ts');
const {isExampleApiUrl,normalizeExampleApiUrl} = await server.ssrLoadModule('/src/api-examples.ts');
const {processApiResponse} = await server.ssrLoadModule('/src/api-processors.ts');
const {BananaBrowser,BOOKMARKS} = await server.ssrLoadModule('/src/browser.ts');
await server.close();
const base = 'https://pokeapi.co/api/v2/pokemon';
const artwork = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png';
// Fields captured from the public Pikachu response on 2026-09-07.
const pikachu = {id:25,name:'pikachu',height:4,weight:60,
  types:[{slot:1,type:{name:'electric',url:'https://pokeapi.co/api/v2/type/13/'}}],
  abilities:[{is_hidden:false,slot:1,ability:{name:'static'}},{is_hidden:true,slot:3,ability:{name:'lightning-rod'}}],
  stats:[{base_stat:35,effort:0,stat:{name:'hp'}},{base_stat:90,effort:2,stat:{name:'speed'}}],
  sprites:{other:{'official-artwork':{front_default:artwork}}}};

test('bookmark routes through shared normalization, processing and reference extraction',()=>{
  assert.equal(BOOKMARKS['Pokémon'],POKEMON_URL);
  assert.equal(isExampleApiUrl(base+'/25'),true);
  assert.equal(normalizeExampleApiUrl(base+'?limit=999&offset=12'),pokemonListUrl(12));
  const page=processApiResponse(base+'/25',pikachu);
  assert.equal(page.source,'PokéAPI');
  assert.deepEqual(new BananaBrowser('offline').extractImageInfo(page).map(image=>image.url),[artwork]);
});

test('canonical Pokémon requests cap page size, preserve valid offsets and strip irrelevant parameters',()=>{
  assert.equal(POKEMON_URL,base+'?limit=12&offset=0');
  assert.equal(normalizePokemonApiUrl(base+'/?limit=100000&offset=24&embed=all#anything'),pokemonListUrl(24));
  assert.equal(normalizePokemonApiUrl(base+'/pikachu/?limit=1000#anything'),base+'/pikachu');
  for(const offset of ['-1','1.5','Infinity','NaN','oops','9007199254740992']) assert.equal(normalizePokemonApiUrl(base+'?offset='+offset),POKEMON_URL);
  for(const offset of [-1,1.5,Infinity,NaN]) assert.equal(pokemonListUrl(offset),POKEMON_URL);
  assert.equal(normalizePokemonApiUrl(base+'?offset=0012'),pokemonListUrl(12));
});

test('routing rejects host spoofs, credentials, unsafe ids and unsupported paths',()=>{
  for(const url of [base,base+'/',base+'/25',base+'/pikachu/',base+'/mr-mime',base+'/nidoran-f']) assert.equal(isPokemonApiUrl(url),true,url);
  for(const url of ['https://pokeapi.co.evil.test/api/v2/pokemon','https://evil.test/?pokeapi.co',
    'https://user@pokeapi.co/api/v2/pokemon','http://pokeapi.co/api/v2/pokemon','https://pokeapi.co:444/api/v2/pokemon',
    base+'/25/encounters',base+'-species/25',base+'/0',base+'/9007199254740992',base+'/a%2fb',base+'/a/b',base+'/pikachu--x']) {
    assert.equal(isPokemonApiUrl(url),false,url);
    assert.equal(normalizePokemonApiUrl(url),url);
  }
});

test('listing retains provider detail links and actual next/previous links without fan-out or invented art',()=>{
  const raw = {count:1351,previous:base+'?offset=0&limit=12',next:base+'?offset=24&limit=12',results:[{name:'bulbasaur',url:base+'/1/'}]};
  const page = processPokemon(raw,pokemonListUrl(12));
  assert.deepEqual(page.links,[{label:'Previous Pokémon',url:POKEMON_URL},{label:'Next Pokémon',url:pokemonListUrl(24)}]);
  assert.deepEqual(page.articles,[{apiUrl:base+'/1',headline:'Bulbasaur',name:'bulbasaur'}]);
  assert.deepEqual(page.imageUrls,[]);
  assert.equal(page.count,1351);
  assert.equal(page.offset,12);
  assert.equal(Object.keys(page)[0],'links');
  assert.equal(Object.keys(page.articles[0])[0],'apiUrl');
  assert.deepEqual(processPokemon({...raw,next:null,previous:null},POKEMON_URL).links,[]);
  assert.deepEqual(processPokemon({...raw,next:'https://evil.test',previous:base+'?offset=-1',results:[{name:'bad',url:'https://evil.test'}]},POKEMON_URL).articles,[]);
  assert.deepEqual(processPokemon({...raw,next:base+'/25',previous:base+'?offset=-1'},POKEMON_URL).links,[]);
});

test('detail keeps observed official artwork, useful stats and units while dropping bulky related resources',()=>{
  const page = processPokemon({...pikachu,moves:new Array(1000).fill({move:{url:'https://example.com'}})},base+'/pikachu');
  assert.equal(page.article.headline,'Pikachu');
  assert.equal(page.article.heightMeters,0.4);
  assert.equal(page.article.weightKg,6);
  assert.deepEqual(page.article.types,['electric']);
  assert.deepEqual(page.article.stats,[{name:'hp',base:35},{name:'speed',base:90}]);
  assert.deepEqual(page.article.abilities,[{name:'static',hidden:false},{name:'lightning-rod',hidden:true}]);
  assert.deepEqual(page.imageUrls,[artwork]);
  assert.equal(page.article.imageUrl,artwork);
  assert.deepEqual(page.links,[{label:'Browse Pokémon',url:POKEMON_URL}]);
  assert.equal(page.article.moves,undefined);
  assert.ok(JSON.stringify(page).length<2000);
  assert.deepEqual(processPokemon(pikachu,base+'/25').article.types,['electric']);
});

test('optional malformed data stays absent and untrusted image targets are never forwarded',()=>{
  for(const image of [null,'http://example.com/a.png','https://raw.githubusercontent.com.evil.test/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',artwork+'?tracking=1']) {
    const page = processPokemon({sprites:{other:{'official-artwork':{front_default:image}}},height:-2,weight:'60',types:[null],stats:[{stat:{name:'hp'},base_stat:'35'}]},base+'/25');
    assert.deepEqual(page.imageUrls,[]);
    assert.equal(page.article.heightMeters,undefined);
    assert.equal(page.article.weightKg,undefined);
    assert.deepEqual(page.article.stats,[]);
  }
  assert.deepEqual(processPokemon(null,POKEMON_URL).articles,[]);
  assert.throws(()=>processPokemon({},'https://evil.test'),/Unsupported/);
});
