import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser} = await server.ssrLoadModule('/src/browser.ts');
const {readImageResponse,readModelStream} = await server.ssrLoadModule('/src/subscription.ts');
await server.close();

const usage = {
  input_tokens:1000,output_tokens:100,total_tokens:1100,
  input_tokens_details:{text_tokens:400,image_tokens:600,cached_tokens:200,cache_write_tokens:10,cached_tokens_details:{text_tokens:100,image_tokens:100},secret:'discard'},
  output_tokens_details:{reasoning_tokens:50,image_tokens:50,text_tokens:50,secret:'discard'},
  secret:'discard',
};
const safeUsage = {
  input_tokens:1000,output_tokens:100,total_tokens:1100,
  input_tokens_details:{text_tokens:400,image_tokens:600,cached_tokens:200,cache_write_tokens:10,cached_tokens_details:{text_tokens:100,image_tokens:100}},
  output_tokens_details:{reasoning_tokens:50,image_tokens:50,text_tokens:50},
};

test('subscription images and stream preserve only numeric cache and reasoning details',async()=>{
  const image = await readImageResponse(Response.json({data:[{b64_json:'aW1hZ2U='}],usage}));
  const stream = await readModelStream(new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[],usage}})}\n\n`));
  assert.deepEqual(image.usage,safeUsage);
  assert.deepEqual(stream.usage,safeUsage);
  const invalid = await readModelStream(new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:-10,output_tokens:'private',input_tokens_details:{cached_tokens:-3},output_tokens_details:{reasoning_tokens:'secret'}}}})}\n\n`));
  assert.deepEqual(invalid.usage,{input_tokens:0,output_tokens:0});
});

test('Gemini image accounting separates text, image and reasoning output prices',t=>{
  t.mock.method(console,'log',()=>{});
  const browser = new BananaBrowser('test','');
  browser.setModel('flash-lite');
  browser.trackUsage('image',{
    promptTokenCount:100,candidatesTokenCount:1200,thoughtsTokenCount:50,cachedContentTokenCount:0,
    candidatesTokensDetails:[{modality:'TEXT',tokenCount:80},{modality:'IMAGE',tokenCount:1120}],
  });
  const line = browser.state.usage.byModel['flash-lite'];
  const rates = BananaBrowser.PRICING['flash-lite'];
  assert.equal(line.outputTokens,1250);
  assert.equal(line.reasoningTokens,50);
  assert.equal(line.cachedTokens,0);
  assert.equal(line.costIncomplete,false);
  assert.ok(Math.abs(line.cost - (100*rates.input+130*rates.output+1120*rates.imageOutput))<1e-12);
});

test('missing image modalities yield a labeled partial estimate, not an invented image count',t=>{
  t.mock.method(console,'log',()=>{});
  const browser = new BananaBrowser('test','');
  browser.trackUsage('image',{promptTokenCount:100,candidatesTokenCount:1200});
  const line = Object.values(browser.state.usage.byModel)[0];
  assert.equal(line.costIncomplete,true);
  assert.equal(browser.state.usage.costIncomplete,true);
  assert.equal(line.reasoningTokens,undefined);
  assert.equal(line.cachedTokens,undefined);
  assert.equal(line.outputCost,0);
});

test('subscription retains reported usage while recording no API charge',t=>{
  t.mock.method(console,'log',()=>{});
  const browser = new BananaBrowser('', '', 'gpt-image-2', async()=>{throw new Error('No model calls');});
  browser.trackUsage('text',safeUsage);
  const line = Object.values(browser.state.usage.byModel)[0];
  assert.equal(line.inputTokens,1000);
  assert.equal(line.outputTokens,100);
  assert.equal(line.cachedTokens,200);
  assert.equal(line.reasoningTokens,50);
  assert.equal(line.cacheWriteTokens,10);
  assert.equal(line.cost,0);
  assert.equal(line.costIncomplete,false);
});
