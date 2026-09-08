import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'vite';

const server = await createServer({optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true,watch:null,hmr:{server:createHttpServer()}}});
const {estimateImage25OutputCost} = await server.ssrLoadModule('/src/image25-cost.ts');
await server.close();

// Golden values evaluated from the official calculator asset, 2026-09-08.
const qualities = ['low', 'medium', 'high', 'xhigh', 'max'];
const examples = [
  [1024,1024,[196,439,1756,3122,7024]],
  [1536,1024,[158,343,1372,2459,5488]],
  [1920,1280,[197,428,1712,3067,6847]],
  [2560,1440,[205,478,1843,3276,7370]],
  [3840,2160,[371,865,3336,5930,13342]],
  [1024,800,[136,322,1286,2256,5075]],
];
test('matches published calculator at every quality and orientation', () => {
  for (const [width,height,tokens] of examples) {
    qualities.forEach((quality,index) => {
      const expected = {outputTokens:tokens[index],outputCostUsd:tokens[index]*30/1000000};
      assert.deepEqual(estimateImage25OutputCost(width,height,quality),expected);
      assert.deepEqual(estimateImage25OutputCost(height,width,quality),expected);
    });
  }
});
test('rejects invalid dimensions and quality instead of showing a false price', () => {
  for (const [width,height] of [[0,1024],[NaN,1024],[1024.5,1024],[1025,1024],[512,512],[4096,2048],[3072,3072],[3072,768]]) {
    assert.throws(() => estimateImage25OutputCost(width,height,'low'),RangeError);
  }
  assert.throws(() => estimateImage25OutputCost(1024,1024,'auto'),RangeError);
});
