import type {WebUsage} from './webpage-fetch';

const STORAGE_KEY = 'firecrawl_api_key';
let apiKey = '';
export function setFirecrawlKey(key: string) { apiKey = key.trim(); }
export function hasFirecrawlKey() { return !!apiKey; }

/** Saved beside the other API keys; a key from the old tab-only field is carried over once. */
export function loadFirecrawlKey(local: Storage = localStorage, session: Storage = sessionStorage) {
  const legacy = session.getItem(STORAGE_KEY)?.trim();
  if (legacy && !local.getItem(STORAGE_KEY)) local.setItem(STORAGE_KEY, legacy);
  session.removeItem(STORAGE_KEY);
  setFirecrawlKey(local.getItem(STORAGE_KEY) || '');
  return apiKey;
}

export function saveFirecrawlKey(key: string, local: Storage = localStorage) {
  setFirecrawlKey(key);
  if (apiKey) local.setItem(STORAGE_KEY, apiKey);
  else local.removeItem(STORAGE_KEY);
}

// Only this fixed provider origin ever receives the user's Firecrawl credential.
export async function firecrawlRequest(kind: 'scrape' | 'search' | 'map', body: object, record: (usage: WebUsage) => void) {
  if (!apiKey) throw new Error('Add a Firecrawl key in connection settings (▾ beside the address bar) to search the web or explore sites.');
  let response: Response;
  let result;
  try {
    response = await fetch(`https://api.firecrawl.dev/v2/${kind}`, {
      method: 'POST', credentials: 'omit', redirect: 'error',
      headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(40_000),
    });
    result = await response.json();
  } catch {
    record({credits: null, cached: false});
    throw new Error('Firecrawl could not be reached.');
  }
  const credits = [result?.metadata?.creditsUsed, result?.creditsUsed, result?.data?.metadata?.creditsUsed]
    .find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  record({credits: credits ?? null, cached: false});
  if (!response.ok || result?.success !== true) {
    throw new Error(response.status === 401 ? 'Check your Firecrawl key in connection settings.' : 'This webpage could not be loaded by Firecrawl.');
  }
  return result;
}
