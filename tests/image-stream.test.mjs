import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:httpServer()}}});
const {readImageStream}=await server.ssrLoadModule('/src/openai-image-stream.ts');
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
await server.close();
const event=(type,b64_json='ZmluYWw=',extra={})=>`data: ${JSON.stringify({type,b64_json,...extra})}\r\n\r\n`;
function response(text, fragment=13) {
  const bytes=new TextEncoder().encode(text);let offset=0;
  return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length)return controller.close();controller.enqueue(bytes.slice(offset,offset+=fragment));}}),{headers:{'Content-Type':'text/event-stream'}});
}
for(const kind of ['image_generation','image_edit']) test(`${kind} fragmented preview and final retain final usage`,async()=>{
  const previews=[];const usage={input_tokens:10,output_tokens:1200};
  const result=await readImageStream(response(': ping\r\n\r\n'+event(kind+'.partial_image','cHJldmlldw==')+event(kind+'.completed',undefined,{usage})),x=>previews.push(x));
  assert.deepEqual(previews,['data:image/png;base64,cHJldmlldw==']);assert.deepEqual(result.usage,usage);assert.equal(result.data[0].b64_json,'ZmluYWw=');
});
test('early final cancels an open stream without waiting for partials or EOF',async()=>{
  let cancelled=false;
  const result=await readImageStream(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(event('image_generation.completed')));},cancel(){cancelled=true;}})),()=>assert.fail());
  assert.equal(result.data[0].b64_json,'ZmluYWw=');assert.equal(cancelled,true);
});
for(const [name,text,pattern] of [
  ['truncation',event('image_generation.partial_image'),/before the final/],
  ['malformed','data: {broken}\n\n',/JSON/],
  ['provider error','data: {"type":"error","message":"Failed"}\n\n',/Failed/],
]) test(name,async()=>assert.rejects(readImageStream(response(text),()=>{}),pattern));
test('public image stream previews never commit and each dispatch is counted once',async t=>{
  t.mock.method(console,'log',()=>{});
  const usage={input_tokens:10,output_tokens:1200,input_tokens_details:{text_tokens:10,image_tokens:0}};
  const snapshots=[];const browser=new BananaBrowser(undefined,'fake-key','gpt-image-2');
  // Use the same callback property as normal browser setup.
  browser.onStateChange=state=>snapshots.push({...state});
  browser.state.loading=true;browser.state.currentImage='old';
  t.mock.method(globalThis,'fetch',async()=>response(event('image_generation.partial_image')+event('image_generation.completed',undefined,{usage})));
  assert.equal(await browser.generateWithOpenAI('Page'),'data:image/png;base64,ZmluYWw=');
  assert.ok(snapshots.some(s=>s.previewImage));assert.ok(snapshots.every(s=>s.currentImage==='old'));
  assert.equal(browser.state.previewImage,null);assert.equal(browser.state.usage.imageGenerations,1);assert.equal(browser.state.usage.totalOutputTokens,1200);
  t.mock.method(globalThis,'fetch',async()=>response(event('image_generation.partial_image')));
  await assert.rejects(browser.generateWithOpenAI('Page'),/before the final/);
  assert.equal(browser.state.previewImage,null);assert.equal(browser.state.usage.imageGenerations,2);assert.equal(browser.state.usage.costIncomplete,true);
});

test('preview indices retain provider stages and fall back to event order',async()=>{
  const indices=[];
  await readImageStream(response(event('image_generation.partial_image',undefined,{partial_image_index:2})+event('image_generation.partial_image')+event('image_generation.completed')),(_image,index)=>indices.push(index));
  assert.deepEqual(indices,[2,1]);
});

test('new scroll views stream edit previews; cached scrolling makes no request',async t=>{
  t.mock.method(console,'log',()=>{});
  const browser=new BananaBrowser(undefined,'fake-key','gpt-image-2');
  browser.setImageOptions({partialImages:3});
  t.mock.method(browser,'fetchApiData',async()=>({title:'Scroll fixture'}));
  t.mock.method(browser,'generatePageImage',async()=>browser.generateWithOpenAI('Fixture page'));
  const requests=[],stages=[];
  browser.onStateChange=state=>{if(state.previewImage)stages.push([state.previewIndex,state.previewReceived,state.previewRequested]);};
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    requests.push({url,body:init.body});
    const kind=requests.length===1?'image_generation':'image_edit';
    const count=requests.length===1?3:1;
    return response(Array.from({length:count},(_,i)=>event(kind+'.partial_image',undefined,{partial_image_index:i})).join('')+event(kind+'.completed'));
  });
  await browser.navigate('https://example.com/a');
  assert.match(browser.state.status,/3\/3 previews received/);
  assert.ok(stages.some(stage=>JSON.stringify(stage)==='[2,3,3]'));
  stages.length=0;await browser.scrollDown();
  assert.match(requests[1].url,/images\/edits$/);assert.equal(requests[1].body.get('partial_images'),'3');
  assert.ok(stages.some(stage=>JSON.stringify(stage)==='[0,1,3]'));
  assert.match(browser.state.status,/1\/3 previews received/);
  assert.equal(browser.state.previewImage,null);
  await browser.scrollUp();await browser.scrollDown();
  assert.equal(requests.length,2);assert.doesNotMatch(browser.state.status,/previews received/);
});
