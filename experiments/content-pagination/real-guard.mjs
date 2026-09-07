export function guardedFetch({nativeFetch,active,fixtures,persist}){
 return async(url,options={})=>{
  const state=active();if(!state||state.stopped)throw new Error('Inactive scenario');
  const target=String(url),parsed=new URL(target);
  if(parsed.origin==='https://generativelanguage.googleapis.com'&&parsed.pathname.endsWith(':generateContent')){
   if(state.images>=4)throw new Error('Scenario image limit');
   const body=JSON.parse(options.body);
   if(!parsed.pathname.includes('/gemini-3.1-flash-image:')||body.generationConfig?.maxOutputTokens!==2048||body.generationConfig?.imageConfig?.imageSize!=='1K')throw new Error('Unexpected image request');
   state.images++;persist();return nativeFetch(url,{...options,redirect:'error'});
  }
  if(target==='https://api.openai.com/v1/responses'){
   if(state.clicks>=1)throw new Error('Scenario click limit');
   const body=JSON.parse(options.body);if(body.model!=='gpt-5.6-luna')throw new Error('Unexpected click model');
   state.clicks++;persist();return nativeFetch(url,{...options,body:JSON.stringify({...body,max_output_tokens:512}),signal:AbortSignal.timeout(90000),redirect:'error'});
  }
  if(Object.hasOwn(fixtures.responses,target)){
   if(state.sources>=4)throw new Error('Source request limit');
   state.sources++;persist();return Response.json(fixtures.responses[target]);
  }
  if(state.scenario==='tvmaze'&&(fixtures.allowedDetailUrls??[]).includes(target)){
   if(state.details>=1)throw new Error('Detail request limit');
   state.details=(state.details??0)+1;persist();return nativeFetch(url,{...options,signal:AbortSignal.timeout(15000),redirect:'error'});
  }
  if(parsed.protocol==='https:'&&fixtures.imageHosts.includes(parsed.hostname)){
   if(state.references>=24)throw new Error('Reference request limit');
   state.references++;persist();return nativeFetch(url,{...options,redirect:'error'});
  }
  throw new Error('URL outside fixture/reference allowlist');
 };
}
