// Reconstruct the image-first control even after production adopts stable-prefix caching.
export function clickVariants(request) {
  const baseline=structuredClone(request);
  const content=baseline.input[0].content;
  const image=content.find(part=>part.type==='input_image');
  const texts=content.filter(part=>part.type==='input_text').map(part=>part.text);
  const dynamic=texts.join('\n').match(/The user clicked at coordinates[^\n]+/)?.[0];
  if(!image||!dynamic)throw new Error('Unrecognized click request');
  let prompt=texts[0];
  if(!prompt.includes(dynamic)){
    const boundary=prompt.indexOf('\n\n');
    if(boundary<0)throw new Error('Unrecognized click prompt');
    prompt=prompt.slice(0,boundary+2)+dynamic+'\n\n'+prompt.slice(boundary+2);
  }
  baseline.input[0].content=[image,{type:'input_text',text:prompt}];
  delete baseline.prompt_cache_options;delete baseline.prompt_cache_key;
  const candidate=structuredClone(baseline);
  candidate.input[0].content=[{type:'input_text',text:prompt.replace(dynamic+'\n\n',''),prompt_cache_breakpoint:{mode:'explicit'}},image,{type:'input_text',text:dynamic}];
  candidate.prompt_cache_options={mode:'explicit'};
  candidate.prompt_cache_key='banana-click-ab-candidate-v1';
  return {baseline,candidate};
}
