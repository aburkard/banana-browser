import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebScraper, handleWebRequest, parseWebTarget } from './web-scrape.mjs';

const data = { markdown: '# Hello', links: ['https://example.com/a'], images: [], metadata: { statusCode: 200, creditsUsed: 1, sourceURL: 'https://example.com/' } };
const response = (value = data, options) => new Response(JSON.stringify({ success: true, data: value }), options);

test('validates public targets before provider access and normalizes fragment only', async () => {
  assert.equal(parseWebTarget('https://example.com/a?q=1#frag'), 'https://example.com/a?q=1');
  assert.equal(parseWebTarget('http://example.com:80/a'), 'http://example.com/a');
  for (const target of ['file:///tmp/a', 'ftp://example.com', 'http://localhost', 'http://localhost.',
    'http://127.0.0.1', 'http://2130706433', 'http://0x7f000001', 'http://10.0.0.1', 'http://[::1]',
    'http://[::ffff:127.0.0.1]', 'http://169.254.169.254', 'https://a.internal/', 'https://a.local/',
    'https://example.com:8080/', 'https://user:pass@example.com/', 'https://a\\b.com', '', null]) {
    assert.throws(() => parseWebTarget(target), { status: 400 }, String(target));
  }
  let calls = 0;
  const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async () => { calls++; return response(); } });
  await assert.rejects(scrape('http://127.0.0.1'), { status: 400 });
  assert.equal(calls, 0);
});

test('fixed bounded Firecrawl request, cache and reported credits', async () => {
  let calls = 0;
  let time = 0;
  const scrape = createWebScraper({ apiKey: 'mock-key', now: () => time, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.firecrawl.dev/v2/scrape');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Authorization: 'Bearer mock-key', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), { url: 'https://example.com/?q=hello', formats: ['markdown', 'links', 'images'],
      onlyMainContent: false, timeout: 30000, maxAge: 3600000, parsers: [], proxy: 'basic' });
    return response();
  } });
  assert.deepEqual(await scrape('https://example.com/?q=hello#one'), { data, usage: { credits: 1, cached: false } });
  const cached = await scrape('https://example.com/?q=hello#two');
  assert.deepEqual(cached.usage, { credits: 0, cached: true });
  cached.data.markdown = 'mutated';
  assert.equal((await scrape('https://example.com/?q=hello')).data.markdown, '# Hello');
  assert.equal(calls, 1);
  time = 600_000;
  await scrape('https://example.com/?q=hello');
  assert.equal(calls, 2);
});

test('deduplicates concurrent URLs and bounds concurrency', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async () => { calls++; await gate; return response(); } });
  const first = scrape('https://example.com/1');
  const duplicate = scrape('https://example.com/1');
  const second = scrape('https://example.com/2');
  await assert.rejects(scrape('https://example.com/3'), { status: 503 });
  assert.equal(calls, 2);
  release();
  assert.deepEqual((await duplicate).usage, { credits: 0, cached: true });
  await Promise.all([first, second]);
});

test('start rate, lifetime and cache entry limits', async () => {
  let time = 0;
  let calls = 0;
  const scrape = createWebScraper({ apiKey: 'mock-key', now: () => time, fetchImpl: async () => { calls++; return response(); } });
  for (let i = 0; i < 10; i++) await scrape(`https://example.com/${i}`);
  await assert.rejects(scrape('https://example.com/rate'), { status: 503 });
  assert.equal((await scrape('https://example.com/0')).usage.cached, true);
  time += 60001;
  for (let i = 10; i < 100; i++) { time += 6001; await scrape(`https://example.com/${i}`); }
  assert.equal(calls, 100);
  await assert.rejects(scrape('https://example.com/101'), /budget is exhausted/);
  assert.equal((await scrape('https://example.com/99')).usage.cached, true);
  await assert.rejects(scrape('https://example.com/0'), /budget is exhausted/);
});

test('missing key, provider errors, status errors and body bounds are sanitized and not cached', async () => {
  await assert.rejects(createWebScraper()('https://example.com/'), { status: 503 });
  for (const mock of [
    () => response({ ...data, metadata: { statusCode: 404, creditsUsed: 2 } }),
    () => new Response(JSON.stringify({ success: false, data: { metadata: { creditsUsed: 2 } }, error: 'secret' }), { status: 429 }),
    () => new Response('secret'),
    () => new Response('x'.repeat(2 * 1024 * 1024 + 1)),
    () => { throw new Error('secret'); },
  ]) {
    let calls = 0;
    const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async () => { calls++; return mock(); } });
    for (let i = 0; i < 2; i++) await assert.rejects(scrape('https://example.com/'), error => {
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
    assert.equal(calls, 2);
  }
  for (const creditsUsed of [undefined, '1', -1, null]) {
    const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async () => response({ metadata: { creditsUsed } }) });
    assert.equal((await scrape('https://example.com/')).usage.credits, null);
  }
});

test('HTTP origin, method, URL validation, no cookie forwarding, usage on failure', async () => {
  const allowed = new Set(['https://banana.example']);
  const run = async (req, scrape) => {
    const headers = {};
    let status, body;
    await handleWebRequest(req, { setHeader: (key, value) => { headers[key] = value; },
      writeHead: code => { status = code; }, end: value => { body = JSON.parse(value); } }, scrape, allowed);
    return { headers, status, body };
  };
  const req = { method: 'GET', url: '/web?url=https%3A%2F%2Fexample.com', headers: { origin: 'https://banana.example', cookie: 'secret' } };
  const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.cookie, undefined);
    return response({ ...data, metadata: { statusCode: 403, creditsUsed: 2 } });
  } });
  const result = await run(req, scrape);
  assert.equal(result.status, 502);
  assert.deepEqual(result.body.usage, { credits: 2, cached: false });
  assert.equal(result.body.data, null);
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://banana.example');
  const forbidden = () => { throw new Error('must not call'); };
  assert.equal((await run({ ...req, headers: {} }, forbidden)).status, 403);
  assert.equal((await run({ ...req, headers: { origin: 'https://evil.example' } }, forbidden)).status, 403);
  assert.equal((await run({ ...req, method: 'POST' }, forbidden)).status, 405);
  assert.equal((await run({ ...req, url: '/web?url=a&url=b' }, forbidden)).status, 400);
  assert.equal((await run({ ...req, url: '/web?url=a&headers=secret' }, forbidden)).status, 400);
});

test('cache evicts at byte bound independently of entry bound', async () => {
  let calls = 0;
  const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async () => {
    calls++;
    return response({ ...data, markdown: 'x'.repeat(1_900_000) });
  } });
  for (let i = 0; i < 6; i++) await scrape(`https://example.com/${i}`);
  assert.equal((await scrape('https://example.com/5')).usage.cached, true);
  assert.equal((await scrape('https://example.com/0')).usage.cached, false);
  assert.equal(calls, 7);
});

test('35 second timeout bounds headers and body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start() {} }));
  } });
  const job = scrape('https://example.com/');
  const rejected = assert.rejects(job, { status: 504 });
  await Promise.resolve();
  t.mock.timers.tick(35_000);
  await rejected;
  assert.equal(signal.aborted, true);
});

test('failures before a provider start report zero credits', async () => {
  const zeroCredits = error => { assert.equal(error.usage.credits, 0); return true; };
  await assert.rejects(createWebScraper()('http://localhost/'), zeroCredits);
  await assert.rejects(createWebScraper()('https://example.com/'), zeroCredits);
  let time = 0;
  const scrape = createWebScraper({ apiKey: 'mock-key', now: () => time, fetchImpl: async () => response() });
  for (let i = 0; i < 100; i++) {
    if (i === 10) await assert.rejects(scrape('https://example.com/rate'), zeroCredits);
    if (i && i % 10 === 0) time += 60_001;
    await scrape(`https://example.com/${i}`);
  }
  await assert.rejects(scrape('https://example.com/lifetime'), zeroCredits);
  for (const req of [
    { method: 'GET', headers: {}, url: '/web?url=a' },
    { method: 'POST', headers: { origin: 'https://banana.example' }, url: '/web?url=a' },
    { method: 'GET', headers: { origin: 'https://banana.example' }, url: '/web?url=a&url=b' },
  ]) {
    let body;
    await handleWebRequest(req, { setHeader() {}, writeHead() {}, end(value) { body = JSON.parse(value); } },
      () => { throw new Error('must not call'); }, new Set(['https://banana.example']));
    assert.equal(body.usage.credits, 0);
  }
});

test('failed dedup followers report zero credits while leader retains actual or unknown usage', async () => {
  for (const upstreamCredits of [2, null]) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const scrape = createWebScraper({ apiKey: 'mock-key', fetchImpl: async () => {
      await gate;
      if (upstreamCredits === null) throw new Error('network failure');
      return response({ metadata: { statusCode: 403, creditsUsed: upstreamCredits } });
    } });
    const leader = scrape('https://example.com/failure');
    const follower = scrape('https://example.com/failure');
    const results = Promise.allSettled([leader, follower]);
    release();
    const [first, second] = await results;
    assert.equal(first.status, 'rejected');
    assert.equal(second.status, 'rejected');
    assert.equal(first.reason.usage.credits, upstreamCredits);
    assert.equal(second.reason.usage.credits, 0);
    assert.equal(first.reason.status, second.reason.status);
  }
});
