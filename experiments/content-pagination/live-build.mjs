import {build} from 'esbuild';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const target=new URL('../../public/tmp/pagination-check/',import.meta.url);
if(process.argv.includes('--clean')){
  await rm(target,{recursive:true,force:true});console.log('Removed temporary pagination check.');
}else{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('./live.mjs',import.meta.url))],bundle:true,platform:'browser',format:'iife',write:false,minify:true});
  const html=(await readFile(new URL('./live.html',import.meta.url),'utf8')).replace('<script type="module" src="./live.mjs"></script>','<script src="./live.js"></script>');
  if(bundle.outputFiles.length!==1||bundle.outputFiles[0].text.includes('/@vite/client'))throw new Error('Unexpected bundle');
  await mkdir(target,{recursive:true});await writeFile(new URL('index.html',target),html);await writeFile(new URL('live.js',target),bundle.outputFiles[0].contents);
  console.log('http://127.0.0.1:5178/banana-browser/tmp/pagination-check/index.html');
  console.log('Run --clean after collecting results, before production build.');
}
