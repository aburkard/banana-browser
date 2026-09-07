import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { test } from 'node:test';
import { createServer } from 'vite';

// Use the app's existing TypeScript transform without adding a test dependency.
// Attach HMR to an unbound server so tests never open a network port.
const server = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, hmr: { server: createHttpServer() } },
});
const { BananaBrowser, IMAGE_MODELS, defaultImageOptions, estimateImageCost } =
  await server.ssrLoadModule('/src/browser.ts');
await server.close();

const image = 'data:image/png;base64,dGVzdA==';
const target = 'https://hacker-news.firebaseio.com/v0/item/123.json';

const cases = [
  ['gemini-3-flash-lite', 'gemini-3.1-flash-lite', 'minimal', 0.0004],
  ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite', 'minimal', 0.00055],
  ['gemini-3.8-flash', 'gemini-3.8-flash', 'low', 0.001125],
  ['gpt-5.6-luna', 'gpt-5.6-luna', 'low', 0.00032],
  ['gpt-5.6-terra', 'gpt-5.6-terra', 'low', 0.0032],
];

for (const [key, model, effort, cost] of cases) {
  test(`${model}: screenshot request, navigation and spend accounting`, async (t) => {
    t.mock.method(console, 'log', () => {});
    t.mock.method(Date, 'now', () => Date.UTC(2026, 8, 5));
    let request;
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const req = new Request(input, init);
      request = { url: req.url, body: await req.json() };
      const result = JSON.stringify({ action: 'navigate', url: target });
      return Response.json(model.startsWith('gemini') ? {
        candidates: [{ content: { role: 'model', parts: [{ text: result }] } }],
        usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 },
      } : {
        output: [
          { type: 'reasoning', summary: [] },
          { type: 'message', content: [{ type: 'output_text', text: result }] },
        ],
        usage: { input_tokens: 1000, output_tokens: 100 },
      });
    });
    const browser = new BananaBrowser('test-gemini', 'test-openai');
    browser.state.currentImage = image;
    browser.state.currentApiData = { id: 123, title: 'A test story' };
    // Canvas rendering is covered by the browser smoke check.
    t.mock.method(browser, 'drawPointerOnImage', async () => image);
    t.mock.method(browser, 'logImage', () => {});
    const navigation = t.mock.method(browser, 'navigate', async () => {});
    browser.setClickModel(key);
    await browser.handleClick(100, 200);

    assert.equal(browser.state.error, null);
    assert.equal(navigation.mock.callCount(), 1);
    assert.deepEqual(navigation.mock.calls[0].arguments, [target, false]);
    assert.equal(browser.sessionImage, image);
    if (model.startsWith('gemini')) {
      assert.equal(request.url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
      assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, effort);
      assert.equal(request.body.contents[0].parts[0].inlineData.data, 'dGVzdA==');
    } else {
      assert.equal(request.url, 'https://api.openai.com/v1/responses');
      assert.equal(request.body.model, model);
      assert.equal(request.body.reasoning.effort, effort);
      assert.equal(request.body.input[0].content.find(part => part.type === 'input_image').image_url, image);
      assert.equal(request.body.prompt_cache_options?.mode, key.startsWith('gpt-5.6-') ? 'explicit' : undefined);
      assert.equal(request.body.input[0].content[0].type,'input_text');
      assert.ok(!request.body.input[0].content[0].text.includes('The user clicked at coordinates'));
      assert.match(request.body.input[0].content[2].text,/The user clicked at coordinates/);
    }
    assert.equal(browser.state.usage.byModel[key].calls, 1);
    assert.ok(Math.abs(browser.state.usage.estimatedCost - cost) < 1e-12);
  });
}

test('Gemini 3.8 promotion expires at the cutoff without repricing earlier calls', (t) => {
  t.mock.method(console, 'log', () => {});
  let now = Date.UTC(2027, 0, 1) - 1;
  t.mock.method(Date, 'now', () => now);
  const browser = new BananaBrowser('test-gemini');
  browser.setClickModel('gemini-3.8-flash');
  const usage = { promptTokenCount: 1000, candidatesTokenCount: 100 };
  browser.trackUsage('text', usage);
  assert.ok(Math.abs(browser.state.usage.estimatedCost - 0.001125) < 1e-12);
  now += 1;
  browser.trackUsage('text', usage);
  assert.ok(Math.abs(browser.state.usage.estimatedCost - 0.003375) < 1e-12);
  assert.equal(browser.state.usage.byModel['gemini-3.8-flash'].calls, 2);
});

test('remaining image choices all produce finite cost estimates', () => {
  assert.equal(IMAGE_MODELS.flash, undefined);
  for (const [key, spec] of Object.entries(IMAGE_MODELS)) {
    for (const size of spec.sizes) {
      const estimate = estimateImageCost(key, { ...defaultImageOptions(key), size: size.value });
      assert.ok(Number.isFinite(estimate?.total) && estimate.total > 0, `${key} ${size.value}`);
    }
  }
});

test('ChatGPT connection generates images and interprets clicks without API keys or API prices', async t => {
  t.mock.method(console, 'log', () => {});
  const requests = [];
  const browser = new BananaBrowser(undefined, undefined, 'gpt-image-2', async request => {
    requests.push(request);
    return request.kind === 'image'
      ? {image,usage:{input_tokens:1000,output_tokens:100}}
      : {text:JSON.stringify({action:'navigate',url:target}),usage:{input_tokens:186,output_tokens:10}};
  });
  assert.equal(browser.getClickModel(),'gpt-5.6-luna');
  browser.setModel('pro');
  browser.setClickModel('gemini-3.8-flash');
  assert.equal(browser.getClickModel(),'gpt-5.6-luna');
  assert.equal(await browser.generateWithOpenAI('Make a page',[]),image);
  browser.state.currentImage = image;
  browser.state.currentApiData = {id:123,title:'Test story'};
  t.mock.method(browser,'drawPointerOnImage',async()=>image);
  t.mock.method(browser,'logImage',()=>{});
  const navigation = t.mock.method(browser,'navigate',async()=>{});
  await browser.handleClick(100,200);
  assert.equal(browser.state.error,null);
  assert.equal(navigation.mock.callCount(),1);
  assert.deepEqual(requests.map(r=>r.kind),['image','click']);
  assert.deepEqual(requests[1].images,[image]);
  assert.equal(requests[1].model,'gpt-5.6-luna');
  assert.equal(browser.state.usage.estimatedCost,0);
  assert.equal(browser.state.usage.totalInputTokens,1186);
});

test('Luna API clicks keep stable source before the cache boundary and pointer/coordinates after it',async t=>{
  t.mock.method(console,'log',()=>{});
  const bodies=[];
  t.mock.method(globalThis,'fetch',async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({output:[{type:'message',content:[{type:'output_text',text:'{"action":"none"}'}]}]});});
  const browser=new BananaBrowser('', 'fake');browser.setClickModel('gpt-5.6-luna');
  browser.state.currentImage=image;browser.state.currentApiData={id:123,title:'Test story'};
  t.mock.method(browser,'drawPointerOnImage',async(_image,x)=>`data:image/png;base64,${x}`);
  t.mock.method(browser,'logImage',()=>{});
  await browser.handleClick(100,200);await browser.handleClick(400,200);
  const [a,b]=bodies.map(body=>body.input[0].content);
  assert.equal(a[0].text,b[0].text);
  assert.deepEqual(a[0].prompt_cache_breakpoint,{mode:'explicit'});
  assert.match(a[0].text,/Test story/);
  assert.doesNotMatch(a[0].text,/coordinates \(/);
  assert.equal(a[1].image_url,'data:image/png;base64,100');
  assert.equal(b[1].image_url,'data:image/png;base64,400');
  assert.match(a[2].text,/\(100, 200\)/);assert.match(b[2].text,/\(400, 200\)/);
  assert.equal(bodies[0].reasoning.effort,'low');
});

test('Luna usage prices reported cache reads and writes, including first-write premium',t=>{
  t.mock.method(console,'log',()=>{});
  const browser=new BananaBrowser('', 'fake');browser.setClickModel('gpt-5.6-luna');
  browser.trackUsage('text',{input_tokens:2398,output_tokens:22,input_tokens_details:{cached_tokens:1443,cache_write_tokens:0}});
  assert.ok(Math.abs(browser.state.usage.estimatedCost-.00024626)<1e-12);
  assert.equal(browser.state.usage.costIncomplete,false);
  browser.trackUsage('text',{input_tokens:2398,output_tokens:22,input_tokens_details:{cached_tokens:0,cache_write_tokens:1443}});
  assert.ok(Math.abs(browser.state.usage.estimatedCost-(.00024626+.00057815))<1e-12);
});

test('a second click while interpretation is pending cannot trigger another paid request',async t=>{
  t.mock.method(console,'log',()=>{});
  const browser=new BananaBrowser('', 'fake');browser.state.currentImage=image;browser.state.currentApiData={title:'Test'};
  let release;
  const interpret=t.mock.method(browser,'interpretClick',()=>new Promise(resolve=>{release=resolve}));
  const pending=browser.handleClick(100,200);await browser.handleClick(400,200);
  assert.equal(interpret.mock.callCount(),1);
  release({action:'none'});await pending;assert.equal(browser.state.loading,false);
});

for (const partialImages of [0,1,2,3]) test(`OpenAI image creation and edits request low moderation and ${partialImages} previews`,async t=>{
  t.mock.method(console,'log',()=>{});
  const requests=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    requests.push({url,body:init.body instanceof FormData ? init.body : JSON.parse(init.body)});
    return Response.json({data:[{b64_json:'dGVzdA=='}]});
  });
  const browser=new BananaBrowser(undefined,'fake-key','gpt-image-2');
  if (partialImages) browser.setImageOptions({partialImages});
  await browser.generateWithOpenAI('A page');
  browser.sessionImage=image;
  await browser.generateWithOpenAI('Continue the page');
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,'https://api.openai.com/v1/images/generations');
  assert.equal(requests[0].body.moderation,'low');
  assert.equal(requests[0].body.stream,true);
  assert.equal(requests[0].body.partial_images,partialImages);
  assert.equal(requests[1].url,'https://api.openai.com/v1/images/edits');
  assert.equal(requests[1].body.get('moderation'),'low');
  assert.equal(requests[1].body.get('stream'),'true');
  assert.equal(requests[1].body.get('partial_images'),String(partialImages));
  assert.equal(requests[1].body.getAll('image[]').length,1);
});

test('preview count defaults off, validates its range, and changes options without generating',t=>{
  const browser=new BananaBrowser(undefined,'fake-key','gpt-image-2');
  assert.equal(browser.getImageOptions().partialImages,0);
  const changes=t.mock.fn();browser.onStateChange=changes;
  const generate=t.mock.method(browser,'generateWithOpenAI',async()=>image);
  browser.setImageOptions({partialImages:3});
  assert.equal(browser.getImageOptions().partialImages,3);
  for (const partialImages of [-1,4,0.5,NaN,Infinity,'2',null]) {
    assert.throws(()=>browser.setImageOptions({partialImages}),/integer from 0 to 3/);
    assert.equal(browser.getImageOptions().partialImages,3);
  }
  browser.state.loading=true;
  browser.setImageOptions({partialImages:0});
  assert.equal(browser.getImageOptions().partialImages,3);
  assert.equal(changes.mock.callCount(),0);
  assert.equal(generate.mock.callCount(),0);
});

test('preview estimate adds 100 image output tokens per requested API preview',()=>{
  for(const [model,spec] of Object.entries(IMAGE_MODELS)) {
    const opts=defaultImageOptions(model);
    assert.equal(opts.partialImages,0);
    const base=estimateImageCost(model,opts);
    for(const partialImages of [1,2,3]) {
      const estimate=estimateImageCost(model,{...opts,partialImages});
      const surcharge=spec.provider==='openai' ? partialImages*100*BananaBrowser.PRICING[model].imageOutput : 0;
      assert.ok(Math.abs(estimate.output-base.output-surcharge)<1e-12,model);
      assert.ok(Math.abs(estimate.total-base.total-surcharge)<1e-12,model);
      assert.equal(estimate.input,base.input);
    }
  }
});
