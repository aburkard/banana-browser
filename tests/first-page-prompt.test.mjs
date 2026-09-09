import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as http} from 'node:http';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:http()}}});
const {BananaBrowser}=await server.ssrLoadModule('/src/browser.ts');
await server.close();
for (const withPhoto of [false,true]) test(`first-page request preserves webpage intent and source with photo=${withPhoto}`,async t=>{
 t.mock.method(console,'log',()=>{});
 const b=new BananaBrowser(undefined,'test','gpt-image-2.5-flare');
 const source={source:'Web',title:'Actual news',content:'Read the actual article, not just its photo.',links:[{title:'Next article',url:'https://example.com/next'}],...(withPhoto?{imageUrls:['https://example.com/person.jpg']}:{})};
 t.mock.method(b,'fetchApiData',async()=>source);
 t.mock.method(b,'fetchReferenceImages',async images=>images.map(image=>({...image,mimeType:'image/png',dataUrl:'data:image/png;base64,cGhvdG8='})));
 t.mock.method(b,'logImage',()=>{});
 const requests=[];
 t.mock.method(b,'openAIImageRequest',async(url,request)=>{requests.push({url,body:request.body instanceof FormData?request.body:JSON.parse(request.body)});return {data:[{b64_json:'aW1hZ2U='}]};});
 await b.navigate('https://example.com/');
 const first=requests[0];
 const prompt=first.body instanceof FormData?first.body.get('prompt'):first.body.prompt;
 assert.ok(prompt.startsWith('# TASK\nRender a webpage viewport'));
 assert.match(prompt,/# INITIAL VIEW/);
 assert.deepEqual(JSON.parse(prompt.split('# DATA\n')[1].split('\n\n# REMINDER')[0]),source);
 assert.equal(first.url,`https://api.openai.com/v1/images/${withPhoto?'edits':'generations'}`);
 if(withPhoto){assert.ok(prompt.indexOf('# REFERENCE IMAGES')>prompt.indexOf('# DATA'));assert.equal(first.body.getAll('image[]').length,1);}
 await b.scrollDown();
 const scroll=requests[1].body;
 assert.match(scroll.get('prompt'),/# SCROLL CONTEXT/);assert.doesNotMatch(scroll.get('prompt'),/# INITIAL VIEW/);
 assert.equal(scroll.getAll('image[]').length,withPhoto?2:1);
});
