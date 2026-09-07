// Offline only: execute production prompt builders with synthetic image bytes and a fake SDK.
// No credentials, browser storage, provider requests, or real image generation are used.
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../../', import.meta.url));
const originalFetch = globalThis.fetch;
const originalLog = console.log;
globalThis.fetch = async () => { throw new Error('Network is disabled for this offline measurement'); };
console.log = () => {};
let server;
try {
  server = await createServer({ root, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
  const { BananaBrowser } = await server.ssrLoadModule('/src/browser.ts');
  const { processApiResponse } = await server.ssrLoadModule('/src/api-processors.ts');
  const fixtureBytes = await readFile(new URL('../../tests/fixtures/api-examples/tv-search.json', import.meta.url));
  const source = processApiResponse('https://api.tvmaze.com/search/shows?q=star%20trek', JSON.parse(fixtureBytes));
  const browser = new BananaBrowser('', '');
  const captures = [];
  browser.geminiAI = { models: { generateContent: async request => {
    captures.push(structuredClone(request));
    return { text: '{"action":"none","reason":"Offline fixture"}', candidates: [{content:{parts:[{inlineData:{mimeType:'image/png',data:'ZmFrZQ=='}}]}}] };
  } } };
  browser.setClickModel('gemini-3.8-flash');
  browser.logImage = () => {};
  browser.drawPointerOnImage = async (_image, x) => `data:image/png;base64,${Buffer.from(`synthetic pointer ${x}`).toString('base64')}`;
  browser.state.currentImage = 'data:image/png;base64,c3ludGhldGlj';
  browser.state.currentApiData = source;
  browser.state.currentUrl = 'https://api.tvmaze.com/search/shows?q=star%20trek';

  await browser.interpretClick(100, 200);
  await browser.interpretClick(400, 200);
  const clickA = captures.shift();
  const clickB = captures.shift();
  browser.sessionImage = 'data:image/png;base64,c3ludGhldGljLTE=';
  browser.isScrollingDown = true;
  const prompt = browser.buildImagePrompt(browser.state.currentUrl, source);
  await browser.generateWithGemini(prompt);
  browser.sessionImage = 'data:image/png;base64,c3ludGhldGljLTI=';
  await browser.generateWithGemini(prompt);
  const imageA = captures.shift();
  const imageB = captures.shift();

  function commonText(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }
  function measure(a, b) {
    let identicalLeadingParts = 0;
    let leadingTextCharacters = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i].text !== undefined && b[i].text !== undefined) {
        leadingTextCharacters += commonText(a[i].text, b[i].text);
      }
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) break;
      identicalLeadingParts++;
    }
    return { identicalLeadingParts, leadingTextCharacters };
  }
  function reportPair(a, b) {
    const textA = a.contents.filter(part => part.text !== undefined).map(part => part.text).join('\n');
    const textB = b.contents.filter(part => part.text !== undefined).map(part => part.text).join('\n');
    const textFirst = parts => [...parts.filter(part => part.text !== undefined), ...parts.filter(part => part.text === undefined)];
    return {
      model: a.model,
      partOrder: a.contents.map(part => part.text !== undefined ? 'text' : 'image'),
      textCharacters: [textA.length, textB.length],
      textOnlyCommonPrefixCharacters: commonText(textA, textB),
      currentOrder: measure(a.contents, b.contents),
      hypotheticalTextFirst: measure(textFirst(a.contents), textFirst(b.contents)),
    };
  }
  const result = {
    scope: 'Offline structural measurement; characters are not tokens or cache hits. Synthetic images cannot estimate image token usage.',
    fixture: { path: 'tests/fixtures/api-examples/tv-search.json', sha256: createHash('sha256').update(fixtureBytes).digest('hex'), processedCharacters: JSON.stringify(source).length },
    differentClicksOnSamePage: reportPair(clickA, clickB),
    differentPreviousImagesWithSameScrollPrompt: reportPair(imageA, imageB),
    providerCalls: 0,
  };
  assert.equal(captures.length, 0);
  assert.equal(result.differentClicksOnSamePage.currentOrder.identicalLeadingParts, 0);
  assert.equal(result.differentPreviousImagesWithSameScrollPrompt.currentOrder.identicalLeadingParts, 0);
  originalLog(JSON.stringify(result, null, 2));
} finally {
  await server?.close();
  globalThis.fetch = originalFetch;
  console.log = originalLog;
}
