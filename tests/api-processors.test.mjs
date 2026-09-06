import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {processHNFrontPage,processHNStoryWithComments}=await server.ssrLoadModule('/src/api-processors.ts');
await server.close();

const ask={id:42,title:'Ask HN: How do you organize a small library?',text:'<p>I have 200 books. What works for you?</p>',by:'reader',score:12,descendants:2,kids:[43,44]};

test('an HN detail page keeps the question body along with navigation and comments',()=>{
  const result=processHNStoryWithComments(ask,[{id:43,by:'librarian',text:'<p>Try sorting by subject.</p>'},{id:44,deleted:true}]);
  assert.equal(result.story.text,ask.text);
  assert.equal(result.story.apiUrl,'https://hacker-news.firebaseio.com/v0/item/42.json');
  assert.equal(result.story.commentCount,2);
  assert.deepEqual(result.comments,[{id:43,by:'librarian',text:'<p>Try sorting by subject.</p>'}]);
  assert.equal(result.story.kids,undefined);
});

test('front pages stay compact and linked stories need no body field',()=>{
  assert.equal(processHNFrontPage([ask]).stories[0].text,undefined);
  const linked=processHNStoryWithComments({id:50,title:'Article',url:'https://example.com/story'},[]);
  assert.equal(linked.story.url,'https://example.com/story');
  assert.equal(linked.story.text,undefined);
});
