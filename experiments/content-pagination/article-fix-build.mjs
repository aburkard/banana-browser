import {build} from 'esbuild';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const target=new URL('../../public/tmp/article-fix-check/',import.meta.url);
if(process.argv.includes('--clean')){await rm(target,{recursive:true,force:true});console.log('Removed temporary article-fix check.');}
else{
 const manifestPath=process.argv[2];if(!manifestPath)throw new Error('Pass captured manifest path');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')),data=JSON.parse(await readFile(path.resolve(path.dirname(manifestPath),manifest.espn.path),'utf8'));
 const fixture={url:manifest.espn.url,sha256:manifest.espn.sha256,data,referenceHosts:manifest.referenceHosts};
 const result=await build({entryPoints:[fileURLToPath(new URL('./article-fix.mjs',import.meta.url))],bundle:true,format:'iife',platform:'browser',minify:true,write:false,define:{__ARTICLE_FIXTURE__:JSON.stringify(fixture)}});
 if(result.outputFiles.length!==1||result.outputFiles[0].text.includes('/@vite/client'))throw new Error('Unexpected bundle');
 await mkdir(target,{recursive:true});await writeFile(new URL('index.html',target),await readFile(new URL('./article-fix.html',import.meta.url)));await writeFile(new URL('article-fix.js',target),result.outputFiles[0].contents);
 console.log('http://127.0.0.1:5178/banana-browser/tmp/article-fix-check/index.html');console.log('Run --clean before production build.');
}
