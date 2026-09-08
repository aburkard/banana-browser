import { SessionStore, type ChatGPTSession } from './chatgpt-session'
import { startTiming } from './timing'

export const RELAY_URL = 'https://aburkard--banana-browser-relay-web.modal.run'
export const SOURCE_URL = 'https://github.com/aburkard/banana-browser/tree/main/experiments/encrypted-relay'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REDIRECT = 'http://localhost:1455/auth/callback'
type Curl = { load_wasm(url: string): Promise<void>; transport: string; set_websocket(url: string): void; fetch: typeof fetch; stdout: () => void; stderr: () => void; logger: () => void }
// The classic script exposes a global lexical binding, not a window property.
declare const libcurl: Curl
let transport: Promise<Curl> | undefined
let store: SessionStore | undefined
function sessions() {
  if (!navigator.locks) throw new Error('Use a current browser to connect ChatGPT.')
  return store ??= new SessionStore(localStorage, sessionStorage, work => navigator.locks.request('banana-chatgpt-refresh', work))
}
export function hasSubscription() { try { return !!sessions().read() } catch { return false } }
export function disconnectSubscription() { sessions().clear() }

async function curl() {
  if (!transport) transport = (async () => {
    if (typeof libcurl === 'undefined') await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      const timer = setTimeout(() => { script.remove(); reject(new Error('Connection timed out. Try again.')) }, 20_000)
      script.src = `${import.meta.env.BASE_URL}chatgpt/libcurl.js`
      script.onload = () => { clearTimeout(timer); resolve() }
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Could not load the connection. Try again.')) }
      document.head.append(script)
    })
    const client = libcurl
    client.stdout = client.stderr = client.logger = () => {}
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out. Reload and try again.')), 20_000)
      client.load_wasm(`${location.origin}${import.meta.env.BASE_URL}chatgpt/libcurl.wasm`)
        .then(resolve, reject).finally(() => clearTimeout(timer))
    })
    client.transport = 'wsproxy'
    client.set_websocket(`${RELAY_URL.replace('https:', 'wss:')}/tunnel/`)
    return client
  })().catch(error => { transport = undefined; throw error })
  return transport
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export interface BrowserLogin { verifier: string; state: string; url: string; expiresAt: number }
export async function startBrowserLogin(): Promise<BrowserLogin> {
  await curl()
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const query = new URLSearchParams({response_type:'code', client_id:CLIENT_ID, redirect_uri:REDIRECT,
    scope:'openid profile email offline_access', code_challenge:challenge, code_challenge_method:'S256', state,
    id_token_add_organizations:'true', codex_cli_simplified_flow:'true', originator:'banana_browser'})
  return {verifier, state, url:`https://auth.openai.com/oauth/authorize?${query}`, expiresAt:Date.now()+15*60_000}
}

function parseTokens(tokens: Record<string, unknown>, previous?: ChatGPTSession): ChatGPTSession {
  if (typeof tokens.access_token !== 'string') throw new Error('Sign-in failed. Try again.')
  const part = tokens.access_token.split('.')[1]
  let claims
  try { claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) } catch { throw new Error('Sign-in failed. Try again.') }
  const accountId = claims['https://api.openai.com/auth']?.chatgpt_account_id
  const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : previous?.refreshToken
  const expiresAt = claims.exp * 1000
  if (typeof accountId !== 'string' || !refreshToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Sign-in expired. Try again.')
  if (previous && accountId !== previous.accountId) throw new Error('Your ChatGPT account changed. Reconnect to continue.')
  return {accessToken:tokens.access_token, refreshToken, accountId, expiresAt}
}

async function tokenRequest(form: Record<string, string>, signal?: AbortSignal) {
  const client = await curl()
  const response = await client.fetch('https://auth.openai.com/oauth/token', {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({...form, client_id:CLIENT_ID}).toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)})
  if (!response.ok) {
    if ([400,401,403].includes(response.status)) throw new Error('Sign-in expired. Reconnect ChatGPT.')
    throw new Error('ChatGPT is unavailable. Try again shortly.')
  }
  return response.json()
}

export async function finishBrowserLogin(raw: string, pending: BrowserLogin, remember: boolean, signal: AbortSignal) {
  if (Date.now() >= pending.expiresAt) throw new Error('This sign-in expired. Start again.')
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('Paste the full address from the other tab.') }
  if (url.origin !== 'http://localhost:1455' || url.pathname !== '/auth/callback' || url.username || url.password || url.hash) throw new Error('Copy the address that starts with localhost:1455.')
  if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== pending.state) throw new Error('That address is from a different sign-in. Use the tab you just opened.')
  const code = url.searchParams.get('code')
  if (!code || code.length > 4096 || url.searchParams.getAll('code').length !== 1 || url.searchParams.has('error')) throw new Error('Sign-in failed. Start again.')
  const tokens = parseTokens(await tokenRequest({grant_type:'authorization_code', code, code_verifier:pending.verifier, redirect_uri:REDIRECT}, signal))
  signal.throwIfAborted()
  await sessions().save(tokens, remember, signal)
}

export async function deviceLogin(showCode: (code: string) => void, remember: boolean, signal: AbortSignal) {
  const client = await curl()
  async function request(path: string, body: unknown) {
    const response = await client.fetch(`https://auth.openai.com/api/accounts/deviceauth/${path}`, {method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)])})
    return {status:response.status, data:response.ok ? await response.json() : null}
  }
  const {data} = await request('usercode',{client_id:CLIENT_ID})
  if (!data?.device_auth_id || !(data.user_code || data.usercode)) throw new Error('Could not get a code. Try again.')
  showCode(data.user_code || data.usercode)
  const deadline = Date.now()+15*60_000
  while (Date.now()<deadline) {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled','AbortError')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort',abort); resolve() }, Math.max(5,Number(data.interval)||5)*1000)
      signal.addEventListener('abort',abort,{once:true})
      if (signal.aborted) abort()
    })
    const result = await request('token',{device_auth_id:data.device_auth_id,user_code:data.user_code||data.usercode})
    if ([403,404].includes(result.status)) continue
    if (!result.data?.authorization_code || !result.data.code_verifier) throw new Error('Code sign-in failed. Try again.')
    const tokens = parseTokens(await tokenRequest({grant_type:'authorization_code',code:result.data.authorization_code,
      code_verifier:result.data.code_verifier,redirect_uri:'https://auth.openai.com/deviceauth/callback'},signal))
    signal.throwIfAborted()
    await sessions().save(tokens,remember,signal)
    return
  }
  throw new Error('That code expired. Get a new one.')
}

export async function refreshSubscription(force = false) {
  return sessions().token(async previous => parseTokens(await tokenRequest({grant_type:'refresh_token',refresh_token:previous.refreshToken}),previous), force)
}

export interface SubscriptionRequest { kind:'image'|'click'; prompt:string; images:string[]; model?:string; effort?:string; size?:string; quality?:string }
export interface SubscriptionUsage {
  input_tokens?:number; output_tokens?:number; total_tokens?:number;
  input_tokens_details?: {text_tokens?:number;image_tokens?:number;cached_tokens?:number;cache_write_tokens?:number;cached_tokens_details?:{text_tokens?:number;image_tokens?:number}};
  output_tokens_details?: {text_tokens?:number;image_tokens?:number;reasoning_tokens?:number};
}
export interface SubscriptionResult { image?:string; text?:string; usage:SubscriptionUsage }

// Keep only numeric usage fields, never arbitrary upstream payloads.
function sanitizeUsage(raw: unknown): SubscriptionUsage {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const counts = (value: unknown, keys: string[]) => Object.fromEntries(keys.flatMap(key => {
    const item = record(value)[key];
    return typeof item === 'number' && Number.isFinite(item) && item >= 0 ? [[key,item]] : [];
  }));
  const value = record(raw);
  const totals = counts(value, ['input_tokens','output_tokens','total_tokens']);
  const input = counts(value.input_tokens_details, ['text_tokens','image_tokens','cached_tokens','cache_write_tokens']);
  const cached = counts(record(value.input_tokens_details).cached_tokens_details, ['text_tokens','image_tokens']);
  const output = counts(value.output_tokens_details, ['text_tokens','image_tokens','reasoning_tokens']);
  return {
    ...totals,
    ...(Object.keys(input).length || Object.keys(cached).length ? {input_tokens_details:{...input,...(Object.keys(cached).length ? {cached_tokens_details:cached} : {})}} : {}),
    ...(Object.keys(output).length ? {output_tokens_details:output} : {}),
  };
}
export async function subscriptionGenerate(request: SubscriptionRequest): Promise<SubscriptionResult> {
  const mark = startTiming(`ChatGPT ${request.kind}`)
  try {
    const imageRequest = request.kind === 'image'
    const model = request.model || (imageRequest ? 'gpt-image-2' : 'gpt-5.6-luna')
    if (imageRequest) {
      if (!['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(model)) throw new Error('Choose a supported ChatGPT image model.')
      const qualities = model === 'gpt-image-2' ? ['low','medium','high','auto'] : ['low','medium','high','xhigh','max','auto']
      if (!qualities.includes(request.quality || 'medium')) throw new Error('Choose a supported image quality for this model.')
      const size = request.size || '1536x1024'
      const dimensions = /^(\d{1,4})x(\d{1,4})$/.exec(size)
      const width = Number(dimensions?.[1]), height = Number(dimensions?.[2])
      if (size !== 'auto' && (!dimensions || width % 16 || height % 16 || width > 3840 || height > 3840 ||
          width * height < 655360 || width * height > 8294400 || width > height * 3 || height > width * 3)) throw new Error('Choose supported image dimensions.')
    } else if (!['gpt-5.6-luna','gpt-5.6-terra'].includes(model)) throw new Error('Choose a supported ChatGPT model.')
    const client = await curl()
    mark('Browser TLS ready')
    const auth = await refreshSubscription()
    mark('Authentication ready')
    if (request.images.length > 8 || request.images.some(image => !/^data:image\/(png|jpeg|webp);base64,/.test(image))) throw new Error('Use an image from this browser session.')
    // Codex's Images client calls these endpoints directly, without an LLM wrapper.
    // https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/images.rs
    const path = imageRequest ? (request.images.length ? 'images/edits' : 'images/generations') : 'responses'
    const body = imageRequest ? {
      model,prompt:request.prompt,size:request.size||'1536x1024',quality:request.quality||'medium',
      ...(request.images.length ? {images:request.images.map(image_url=>({image_url}))} : {}),
    } : {
      model,stream:true,store:false,instructions:'Follow the user request.',
      input:[{role:'user',content:[{type:'input_text',text:request.prompt},...request.images.map(image_url=>({type:'input_image',image_url}))]}],
      reasoning:{effort:request.effort||'low'},
    }
    const response = await client.fetch(`https://chatgpt.com/backend-api/codex/${path}`,{method:'POST',headers:{
      Authorization:`Bearer ${auth.accessToken}`,'ChatGPT-Account-Id':auth.accountId,'Content-Type':'application/json',Accept:imageRequest?'application/json':'text/event-stream'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(300_000)})
    mark('Response body started')
    if (!response.ok) {
      if (response.status === 401) { await refreshSubscription(true); throw new Error('ChatGPT reconnected. Try that again.') }
      if (response.status === 429) throw new Error('ChatGPT’s limit was reached. Try again later.')
      if (imageRequest && [400,403,404,422].includes(response.status)) throw new Error('ChatGPT rejected the selected image model or settings. They may not be available on your plan. No other model was used.')
      throw new Error('ChatGPT could not finish. Try again.')
    }
    const result = imageRequest ? await readImageResponse(response) : await readModelStream(response, mark)
    mark('Complete response read')
    return result
  } catch (error) { mark('Failed'); throw error }
}

export async function readImageResponse(response: Response): Promise<SubscriptionResult> {
  if (!response.body) throw new Error('ChatGPT returned no image. Try again.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    while (true) {
      const {value, done} = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > 64 * 1024 * 1024) throw new Error('That response was too large. Try a smaller image.')
      text += decoder.decode(value, {stream:true})
    }
    text += decoder.decode()
    const data = JSON.parse(text)
    const image = data?.data?.[0]?.b64_json
    const format = data?.output_format || 'png'
    if (typeof image !== 'string' || !image || !['png','jpeg','webp'].includes(format)) throw new Error('ChatGPT returned no image. Try again.')
    return {image:`data:image/${format};base64,${image}`,usage:sanitizeUsage(data.usage)}
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock() }
}

export async function readModelStream(response: Response, mark: (phase: string) => void = () => {}): Promise<SubscriptionResult> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = '', bytes = 0, firstEvent = true
  // The endpoint can put output items before an otherwise empty final response.
  const items: {type:string;status?:string;result?:string;content?:{type:string;text?:string}[]}[] = []
  let completed: {status:string;output?:typeof items;usage?:unknown} | undefined
  const consume = (raw: string) => {
    const data = raw.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')
    if (!data || data === '[DONE]') return
    const event = JSON.parse(data)
    if (firstEvent) { mark('First stream event'); firstEvent = false }
    if (event.type === 'response.image_generation_call.generating') mark('Image generation started')
    if (event.type === 'response.output_item.done' && event.item?.type === 'image_generation_call') mark('Image output received')
    if (event.type === 'response.completed') mark('Response completed event')
    if (['error','response.failed','response.incomplete'].includes(event.type)) throw new Error('ChatGPT could not finish. Try again.')
    if (event.type === 'response.output_item.done') items.push(event.item)
    if (event.type === 'response.completed') completed = event.response
  }
  try {
    while (true) {
      const {value,done} = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes>64*1024*1024) throw new Error('That response was too large. Try a smaller image.')
      buffer += decoder.decode(value,{stream:true})
      let split
      while ((split=/\r?\n\r?\n/.exec(buffer))) { consume(buffer.slice(0,split.index)); buffer=buffer.slice(split.index+split[0].length) }
    }
    buffer += decoder.decode()
    if (buffer.trim()) consume(buffer)
    if (completed?.status !== 'completed') throw new Error('The connection ended early. Try again.')
    const output = completed.output?.length ? completed.output : items
    const image = output.find(i=>i.type==='image_generation_call' && i.status==='completed')?.result
    const text = output.filter(i=>i.type==='message').flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text||'').join('')
    return {image:image ? `data:image/png;base64,${image}` : undefined,text,usage:sanitizeUsage(completed.usage)}
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock() }
}
