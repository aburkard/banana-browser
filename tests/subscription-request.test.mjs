import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';

test('subscription images bypass the LLM and preserve input settings; clicks keep their model and effort',async t=>{
  const window=new Window({url:'http://localhost/banana-browser/'});
  const calls=[];let failure=0;
  const globals={localStorage:window.localStorage,sessionStorage:window.sessionStorage,location:window.location,
    navigator:{locks:{request:async(_name,work)=>work()}},
    libcurl:{load_wasm:async()=>{},set_websocket:()=>{},fetch:async(url,options)=>{
      calls.push({url,body:JSON.parse(options.body)});
      if(failure)return Response.json({error:{message:'private upstream detail'}},{status:failure});
      if(url.includes('/images/'))return Response.json({data:[{b64_json:'aW1hZ2U='}],output_format:'png',usage:{input_tokens:4510,output_tokens:197}});
      return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'image_generation_call',status:'completed',result:'aW1hZ2U='}],usage:{input_tokens:100,output_tokens:10}}})+'\n\n');
    }}};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,value});
  const liveFetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Live requests forbidden');});
  t.mock.method(console,'info',()=>{});
  t.after(async()=>{
    assert.equal(liveFetch.mock.callCount(),0);
    await window.happyDOM.close();
    for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  });
  window.localStorage.setItem('banana_chatgpt_v1',JSON.stringify({accessToken:'fake',refreshToken:'fake-refresh',accountId:'fake-account',expiresAt:Date.now()+3600000}));
  const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
  let subscriptionGenerate;
  try {({subscriptionGenerate}=await server.ssrLoadModule('/src/subscription.ts'));}finally{await server.close();}
  const images=['data:image/png;base64,cmVmZXJlbmNl'];
  const result=await subscriptionGenerate({kind:'image',prompt:'Keep the red X and page instructions.',images,quality:'high',size:'1024x1536'});
  assert.equal(result.image,'data:image/png;base64,aW1hZ2U=');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://chatgpt.com/backend-api/codex/images/edits');
  assert.deepEqual(calls[0].body,{
    model:'gpt-image-2',prompt:'Keep the red X and page instructions.',
    images:[{image_url:images[0]}],size:'1024x1536',quality:'high',
  });
  assert.deepEqual(result.usage,{input_tokens:4510,output_tokens:197});
  await subscriptionGenerate({kind:'click',prompt:'Interpret click',images,model:'gpt-5.6-terra',effort:'medium'});
  assert.equal(calls[1].body.model,'gpt-5.6-terra');
  assert.deepEqual(calls[1].body.reasoning,{effort:'medium'});
  assert.equal(calls[1].url,'https://chatgpt.com/backend-api/codex/responses');
  assert.equal(calls[1].body.tools,undefined);
  await subscriptionGenerate({kind:'image',prompt:'New page',images:[],size:'1920x1280',quality:'low'});
  assert.equal(calls[2].url,'https://chatgpt.com/backend-api/codex/images/generations');
  assert.deepEqual(calls[2].body,{model:'gpt-image-2',prompt:'New page',size:'1920x1280',quality:'low'});
  const before=calls.length;
  await assert.rejects(subscriptionGenerate({kind:'image',prompt:'bad',images:['https://example.com/image.png']}),/browser session/);
  assert.equal(calls.length,before);
  for(const code of [429,500]){
    failure=code;
    await assert.rejects(subscriptionGenerate({kind:'image',prompt:'Once',images:[]}),error=>{
      assert.doesNotMatch(error.message,/private/);return true;
    });
  }
  assert.equal(calls.length,before+2,'failed image calls must not retry or fall back to API billing');
});
