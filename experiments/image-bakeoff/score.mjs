// Score a bake-off run offline: local OCR (macOS Vision) against the fixture's headlines and descriptions.
// Usage: node experiments/image-bakeoff/score.mjs [tmp/image-bakeoff/runs/<run-id>]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_DIR, ROOT } from './capture.mjs';
import { loadFixture } from './fixture.mjs';
import { RUNS_DIR } from './run.mjs';
import { buildVocabulary, median, scoreImage } from './scoring.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR_BIN = path.join(ROOT, 'tmp/image-bakeoff/bin/ocr');

function ensureOcr() {
  if (!existsSync(OCR_BIN)) {
    execFileSync('mkdir', ['-p', path.dirname(OCR_BIN)]);
    execFileSync('swiftc', ['-O', path.join(HERE, 'ocr.swift'), '-o', OCR_BIN], { stdio: 'inherit' });
  }
}

async function ocr(imagePath) {
  const cache = `${imagePath}.ocr.json`;
  if (existsSync(cache)) return JSON.parse(await readFile(cache, 'utf8'));
  const result = JSON.parse(execFileSync(OCR_BIN, [imagePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  await writeFile(cache, JSON.stringify(result));
  return result;
}

/** OCR ceiling: the expected strings drawn as clean text, so OCR error is separated from model error. */
async function calibration(expected, vocabulary, directory) {
  await mkdir(directory, { recursive: true });
  const rows = [];
  for (const fontSize of [13, 16, 20]) {
    const file = path.join(directory, `clean-${fontSize}px.png`);
    if (!existsSync(file)) execFileSync(OCR_BIN, ['--render', file, '1536', String(fontSize)], { input: expected.map(item => item.text).join('\n') });
    rows.push({ fontSize, ...scoreImage(await ocr(file), expected, vocabulary) });
  }
  return rows;
}

const pct = (part, total) => total ? `${Math.round(100 * part / total)}%` : '–';
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);

export function aggregate(models, rows) {
  return models.map(model => {
    const attempts = rows.filter(row => row.model === model.id);
    const ok = attempts.filter(row => row.status === 'ok' && row.score);
    const kinds = kind => Object.fromEntries(['total', 'verbatim', 'truncated', 'altered', 'missing']
      .map(field => [field, sum(ok, row => row.score.summary[kind]?.[field] ?? 0)]));
    const words = sum(ok, row => row.score.nonWords.words), unknown = sum(ok, row => row.score.nonWords.unknown);
    const costs = ok.map(row => row.costUSD).filter(Number.isFinite);
    return {
      ...model, attempts: attempts.length, ok: ok.length,
      failures: attempts.filter(row => row.status !== 'ok').map(row => row.error),
      medianSeconds: median(ok.map(row => row.latencyMs / 1000)),
      maxSeconds: ok.length ? Math.max(...ok.map(row => row.latencyMs / 1000)) : null,
      meanCostUSD: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      costSources: [...new Set(ok.map(row => row.costSource))],
      headline: kinds('headline'), description: kinds('description'),
      nonWordRate: words ? unknown / words : null,
      // The tail matters for a browser: one unreadable page is worse than a few typos spread out.
      worstPageNonWords: ok.length ? Math.max(...ok.map(row => row.score.nonWords.unknown)) : null,
      sizes: [...new Set(ok.map(row => `${row.width}×${row.height}`))],
    };
  });
}

export function markdownReport(results, summary, calibrationRows) {
  const money = value => value == null ? '?' : `$${value.toFixed(3)}`;
  const seconds = value => value == null ? '–' : `${value.toFixed(1)} s`;
  const lines = [
    `| Model | Settings | OK | Median | Max | Mean cost | Headlines verbatim | Truncated | Altered | Not shown | Descriptions shown | Non-word rate | Worst page | Output |`,
    `|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|`,
  ];
  for (const model of summary) {
    const { headline, description } = model;
    lines.push(`| ${model.label} | ${model.settings}; ${model.maxReferences} refs | ${model.ok}/${model.attempts} | ${seconds(model.medianSeconds)} | ${seconds(model.maxSeconds)} | ${money(model.meanCostUSD)}${model.costSources.some(source => source !== 'provider') ? '*' : ''} | ` +
      `${headline.verbatim}/${headline.total} (${pct(headline.verbatim, headline.total)}) | ${headline.truncated} | ${headline.altered} | ${headline.missing} | ` +
      `${pct(description.total - description.missing, description.total)} | ${model.nonWordRate == null ? '–' : `${(100 * model.nonWordRate).toFixed(1)}%`} | ${model.worstPageNonWords ?? '–'} | ${model.sizes.join(', ')} |`);
  }
  const calibration = calibrationRows.map(row => `${row.fontSize}px: headlines ${row.summary.headline.verbatim}/${row.summary.headline.total} verbatim, descriptions ${row.summary.description.verbatim}/${row.summary.description.total} verbatim, non-word rate ${(100 * (row.nonWords.rate ?? 0)).toFixed(1)}%`);
  const failures = summary.flatMap(model => model.failures.map(error => `- ${model.label}: ${error}`));
  return [
    `# Image bake-off ${results.runId}`, '',
    `Fixture ${results.fixture.requestSha256.slice(0, 12)} (ESPN NFL News, captured ${results.fixture.capturedAt}, commit ${results.fixture.commit.slice(0, 7)}). ${results.reps} rounds, sequential, no retries. Status: ${results.status}. Ledger $${(results.ledgerUSD ?? 0).toFixed(2)} of $${results.maxSpendUSD} cap.`, '',
    ...lines, '',
    '`*` cost is the app\'s own token-usage estimate (direct OpenAI/Gemini); other costs are OpenRouter\'s reported `usage.cost`.', '',
    `OCR ceiling on clean rendered text — ${calibration.join('; ')}.`, '',
    ...(failures.length ? ['Failures:', ...failures, ''] : []),
  ].join('\n');
}

function gallery(results, rows) {
  const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const cards = rows.filter(row => row.status === 'ok').map(row => `<figure><a href="${escape(row.file)}"><img src="${escape(row.file)}" loading="lazy"></a><figcaption><b>${escape(row.model)}</b> #${row.rep} · ${(row.latencyMs / 1000).toFixed(1)} s · headlines ${row.score.summary.headline.verbatim}/${row.score.summary.headline.total} verbatim · non-words ${row.score.nonWords.unknown}<br>${escape(row.score.items.filter(item => item.kind === 'headline' && item.status !== 'verbatim').map(item => `${item.status}: ${item.text}`).join(' · '))}</figcaption></figure>`);
  return `<!doctype html><meta charset="utf-8"><title>Bake-off ${escape(results.runId)}</title><style>body{font:14px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:20px}img{width:100%;border:1px solid #ccc}figure{margin:0}</style><h1>Bake-off ${escape(results.runId)}</h1><main>${cards.join('')}</main>`;
}

async function main() {
  ensureOcr();
  let directory = process.argv[2] && path.resolve(process.argv[2]);
  if (!directory) {
    const runs = (await readdir(RUNS_DIR)).sort();
    if (!runs.length) throw new Error('No runs found');
    directory = path.join(RUNS_DIR, runs.at(-1));
  }
  const results = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
  const loaded = await loadFixture(FIXTURE_DIR);
  if (loaded.fixture.requestSha256 !== results.fixture.requestSha256) throw new Error('Run used a different fixture than the one on disk');
  let dictionary = [];
  for (const file of ['/usr/share/dict/words', '/usr/share/dict/propernames']) {
    if (existsSync(file)) dictionary = dictionary.concat((await readFile(file, 'utf8')).split('\n'));
  }
  const vocabulary = buildVocabulary([loaded.fixture.fullPrompt], dictionary);
  for (const row of results.rows.filter(row => row.status === 'ok')) {
    const text = await ocr(path.join(directory, row.file));
    Object.assign(row, { width: text.width, height: text.height, score: scoreImage(text, loaded.expected, vocabulary) });
  }
  const calibrationRows = await calibration(loaded.expected, vocabulary, path.join(ROOT, 'tmp/image-bakeoff/calibration'));
  const summary = aggregate(results.models, results.rows);
  await writeFile(path.join(directory, 'scored.json'), JSON.stringify({ ...results, summary, calibration: calibrationRows }, null, 2) + '\n');
  const report = markdownReport(results, summary, calibrationRows);
  await writeFile(path.join(directory, 'report.md'), report);
  await writeFile(path.join(directory, 'gallery.html'), gallery(results, results.rows));
  console.log(report);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
