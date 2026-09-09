import {normalizeWebpage} from './webpage-source';
import {firecrawlRequest} from './firecrawl-client';
import {webpageAppearance} from './webpage-appearance';
export interface WebUsage {credits:number|null; cached:boolean}
let options = {siteReference:false, fresh:false};
export function setWebpageOptions(value: {siteReference:boolean;fresh:boolean}) { options = {...value}; }
export async function fetchWebpage(url:string, recordUsage:(usage:WebUsage)=>void) {
  const settings = {...options};
  const formats = ['markdown','links','images', ...(settings.siteReference ? ['screenshot','branding'] : [])];
  const result = await firecrawlRequest('scrape', {url, formats, onlyMainContent:false, timeout:30_000, maxAge:settings.fresh ? 0 : 3_600_000, parsers:[], proxy:'basic'}, recordUsage);
  const source = {...normalizeWebpage(result.data,url), ...(settings.siteReference ? webpageAppearance(result.data) : {})};
  // Homepages keep their full navigation/listing context rather than article passages.
  if (new URL(source.url).pathname === '/') {
    // Preserve field order so a large link index cannot displace the first page's text.
    return Object.fromEntries(Object.entries(source).map(([key,value]) => [key === 'story' ? 'content' : key,value]));
  }
  return source;
}
