import type {WebUsage} from './webpage-fetch';

let apiKey = '';
export function setFirecrawlKey(key: string) { apiKey = key.trim(); }

// Only this fixed provider origin ever receives the user's Firecrawl credential.
export async function firecrawlRequest(kind: 'scrape' | 'search' | 'map', body: object, record: (usage: WebUsage) => void) {
  if (!apiKey) throw new Error('Add your Firecrawl key in Settings to browse websites.');
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
    throw new Error(response.status === 401 ? 'Check your Firecrawl key in Settings.' : 'This webpage could not be loaded by Firecrawl.');
  }
  return result;
}
