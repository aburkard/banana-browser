import {build} from 'esbuild';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
const target=path.join(root,'public/tmp/conversation-v2');
if(process.argv.includes('--clean')){
  await rm(target,{recursive:true,force:true});
  console.log('Removed temporary standalone conversation harness.');
}else{
  const html=await readFile(new URL('./conversation.html',import.meta.url),'utf8');
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if(!script||!script[1].includes("const lockKey='banana-conversation-comparison-v1'"))throw new Error('Unexpected source harness');
  // Preserve the interrupted v1 ledger. This deliberate replacement has its own limit.
  const contents=script[1].replace("const lockKey='banana-conversation-comparison-v1'","const lockKey='banana-conversation-comparison-v2'");
  const bundle=await build({stdin:{contents,loader:'js',resolveDir:path.dirname(fileURLToPath(import.meta.url))},bundle:true,platform:'browser',format:'iife',write:false,minify:true,define:{'import.meta.env.DEV':'false'}});
  if(bundle.outputFiles.length!==1)throw new Error('Unexpected bundle outputs');
  const standalone=html.replace(script[0],'<script src="./conversation.js"></script>');
  if(standalone.includes('/@vite/client')||bundle.outputFiles[0].text.includes('/@vite/client'))throw new Error('HMR client must be absent');
  await mkdir(target,{recursive:true});
  await writeFile(path.join(target,'conversation.js'),bundle.outputFiles[0].contents);
  await writeFile(path.join(target,'index.html'),standalone);
  console.log('http://127.0.0.1:5178/banana-browser/tmp/conversation-v2/index.html');
  console.log('Temporary public/tmp files are git-ignored. Run --clean before a production build.');
}
