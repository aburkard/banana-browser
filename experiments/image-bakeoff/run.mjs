// Generate bake-off images from the frozen fixture under a hard spend cap.
// Default is a dry run (no requests). Paid run: node --env-file=<file> experiments/image-bakeoff/run.mjs --run --max-spend 8 --reps 5
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { FIXTURE_DIR, ROOT, loadApp } from './capture.mjs';
import { loadFixture } from './fixture.mjs';
import { MODELS } from './models.mjs';

export const RUNS_DIR = path.join(ROOT, 'tmp/image-bakeoff/runs');
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function apiKeys(env = process.env) {
  return {
    openai: env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || null,
    gemini: env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || env.GOOGLE_API_KEY || null,
    openrouter: env.OPENROUTER_API_KEY || null,
  };
}

/** Provider errors can echo key fragments; strip known key shapes and exact values. */
export function sanitize(message, keys) {
  let text = String(message ?? 'Unknown error');
  for (const key of Object.values(keys)) if (key) text = text.split(key).join('[key]');
  return text.replace(/\b(sk-[A-Za-z0-9_*-]{4,}|AIza[0-9A-Za-z_-]{10,}|sk-or-[A-Za-z0-9_*-]{4,})/g, '[key]').slice(0, 300);
}

/** Round-robin schedule, rotated each round so no model always goes first. */
export function schedule(models, reps) {
  const calls = [];
  for (let rep = 1; rep <= reps; rep++) {
    const offset = (rep - 1) % models.length;
    for (const model of [...models.slice(offset), ...models.slice(0, offset)]) calls.push({ model, rep });
  }
  return calls;
}

/** The ledger only ever over-counts: failures and unpriced results reserve the model's guard amount. */
export function createBudget(maxUSD) {
  let spent = 0;
  return {
    canAfford: guard => spent + guard <= maxUSD + 1e-9,
    charge: amount => { spent += amount; },
    get spent() { return spent; },
  };
}

export function chargeFor(model, result) {
  if (!result) return model.guardUSD;
  if (result.costSource === 'provider' && Number.isFinite(result.costUSD)) return result.costUSD;
  return Math.max(Number.isFinite(result.costUSD) ? result.costUSD : 0, model.guardUSD);
}

/** Existing and injected app models go through BananaBrowser's own provider request methods. */
export function appAdapter(app, keys) {
  const { BananaBrowser, IMAGE_MODELS, usage: { normalizeUsage, estimateUsageCost } } = app;
  return async (model, request) => {
    if (model.spec) {
      IMAGE_MODELS[model.appKey] = model.spec;
      BananaBrowser.PRICING[model.appKey] = model.pricing;
    }
    const spec = IMAGE_MODELS[model.appKey];
    const browser = new BananaBrowser(keys.gemini ?? undefined, keys.openai ?? undefined, model.appKey);
    let rawUsage;
    const track = browser.trackUsage.bind(browser);
    browser.trackUsage = (type, usage) => { rawUsage = usage; return track(type, usage); };
    const log = console.log;
    console.log = () => {};
    try {
      const generation = spec.provider === 'openai'
        ? browser.generateWithOpenAI(request.prompt, request.references)
        : browser.generateWithGemini(request.prompt, request.references);
      // The OpenAI path has its own 180 s abort; the Gemini SDK call has none.
      let timer;
      const dataUrl = await Promise.race([generation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out after 240 s')), 240_000); })])
        .finally(() => clearTimeout(timer));
      const estimate = estimateUsageCost(normalizeUsage(rawUsage, spec.provider), BananaBrowser.PRICING[model.appKey], 'image');
      return { dataUrl, usage: rawUsage ?? null, costUSD: estimate.cost, costSource: estimate.complete ? 'usage-estimate' : 'usage-estimate-incomplete' };
    } finally {
      console.log = log;
    }
  };
}

export function openRouterAdapter(key, fetchImpl = globalThis.fetch) {
  return async (model, request) => {
    const body = { model: model.id, prompt: request.prompt, n: 1, ...model.params };
    if (request.references.length) body.input_references = request.references.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }));
    const response = await fetchImpl('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Banana Browser image bake-off' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`OpenRouter HTTP ${response.status}: non-JSON response`); }
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${data?.error?.message ?? 'request failed'}`);
    const image = data.data?.[0];
    if (!image?.b64_json) throw new Error('OpenRouter returned no image');
    const cost = typeof data.usage?.cost === 'number' ? data.usage.cost : null;
    return { dataUrl: `data:${image.media_type || 'image/png'};base64,${image.b64_json}`, usage: data.usage ?? null, costUSD: cost, costSource: cost === null ? 'unknown' : 'provider' };
  };
}

export async function runBakeoff({ models, reps, maxSpendUSD, runId, keys, adapters, loaded, directory, log = console.log }) {
  const budget = createBudget(maxSpendUSD);
  const results = {
    runId, startedAt: new Date().toISOString(), maxSpendUSD, reps,
    fixture: { capturedAt: loaded.fixture.capturedAt, commit: loaded.fixture.commit, requestSha256: loaded.fixture.requestSha256 },
    models: models.map(({ id, label, route, settings, maxReferences }) => ({ id, label, route, settings, maxReferences })),
    rows: [], status: 'running',
  };
  await mkdir(directory, { recursive: true });
  const save = () => writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  await save();
  for (const { model, rep } of schedule(models, reps)) {
    if (!budget.canAfford(model.guardUSD)) { results.status = 'stopped: budget'; break; }
    const request = loaded.requestFor(model.maxReferences);
    const row = { model: model.id, rep, references: request.references.length, promptChars: request.prompt.length, startedAt: new Date().toISOString() };
    const start = performance.now();
    let result = null;
    try {
      result = await adapters[model.route](model, request);
      row.latencyMs = Math.round(performance.now() - start);
      const match = result.dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) throw new Error('Image was not a base64 data URL');
      row.file = `${model.id.replace(/[^a-z0-9.-]+/gi, '_')}-${rep}.${EXTENSIONS[match[1]] ?? 'bin'}`;
      await writeFile(path.join(directory, row.file), Buffer.from(match[2], 'base64'));
      Object.assign(row, { status: 'ok', mediaType: match[1], costUSD: result.costUSD, costSource: result.costSource, usage: result.usage });
    } catch (error) {
      row.latencyMs ??= Math.round(performance.now() - start);
      row.status = 'failed';
      row.error = sanitize(error?.message ?? error, keys);
    }
    // No retries: a failed call is recorded once and the schedule moves on.
    row.ledgerUSD = chargeFor(model, row.status === 'ok' ? result : null);
    budget.charge(row.ledgerUSD);
    results.rows.push(row);
    results.ledgerUSD = budget.spent;
    await save();
    log(`${row.status.padEnd(6)} ${model.id.padEnd(36)} rep ${rep}  ${(row.latencyMs / 1000).toFixed(1).padStart(6)} s  ` +
      `${row.costUSD == null ? '   cost ?' : `$${row.costUSD.toFixed(4)}`}  ledger $${budget.spent.toFixed(2)}${row.error ? `  ${row.error}` : ''}`);
  }
  if (results.status === 'running') results.status = 'complete';
  results.finishedAt = new Date().toISOString();
  await save();
  return results;
}

async function main() {
  const { values } = parseArgs({ options: {
    run: { type: 'boolean', default: false }, 'max-spend': { type: 'string' }, reps: { type: 'string', default: '3' },
    models: { type: 'string' }, 'run-id': { type: 'string' },
  } });
  const reps = Number(values.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > 20) throw new Error('--reps must be an integer from 1 to 20');
  const selected = values.models ? values.models.split(',').map(id => {
    const model = MODELS.find(candidate => candidate.id === id.trim());
    if (!model) throw new Error(`Unknown model ${id}`);
    return model;
  }) : MODELS;
  const keys = apiKeys();
  const loaded = await loadFixture(FIXTURE_DIR);
  const available = selected.filter(model => keys[model.key]);
  const skipped = selected.filter(model => !keys[model.key]);
  const calls = schedule(available, reps);
  console.log(`Fixture ${loaded.fixture.requestSha256.slice(0, 12)} (${loaded.fixture.capturedAt}), ${loaded.references.length} references`);
  console.log(`Keys present: ${Object.entries(keys).map(([name, key]) => `${name}=${key ? 'yes' : 'no'}`).join(', ')}`);
  for (const model of skipped) console.log(`skip   ${model.id} (no ${model.key} key)`);
  console.log(`${calls.length} calls planned; worst-case ledger $${calls.reduce((sum, call) => sum + call.model.guardUSD, 0).toFixed(2)}`);
  if (!values.run) { console.log('Dry run: no requests sent. Add --run --max-spend <USD> to generate.'); return; }
  const maxSpendUSD = Number(values['max-spend']);
  if (!(maxSpendUSD > 0)) throw new Error('--run requires --max-spend <USD>');
  const runId = values['run-id'] ?? new Date().toISOString().replace(/[:.]/g, '-');
  const directory = path.join(RUNS_DIR, runId);
  if (existsSync(directory)) throw new Error(`Run ${runId} already exists; choose a new --run-id`);
  const app = available.some(model => model.route === 'app') ? await loadApp() : null;
  const adapters = { app: app && appAdapter(app, keys), openrouter: keys.openrouter && openRouterAdapter(keys.openrouter) };
  const results = await runBakeoff({ models: available, reps, maxSpendUSD, runId, keys, adapters, loaded, directory });
  results.skipped = skipped.map(model => ({ id: model.id, reason: `no ${model.key} key` }));
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.status}; ledger $${(results.ledgerUSD ?? 0).toFixed(2)}; ${path.relative(ROOT, directory)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
