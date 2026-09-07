import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {readImageResponse}=await server.ssrLoadModule('/src/subscription.ts');
await server.close();

test('direct images preserve image-token counts and returned format',async()=>{
  const response=await readImageResponse(Response.json({data:[{b64_json:'aW1hZ2U='}],output_format:'jpeg',usage:{input_tokens:4510,output_tokens:1372}}));
  assert.equal(response.image,'data:image/jpeg;base64,aW1hZ2U=');
  assert.deepEqual(response.usage,{input_tokens:4510,output_tokens:1372});
});
test('missing images, malformed JSON, and unsupported formats never count as success',async()=>{
  for(const data of [null,{}, {data:[]},{data:[{b64_json:''}]},{data:[{b64_json:15}]},{data:[{b64_json:'image'}],output_format:'html'}])await assert.rejects(readImageResponse(Response.json(data)));
  await assert.rejects(readImageResponse(new Response('{')));
  await assert.rejects(readImageResponse(new Response(null)));
});
test('missing or invalid usage does not produce bogus token counts',async()=>{
  const result=await readImageResponse(Response.json({data:[{b64_json:'aW1hZ2U='}],usage:{input_tokens:-1,output_tokens:'100'}}));
  assert.deepEqual(result.usage,{});
});
test('direct image response remains bounded and cancels the stream on overflow',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(64*1024*1024+1));},cancel(){cancelled=true;}}));
  await assert.rejects(readImageResponse(response),/too large/);
  assert.equal(cancelled,true);
  assert.equal(response.body.locked,false);
});
