import { build, transform } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const target = 'public/tmp/list-passages';
if (process.argv.includes('--clean')) { await rm(target, {recursive:true, force:true}); process.exit(0); }
await mkdir(target, {recursive:true});
await build({stdin:{contents:"export {BananaBrowser} from './src/browser'; export {processApiResponse} from './src/api-processors'; export {sourceSections} from './src/source-sections'; export {sourcePassages} from './src/source-passages';",resolveDir:process.cwd()},bundle:true,format:'esm',outfile:`${target}/app.js`});
const {processApiResponse,sourceSections,sourcePassages} = await import(pathToFileURL(resolve(`${target}/app.js`)));
const manifest = JSON.parse(await readFile('tmp/real-content-fixtures/manifest.json','utf8'));
const raw = await readFile('tmp/real-content-fixtures/tvmaze.json','utf8');
const sha256 = createHash('sha256').update(raw).digest('hex');
if (sha256 !== manifest.tvmaze.sha256) throw Error('Captured source hash changed');
const all = JSON.parse(raw);
let selected;
for (const count of [9,8,7]) {
  const fixture=all.slice(-count),processed=processApiResponse(manifest.tvmaze.url,fixture),sections=sourceSections(processed);
  if (sections.length !== 1) continue;
  const passages=sourcePassages(sections[0]).map(JSON.parse);
  if (passages.length === 3) { selected={fixture,passages,recordCount:count}; break; }
}
if (!selected) throw Error('Final 7–9 records do not fit exactly three production passages');
const {fixture,...selection}=selected;
await writeFile(`${target}/fixture.json`,JSON.stringify(fixture));
await writeFile(`${target}/manifest.json`,JSON.stringify({sourceUrl:manifest.tvmaze.url,capturedAt:manifest.capturedAt,sourceSha256:sha256,...selection},null,2));
await transform((await readFile('experiments/list-passages/index.html','utf8')).match(/<script type="module">([\s\S]*?)<\/script>/)[1],{format:'esm',target:'es2022'});
await copyFile('experiments/list-passages/index.html',`${target}/index.html`);
console.log(`Prepared ${selected.recordCount} final captured episodes, exactly three passages. Open /banana-browser/tmp/list-passages/index.html on existing app origin.`);
