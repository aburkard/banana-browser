import { BROWSER_REDIRECT, createBrowserLogin, validateReturnUrl } from './browser-oauth.mjs';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const button = document.querySelector('#login');
const browserButton = document.querySelector('#browser-login');
const browserAuthorization = document.querySelector('#browser-authorization');
const returnInput = document.querySelector('#return-url');
const returnButton = document.querySelector('#submit-return');
const cancelButton = document.querySelector('#cancel-browser-login');
let pendingBrowserLogin;
let relayBase;
const setBusy = busy => { button.disabled = busy; browserButton.disabled = busy; };
const report = value => { results.textContent += `${JSON.stringify(value, null, 2)}\n`; };

window.ready = libcurl.load_wasm(new URL('./libcurl.wasm', location.href).href).then(async () => {
  const config = await (await fetch('./relay-config.json')).json();
  relayBase = new URL(config.url || location.origin);
  if (relayBase.protocol !== 'https:' && !(relayBase.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(relayBase.hostname))) {
    throw new Error('The relay must use HTTPS.');
  }
  const health = await fetch(new URL('/health', relayBase), { signal: AbortSignal.timeout(20_000) });
  if (!health.ok || !(await health.json()).ok) throw new Error('Relay unavailable.');
  libcurl.transport = 'wsproxy';
  libcurl.set_websocket(`${relayBase.protocol === 'https:' ? 'wss:' : 'ws:'}//${relayBase.host}/tunnel/`);
  // Never enable verbose transport logs when handling credentials.
  libcurl.stdout = libcurl.stderr = libcurl.logger = () => {};
  clearTimeout(window.tlsStartupTimer);
  document.querySelector('#startup-help').hidden = true;
  status.textContent = 'Ready. The test makes one screenshot request and one low-quality image request using your plan.';
  setBusy(false);
}).catch(() => {
  window.showStartupError('Could not initialize browser TLS. Check the experiment server, then reload.');
});

async function authRequest(path, body) {
  const response = await libcurl.fetch(`https://auth.openai.com${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  // Raw auth responses never go to the console, relay, or page text.
  if (!response.ok) return { status: response.status };
  return { status: response.status, data: await response.json() };
}

async function startLogin() {
  const result = await authRequest('/api/accounts/deviceauth/usercode', { client_id: CLIENT_ID });
  if (!result.data?.device_auth_id || !(result.data.user_code || result.data.usercode)) throw new Error(`Could not start device login (HTTP ${result.status}).`);
  return result.data;
}

async function finishLogin(device) {
  const deadline = Date.now() + 15 * 60_000;
  const interval = Math.max(5, Number(device.interval) || 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, interval));
    const result = await authRequest('/api/accounts/deviceauth/token', {
      device_auth_id: device.device_auth_id, user_code: device.user_code || device.usercode,
    });
    if ([403, 404].includes(result.status)) continue;
    if (!result.data?.authorization_code || !result.data.code_verifier) throw new Error(`Device login failed (HTTP ${result.status}).`);
    return exchangeCode(result.data.authorization_code, result.data.code_verifier, 'https://auth.openai.com/deviceauth/callback');
  }
  throw new Error('Device sign-in expired. Start again.');
}

async function exchangeCode(code, verifier, redirectUri) {
    const response = await libcurl.fetch('https://auth.openai.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: CLIENT_ID,
        code, code_verifier: verifier, redirect_uri: redirectUri,
      }).toString(), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Token exchange failed (HTTP ${response.status}).`);
    const tokens = await response.json();
    const encoded = tokens.access_token?.split('.')[1];
    if (!encoded) throw new Error('Sign-in did not return an access token.');
    const claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    const accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id;
    if (!accountId) throw new Error('Sign-in did not return a ChatGPT account ID.');
    // Refresh/ID tokens aren't retained in this one-shot experiment.
    return { accessToken: tokens.access_token, accountId };
}

async function modelRequest(auth, body) {
  const response = await libcurl.fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST', headers: {
      Authorization: `Bearer ${auth.accessToken}`, 'ChatGPT-Account-Id': auth.accountId,
      'Content-Type': 'application/json', Accept: 'text/event-stream',
      'X-Banana-Probe': 'BANANA_TUNNEL_PROBE_2026',
    }, body: JSON.stringify({ ...body, stream: true, store: false }), signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0, completed;
  const items = [];
  const consume = raw => {
    const data = raw.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new Error('Generation failed or was incomplete.');
    if (event.type === 'response.output_item.done') items.push(event.item);
    if (event.type === 'response.completed') completed = event.response;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 64 * 1024 * 1024) throw new Error('Response exceeded the experiment’s size limit.');
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (completed?.status !== 'completed') throw new Error('Stream ended before completion.');
    return { output: completed.output?.length ? completed.output : items,
      usage: { input: completed.usage?.input_tokens, output: completed.usage?.output_tokens } };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function runExperiment(auth) {
  status.textContent = 'Testing screenshot interpretation…';
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 512, 256);
  ctx.font = '32px sans-serif'; ctx.fillStyle = 'black'; ctx.fillText('Banana Tunnel Test', 25, 50);
  ctx.fillStyle = 'blue'; ctx.fillText('Read story', 25, 120);
  const click = await modelRequest(auth, {
    model: 'gpt-5.6-luna', instructions: 'Read the screenshot and return JSON.', reasoning: { effort: 'low' },
    input: [{ role: 'user', content: [
      { type: 'input_text', text: 'What is the blue link label? Return only JSON with a label field.' },
      { type: 'input_image', image_url: canvas.toDataURL('image/png') },
    ] }],
  });
  const text = click.output.filter(i => i.type === 'message').flatMap(i => i.content || []).filter(p => p.type === 'output_text').map(p => p.text).join('');
  report({ test: 'Screenshot interpretation', text, usage: click.usage });
  if (JSON.parse(text).label !== 'Read story') throw new Error('Screenshot response did not identify the expected link.');
  status.textContent = 'Testing image generation…';
  const image = await modelRequest(auth, {
    model: 'gpt-5.6-sol', instructions: 'You are an image generation assistant.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Create a simple website screenshot with a white background. Title: Banana Tunnel Test. One blue link labeled Read story. No other content.' }] }],
    tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1536x1024', quality: 'low', output_format: 'png' }],
    tool_choice: { type: 'image_generation' },
  });
  const output = image.output.find(i => i.type === 'image_generation_call' && i.status === 'completed');
  if (!output?.result) throw new Error('Generation completed without an image.');
  const element = document.querySelector('#result-image');
  element.src = `data:image/png;base64,${output.result}`;
  element.hidden = false;
  await element.decode();
  const stats = await (await fetch(new URL('/stats', relayBase))).json();
  report({ test: 'Image generation', width: element.naturalWidth, height: element.naturalHeight, usage: image.usage });
  report({ relay: stats });
  status.textContent = 'Both model tests passed. This tab has no stored login.';
  return { click: text, imageWidth: element.naturalWidth, imageHeight: element.naturalHeight, stats };
}

button.addEventListener('click', async () => {
  setBusy(true);
  results.textContent = '';
  let auth;
  try {
    const device = await startLogin();
    document.querySelector('#code').textContent = device.user_code || device.usercode;
    document.querySelector('#authorization').hidden = false;
    status.textContent = 'Waiting for you to approve sign-in on OpenAI…';
    auth = await finishLogin(device);
    document.querySelector('#authorization').hidden = true;
    await runExperiment(auth);
  } catch (error) { status.textContent = error.message; }
  finally {
    if (auth) { auth.accessToken = ''; auth.accountId = ''; }
    document.querySelector('#authorization').hidden = true;
    document.querySelector('#code').textContent = '';
    setBusy(false);
  }
});

function clearBrowserLogin() {
  if (pendingBrowserLogin) { pendingBrowserLogin.verifier = ''; pendingBrowserLogin.state = ''; }
  pendingBrowserLogin = undefined;
  returnInput.value = '';
  document.querySelector('#open-browser-login').removeAttribute('href');
  browserAuthorization.hidden = true;
}

browserButton.addEventListener('click', async () => {
  setBusy(true);
  results.textContent = '';
  try {
    pendingBrowserLogin = await createBrowserLogin();
    document.querySelector('#open-browser-login').href = pendingBrowserLogin.url;
    returnButton.disabled = false;
    cancelButton.disabled = false;
    browserAuthorization.hidden = false;
    status.textContent = 'Open the sign-in link, then paste the return URL below. Keep this experiment tab open.';
  } catch {
    clearBrowserLogin(); setBusy(false);
    status.textContent = 'Could not prepare browser sign-in. Reload this page and try again.';
  }
});

cancelButton.addEventListener('click', () => {
  clearBrowserLogin(); setBusy(false);
  status.textContent = 'Browser sign-in canceled. You can close its OpenAI tab.';
});

document.querySelector('#return-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (returnButton.disabled) return;
  let code;
  try { code = validateReturnUrl(returnInput.value, pendingBrowserLogin); }
  catch (error) { status.textContent = error.message; return; }
  const verifier = pendingBrowserLogin.verifier;
  // Consume the attempt before exchanging: never retry an ambiguous token exchange.
  clearBrowserLogin();
  returnButton.disabled = true;
  cancelButton.disabled = true;
  let auth;
  try {
    status.textContent = 'Completing browser sign-in…';
    auth = await exchangeCode(code, verifier, BROWSER_REDIRECT);
    await runExperiment(auth);
  } catch (error) { status.textContent = `${error.message} Start a new sign-in to retry.`; }
  finally {
    if (auth) { auth.accessToken = ''; auth.accountId = ''; }
    setBusy(false);
  }
});

// Test runner supplies an existing login directly into isolated browser memory.
// No HTTP endpoint accepts or returns credentials.
window.experiment = { startLogin, finishLogin, runExperiment };
