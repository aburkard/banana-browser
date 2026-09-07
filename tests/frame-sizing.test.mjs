import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';
import {Window} from 'happy-dom';

const server=await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {fitFrame,attachFrameSizing}=await server.ssrLoadModule('/src/frame-sizing.ts');
await server.close();
const chrome={width:38,height:190};
const fit=(ratio,availableWidth=1488,availableHeight=850)=>fitFrame({ratio,availableWidth,availableHeight,chromeAtWidth:()=>chrome});

test('landscape and square frames use the available height without wide desktop gutters',()=>{
  for(const ratio of [1.5,1]) {
    const result=fit(ratio);
    assert.equal(result.height,850);
    assert.equal(result.width,660*ratio+38);
    assert.equal(result.viewportWidth/result.viewportHeight,ratio);
  }
});

test('panoramas use available width and shrink the overall frame height',()=>{
  const result=fit(3);
  assert.equal(result.width,1488);
  assert.equal(result.height,190+1450/3);
  assert.ok(result.height<850);
});

test('portrait keeps controls usable while fitting the image in the available height',()=>{
  const result=fit(.5);
  assert.equal(result.width,520);
  assert.equal(result.height,850);
  assert.equal(result.viewportHeight,660);
  assert.ok(result.viewportWidth>result.viewportHeight*.5,'minimum control width leaves intentional side gutters');
});

test('mobile width caps the minimum and shrinks height when the image is width limited',()=>{
  const result=fit(1.5,378,780);
  assert.equal(result.width,378);
  assert.equal(result.viewportWidth,340);
  assert.equal(result.height,190+340/1.5);
  assert.ok(result.height<780);
});

test('wrapped controls are remeasured with bounded, monotonically shrinking widths',()=>{
  const widths=[];
  const result=fitFrame({ratio:1.5,availableWidth:1488,availableHeight:850,chromeAtWidth:width=>{
    widths.push(width);
    return {width:38,height:width<1100?250:190};
  }});
  assert.equal(result.width,938);
  assert.equal(result.height,850);
  assert.ok(widths.length<=7);
  assert.ok(widths.every((width,index)=>index===0||width<=widths[index-1]));
});

test('invalid dimensions stay finite and extremely short windows retain a usable image',()=>{
  const result=fitFrame({ratio:NaN,availableWidth:NaN,availableHeight:Infinity,chromeAtWidth:()=>({width:NaN,height:NaN})});
  assert.deepEqual(result,{width:0,height:0,viewportWidth:0,viewportHeight:0});
  const short=fit(1.5,378,100);
  assert.equal(short.viewportHeight,120);
  assert.equal(short.height,310);
});

test('short landscape windows return to full width when narrowing crowds out the image',()=>{
  const widths=[];
  const result=fitFrame({ratio:1.5,availableWidth:832,availableHeight:378,chromeAtWidth:width=>{
    widths.push(width);
    return {width:38,height:width<600?420:300};
  }});
  assert.equal(result.width,832);
  assert.equal(result.viewportHeight,120);
  assert.equal(result.height,420);
  assert.ok(widths.length<=8,'fallback adds only one bounded remeasurement');
});

test('attached sizing counts chrome overflowing a short frame before reserving image space',async t=>{
  const window=new Window();t.after(()=>window.happyDOM.close());
  window.document.body.innerHTML='<div id="app"><div class="browser-container"><div class="controls"></div><div class="viewport"></div></div></div>';
  const app=window.document.querySelector('#app');
  const container=app.firstElementChild;
  const viewport=container.lastElementChild;
  container.style.border='1px solid black';
  Object.defineProperties(app,{clientWidth:{value:832},clientHeight:{value:378}});
  const chromeHeight=()=>parseFloat(container.style.width)<600?420:300;
  t.mock.method(container,'getBoundingClientRect',()=>({width:parseFloat(container.style.width)||832,height:parseFloat(container.style.height)||378}));
  t.mock.method(viewport,'getBoundingClientRect',()=>({width:(parseFloat(container.style.width)||832)-38,height:Math.max(0,(parseFloat(container.style.height)||378)-chromeHeight())}));
  Object.defineProperty(container,'scrollHeight',{get:()=>Math.max(parseFloat(container.style.height)||378,chromeHeight())-2});
  let resize;
  t.mock.method(window,'requestAnimationFrame',callback=>{resize=callback;return 1;});
  const sizing=attachFrameSizing(container,viewport,app);
  resize();
  assert.equal(container.style.width,'832px');
  assert.equal(container.style.height,'420px');
  assert.equal(viewport.getBoundingClientRect().height,120);
  sizing.dispose();
});
