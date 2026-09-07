import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
await server.close();
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
function setup(t){t.mock.method(console,'log',()=>{});return new BananaBrowser('test','test','gpt-image-2');}
const usage={input_tokens:100,output_tokens:20,input_tokens_details:{text_tokens:100,image_tokens:0,cached_tokens:0}};

test('successful OpenAI response without usage is counted and flagged unknown',async t=>{
  const b=setup(t);const request=t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{b64_json:'aW1hZ2U='}]}));
  assert.match(await b.generateWithOpenAICreate('test'),/^data:image/);
  assert.equal(request.mock.callCount(),1);assert.equal(b.state.usage.imageGenerations,1);
  assert.equal(b.state.usage.costIncomplete,true);assert.equal(b.state.usage.byModel['gpt-image-2'].unknownUsageCalls,1);
});

test('transport, malformed response and HTTP failures are accounted once with no retry',async t=>{
  for(const response of [()=>{throw new Error('offline')},()=>new Response('not JSON'),()=>Response.json(null),()=>Response.json({error:{message:'rejected'}},{status:429})]){
    const b=setup(t);const request=t.mock.method(globalThis,'fetch',async()=>response());
    await assert.rejects(b.generateWithOpenAICreate('test'));
    assert.equal(request.mock.callCount(),1);assert.equal(b.state.usage.imageGenerations,1);
    assert.equal(b.state.usage.costIncomplete,true);request.mock.restore();
  }
});

test('reported usage is retained when output is unusable without double counting',async t=>{
  const b=setup(t);t.mock.method(globalThis,'fetch',async()=>Response.json({data:[],usage}));
  await assert.rejects(b.generateWithOpenAICreate('test'),/No image/);
  assert.equal(b.state.usage.imageGenerations,1);assert.equal(b.state.usage.totalInputTokens,100);
  near(b.state.usage.estimatedCost,(100*5+20*30)/1e6);
});

test('source failures do not count as model calls; Gemini failures do',async t=>{
  const b=setup(t);t.mock.method(b,'fetchApiData',async()=>{throw new Error('source offline')});
  await b.navigate('https://example.com');assert.equal(b.state.usage.imageGenerations,0);
  const gemini=new BananaBrowser('test');gemini.geminiAI={models:{generateContent:async()=>{throw new Error('lost response')}}};
  await assert.rejects(gemini.generateWithGemini('test'),/lost response/);
  assert.equal(gemini.state.usage.imageGenerations,1);assert.equal(gemini.state.usage.costIncomplete,true);
});

test('cache and long-context rates use the request usage while earlier charges remain unchanged',t=>{
  const b=setup(t);b.setClickModel('gpt-5.6-luna');
  const raw={input_tokens:300000,output_tokens:100,input_tokens_details:{cached_tokens:100000,cache_write_tokens:100000}};
  b.trackUsage('text',raw);near(b.state.usage.estimatedCost,(100000*.4+100000*.04+100000*.5+100*1.8)/1e6);
  const before=b.state.usage.estimatedCost;
  b.trackUsage('text',{...raw,input_tokens:272000});
  near(b.state.usage.estimatedCost-before,(72000*.2+100000*.02+100000*.25+100*1.2)/1e6);
  b.setClickModel('gemini-3-pro');
  const start=b.state.usage.estimatedCost;
  b.trackUsage('text',{promptTokenCount:200001,cachedContentTokenCount:100000,candidatesTokenCount:20,thoughtsTokenCount:10});
  near(b.state.usage.estimatedCost-start,(100001*4+100000*.4+30*18)/1e6);
});

test('cache read prices are configured for supported cached models and image modalities',t=>{
  const b=setup(t);b.setClickModel('gpt-5.4-mini');
  b.trackUsage('text',{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:800}});
  near(b.state.usage.estimatedCost,(200*.75+800*.075+100*4.5)/1e6);
  b.setModel('gpt-image');const before=b.state.usage.estimatedCost;
  b.trackUsage('image',{input_tokens:300,output_tokens:120,input_tokens_details:{text_tokens:100,image_tokens:200,cached_tokens:150,cached_tokens_details:{text_tokens:50,image_tokens:100}},output_tokens_details:{text_tokens:20,image_tokens:100}});
  near(b.state.usage.estimatedCost-before,(50*5+100*8+50*1.25+100*2+20*10+100*32)/1e6);
});

test('click compaction keeps navigation and pointer, omits irrelevant provider examples, and preserves raw source',async t=>{
  const b=setup(t);b.setClickModel('gpt-5.4-mini');
  b.state.currentImage='data:image/png;base64,aW1hZ2U=';
  b.state.currentUrl='https://api.tvmaze.com/shows/1';
  const source={source:'TVmaze',article:{apiUrl:'https://api.tvmaze.com/shows/1',headline:'Show',imageUrl:'https://example.com/photo.png'},imageUrls:['https://example.com/photo.png']};
  b.state.currentApiData=source;
  t.mock.method(b,'drawPointerOnImage',async()=>b.state.currentImage);t.mock.method(b,'logImage',()=>{});
  const bodies=[];t.mock.method(globalThis,'fetch',async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({output:[],usage:{input_tokens:100,output_tokens:0,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}})});
  await b.interpretClick(1,2);
  const parts=bodies[0].input[0].content;
  assert.match(parts[0].text,/https:\/\/api.tvmaze.com\/shows\/1/);assert.doesNotMatch(parts[0].text,/photo.png|hacker-news|reddit.com/);
  assert.equal(parts[1].image_url,b.state.currentImage);assert.match(parts[2].text,/coordinates \(1, 2\)/);
  assert.equal(source.article.imageUrl,'https://example.com/photo.png');
  b.setClickModel('gpt-5.6-luna');await b.interpretClick(1,2);
  assert.match(bodies[1].input[0].content[0].text,/photo.png/);
  b.setClickModel('gpt-5.4-mini');
  b.state.currentUrl='https://custom.example/data';await b.interpretClick(1,2);
  assert.match(bodies[2].input[0].content[0].text,/photo.png/);
});
