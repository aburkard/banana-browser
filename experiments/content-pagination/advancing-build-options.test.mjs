import assert from 'node:assert/strict';
import {test} from 'node:test';
import {advancingBuildOptions} from './advancing-build-options.mjs';

test('default experiment keeps its three-call cap, directory and persistent lock',()=>{
 assert.deepEqual(advancingBuildOptions([]),{targetChars:1400,sizing:false,maxImages:3,directory:'advancing-article-check',lock:'banana-advancing-article-v1'});
});
test('explicit sizing builds have isolated directories and locks and at most five calls',()=>{
 const settings=[1000,1400,2200].map(size=>advancingBuildOptions([`--target=${size}`]));
 assert.equal(new Set(settings.map(item=>item.directory)).size,3);
 assert.equal(new Set(settings.map(item=>item.lock)).size,3);
 for(const options of settings){assert.equal(options.maxImages,5);assert.equal(options.sizing,true);assert.equal(options.lock,`banana-advancing-size-v1-${options.targetChars}`);assert.equal(options.directory,`advancing-article-${options.targetChars}`);}
 for(const arg of ['--target=0','--target=8001','--target=1000.0','--target=NaN'])assert.throws(()=>advancingBuildOptions([arg]));
 assert.throws(()=>advancingBuildOptions(['--target=1000','--target=2200']));
});
