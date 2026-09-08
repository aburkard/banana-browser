import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequest, generate, isLocalRequest, readCodexAuth, readResponse } from '../server/subscription.mjs';

const image = 'data:image/png;base64,dGVzdA==';
const click = { kind: 'click', model: 'gpt-5.6-luna', effort: 'low', prompt: 'Interpret click', images: [image] };
const textItem = { type: 'message', content: [{ type: 'output_text', text: '{"action":"none","reason":"No link"}' }] };
const event = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
function stream(text, chunkSize = 13) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    controller.enqueue(bytes.slice(offset, offset += chunkSize));
  } });
}

test('builds direct subscription requests with inline images and fixed tools', () => {
  const request = buildRequest(click);
  assert.equal(request.input[0].content[1].image_url, image);
  assert.equal(request.store, false);
  assert.equal(request.stream, true);
  assert.equal(request.reasoning.effort, 'low');
  assert.equal(request.tools, undefined);
  const editing = buildRequest({ kind: 'image', prompt: 'Continue this page', images: [image, image], size: '1920x1280', quality: 'low', tools: [{ type: 'shell' }] });
  assert.equal(editing.model, 'gpt-5.6-sol');
  assert.equal(editing.tools.length, 1);
  assert.equal(editing.tools[0].type, 'image_generation');
  assert.equal(editing.tools[0].model, 'gpt-image-2');
  assert.equal(editing.input[0].content.length, 3);
});

test('rejects unapproved models, remote images, excessive image count and invalid settings', () => {
  for (const change of [
    { model: 'arbitrary-model' }, { kind: 'shell' }, { effort: 'invalid' },
    { images: [] }, { images: ['https://example.com/private.png'] },
    { images: Array(6).fill(image) }, { prompt: '' },
    { kind: 'image', size: 'unbounded', quality: 'low' },
  ]) assert.throws(() => buildRequest({ ...click, ...change }), /Invalid subscription request/);
});

test('subscription image tool forwards selected 2.5 variants, qualities and custom dimensions', () => {
  for (const model of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
    for (const quality of ['low', 'medium', 'high', 'xhigh', 'max', 'auto']) {
      const request = buildRequest({ kind: 'image', model, prompt: 'Page', images: [image], size: '1536x864', quality });
      assert.equal(request.tools[0].model, model);
      assert.equal(request.tools[0].quality, quality);
      assert.equal(request.tools[0].size, '1536x864');
      assert.equal(request.model, 'gpt-5.6-sol');
    }
  }
  for (const change of [{ model: 'unapproved' }, { model: 'gpt-image-2', quality: 'xhigh' },
    { size: '1000x1000' }, { size: '3840x3840' }, { size: '3840x512' }, { size: '16x16' }]) {
    assert.throws(() => buildRequest({ kind: 'image', model: 'gpt-image-2.5-flare', prompt: 'Page', images: [], size: '1536x864', quality: 'high', ...change }), /Invalid subscription request/);
  }
});

test('parses chunked CRLF SSE and uses done items when final output is empty', async () => {
  const response = await readResponse(stream(event({ type: 'response.output_item.done', item: textItem }) + event({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 12 } } }) + 'data: [DONE]\r\n\r\n', 1));
  assert.deepEqual(response.output, [textItem]);
  assert.equal(response.usage.input_tokens, 12);
});

test('prefers authoritative final output and rejects truncated or failed streams', async () => {
  const response = await readResponse(stream(event({ type: 'response.output_item.done', item: textItem }) + event({ type: 'response.completed', response: { status: 'completed', output: [{ ...textItem, id: 'final' }] } })));
  assert.equal(response.output[0].id, 'final');
  await assert.rejects(readResponse(stream(event({ type: 'response.output_item.done', item: textItem }))), /before completion/);
  await assert.rejects(readResponse(stream(event({ type: 'response.failed', response: { error: { message: 'SECRET' } } }))), /failed or was incomplete/);
});

test('normalizes output and usage without exposing credentials or raw responses', async () => {
  const result = await generate(click, {
    auth: async () => ({ accessToken: 'secret', accountId: 'account' }),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
      assert.equal(options.headers.Authorization, 'Bearer secret');
      return new Response(stream(event({ type: 'response.completed', response: {
        status: 'completed', output: [textItem], secret: 'hidden', usage: { input_tokens: 25, output_tokens: 5 },
      } })));
    },
  });
  assert.deepEqual(result, { text: textItem.content[0].text, usage: { input_tokens: 25, output_tokens: 5 } });
});

test('rate limits and rejected logins are actionable and never automatically retried', async () => {
  for (const [status, message] of [[401, /login was rejected/], [429, /rate limited/], [403, /not be available/]]) {
    let calls = 0;
    await assert.rejects(generate(click, {
      auth: async () => ({ accessToken: 'secret', accountId: 'account' }),
      fetchImpl: async () => { calls++; return new Response('SECRET', { status }); },
    }), message);
    assert.equal(calls, 1);
  }
});

test('local middleware blocks cross-origin, missing origin and DNS rebinding requests', () => {
  const headers = { host: '127.0.0.1:5178', origin: 'http://127.0.0.1:5178', 'x-banana-client': 'subscription', 'content-type': 'application/json' };
  assert.equal(isLocalRequest({ method: 'POST', headers }, 5178), true);
  for (const change of [{ origin: 'https://evil.example' }, { origin: undefined }, { host: 'evil.example:5178' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]) {
    assert.equal(isLocalRequest({ method: 'POST', headers: { ...headers, ...change } }, 5178), false);
  }
});

test('reads existing login without modifying it and reports expired or API-key-only auth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'banana-auth-test-'));
  const path = join(dir, 'auth.json');
  try {
    await writeFile(path, JSON.stringify({ OPENAI_API_KEY: 'fake' }));
    await assert.rejects(readCodexAuth(path), /No ChatGPT subscription login/);
    for (const exp of [1, Math.floor(Date.now() / 1000) + 3600]) {
      const access_token = `test.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.test`;
      await writeFile(path, JSON.stringify({ tokens: { access_token, account_id: 'test-account' } }));
      if (exp === 1) await assert.rejects(readCodexAuth(path), /expired/);
      else assert.deepEqual(await readCodexAuth(path), { accessToken: access_token, accountId: 'test-account' });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
