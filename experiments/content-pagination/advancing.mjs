import {BananaBrowser} from '../../src/browser.ts';
import {processApiResponse} from '../../src/api-processors.ts';
import {sourceSections} from '../../src/source-sections.ts';
import {normalizeUsage,estimateUsageCost} from '../../src/usage.ts';
import {articleGuard} from './article-fix-guard.mjs';
import {readableSource} from './readable-source.mjs';
import {advancingSources} from './advancing-source.mjs';
const fixture=__ARTICLE_FIXTURE__,experiment=__ADVANCING_CONFIG__,lock=experiment.lock;
const $=s=>document.querySelector(s),nativeFetch=globalThis.fetch.bind(globalThis),canvas=$('#image');
const headings=source=>{
 const strings=[];function visit(value){if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(visit);}visit(JSON.parse(source));
 return strings.flatMap(text=>[...text.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(match=>match[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()));
};
const data=processApiResponse(fixture.url,fixture.data),sections=sourceSections(data);
const index=sections.findIndex(source=>headings(source).some(heading=>/Jacksonville/i.test(heading))),originalSource=sections[index];
const windows=originalSource?advancingSources(readableSource(originalSource),experiment.targetChars):[];
if(windows.length>experiment.maxImages)throw new Error(`Fixture needs ${windows.length} images, exceeding the ${experiment.maxImages}-image cap`);
let cursor=0,source=windows[0];
if(source)sections[index]=source;
const report={variant:experiment.sizing?'advancing-size':'advancing-source',targetChars:experiment.targetChars,maxImages:experiment.maxImages,originalSourceChars:originalSource?.length,windowCount:windows.length,state:'ready',images:0,references:0,stopped:false,section:index,sectionCount:sections.length,teamHeadings:originalSource?headings(originalSource):[],fixtureHash:fixture.sha256,checks:[],usage:[],timings:[]};
let app,busy=false,started=false;
function persist(){$('#report').textContent=JSON.stringify(report,null,2);localStorage.setItem(lock,JSON.stringify(report));}
$('#experiment-summary').textContent=`Jacksonville · ${experiment.targetChars}-character target · ${windows.length} passages · ${experiment.maxImages} images maximum · no clicks or retries`;
$('#headings').textContent=`Source section ${index+1}/${sections.length}; team headings: ${report.teamHeadings.join(' · ')}`;
const saved=localStorage.getItem(lock);$('#generate').disabled=!!saved||!source||!localStorage.getItem('gemini_api_key');
if(saved){$('#report').textContent=saved;$('#status').textContent='Already attempted. Review saved evidence.';}
async function display(){const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=app.state.currentImage});canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);report.scroll=app.state.scrollIndex;report.cursor=cursor;persist();}
async function step(name,work){
 busy=true;report.state=name;persist();$('#status').textContent=name;const start=performance.now();
 try{await work();if(app.state.error)throw new Error(app.state.error);await display();report.state=cursor===windows.length-1?'completed':'awaiting-scroll';$('#status').textContent=`Passage ${cursor+1}/${windows.length} · ${report.images}/${experiment.maxImages} image calls · ${report.state}`;}
 catch(error){const message=String(error?.message??'');report.stopped=true;report.state='stopped';report.error=/timeout|abort/i.test(message)?'timeout':/source/i.test(message)?'source mismatch':'image request failed';$('#status').textContent=`Stopped: ${report.error}. No retry.`;globalThis.fetch=nativeFetch;}
 finally{report.timings.push({step:name,elapsedMs:Math.round(performance.now()-start)});persist();busy=false;}
}
$('#generate').onclick=async()=>{
 if(started||busy||$('#generate').disabled||localStorage.getItem(lock))return;started=true;$('#generate').disabled=true;persist();
 app=new BananaBrowser(localStorage.getItem('gemini_api_key'),undefined,'flash-2');app.setImageOptions({size:'1K',thinkingLevel:'minimal'});app.logImage=()=>{};
 app.setStyle('A clean legible editorial website. White background, dark navy text, large clear headlines and navigation labels. Preserve the article wording and use the real source photographs.');
 const buildPrompt=app.buildImagePrompt.bind(app);
 app.buildImagePrompt=(...args)=>buildPrompt(...args)+'\n# CONTENT WINDOW\nThe story contains only the next passage assigned to this view. Render its wording in order. contentWindow.previousContext is preceding text for continuity only, not a passage to repeat in full. Keep the existing visual overlap, then advance into the current story passage. Render link labels, not Markdown syntax or URL strings. Do not revisit earlier passages. When contentWindow.hasMore is false, finish this passage and show End of section.';
 app.state.currentUrl=fixture.url;app.state.currentApiData=data;app.state.sectionIndex=index;app.state.sectionCount=sections.length;app.activeSource=source;app.sections=sections.map(text=>({source:text,images:[],scrollIndex:0}));
 const generate=app.geminiAI.models.generateContent.bind(app.geminiAI.models);
 app.geminiAI.models.generateContent=async args=>{
  const text=args.contents.filter(part=>part.text).map(part=>part.text).join('\n');const matches=text.includes(source)&&app.activeSource===source;
  report.checks.push({kind:'input-source',matches,cursor,sourceChars:source.length,window:JSON.parse(source).contentWindow,scrollPrompt:text.includes('# SCROLL CONTEXT'),imageParts:args.contents.filter(part=>part.inlineData).length});persist();if(!matches)throw new Error('Source mismatch');
  return generate({...args,config:{...args.config,candidateCount:1,maxOutputTokens:2048,httpOptions:{timeout:90000}}});
 };
 const track=app.trackUsage.bind(app);app.trackUsage=(kind,raw)=>{track(kind,raw);const usage=normalizeUsage(raw,'gemini');report.usage.push({usage,cost:estimateUsageCost(usage,BananaBrowser.PRICING['flash-2'],'image')});persist();};
 globalThis.fetch=articleGuard({nativeFetch,state:report,persist,referenceHosts:fixture.referenceHosts,maxImages:experiment.maxImages});
 await step('generate',async()=>{const matches=app.buildImagePrompt(fixture.url,data).includes(source);report.checks.push({kind:'prompt-source',matches});if(!matches)throw new Error('Source mismatch');const image=await app.generatePageImage(fixture.url,data);app.state.currentImage=image;app.sessionImage=image;app.scrollStack=[image];app.sections[index].images=[image];app.state.scrollDepth=1;});
 $('#scroll').disabled=report.stopped||cursor===windows.length-1;
};
$('#scroll').onclick=async()=>{
 if(!started||busy||report.stopped||$('#scroll').disabled||cursor+1>=windows.length)return;$('#scroll').disabled=true;
 const previous=source;cursor++;source=windows[cursor];app.activeSource=source;
 await step('scroll',async()=>{await app.scrollDown();const matches=app.activeSource===source&&source!==previous;report.checks.push({kind:'scroll-source-advanced',matches,cursor});if(!matches)throw new Error('Source mismatch');});
 $('#scroll').disabled=report.stopped||cursor===windows.length-1;$('#history').disabled=report.stopped;
};
$('#history').onclick=async()=>{
 if(!started||busy||report.stopped||cursor<1)return;
 const image=app.state.currentImage,count=report.images,expectedSource=source;
 await step('history',async()=>{await app.scrollUp();app.activeSource=windows[cursor-1];await app.scrollDown();app.activeSource=expectedSource;
 const matches=app.state.currentImage===image&&report.images===count&&app.activeSource===expectedSource;
 report.checks.push({kind:'cached-up-down',matches,noCalls:report.images===count});if(!matches)throw new Error('Cached source mismatch');});
};
function download(name,url){const link=document.createElement('a');link.download=name;link.href=url;link.click();}
$('#save-json').onclick=()=>{const text=$('#report').textContent;if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));download(experiment.sizing?`advancing-size-${experiment.targetChars}-results.json`:'advancing-results.json',url);setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#save-image').onclick=()=>{if(app?.state.currentImage)download(`advancing-${experiment.targetChars}-passage-${cursor}.png`,canvas.toDataURL('image/png'));};
