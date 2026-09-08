import {normalizeWebpage} from './webpage-source';
import {firecrawlRequest} from './firecrawl-client';
export interface WebUsage {credits:number|null; cached:boolean}
export async function fetchWebpage(url:string, recordUsage:(usage:WebUsage)=>void) {
  const result = await firecrawlRequest('scrape', {url, formats:['markdown','links','images'], onlyMainContent:false, timeout:30_000, maxAge:3_600_000, parsers:[], proxy:'basic'}, recordUsage);
  const source = normalizeWebpage(result.data,url);
  // Homepages keep their full navigation/listing context rather than article passages.
  if (new URL(source.url).pathname === '/') {
    const {story,...rest}=source;
    return {...rest,content:story};
  }
  return source;
}
