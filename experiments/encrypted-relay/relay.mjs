import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import {createWebScraper, handleWebRequest} from './web-scrape.mjs';
import { createRedditFeed, handleRedditRequest } from './reddit-feed.mjs';

const MiB = 1024 * 1024;
const localOrigins = ['http://127.0.0.1:5189', 'http://127.0.0.1:5178'];
// The two public diagnostic hosts let clients verify TLS without loading auth.
const hosts = new Set(['chatgpt.com', 'auth.openai.com', 'example.com', 'expired.badssl.com']);
const paths = {
  '/': ['index.html', 'text/html'], '/experiment.js': ['experiment.js', 'text/javascript'],
  '/browser-oauth.mjs': ['browser-oauth.mjs', 'text/javascript'],
  '/relay-config.json': ['relay-config.json', 'application/json'],
  '/libcurl.js': ['node_modules/libcurl.js/libcurl.js', 'text/javascript'],
  '/libcurl.wasm': ['node_modules/libcurl.js/libcurl.wasm', 'application/wasm'],
  '/LICENSE': ['LICENSE', 'text/plain'],
  '/libcurl-LICENSE': ['node_modules/libcurl.js/LICENSE', 'text/plain'],
  '/source/relay.mjs': ['relay.mjs', 'text/plain'],
  '/source/web-scrape.mjs': ['web-scrape.mjs', 'text/plain'],
  '/source/reddit-feed.mjs': ['reddit-feed.mjs', 'text/plain'],
  '/source/modal_app.py': ['modal_app.py', 'text/plain'],
  '/source/package.json': ['package.json', 'text/plain'],
  '/source/package-lock.json': ['package-lock.json', 'text/plain'],
  '/source/README.md': ['README.md', 'text/plain'],
};

export function createRelay({
  origins = localOrigins, connect = host => net.connect(443, host),
  maxConnections = 32, maxBytes = 64 * MiB, lifetimeMs = 300_000,
  redditFetch, redditNow, webFetch, webNow, firecrawlKey = process.env.FIRECRAWL_API_KEY,
} = {}) {
  const allowedOrigins = new Set(origins);
  const webScrape = createWebScraper({apiKey:firecrawlKey,fetchImpl:webFetch,now:webNow});
  const stats = { connections: 0, active: 0, tlsHandshakes: 0, clientBytes: 0, serverBytes: 0, plaintextMarkerSeen: false, redditUpstream: 0, redditCacheHits: 0, redditCooldowns: 0 };
  // Bounded read-only Reddit RSS gateway. Separate from the encrypted tunnel:
  // fixed upstream host, no user credentials, strict rate and cache budgets.
  const redditFeed = createRedditFeed({ fetchImpl: redditFetch, now: redditNow, stats });
  // Global upgrade budget bounds connection churn as well as concurrent sockets.
  let starts = 0, windowStart = Date.now();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (allowedOrigins.has(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
    }
    let pathname = '';
    try { pathname = new URL(req.url, 'http://local').pathname; } catch { /* unknown target falls through to 404 */ }
    if (pathname === '/web') {
      await handleWebRequest(req, res, webScrape, allowedOrigins);
      return;
    }
    if (pathname === '/reddit') {
      await handleRedditRequest(req, res, redditFeed, allowedOrigins);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (req.url === '/health' || req.url === '/stats') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(req.url === '/stats' ? stats : { ok: true }));
    }
    const item = Object.hasOwn(paths, req.url) ? paths[req.url] : undefined;
    if (!item) { res.writeHead(404); return res.end(); }
    try {
      const data = await readFile(new URL(item[0], import.meta.url));
      res.setHeader('Content-Type', item[1]);
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(500); res.end(); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MiB, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const reject = code => { socket.end(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    const host = /^\/tunnel\/([^/:]+):443$/.exec(req.url)?.[1];
    if (!hosts.has(host) || !allowedOrigins.has(req.headers.origin)) return reject('403 Forbidden');
    if (Date.now() - windowStart >= 60_000) { starts = 0; windowStart = Date.now(); }
    if (stats.active >= maxConnections || starts >= 120) return reject('429 Too Many Requests');
    starts++;
    wss.handleUpgrade(req, socket, head, ws => {
      stats.connections++; stats.active++;
      const remote = connect(host);
      const deadline = setTimeout(() => ws.terminate(), lifetimeMs);
      // Direct image requests can be silent until completion. The absolute
      // connection deadline above bounds both idle and active requests.
      let first = true, tail = Buffer.alloc(0), transferred = 0;
      const withinBudget = length => {
        transferred += length;
        if (transferred > maxBytes) { ws.terminate(); return false; }
        return true;
      };
      ws.on('message', (data, isBinary) => {
        if (!isBinary || !withinBudget(data.length)) return ws.terminate();
        const bytes = Buffer.from(data);
        stats.clientBytes += bytes.length;
        if (first && bytes[0] === 22 && bytes[1] === 3) stats.tlsHandshakes++;
        first = false;
        const scan = Buffer.concat([tail, bytes]);
        if (scan.includes(Buffer.from('Authorization:')) || scan.includes(Buffer.from('BANANA_TUNNEL_PROBE_2026'))) stats.plaintextMarkerSeen = true;
        tail = scan.subarray(-256);
        if (!remote.write(bytes)) ws.pause();
        if (remote.writableLength > 2 * MiB) ws.terminate();
      });
      remote.on('drain', () => ws.resume());
      remote.on('data', data => {
        if (!withinBudget(data.length) || ws.readyState !== 1) return;
        stats.serverBytes += data.length;
        remote.pause();
        ws.send(data, error => error ? ws.terminate() : remote.resume());
      });
      remote.on('error', () => ws.terminate());
      remote.on('close', () => ws.close());
      ws.on('error', () => remote.destroy());
      ws.on('close', () => { clearTimeout(deadline); remote.destroy(); stats.active--; });
    });
  });
  server.on('close', () => wss.close());
  return { server, stats, close: () => {
    for (const ws of wss.clients) ws.terminate();
    return new Promise(resolve => server.close(resolve));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origins = process.env.BANANA_ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || localOrigins;
  const relay = createRelay({ origins });
  relay.server.listen(Number(process.env.PORT || 5189), process.env.BIND_HOST || '127.0.0.1', () => {
    console.log('Encrypted relay ready; no credential access or payload logging.');
  });
  process.on('SIGTERM', () => relay.close());
  process.on('SIGINT', () => relay.close());
}
