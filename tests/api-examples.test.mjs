import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {processApiResponse} = await server.ssrLoadModule('/src/api-processors.ts');
const {ART_GALLERY_URL, TVMAZE_SEARCH_URL, normalizeExampleApiUrl, isExampleApiUrl} = await server.ssrLoadModule('/src/api-examples.ts');
const {sourceSections} = await server.ssrLoadModule('/src/source-sections.ts');
await server.close();
const artwork = JSON.parse(await readFile(new URL('./fixtures/api-examples/artwork.json', import.meta.url), 'utf8'));
const show = JSON.parse(await readFile(new URL('./fixtures/api-examples/tv-show.json', import.meta.url), 'utf8'));

test('Art requests select useful fields and enforce small public-domain gallery pages', () => {
  const url = new URL(normalizeExampleApiUrl('https://api.artic.edu/api/v1/artworks/search?limit=1000&page=2&q=cats'));
  assert.equal(url.searchParams.get('limit'), '12');
  assert.equal(url.searchParams.get('query[term][is_public_domain]'), 'true');
  assert.equal(url.searchParams.get('q'), 'cats');
  assert.ok(url.searchParams.get('fields').includes('image_id'));
  assert.equal(url.searchParams.get('page'), '2');
});

test('captured artwork produces a reference image and attributed detail', () => {
  const page = processApiResponse('https://api.artic.edu/api/v1/artworks/27992', artwork);
  assert.equal(page.article.headline, artwork.data.title);
  assert.ok(page.article.imageUrl.includes(artwork.data.image_id));
  assert.equal(page.article.sourceUrl, 'https://www.artic.edu/artworks/27992');
  assert.equal(page.imageUrls.length, 1);
  assert.equal(page.links[0].url, ART_GALLERY_URL);
});

test('gallery filters restricted art, handles missing images and links real next pages', () => {
  const page = processApiResponse(ART_GALLERY_URL, {data:[artwork.data, {...artwork.data,id:2,is_public_domain:false}, {...artwork.data,id:3,image_id:null}],pagination:{total_pages:2}});
  assert.equal(page.articles.length, 2);
  assert.equal(page.articles[1].imageUrl, undefined);
  assert.equal(page.imageUrls.length, 1);
  assert.equal(new URL(page.links[0].url).searchParams.get('page'), '2');
  assert.ok(new URL(normalizeExampleApiUrl(page.articles[0].apiUrl)).searchParams.has('fields'));
  assert.deepEqual(processApiResponse(ART_GALLERY_URL,{data:[],pagination:{total_pages:1}}).links, []);
  assert.equal(processApiResponse('https://api.artic.edu/api/v1/artworks/2',{data:{id:2,is_public_domain:false}}).imageUrls.length,0);
});

test('captured TV show navigates via seasons with attribution, no embedded episode payload', () => {
  const page = processApiResponse(TVMAZE_SEARCH_URL, [{score:1,show}]);
  assert.equal(page.articles[0].apiUrl, 'https://api.tvmaze.com/shows/1');
  const detail = processApiResponse(page.articles[0].apiUrl, {...show,_embedded:{episodes:new Array(1000).fill({})}});
  assert.equal(detail.links[0].url, 'https://api.tvmaze.com/shows/1/seasons');
  assert.ok(detail.attribution.includes('CC BY-SA'));
  assert.equal(detail.article.sourceUrl, show.url);
  assert.equal(JSON.stringify(detail).includes('_embedded'), false);
  assert.equal(normalizeExampleApiUrl('https://api.tvmaze.com/shows/1?embed=episodes'),'https://api.tvmaze.com/shows/1');
});

test('season and episode links use provider ids and handle missing optional metadata', () => {
  const seasons = processApiResponse('https://api.tvmaze.com/shows/1/seasons',[{id:7,number:1,image:null}]);
  assert.equal(seasons.articles[0].apiUrl,'https://api.tvmaze.com/seasons/7/episodes');
  const episodes = processApiResponse(seasons.articles[0].apiUrl,[{id:9,name:'Pilot',season:1,number:1}]);
  assert.equal(episodes.articles[0].apiUrl,'https://api.tvmaze.com/episodes/9');
  assert.deepEqual(episodes.imageUrls,[]);
  const detail = processApiResponse(episodes.articles[0].apiUrl,{id:9,name:'Pilot',_links:{show:{href:'https://api.tvmaze.com/shows/1'}}});
  assert.equal(detail.links[0].url,'https://api.tvmaze.com/shows/1');
  assert.equal(processApiResponse(TVMAZE_SEARCH_URL,new Array(20).fill({show})).articles.length,20);
});

test('example routing rejects host spoofing and unsupported bulk endpoints', () => {
  for (const url of ['https://api.tvmaze.com.evil.test/shows/1','https://evil.test/?api.artic.edu','https://api.tvmaze.com/shows/1/episodes','https://user@api.tvmaze.com/shows/1','http://api.tvmaze.com/shows/1']) assert.equal(isExampleApiUrl(url),false);
  const raw = {secret:'untouched'};
  assert.equal(processApiResponse('https://api.tvmaze.com.evil.test/shows/1',raw),raw);
});

test('captured live gallery retains public-domain images and authoritative pagination', async () => {
  const gallery = JSON.parse(await readFile(new URL('./fixtures/api-examples/art-gallery.json', import.meta.url), 'utf8'));
  const page = processApiResponse(ART_GALLERY_URL, gallery);
  assert.equal(page.articles.length,12);
  assert.equal(page.imageUrls.length,5);
  assert.equal(new URL(page.links[0].url).searchParams.get('page'),'2');
  assert.ok(JSON.stringify(page).length < JSON.stringify(gallery).length);
});

test('example listings keep all offered targets intact across bounded source sections', async () => {
  const gallery = JSON.parse(await readFile(new URL('./fixtures/api-examples/art-gallery.json', import.meta.url), 'utf8'));
  const search = JSON.parse(await readFile(new URL('./fixtures/api-examples/tv-search.json', import.meta.url), 'utf8'));
  const pages = [
    processApiResponse(ART_GALLERY_URL,gallery),
    processApiResponse(TVMAZE_SEARCH_URL,search),
    processApiResponse('https://api.tvmaze.com/shows/1/seasons',Array.from({length:30},(_,index)=>({...show,id:index+1,number:index+1}))),
    processApiResponse('https://api.tvmaze.com/seasons/1/episodes',Array.from({length:30},(_,index)=>({...show,id:index+1,season:1,number:index+1}))),
  ];
  for (const page of pages) {
    const sections = sourceSections(page);
    for (const section of sections) { assert.ok(section.length <= 24000); JSON.parse(section); }
    const clickContext = sections.join("\n");
    for (const target of [...page.links.map(link=>link.url),...page.articles.map(article=>article.apiUrl)]) assert.ok(clickContext.includes(JSON.stringify(target)),target);
    assert.equal(Object.keys(page)[0],'links');
    assert.equal(Object.keys(page.articles[0])[0],'apiUrl');
  }
  assert.equal(pages[2].articles.length,30);
  assert.equal(pages[3].articles.length,30);
});

test('long detail descriptions cannot push provider navigation beyond the click context', () => {
  for (const [url,raw] of [
    ['https://api.artic.edu/api/v1/artworks/27992',{...artwork,data:{...artwork.data,description:'long description '.repeat(2000)}}],
    ['https://api.tvmaze.com/shows/1',{...show,summary:'long description '.repeat(2000)}],
  ]) {
    const page=processApiResponse(url,raw);
    const sections=sourceSections(page);
    assert.equal(page.article.story, 'long description '.repeat(2000).trim());
    assert.ok(sections.length>1);
    for (const section of sections) {
      assert.ok(section.length<=8000); JSON.parse(section);
      for (const link of page.links) assert.ok(section.includes(JSON.stringify(link.url)));
    }
  }
});
