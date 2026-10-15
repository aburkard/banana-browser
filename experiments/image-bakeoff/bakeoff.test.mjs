// Offline checks: every provider request is mocked; nothing here spends money.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FIXTURE_DIR, loadApp } from './capture.mjs';
import { composePrompt, expectedText, loadFixture } from './fixture.mjs';
import { MODELS } from './models.mjs';
import { appAdapter, chargeFor, createBudget, openRouterAdapter, runBakeoff, sanitize, schedule } from './run.mjs';
import { buildVocabulary, isKnownWord, normalize, scoreImage, substringDistance, textBlocks } from './scoring.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const line = (text, x, y, w = 400, h = 20) => ({ text, x, y, w, h, confidence: 1 });
const fakeLoaded = {
  fixture: { capturedAt: 'now', commit: 'abc1234', requestSha256: 'f'.repeat(64) },
  references: [],
  requestFor: max => ({ prompt: 'prompt', references: Array.from({ length: Math.min(max, 2) }, (_, i) => ({ dataUrl: `data:image/jpeg;base64,${i}`, description: `ref ${i}` })) }),
};

test('normalization ignores case and punctuation but not spelling', () => {
  assert.equal(normalize("Rams' Alaric Jackson — cut to 1 game!"), 'rams alaric jackson cut to 1 game');
  assert.equal(substringDistance('jackson', 'rams alaric jackson has'), 0);
  assert.equal(substringDistance('jackson', 'rams alaric jakson has'), 1);
  assert.equal(substringDistance('abc', ''), 3);
});

test('wrapped headlines in two columns are matched within their own column', () => {
  const lines = [
    line('Seahawks rule out LB Thomas, RB', 0, 0), line('Rams\' Alaric Jackson has suspension', 600, 0),
    line('Charbonnet for Thursday night', 0, 24), line('cut to 1 game following appeal', 600, 24),
    line('game vs. Broncos', 0, 48),
  ];
  assert.deepEqual(textBlocks(lines), ['Seahawks rule out LB Thomas, RB Charbonnet for Thursday night game vs. Broncos', "Rams' Alaric Jackson has suspension cut to 1 game following appeal"]);
  const expected = [
    { kind: 'headline', text: 'Seahawks rule out LB Thomas, RB Charbonnet for Thursday night game vs. Broncos' },
    { kind: 'headline', text: "Rams' Alaric Jackson has suspension cut to 1 game following appeal" },
    { kind: 'headline', text: 'Four men arrested in connection with Feb. shooting of 49ers\' Keion White' },
  ];
  const score = scoreImage({ lines }, expected, buildVocabulary(expected.map(item => item.text)));
  assert.deepEqual(score.summary.headline, { total: 3, verbatim: 2, truncated: 0, altered: 0, missing: 1 });
});

test('ellipsis cuts are truncations and frame-edge lines are ignored, not misspellings', () => {
  const expected = [
    { kind: 'headline', text: "Four men arrested in connection with Feb. shooting of 49ers' Keion White" },
    { kind: 'headline', text: "Rams' Alaric Jackson has suspension cut to 1 game following appeal" },
  ];
  const ocr = { height: 848, lines: [
    line("Four men arrested in connection with Feb. shooting of 49ers' Kei...", 0, 100, 600),
    line("Rams' Alaric Jackson has suspension cut to 1", 0, 816, 300, 16),
    line('game following appeai', 0, 836, 300, 10), // half-cropped by the bottom edge
  ] };
  const score = scoreImage(ocr, expected, buildVocabulary(expected.map(item => item.text)));
  assert.deepEqual(score.items.map(item => item.status), ['truncated', 'missing']);
  assert.equal(score.nonWords.unknown, 0, 'clipped glyphs are not counted as garbled words');
});

test('misspellings lower similarity and count as non-words', () => {
  const expected = [{ kind: 'headline', text: 'Bills\' Bradley Chubb details his side of altercation with Rams\' Alaric Jackson' }];
  const score = scoreImage({ lines: [line("Bills' Bradly Chubb detials his side of altercaton with Rams' Alaric Jackson", 0, 0, 900)] }, expected, buildVocabulary(expected.map(item => item.text), ['his', 'side', 'with']));
  // One edit each for Bradly and altercaton; the swapped letters in detials cost two.
  assert.equal(score.items[0].distance, 4);
  assert.ok(score.items[0].similarity > 0.9 && score.items[0].similarity < 1);
  assert.equal(score.items[0].status, 'altered');
  assert.deepEqual(score.nonWords.examples.sort(), ['altercaton', 'bradly', 'detials']);
});

test('inflections of dictionary words are not counted as garbled', () => {
  const vocabulary = buildVocabulary([], ['headline', 'score', 'category', 'update', 'rule']);
  assert.deepEqual(['headlines', 'scores', 'categories', 'updated', 'ruling', 'patchers'].filter(word => !isKnownWord(word, vocabulary)), ['patchers']);
});

test('hyphenated line breaks rejoin words', () => {
  const blocks = textBlocks([line('Keion White shoot-', 0, 0), line('ing case', 0, 24)]);
  assert.deepEqual(blocks, ['Keion White shooting case']);
});

test('fixture rebuilds the exact captured prompt and trims references per model', { skip: !existsSync(path.join(FIXTURE_DIR, 'fixture.json')) && 'no captured fixture' }, async () => {
  const loaded = await loadFixture(FIXTURE_DIR);
  assert.equal(loaded.requestFor(loaded.references.length).prompt, loaded.fixture.fullPrompt);
  const one = loaded.requestFor(1);
  assert.equal(one.references.length, 1);
  assert.match(one.prompt, /^# REFERENCE IMAGES\n1 photo\(s\)/);
  assert.equal(loaded.requestFor(0).prompt, loaded.fixture.basePrompt);
  assert.ok(loaded.expected.filter(item => item.kind === 'headline').length >= 5);
});

test('expected text comes from article headlines and descriptions only', () => {
  assert.deepEqual(expectedText({ title: 'NFL News', articles: [{ headline: 'H', description: 'D', published: 'x' }, { headline: 'H2' }] }),
    [{ kind: 'headline', text: 'H' }, { kind: 'description', text: 'D' }, { kind: 'headline', text: 'H2' }]);
  assert.equal(composePrompt('base', []), 'base');
});

test('schedule rotates order; budget never admits a call that could exceed the cap', () => {
  const calls = schedule([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2).map(call => `${call.model.id}${call.rep}`);
  assert.deepEqual(calls, ['a1', 'b1', 'c1', 'b2', 'c2', 'a2']);
  const budget = createBudget(0.2);
  assert.ok(budget.canAfford(0.2));
  budget.charge(0.15);
  assert.ok(!budget.canAfford(0.06));
  assert.equal(chargeFor({ guardUSD: 0.1 }, null), 0.1);
  assert.equal(chargeFor({ guardUSD: 0.1 }, { costSource: 'provider', costUSD: 0.02 }), 0.02);
  assert.equal(chargeFor({ guardUSD: 0.1 }, { costSource: 'usage-estimate', costUSD: 0.03 }), 0.1);
});

test('errors never keep key material', () => {
  const keys = { openai: 'sk-proj-secretvalue123', gemini: 'AIzaSyExampleExampleExample', openrouter: null };
  const message = sanitize('Incorrect API key provided: sk-proj-secretvalue123 and AIzaSyExampleExampleExample and sk-abc*****wxyz', keys);
  assert.ok(!message.includes('secretvalue') && !message.includes('AIza') && !message.includes('sk-abc'));
});

test('run stops before the cap, never retries, and saves sanitized results', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bakeoff-'));
  const models = [
    { id: 'good', route: 'fake', guardUSD: 0.1, maxReferences: 1 },
    { id: 'bad', route: 'fake', guardUSD: 0.1, maxReferences: 5 },
  ];
  const calls = [];
  const adapters = { fake: async (model, request) => {
    calls.push([model.id, request.references.length]);
    if (model.id === 'bad') throw new Error('upstream said sk-proj-secretvalue123 is invalid');
    return { dataUrl: `data:image/png;base64,${PNG}`, costUSD: 0.01, costSource: 'provider', usage: { cost: 0.01 } };
  } };
  const results = await runBakeoff({ models, reps: 3, maxSpendUSD: 0.25, runId: 't', keys: { openai: 'sk-proj-secretvalue123' }, adapters, loaded: fakeLoaded, directory, log: () => {} });
  // good (0.01) + bad (0.10 reserved) + bad (0.10) = 0.21; the next guard would exceed 0.25.
  assert.deepEqual(calls, [['good', 1], ['bad', 2], ['bad', 2]]);
  assert.equal(results.status, 'stopped: budget');
  assert.ok(Math.abs(results.ledgerUSD - 0.21) < 1e-9);
  const saved = await readFile(path.join(directory, 'results.json'), 'utf8');
  assert.ok(!saved.includes('secretvalue'));
  assert.deepEqual((await readdir(directory)).sort(), ['good-1.png', 'results.json']);
});

test('report aggregates successes and lists failures without dropping attempts', async () => {
  const { aggregate, markdownReport } = await import('./score.mjs');
  const score = (verbatim, truncated, altered) => ({ summary: {
    headline: { total: 6, verbatim, truncated, altered, missing: 6 - verbatim - truncated - altered },
    description: { total: 6, verbatim: 3, truncated: 0, altered: 0, missing: 3 },
  }, nonWords: { words: 100, unknown: 2 } });
  const rows = [
    { model: 'm', status: 'ok', latencyMs: 10_000, costUSD: 0.02, costSource: 'provider', width: 1536, height: 1024, score: score(6, 0, 0) },
    { model: 'm', status: 'ok', latencyMs: 30_000, costUSD: 0.04, costSource: 'provider', width: 1536, height: 1024, score: score(4, 1, 0) },
    { model: 'm', status: 'failed', latencyMs: 1_000, error: 'HTTP 500' },
  ];
  const [summary] = aggregate([{ id: 'm', label: 'Model', settings: '1K', maxReferences: 5 }], rows);
  assert.equal(summary.ok, 2);
  assert.equal(summary.attempts, 3);
  assert.equal(summary.medianSeconds, 20);
  assert.ok(Math.abs(summary.meanCostUSD - 0.03) < 1e-12);
  assert.deepEqual(summary.headline, { total: 12, verbatim: 10, truncated: 1, altered: 0, missing: 1 });
  assert.equal(summary.nonWordRate, 0.02);
  const report = markdownReport({ runId: 'r', reps: 3, status: 'complete', ledgerUSD: 0.1, maxSpendUSD: 1, fixture: fakeLoaded.fixture }, [summary], []);
  assert.match(report, /\| Model \| 1K; 5 refs \| 2\/3 \| 20\.0 s \| 30\.0 s \| \$0\.030 \| 10\/12 \(83%\) \| 1 \| 0 \| 1 \| 50% \| 2\.0% \|/);
  assert.match(report, /- Model: HTTP 500/);
});

test('OpenRouter adapter sends references and size controls, and reads provider cost', async () => {
  let sent;
  const adapter = openRouterAdapter('or-key', async (url, init) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ data: [{ b64_json: PNG, media_type: 'image/jpeg' }], usage: { cost: 0.018 } }), { status: 200 });
  });
  const model = MODELS.find(candidate => candidate.id === 'bytedance-seed/seedream-5-0-flash');
  const result = await adapter(model, fakeLoaded.requestFor(5));
  assert.equal(sent.url, 'https://openrouter.ai/api/v1/images');
  assert.equal(sent.headers.Authorization, 'Bearer or-key');
  assert.equal(sent.body.resolution, '1K');
  assert.equal(sent.body.aspect_ratio, '3:2');
  assert.deepEqual(sent.body.input_references.map(item => item.image_url.url), ['data:image/jpeg;base64,0', 'data:image/jpeg;base64,1']);
  assert.equal(result.costUSD, 0.018);
  assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
  const failing = openRouterAdapter('or-key', async () => new Response(JSON.stringify({ error: { message: 'No endpoints' } }), { status: 404 }));
  await assert.rejects(failing(model, fakeLoaded.requestFor(0)), /HTTP 404: No endpoints/);
});

test('injected app models use the production OpenAI and Gemini request code', async t => {
  const app = await loadApp();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://api.openai.com/')) {
      requests.push({ url, form: init.body });
      return new Response(JSON.stringify({ data: [{ b64_json: PNG }], usage: { input_tokens: 100, output_tokens: 200, input_tokens_details: { text_tokens: 60, image_tokens: 40, cached_tokens: 0 }, output_tokens_details: { image_tokens: 200, text_tokens: 0 } } }), { headers: { 'content-type': 'application/json' } });
    }
    requests.push({ url, body: JSON.parse(await new Response(init?.body ?? input.body).text()) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1120, totalTokenCount: 1130 } }), { headers: { 'content-type': 'application/json' } });
  });
  const generate = appAdapter(app, { openai: 'test-openai', gemini: 'test-gemini', openrouter: null });
  const references = [{ dataUrl: `data:image/png;base64,${PNG}`, mimeType: 'image/png', description: 'one' }];

  const flare = await generate(MODELS.find(model => model.id === 'gpt-image-2.5-flare'), { prompt: 'page', references });
  assert.equal(requests[0].url, 'https://api.openai.com/v1/images/edits');
  assert.equal(requests[0].form.get('model'), 'gpt-image-2.5-flare');
  assert.equal(requests[0].form.get('quality'), 'low');
  assert.equal(requests[0].form.get('size'), '1920x1280');
  assert.equal(requests[0].form.getAll('image[]').length, 1);
  assert.ok(Math.abs(flare.costUSD - (60 * 5 + 40 * 8 + 200 * 30) / 1e6) < 1e-12);
  assert.equal(flare.costSource, 'usage-estimate');

  const banana = await generate(MODELS.find(model => model.id === 'gemini-nano-banana-2.1'), { prompt: 'page', references });
  assert.match(requests[1].url, /gemini-nano-banana-2\.1:generateContent/);
  assert.equal(requests[1].body.generationConfig.thinkingConfig.thinkingLevel.toLowerCase(), 'minimal');
  assert.deepEqual(requests[1].body.generationConfig.imageConfig, { aspectRatio: '3:2', imageSize: '1K' });
  assert.equal(requests[1].body.contents[0].parts.length, 2);
  assert.match(banana.dataUrl, /^data:image\/png;base64,/);
});
