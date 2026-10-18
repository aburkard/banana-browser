// Score the before/after images: share of OCR words not found in the page source (invented or garbled text),
// and for Wikipedia, whether the article's opening sentences appear.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bestMatch, normalize, textBlocks, visibleLines } from '../image-bakeoff/scoring.mjs';
import { OUT, ROOT } from './sources.mjs';

const OCR_BIN = [path.join(ROOT, 'tmp/image-bakeoff/bin/ocr'), path.join(ROOT, '../../../tmp/image-bakeoff/bin/ocr')].find(existsSync);
const LEAD = [
  'A banana is an elongated, edible fruit that is botanically a berry',
  'In some countries, cooking bananas are called plantains, distinguishing them from dessert bananas',
  'The fruit is variable in size, color and firmness, but is usually elongated and curved',
];
const dir = path.join(OUT, 'lean-ab');
const { rows } = JSON.parse(await readFile(path.join(dir, 'results.json'), 'utf8'));
const vocab = {};
const out = [];
for (const row of rows.filter(row => row.file)) {
  if (!vocab[row.page]) {
    const source = JSON.parse(await readFile(path.join(OUT, 'sources', `${row.page}.json`), 'utf8'));
    vocab[row.page] = new Set(normalize(`${source.title} ${source.content}`).split(' '));
  }
  const file = path.join(dir, row.file);
  const cache = `${file}.ocr.json`;
  const ocr = existsSync(cache) ? JSON.parse(await readFile(cache, 'utf8')) : JSON.parse(execFileSync(OCR_BIN, [file], { encoding: 'utf8', maxBuffer: 64e6 }));
  if (!existsSync(cache)) await writeFile(cache, JSON.stringify(ocr));
  const lines = visibleLines(ocr);
  const pageText = lines.map(line => line.text).join(' ');
  const words = normalize(pageText).split(' ').filter(word => /^[a-z]{4,}$/.test(word));
  const foreign = words.filter(word => !vocab[row.page].has(word));
  const lead = row.page === 'wikipedia-banana' && row.step === 0
    ? LEAD.map(sentence => bestMatch(sentence, textBlocks(lines), pageText).similarity >= 0.9).filter(Boolean).length : null;
  out.push({ ...row, words: words.length, foreignRate: +(foreign.length / Math.max(1, words.length)).toFixed(3), foreignSample: foreign.slice(0, 8), leadSentences: lead });
  console.log(`${row.page.padEnd(17)} ${row.model.padEnd(20)} ${row.variant.padEnd(6)} ${row.step}: ${String(words.length).padStart(3)} words, ${(100 * foreign.length / Math.max(1, words.length)).toFixed(1).padStart(5)}% not in source${lead === null ? '' : `, lead ${lead}/3`}  $${row.usd.toFixed(4)} ${(row.ms / 1000).toFixed(1)}s  e.g. ${foreign.slice(0, 5).join(' ')}`);
}
await writeFile(path.join(dir, 'scored.json'), JSON.stringify(out, null, 2));
