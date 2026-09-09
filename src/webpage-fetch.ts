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
  // Scrapes contain a whole page, including navigation, even at non-root URLs.
  // Keep that context together instead of applying the API story passage window.
  // Rename in place so the extracted link index cannot displace the page text.
  return Object.fromEntries(Object.entries(source).map(([key,value]) => [key === 'story' ? 'content' : key,value]));
}
