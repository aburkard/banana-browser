// Score scroll progression from OCR: which page paragraphs each screenshot shows, in order.
//   node experiments/whole-page-scroll/score.mjs
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bestMatch, normalize, textBlocks, visibleLines } from '../image-bakeoff/scoring.mjs';
import { OUT, ROOT } from './sources.mjs';
import { pageWindow } from './run.mjs';

// Compiled from experiments/image-bakeoff/ocr.swift (macOS Vision, no network).
const OCR_BIN = [path.join(ROOT, 'tmp/image-bakeoff/bin/ocr'), path.join(ROOT, '../../../tmp/image-bakeoff/bin/ocr')].find(existsSync);
const SHOWN = 0.75;

/** Readable paragraph units of the window, in order: link targets and images removed, short labels skipped. */
export function units(content) {
  const seen = new Set();
  return content.split('\n').map(line => line.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\((<[^>]*>|[^)]*)\)/g, '$1')
    .replace(/^[\s>#*|-]+/, '').replace(/\s+/g, ' ').trim())
    .map((text, line) => ({ text, line }))
    .filter(unit => normalize(unit.text).length >= 30 && !seen.has(normalize(unit.text)) && seen.add(normalize(unit.text)));
}

/** A unit counts as shown when its opening or closing 60 characters are found. */
function shown(unit, blocks, pageText) {
  const ends = [unit.text.slice(0, 60), unit.text.slice(-60)];
  return Math.max(...ends.map(end => bestMatch(end, blocks, pageText).similarity)) >= SHOWN;
}

async function ocr(file) {
  const cache = `${file}.ocr.json`;
  if (existsSync(cache)) return JSON.parse(await readFile(cache, 'utf8'));
  const result = JSON.parse(execFileSync(OCR_BIN, [file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  await writeFile(cache, JSON.stringify(result));
  return result;
}

const runDir = path.join(OUT, 'run');
const rows = [];
for (const name of ['results.json', 'results-read.json']) if (existsSync(path.join(runDir, name))) rows.push(...JSON.parse(await readFile(path.join(runDir, name), 'utf8')).rows);
const report = [];
for (const page of [...new Set(rows.map(row => row.page))]) {
  const source = JSON.parse(await readFile(path.join(OUT, 'sources', `${page}.json`), 'utf8'));
  const pageUnits = units(pageWindow(source).content);
  for (const variant of [...new Set(rows.filter(row => row.page === page).map(row => row.variant))]) {
    const screens = [];
    for (const row of rows.filter(row => row.page === page && row.variant === variant && row.file)) {
      const result = await ocr(path.join(runDir, row.file));
      const lines = visibleLines(result);
      const blocks = textBlocks(lines);
      const pageText = lines.map(line => line.text).join(' ');
      screens.push({ step: row.step, indices: pageUnits.flatMap((unit, index) => shown(unit, blocks, pageText) ? [index] : []), reportedLast: row.reportedLast, usd: row.usd, ms: row.ms });
    }
    const everShown = new Set(screens.flatMap(screen => screen.indices));
    const start = screens[0]?.indices[0] ?? 0;
    const end = Math.max(-1, ...everShown);
    const skipped = pageUnits.map((_, index) => index).filter(index => index > start && index < end && !everShown.has(index));
    const lines = screens.map((screen, k) => {
      const before = new Set(screens.slice(0, k).flatMap(s => s.indices));
      const fresh = screen.indices.filter(index => !before.has(index));
      const repeated = screen.indices.filter(index => before.has(index));
      return `  step ${screen.step}: units ${screen.indices.length ? `${Math.min(...screen.indices)}–${Math.max(...screen.indices)}` : 'none'}, new ${fresh.length}, repeated ${repeated.length}${repeated.length ? ` (${repeated.join(',')})` : ''}, $${screen.usd.toFixed(4)}, ${(screen.ms / 1000).toFixed(1)}s`;
    });
    report.push({ page, variant, units: pageUnits.length, start, end, shownTotal: everShown.size, skipped });
    console.log(`\n${page} / ${variant}: ${everShown.size} distinct units shown, reached unit ${end}, skipped ${skipped.length} between ${start} and ${end}${skipped.length ? `: ${skipped.slice(0, 30).join(',')}` : ''}`);
    console.log(lines.join('\n'));
  }
}
await writeFile(path.join(runDir, 'scored.json'), JSON.stringify(report, null, 2));
