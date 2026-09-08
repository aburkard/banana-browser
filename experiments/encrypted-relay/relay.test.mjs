import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createRelay } from './relay.mjs';

const origin = 'https://banana.example';
async function setup(t, options = {}) {
  const tcp = net.createServer(socket => socket.pipe(socket));
  tcp.listen(0, '127.0.0.1');
  await once(tcp, 'listening');
  const relay = createRelay({ origins: [origin], connect: () => net.connect(tcp.address().port, '127.0.0.1'), ...options });
  relay.server.listen(0, '127.0.0.1');
  await once(relay.server, 'listening');
  t.after(async () => { await relay.close(); await new Promise(resolve => tcp.close(resolve)); });
  return { ...relay, url: `ws://127.0.0.1:${relay.server.address().port}` };
}
async function rejected(url, source) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, source ? { origin: source } : {});
    ws.on('error', () => {});
    ws.on('open', () => { ws.terminate(); reject(new Error('Unexpectedly accepted')); });
    ws.on('unexpected-response', (_, response) => { response.resume(); ws.terminate(); resolve(response.statusCode); });
  });
}

test('relay restricts destinations, origins, methods, and static files', async t => {
  const relay = await setup(t);
  for (const path of ['/tunnel/localhost:443', '/tunnel/chatgpt.com:80', '/tunnel/chatgpt.com:443?other=1']) {
    assert.equal(await rejected(relay.url + path, origin), 403);
  }
  for (const source of [undefined, 'null', 'https://evil.example', origin + '.evil.example']) {
    assert.equal(await rejected(relay.url + '/tunnel/chatgpt.com:443', source), 403);
  }
  const base = relay.url.replace('ws:', 'http:');
  const health = await fetch(base + '/health', { headers: { Origin: origin } });
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get('access-control-allow-origin'), origin);
  assert.equal((await fetch(base + '/health', { headers: { Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(base + '/health', { method: 'POST' })).status, 405);
  for (const path of ['/auth.json', '/node_modules/ws/package.json', '/constructor', '/__proto__']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal(relay.stats.connections, 0);
});

test('relay forwards bytes unchanged and enforces concurrent connection limit', async t => {
  const relay = await setup(t, { maxConnections: 1 });
  const ws = new WebSocket(relay.url + '/tunnel/chatgpt.com:443', { origin });
  await once(ws, 'open');
  const bytes = Buffer.from([22, 3, 1, 0, 128, 255]);
  ws.send(bytes);
  assert.deepEqual((await once(ws, 'message'))[0], bytes);
  assert.equal(await rejected(relay.url + '/tunnel/chatgpt.com:443', origin), 429);
  ws.close();
  await once(ws, 'close');
  assert.equal(relay.stats.tlsHandshakes, 1);
});

test('relay closes oversized transfers and expired connections', async t => {
  const relay = await setup(t, { maxBytes: 8, lifetimeMs: 100 });
  const ws = new WebSocket(relay.url + '/tunnel/chatgpt.com:443', { origin });
  await once(ws, 'open');
  ws.send(Buffer.alloc(9));
  await once(ws, 'close');
  assert.equal(relay.stats.clientBytes, 0);
  const idle = new WebSocket(relay.url + '/tunnel/chatgpt.com:443', { origin });
  await once(idle, 'open');
  await once(idle, 'close');
});
