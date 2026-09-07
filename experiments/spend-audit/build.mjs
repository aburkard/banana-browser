import {build} from 'esbuild';
import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const retained=process.argv.includes('--retained');
const target=`public/tmp/spend-audit${retained?'-retained':''}`;
if(process.argv.includes('--clean')){await rm(target,{recursive:true,force:true});process.exit(0)}
const baseline=execFileSync('git',['show','9867d72:src/browser.ts'],{encoding:'utf8'});
const old=await build({stdin:{contents:baseline,resolveDir:path.resolve('src'),sourcefile:'baseline.ts',loader:'ts'},bundle:true,format:'esm',write:false});
await mkdir(target,{recursive:true});await writeFile(`${target}/baseline.js`,old.outputFiles[0].contents);
const current=await build({entryPoints:['src/browser.ts'],bundle:true,format:'esm',write:false});await writeFile(`${target}/current.js`,current.outputFiles[0].contents);
const processors=await build({entryPoints:['src/api-processors.ts'],bundle:true,format:'esm',write:false});await writeFile(`${target}/processors.js`,processors.outputFiles[0].contents);
await writeFile(`${target}/fixture.json`,await readFile('tests/fixtures/api-examples/tv-search.json'));
await writeFile(`${target}/index.html`,(await readFile('experiments/spend-audit/index.html','utf8')).replace('__RETAINED_ONLY__',String(retained)).replace('Six Luna',retained?'Three Luna':'Six Luna'));
console.log(`http://127.0.0.1:5178/banana-browser/tmp/spend-audit${retained?'-retained':''}/index.html`);
