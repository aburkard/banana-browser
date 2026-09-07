import test from 'node:test';
import assert from 'node:assert/strict';
import {guardedFetch} from './real-guard.mjs';
const imageUrl='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent';
const image={body:JSON.stringify({generationConfig:{maxOutputTokens:2048,imageConfig:{imageSize:'1K'}}})};
test('each isolated scenario allows four image attempts and one bounded click only',async()=>{
 let count=0;const state={images:0,clicks:0,sources:0,references:0};const calls=[];
 const fetch=guardedFetch({nativeFetch:async(url,options)=>{count++;calls.push({url,options});return Response.json({})},active:()=>state,fixtures:{responses:{},imageHosts:[]},persist(){}});
 for(let i=0;i<4;i++)await fetch(imageUrl,image);await assert.rejects(fetch(imageUrl,image));assert.equal(count,4);
 await fetch('https://api.openai.com/v1/responses',{body:JSON.stringify({model:'gpt-5.6-luna'})});await assert.rejects(fetch('https://api.openai.com/v1/responses',{body:'{}'}));assert.equal(count,5);assert.equal(JSON.parse(calls.at(-1).options.body).max_output_tokens,512);assert.ok(calls.at(-1).options.signal);
 state.stopped=true;await assert.rejects(fetch(imageUrl,image));assert.equal(count,5);
});
test('fixture response has no network, unknown URLs blocked, references bounded',async()=>{
 const state={images:0,clicks:0,sources:0,references:0};let count=0;
 const fetch=guardedFetch({nativeFetch:async()=>{count++;return Response.json({})},active:()=>state,fixtures:{responses:{'https://api.tvmaze.com/episodes/1':{id:1}},imageHosts:['static.tvmaze.com']},persist(){}});
 assert.deepEqual(await(await fetch('https://api.tvmaze.com/episodes/1')).json(),{id:1});assert.equal(count,0);
 await assert.rejects(fetch('https://unlisted.example/image.jpg'));assert.equal(count,0);
 for(let i=0;i<24;i++)await fetch('https://static.tvmaze.com/image.jpg');await assert.rejects(fetch('https://static.tvmaze.com/image.jpg'));assert.equal(count,24);
});
test('failed provider request consumes attempt and is not retried',async()=>{
 const state={images:0,clicks:0,sources:0,references:0};let count=0;
 const fetch=guardedFetch({nativeFetch:async()=>{count++;throw new Error('offline failure')},active:()=>state,fixtures:{responses:{},imageHosts:[]},persist(){}});
 await assert.rejects(fetch(imageUrl,image));assert.equal(count,1);assert.equal(state.images,1);
});
