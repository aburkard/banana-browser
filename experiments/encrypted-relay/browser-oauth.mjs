export const BROWSER_REDIRECT = 'http://localhost:1455/auth/callback';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function createBrowserLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('https://auth.openai.com/oauth/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: BROWSER_REDIRECT,
    scope: 'openid profile email offline_access', code_challenge: challenge,
    code_challenge_method: 'S256', state, id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true', originator: 'banana_browser',
  }).toString();
  return { verifier, state, url: url.toString(), expiresAt: Date.now() + 15 * 60_000 };
}

export function validateReturnUrl(text, pending) {
  if (!pending || Date.now() >= pending.expiresAt) throw new Error('This sign-in expired. Start a new browser sign-in.');
  let url;
  try { url = new URL(text.trim()); } catch { throw new Error('Paste the full return URL from the address bar.'); }
  const expected = new URL(BROWSER_REDIRECT);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) {
    throw new Error('Expected the localhost:1455/auth/callback return URL from this sign-in.');
  }
  if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== pending.state) {
    throw new Error('This return URL belongs to a different sign-in. Use the tab opened for this attempt.');
  }
  if (url.searchParams.has('error')) throw new Error('OpenAI did not approve this sign-in. Cancel and start again when ready.');
  const code = url.searchParams.get('code');
  if (url.searchParams.getAll('code').length !== 1 || !code || code.length > 4096) throw new Error('The return URL has no valid authorization code.');
  return code;
}
