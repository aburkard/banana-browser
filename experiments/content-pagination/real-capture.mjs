import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../../',import.meta.url));
export const SOURCES=Object.freeze([
 {name:'espn',url:'https://content.core.api.espn.com/v1/sports/news/49825684',path:'espn.json'},
 {name:'tvmaze',url:'https://api.tvmaze.com/seasons/3116/episodes',path:'tvmaze.json'},
]);
async function boundedBody(response){
 const reader=response.body?.getReader();if(!reader)throw new Error('Missing source body');
 const chunks=[];let total=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>2*1024*1024)throw new Error('Source exceeds 2 MiB limit');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks,total);
}
export async function capture({fetchImpl=globalThis.fetch,outputDirectory=path.join(root,'tmp/real-content-fixtures')}={}){
 const compiled=await build({stdin:{contents:"export {processApiResponse} from './src/api-processors.ts'; export {sourceSections} from './src/source-sections.ts';",resolveDir:root,loader:'js'},bundle:true,platform:'node',format:'esm',write:false});
 const {processApiResponse,sourceSections}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
 const records=[];
 // Exactly these two public requests on success; no retries, redirects or detail prefetch.
 for(const source of SOURCES){
  const response=await fetchImpl(source.url,{signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw new Error(`Public source HTTP ${response.status}`);
  const bytes=await boundedBody(response),raw=JSON.parse(bytes.toString('utf8'));
  const processed=processApiResponse(source.url,raw),sections=sourceSections(processed);
  records.push({source,bytes,processed,metric:{...source,sha256:createHash('sha256').update(bytes).digest('hex'),rawBytes:bytes.length,processedChars:JSON.stringify(processed).length,sections:sections.length,sectionLengths:sections.map(part=>part.length)}});
 }
 const detailUrls=new Set(),referenceHosts=new Set(['a.espncdn.com','espnmedia-cdn.akamaized.net','static.tvmaze.com']);
 function collect(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
   if(key==='apiUrl'&&typeof item==='string'&&/^https:\/\/api\.tvmaze\.com\/episodes\/\d+$/.test(item))detailUrls.add(item);
   if(key==='imageUrl'&&typeof item==='string'){try{const url=new URL(item);if(url.protocol==='https:'&&!url.username&&!url.password)referenceHosts.add(url.hostname);}catch{}}
   if(item&&typeof item==='object')collect(item);
  }
 }
 records.forEach(record=>collect(record.processed));
 const manifest={capturedAt:new Date().toISOString(),...Object.fromEntries(records.map(record=>[record.source.name,record.metric])),details:{},referenceHosts:[...referenceHosts],sources:records.map(record=>record.metric),allowedDetailUrls:[...detailUrls]};
 // Do not replace existing evidence until both captures and processing succeeded.
 await mkdir(outputDirectory,{recursive:true});
 for(const record of records)await writeFile(path.join(outputDirectory,record.source.path),record.bytes);
 await writeFile(path.join(outputDirectory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const manifest=await capture();
 console.log(JSON.stringify({manifest:'tmp/real-content-fixtures/manifest.json',sources:manifest.sources.map(({name,rawBytes,sections,sha256})=>({name,rawBytes,sections,sha256})),detailTargets:manifest.allowedDetailUrls.length},null,2));
}
