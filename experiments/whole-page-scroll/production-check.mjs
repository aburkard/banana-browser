// One production navigate + scroll through BananaBrowser itself (page window and real prompt; no reference photos).
// Paid, two Nano Banana 2.1 images: node --env-file=<file> experiments/whole-page-scroll/production-check.mjs <url>
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Window } from 'happy-dom';
import { OUT, loadModules } from './sources.mjs';

const url = process.argv[2] || 'https://en.wikipedia.org/wiki/Banana';
const key = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!key) throw new Error('No Gemini key in the environment');
const { browser: app, reader } = await loadModules();
const window = new Window();
globalThis.DOMParser = window.DOMParser;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => String(input).startsWith(reader.READER_ENDPOINT)
  ? originalFetch(input, { ...init, headers: { ...(init.headers || {}), Origin: 'http://127.0.0.1:5178' } })
  : originalFetch(input, init);
const log = console.log;
console.log = () => {};
const outDir = path.join(OUT, 'production');
await mkdir(outDir, { recursive: true });
const browser = new app.BananaBrowser(key, undefined, 'nano-banana-2.1');
// Reference photos and console thumbnails use a browser Image, which Node lacks; this check skips them.
browser.fetchReferenceImages = async () => [];
browser.logImage = () => {};
const save = async (name) => {
  const [, mime, data] = /^data:([^;]+);base64,(.+)$/.exec(browser.state.currentImage);
  await writeFile(path.join(outDir, `${name}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`), Buffer.from(data, 'base64'));
};
// Surface the first internal error with its stack (navigate catches and stores only the message).
const originalGenerate = browser.generatePageImage.bind(browser);
// A first view saved by an earlier run is reused, so a rerun pays only for the scroll.
const savedFirst = path.join(outDir, '0.jpg');
let reuse = existsSync(savedFirst) ? `data:image/jpeg;base64,${(await readFile(savedFirst)).toString('base64')}` : null;
browser.generatePageImage = async (...args) => {
  if (reuse) { const image = reuse; reuse = null; log('reused the saved first view'); return image; }
  try { return await originalGenerate(...args); } catch (error) { log(String(error.stack).split('\n').slice(0, 4).join('\n')); throw error; }
};
await browser.navigate(url);
if (browser.state.error) throw new Error(browser.state.error);
await save('0');
await browser.scrollDown();
if (browser.state.error) throw new Error(browser.state.error);
await save('1');
const usage = browser.state.usage;
log(JSON.stringify({ images: usage.imageGenerations, costUSD: usage.estimatedCost, costIncomplete: usage.costIncomplete, windowChars: browser.activeSource.length, canScrollDown: browser.canScrollDown() }));
await window.happyDOM.close();
