import {BananaBrowser} from '../../src/browser.ts';
import {sourceSections} from '../../src/source-sections.ts';
const lock='banana-pagination-acceptance-v1';
const $=selector=>document.querySelector(selector);
const button=$('#generate'),canvas=$('#last');
const report={state:'ready',imageAttempts:0,imageFetchAttempts:0,clickAttempts:0,checks:[],timings:[],usage:null};
let app,ready=false,started=false,selectedSource='';
const fixture={title:'FIELD GUIDE',items:Array.from({length:18},(_,i)=>({
  id:i+101,title:`Station ${String(i+1).padStart(2,'0')}`,apiUrl:`https://api.tvmaze.com/shows/${i+101}`,
  summary:('Field observations recorded at this station. Local walks, plants, maps and visitor information are available. ').repeat(9)
}))};
const sections=sourceSections(fixture);
const persist=()=>{report.usage=app?.state.usage??null;$('#report').textContent=JSON.stringify(report,null,2);localStorage.setItem(lock,JSON.stringify(report));};
const saved=localStorage.getItem(lock);
button.disabled=!!saved||!localStorage.getItem('gemini_api_key')||!localStorage.getItem('openai_api_key');
if(saved){$('#report').textContent=saved;$('#status').textContent='Already attempted. Review saved results.';}
const nativeFetch=globalThis.fetch.bind(globalThis);
function verifySource(text,label){
  const matches=text.includes(selectedSource);
  report.checks.push({label,section:sections.indexOf(selectedSource),sourceChars:selectedSource.length,sourceMatches:matches});
  if(!matches)throw new Error('Source mismatch');
}
button.onclick=async()=>{
  if(started||localStorage.getItem(lock)||button.disabled)return;
  started=true;button.disabled=true;report.state='running';persist();
  try{
    if(sections.length<2||sections.length>4)throw new Error('Unexpected section count');
    app=new BananaBrowser(localStorage.getItem('gemini_api_key'),localStorage.getItem('openai_api_key'),'flash-2');
    app.setImageOptions({size:'512',thinkingLevel:'minimal'});
    app.setClickModel('gpt-5.6-luna');app.setClickOptions({reasoningEffort:'low'});
    app.setStyle('A clean white directory with dark navy text and green accents. Show a grid of clearly labeled cards using each exact Station title and a brief summary. Keep labels large and legible.');
    app.logImage=()=>{};
    const generate=app.geminiAI.models.generateContent.bind(app.geminiAI.models);
    app.geminiAI.models.generateContent=async args=>{
      if(report.imageAttempts>=2||args.model!=='gemini-3.1-flash-image')throw new Error('Image limit');
      verifySource(args.contents.filter(p=>p.text).map(p=>p.text).join('\n'),'image');
      report.imageAttempts++;persist();
      const start=performance.now();
      try{return await generate({...args,config:{...args.config,candidateCount:1,maxOutputTokens:2048,httpOptions:{timeout:90000}}});}
      finally{report.timings.push({kind:'image',section:sections.indexOf(selectedSource),elapsedMs:Math.round(performance.now()-start)});persist();}
    };
    globalThis.fetch=async(url,options)=>{
      const target=String(url);
      if(target.startsWith('https://generativelanguage.googleapis.com/')&&target.includes(':generateContent')){
        if(report.imageFetchAttempts>=2)throw new Error('Image network limit');
        report.imageFetchAttempts++;persist();return nativeFetch(url,options);
      }
      if(target!=='https://api.openai.com/v1/responses'||report.clickAttempts>=1)throw new Error('Unexpected request');
      const body=JSON.parse(options.body);
      if(body.model!=='gpt-5.6-luna')throw new Error('Unexpected model');
      verifySource(body.input[0].content.filter(p=>p.type==='input_text').map(p=>p.text).join('\n'),'click');
      report.clickAttempts++;persist();
      return nativeFetch(url,{...options,body:JSON.stringify({...body,max_output_tokens:512}),signal:AbortSignal.timeout(60000)});
    };
    app.state.currentUrl='https://api.tvmaze.com/search/shows?q=fixture';app.state.currentApiData=fixture;
    app.sections=sections.map(source=>({source,images:[],scrollIndex:0}));app.state.sectionCount=sections.length;
    selectedSource=sections[0];app.activeSource=selectedSource;
    verifySource(app.buildImagePrompt(app.state.currentUrl,fixture),'first prompt');
    $('#status').textContent='Generating first section';
    const first=await app.generatePageImage(app.state.currentUrl,fixture);
    app.sections[0].images=[first];app.state.currentImage=first;app.sessionImage=first;app.scrollStack=[first];$('#first').src=first;
    selectedSource=sections.at(-1);$('#status').textContent='Generating last section';
    await app.changeSection(sections.length-1);
    if(app.state.error||app.state.sectionIndex!==sections.length-1)throw new Error('Section change failed');
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=app.state.currentImage;});
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
    $('#targets').textContent='Last-section targets: '+fixture.items.filter(item=>selectedSource.includes(item.apiUrl)).map(item=>`${item.title} → ${item.apiUrl}`).join('\n');
    report.sectionCount=sections.length;report.state='awaiting-selected-click';persist();ready=true;$('#status').textContent='Inspect both images, then click one visible card in the last section. One paid click only.';
  }catch{report.state='stopped';persist();$('#status').textContent='Stopped without retry. A failed request may still be billed.';globalThis.fetch=nativeFetch;}
};
canvas.onclick=async event=>{
  if(!ready)return;ready=false;
  const box=canvas.getBoundingClientRect();
  const x=Math.round((event.clientX-box.left)*canvas.width/box.width),y=Math.round((event.clientY-box.top)*canvas.height/box.height);
  report.selectedCoordinate={x,y};report.state='checking-click';persist();$('#status').textContent='Checking selected card';
  const start=performance.now();
  try{
    const result=await app.interpretClick(x,y);
    report.result={action:result.action,url:result.url};report.exactSectionTarget=fixture.items.some(item=>item.apiUrl===result.url&&selectedSource.includes(item.apiUrl));
    report.state='completed';$('#status').textContent='Completed. Compare returned URL with the card you selected.';
  }catch{report.state='stopped';$('#status').textContent='Click stopped without retry.';}
  finally{report.timings.push({kind:'click',elapsedMs:Math.round(performance.now()-start)});persist();globalThis.fetch=nativeFetch;}
};
function download(filename,url){const link=document.createElement('a');link.download=filename;link.href=url;link.click();}
$('#save-json').onclick=()=>{
  const text=$('#report').textContent;if(!text)return;
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));download('pagination-acceptance-results.json',url);setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('#save-first').onclick=()=>{if($('#first').src?.startsWith('data:image/'))download('pagination-first.png',$('#first').src);};
$('#save-last').onclick=()=>{if(canvas.width&&app?.state.currentImage)download('pagination-last.png',canvas.toDataURL('image/png'));};
