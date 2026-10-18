// Image-input tokens for the bake-off's frozen ESPN request with references downscaled to 512 px.
// Compare with the October 15 bake-off usage for the original references.
// Paid (one image per model): node --env-file=<file> experiments/whole-page-scroll/ref-size.mjs <fixture dir> <refs dir> [count] [model]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { ROOT } from './sources.mjs';

const [fixtureDir, refsDir] = process.argv.slice(2);
const fixture = JSON.parse(await readFile(path.join(fixtureDir, 'fixture.json'), 'utf8'));
// An optional third argument limits how many references are sent (the first N, as the app would pick them).
const limit = Number(process.argv[4]) || fixture.references.length;
const only = process.argv[5];
const references = await Promise.all(fixture.references.slice(0, limit).map(async ref => ({ description: ref.description, mimeType: 'image/jpeg',
  dataUrl: `data:image/jpeg;base64,${(await readFile(path.join(refsDir, path.basename(ref.file)))).toString('base64')}` })));
const server = await createServer({ root: ROOT, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
const app = await server.ssrLoadModule('/src/browser.ts');
await server.close();
const log = console.log;
console.log = () => {};
const keys = { gemini: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY, openai: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY };
for (const model of only ? [only] : ['gpt-image-2.5-flare', 'nano-banana-2.1']) {
  const browser = new app.BananaBrowser(keys.gemini, keys.openai, model);
  let raw = null;
  const track = browser.trackUsage.bind(browser);
  browser.trackUsage = (type, usage) => { raw = usage; track(type, usage); };
  const started = Date.now();
  const image = model.startsWith('gpt') ? await browser.generateWithOpenAI(fixture.fullPrompt, references) : await browser.generateWithGemini(fixture.fullPrompt, references);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(refsDir, `${model}-${references.length}refs.png`), Buffer.from(image.split(',')[1], 'base64'));
  const line = browser.state.usage.byModel[model];
  log(JSON.stringify({ model, ms: Date.now() - started, costUSD: browser.state.usage.estimatedCost, raw, line }));
}
