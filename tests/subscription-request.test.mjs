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
  const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
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
  for(const model of ['gpt-image-2.5-flare','gpt-image-2.5-sunburst']){
    for(const quality of ['low','medium','high','xhigh','max','auto']){
      for(const refs of [[],images]){
        await subscriptionGenerate({kind:'image',model,prompt:'Selected model',images:refs,size:'1536x864',quality});
        const call=calls.at(-1);
        assert.equal(call.body.model,model);
        assert.equal(call.body.quality,quality);
        assert.equal(call.body.size,'1536x864');
        assert.equal(call.url,`https://chatgpt.com/backend-api/codex/images/${refs.length?'edits':'generations'}`);
      }
    }
  }
  const before=calls.length;
  await assert.rejects(subscriptionGenerate({kind:'image',prompt:'bad',images:['https://example.com/image.png']}),/browser session/);
  assert.equal(calls.length,before);
  for(const change of [{model:'arbitrary'}, {model:'gpt-image-2',quality:'max'}, {size:'1000x1000'}, {size:'3840x3840'}, {size:'16x16'}, {size:'3840x512'}]){
    await assert.rejects(subscriptionGenerate({kind:'image',prompt:'Invalid',images:[],...change}),/supported/);
  }
  assert.equal(calls.length,before,'invalid selections must not reach the subscription backend');
  for(const code of [400,403,404,422,429,500]){
    failure=code;
    await assert.rejects(subscriptionGenerate({kind:'image',model:'gpt-image-2.5-flare',prompt:'Once',images:[]}),error=>{
      assert.doesNotMatch(error.message,/private/);
      if([400,403,404,422].includes(code))assert.match(error.message,/may not be available on your plan/);
      return true;
    });
    assert.equal(calls.at(-1).body.model,'gpt-image-2.5-flare');
  }
  assert.equal(calls.length,before+6,'failed image calls must not retry or fall back to API billing');
});
