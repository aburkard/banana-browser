import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser,IMAGE_MODELS,CLICK_MODELS,estimateImageCost,defaultImageOptions}=await server.ssrLoadModule('/src/browser.ts');
await server.close();

const ref={dataUrl:'data:image/jpeg;base64,cmVm',mimeType:'image/jpeg',description:'photo'};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);
function browser(t,model='openrouter:bytedance-seed/seedream-5-0-flash'){t.mock.method(console,'log',()=>{});return new BananaBrowser(undefined,undefined,model,undefined,'or-test-key');}
function capture(t,reply){
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body),headers:new Headers(init.headers)});return reply();});
  return calls;
}

test('image requests send model controls, references then the previous page, and bill usage.cost',async t=>{
  const b=browser(t);b.sessionImage='data:image/png;base64,cHJldg==';
  const calls=capture(t,()=>Response.json({data:[{b64_json:'aW1n',media_type:'image/jpeg'}],usage:{prompt_tokens:12,completion_tokens:4096,cost:0.018}}));
  assert.equal(await b.generateWithOpenRouter('Make a page',[ref]),'data:image/jpeg;base64,aW1n');
  const [call]=calls;
  assert.equal(call.url,'https://openrouter.ai/api/v1/images');
  assert.equal(call.headers.get('authorization'),'Bearer or-test-key');assert.equal(call.init.credentials,'omit');
  assert.deepEqual(call.body,{model:'bytedance-seed/seedream-5-0-flash',prompt:'Make a page',n:1,resolution:'1K',aspect_ratio:'3:2',
    input_references:[{type:'image_url',image_url:{url:ref.dataUrl}},{type:'image_url',image_url:{url:b.sessionImage}}]});
  near(b.state.usage.estimatedCost,0.018);assert.equal(b.state.usage.costIncomplete,false);
  const line=b.state.usage.byModel['openrouter:bytedance-seed/seedream-5-0-flash'];
  near(line.reportedCost,0.018);assert.equal(line.inputTokens,12);assert.equal(line.outputTokens,4096);
});

test('missing cost is flagged unknown, and HTML errors keep the status',async t=>{
  const b=browser(t);
  capture(t,()=>Response.json({data:[{b64_json:'aW1n'}],usage:{prompt_tokens:1,completion_tokens:1}}));
  assert.equal(await b.generateWithOpenRouter('Page'),'data:image/png;base64,aW1n');
  assert.equal(b.state.usage.costIncomplete,true);
  t.mock.restoreAll();t.mock.method(console,'log',()=>{});
  capture(t,()=>new Response('<!DOCTYPE html><title>502</title>',{status:502,statusText:'Bad Gateway'}));
  await assert.rejects(b.generateWithOpenRouter('Page'),{message:'OpenRouter API error: 502 Bad Gateway'});
  assert.equal(b.state.usage.imageGenerations,2);
});

test('clicks use chat completions with the pointer image after stable source and the chosen effort',async t=>{
  const b=browser(t);
  b.setClickModel('openrouter:anthropic/claude-haiku-5.5');
  b.state.currentImage='data:image/png;base64,aW1hZ2U=';b.state.currentApiData={id:1,title:'Story',apiUrl:'https://example.com/story'};
  t.mock.method(b,'drawPointerOnImage',async()=>b.state.currentImage);t.mock.method(b,'logImage',()=>{});
  const navigate=t.mock.method(b,'navigate',async()=>{});
  const calls=capture(t,()=>Response.json({choices:[{message:{content:'{"action":"navigate","url":"https://example.com/story"}'}}],usage:{prompt_tokens:900,completion_tokens:20,cost:0.0001}}));
  await b.handleClick(10,20);
  assert.equal(b.state.error,null);assert.deepEqual(navigate.mock.calls[0].arguments,['https://example.com/story',false]);
  const [call]=calls;
  assert.equal(call.url,'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.body.model,'anthropic/claude-haiku-5.5');assert.deepEqual(call.body.reasoning,{effort:'low'});
  const parts=call.body.messages[0].content;
  assert.match(parts[0].text,/Story/);assert.doesNotMatch(parts[0].text,/coordinates \(/);
  assert.deepEqual(parts[1],{type:'image_url',image_url:{url:b.state.currentImage}});
  assert.match(parts[2].text,/\(10, 20\)/);
  near(b.state.usage.estimatedCost,0.0001);
});

test('an OpenRouter-only browser defaults clicks to GPT-6 Luna and refuses other providers',t=>{
  const b=browser(t,'openrouter:openai/gpt-image-2.5-flare');
  assert.equal(b.getClickModel(),'openrouter:openai/gpt-6-luna');
  assert.equal(b.getClickOptions().reasoningEffort,'low');
  b.setClickModel('gemini-3.8-flash');b.setModel('nano-banana-2.1');
  assert.equal(b.getClickModel(),'openrouter:openai/gpt-6-luna');
  assert.equal(b.currentModelKey,'openrouter:openai/gpt-image-2.5-flare');
});

test('every curated OpenRouter model has controls, a reference limit and a finite badge estimate',()=>{
  const images=Object.entries(IMAGE_MODELS).filter(([,spec])=>spec.provider==='openrouter');
  const clicks=Object.entries(CLICK_MODELS).filter(([,spec])=>spec.provider==='openrouter');
  assert.equal(images.length,7);assert.equal(clicks.length,6);
  for(const [key,spec] of images){
    assert.equal(spec.openRouter.params.aspect_ratio,'3:2',key);
    assert.ok(spec.maxInputImages>=3&&spec.maxInputImages<=6,key);
    const estimate=estimateImageCost(key,defaultImageOptions(key));
    assert.ok(estimate.total>0&&estimate.total<0.1,key);
  }
  for(const [key,spec] of clicks) assert.ok(spec.reasoningEfforts.includes(spec.defaultReasoningEffort),key);
});
