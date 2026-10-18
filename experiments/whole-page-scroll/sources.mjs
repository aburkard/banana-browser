// Read test pages through the production keyless reader (relay + htmlToScrape + normalizeWebpage)
// and save the same source object the app would hold. No model calls.
import { createServer as createHttpServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { createServer } from 'vite';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const OUT = path.join(ROOT, 'tmp/whole-page-scroll');
// The relay admits allowlisted browser origins; this local dev origin is one of them.
const RELAY_ORIGIN = 'http://127.0.0.1:5178';

export async function loadModules() {
  const server = await createServer({ root: ROOT, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
  try {
    return {
      browser: await server.ssrLoadModule('/src/browser.ts'),
      fetching: await server.ssrLoadModule('/src/webpage-fetch.ts'),
      reader: await server.ssrLoadModule('/src/webpage-reader.ts'),
    };
  } finally { await server.close(); }
}

export async function readPage(url, { fetching, reader }) {
  const window = new Window();
  globalThis.DOMParser = window.DOMParser;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init = {}) => String(input).startsWith(reader.READER_ENDPOINT)
    ? originalFetch(input, { ...init, headers: { ...(init.headers || {}), Origin: RELAY_ORIGIN } })
    : originalFetch(input, init);
  try {
    const source = await fetching.fetchWebpage(url, () => {});
    return { source, via: reader.webpageReadVia(source) ?? null };
  } finally { globalThis.fetch = originalFetch; await window.happyDOM.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const modules = await loadModules();
  await mkdir(path.join(OUT, 'sources'), { recursive: true });
  for (const [name, url] of [['wikipedia-banana', 'https://en.wikipedia.org/wiki/Banana'], ['npr-home', 'https://www.npr.org/']]) {
    const { source, via } = await readPage(url, modules);
    await writeFile(path.join(OUT, 'sources', `${name}.json`), JSON.stringify(source));
    console.log(`\n== ${name}: ${JSON.stringify(source).length} chars JSON, content ${source.content.length} chars, ${source.links.length} links, via ${via ? via.kind : 'live'}`);
    console.log(source.content.slice(0, 1500));
  }
}
