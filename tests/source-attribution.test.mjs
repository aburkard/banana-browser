import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {renderSourceAttribution} = await server.ssrLoadModule('/src/source-attribution.ts');
await server.close();

test('source credits are accessible external links and clear on unrelated pages', async () => {
  const window = new Window();
  const el = window.document.createElement('div');
  renderSourceAttribution(el, 'https://api.tvmaze.com/shows/1', {source:'TVmaze',sourceUrl:'https://www.tvmaze.com/shows/1/under-the-dome'});
  assert.equal(el.hidden,false);
  assert.equal(el.querySelectorAll('a').length,2);
  assert.equal(el.querySelectorAll('a')[1].textContent,'CC BY-SA');
  assert.equal(el.querySelector('a').rel,'noopener noreferrer');
  renderSourceAttribution(el, 'https://api.artic.edu/api/v1/artworks/1', {source:'Art Institute of Chicago',sourceUrl:'https://www.artic.edu/artworks/1'});
  assert.equal(el.querySelectorAll('a').length,1);
  assert.ok(el.textContent.includes('Public-domain'));
  renderSourceAttribution(el,'https://example.com',{source:'TVmaze',sourceUrl:'https://www.tvmaze.com'});
  assert.equal(el.hidden,true);
  assert.equal(el.childNodes.length,0);
  await window.happyDOM.close();
});

test('source credits reject injected, mismatched or unsafe source URLs', async () => {
  const window = new Window();
  const el = window.document.createElement('div');
  for (const sourceUrl of ['javascript:alert(1)','https://www.tvmaze.com.evil.test','https://user@www.tvmaze.com','https://www.artic.edu','<img src=x onerror=alert(1)>']) {
    renderSourceAttribution(el,'https://api.tvmaze.com/shows/1',{source:'TVmaze',sourceUrl});
    assert.equal(el.hidden,true);
    assert.equal(el.childNodes.length,0);
  }
  renderSourceAttribution(el,'https://api.tvmaze.com/shows/1',{source:'<img src=x>',sourceUrl:'https://www.tvmaze.com'});
  assert.equal(el.hidden,true);
  await window.happyDOM.close();
});
