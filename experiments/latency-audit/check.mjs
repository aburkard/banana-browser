// Offline safety checks only: all provider requests and image decoding are stubbed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/m, '');
for (const failAt of [Infinity, 2]) {
  const window = new Window({ url: 'http://localhost:5178/banana-browser/tmp/latency-audit/index.html' });
  window.document.body.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
  window.localStorage.setItem('openai_api_key', 'offline-placeholder');
  let calls = 0;
  const response = () => {
    calls++;
    if (calls === failAt) throw Error('Offline failure');
    return Response.json({ quality: 'medium', size: '1536x1024', output_format: 'png', data: [{ b64_json: 'stub' }], usage: { input_tokens: 10, output_tokens: 1372 } });
  };
  window.fetch = async () => response();
  let initialized = false;
  window.libcurl = {
    fetch: async () => { throw Error('Transport not initialized'); },
    set_websocket() { this.fetch = async () => response(); },
  };
  window.hasSubscription = () => true;
  window.subscriptionGenerate = async () => {
    // Match libcurl 0.7.1: first websocket setup overwrites the placeholder fetch.
    if (!initialized) { window.libcurl.set_websocket('offline'); initialized = true; }
    const result = await window.libcurl.fetch('https://chatgpt.com/backend-api/codex/images/generations');
    await result.json();
    return { image: 'data:image/png;base64,stub' };
  };
  Object.defineProperty(window.navigator, 'locks', { value: { request: async (_name, _options, work) => work({}) } });
  window.HTMLImageElement.prototype.decode = async function () {};
  Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', { get: () => 1536 });
  Object.defineProperty(window.HTMLImageElement.prototype, 'naturalHeight', { get: () => 1024 });
  window.eval(source);
  await window.document.querySelector('#run').onclick();
  const result = JSON.parse(window.document.querySelector('#result').textContent);
  assert.equal(calls, failAt === Infinity ? 6 : 2);
  assert.equal(result.status, failAt === Infinity ? 'complete' : 'stopped');
  assert.equal(result.rows.length, calls);
  if (failAt === Infinity) {
    assert.ok(result.rows.every(row => row.matchesRequestedOutput && row.status === 'complete'));
    for (const row of result.rows.filter(row => row.route === 'plan')) {
      assert.equal(row.providerRequests, 1);
      assert.equal(row.returned.quality, 'medium');
      assert.equal(row.usage.output_tokens, 1372);
      assert.ok(Number.isFinite(row.responseReadMs));
    }
  }
  await window.document.querySelector('#run').onclick();
  assert.equal(calls, failAt === Infinity ? 6 : 2, 'Persisted marker blocks another run');
  assert.ok(!JSON.stringify(result).includes('offline-placeholder'), 'Credential is not in result');
  await window.happyDOM.close();
}
console.log('Offline audit checks passed: six-call ceiling, stop on failure, repeat lock, sanitized results.');
