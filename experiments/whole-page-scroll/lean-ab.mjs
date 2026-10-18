// Before/after for image-view windows, through BananaBrowser's real prompt and provider code.
//   before: the previous production window (first 24,000 characters of raw source, URLs included).
//   after:  the image view (no link targets) sized to 24,000 characters, plus one scroll.
// Paid: node --env-file=<file> experiments/whole-page-scroll/lean-ab.mjs --run [--max-spend 1]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { OUT, ROOT } from './sources.mjs';

const PAGES = { 'wikipedia-banana': 'https://en.wikipedia.org/wiki/Banana', 'npr-home': 'https://www.npr.org/' };
const MODELS = ['nano-banana-2.1', 'gpt-image-2.5-flare'];
const GUARD_USD = 0.1;

const { values } = parseArgs({ options: { run: { type: 'boolean' }, 'max-spend': { type: 'string', default: '1' } } });
const server = await createServer({ root: ROOT, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } } });
const app = await server.ssrLoadModule('/src/browser.ts');
const { sourceSections } = await server.ssrLoadModule('/src/source-sections.ts');
await server.close();

const oldWindow = source => {
  const whole = JSON.stringify(source);
  if (whole.length <= 24_000) return whole;
  const fragments = sourceSections(source, 12_000).slice(0, 2);
  return JSON.stringify({ blocks: fragments.flatMap(fragment => JSON.parse(fragment).blocks) });
};
const plan = Object.keys(PAGES).flatMap(page => MODELS.flatMap(model => [{ page, model, variant: 'before', steps: 1 }, { page, model, variant: 'after', steps: 2 }]));
if (!values.run) {
  console.log(`Dry run: ${plan.reduce((sum, item) => sum + item.steps, 0)} images planned, cap $${values['max-spend']}`);
  process.exit(0);
}
const keys = { gemini: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY, openai: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY };
const log = console.log;
console.log = () => {};
const outDir = path.join(OUT, 'lean-ab');
await mkdir(outDir, { recursive: true });
let spent = 0;
const rows = [];
for (const item of plan) {
  const source = JSON.parse(await readFile(path.join(OUT, 'sources', `${item.page}.json`), 'utf8'));
  const browser = new app.BananaBrowser(keys.gemini, keys.openai, item.model);
  browser.fetchApiData = async () => source;
  browser.fetchReferenceImages = async () => []; // needs a browser Image; equal across variants
  browser.logImage = () => {};
  if (item.variant === 'before') {
    const build = browser.buildImagePrompt.bind(browser);
    browser.buildImagePrompt = (url, data) => build(url, data).replace(/# DATA\n[\s\S]*?\n\n# REMINDER/, `# DATA\n${oldWindow(source)}\n\n# REMINDER`);
  }
  for (let step = 0; step < item.steps; step++) {
    if (spent + GUARD_USD > Number(values['max-spend'])) { log(`stop: spent $${spent.toFixed(3)}`); break; }
    const before = browser.state.usage.estimatedCost;
    const started = Date.now();
    if (step === 0) await browser.navigate(PAGES[item.page]); else await browser.scrollDown();
    const usd = browser.state.usage.estimatedCost - before;
    spent += usd;
    const error = browser.state.error;
    const file = `${item.page}-${item.model}-${item.variant}-${step}.${/^data:image\/jpeg/.test(browser.state.currentImage || '') ? 'jpg' : 'png'}`;
    if (!error) await writeFile(path.join(outDir, file), Buffer.from(browser.state.currentImage.split(',')[1], 'base64'));
    rows.push({ ...item, step, file: error ? null : file, ms: Date.now() - started, usd, error: error ? String(error).slice(0, 200) : null });
    log(`${item.page} ${item.model} ${item.variant} ${step}: ${error ? 'ERROR ' + String(error).slice(0, 120) : 'ok'} ${((Date.now() - started) / 1000).toFixed(1)}s $${usd.toFixed(4)}`);
    if (error) break;
  }
  await writeFile(path.join(outDir, 'results.json'), JSON.stringify({ rows, spent }, null, 2));
}
log(`done: ${rows.length} images, $${spent.toFixed(3)}`);
