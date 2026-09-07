import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {normalizeUsage, estimateUsageCost} = await server.ssrLoadModule('/src/usage.ts');
await server.close();
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('Gemini mixed candidates and separate thoughts use the correct output rates', () => {
  const usage = normalizeUsage({promptTokenCount:100, candidatesTokenCount:1200, thoughtsTokenCount:50,
    cachedContentTokenCount:0, totalTokenCount:1350,
    promptTokensDetails:[{modality:'TEXT',tokenCount:80},{modality:'IMAGE',tokenCount:20}],
    candidatesTokensDetails:[{modality:'TEXT',tokenCount:80},{modality:'IMAGE',tokenCount:1120}],
  }, 'gemini');
  assert.equal(usage.outputTokens, 1250);
  assert.equal(usage.candidateTokens, 1200);
  assert.equal(usage.reasoningTokens, 50);
  assert.equal(usage.imageInputTokens, 20);
  const cost = estimateUsageCost(usage, {input:.25/1e6, output:1.5/1e6, imageOutput:30/1e6}, 'image');
  near(cost.cost, .000025 + .000195 + .0336);
  assert.equal(cost.complete, true);
});

test('missing counts differ from explicit zero and malformed values are unknown', () => {
  const absent = normalizeUsage(undefined, 'openai');
  assert.equal(absent.cachedTokens, undefined);
  const usage = normalizeUsage({input_tokens:0, output_tokens:-1, total_tokens:Infinity,
    input_tokens_details:{cached_tokens:0, cache_write_tokens:NaN, text_tokens:'12', image_tokens:null},
  }, 'openai');
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.cachedTokens, 0);
  for (const key of ['outputTokens','totalTokens','cacheWriteTokens','textInputTokens','imageInputTokens']) {
    assert.equal(usage[key], undefined);
  }
  assert.equal(estimateUsageCost(absent, {input:1, output:2}, 'text').complete, false);
});

test('OpenAI reasoning is already included in output; cache writes replace ordinary input pricing', () => {
  const usage = normalizeUsage({input_tokens:1000, output_tokens:200, total_tokens:1200,
    input_tokens_details:{cached_tokens:600, cache_write_tokens:200},
    output_tokens_details:{reasoning_tokens:150},
  }, 'openai');
  assert.equal(usage.reasoningTokens, 150);
  assert.equal(usage.cacheWriteTokens, 200);
  const result = estimateUsageCost(usage, {input:2/1e6, output:12/1e6, cachedInput:.2/1e6, cacheWriteInput:2.5/1e6}, 'text');
  near(result.inputCost, (200*2 + 600*.2 + 200*2.5)/1e6);
  near(result.outputCost, 200*12/1e6);
  assert.equal(result.complete, true);
});

test('OpenAI image text/image cache details do not charge cache reads twice', () => {
  const usage = normalizeUsage({input_tokens:300, output_tokens:100,
    input_tokens_details:{text_tokens:100, image_tokens:200, cached_tokens:150,
      cached_tokens_details:{text_tokens:50, image_tokens:100}},
  }, 'openai');
  assert.equal(usage.cachedTextTokens, 50);
  assert.equal(usage.cachedImageTokens, 100);
  const result = estimateUsageCost(usage, {input:5/1e6, imageInput:8/1e6, imageOutput:30/1e6,
    cachedInput:.5/1e6, cachedImageInput:.8/1e6}, 'image');
  near(result.inputCost, (50*5 + 100*8 + 50*.5 + 100*.8)/1e6);
  near(result.outputCost, .003);
  assert.equal(result.complete, true);
});

test('unknown modality and cache rates produce an incomplete estimate without invented discounts', () => {
  const usage = normalizeUsage({promptTokenCount:100, cachedContentTokenCount:60,
    candidatesTokenCount:1120, thoughtsTokenCount:0,
    candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120}],
  }, 'gemini');
  const result = estimateUsageCost(usage, {input:1, output:2, imageOutput:3}, 'image');
  assert.equal(usage.textOutputTokens, undefined);
  assert.equal(result.inputCost, 40);
  assert.equal(result.outputCost, 3360);
  assert.equal(result.complete, false);
});

test('Gemini text output includes thought charges once', () => {
  const usage = normalizeUsage({promptTokenCount:10, candidatesTokenCount:20, thoughtsTokenCount:30,
    cachedContentTokenCount:0}, 'gemini');
  assert.equal(estimateUsageCost(usage, {input:1, output:2}, 'text').outputCost, 100);
});

test('combined image cache counts cannot be assigned arbitrary modality rates', () => {
  const usage = normalizeUsage({input_tokens:300, output_tokens:10,
    input_tokens_details:{text_tokens:100, image_tokens:200, cached_tokens:50},
  }, 'openai');
  const result = estimateUsageCost(usage, {input:5, imageInput:8, imageOutput:30, cachedInput:.5}, 'image');
  assert.equal(result.inputCost, 0);
  assert.equal(result.outputCost, 300);
  assert.equal(result.complete, false);
});

test('inconsistent cache counts never create negative costs', () => {
  const usage = normalizeUsage({input_tokens:10, output_tokens:0,
    input_tokens_details:{cached_tokens:20, cache_write_tokens:5}}, 'openai');
  const result = estimateUsageCost(usage, {input:1, output:2, cachedInput:.1, cacheWriteInput:1.25}, 'text');
  assert.equal(result.inputCost, 0);
  assert.equal(result.complete, false);
});

test('missing image input details retain known output cost and incompleteness', () => {
  const usage = normalizeUsage({input_tokens:30, output_tokens:10}, 'openai');
  const result = estimateUsageCost(usage, {input:5, imageInput:8, imageOutput:30}, 'image');
  assert.equal(result.inputCost, 0);
  assert.equal(result.outputCost, 300);
  assert.equal(result.complete, false);
});

test('zero cached tokens require no cache price; malformed direct counts and prices cannot create negative costs', () => {
  const usage = normalizeUsage({input_tokens:30, output_tokens:10, input_tokens_details:{cached_tokens:0}}, 'openai');
  assert.equal(estimateUsageCost(usage, {input:1, output:2}, 'text').complete, true);
  const result = estimateUsageCost({...usage, outputTokens:-10}, {input:-1, output:2}, 'text');
  assert.equal(result.cost, 0);
  assert.equal(result.complete, false);
});

test('OpenAI image output prices text and image tokens separately when reported', () => {
  const usage = normalizeUsage({input_tokens:0, output_tokens:150,
    input_tokens_details:{cached_tokens:0},
    output_tokens_details:{text_tokens:50, image_tokens:100, reasoning_tokens:20}}, 'openai');
  const result = estimateUsageCost(usage, {input:5/1e6, output:10/1e6, imageOutput:32/1e6}, 'image');
  near(result.outputCost, .0005 + .0032);
  assert.equal(result.complete, true);
});

test('OpenAI image output retains known portions when modality counts or prices are incomplete', () => {
  for (const [details, total, expected] of [
    [{text_tokens:50, image_tokens:100}, 200, 3700],
    [{image_tokens:100}, 150, 3200],
    [{text_tokens:-1, image_tokens:'100'}, 150, 0],
  ]) {
    const usage = normalizeUsage({input_tokens:0, output_tokens:total,
      input_tokens_details:{cached_tokens:0}, output_tokens_details:details}, 'openai');
    const result = estimateUsageCost(usage, {input:5, output:10, imageOutput:32}, 'image');
    assert.equal(result.outputCost, expected);
    assert.equal(result.complete, false);
  }
  const usage = normalizeUsage({input_tokens:0, output_tokens:150,
    input_tokens_details:{cached_tokens:0},
    output_tokens_details:{text_tokens:50, image_tokens:100}}, 'openai');
  const result = estimateUsageCost(usage, {input:5, imageOutput:30}, 'image');
  assert.equal(result.outputCost, 3000);
  assert.equal(result.complete, false);
});

test('OpenAI legacy image output without modality details remains image-priced', () => {
  const usage = normalizeUsage({input_tokens:0, output_tokens:100,
    input_tokens_details:{cached_tokens:0}}, 'openai');
  const result = estimateUsageCost(usage, {input:5, output:10, imageOutput:32}, 'image');
  assert.equal(result.outputCost, 3200);
  assert.equal(result.complete, true);
});
