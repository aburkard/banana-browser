import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const LOGIN_HELP = 'Open Codex and sign in with ChatGPT (or run codex login), then retry. This experiment needs file-based Codex credentials.';
const MAX_BODY = 24 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024 * 1024;
const IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CLICK_MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra'];

export class SubscriptionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// Read afresh on every call so a login renewed by Codex is picked up immediately.
// Never copy, refresh, log, or modify Codex's shared credentials.
export async function readCodexAuth(authPath = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')) {
  let tokens;
  try {
    tokens = JSON.parse(await readFile(authPath, 'utf8')).tokens;
  } catch {
    throw new SubscriptionError(`No readable Codex login. ${LOGIN_HELP}`, 401);
  }
  if (!tokens?.access_token || !tokens?.account_id) {
    throw new SubscriptionError(`No ChatGPT subscription login found. ${LOGIN_HELP}`, 401);
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString());
  } catch {
    throw new SubscriptionError(`Invalid Codex login. ${LOGIN_HELP}`, 401);
  }
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() + 30_000) {
    throw new SubscriptionError(`Codex login has expired. ${LOGIN_HELP}`, 401);
  }
  return { accessToken: tokens.access_token, accountId: tokens.account_id };
}

export function buildRequest(body) {
  const invalid = () => { throw new SubscriptionError('Invalid subscription request.', 400); };
  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) invalid();
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > 5 || images.some(i => typeof i !== 'string' || !IMAGE_PATTERN.test(i))) invalid();
  const request = {
    model: body.kind === 'image' ? 'gpt-5.6-sol' : body.model,
    instructions: body.kind === 'image' ? 'You are an image generation assistant.' : 'Interpret the click in the supplied screenshot. Return only the requested JSON.',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: body.prompt },
      ...images.map(image_url => ({ type: 'input_image', image_url, detail: 'auto' })),
    ] }],
    stream: true,
    store: false,
  };
  if (body.kind === 'image') {
    const model = body.model ?? 'gpt-image-2';
    if (!['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(model)) invalid();
    const qualities = model === 'gpt-image-2' ? ['low', 'medium', 'high', 'auto'] : ['low', 'medium', 'high', 'xhigh', 'max', 'auto'];
    const dimensions = typeof body.size === 'string' && /^(\d{1,4})x(\d{1,4})$/.exec(body.size);
    const width = Number(dimensions?.[1]), height = Number(dimensions?.[2]);
    if (!qualities.includes(body.quality) || (body.size !== 'auto' && (!dimensions || width % 16 || height % 16 ||
        width > 3840 || height > 3840 || width * height < 655360 || width * height > 8294400 ||
        width > height * 3 || height > width * 3))) invalid();
    request.tools = [{ type: 'image_generation', model, size: body.size, quality: body.quality, output_format: 'png' }];
    request.tool_choice = { type: 'image_generation' };
  } else if (body.kind === 'click') {
    if (!CLICK_MODELS.includes(body.model) || images.length !== 1 || !['low', 'medium', 'high'].includes(body.effort)) invalid();
    request.reasoning = { effort: body.effort };
  } else invalid();
  return request;
}

// Parse SSE across arbitrary network chunk boundaries, including CRLF and
// multiline data fields. Only a completed response is considered success.
export async function readResponse(stream) {
  if (!stream) throw new SubscriptionError('Subscription returned an empty response.');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0, completed;
  const items = [];
  const consume = (event) => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    let value;
    try { value = JSON.parse(data); } catch { throw new SubscriptionError('Subscription returned an invalid event.'); }
    if (['error', 'response.failed', 'response.incomplete'].includes(value.type)) {
      throw new SubscriptionError('Subscription generation failed or was incomplete. Check your Codex plan limits and try again.');
    }
    if (value.type === 'response.output_item.done' && value.item) items.push(value.item);
    if (items.length > 128) throw new SubscriptionError('Subscription returned too many output items.');
    if (value.type === 'response.completed') completed = value.response;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE) throw new SubscriptionError('Subscription response exceeded the size limit.');
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!completed || completed.status !== 'completed') throw new SubscriptionError('Subscription stream ended before completion. No automatic retry was made.');
    return { ...completed, output: completed.output?.length ? completed.output : items };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function generate(body, { auth = readCodexAuth, fetchImpl = fetch, signal } = {}) {
  const request = buildRequest(body);
  const credentials = await auth();
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      'ChatGPT-Account-Id': credentials.accountId,
      'Content-Type': 'application/json', Accept: 'text/event-stream',
    },
    body: JSON.stringify(request),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) throw new SubscriptionError(`Codex login was rejected. ${LOGIN_HELP}`, 401);
    if (response.status === 429) throw new SubscriptionError('Your Codex plan is rate limited or out of usage. Check usage in Codex and retry after it resets.', 429);
    throw new SubscriptionError(`Subscription request rejected (HTTP ${response.status}). This model or feature may not be available on your plan.`, 502);
  }
  const result = await readResponse(response.body);
  // Return only output and numeric usage; never relay raw upstream errors or auth.
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const usage = { input_tokens: count(result.usage?.input_tokens), output_tokens: count(result.usage?.output_tokens) };
  if (body.kind === 'image') {
    const item = result.output.find(item => item.type === 'image_generation_call' && item.status === 'completed');
    if (typeof item?.result !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.result)) throw new SubscriptionError('Subscription completed without an image.');
    return { image: `data:image/png;base64,${item.result}`, usage };
  }
  const text = result.output.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('');
  if (!text) throw new SubscriptionError('Subscription completed without a click decision.');
  return { text, usage };
}

export function isLocalRequest(req, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  if (!hosts.includes(req.headers.host)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return req.method === 'GET' || (req.headers.origin === `http://${req.headers.host}` && req.headers['x-banana-client'] === 'subscription' && req.headers['content-type'] === 'application/json');
}

export function subscriptionPlugin() {
  return {
    name: 'banana-local-subscription',
    configResolved(config) {
      if (!['127.0.0.1', 'localhost', '::1'].includes(config.server.host)) throw new Error('Subscription mode must listen on localhost. Use npm run dev:subscription.');
    },
    configureServer(server) {
      const prefix = `${server.config.base}api/subscription/`;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(prefix)) return next();
        const send = (status, data) => {
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          res.end(JSON.stringify(data));
        };
        const port = server.httpServer?.address()?.port;
        if (!isLocalRequest(req, port)) return send(403, { error: 'Subscription access is restricted to this local app.' });
        const route = req.url.slice(prefix.length);
        if (route === 'status' && req.method === 'GET') {
          try { await readCodexAuth(); send(200, { available: true, connected: true }); }
          catch (error) { send(200, { available: true, connected: false, message: error.message }); }
          return;
        }
        if (route !== 'generate' || req.method !== 'POST') return send(404, { error: 'Unknown subscription endpoint.' });
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableEnded) abort.abort(); });
        try {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > MAX_BODY) throw new SubscriptionError('Subscription request exceeds 24 MB. Use fewer or smaller images.', 413);
            chunks.push(chunk);
          }
          let body;
          try { body = JSON.parse(Buffer.concat(chunks).toString()); }
          catch { throw new SubscriptionError('Invalid JSON request.', 400); }
          send(200, await generate(body, { signal: abort.signal }));
        } catch (error) {
          if (!res.destroyed) send(error instanceof SubscriptionError ? error.status : 502, {
            error: error instanceof SubscriptionError ? error.message : 'Could not complete the subscription request. Check your connection and Codex login. No automatic retry was made.',
          });
        }
      });
    },
  };
}
