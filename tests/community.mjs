import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function communityChecks(browser,base,root){
 const out=[],ctx=await browser.newContext({viewport:{width:1280,height:900}}),page=await ctx.newPage(),errors=[],outside=[],payloads=[];
 let accepted=false;
 await ctx.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.protocol==='http:'&&u.origin===new URL(base).origin)return route.continue();if(u.hostname==='formsubmit.co'&&r.method()==='POST'){payloads.push(Object.fromEntries(new URLSearchParams(r.postData())));return route.fulfill({status:accepted?200:503,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({success:accepted})});}if(['http:','https:'].includes(u.protocol)){outside.push(r.url());return route.abort();}return route.continue();});
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=async(n,fn)=>{console.log('community:',n);try{await fn();out.push(['ok',n]);}catch(e){out.push(['FAIL',n,e.message]);}};
 try{
  await page.goto(base+'/index.html?lang=en');
  const version=await page.evaluate(()=>BApp.VERSION);
  await check('Version notice appears once without stealing focus; history remains available',async()=>{
   await page.waitForSelector('#updateNotice:not(.hidden)');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
   await page.click('#updateNoticeClose');await page.reload({waitUntil:'domcontentloaded'});assert(await page.locator('#updateNotice').evaluate(e=>e.classList.contains('hidden')));
   await page.click('#btnUpdatesStart');assert((await page.locator('#updatesHistory').textContent()).includes(version));assert((await page.locator('#updatesHistory .release-entry').count())>=12);await page.click('#updatesClose');
  });
  await check('Feedback/support and Star are available before loading pictures',async()=>{
   await page.click('#btnCommunity');assert.equal(await page.locator('#communityChoices [data-support="star"]').getAttribute('href'),'https://github.com/poplarity/BlotFigure');await page.click('#communityChoices [data-support="feedback"]');await page.waitForSelector('#feedbackDlg:not(.hidden)');
   const r=await page.locator('#feedbackMessage').boundingBox();assert(r.width>0&&r.x+r.width<=1280);
  });
  await check('Feedback failures retain drafts; successful explicit submissions contain no project data',async()=>{
   await page.fill('#feedbackMessage','Synthetic test feedback, do not deliver.');await page.fill('#feedbackEmail','tester@example.invalid');await page.click('#feedbackSend');await page.waitForFunction(()=>document.getElementById('feedbackStatus').classList.contains('error'));
   await page.click('#feedbackClose');await page.click('#communityChoices [data-support="feedback"]');assert.equal(await page.inputValue('#feedbackMessage'),'Synthetic test feedback, do not deliver.');accepted=true;
   await page.evaluate(()=>{const form=document.getElementById('feedbackForm');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
   await page.waitForFunction(()=>document.getElementById('feedbackStatus').classList.contains('success'));assert.equal(payloads.length,2);for(const p of payloads){assert.equal(p.version,version);assert(p._subject.startsWith('BlotFigure'));assert.deepEqual(Object.keys(p).sort(),['category','message','version','_subject','_url','_template','_honey','email'].sort());}
   await page.click('#feedbackClose');
  });
  await check('Support uses the existing configured destination and does not start payment',async()=>{
   await page.click('#communityChoices [data-support="sponsor"]');await page.waitForFunction(()=>document.getElementById('sponsorQr').src.startsWith('data:image/png'));
   assert(await page.evaluate(()=>document.getElementById('sponsorOpen').href===BlotFigureSupport.sponsor));assert.equal(outside.length,0);await page.click('#sponsorClose');await page.click('#communityClose');
  });
  await page.goto(base+'/index.html?demo=1&lang=en');await page.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});await page.evaluate(()=>{UI.openStep(5);PrefStorage.setItem('blotfig.preflight','0');});
  await check('Success reminders follow downloads and can reappear; failed exports show no reminder',async()=>{
   for(let i=0;i<2;i++){await page.click('#btnExportMenu');const wait=page.waitForEvent('download');await page.click('#btnSVG');await wait;await page.waitForSelector('#exportThanks:not(.hidden)');await page.click('#exportThanks .support-close');}
   await page.evaluate(()=>{window.originalSVG=Export.exportSVG;Export.exportSVG=()=>{throw Error('mock failed export');};});await page.click('#btnExportMenu');await page.click('#btnSVG');assert(await page.locator('#exportThanks').evaluate(e=>e.classList.contains('hidden')));await page.evaluate(()=>Export.exportSVG=originalSVG);
  });
  await check('Feedback and update UI never change WB geometry or selected exposures',async()=>{
   const before=await page.evaluate(()=>JSON.stringify(BApp.S));await page.click('#btnCommunity');await page.click('#communityClose');await page.click('#btnFile');await page.click('#btnUpdates');await page.click('#updatesClose');assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S)),before);
  });
  await check('Single-file offline history and feedback copy fallback remain available',async()=>{
   const p=await ctx.newPage();await p.goto(pathToFileURL(path.join(root,'dist/BlotFigure.html')).href+'?lang=en');await p.click('#btnUpdatesStart');assert(await p.locator('#updatesHistory').count());await p.click('#updatesClose');await p.click('#btnCommunity');await p.click('#communityChoices [data-support="feedback"]');assert(await p.locator('#feedbackSend').isDisabled());assert(await p.locator('#feedbackCopy').isVisible());await p.close();
  });
  await check('No automatic network requests or JavaScript errors',async()=>{assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);});
 }finally{await ctx.close();}
 return out;
}
