import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
await server.close();

// Shape of the gateway page OpenAI returned during the 2026-10-15 bake-off.
const html='<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center>cloudflare</center></body></html>';
const htmlError=(statusText='Bad Gateway')=>new Response(html,{status:502,statusText,headers:{'content-type':'text/html'}});
const jsonError=()=>Response.json({error:{message:'Your request was rejected by the safety system.'}},{status:400,statusText:'Bad Request'});
const usage={input_tokens:100,output_tokens:20,input_tokens_details:{text_tokens:100,image_tokens:0,cached_tokens:0}};

function imageBrowser(t){t.mock.method(console,'log',()=>{});return new BananaBrowser(undefined,'fake-key','gpt-image-2');}
function clickBrowser(t){
  t.mock.method(console,'log',()=>{});
  const b=new BananaBrowser(undefined,'fake-key','gpt-image-2');b.setClickModel('gpt-6-luna');
  b.state.currentImage='data:image/png;base64,aW1hZ2U=';b.state.currentApiData={id:1,title:'Story'};
  t.mock.method(b,'drawPointerOnImage',async()=>b.state.currentImage);t.mock.method(b,'logImage',()=>{});
  return b;
}

for(const [name,response,message] of [
  ['HTML 502',()=>htmlError(),'OpenAI API error: 502 Bad Gateway'],
  ['HTML 502 without a reason phrase',()=>htmlError(''),'OpenAI API error: 502'],
  ['JSON error',jsonError,'Your request was rejected by the safety system.'],
]) {
  test(`image request ${name} reports a short message and counts one call`,async t=>{
    const b=imageBrowser(t);const request=t.mock.method(globalThis,'fetch',async()=>response());
    await assert.rejects(b.generateWithOpenAI('Page'),error=>{assert.equal(error.message,message);return true;});
    assert.equal(request.mock.callCount(),1);assert.equal(b.state.usage.imageGenerations,1);assert.equal(b.state.previewImage,null);
  });
  test(`click request ${name} shows a short error and counts one call`,async t=>{
    const b=clickBrowser(t);const request=t.mock.method(globalThis,'fetch',async()=>response());
    const navigate=t.mock.method(b,'navigate',async()=>{});
    await b.handleClick(1,2);
    assert.equal(b.state.error,message);assert.doesNotMatch(b.state.error,/</);
    assert.equal(request.mock.callCount(),1);assert.equal(navigate.mock.callCount(),0);
    assert.equal(b.state.usage.clickInterpretations,1);assert.equal(b.state.loading,false);
  });
}

test('successful image and click responses are unchanged',async t=>{
  const b=clickBrowser(t);
  t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{b64_json:'aW1hZ2U='}],usage}));
  assert.equal(await b.generateWithOpenAI('Page'),'data:image/png;base64,aW1hZ2U=');
  assert.equal(b.state.usage.imageGenerations,1);assert.equal(b.state.usage.totalInputTokens,100);
  t.mock.method(globalThis,'fetch',async()=>Response.json({output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'{"action":"navigate","url":"https://example.com/next"}'}]}],usage}));
  const navigate=t.mock.method(b,'navigate',async()=>{});
  await b.handleClick(1,2);
  assert.equal(b.state.error,null);assert.deepEqual(navigate.mock.calls[0].arguments,['https://example.com/next',false]);
  assert.equal(b.state.usage.clickInterpretations,1);assert.equal(b.state.usage.totalInputTokens,200);
});
