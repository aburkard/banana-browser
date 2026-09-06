import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BROWSER_REDIRECT, createBrowserLogin, validateReturnUrl } from '../experiments/encrypted-relay/browser-oauth.mjs';

test('browser login uses unique PKCE and state without leaking the verifier into the sign-in URL', async () => {
  const first = await createBrowserLogin();
  const second = await createBrowserLogin();
  const url = new URL(first.url);
  assert.equal(url.origin, 'https://auth.openai.com');
  assert.equal(url.searchParams.get('redirect_uri'), BROWSER_REDIRECT);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(first.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), first.state);
  assert.ok(!first.url.includes(first.verifier));
  assert.notEqual(first.verifier, second.verifier);
  assert.notEqual(first.state, second.state);
});

test('return URL accepts only this unexpired login and the exact callback', async () => {
  const pending = await createBrowserLogin();
  const url = `${BROWSER_REDIRECT}?code=test-code&state=${pending.state}`;
  assert.equal(validateReturnUrl(` ${url} `, pending), 'test-code');
  for (const bad of [
    'test-code', url.replace('localhost', 'evil.example'), url.replace('1455', '5189'),
    url.replace('/auth/callback', '/other'), url.replace(pending.state, 'other-state'),
    `${url}&code=duplicate`, `${url}&state=${pending.state}`, `${url}#fragment`,
    `${url}&error=access_denied`, url.replace('code=test-code', 'code='),
  ]) assert.throws(() => validateReturnUrl(bad, pending));
  assert.throws(() => validateReturnUrl(url, { ...pending, expiresAt: Date.now() - 1 }), /expired/);
  assert.throws(() => validateReturnUrl(url, undefined), /expired/);
});
