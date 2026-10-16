import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import zlib from 'node:zlib';
import {
  createPageReader, createSafeLookup, handlePageRequest, isPublicAddress, parsePageTarget, PageError, PAGE_UA,
} from './page-reader.mjs';
import { createRelay } from './relay.mjs';

// Offline only: a local server stands in for websites and a fake resolver maps
// test hostnames. 127.0.0.1 is allowed solely through the injected address check.
const DNS = {
  'site.test': ['127.0.0.1'],
  'private.test': ['10.0.0.5'],
  'mixed.test': ['93.184.216.34', '169.254.169.254'],
};
const resolve = async host => (DNS[host] || []).map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
const allowLoopback = address => address === '127.0.0.1' || isPublicAddress(address);

async function site(t, handler) {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req); handler(req, res); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const port = server.address().port;
  return { seen, url: (host, path = '/') => `http://${host}:${port}${path}` };
}
const reader = (options = {}) => createPageReader({ resolve, isAllowedAddress: allowLoopback, allowPorts: true, ...options });
const html = (res, body, type = 'text/html; charset=utf-8', headers = {}) => { res.writeHead(200, { 'content-type': type, ...headers }); res.end(body); };

test('only public unicast addresses pass', () => {
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(isPublicAddress(address), true, address);
  for (const address of ['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'not-an-ip']) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('targets must be public http(s) URLs on default ports', () => {
  assert.equal(parsePageTarget('https://example.com/a?b=1#frag').href, 'https://example.com/a?b=1');
  assert.equal(parsePageTarget('http://example.com:80/').href, 'http://example.com/');
  for (const bad of ['', 'ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com/',
    'https://example.com:8443/', 'http://localhost/', 'http://printer.local/', 'http://metadata.google.internal/', 'http://intranet/',
    'http://169.254.169.254/latest/meta-data/', 'http://2130706433/', 'http://0x7f.1/', 'http://[::1]/', 'http://10.0.0.1/',
    `https://example.com/${'a'.repeat(2100)}`]) {
    assert.throws(() => parsePageTarget(bad), error => error instanceof PageError && error.status === 400, bad);
  }
});

test('lookup refuses any non-public DNS answer and pins checked addresses', async () => {
  const lookup = createSafeLookup({ resolve });
  const call = (host, options) => new Promise(done => lookup(host, options, (error, ...rest) => done({ error, rest })));
  assert.equal((await call('private.test', {})).error.code, 'BANANA_NON_PUBLIC');
  assert.equal((await call('mixed.test', { all: true })).error.code, 'BANANA_NON_PUBLIC');
  assert.equal((await call('missing.test', {})).error.code, 'BANANA_NON_PUBLIC');
  const pinned = createSafeLookup({ resolve: async () => [{ address: '93.184.216.34', family: 4 }] });
  const one = await new Promise(done => pinned('example.com', {}, (...args) => done(args)));
  assert.deepEqual(one, [null, '93.184.216.34', 4]);
  const all = await new Promise(done => pinned('example.com', { all: true }, (...args) => done(args)));
  assert.deepEqual(all, [null, [{ address: '93.184.216.34', family: 4 }]]);
});

test('reads HTML with final URL, decompression and declared charsets; forwards no caller data', async t => {
  const server = await site(t, (req, res) => {
    if (req.url === '/gzip') return html(res, zlib.gzipSync('<h1>Compressed ✓</h1>'), 'text/html', { 'content-encoding': 'gzip' });
    if (req.url === '/latin') return html(res, Buffer.concat([Buffer.from('<meta charset="windows-1252"><p>'), Buffer.from([0x93, 0x48, 0x69, 0x94]), Buffer.from('</p>')]), 'text/html');
    if (req.url === '/moved') { res.writeHead(301, { location: '/final' }); return res.end(); }
    html(res, '<title>Final</title><p>Héllo</p>');
  });
  const pages = reader();
  const moved = await pages.serve(server.url('site.test', '/moved'));
  assert.equal(moved.url, server.url('site.test', '/final'));
  assert.match(moved.html, /Héllo/);
  assert.match((await pages.serve(server.url('site.test', '/gzip'))).html, /Compressed ✓/);
  assert.match((await pages.serve(server.url('site.test', '/latin'))).html, /“Hi”/);
  const request = server.seen[0];
  assert.equal(request.headers['user-agent'], PAGE_UA);
  assert.equal(request.headers.cookie, undefined);
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.method, 'GET');
});

test('redirects are revalidated, bounded and never followed to private hosts', async t => {
  const server = await site(t, (req, res) => {
    if (req.url === '/to-private') { res.writeHead(302, { location: server.url('private.test') }); return res.end(); }
    if (req.url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest/' }); return res.end(); }
    if (req.url.startsWith('/loop')) { res.writeHead(302, { location: `/loop${req.url.length}` }); return res.end(); }
    html(res, 'ok');
  });
  const pages = reader();
  await assert.rejects(pages.serve(server.url('site.test', '/to-private')), { status: 400, message: 'This address is not public.' });
  await assert.rejects(pages.serve(server.url('site.test', '/to-metadata')), { status: 400 });
  await assert.rejects(pages.serve(server.url('site.test', '/loop')), { status: 502, message: 'The site redirected too many times.' });
  await assert.rejects(pages.serve(server.url('private.test')), { status: 400 });
});

test('non-HTML, error statuses, oversized and slow pages fail or truncate safely', async t => {
  const server = await site(t, (req, res) => {
    if (req.url === '/json') return html(res, '{"secret":"upstream"}', 'application/json');
    if (req.url === '/missing') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<p>upstream detail</p>'); }
    if (req.url === '/big') return html(res, '<p>' + 'x'.repeat(5000) + '</p>');
    if (req.url === '/slow') return; // never responds
    html(res, 'ok');
  });
  const pages = reader({ maxBytes: 1000, timeoutMs: 300 });
  await assert.rejects(pages.serve(server.url('site.test', '/json')), { status: 415 });
  await assert.rejects(pages.serve(server.url('site.test', '/missing')), error => error.status === 502 && error.message === 'The site returned HTTP 404.' && !error.message.includes('upstream'));
  const big = await pages.serve(server.url('site.test', '/big'));
  assert.equal(big.truncated, true);
  assert.equal(big.html.length, 1000);
  await assert.rejects(pages.serve(server.url('site.test', '/slow')), { status: 504 });
});

test('cache, shared in-flight requests and the global start budget bound upstream load', async t => {
  let hits = 0;
  const server = await site(t, (req, res) => { hits++; setTimeout(() => html(res, `<p>${req.url}</p>`), 20); });
  let time = 1_000_000;
  const stats = {};
  const pages = reader({ now: () => time, stats, maxStartsPerMinute: 2 });
  const [a, b] = await Promise.all([pages.serve(server.url('site.test', '/a')), pages.serve(server.url('site.test', '/a'))]);
  assert.equal(a.html, b.html);
  assert.equal((await pages.serve(server.url('site.test', '/a'))).cached, true);
  assert.equal(hits, 1);
  await pages.serve(server.url('site.test', '/b'));
  await assert.rejects(pages.serve(server.url('site.test', '/c')), { status: 503 });
  time += 61_000;
  await pages.serve(server.url('site.test', '/c'));
  assert.equal(hits, 3);
  assert.deepEqual(stats, { pageUpstream: 3, pageCacheHits: 1 });
});

test('relay route requires a known origin and GET, and returns static JSON errors', async t => {
  const server = await site(t, (req, res) => html(res, '<title>Relay page</title>'));
  const origin = 'https://banana.example';
  const relay = createRelay({ origins: [origin], pageReaderOptions: { resolve, isAllowedAddress: allowLoopback, allowPorts: true } });
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  t.after(() => relay.close());
  const base = `http://127.0.0.1:${relay.server.address().port}/page?url=`;
  const target = encodeURIComponent(server.url('site.test', '/x'));
  const ok = await fetch(base + target, { headers: { Origin: origin } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await ok.json(), { url: server.url('site.test', '/x'), html: '<title>Relay page</title>', truncated: false });
  assert.equal((await fetch(base + target, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + target)).status, 403);
  assert.equal((await fetch(base + target, { method: 'POST', headers: { Origin: origin } })).status, 405);
  const missing = await fetch(base, { headers: { Origin: origin } });
  assert.deepEqual([missing.status, await missing.json()], [400, { error: 'Missing url parameter.' }]);
  const blocked = await fetch(base + encodeURIComponent('http://10.0.0.1/'), { headers: { Origin: origin } });
  assert.deepEqual([blocked.status, await blocked.json()], [400, { error: 'This address is not public.' }]);
  assert.equal(relay.stats.pageUpstream, 1);
});

test('handler maps unexpected failures to a generic 502', async () => {
  const headers = {};
  let status, body;
  const res = { setHeader: (k, v) => { headers[k] = v; }, writeHead: s => { status = s; }, end: b => { body = b; } };
  await handlePageRequest({ method: 'GET', url: '/page?url=https%3A%2F%2Fexample.com%2F', headers: { origin: 'https://o.example' } }, res,
    { serve: async () => { throw new Error('socket detail 10.0.0.1'); } }, new Set(['https://o.example']));
  assert.equal(status, 502);
  assert.deepEqual(JSON.parse(body), { error: 'The page could not be read.' });
});
