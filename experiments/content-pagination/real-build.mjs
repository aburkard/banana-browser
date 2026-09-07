import {build} from 'esbuild';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const target=new URL('../../public/tmp/real-content-check/',import.meta.url);
if(process.argv.includes('--clean')){
 await rm(target,{recursive:true,force:true});console.log('Removed temporary real content check.');
}else{
 const manifestPath=process.argv[2];if(!manifestPath)throw new Error('Pass a real fixture manifest JSON path');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8')),base=path.dirname(path.resolve(manifestPath));
 const fixtures={scenarios:{},responses:{},imageHosts:manifest.referenceHosts??manifest.imageHosts??[],allowedDetailUrls:manifest.allowedDetailUrls??[]};
 for(const name of ['espn','tvmaze']){
  const item=manifest.scenarios?.[name]??manifest[name],file=item?.file??item?.path;if(!item?.url||!file)throw new Error('Missing real scenario fixture');
  fixtures.scenarios[name]={url:item.url,sha256:item.sha256,processedChars:item.processedChars,sections:item.sections};fixtures.responses[item.url]=JSON.parse(await readFile(path.resolve(base,file),'utf8'));
 }
 for(const [url,file] of Object.entries(manifest.responses??{}))fixtures.responses[url]=JSON.parse(await readFile(path.resolve(base,file),'utf8'));
 if(!fixtures.imageHosts.every(host=>typeof host==='string'&&!host.includes('/')&&!['api.openai.com','generativelanguage.googleapis.com'].includes(host)))throw new Error('Invalid reference allowlist');
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./real.mjs',import.meta.url))],bundle:true,platform:'browser',format:'iife',write:false,minify:true,define:{__REAL_FIXTURES__:JSON.stringify(fixtures)}});
 if(bundle.outputFiles.length!==1||bundle.outputFiles[0].text.includes('/@vite/client'))throw new Error('Unexpected bundle');
 await mkdir(target,{recursive:true});await writeFile(new URL('index.html',target),await readFile(new URL('./real.html',import.meta.url)));await writeFile(new URL('real.js',target),bundle.outputFiles[0].contents);
 console.log('http://127.0.0.1:5178/banana-browser/tmp/real-content-check/index.html');console.log('Run --clean before production build.');
}
