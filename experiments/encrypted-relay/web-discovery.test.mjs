import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebDiscovery, handleDiscoveryRequest } from './web-discovery.mjs';

const row = { url: 'https://example.com/', title: 'Example', description: 'Description' };
const response = (value = { success: true, data: { web: [row] }, creditsUsed: 2 }, status = 200) => new Response(JSON.stringify(value), { status });
const zero = error => { assert.equal(error.usage.credits, 0); return true; };

test('validates kind, search and map before a provider request', async () => {
  let calls = 0;
  const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async () => { calls++; return response(); } });
  for (const input of ['', '   ', '\nquery', 'a\t', 'a\0b', '\u0085', 'a'.repeat(301), null, {}]) {
    await assert.rejects(discover('search', input), zero);
  }
  for (const input of ['http://localhost', 'http://127.0.0.1', 'http://2130706433', 'http://[::1]',
    'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com:1234', 'https://a.internal']) {
    await assert.rejects(discover('map', input), zero);
  }
  await assert.rejects(discover('scrape', 'query'), zero);
  await assert.rejects(createWebDiscovery()('search', 'query'), zero);
  assert.equal(calls, 0);
});

test('fixed search/map calls, response shapes and credit metadata', async () => {
  for (const kind of ['search', 'map']) {
    let calls = 0;
    const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, `https://api.firecrawl.dev/v2/${kind}`);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { Authorization: 'Bearer mock-key', 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(options.body), kind === 'search' ?
        { query: 'hello', limit: 10, sources: ['web'], timeout: 20000 } :
        { url: 'https://example.com/', limit: 25, includeSubdomains: false, timeout: 20000 });
      return response(kind === 'search' ? { success: true, data: { web: [row] }, creditsUsed: 2 } :
        { success: true, links: [row], metadata: { creditsUsed: 1 } });
    } });
    const result = await discover(kind, kind === 'search' ? '  hello  ' : 'https://example.com/#fragment');
    assert.deepEqual(result.data, kind === 'search' ? { web: [row] } : { links: [row] });
    assert.deepEqual(result.usage, { credits: kind === 'search' ? 2 : 1, cached: false });
    assert.equal(calls, 1);
  }
  const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async () => response({ success: true, data: [row] }) });
  assert.deepEqual(await discover('search', 'legacy'), { data: { web: [row] }, usage: { credits: null, cached: false } });
});

test('filters unsafe results, strips unrequested content, caps returned rows', async () => {
  const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async () => response({ success: true, data: {
    web: [{ url: 'javascript:alert(1)' }, ...Array.from({ length: 20 }, () => ({ ...row, markdown: 'unrequested' }))],
  } }) });
  const result = await discover('search', 'safe');
  assert.equal(result.data.web.length, 9);
  assert.deepEqual(result.data.web[0], row);
});

test('cache normalization, independent objects, TTL, entry eviction and byte eviction', async () => {
  let time = 0;
  let calls = 0;
  const discover = createWebDiscovery({ apiKey: 'mock-key', now: () => time, fetchImpl: async () => { calls++; return response(); } });
  await discover('search', 'hello');
  const cached = await discover('search', ' hello ');
  assert.deepEqual(cached.usage, { credits: 0, cached: true });
  cached.data.web[0].title = 'mutated';
  assert.equal((await discover('search', 'hello')).data.web[0].title, 'Example');
  time = 600000;
  assert.equal((await discover('search', 'hello')).usage.cached, false);
  assert.equal(calls, 2);
  for (let i = 0; i < 20; i++) { time += 6001; await discover('search', `new ${i}`); }
  time += 6001;
  assert.equal((await discover('search', 'hello')).usage.cached, false);
  const large = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async () => response({ success: true,
    data: { web: [{ ...row, description: 'x'.repeat(950000) }] } }) });
  for (let i = 0; i < 6; i++) await large('search', `${i}`);
  assert.equal((await large('search', '5')).usage.cached, true);
  assert.equal((await large('search', '0')).usage.cached, false);
});

test('dedup, concurrency, rate and lifetime ceilings are shared across kinds', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async url => {
    calls++; await gate; return url.endsWith('/map') ? response({ success: true, links: [row] }) : response();
  } });
  const first = discover('search', 'one');
  const follower = discover('search', 'one');
  const second = discover('map', 'https://example.com/');
  await assert.rejects(discover('search', 'three'), zero);
  assert.equal(calls, 2);
  release();
  assert.deepEqual((await follower).usage, { credits: 0, cached: true });
  await Promise.all([first, second]);
  let time = 0;
  const limited = createWebDiscovery({ apiKey: 'mock-key', now: () => time, fetchImpl: async () => response() });
  for (let i = 0; i < 50; i++) {
    if (i === 10) await assert.rejects(limited('search', 'rate'), zero);
    if (i && i % 10 === 0) time += 60000;
    await limited('search', `${i}`);
  }
  await assert.rejects(limited('search', 'lifetime'), /budget is exhausted/);
  assert.equal((await limited('search', '49')).usage.cached, true);
});

test('failed provider usage is actual or unknown, errors sanitized and not cached', async () => {
  for (const [mock, credits] of [
    [() => response({ success: false, error: 'secret-key', metadata: { creditsUsed: 3 } }, 429), 3],
    [() => response({ success: false, creditsUsed: 2 }, 500), 2],
    [() => response({ success: true, data: {}, creditsUsed: 1 }), 1],
    [() => new Response('secret-key'), null],
    [() => new Response('x'.repeat(1024 * 1024 + 1)), null],
    [() => { throw new Error('secret-key'); }, null],
  ]) {
    let calls = 0;
    const discover = createWebDiscovery({ apiKey: 'secret-key', fetchImpl: async () => { calls++; return mock(); } });
    for (let i = 0; i < 2; i++) await assert.rejects(discover('search', 'failure'), error => {
      assert.equal(error.status, 502);
      assert.equal(error.usage.credits, credits);
      assert.ok(!error.message.includes('secret-key'));
      return true;
    });
    assert.equal(calls, 2);
  }
  for (const creditsUsed of [undefined, null, '2', -1]) {
    const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async () => response({ success: true, data: { web: [] }, creditsUsed }) });
    assert.equal((await discover('search', 'unknown')).usage.credits, null);
  }
});

test('failed dedup followers have zero usage', async () => {
  for (const creditsUsed of [2, null]) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async () => {
      await gate; return response({ success: false, creditsUsed }, 500);
    } });
    const results = Promise.allSettled([discover('search', 'failure'), discover('search', 'failure')]);
    release();
    const [leader, follower] = await results;
    assert.equal(leader.reason.usage.credits, creditsUsed);
    assert.equal(follower.reason.usage.credits, 0);
  }
});

test('20-second timeout bounds both response headers and body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const body of [false, true]) {
    let signal;
    const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async (_url, options) => {
      signal = options.signal;
      return body ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {});
    } });
    const rejected = assert.rejects(discover('search', 'timeout'), { status: 504, usage: { credits: null, cached: false } });
    await Promise.resolve();
    t.mock.timers.tick(20000);
    await rejected;
    assert.equal(signal.aborted, true);
  }
});

test('HTTP strict origin, GET and exact query shape; no cookie forwarding', async () => {
  const allowed = new Set(['https://banana.example']);
  const run = async (req, discover) => {
    const headers = {};
    let status, body;
    await handleDiscoveryRequest(req, { setHeader(key, value) { headers[key] = value; },
      writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } }, discover, allowed);
    return { headers, status, body };
  };
  const req = { method: 'GET', url: '/search?q=hello', headers: { origin: 'https://banana.example', cookie: 'private' } };
  const forbidden = () => { assert.fail('must not call'); };
  for (const [changes, status] of [
    [{ headers: {} }, 403], [{ headers: { origin: 'null' } }, 403],
    [{ headers: { origin: 'https://evil.example' } }, 403], [{ method: 'POST' }, 405],
    [{ url: '/search?q=a&q=b' }, 400], [{ url: '/search?q=a&limit=100' }, 400],
    [{ url: '/search?query=a' }, 400], [{ url: '/search?q=%0Ahello' }, 400],
    [{ url: '/map?url=https://example.com&scrape=true' }, 400], [{ url: '/map?url=http://localhost' }, 400],
    [{ url: '/other?q=hello' }, 400],
  ]) {
    const result = await run({ ...req, ...changes }, forbidden);
    assert.equal(result.status, status);
    assert.equal(result.body.usage.credits, 0);
  }
  const discover = createWebDiscovery({ apiKey: 'mock-key', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.cookie, undefined);
    return response();
  } });
  const result = await run(req, discover);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Access-Control-Allow-Origin'], 'https://banana.example');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  const failed = await run(req, () => { throw new Error('secret-key'); });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.usage.credits, null);
  assert.ok(!JSON.stringify(failed).includes('secret-key'));
});
