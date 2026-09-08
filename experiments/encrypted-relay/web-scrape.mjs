import { isIP } from 'node:net';

const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_BYTES = 10 * 1024 * 1024;
const CACHE_TTL = 10 * 60_000;
const ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';

export class WebScrapeError extends Error {
  constructor(status, message, credits = null) {
    super(message);
    this.status = status;
    this.usage = { credits, cached: false };
  }
}

export function parseWebTarget(raw) {
  const invalid = () => { throw new WebScrapeError(400, 'A public HTTP(S) URL is required.', 0); };
  if (typeof raw !== 'string' || !raw || raw.length > 8192 || /[\x00-\x20\x7f\\]/.test(raw)) invalid();
  let url;
  try { url = new URL(raw); } catch { invalid(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port))) invalid();
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Conservatively exclude all IP literals (including URL-normalized numeric
  // IPv4 forms), single-label hosts, and reserved/private DNS namespaces.
  if (isIP(host) || host.startsWith('[') || !host.includes('.') ||
      !/^[a-z0-9.-]+$/.test(host) || host.split('.').some(label => !label || label.startsWith('-') || label.endsWith('-')) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(host) ||
      host === 'metadata.google.internal') invalid();
  url.hash = '';
  return url.href;
}

async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new WebScrapeError(502, 'Web provider returned an invalid response.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new WebScrapeError(502, 'Web response is too large.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    if (size > MAX_BYTES) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Limits are per process, including a hard 100-start lifetime ceiling. Restarting
// the process resets that ceiling; this is not an account-wide billing budget.
// No destination request or DNS lookup occurs here: Firecrawl fetches the URL.
export function createWebScraper({ apiKey, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheSize = 0;
  let starts = [];
  let lifetimeStarts = 0;
  let active = 0;

  async function upstream(url) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new WebScrapeError(504, 'Web request timed out.'));
      }, 35_000);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, formats: ['markdown', 'links', 'images'], onlyMainContent: false,
            timeout: 30_000, maxAge: 3_600_000, parsers: [], proxy: 'basic' }),
        });
        const bytes = await readBounded(response);
        let result;
        try { result = JSON.parse(bytes.toString('utf8')); } catch {
          throw new WebScrapeError(502, 'Web provider returned an invalid response.');
        }
        const reported = result?.data?.metadata?.creditsUsed;
        const credits = typeof reported === 'number' && Number.isFinite(reported) && reported >= 0 ? reported : null;
        const status = result?.data?.metadata?.statusCode;
        if (!response.ok || result?.success !== true || !result.data || typeof result.data !== 'object' ||
            Array.isArray(result.data) || (status !== undefined &&
              (typeof status !== 'number' || status < 200 || status >= 300))) {
          throw new WebScrapeError(502, 'Web page could not be retrieved.', credits);
        }
        return { bytes: Buffer.from(JSON.stringify(result.data)), credits };
      })()]);
    } catch (error) {
      if (error instanceof WebScrapeError) throw error;
      throw new WebScrapeError(502, 'Web provider is unavailable.');
    } finally { clearTimeout(timer); }
  }

  return async function scrape(rawUrl) {
    const url = parseWebTarget(rawUrl);
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new WebScrapeError(503, 'Web browsing is not configured.', 0);
    const time = now();
    const cached = cache.get(url);
    if (cached) {
      cache.delete(url);
      if (cached.expires > time) {
        cache.set(url, cached);
        return { data: JSON.parse(cached.bytes), usage: { credits: 0, cached: true } };
      }
      cacheSize -= cached.bytes.length;
    }
    if (pending.has(url)) {
      try {
        const shared = await pending.get(url);
        return { data: JSON.parse(shared.bytes), usage: { credits: 0, cached: true } };
      } catch (error) {
        // The initiating caller owns any provider charge, even on failure.
        throw new WebScrapeError(error instanceof WebScrapeError ? error.status : 502,
          error instanceof WebScrapeError ? error.message : 'Web provider is unavailable.', 0);
      }
    }
    starts = starts.filter(start => start > time - 60_000);
    if (lifetimeStarts >= 100) throw new WebScrapeError(503, 'Web browsing request budget is exhausted.', 0);
    if (active >= 2 || starts.length >= 10) throw new WebScrapeError(503, 'Web browsing is busy. Try again shortly.', 0);
    active++;
    lifetimeStarts++;
    starts.push(time);
    const job = upstream(url);
    pending.set(url, job);
    try {
      const result = await job;
      cache.set(url, { bytes: result.bytes, expires: now() + CACHE_TTL });
      cacheSize += result.bytes.length;
      while (cache.size > 20 || cacheSize > CACHE_BYTES) {
        const oldest = cache.keys().next().value;
        cacheSize -= cache.get(oldest).bytes.length;
        cache.delete(oldest);
      }
      return { data: JSON.parse(result.bytes), usage: { credits: result.credits, cached: false } };
    } finally {
      active--;
      pending.delete(url);
    }
  };
}

export async function handleWebRequest(req, res, scrape, allowedOrigins) {
  const send = (status, body) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };
  const deny = (status, error, usage = { credits: 0, cached: false }) => send(status, { data: null, usage, error });
  if (!req.headers?.origin || !allowedOrigins.has(req.headers.origin)) return deny(403, 'Forbidden origin.');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'GET') return deny(405, 'Method not allowed.');
  let url;
  try {
    const request = new URL(req.url, 'http://local');
    if (request.pathname !== '/web' || request.searchParams.getAll('url').length !== 1 ||
        [...request.searchParams.keys()].some(key => key !== 'url')) return deny(400, 'Invalid request.');
    url = request.searchParams.get('url');
  } catch { return deny(400, 'Invalid request.'); }
  try { send(200, await scrape(url)); } catch (error) {
    if (error instanceof WebScrapeError) return deny(error.status, error.message, error.usage);
    deny(502, 'Web provider is unavailable.', { credits: null, cached: false });
  }
}
