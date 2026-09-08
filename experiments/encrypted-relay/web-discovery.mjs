import { parseWebTarget } from './web-scrape.mjs';

const MAX_BYTES = 1024 * 1024;
const CACHE_BYTES = 5 * MAX_BYTES;
const CACHE_TTL = 10 * 60_000;

export class WebDiscoveryError extends Error {
  constructor(status, message, credits = null) {
    super(message);
    this.status = status;
    this.usage = { credits, cached: false };
  }
}

function parseInput(kind, input) {
  if (kind === 'map') {
    try { return parseWebTarget(input); } catch {
      throw new WebDiscoveryError(400, 'A public HTTP(S) URL is required.', 0);
    }
  }
  if (kind !== 'search' || typeof input !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(input) ||
      !input.trim() || input.trim().length > 300) {
    throw new WebDiscoveryError(400, 'A search query of 1–300 characters is required.', 0);
  }
  return input.trim();
}

async function readBounded(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new WebDiscoveryError(502, 'Web provider returned an invalid response.');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        cancel();
        throw new WebDiscoveryError(502, 'Web response is too large.');
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function reportedCredits(result) {
  for (const value of [result?.metadata?.creditsUsed, result?.creditsUsed, result?.data?.metadata?.creditsUsed]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function normalizeData(kind, result, credits) {
  const rows = kind === 'search' ? (Array.isArray(result.data) ? result.data : result.data?.web) : result.links;
  if (!Array.isArray(rows)) throw new WebDiscoveryError(502, 'Web provider returned an invalid response.', credits);
  const links = [];
  for (const row of rows.slice(0, kind === 'search' ? 10 : 25)) {
    const item = typeof row === 'string' ? { url: row } : row;
    let url;
    try { url = parseWebTarget(item?.url); } catch { continue; }
    links.push({ url, ...(typeof item.title === 'string' ? { title: item.title } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}) });
  }
  return kind === 'search' ? { web: links } : { links };
}

// These limits share one discovery instance across search and map in the relay.
// They are per process, including a hard 50-start lifetime ceiling. A process
// restart resets the ceiling; this is not an account-wide billing budget.
export function createWebDiscovery({ apiKey, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  let cacheSize = 0;
  let starts = [];
  let lifetimeStarts = 0;
  let active = 0;

  async function upstream(kind, input) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new WebDiscoveryError(504, 'Web request timed out.'));
        controller.abort();
      }, 20_000);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const body = kind === 'search' ? { query: input, limit: 10, sources: ['web'], timeout: 20_000 } :
          { url: input, limit: 25, includeSubdomains: false, timeout: 20_000 };
        const response = await fetchImpl(`https://api.firecrawl.dev/v2/${kind}`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await readBounded(response, controller.signal);
        const credits = reportedCredits(result);
        if (!response.ok || result?.success !== true) {
          throw new WebDiscoveryError(502, 'Web discovery failed.', credits);
        }
        return { bytes: Buffer.from(JSON.stringify(normalizeData(kind, result, credits))), credits };
      })()]);
    } catch (error) {
      if (error instanceof WebDiscoveryError) throw error;
      throw new WebDiscoveryError(502, 'Web provider is unavailable.');
    } finally { clearTimeout(timer); }
  }

  return async function discover(kind, rawInput) {
    const input = parseInput(kind, rawInput);
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new WebDiscoveryError(503, 'Web discovery is not configured.', 0);
    const key = JSON.stringify([kind, input]);
    const time = now();
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      if (cached.expires > time) {
        cache.set(key, cached);
        return { data: JSON.parse(cached.bytes), usage: { credits: 0, cached: true } };
      }
      cacheSize -= cached.bytes.length;
    }
    if (pending.has(key)) {
      try {
        const shared = await pending.get(key);
        return { data: JSON.parse(shared.bytes), usage: { credits: 0, cached: true } };
      } catch (error) {
        throw new WebDiscoveryError(error instanceof WebDiscoveryError ? error.status : 502,
          error instanceof WebDiscoveryError ? error.message : 'Web provider is unavailable.', 0);
      }
    }
    starts = starts.filter(start => start > time - 60_000);
    if (lifetimeStarts >= 50) throw new WebDiscoveryError(503, 'Web discovery request budget is exhausted.', 0);
    if (active >= 2 || starts.length >= 10) throw new WebDiscoveryError(503, 'Web discovery is busy. Try again shortly.', 0);
    active++;
    lifetimeStarts++;
    starts.push(time);
    const job = upstream(kind, input);
    pending.set(key, job);
    try {
      const result = await job;
      cache.set(key, { bytes: result.bytes, expires: now() + CACHE_TTL });
      cacheSize += result.bytes.length;
      while (cache.size > 20 || cacheSize > CACHE_BYTES) {
        const oldest = cache.keys().next().value;
        cacheSize -= cache.get(oldest).bytes.length;
        cache.delete(oldest);
      }
      return { data: JSON.parse(result.bytes), usage: { credits: result.credits, cached: false } };
    } finally {
      active--;
      pending.delete(key);
    }
  };
}

export async function handleDiscoveryRequest(req, res, discover, allowedOrigins) {
  const send = (status, body) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };
  const deny = (status, error, usage = { credits: 0, cached: false }) => send(status, { data: null, usage, error });
  if (typeof req.headers?.origin !== 'string' || !allowedOrigins.has(req.headers.origin)) return deny(403, 'Forbidden origin.');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'GET') return deny(405, 'Method not allowed.');
  let kind, input;
  try {
    const request = new URL(req.url, 'http://local');
    if (!['/search', '/map'].includes(request.pathname) || request.hash) return deny(400, 'Invalid request.');
    kind = request.pathname.slice(1);
    const key = kind === 'search' ? 'q' : 'url';
    if (request.searchParams.getAll(key).length !== 1 ||
        [...request.searchParams.keys()].some(name => name !== key)) return deny(400, 'Invalid request.');
    input = parseInput(kind, request.searchParams.get(key));
  } catch { return deny(400, 'Invalid request.'); }
  try { send(200, await discover(kind, input)); } catch (error) {
    if (error instanceof WebDiscoveryError) return deny(error.status, error.message, error.usage);
    deny(502, 'Web provider is unavailable.', { credits: null, cached: false });
  }
}
