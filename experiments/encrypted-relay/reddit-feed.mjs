// Bounded read-only Reddit RSS gateway.
//
// The static frontend cannot reach Reddit's anonymous JSON (edge 403), but
// Reddit still serves public subreddit/post RSS as Atom XML. This module
// exposes that one path through a narrow allowlist: canonical HTTPS
// www.reddit.com subreddit listing/sort and comment URLs ending in .json are
// translated to the matching /.rss upstream URL. It is not a general proxy:
// arbitrary hosts, credentials, ports, user/private paths, traversal, and
// unknown query keys are rejected before any upstream request starts.
//
// Upstream discipline: descriptive User-Agent plus Atom Accept only (no user
// cookies or auth), redirect:'error', 15 s timeout covering headers and body,
// 2 MiB body bound, Atom XML content-type required (an HTML 200 is an error).
// Local discipline: at most 2 upstream requests in flight, at most 6 upstream
// starts per minute, 60 s per-URL cache (20 entries / 10 MiB max), identical
// concurrent requests share one upstream fetch, upstream 429 installs a global
// cooldown from a bounded Retry-After (default 60 s, max 300 s) with no
// retries. Fresh cache is served before the cooldown check. Only 200s are
// cached; error bodies never include upstream content.

export const REDDIT_HOST = 'www.reddit.com';
export const REDDIT_UA = 'Banana-Browser/1.0 (+https://github.com/aburkard/banana-browser)';
export const REDDIT_ACCEPT = 'application/atom+xml';
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const UPSTREAM_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 25;
export const CACHE_TTL_MS = 60_000;
export const CACHE_MAX_ENTRIES = 20;
export const CACHE_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_IN_FLIGHT = 2;
export const MAX_STARTS_PER_MINUTE = 6;
export const COOLDOWN_DEFAULT_S = 60;
export const COOLDOWN_MAX_S = 300;

const SUB_PATTERN = '[A-Za-z0-9_]{2,24}';
const LISTING_PATTERN = new RegExp(`^/r/(${SUB_PATTERN})/?$`);
const SORT_PATTERN = new RegExp(`^/r/(${SUB_PATTERN})/(hot|new|top|rising|controversial)/?$`);
const COMMENTS_PATTERN = new RegExp(`^/r/(${SUB_PATTERN})/comments/([A-Za-z0-9]{2,12})(?:/([^/]{0,300}))?/?$`);
const SORTS = new Set(['hot', 'new', 'top', 'rising', 'controversial']);
const TIMES = new Set(['hour', 'day', 'week', 'month', 'year', 'all']);
const QUERY_ALLOWLIST = new Set(['limit', 'sort', 't']);

export class FeedError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

const invalid = message => { throw new FeedError(400, message); };

// Validate a caller-supplied .json URL and derive the upstream /.rss URL.
// Returns { upstreamUrl }. Throws FeedError(400) for anything outside the
// narrow public listing/sort/comments shapes.
export function parseRedditTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) invalid('Missing url parameter.');
  // Reject traversal/encoding tricks on the raw string before URL parsing
  // normalizes them away. Query and fragment are excluded from this check.
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  if (/[.]{2}|\\|%00|%2e|%2f|%5c/i.test(rawPath)) invalid('Invalid Reddit URL.');
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    invalid('Invalid Reddit URL.');
  }
  if (parsed.protocol !== 'https:') invalid('Reddit URL must use https.');
  if (parsed.hostname !== REDDIT_HOST) invalid('Only www.reddit.com feeds are allowed.');
  if (parsed.username || parsed.password) invalid('Reddit URL must not include credentials.');
  if (parsed.port) invalid('Reddit URL must not include a port.');
  if (!parsed.pathname.endsWith('.json')) invalid('Reddit URL must end in .json.');
  const base = parsed.pathname.slice(0, -'.json'.length);

  let sub, pathSort = null, commentId = null, slug = '';
  let match;
  if ((match = SORT_PATTERN.exec(base))) {
    sub = match[1]; pathSort = match[2];
  } else if ((match = LISTING_PATTERN.exec(base))) {
    sub = match[1];
  } else if ((match = COMMENTS_PATTERN.exec(base))) {
    sub = match[1]; commentId = match[2];
    try { slug = decodeURIComponent(match[3] ?? ''); } catch { invalid('Invalid Reddit URL.'); }
    // Decoded slug must be plain text (no controls); it is re-encoded below.
    if (/[\x00-\x1f\x7f]/.test(slug)) invalid('Invalid Reddit URL.');
  } else {
    invalid('Only public subreddit listings and post comment URLs are allowed.');
  }

  let limit = DEFAULT_LIMIT, querySort = null, t = null;
  for (const key of parsed.searchParams.keys()) {
    if (!QUERY_ALLOWLIST.has(key)) invalid(`Unsupported query parameter: ${key}.`);
  }
  for (const key of QUERY_ALLOWLIST) {
    if (parsed.searchParams.getAll(key).length > 1) invalid(`Duplicate query parameter: ${key}.`);
  }
  const limitRaw = parsed.searchParams.get('limit');
  if (limitRaw !== null) {
    if (!/^\d{1,3}$/.test(limitRaw)) invalid('Invalid limit.');
    limit = Math.min(Math.max(parseInt(limitRaw, 10), 1), MAX_LIMIT);
  }
  const sortRaw = parsed.searchParams.get('sort');
  if (sortRaw !== null) {
    if (!SORTS.has(sortRaw)) invalid('Invalid sort.');
    querySort = sortRaw;
  }
  const tRaw = parsed.searchParams.get('t');
  if (tRaw !== null) {
    if (!TIMES.has(tRaw)) invalid('Invalid t.');
    t = tRaw;
  }

  let upstreamPath;
  if (commentId) {
    if (querySort || t) invalid('Sort options do not apply to comment URLs.');
    upstreamPath = `/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(commentId)}/` +
      (slug ? `${encodeURIComponent(slug)}/` : '') + '.rss';
  } else {
    const effectiveSort = pathSort ?? querySort;
    if (pathSort && querySort && pathSort !== querySort) invalid('Conflicting sort.');
    if (t && effectiveSort !== 'top') invalid('Query t requires sort=top.');
    upstreamPath = `/r/${encodeURIComponent(sub)}/` + (effectiveSort ? `${effectiveSort}/` : '') + '.rss';
  }
  const upstreamQuery = `limit=${limit}` + (t ? `&t=${encodeURIComponent(t)}` : '');
  return { upstreamUrl: `https://${REDDIT_HOST}${upstreamPath}?${upstreamQuery}` };
}

function parseRetryAfter(value, nowMs) {
  if (value == null) return COOLDOWN_DEFAULT_S;
  const text = String(value).trim();
  if (/^\d{1,4}$/.test(text)) {
    return Math.min(Math.max(parseInt(text, 10), 1), COOLDOWN_MAX_S);
  }
  const when = Date.parse(text);
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(Math.ceil((when - nowMs) / 1000), 1), COOLDOWN_MAX_S);
  }
  return COOLDOWN_DEFAULT_S;
}

export function createRedditFeed({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  stats = null,
  maxInFlight = MAX_IN_FLIGHT,
  maxStartsPerMinute = MAX_STARTS_PER_MINUTE,
  cacheTtlMs = CACHE_TTL_MS,
  cacheMaxEntries = CACHE_MAX_ENTRIES,
  cacheMaxBytes = CACHE_MAX_BYTES,
  upstreamMaxBytes = UPSTREAM_MAX_BYTES,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
} = {}) {
  const cache = new Map(); // upstreamUrl -> { expires, bytes, contentType, size }
  let cacheBytes = 0;
  const pending = new Map(); // upstreamUrl -> Promise<{ bytes, contentType }>
  let inFlight = 0;
  let starts = [];
  let cooldownUntil = 0;

  const count = key => { if (stats) stats[key] = (stats[key] ?? 0) + 1; };

  function getFresh(key, nowMs) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expires <= nowMs) {
      cache.delete(key);
      cacheBytes -= entry.size;
      return null;
    }
    cache.delete(key);
    cache.set(key, entry); // refresh LRU order
    return entry;
  }

  function store(key, bytes, contentType, nowMs) {
    const size = bytes.length;
    if (cache.has(key)) cacheBytes -= cache.get(key).size;
    cache.delete(key);
    cache.set(key, { expires: nowMs + cacheTtlMs, bytes, contentType, size });
    cacheBytes += size;
    while ((cache.size > cacheMaxEntries || cacheBytes > cacheMaxBytes) && cache.size > 0) {
      const oldest = cache.keys().next().value;
      cacheBytes -= cache.get(oldest).size;
      cache.delete(oldest);
    }
  }

  async function readBounded(response) {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > upstreamMaxBytes) {
          try { await reader.cancel(); } catch { /* bounded read ends here */ }
          throw new FeedError(502, 'Reddit feed response too large.');
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > upstreamMaxBytes) throw new FeedError(502, 'Reddit feed response too large.');
    return bytes;
  }

  async function discardBody(response) {
    try {
      if (response.body && typeof response.body.cancel === 'function') await response.body.cancel();
    } catch { /* best effort only */ }
  }

  async function fetchUpstream(upstreamUrl) {
    let response;
    try {
      response = await fetchImpl(upstreamUrl, {
        method: 'GET',
        headers: { 'User-Agent': REDDIT_UA, Accept: REDDIT_ACCEPT },
        redirect: 'error',
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
    } catch {
      throw new FeedError(502, 'Reddit feed unavailable.');
    }
    if (response.status === 429) {
      const seconds = parseRetryAfter(response.headers?.get?.('retry-after'), now());
      cooldownUntil = now() + seconds * 1000;
      await discardBody(response);
      count('redditCooldowns');
      throw new FeedError(429, 'Reddit is rate limiting requests.', seconds);
    }
    if (response.status !== 200) {
      await discardBody(response);
      throw new FeedError(502, 'Reddit feed unavailable.');
    }
    const contentType = String(response.headers?.get?.('content-type') ?? '')
      .split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/atom+xml' && contentType !== 'application/xml' && contentType !== 'text/xml') {
      await discardBody(response);
      throw new FeedError(502, 'Reddit feed returned an unexpected format.');
    }
    return { bytes: await readBounded(response), contentType: 'application/atom+xml' };
  }

  // Serve one caller URL. Resolves { status: 200, bytes, contentType, cached }
  // or rejects with FeedError. Only successful Atom XML is cached.
  async function serve(targetUrl) {
    const { upstreamUrl } = parseRedditTarget(targetUrl);
    const nowMs = now();
    const fresh = getFresh(upstreamUrl, nowMs);
    if (fresh) {
      count('redditCacheHits');
      return { status: 200, bytes: fresh.bytes, contentType: fresh.contentType, cached: true };
    }
    if (nowMs < cooldownUntil) {
      const seconds = Math.max(1, Math.ceil((cooldownUntil - nowMs) / 1000));
      throw new FeedError(429, 'Reddit is rate limiting requests.', seconds);
    }
    let job = pending.get(upstreamUrl);
    if (!job) {
      starts = starts.filter(t => t > nowMs - 60_000);
      if (inFlight >= maxInFlight) throw new FeedError(503, 'Feed busy, try again shortly.');
      if (starts.length >= maxStartsPerMinute) throw new FeedError(503, 'Feed busy, try again shortly.');
      starts.push(nowMs);
      inFlight++;
      count('redditUpstream');
      job = (async () => {
        try {
          const { bytes, contentType } = await fetchUpstream(upstreamUrl);
          store(upstreamUrl, bytes, contentType, now());
          return { bytes, contentType };
        } finally {
          inFlight--;
          pending.delete(upstreamUrl);
        }
      })();
      pending.set(upstreamUrl, job);
    }
    const { bytes, contentType } = await job;
    return { status: 200, bytes, contentType, cached: false };
  }

  return { serve, parseRedditTarget };
}

// HTTP wiring shared by the relay route and offline tests. Requires a known
// caller Origin and GET; error bodies are static JSON (never upstream text).
export async function handleRedditRequest(req, res, feed, allowedOrigins) {
  const deny = (status, message, retryAfter) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter));
    res.writeHead(status);
    res.end(JSON.stringify(status === 429
      ? { error: message, retryAfter }
      : { error: message }));
  };
  if (!allowedOrigins.has(req.headers?.origin)) return deny(403, 'Forbidden origin.');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'GET') return deny(405, 'Method not allowed.');
  let target;
  try {
    target = new URL(req.url, 'http://local').searchParams.get('url');
  } catch {
    return deny(400, 'Invalid request.');
  }
  if (!target) return deny(400, 'Missing url parameter.');
  try {
    const result = await feed.serve(target);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Content-Length', String(result.bytes.length));
    res.writeHead(200);
    res.end(result.bytes);
  } catch (error) {
    const status = error instanceof FeedError ? error.status : 502;
    const message = error instanceof FeedError ? error.message : 'Reddit feed unavailable.';
    deny(status, message, status === 429 ? (error.retryAfter ?? COOLDOWN_DEFAULT_S) : undefined);
  }
}
