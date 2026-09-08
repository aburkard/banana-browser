import type {WebUsage} from './webpage-fetch';
const BASE='https://aburkard--banana-browser-relay-web.modal.run';
export function searchAddress(query:string) {return `banana:search?q=${encodeURIComponent(query.trim())}`;}
export function mapAddress(url:string) {return `banana:map?url=${encodeURIComponent(new URL(url).origin+'/')}`;}
export function discoveryAddress(value:string): {kind:'search'|'map';input:string}|null {
  try {const u=new URL(value);if(u.protocol!=='banana:')return null;
    if(u.pathname==='search' && u.searchParams.get('q'))return {kind:'search',input:u.searchParams.get('q')!};
    if(u.pathname==='map' && u.searchParams.get('url'))return {kind:'map',input:u.searchParams.get('url')!};
  } catch { /* Ordinary input. */ }return null;
}
export function addressTarget(input:string):string {
 const text=input.trim();if(!text)return '';
 if(!/\s/.test(text) && /^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text))return `https://${text}`;
 if(/^(?:https?:|banana:|javascript:|data:|file:|ftp:)/i.test(text))return text;
 return searchAddress(text);
}
export function displayAddress(url:string) {const target=discoveryAddress(url);return target?target.input:url;}
export async function fetchDiscovery(kind:'search'|'map',input:string,record:(usage:WebUsage)=>void) {
 let result:any,response:Response;
 try {response=await fetch(`${BASE}/${kind}?${kind==='search'?'q':'url'}=${encodeURIComponent(input)}`,{credentials:'omit',signal:AbortSignal.timeout(25_000)});result=await response.json();}
 catch {record({credits:null,cached:false});throw new Error('Web discovery could not be reached.');}
 const credits=result?.usage?.credits;
 record({credits:typeof credits==='number' && Number.isFinite(credits) && credits>=0?credits:null,cached:result?.usage?.cached===true});
 if(!response.ok)throw new Error('Web discovery is temporarily unavailable.');
 const entries=kind==='search'?result?.data?.web:result?.data?.links;
 if(!Array.isArray(entries))throw new Error('Web discovery returned invalid results.');
 const seen=new Set<string>();
 const links=entries.slice(0,kind==='search'?10:25).flatMap((item:any)=>{
  try {const u=new URL(item.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||seen.has(u.href))return [];seen.add(u.href);
   return [{title:typeof item.title==='string'?item.title.slice(0,500):u.hostname,url:u.href,description:typeof item.description==='string'?item.description.slice(0,1000):''}];
  }catch{return [];}
 });
 return {source:kind==='search'?'Web Search':'Site Directory',title:kind==='search'?`Search: ${input}`:`Explore ${new URL(input).hostname}`,
  description:kind==='search'?'Search results. Follow a link to read its page.':'Discovered pages; contents have not yet been retrieved.',links};
}
