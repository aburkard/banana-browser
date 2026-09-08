import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser,IMAGE_MODELS}=await server.ssrLoadModule('/src/browser.ts');
const {readImageStream}=await server.ssrLoadModule('/src/openai-image-stream.ts');
await server.close();
const models=['gpt-image-2.5-flare','gpt-image-2.5-sunburst'];
const qualities=['low','medium','high','xhigh','max'];
const formats=['png','jpeg','webp'];

test('both Image 2.5 models expose their full IDs, five qualities, formats and published usage rates',()=>{
 for(const model of models){
  assert.equal(IMAGE_MODELS[model].model,model);
  assert.deepEqual(IMAGE_MODELS[model].qualities,qualities);
  assert.deepEqual(IMAGE_MODELS[model].outputFormats,formats);
  assert.deepEqual(BananaBrowser.PRICING[model],{input:5/1e6,imageInput:8/1e6,cachedInput:1.25/1e6,cachedImageInput:2/1e6,imageOutput:30/1e6});
 }
});

test('Image 2.5 create requests preserve quality, encoding and streaming controls',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No live calls');});
 for(const model of models)for(const [index,quality] of qualities.entries())for(const format of formats){
  const browser=new BananaBrowser(undefined,'fake-key',model);
  browser.setImageOptions({quality,outputFormat:format,partialImages:index%4});
  t.mock.method(browser,'openAIImageRequest',async(url,request)=>{
   assert.equal(url,'https://api.openai.com/v1/images/generations');
   const body=JSON.parse(request.body);
   assert.equal(body.model,model);assert.equal(body.quality,quality);assert.equal(body.output_format,format);
   assert.equal(body.n,1);assert.equal(body.stream,true);assert.equal(body.moderation,'low');assert.equal(body.partial_images,index%4);
   assert.equal(body.output_compression,format==='png'?undefined:95);
   return {data:[{b64_json:'ZmluYWw='}]};
  });
  assert.equal(await browser.generateWithOpenAICreate('page'),`data:image/${format};base64,ZmluYWw=`);
 }
});

test('Image 2.5 edits retain references then the session pointer image and requested encoding',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No live calls');});
 for(const model of models)for(const format of formats){
  const browser=new BananaBrowser(undefined,'fake-key',model);
  browser.setImageOptions({quality:'max',outputFormat:format,partialImages:3});
  browser.sessionImage='data:image/png;base64,cG9pbnRlcg==';
  browser.sessionClickContext=true;
  t.mock.method(browser,'openAIImageRequest',async(url,request)=>{
   assert.equal(url,'https://api.openai.com/v1/images/edits');
   const body=request.body;
   assert.equal(body.get('model'),model);assert.equal(body.get('quality'),'max');assert.equal(body.get('output_format'),format);
   assert.equal(body.get('n'),'1');assert.equal(body.get('stream'),'true');assert.equal(body.get('moderation'),'low');assert.equal(body.get('partial_images'),'3');
   assert.equal(body.get('output_compression'),format==='png'?null:'95');
   const images=body.getAll('image[]');assert.equal(images.length,2);
   assert.equal(await images[0].text(),'reference');assert.equal(await images[1].text(),'pointer');
   return {data:[{b64_json:'ZmluYWw='}]};
  });
  const result=await browser.generateWithOpenAI('page',[{dataUrl:'data:image/png;base64,cmVmZXJlbmNl',mimeType:'image/png',description:'Site reference'}]);
  assert.equal(result,`data:image/${format};base64,ZmluYWw=`);
 }
});

test('Image 2.5 previews use requested MIME when event format is omitted',async()=>{
 for(const format of formats){
  const previews=[];
  const events=[{type:'image_edit.partial_image',b64_json:'cHJldmlldw==',partial_image_index:0},{type:'image_edit.completed',b64_json:'ZmluYWw='}];
  const response=new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''));
  const result=await readImageStream(response,(image,index)=>previews.push({image,index}),format);
  assert.deepEqual(previews,[{image:`data:image/${format};base64,cHJldmlldw==`,index:0}]);assert.equal(result.data[0].b64_json,'ZmluYWw=');
 }
});

test('plan generation forwards the selected full image model and retains session imagery',async t=>{
 t.mock.method(console,'log',()=>{});
 for(const model of ['gpt-image-2',...models]){
  let request;
  const browser=new BananaBrowser(undefined,undefined,'gpt-image-2',async value=>{request=value;return {image:'data:image/png;base64,ZmluYWw='};});
  browser.setModel(model);browser.sessionImage='data:image/png;base64,cG9pbnRlcg==';
  await browser.generateWithOpenAI('page');
  assert.equal(request.model,model);assert.deepEqual(request.images,['data:image/png;base64,cG9pbnRlcg==']);
 }
});
