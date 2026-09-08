import {normalizeWebpage} from './webpage-source';
export interface WebUsage {credits:number|null; cached:boolean}
const ENDPOINT='https://aburkard--banana-browser-relay-web.modal.run/web';
export async function fetchWebpage(url:string, recordUsage:(usage:WebUsage)=>void) {
  let response:Response;
  try {response=await fetch(`${ENDPOINT}?url=${encodeURIComponent(url)}`,{credentials:'omit',signal:AbortSignal.timeout(40_000)});}
  catch {recordUsage({credits:null,cached:false});throw new Error('Webpage could not be reached. Try again shortly.');}
  let result;
  try {result=await response.json();}
  catch {recordUsage({credits:null,cached:false});throw new Error('Webpage response was incomplete.');}
  const usage = result?.usage;
  recordUsage({credits:typeof usage?.credits==='number' && Number.isFinite(usage.credits) && usage.credits>=0 ? usage.credits : null,cached:usage?.cached===true});
  if (!response.ok || !result?.data) throw new Error(response.status===429?'Web browsing is busy. Try again shortly.':response.status===503?'Web browsing is temporarily unavailable.':'This webpage could not be loaded.');
  const source = normalizeWebpage(result.data,url);
  // Homepages keep their full navigation/listing context rather than article passages.
  if (new URL(source.url).pathname === '/') {
    const {story,...rest}=source;
    return {...rest,content:story};
  }
  return source;
}
