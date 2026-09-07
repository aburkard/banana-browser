import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';

const authKey='banana_chatgpt_v1';
const preferenceKey='banana_connection_mode';
const fakeAuth=JSON.stringify({accessToken:'fake-access',refreshToken:'fake-refresh',accountId:'fake-account',expiresAt:Date.now()+3600000});

async function fixture(t,{mode='chatgpt',auth=true,keys=true,captureBrowser}={}) {
  const window=new Window({url:'http://127.0.0.1:5178/banana-browser/'});
  const globals={window,document:window.document,localStorage:window.localStorage,sessionStorage:window.sessionStorage,navigator:{locks:{request:async(_name,work)=>work()}}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,value});
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Live requests are forbidden in connection tests');});
  t.after(async()=>{
    assert.equal(fetch.mock.callCount(),0,'billing controls must not make model requests');
    await window.happyDOM.close();
    for(const [key,descriptor] of previous) {
      if(descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  });
  if(mode) window.localStorage.setItem(preferenceKey,mode);
  if(auth) window.localStorage.setItem(authKey,fakeAuth);
  if(keys) {
    window.localStorage.setItem('gemini_api_key','fake-gemini');
    window.localStorage.setItem('openai_api_key','fake-openai');
  }
  async function reload() {
    window.document.body.innerHTML='<div id="app"></div>';
    const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
    try {
      if(captureBrowser) {
        const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
        t.mock.method(BananaBrowser.prototype,'navigate',async function(){captureBrowser(this);});
      }
      await server.ssrLoadModule('/src/main.ts');
    }
    finally { await server.close(); }
  }
  await reload();
  return {window,storage:window.localStorage,el:selector=>window.document.querySelector(selector),reload};
}

test('API choice requires confirmation, cancellation preserves credentials, and switching preserves ChatGPT',async t=>{
  const f=await fixture(t);
  assert.match(f.el('#reset-key-btn').textContent,/ChatGPT plan/);
  assert.deepEqual([...f.el('#model-select').options].map(o=>o.value),['gpt-image-2']);
  f.el('#reset-key-btn').click();
  f.el('#gemini-key').value='new-fake-gemini';
  f.el('#start-btn').click();
  assert.equal(f.el('#api-confirmation').open,true);
  assert.match(f.el('#api-confirmation').textContent,/Billed to your API keys/);
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
  f.el('#cancel-api').click();
  assert.equal(f.el('#api-confirmation').open,false);
  f.el('#confirm-api').click();
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
  assert.equal(f.storage.getItem('gemini_api_key'),'fake-gemini');

  f.el('#start-btn').click();
  f.el('#confirm-api').click();
  assert.equal(f.storage.getItem(preferenceKey),'api');
  assert.equal(f.storage.getItem('gemini_api_key'),'new-fake-gemini');
  assert.equal(f.storage.getItem(authKey),fakeAuth);
  assert.match(f.el('#reset-key-btn').textContent,/API credits/);
  const models=[...f.el('#model-select').options].map(o=>o.value);
  assert.ok(models.includes('flash-lite')&&models.includes('gpt-image-2'));
  f.el('#model-select').value='flash-lite';
  f.el('#model-select').dispatchEvent(new f.window.Event('change'));
  assert.match(f.el('#price-badge').textContent,/\$/);
  await f.reload();
  assert.match(f.el('#reset-key-btn').textContent,/API credits/);
});

test('switching back to the ChatGPT plan preserves API keys and survives reload',async t=>{
  const f=await fixture(t,{mode:'api'});
  f.el('#reset-key-btn').click();
  f.el('#resume-chatgpt').click();
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
  assert.equal(f.storage.getItem('gemini_api_key'),'fake-gemini');
  assert.equal(f.storage.getItem('openai_api_key'),'fake-openai');
  assert.equal(f.el('#price-badge').textContent,'');
  await f.reload();
  assert.match(f.el('#reset-key-btn').textContent,/ChatGPT plan/);
});

test('an unavailable selected connection opens setup without silently using the other billing source',async t=>{
  const f=await fixture(t,{mode:'chatgpt',auth:false});
  assert.equal(f.el('#go-btn'),null);
  assert.ok(f.el('#connect-chatgpt'));
  assert.equal(f.storage.getItem(preferenceKey),'chatgpt');
});

test('two existing connections without a preference require a choice',async t=>{
  const f=await fixture(t,{mode:null});
  assert.equal(f.el('#go-btn'),null);
  assert.equal(f.el('#chatgpt-connected').hidden,false);
  assert.equal(f.storage.getItem(preferenceKey),null);
});

test('loading shows the real phase and elapsed time, and replacing the browser stops updates',async t=>{
  let browser;
  const f=await fixture(t,{captureBrowser:value=>{browser=value;}});
  let now=0;
  let tick;
  t.mock.method(performance,'now',()=>now);
  const interval=t.mock.method(globalThis,'setInterval',callback=>{tick=callback;return 123;});
  const clear=t.mock.method(globalThis,'clearInterval',()=>{});
  f.el('#url-input').value='https://example.com';
  f.el('#go-btn').click();
  assert.ok(browser);
  const state={loading:true,status:'Fetching data...',currentUrl:'https://example.com',currentImage:null,error:null,scrollDepth:0,scrollIndex:0,usage:{estimatedCost:0,totalInputTokens:0,totalOutputTokens:0,imageGenerations:0,clickInterpretations:0,byModel:{}}};
  browser.onStateChange(state);
  assert.equal(f.el('.loading-overlay p').textContent,'Fetching data... · 0s elapsed');
  now=72000; tick();
  assert.equal(f.el('#status').textContent,'Fetching data... · 72s elapsed');
  browser.onStateChange({...state,status:'Generating webpage image...'});
  assert.equal(f.el('.loading-overlay p').textContent,'Generating webpage image... · 72s elapsed');
  browser.onStateChange({...state,loading:false,status:'Error generating page',error:'Offline test error'});
  assert.equal(f.el('.loading-overlay'),null);
  assert.equal(f.el('#status').textContent,'Error generating page');
  browser.onStateChange(state);
  f.el('#reset-key-btn').click();
  now+=2000;
  browser.onStateChange({...state,status:'Still generating...'});
  f.el('#back-to-browser').click();
  assert.equal(f.el('.loading-overlay p').textContent,'Still generating... · 2s elapsed');
  f.el('#reset-key-btn').click();
  f.el('#resume-chatgpt').click();
  const count=interval.mock.callCount();
  browser.onStateChange(state);
  assert.equal(interval.mock.callCount(),count);
  assert.equal(clear.mock.calls.at(-1).arguments[0],123);
  assert.equal(f.el('.loading-overlay'),null);
});

for(const mode of ['api','chatgpt']) test(`Back from connection settings preserves the ${mode} browser and discards key drafts`,async t=>{
  let browser;
  const f=await fixture(t,{mode,captureBrowser:value=>{browser=value;}});
  const input=f.el('#url-input');
  input.value='https://example.com/current-page';
  f.el('#go-btn').click();
  const originalBrowser=browser;
  const viewport=f.el('#viewport');
  const canvas=f.window.document.createElement('canvas');
  viewport.replaceChildren(canvas);
  const settings=f.el('#reset-key-btn');
  settings.click();
  assert.ok(f.el('#back-to-browser'));
  f.el('#gemini-key').value='unsaved-draft';
  f.el('#back-to-browser').click();
  assert.equal(f.el('#viewport'),viewport);
  assert.equal(f.el('#viewport canvas'),canvas);
  assert.equal(f.el('#url-input'),input);
  assert.equal(input.value,'https://example.com/current-page');
  assert.equal(f.window.document.activeElement,settings);
  assert.equal(f.storage.getItem(preferenceKey),mode);
  assert.equal(f.storage.getItem('gemini_api_key'),'fake-gemini');
  f.el('#go-btn').click();
  assert.equal(browser,originalBrowser);
  settings.click();
  assert.equal(f.el('#gemini-key').value,'fake-gemini');
  f.el('#back-to-browser').click();
});

test('subscription usage is discoverable before calls and shows counts and tokens without API dollars',async t=>{
  let browser;
  const f=await fixture(t,{captureBrowser:value=>{browser=value;}});
  assert.notEqual(f.el('#usage-details').style.display,'none');
  assert.match(f.el('#usage-stats').textContent,/Usage/);
  assert.match(f.el('#usage-breakdown').textContent,/No calls yet/);
  f.el('#url-input').value='https://example.com';
  f.el('#go-btn').click();
  browser.onStateChange({loading:false,status:'Ready',currentUrl:null,currentImage:null,error:null,scrollDepth:0,scrollIndex:0,usage:{estimatedCost:0,totalInputTokens:0,totalOutputTokens:1500,imageGenerations:1,clickInterpretations:2,byModel:{image:{label:'GPT Image 2',calls:1,inputTokens:0,outputTokens:1000,cost:0},click:{label:'Luna',calls:2,inputTokens:0,outputTokens:500,cost:0}}}});
  assert.equal(f.el('#usage-stats').textContent,'Usage · 1 image · 2 clicks ▾');
  assert.match(f.el('#usage-breakdown tfoot').textContent,/Total3.*0 \/ 1.5k/);
  assert.match(f.el('#usage-breakdown').textContent,/Remaining ChatGPT limits aren’t shown here/);
  assert.doesNotMatch(f.el('#usage-breakdown').textContent,/\$/);
  f.el('#usage-details').open=true;
  assert.equal(f.el('#usage-details').open,true);
});

test('subscription hides ignored image settings while API billing retains them',async t=>{
  const f=await fixture(t,{mode:'chatgpt'});
  assert.equal(f.el('#size-wrap').style.display,'none');
  assert.equal(f.el('#quality-wrap').style.display,'none');
  assert.equal(f.el('#previews-wrap').style.display,'none');
  f.storage.setItem(preferenceKey,'api');
  await f.reload();
  f.el('#model-select').value='gpt-image-2';
  f.el('#model-select').dispatchEvent(new f.window.Event('change'));
  assert.notEqual(f.el('#size-wrap').style.display,'none');
  assert.notEqual(f.el('#quality-wrap').style.display,'none');
  assert.equal(f.el('#quality-select').value,'low');
  assert.notEqual(f.el('#previews-wrap').style.display,'none');
  assert.equal(f.el('#previews-select').value,'0');
});

test('API preview control updates options and cost without a generation and hides for Gemini',async t=>{
  let browser;
  const f=await fixture(t,{mode:'api',captureBrowser:value=>{browser=value;}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  f.el('#model-select').value='gpt-image-2';
  f.el('#model-select').dispatchEvent(new f.window.Event('change'));
  const price=f.el('#price-badge').textContent;
  assert.deepEqual([...f.el('#previews-select').options].map(option=>option.value),['0','1','2','3']);
  f.el('#previews-select').value='3';
  f.el('#previews-select').dispatchEvent(new f.window.Event('change'));
  assert.equal(browser.getImageOptions().partialImages,3);
  assert.notEqual(f.el('#price-badge').textContent,price);
  assert.equal(f.el('.loading-overlay'),null);
  f.el('#previews-select').value='0';
  f.el('#previews-select').dispatchEvent(new f.window.Event('change'));
  assert.equal(f.el('#price-badge').textContent,price);
  f.el('#model-select').value='flash-lite';
  f.el('#model-select').dispatchEvent(new f.window.Event('change'));
  assert.equal(f.el('#previews-wrap').style.display,'none');
});

test('model and rendering controls stay locked for the duration of a request',async t=>{
  let browser;
  const f=await fixture(t,{mode:'api',captureBrowser:value=>browser=value});
  f.el('#url-input').value='https://api.tvmaze.com/shows/1';
  f.el('#go-btn').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(browser);
  browser.updateState({loading:true,status:'Generating'});
  for(const id of ['model-select','style-select','custom-style','size-select','quality-select','previews-select','image-thinking-select','click-model-select','effort-select','click-thinking-select']) assert.equal(f.el(`#${id}`).disabled,true,id);
  browser.updateState({loading:false,status:'Ready'});
  assert.equal(f.el('#model-select').disabled,false);
  assert.equal(f.el('#quality-select').disabled,false);
});

test('status updates and overlapping image loads leave one current canvas after scroll animation',async t=>{
  let browser;
  const f=await fixture(t,{captureBrowser:value=>{browser=value;}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  const images=[];
  const previousImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class {
    width=640; height=480;
    constructor(){images.push(this);}
    set src(value){this.source=value;}
  }});
  t.after(()=>{if(previousImage)Object.defineProperty(globalThis,'Image',previousImage);else delete globalThis.Image;});
  t.mock.method(f.window.HTMLCanvasElement.prototype,'getContext',()=>({drawImage(){}}));
  const timers=[];
  t.mock.method(globalThis,'setTimeout',callback=>{timers.push(callback);return 1;});
  const state={...browser.state,loading:false,error:null,currentUrl:'https://example.com',currentImage:'first',scrollIndex:0};
  browser.onStateChange(state);images[0].onload();
  browser.onStateChange({...state,currentImage:'second',scrollIndex:1,viewTransition:'down'});images[1].onload();
  assert.equal(f.el('#viewport').querySelectorAll('canvas').length,2);
  browser.onStateChange({...state,currentImage:'second',scrollIndex:1,loading:true,status:'Interpreting click...'});
  browser.onStateChange({...state,currentImage:'second',scrollIndex:1,status:'No navigation target found'});
  assert.equal(images.length,2,'unchanged screenshot must not decode or redraw');
  browser.onStateChange({...state,currentImage:'third',scrollIndex:0,viewTransition:'up'});images[2].onload();
  assert.equal(f.el('#viewport').querySelectorAll('canvas').length,2,'only latest entering/leaving pair remains');
  timers.forEach(callback=>callback());
  assert.equal(f.el('#viewport').querySelectorAll('canvas').length,1);
  browser.onStateChange({...state,currentImage:'slow'});
  browser.onStateChange({...state,currentImage:'latest'});
  images[4].onload();const current=f.el('#viewport canvas');images[3].onload();
  assert.equal(f.el('#viewport canvas'),current,'late old image cannot replace latest');
  assert.equal(f.el('#viewport').querySelectorAll('canvas').length,1);
});

test('preview crossfades wait for decode, retain the last frame until final canvas, and bound layers',async t=>{
  let browser;
  const f=await fixture(t,{mode:'api',captureBrowser:value=>{browser=value;}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  const previews=[];const create=f.window.document.createElement.bind(f.window.document);
  t.mock.method(f.window.document,'createElement',(tag,...args)=>{const el=create(tag,...args);if(tag==='img')previews.push(el);return el;});
  t.mock.method(f.window.HTMLImageElement.prototype,'decode',async()=>{});
  const timers=[];t.mock.method(globalThis,'setTimeout',callback=>{timers.push(callback);return timers.length;});
  const finals=[];const previousImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class{width=640;height=480;constructor(){finals.push(this);}set src(value){this.source=value;}}});
  t.after(()=>{if(previousImage)Object.defineProperty(globalThis,'Image',previousImage);else delete globalThis.Image;});
  t.mock.method(f.window.HTMLCanvasElement.prototype,'getContext',()=>({drawImage(){}}));
  const committed=create('canvas');f.el('#viewport').replaceChildren(committed);
  const state={...browser.state,loading:true,error:null,status:'Generating webpage image...',previewImage:null,previewIndex:0,previewReceived:1,previewRequested:3};
  const load=async img=>{await img.onload?.(new f.window.Event('load'));await Promise.resolve();};
  browser.onStateChange(state);
  browser.onStateChange({...state,previewImage:'first'});const first=previews.at(-1);
  assert.equal(f.el('.loading-overlay').classList.contains('has-preview'),false,'wait for decoded preview');
  await load(first);
  assert.equal(f.el('.loading-overlay').classList.contains('has-preview'),true);
  assert.equal(f.el('#viewport canvas'),committed);
  assert.match(f.el('.loading-overlay p').textContent,/Still generating · Preview 1\/3/);
  timers.splice(0).forEach(run=>run());
  browser.onStateChange({...state,previewImage:'second',previewIndex:1,previewReceived:2});const second=previews.at(-1);
  assert.ok(first.isConnected,'old frame remains while next loads');
  assert.match(f.el('.loading-overlay p').textContent,/Preview 1\/3/,'pending decode keeps the visible stage label');
  await load(second);
  assert.match(f.el('.loading-overlay p').textContent,/Preview 2\/3/);
  assert.ok(f.el('#viewport').querySelectorAll('.image-preview').length<=2);
  timers.splice(0).forEach(run=>run());
  browser.onStateChange({...state,previewImage:'stale'});const stale=previews.at(-1);const late=stale.onload;
  browser.onStateChange({...state,previewImage:'latest'});const latest=previews.at(-1);
  await load(latest);await late?.(new f.window.Event('load'));
  assert.ok(latest.isConnected);assert.ok(!stale.isConnected,'stale decode cannot replace newer preview');
  assert.ok(f.el('#viewport').querySelectorAll('.image-preview').length<=2);
  browser.onStateChange(state);
  assert.ok(latest.isConnected,'backend preview cleanup must not flash the old page');
  browser.onStateChange({...state,loading:false,currentImage:'final',navigationRevision:1});
  assert.ok(latest.isConnected,'hold preview until the final canvas is ready');
  finals.at(-1).onload();
  assert.equal(f.el('.loading-overlay p').textContent,'Final image');
  assert.ok(f.el('.loading-overlay'),'final dissolve retains outgoing preview');
  assert.notEqual(f.el('#viewport canvas'),committed);
  timers.forEach(run=>run());
  assert.equal(f.el('.loading-overlay'),null);
  assert.equal(f.el('#viewport').querySelectorAll('canvas').length,1);
  browser.onStateChange({...state,previewImage:'another'});await load(previews.at(-1));
  browser.onStateChange({...state,loading:false,currentImage:'invalid-final',navigationRevision:2});
  finals.at(-1).onerror();
  assert.equal(f.el('.loading-overlay'),null,'failed final decode cannot trap the user under a preview');
  assert.equal(f.el('#viewport canvas'),null,'old canvas must not interpret clicks against new state');
  assert.match(f.el('#viewport').textContent,/could not be displayed/);
});

test('preview callbacks cannot survive failures, new requests, or disposal',async t=>{
  let browser;const f=await fixture(t,{mode:'api',captureBrowser:value=>{browser=value;}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  const previews=[];const create=f.window.document.createElement.bind(f.window.document);
  t.mock.method(f.window.document,'createElement',(tag,...args)=>{const el=create(tag,...args);if(tag==='img')previews.push(el);return el;});
  t.mock.method(f.window.HTMLImageElement.prototype,'decode',async()=>{});
  const state={...browser.state,loading:true,error:null,status:'Generating...',previewImage:'first'};
  browser.onStateChange(state);const first=previews.at(-1);const late=first.onload;
  browser.onStateChange({...state,loading:false,error:'Offline',previewImage:null});
  await late?.(new f.window.Event('load'));
  assert.equal(f.el('.image-preview'),null);assert.equal(f.el('.error').textContent,'Offline');
  browser.onStateChange({...state,previewImage:null});
  assert.equal(f.el('.image-preview'),null,'new request begins without old preview');
  browser.onStateChange({...state,previewImage:'second'});const second=previews.at(-1);const afterDispose=second.onload;
  f.el('#reset-key-btn').click();f.el('#resume-chatgpt').click();
  await afterDispose?.(new f.window.Event('load'));
  assert.equal(second.hasAttribute('src'),false);
  assert.equal(f.el('.image-preview'),null);
});

test('API usage labels missing charges as unknown and identifies its session scope',async t=>{
  let browser;const f=await fixture(t,{mode:'api',captureBrowser:value=>{browser=value}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  browser.trackUsage('image');
  assert.equal(f.el('#usage-stats').textContent,'Cost unavailable ▾');
  assert.match(f.el('#usage-breakdown').textContent,/Unknown/);
  assert.match(f.el('#usage-breakdown').textContent,/1 with missing usage/);
  assert.match(f.el('#usage-breakdown').textContent,/resets on reload/);
  assert.match(f.el('#usage-breakdown').textContent,/Provider billing is authoritative/);
});

test('address drafts survive Go progress, usage updates and errors; committed navigation updates the field',async t=>{
  let browser;
  t.after(()=>browser?.updateState({loading:false,status:'Ready'}));
  const f=await fixture(t,{mode:'api',captureBrowser:value=>{
    browser=value;
    browser.updateState({loading:true,status:'Fetching data...'});
  }});
  const input=f.el('#url-input');
  input.value='https://example.com/first';
  f.el('#go-btn').click();
  assert.equal(input.value,'https://example.com/first','first Go must not clear the submitted URL');
  browser.updateState({status:'Generating webpage image...'});
  assert.equal(input.value,'https://example.com/first');
  browser.updateState({loading:false,currentUrl:'https://example.com/first',navigationRevision:1,status:'Page loaded'});
  input.value='https://example.com/second';
  f.el('#go-btn').click();
  assert.equal(input.value,'https://example.com/second','next Go must not restore the previous URL');
  browser.trackUsage('image');
  assert.equal(input.value,'https://example.com/second');
  browser.updateState({loading:false,error:'Offline',status:'Error'});
  assert.equal(input.value,'https://example.com/second','failed URL remains available to edit/retry');
  browser.updateState({currentUrl:'https://example.com/second?normalized=1',navigationRevision:2,error:null,status:'Page loaded'});
  assert.equal(input.value,'https://example.com/second?normalized=1');
  input.value='https://example.com/draft';
  browser.updateState({status:'Ready'});
  assert.equal(input.value,'https://example.com/draft');
  browser.updateState({currentUrl:'https://example.com/first',navigationRevision:3,status:'Page loaded'});
  assert.equal(input.value,'https://example.com/first','history navigation updates the address');
  input.value='https://example.com/draft';
  browser.updateState({navigationRevision:4,status:'Navigated back'});
  assert.equal(input.value,'https://example.com/first','same-URL history entries also restore the address');
});

test('history animates horizontally regardless of saved scroll index and restores the scrollbar',async t=>{
  let browser;
  const f=await fixture(t,{captureBrowser:value=>{browser=value;}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  const images=[];
  const previousImage=Object.getOwnPropertyDescriptor(globalThis,'Image');
  Object.defineProperty(globalThis,'Image',{configurable:true,value:class {
    width=640;height=480;
    constructor(){images.push(this);}
    set src(value){this.source=value;}
  }});
  t.after(()=>{if(previousImage)Object.defineProperty(globalThis,'Image',previousImage);else delete globalThis.Image;});
  t.mock.method(f.window.HTMLCanvasElement.prototype,'getContext',()=>({drawImage(){}}));
  const timers=[];t.mock.method(globalThis,'setTimeout',callback=>{timers.push(callback);return 1;});
  const state={...browser.state,loading:false,error:null,currentUrl:'https://example.com/b',currentImage:'b',scrollIndex:3,scrollDepth:4,navigationRevision:1};
  browser.onStateChange(state);images.at(-1).onload();
  const back={...state,currentUrl:'https://example.com/a',currentImage:'a',scrollIndex:1,scrollDepth:3,navigationRevision:2,viewTransition:'back'};
  browser.onStateChange(back);images.at(-1).onload();
  assert.ok(f.el('.page-enter-back'));assert.ok(f.el('.page-exit-back'));assert.equal(f.el('.scroll-enter-up'),null);
  const thumb=f.el('.scroll-thumb');
  assert.ok(Math.abs(parseFloat(thumb.style.height)-100/3)<.001);
  assert.ok(Math.abs(parseFloat(thumb.style.top)-100/3)<.001);
  browser.onStateChange({...back,status:'Ready'});assert.equal(images.length,2,'progress does not replay history');
  timers.splice(0).forEach(run=>run());
  browser.onStateChange({...state,navigationRevision:3,viewTransition:'forward'});images.at(-1).onload();
  assert.ok(f.el('.page-enter-forward'));assert.equal(f.el('.scroll-enter-down'),null);
  timers.splice(0).forEach(run=>run());
  browser.onStateChange({...state,navigationRevision:4,viewTransition:'back'});images.at(-1).onload();
  assert.equal(images.length,4,'distinct history entries may share the same image');assert.ok(f.el('.page-enter-back'));
  timers.splice(0).forEach(run=>run());
  browser.onStateChange({...state,currentImage:'new-page',scrollIndex:0,navigationRevision:5,viewTransition:null});images.at(-1).onload();
  assert.equal(f.el('#viewport').querySelectorAll('canvas').length,1);assert.equal(f.el('.scroll-enter-up'),null);
});

test('identical preview bytes advance the label both before and after decoding',async t=>{
  let browser;const f=await fixture(t,{mode:'api',captureBrowser:value=>{browser=value;}});
  f.el('#url-input').value='https://example.com';f.el('#go-btn').click();
  const previews=[];const create=f.window.document.createElement.bind(f.window.document);
  t.mock.method(f.window.document,'createElement',(tag,...args)=>{const el=create(tag,...args);if(tag==='img')previews.push(el);return el;});
  t.mock.method(f.window.HTMLImageElement.prototype,'decode',async()=>{});
  const state={...browser.state,loading:true,error:null,status:'Generating...',previewImage:'same',previewRequested:3,previewIndex:0,previewReceived:1};
  browser.onStateChange(state);
  browser.onStateChange({...state,previewIndex:1,previewReceived:2});
  assert.equal(previews.length,1);
  await previews[0].onload(new f.window.Event('load'));
  assert.match(f.el('.loading-overlay p').textContent,/Preview 2\/3/);
  browser.onStateChange({...state,previewIndex:2,previewReceived:3});
  assert.equal(previews.length,1,'same image does not restart its fade');
  assert.match(f.el('.loading-overlay p').textContent,/Preview 3\/3/);
  browser.onStateChange({...state,loading:false,previewImage:null});
});
