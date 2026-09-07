import {BananaBrowser} from '../../src/browser.ts';
import {processApiResponse} from '../../src/api-processors.ts';
import {sourceSections} from '../../src/source-sections.ts';
import {normalizeUsage,estimateUsageCost} from '../../src/usage.ts';
import {articleGuard} from './article-fix-guard.mjs';
const fixture=__ARTICLE_FIXTURE__,lock='banana-article-fix-v1';
const $=s=>document.querySelector(s),nativeFetch=globalThis.fetch.bind(globalThis),canvas=$('#image');
const headings=source=>{
 const strings=[];function visit(value){if(typeof value==='string')strings.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(visit);}visit(JSON.parse(source));
 return strings.flatMap(text=>[...text.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(match=>match[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()));
};
const data=processApiResponse(fixture.url,fixture.data),sections=sourceSections(data);
const index=sections.findIndex(source=>headings(source).some(heading=>/Jacksonville/i.test(heading))),source=sections[index];
const report={state:'ready',images:0,references:0,stopped:false,section:index,sectionCount:sections.length,teamHeadings:source?headings(source):[],fixtureHash:fixture.sha256,checks:[],usage:[],timings:[]};
let app,busy=false,started=false,scrolled=false;
function persist(){$('#report').textContent=JSON.stringify(report,null,2);localStorage.setItem(lock,JSON.stringify(report));}
$('#headings').textContent=`Source section ${index+1}/${sections.length}; team headings: ${report.teamHeadings.join(' · ')}`;
const saved=localStorage.getItem(lock);$('#generate').disabled=!!saved||!source||!localStorage.getItem('gemini_api_key');
if(saved){$('#report').textContent=saved;$('#status').textContent='Already attempted. Review saved evidence.';}
async function display(){const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=app.state.currentImage});canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);report.scroll=app.state.scrollIndex;persist();}
async function step(name,work){
 busy=true;report.state=name;persist();$('#status').textContent=name;const start=performance.now();
 try{await work();if(app.state.error)throw new Error(app.state.error);await display();report.state=name==='scroll'?'completed':'awaiting-scroll';$('#status').textContent=`Section ${index+1}/${sections.length} · scroll ${report.scroll} · ${report.images}/2 image calls · ${report.state}`;}
 catch(error){const message=String(error?.message??'');report.stopped=true;report.state='stopped';report.error=/timeout|abort/i.test(message)?'timeout':/source/i.test(message)?'source mismatch':'image request failed';$('#status').textContent=`Stopped: ${report.error}. No retry.`;globalThis.fetch=nativeFetch;}
 finally{report.timings.push({step:name,elapsedMs:Math.round(performance.now()-start)});persist();busy=false;}
}
$('#generate').onclick=async()=>{
 if(started||busy||$('#generate').disabled||localStorage.getItem(lock))return;started=true;$('#generate').disabled=true;persist();
 app=new BananaBrowser(localStorage.getItem('gemini_api_key'),undefined,'flash-2');app.setImageOptions({size:'1K',thinkingLevel:'minimal'});app.logImage=()=>{};
 app.setStyle('A clean legible editorial website. White background, dark navy text, large clear headlines and navigation labels. Preserve the article wording and use the real source photographs.');
 app.state.currentUrl=fixture.url;app.state.currentApiData=data;app.state.sectionIndex=index;app.state.sectionCount=sections.length;app.activeSource=source;app.sections=sections.map(text=>({source:text,images:[],scrollIndex:0}));
 const generate=app.geminiAI.models.generateContent.bind(app.geminiAI.models);
 app.geminiAI.models.generateContent=async args=>{
  const text=args.contents.filter(part=>part.text).map(part=>part.text).join('\n');const matches=text.includes(source)&&app.activeSource===source;
  report.checks.push({kind:'input-source',matches,sourceChars:source.length,teamHeadings:headings(app.activeSource),scrollPrompt:text.includes('# SCROLL CONTEXT'),imageParts:args.contents.filter(part=>part.inlineData).length});persist();if(!matches)throw new Error('Source mismatch');
  return generate({...args,config:{...args.config,candidateCount:1,maxOutputTokens:2048,httpOptions:{timeout:90000}}});
 };
 const track=app.trackUsage.bind(app);app.trackUsage=(kind,raw)=>{track(kind,raw);const usage=normalizeUsage(raw,'gemini');report.usage.push({usage,cost:estimateUsageCost(usage,BananaBrowser.PRICING['flash-2'],'image')});persist();};
 globalThis.fetch=articleGuard({nativeFetch,state:report,persist,referenceHosts:fixture.referenceHosts});
 await step('generate',async()=>{const matches=app.buildImagePrompt(fixture.url,data).includes(source);report.checks.push({kind:'prompt-source',matches});if(!matches)throw new Error('Source mismatch');const image=await app.generatePageImage(fixture.url,data);app.state.currentImage=image;app.sessionImage=image;app.scrollStack=[image];app.sections[index].images=[image];app.state.scrollDepth=1;});
 $('#scroll').disabled=report.stopped;
};
$('#scroll').onclick=async()=>{
 if(!started||busy||scrolled||report.stopped||$('#scroll').disabled)return;scrolled=true;$('#scroll').disabled=true;
 await step('scroll',async()=>{await app.scrollDown();const matches=app.activeSource===source;report.checks.push({kind:'scroll-source-unchanged',matches});if(!matches)throw new Error('Source mismatch');});globalThis.fetch=nativeFetch;
};
function download(name,url){const link=document.createElement('a');link.download=name;link.href=url;link.click();}
$('#save-json').onclick=()=>{const text=$('#report').textContent;if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));download('article-fix-results.json',url);setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#save-image').onclick=()=>{if(app?.state.currentImage)download(`article-fix-section-${index}-scroll-${app.state.scrollIndex}.png`,canvas.toDataURL('image/png'));};
