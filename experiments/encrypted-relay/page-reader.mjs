// Bounded read-only webpage reader: the keyless alternative to Firecrawl scrapes.
//
// The static frontend cannot fetch arbitrary sites (CORS). This route fetches
// one public HTML page server-side and returns its HTML; the browser extracts
// text, links and image URLs itself. It is not a general proxy:
// - only http/https on default ports, no credentials, no private, loopback,
//   link-local, reserved or multicast addresses. Every DNS answer must be
//   public and the connection is pinned to the checked address (no rebinding);
//   each redirect hop (at most 5) is validated again;
// - GET only, no caller cookies or headers forwarded, descriptive User-Agent;
// - HTML or XHTML only, decompressed bytes bounded (larger pages are
//   truncated), 10 s timeout covering every hop;
// - at most 4 upstream requests in flight and 30 starts per minute globally,
//   5 minute per-URL cache, identical concurrent requests share one fetch;
// - error bodies are static and never include upstream content;
// - when a site refuses the reader (bot checks, 401/403/429, other errors except
//   404/410) or times out, the newest HTTP 200 Internet Archive capture is
//   returned instead, labeled with its capture time. Only archive.org is
//   contacted for this, through the same checks and limits.

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export const PAGE_UA = 'Banana-Browser/1.0 (+https://github.com/aburkard/banana-browser)';
export const PAGE_ACCEPT = 'text/html,application/xhtml+xml;q=0.9';
export const UPSTREAM_TIMEOUT_MS = 10_000;
export const ARCHIVE_ORIGIN = 'https://web.archive.org';
// Archive lookup plus snapshot fetch; together with UPSTREAM_TIMEOUT_MS this stays
// under the browser's wait for the relay.
export const ARCHIVE_TIMEOUT_MS = 12_000;
const MAX_ARCHIVE_INDEX_BYTES = 256 * 1024;
export const MAX_HTML_BYTES = 3 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const MAX_URL_LENGTH = 2048;
export const CACHE_TTL_MS = 5 * 60_000;
export const CACHE_MAX_ENTRIES = 50;
export const CACHE_MAX_BYTES = 40 * 1024 * 1024;
export const MAX_IN_FLIGHT = 4;
export const MAX_STARTS_PER_MINUTE = 30;
const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export class PageError extends Error {
  /** `archivable`: the site refused or failed, so an archived copy may stand in. */
  constructor(status, message, archivable = false) {
    super(message);
    this.status = status;
    this.archivable = archivable;
  }
}

// Interstitials from common bot-protection services, served instead of the page.
const BOT_CHECK_TITLE = /^\s*(just a moment|attention required|access denied|pardon our interruption|robot or human|are you a robot|verify you are (a )?human|please verify|security check|one more step|checking your browser)/i;
const BOT_CHECK_MARKER = /captcha-delivery\.com|_Incapsula_Resource|cf-chl-|px-captcha|awswaf/i;

export function isBotCheck(html) {
  const title = /<title[^>]*>([^<]*)/i.exec(html)?.[1] ?? '';
  return BOT_CHECK_TITLE.test(title) || html.length < 50_000 && BOT_CHECK_MARKER.test(html);
}

// Non-public ranges (RFC 6890 special-purpose registries plus multicast/reserved).
const blocked = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return !blocked.check(address, 'ipv6');
}

const invalid = message => { throw new PageError(400, message); };

/** Validate a caller URL. `allowPorts` exists only so offline tests can use a random local port. */
export function parsePageTarget(rawUrl, { allowPorts = false, isAllowedAddress = isPublicAddress } = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl) invalid('Missing url parameter.');
  if (rawUrl.length > MAX_URL_LENGTH) invalid('URL is too long.');
  let url;
  try { url = new URL(rawUrl); } catch { invalid('Invalid URL.'); }
  if (!Object.hasOwn(DEFAULT_PORTS, url.protocol)) invalid('Only http and https pages can be read.');
  if (url.username || url.password) invalid('URLs with credentials are not allowed.');
  if (url.port && url.port !== DEFAULT_PORTS[url.protocol] && !allowPorts) invalid('Only default web ports are allowed.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(localhost|local|internal|home|lan|arpa)$/.test(host) || !host.includes('.') && !net.isIP(host)) {
    invalid('This address is not public.');
  }
  if (net.isIP(host) && !isAllowedAddress(host)) invalid('This address is not public.');
  url.hash = '';
  return url;
}

/** dns.lookup-compatible resolver that refuses any non-public answer. */
export function createSafeLookup({ resolve = (host) => dns.lookup(host, { all: true, verbatim: true }), isAllowedAddress = isPublicAddress } = {}) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolve(hostname).then(addresses => {
      if (!addresses.length || !addresses.every(entry => isAllowedAddress(entry.address))) {
        callback(Object.assign(new Error('Non-public address'), { code: 'BANANA_NON_PUBLIC' }));
        return;
      }
      if (options?.all) callback(null, addresses.map(({ address, family }) => ({ address, family })));
      else callback(null, addresses[0].address, addresses[0].family);
    }, () => callback(Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' })));
  };
}

// Node's TextDecoder reports windows-1252 but decodes 0x80–0x9F as Latin-1 controls.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

export function decodeHtml(bytes, contentType = '') {
  const head = bytes.subarray(0, 4096).toString('latin1');
  const declared = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1]
    || /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  let decoder;
  try { decoder = new TextDecoder(declared || 'utf-8'); } catch { decoder = new TextDecoder('utf-8'); }
  if (decoder.encoding !== 'windows-1252') return decoder.decode(bytes);
  return bytes.toString('latin1').replace(/[\x80-\x9f]/g, char => CP1252[char.charCodeAt(0) - 0x80]);
}

function decoderFor(encoding) {
  switch ((encoding || '').trim().toLowerCase()) {
    case '': case 'identity': return null;
    case 'gzip': case 'x-gzip': return zlib.createGunzip();
    case 'deflate': return zlib.createInflate();
    case 'br': return zlib.createBrotliDecompress();
    default: throw new PageError(502, 'The site used an unsupported encoding.');
  }
}

/** Read at most maxBytes of decompressed body; larger pages are truncated, never buffered whole. */
function readBody(response, maxBytes) {
  return new Promise((resolve, reject) => {
    let stream = response;
    try {
      const decoder = decoderFor(response.headers['content-encoding']);
      if (decoder) stream = response.pipe(decoder);
    } catch (error) { response.destroy(); reject(error); return; }
    const chunks = [];
    let total = 0, done = false;
    const finish = truncated => {
      if (done) return;
      done = true;
      response.destroy();
      if (stream !== response) stream.destroy();
      resolve({ bytes: Buffer.concat(chunks, total), truncated });
    };
    stream.on('data', chunk => {
      const room = maxBytes - total;
      if (chunk.length >= room) {
        chunks.push(chunk.subarray(0, room));
        total += room;
        finish(true);
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    const fail = () => { if (!done) { done = true; response.destroy(); if (stream !== response) stream.destroy(); reject(new PageError(502, 'The page could not be read.')); } };
    stream.on('end', () => finish(false));
    stream.on('error', fail);
    // An aborted or reset connection may close without an error event.
    response.on('close', () => { if (!response.complete) fail(); });
  });
}

export function createPageReader({
  now = () => Date.now(),
  stats = null,
  resolve,
  isAllowedAddress = isPublicAddress,
  allowPorts = false,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  archiveOrigin = ARCHIVE_ORIGIN,
  archiveTimeoutMs = ARCHIVE_TIMEOUT_MS,
  maxBytes = MAX_HTML_BYTES,
  maxInFlight = MAX_IN_FLIGHT,
  maxStartsPerMinute = MAX_STARTS_PER_MINUTE,
  cacheTtlMs = CACHE_TTL_MS,
  cacheMaxEntries = CACHE_MAX_ENTRIES,
  cacheMaxBytes = CACHE_MAX_BYTES,
} = {}) {
  const lookup = createSafeLookup({ ...(resolve ? { resolve } : {}), isAllowedAddress });
  const cache = new Map();
  let cacheBytes = 0;
  const pending = new Map();
  let inFlight = 0;
  let starts = [];
  const count = key => { if (stats) stats[key] = (stats[key] ?? 0) + 1; };

  function requestOnce(url, signal) {
    return new Promise((resolveResponse, reject) => {
      const client = url.protocol === 'https:' ? https : http;
      // A fresh socket per hop keeps the pinned, checked address tied to this host.
      const request = client.request(url, {
        method: 'GET', agent: false, lookup, signal,
        headers: { 'User-Agent': PAGE_UA, Accept: PAGE_ACCEPT, 'Accept-Language': 'en-US,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' },
      }, resolveResponse);
      request.on('error', error => reject(error?.code === 'BANANA_NON_PUBLIC'
        ? new PageError(400, 'This address is not public.')
        : signal.aborted ? new PageError(504, 'The site took too long to respond.', true) : new PageError(502, 'The site could not be reached.', true)));
      request.end();
    });
  }

  async function fetchPage(startUrl, signal = AbortSignal.timeout(timeoutMs)) {
    let url = startUrl;
    for (let hop = 0; ; hop++) {
      const response = await requestOnce(url, signal);
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        if (hop >= MAX_REDIRECTS) throw new PageError(502, 'The site redirected too many times.');
        let next;
        try { next = new URL(response.headers.location, url).href; } catch { throw new PageError(502, 'The site sent an invalid redirect.'); }
        url = parsePageTarget(next, { allowPorts, isAllowedAddress });
        continue;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        throw new PageError(502, `The site returned HTTP ${status}.`, ![404, 410].includes(status));
      }
      const type = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
      if (!HTML_TYPES.has(type)) {
        response.destroy();
        throw new PageError(415, 'This address is not an HTML page.');
      }
      const { bytes, truncated } = await readBody(response, maxBytes);
      const html = decodeHtml(bytes, String(response.headers['content-type'] || ''));
      if (isBotCheck(html)) throw new PageError(502, 'The site showed a bot check instead of the page.', true);
      return { url: url.href, html, truncated };
    }
  }

  /** Newest HTTP 200 capture of exactly this URL, or the original failure. */
  async function fetchArchived(url, cause) {
    if (!cause?.archivable || !archiveOrigin) throw cause;
    const signal = AbortSignal.timeout(archiveTimeoutMs);
    try {
      const index = new URL('/cdx/search/cdx', archiveOrigin);
      for (const [name, value] of [['url', url.href], ['filter', 'statuscode:200'], ['filter', 'mimetype:text/html'],
        ['limit', '-1'], ['fl', 'timestamp,original'], ['output', 'json']]) index.searchParams.append(name, value);
      const response = await requestOnce(parsePageTarget(index.href, { allowPorts, isAllowedAddress }), signal);
      if (response.statusCode !== 200) { response.resume(); throw cause; }
      const rows = JSON.parse((await readBody(response, MAX_ARCHIVE_INDEX_BYTES)).bytes.toString('utf8'));
      const [timestamp, original] = Array.isArray(rows) ? rows.at(-1) ?? [] : [];
      if (!/^\d{14}$/.test(timestamp) || typeof original !== 'string' || !/^https?:\/\//i.test(original)) throw cause;
      count('pageArchive');
      const snapshot = parsePageTarget(`${archiveOrigin}/web/${timestamp}id_/${original}`, { allowPorts, isAllowedAddress });
      const page = await fetchPage(snapshot, signal);
      return { url: url.href, html: page.html, truncated: page.truncated, archivedAt: timestamp, snapshotUrl: `${archiveOrigin}/web/${timestamp}/${original}` };
    } catch {
      throw new PageError(cause.status, `${cause.message.replace(/\.$/, '')}, and no archived copy was available.`);
    }
  }

  const archived = value => value.archivedAt ? { archivedAt: value.archivedAt, snapshotUrl: value.snapshotUrl } : {};

  function getFresh(key, nowMs) {
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key);
    if (entry.expires <= nowMs) { cacheBytes -= entry.size; return null; }
    cache.set(key, entry);
    return entry;
  }

  function store(key, value, nowMs) {
    const size = value.html.length * 2;
    if (cache.has(key)) cacheBytes -= cache.get(key).size;
    cache.delete(key);
    cache.set(key, { ...value, expires: nowMs + cacheTtlMs, size });
    cacheBytes += size;
    while ((cache.size > cacheMaxEntries || cacheBytes > cacheMaxBytes) && cache.size) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).size;
      cache.delete(oldest);
    }
  }

  async function serve(targetUrl) {
    const url = parsePageTarget(targetUrl, { allowPorts, isAllowedAddress });
    const key = url.href;
    const nowMs = now();
    const fresh = getFresh(key, nowMs);
    if (fresh) {
      count('pageCacheHits');
      return { ...archived(fresh), url: fresh.url, html: fresh.html, truncated: fresh.truncated, cached: true };
    }
    let job = pending.get(key);
    if (!job) {
      starts = starts.filter(time => time > nowMs - 60_000);
      if (inFlight >= maxInFlight || starts.length >= maxStartsPerMinute) throw new PageError(503, 'The reader is busy. Try again shortly.');
      starts.push(nowMs);
      inFlight++;
      count('pageUpstream');
      job = fetchPage(url).catch(error => fetchArchived(url, error)).then(value => { store(key, value, now()); return value; }).finally(() => { inFlight--; pending.delete(key); });
      pending.set(key, job);
    }
    const value = await job;
    return { ...archived(value), url: value.url, html: value.html, truncated: value.truncated, cached: false };
  }

  return { serve };
}

// HTTP wiring shared by the relay route and offline tests. Requires a known
// caller Origin and GET; error bodies are static JSON (never upstream text).
export async function handlePageRequest(req, res, reader, allowedOrigins) {
  const reply = (status, body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };
  if (!allowedOrigins.has(req.headers?.origin)) return reply(403, { error: 'Forbidden origin.' });
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'GET') return reply(405, { error: 'Method not allowed.' });
  let target;
  try { target = new URL(req.url, 'http://local').searchParams.get('url'); } catch { return reply(400, { error: 'Invalid request.' }); }
  if (!target) return reply(400, { error: 'Missing url parameter.' });
  try {
    const page = await reader.serve(target);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    reply(200, { url: page.url, html: page.html, truncated: page.truncated,
      ...(page.archivedAt ? { archivedAt: page.archivedAt, snapshotUrl: page.snapshotUrl } : {}) });
  } catch (error) {
    const status = error instanceof PageError ? error.status : 502;
    reply(status, { error: error instanceof PageError ? error.message : 'The page could not be read.' });
  }
}
