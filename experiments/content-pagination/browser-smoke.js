async (page) => {
  const context = await page.context().browser().newContext({viewport:{width:1280,height:1000}});
  const testPage = await context.newPage();
  const images=[],clicks=[];
  const fail = message => {throw new Error(message)};
  const check=(condition,message)=>{if(!condition)fail(message)};
  try {
    const b64Images=await testPage.evaluate(()=>Array.from({length:12},(_,i)=>{const c=document.createElement('canvas');c.width=960;c.height=640;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,960,640);x.fillStyle='#182f4a';x.font='32px sans-serif';x.fillText('Browser interaction test — simulated image',30,70);x.font='22px sans-serif';x.fillText('Section controls and history use real app handlers.',30,125);x.fillText('Simulated generation '+(i+1),30,180);return c.toDataURL().split(',')[1]}));
    await context.addInitScript(()=>{localStorage.setItem('openai_api_key','banana-offline-test');localStorage.setItem('banana_connection','api')});
    await context.route('**/*',async route=>{
      const request=route.request(),url={hostname:request.url().split('/')[2],pathname:'/'+request.url().split('/').slice(3).join('/')};
      if(url.hostname==='127.0.0.1:5178') return route.continue();
      if(url.hostname==='api.tvmaze.com') {
        const n=url.pathname.includes('/1/')?90:1;
        return route.fulfill({json:Array.from({length:n},(_,i)=>({id:i+1,name:`Episode ${i+1}`,number:i+1,season:1,url:`https://www.tvmaze.com/episodes/${i+1}`,summary:('<p>Retained story for this episode. '.repeat(30))+'</p>',image:null}))});
      }
      if(url.hostname==='api.openai.com'&&url.pathname.startsWith('/v1/images/')) {
        const raw=request.postData()||'';
        const prompt=url.pathname.endsWith('generations')?JSON.parse(raw).prompt:raw.match(/name="prompt"\r\n\r\n([\s\S]*?)\r\n--/)?.[1];
        check(!!prompt,'image prompt missing');images.push(prompt.replace(/\r\n/g,"\n"));
        return route.fulfill({json:{data:[{b64_json:b64Images[images.length-1]}]}});
      }
      if(url.hostname==='api.openai.com'&&url.pathname==='/v1/responses') {clicks.push(JSON.parse(request.postData()));return route.fulfill({json:{output:[{type:'message',content:[{type:'output_text',text:'{"action":"none","reason":"Verified test click"}'}]}]}})}
      return route.abort();
    });
    await testPage.goto('http://127.0.0.1:5178/banana-browser/');
    const ready=async()=>{await testPage.waitForFunction(()=>document.querySelector('#go-btn')&&!document.querySelector('#go-btn').disabled&&!document.querySelector('.loading-overlay'));await testPage.waitForFunction(()=>document.querySelectorAll('#viewport canvas').length===1)};
    const click=async selector=>{await testPage.locator(selector).click();await ready()};
    await testPage.locator('#url-input').fill('https://api.tvmaze.com/seasons/1/episodes');await click('#go-btn');
    check(await testPage.locator('#section-controls').isVisible(),'section controls missing '+await testPage.locator('#status').textContent()+'; '+await testPage.locator('#section-position').textContent()+'; '+images.length+' '+images[0]?.slice(0,1000));
    const firstPosition=await testPage.locator('#section-position').textContent();
    await click('#scroll-down');check(images[1].includes('bottom ~20%'),'scroll overlap changed');
    await click('#next-section');
    const secondPosition=await testPage.locator('#section-position').textContent();
    check(!!images[2]?.includes('# DATA\n'),'Missing data in third image: '+JSON.stringify(images.map(s=>s.slice(0,600))));
    const sectionSource=images[2].split('# DATA\n')[1].split('\n\n# REMINDER')[0];
    await testPage.locator('#viewport canvas').click({position:{x:100,y:120}});await ready();
    check(clicks.length===1,'click call missing');
    check(clicks[0].input[0].content.some(p=>p.text?.includes(sectionSource)),'click source differs from image');
    check(clicks[0].input[0].content.some(p=>p.type==='input_image'&&p.image_url!==`data:image/png;base64,${b64Images[2]}`),'pointer screenshot not preserved');
    await click('#previous-section');await click('#next-section');check(images.length===3,'cached section generated again');
    await click('#scroll-down');
    await testPage.locator('#url-input').fill('https://api.tvmaze.com/seasons/2/episodes');await click('#go-btn');
    await click('#back-btn');check(await testPage.locator('#section-position').textContent()===secondPosition,'history section differs');
    await click('#previous-section');await click('#next-section');check(images.length===5,'history/cached scroll generated again');
    while(await testPage.locator('#next-section').isEnabled()) await click('#next-section');
    check(images.at(-1).includes('Episode 90'),'last episode unavailable');
    const lastPosition=await testPage.locator('#section-position').textContent();
    await testPage.screenshot({path:'/tmp/banana-pagination-ui.png',fullPage:true});
    return {firstPosition,secondPosition,lastPosition,imageCalls:images.length,clickCalls:clicks.length,allNetworkMocked:true,paidCalls:0,screenshot:'/tmp/banana-pagination-ui.png'};
  } catch(error) {throw new Error(String(error)+'; status='+await testPage.locator('#status').textContent()+'; position='+await testPage.locator('#section-position').textContent()+'; image calls='+images.length+'; clicks='+clicks.length+'; canvas count='+await testPage.locator('#viewport canvas').count())} finally {await context.close()}
}
