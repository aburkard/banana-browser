import test from 'node:test';
import assert from 'node:assert/strict';
import {articleGuard} from './article-fix-guard.mjs';
test('article transport permits two bounded image attempts and no clicks',async()=>{
 const state={images:0,references:0,stopped:false};let calls=0;
 const fetch=articleGuard({nativeFetch:async()=>{calls++;return Response.json({})},state,persist(){},referenceHosts:['static.tvmaze.com']});
 const url='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',options={body:JSON.stringify({generationConfig:{maxOutputTokens:2048,candidateCount:1,imageConfig:{imageSize:'1K'}}})};
 await fetch(url,options);await fetch(url,options);await assert.rejects(fetch(url,options));assert.equal(calls,2);
 await assert.rejects(fetch('https://api.openai.com/v1/responses',{}));assert.equal(calls,2);state.stopped=true;await assert.rejects(fetch('https://static.tvmaze.com/a.jpg'));assert.equal(calls,2);
});
test('failed image request is counted once without retry',async()=>{
 const state={images:0,references:0,stopped:false};let calls=0;
 const fetch=articleGuard({nativeFetch:async()=>{calls++;throw new Error('offline error')},state,persist(){},referenceHosts:[]});
 await assert.rejects(fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',{body:JSON.stringify({generationConfig:{maxOutputTokens:2048,candidateCount:1,imageConfig:{imageSize:'1K'}}})}));assert.equal(calls,1);assert.equal(state.images,1);
});
