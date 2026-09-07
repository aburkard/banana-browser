import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createRedditFeed, handleRedditRequest, parseRedditTarget, FeedError,
  REDDIT_UA, REDDIT_ACCEPT,
} from './reddit-feed.mjs';

const ATOM = '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">'
  + '<title>r/todayilearned</title><entry><id>t3_abc123</id></entry></feed>';
const LISTING = 'https://www.reddit.com/r/todayilearned.json?limit=5';

function atomResponse(xml, { status = 200, contentType = 'application/atom+xml', retryAfter } = {}) {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (retryAfter !== undefined) headers.set('retry-after', String(retryAfter));
  return new Response(xml, { status, headers });
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}

test('derives upstream .rss URLs for listings, sorts, and comments', () => {
  const cases = [
    ['https://www.reddit.com/r/todayilearned.json', 'https://www.reddit.com/r/todayilearned/.rss?limit=25'],
    [LISTING, 'https://www.reddit.com/r/todayilearned/.rss?limit=5'],
    ['https://www.reddit.com/r/todayilearned/hot.json', 'https://www.reddit.com/r/todayilearned/hot/.rss?limit=25'],
    ['https://www.reddit.com/r/todayilearned.json?sort=new', 'https://www.reddit.com/r/todayilearned/new/.rss?limit=25'],
    ['https://www.reddit.com/r/todayilearned/top.json?t=week&limit=10',
      'https://www.reddit.com/r/todayilearned/top/.rss?limit=10&t=week'],
    ['https://www.reddit.com/r/todayilearned.json?limit=100', 'https://www.reddit.com/r/todayilearned/.rss?limit=25'],
    ['https://www.reddit.com/r/todayilearned/comments/abc123/some-title.json',
      'https://www.reddit.com/r/todayilearned/comments/abc123/some-title/.rss?limit=25'],
    ['https://www.reddit.com/r/todayilearned/comments/abc123.json?limit=25',
      'https://www.reddit.com/r/todayilearned/comments/abc123/.rss?limit=25'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(parseRedditTarget(input).upstreamUrl, expected, input);
  }
});

test('rejects off-host, credentialed, private, malformed, and unknown-query targets', () => {
  const bad = [
    'https://www.reddit.com/r/todayilearned/.rss',
    'http://www.reddit.com/r/todayilearned.json',
    'https://old.reddit.com/r/todayilearned.json',
    'https://www.reddit.com.evil.example/r/x.json',
    'https://user:pass@www.reddit.com/r/todayilearned.json',
    'https://www.reddit.com:8443/r/todayilearned.json',
    'https://www.reddit.com/user/someone.json',
    'https://www.reddit.com/r/todayilearned/about.json',
    'https://www.reddit.com/api/info.json',
    'https://www.reddit.com/r/a.json',
    'https://www.reddit.com/r/todayilearned.json?jsonp=cb',
    'https://www.reddit.com/r/todayilearned.json?LIMIT=5',
    'https://www.reddit.com/r/todayilearned.json?limit=abc',
    'https://www.reddit.com/r/todayilearned.json?limit=5&limit=6',
    'https://www.reddit.com/r/todayilearned.json?sort=best',
    'https://www.reddit.com/r/todayilearned.json?t=week',
    'https://www.reddit.com/r/todayilearned/new.json?sort=hot',
    'https://www.reddit.com/r/todayilearned/comments/abc123/t.json?sort=top',
    'https://www.reddit.com/r/todayilearned/comments/abc123/a/b.json',
    'https://www.reddit.com/r/a/../b.json',
    'https://www.reddit.com/r%2fx.json',
    'https://www.reddit.com/r/todayilearned.json?limit=5&after=t3_x',
    '/r/todayilearned.json',
    'not a url',
  ];
  for (const url of bad) {
    assert.throws(() => parseRedditTarget(url), error => error instanceof FeedError && error.status === 400, url);
  }
});

test('upstream fetch uses only descriptive UA and Atom Accept with redirect error', async () => {
  let seen;
  const fetchImpl = fakeFetch(async (url, init) => {
    seen = { url: String(url), init };
    return atomResponse(ATOM);
  });
  const feed = createRedditFeed({ fetchImpl, now: clock().now });
  const result = await feed.serve(LISTING);
  assert.equal(seen.url, 'https://www.reddit.com/r/todayilearned/.rss?limit=5');
  assert.equal(seen.init.method, 'GET');
  assert.deepEqual({ ...seen.init.headers }, { 'User-Agent': REDDIT_UA, Accept: REDDIT_ACCEPT });
  assert.equal(seen.init.redirect, 'error');
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.equal(result.status, 200);
  assert.equal(result.bytes.toString(), ATOM);
  assert.equal(result.contentType, 'application/atom+xml');
});

test('caches fresh responses per URL and refetches after TTL', async () => {
  const c = clock();
  const stats = {};
  const fetchImpl = fakeFetch(async () => atomResponse(ATOM));
  const feed = createRedditFeed({ fetchImpl, now: c.now, stats });
  const first = await feed.serve(LISTING);
  const second = await feed.serve(LISTING);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(second.cached, true);
  assert.deepEqual(second.bytes, first.bytes);
  assert.equal(stats.redditUpstream, 1);
  assert.equal(stats.redditCacheHits, 1);
  c.advance(61_000);
  await feed.serve(LISTING);
  assert.equal(fetchImpl.calls.length, 2);
});

test('dedups concurrent identical requests into one upstream fetch', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchImpl = fakeFetch(async () => {
    await gate;
    return atomResponse(ATOM);
  });
  const feed = createRedditFeed({ fetchImpl, now: clock().now });
  const pendingA = feed.serve(LISTING);
  const pendingB = feed.serve(LISTING);
  release();
  const [a, b] = await Promise.all([pendingA, pendingB]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(a.bytes, b.bytes);
});

test('bounds in-flight upstream requests and starts per minute', async () => {
  const c = clock();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetchImpl = fakeFetch(async () => {
    await gate;
    return atomResponse(ATOM);
  });
  const feed = createRedditFeed({ fetchImpl, now: c.now });
  const first = feed.serve('https://www.reddit.com/r/sub1.json');
  const second = feed.serve('https://www.reddit.com/r/sub2.json');
  await assert.rejects(feed.serve('https://www.reddit.com/r/sub3.json'),
    error => error instanceof FeedError && error.status === 503);
  release();
  await Promise.all([first, second]);
  assert.equal(fetchImpl.calls.length, 2);

  const c2 = clock();
  const fetchImpl2 = fakeFetch(async () => atomResponse(ATOM));
  const feed2 = createRedditFeed({ fetchImpl: fetchImpl2, now: c2.now });
  for (let n = 0; n < 6; n++) await feed2.serve(`https://www.reddit.com/r/sub${n}.json`);
  await assert.rejects(feed2.serve('https://www.reddit.com/r/sub6.json'),
    error => error instanceof FeedError && error.status === 503);
  c2.advance(61_000);
  await feed2.serve('https://www.reddit.com/r/sub6.json');
  assert.equal(fetchImpl2.calls.length, 7);
});

test('applies upstream 429 as a bounded global cooldown but keeps serving fresh cache', async () => {
  const c = clock();
  const fetchImpl = fakeFetch(async url => {
    if (String(url).includes('/r/todayilearned/')) return atomResponse('limited', { status: 429, retryAfter: '120' });
    return atomResponse(ATOM);
  });
  const feed = createRedditFeed({ fetchImpl, now: c.now });
  await feed.serve('https://www.reddit.com/r/cached.json');
  const limited = await feed.serve(LISTING).then(() => null, error => error);
  assert.ok(limited instanceof FeedError && limited.status === 429);
  assert.equal(limited.retryAfter, 120);
  const callsBefore = fetchImpl.calls.length;
  const hit = await feed.serve('https://www.reddit.com/r/cached.json');
  assert.equal(hit.cached, true);
  assert.equal(fetchImpl.calls.length, callsBefore);
  const cooled = await feed.serve('https://www.reddit.com/r/other.json').then(() => null, error => error);
  assert.ok(cooled instanceof FeedError && cooled.status === 429);
  assert.equal(cooled.retryAfter, 120);
  assert.equal(fetchImpl.calls.length, callsBefore);
  c.advance(121_000);
  await feed.serve('https://www.reddit.com/r/other.json');
  assert.equal(fetchImpl.calls.length, callsBefore + 1);
});

test('bounds Retry-After with default 60 s and max 300 s', async () => {
  for (const [header, expected] of [[undefined, 60], ['nonsense', 60], ['0', 1], ['9999', 300]]) {
    const fetchImpl = fakeFetch(async () => atomResponse('limited', { status: 429, retryAfter: header }));
    const feed = createRedditFeed({ fetchImpl, now: clock().now });
    const error = await feed.serve(LISTING).then(() => null, e => e);
    assert.equal(error.retryAfter, expected, `Retry-After: ${header}`);
  }
});

test('treats HTML 200 and oversized bodies as errors without caching', async () => {
  const htmlFetch = fakeFetch(async () => atomResponse('<html>login</html>', { contentType: 'text/html; charset=utf-8' }));
  const htmlFeed = createRedditFeed({ fetchImpl: htmlFetch, now: clock().now });
  await assert.rejects(htmlFeed.serve(LISTING), error => error instanceof FeedError && error.status === 502);
  await assert.rejects(htmlFeed.serve(LISTING), error => error instanceof FeedError && error.status === 502);
  assert.equal(htmlFetch.calls.length, 2);

  const bigFetch = fakeFetch(async () => atomResponse('x'.repeat(100)));
  const bigFeed = createRedditFeed({ fetchImpl: bigFetch, now: clock().now, upstreamMaxBytes: 10 });
  await assert.rejects(bigFeed.serve(LISTING), error => error instanceof FeedError && error.status === 502);
});

function mockReq({ method = 'GET', url = `/reddit?url=${encodeURIComponent(LISTING)}`, origin = 'https://banana.example', cookie = true } = {}) {
  return { method, url, headers: { ...(origin === null ? {} : { origin }), ...(cookie ? { cookie: 'session=abc' } : {}) } };
}

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: null,
    bodyChunks: [],
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    writeHead(status) { this.statusCode = status; },
    end(chunk) {
      if (chunk !== undefined) this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      this.body = Buffer.concat(this.bodyChunks).toString();
    },
  };
}

test('HTTP layer requires known origin and GET, and never forwards cookies', async () => {
  const fetchImpl = fakeFetch(async () => atomResponse(ATOM));
  const feed = createRedditFeed({ fetchImpl, now: clock().now });
  const origins = new Set(['https://banana.example']);

  const ok = mockRes();
  await handleRedditRequest(mockReq(), ok, feed, origins);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/atom+xml');
  assert.equal(ok.body, ATOM);
  assert.equal(ok.headers['access-control-allow-origin'], 'https://banana.example');
  assert.deepEqual({ ...fetchImpl.calls[0].init.headers }, { 'User-Agent': REDDIT_UA, Accept: REDDIT_ACCEPT });

  for (const origin of [null, 'https://evil.example']) {
    const before = fetchImpl.calls.length;
    const denied = mockRes();
    await handleRedditRequest(mockReq({ origin }), denied, feed, origins);
    assert.equal(denied.statusCode, 403, `origin: ${origin}`);
    assert.equal(fetchImpl.calls.length, before);
  }

  for (const method of ['POST', 'HEAD', 'DELETE']) {
    const rejected = mockRes();
    await handleRedditRequest(mockReq({ method }), rejected, feed, origins);
    assert.equal(rejected.statusCode, 405, method);
  }

  const missing = mockRes();
  await handleRedditRequest(mockReq({ url: '/reddit' }), missing, feed, origins);
  assert.equal(missing.statusCode, 400);

  const invalid = mockRes();
  await handleRedditRequest(mockReq({ url: '/reddit?url=https://evil.example/x.json' }), invalid, feed, origins);
  assert.equal(invalid.statusCode, 400);
});

test('HTTP layer surfaces upstream 429 with Retry-After', async () => {
  const fetchImpl = fakeFetch(async () => atomResponse('limited', { status: 429, retryAfter: '45' }));
  const feed = createRedditFeed({ fetchImpl, now: clock().now });
  const res = mockRes();
  await handleRedditRequest(mockReq(), res, feed, new Set(['https://banana.example']));
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '45');
  assert.deepEqual(JSON.parse(res.body), { error: 'Reddit is rate limiting requests.', retryAfter: 45 });
});

test('relay serves /reddit alongside the encrypted tunnel', async t => {
  let createRelay;
  try {
    ({ createRelay } = await import('./relay.mjs'));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return t.skip('relay dependency (ws) not installed');
    throw error;
  }
  const origin = 'https://banana.example';
  const fetchImpl = fakeFetch(async () => atomResponse(ATOM));
  const relay = createRelay({ origins: [origin], redditFetch: fetchImpl });
  relay.server.listen(0, '127.0.0.1');
  try {
    await once(relay.server, 'listening');
  } catch (error) {
    await relay.close().catch(() => {});
    if (error?.code === 'EPERM' || error?.code === 'EACCES') return t.skip('TCP listen not permitted in this sandbox');
    throw error;
  }
  t.after(() => relay.close());
  const base = `http://127.0.0.1:${relay.server.address().port}`;
  const target = encodeURIComponent(LISTING);
  const ok = await fetch(`${base}/reddit?url=${target}`, { headers: { Origin: origin, Cookie: 'session=abc' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/atom+xml');
  assert.equal(await ok.text(), ATOM);
  assert.equal(ok.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual({ ...fetchImpl.calls[0].init.headers }, { 'User-Agent': REDDIT_UA, Accept: REDDIT_ACCEPT });
  const before = fetchImpl.calls.length;
  const denied = await fetch(`${base}/reddit?url=${target}`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(denied.status, 403);
  assert.equal(fetchImpl.calls.length, before);
  const exposed = await fetch(`${base}/source/reddit-feed.mjs`);
  assert.equal(exposed.status, 200);
  assert.match(await exposed.text(), /createRedditFeed/);
});

test('comment slugs decode once and reject encoded controls', () => {
  assert.equal(parseRedditTarget('https://www.reddit.com/r/test/comments/abc/caf%C3%A9/.json').upstreamUrl, 'https://www.reddit.com/r/test/comments/abc/caf%C3%A9/.rss?limit=25');
  assert.throws(() => parseRedditTarget('https://www.reddit.com/r/test/comments/abc/hello%0Aworld/.json'));
});
