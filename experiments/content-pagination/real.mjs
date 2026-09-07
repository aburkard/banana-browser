import {BananaBrowser} from '../../src/browser.ts';
import {normalizeUsage,estimateUsageCost} from '../../src/usage.ts';
import {guardedFetch} from './real-guard.mjs';
const fixtures=__REAL_FIXTURES__;
const $=s=>document.querySelector(s),canvas=$('#image'),nativeFetch=globalThis.fetch.bind(globalThis);
let current=null,app=null,busy=false,steps=new Set(),beforeClick=null;
const reports={},prefix='banana-real-content-v1-';
function persist(){if(current){reports[current.scenario]=current;localStorage.setItem(prefix+current.scenario,JSON.stringify(current));$('#view-state').textContent=`${current.scenario} · section ${(app?.state.sectionIndex??0)+1}/${app?.state.sectionCount??'?'} · scroll ${app?.state.scrollIndex??0} · images ${current.images}/4 · clicks ${current.clicks}/1 · ${current.state}${current.error?' · '+current.error.category:''}`;}$('#report').textContent=JSON.stringify(reports,null,2);}
for(const scenario of ['espn','tvmaze']){const saved=localStorage.getItem(prefix+scenario);if(saved)reports[scenario]=JSON.parse(saved);$('#'+scenario).disabled=!!saved||!localStorage.getItem('gemini_api_key')||!localStorage.getItem('openai_api_key');}
persist();
function snapshot(){return{url:app.state.currentUrl,section:app.state.sectionIndex,sections:app.state.sectionCount,scroll:app.state.scrollIndex,source:app.activeSource,image:app.state.currentImage};}
function compare(a,b){return a.url===b.url&&a.section===b.section&&a.scroll===b.scroll&&a.source===b.source&&a.image===b.image;}
async function display(){
 if(app.state.currentImage){const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=app.state.currentImage});canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);}
 $('#source').textContent=(app.activeSource??'').slice(0,1200);
 current.view={url:app.state.currentUrl,section:app.state.sectionIndex,sections:app.state.sectionCount,scroll:app.state.scrollIndex,sourceChars:app.activeSource?.length??0};persist();
}
async function step(label,work){
 if(!current||current.stopped||busy||steps.has(label))return;
 busy=true;steps.add(label);$('#status').textContent=label;const start=performance.now();
 try{await work();if(app.state.error)throw new Error(app.state.error);await display();current.state='ready';$('#status').textContent='Ready for next selected step';}
 catch(error){const message=String(error?.message??'');const code=message.match(/(?:status|code|HTTP)[^\d]{0,8}(\d{3})/i)?.[1];const category=/timeout|abort/i.test(message)?'timeout':/limit/i.test(message)?'attempt limit':/allowlist/i.test(message)?'URL not allowed':/source|split/i.test(message)?'source mismatch':/history/i.test(message)?'history mismatch':/did not navigate/i.test(message)?'click did not navigate':'provider or navigation error';current.error={category,...(code?{httpStatus:Number(code)}:{})};current.stopped=true;current.state='stopped';$('#status').textContent=`Scenario stopped: ${category}${code?' (HTTP '+code+')':''}. No retry; request may be billed.`;}
 finally{current.timings.push({step:label,elapsedMs:Math.round(performance.now()-start)});persist();busy=false;}
}
async function start(scenario){
 if(current||busy||localStorage.getItem(prefix+scenario)||$('#'+scenario).disabled)return;
 current={scenario,fixture:fixtures.scenarios[scenario],state:'started',stopped:false,images:0,clicks:0,sources:0,details:0,references:0,checks:[],usage:[],timings:[]};steps=new Set();beforeClick=null;persist();$('#'+scenario).disabled=true;
 app=new BananaBrowser(localStorage.getItem('gemini_api_key'),localStorage.getItem('openai_api_key'),'flash-2');
 app.setImageOptions({size:'1K',thinkingLevel:'minimal'});app.setClickModel('gpt-5.6-luna');app.setClickOptions({reasoningEffort:'low'});app.logImage=()=>{};
 app.setStyle('A clean legible editorial website. White background, dark navy text, large clear headlines and navigation labels. Preserve the article wording and use the real source photographs.');
 const generate=app.geminiAI.models.generateContent.bind(app.geminiAI.models);
 app.geminiAI.models.generateContent=async args=>{
  if(args.model!=='gemini-3.1-flash-image')throw new Error('Unexpected model');
  const text=args.contents.filter(part=>part.text).map(part=>part.text).join('\n');
  const matches=text.includes(app.activeSource);current.checks.push({kind:'image-source',matches,sourceChars:app.activeSource.length,marker:app.activeSource.slice(-180),scrollPrompt:text.includes('# SCROLL CONTEXT'),imageParts:args.contents.filter(part=>part.inlineData).length});persist();
  if(!matches)throw new Error('Image source mismatch');
  return generate({...args,config:{...args.config,candidateCount:1,maxOutputTokens:2048,httpOptions:{timeout:90000}}});
 };
 const track=app.trackUsage.bind(app);app.trackUsage=(kind,raw)=>{track(kind,raw);const model=kind==='image'?'flash-2':'gpt-5.6-luna',usage=normalizeUsage(raw,kind==='image'?'gemini':'openai');current.usage.push({kind,model,usage,cost:estimateUsageCost(usage,BananaBrowser.PRICING[model],kind)});persist();};
 const transport=guardedFetch({nativeFetch,active:()=>current,fixtures,persist});
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.openai.com/v1/responses'){
   const body=JSON.parse(options.body),text=body.input[0].content.filter(part=>part.type==='input_text').map(part=>part.text).join('\n');
   const matches=text.includes(app.activeSource);current.checks.push({kind:'click-source',matches,sourceChars:app.activeSource.length});persist();if(!matches)throw new Error('Click source mismatch');
  }
  return transport(url,options);
 };
 await step('Navigate first section',()=>app.navigate(fixtures.scenarios[scenario].url));
}
$('#espn').onclick=()=>start('espn');$('#tvmaze').onclick=()=>start('tvmaze');
$('#later').onclick=()=>step('Navigate later source section',async()=>{if(app.state.sectionCount<2)throw new Error('Source did not split');const index=current.scenario==='espn'?Math.min(11,app.state.sectionCount-1):app.state.sectionCount-1;await app.changeSection(index);});
$('#scroll').onclick=()=>step('Scroll within source section',async()=>{const source=app.activeSource;await app.scrollDown();const matches=source===app.activeSource;current.checks.push({kind:'scroll-source-unchanged',matches});if(!matches)throw new Error('Scroll changed source');});
canvas.onclick=event=>{
 if(!current||current.scenario!=='tvmaze'||busy||current.stopped||steps.has('Select episode and navigate'))return;
 const box=canvas.getBoundingClientRect(),x=Math.round((event.clientX-box.left)*canvas.width/box.width),y=Math.round((event.clientY-box.top)*canvas.height/box.height);
 return step('Select episode and navigate',async()=>{beforeClick=snapshot();current.coordinate={x,y};await app.handleClick(x,y);current.navigation={from:beforeClick.url,to:app.state.currentUrl,changed:beforeClick.url!==app.state.currentUrl};if(!current.navigation.changed)throw new Error('Click did not navigate');});
};
$('#history').onclick=()=>step('Check history restore',async()=>{
 if(!beforeClick||beforeClick.url===app.state.currentUrl)throw new Error('No detail navigation');const detail=snapshot(),images=current.images,clicks=current.clicks;
 await app.goBack();const back=compare(beforeClick,snapshot());await app.goForward();const forward=compare(detail,snapshot());await app.goBack();const finalBack=compare(beforeClick,snapshot());
 const noCalls=images===current.images&&clicks===current.clicks;current.checks.push({kind:'history',back,forward,finalBack,noCalls});if(!back||!forward||!finalBack||!noCalls)throw new Error('History mismatch');
});
$('#done').onclick=()=>{if(!current||busy)return;current.state=current.stopped?'stopped':'finished';persist();current=null;app=null;globalThis.fetch=nativeFetch;$('#status').textContent='Scenario closed; its attempt ledger is retained.';};
function download(name,url){const link=document.createElement('a');link.download=name;link.href=url;link.click();}
$('#save-json').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(reports,null,2)],{type:'application/json'}));download('real-content-results.json',url);setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#save-image').onclick=()=>{if(current&&app.state.currentImage)download(`real-${current.scenario}-section-${app.state.sectionIndex}-scroll-${app.state.scrollIndex}.png`,canvas.toDataURL('image/png'));};
