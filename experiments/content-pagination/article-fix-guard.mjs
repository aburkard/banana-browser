export function articleGuard({nativeFetch,state,persist,referenceHosts}){
 return async(url,options={})=>{
  if(state.stopped)throw new Error('Stopped');const parsed=new URL(String(url));
  if(parsed.origin==='https://generativelanguage.googleapis.com'&&parsed.pathname.endsWith('/gemini-3.1-flash-image:generateContent')){
   const config=JSON.parse(options.body).generationConfig;
   if(state.images>=2||config.maxOutputTokens!==2048||config.candidateCount!==1||config.imageConfig?.imageSize!=='1K')throw new Error('Image limit/config');
   state.images++;persist();return nativeFetch(url,{...options,redirect:'error'});
  }
  if(parsed.protocol==='https:'&&referenceHosts.includes(parsed.hostname)){
   if(state.references>=12)throw new Error('Reference limit');state.references++;persist();return nativeFetch(url,{...options,signal:AbortSignal.timeout(15000),redirect:'error'});
  }
  throw new Error('Request outside image/reference allowlist');
 };
}
