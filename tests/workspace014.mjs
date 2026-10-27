import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
export async function workspaceChecks(browser,base,root,engine){
 const ctx=await browser.newContext({viewport:{width:1600,height:1000}}),page=await ctx.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=async(n,fn)=>{try{await fn();results.push(['ok',n]);}catch(e){results.push(['FAIL',n,e.message]);}};
 const out=path.join(root,'test-results','workspace014',engine);fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(base+'/index.html?demo=1&lang=en');await page.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});
  await check('expected counts 2–6 do not change protein regions or force the real nine-lane demo',async()=>{
   const reports=await page.evaluate(()=>{
    const out=[];
    for(const n of[2,3,4,5,6,9]){BApp.setDefaultLaneCount(n);BApp.rebuildBoxes();BApp.commit();out.push({n,rows:BApp.S.rows.map(r=>({img:r.img,above:r.above,below:r.below,boxes:r.segs.map(s=>({p:s.piece,x0:s.x0,x1:s.x1,v:s.vc,rot:s.rot,lanes:s.lanes.map(l=>l.u)}))}))});}
    return out;
   });for(const r of reports){assert.equal(r.rows.length,5);assert(r.rows.every(r=>r.boxes[0].lanes.length===9));assert.deepEqual(r.rows,reports[0].rows);}
  });
  await check('one picture retains independent 8-, 4- and 6-lane regions for every count reference',async()=>{
   const all=await page.evaluate(()=>{
    const w=1040,h=360,data=new Float32Array(w*h),groups=[{y:85,xs:Array.from({length:8},(_,i)=>80+i*50)},{y:85,xs:[720,780,840,900]},{y:255,xs:[160,220,280,340,400,460]}];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=.02+.0003*Math.sin(x*2.7+y*.4);for(const g of groups)for(const cx of g.xs)v+=.55*Math.exp(-(((x-cx)/17)**6)-((y-g.y)/5)**2);data[y*w+x]=v;}
    const img={w,h,data};return [2,3,4,5,6].map(n=>{const a=WB.analyzeSession([{id:'mixed',img,cs:WB.chemiSignal(img)}],null,{strips:[{cx:520,cy:180,w:1020,h:340,angle:0}],laneCount:n,autoMarkerLanes:false,noCalib:true});return a.rows.map(r=>({x:r.ox,y:r.oy,n:r.segs[0].signalLanes?.length,lanes:r.segs[0].signalLanes}));});
   });for(const rows of all){assert.deepEqual(rows.map(r=>r.n),[8,4,6],JSON.stringify(rows));assert.deepEqual(rows,all[0]);}
  });
  await check('levels, image tabs and popovers stay usable at laptop widths and heights',async()=>{
   for(const size of [{width:1366,height:768},{width:1024,height:600},{width:900,height:600}]){
    await page.setViewportSize(size);await page.evaluate(()=>{UI.openStep(3);const r=BApp.S.rows[0];r.name='A very long protein name with an extended treatment label';BApp.selRow=r.id;BApp.viewBlot=r.blot;BApp.viewImg=r.img;BApp.commit();BApp.emit('select');});await page.waitForTimeout(120);
    const bad=await page.evaluate(()=>{const pane=document.getElementById('rawCol').getBoundingClientRect();return ['lvBlack','lvWhite','btnLvAuto','showSat','fitFull','fitSel'].filter(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.left<pane.left-1||r.right>pane.right+1||r.bottom>innerHeight;});});assert.deepEqual(bad,[],JSON.stringify(size));
    await page.evaluate(()=>UI.markerPopover(BApp.S.rows[0],{left:innerWidth-20,right:innerWidth-5,top:innerHeight-15,bottom:innerHeight-5}));
    const bounds=await page.locator('#popover').boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=size.width&&bounds.y+bounds.height<=size.height,JSON.stringify(bounds));
    await page.locator('#markerDisplayDone').scrollIntoViewIfNeeded();assert(await page.locator('#markerDisplayDone').isVisible());await page.click('#markerDisplayDone');
    await page.screenshot({path:path.join(out,'viewport-'+size.width+'.png')});
   }
   await page.setViewportSize({width:1600,height:1000});
  });
  await check('left-drag marquee selects two boxes and Backspace deletes in one undoable action',async()=>{
   await page.evaluate(()=>{BApp.selectedBoxes.clear();BApp.selRow=null;UI.openStep(3);BApp.viewBlot=BApp.S.blots[0].id;BApp.emit('select');View.fitFull();});await page.waitForTimeout(100);
   const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows)),rect=await page.evaluate(()=>{const rows=BApp.S.rows.filter(r=>r.blot===BApp.viewBlot),a=View.probe(rows[0],rows[0].segs[0]).handles,b=View.probe(rows[1],rows[1].segs[0]).handles,cv=document.getElementById('editor').getBoundingClientRect();return {x0:cv.left+Math.min(a.nw[0],b.nw[0])-15,y0:cv.top+a.nw[1]-14,x1:cv.left+Math.max(a.se[0],b.se[0])+8,y1:cv.top+b.se[1]+2};});
   await page.mouse.move(rect.x0,rect.y0);await page.mouse.down();await page.mouse.move(rect.x1,rect.y1,{steps:12});await page.mouse.up();
   assert.equal(await page.evaluate(()=>BApp.boxSelection().length),2);assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
   await page.screenshot({path:path.join(out,'multi-select.png')});
   const history=await page.evaluate(()=>BApp.hist.length);await page.keyboard.press('Backspace');assert.equal(await page.evaluate(()=>BApp.S.rows.length),3);assert.equal(await page.evaluate(()=>BApp.hist.length),history+1);
   await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
  });
  await check('modifier selection deletes individual fragments without deleting their membrane siblings',async()=>{
   await page.evaluate(()=>{const r=BApp.S.rows[0];r.segs[0].lanes[4].r='m';BApp.splitExcluded(r);BApp.commit();AppSelectionClear();function AppSelectionClear(){BApp.selectBoxes([]);BApp.emit('select');}});
   const info=await page.evaluate(()=>{const a=BApp.S.rows[0],b=BApp.S.rows[1],cv=document.getElementById('editor').getBoundingClientRect();return{keep:JSON.stringify(a.segs[1]),row:a.id,pts:[a,b].map(r=>{const h=View.probe(r,r.segs[0]).handles;return{x:cv.left+(h.nw[0]+h.se[0])/2,y:cv.top+(h.nw[1]+h.se[1])/2};})};});
   await page.keyboard.down('Control');for(const p of info.pts)await page.mouse.click(p.x,p.y);await page.keyboard.up('Control');assert.equal(await page.evaluate(()=>BApp.boxSelection().length),2);
   await page.locator('#editorBox').dispatchEvent('keydown',{key:'Backspace',isComposing:true,keyCode:229});assert.equal(await page.evaluate(()=>BApp.S.rows.length),5);
   await page.locator('#defaultLanesNew').fill('12');await page.locator('#defaultLanesNew').press('Backspace');assert.equal(await page.evaluate(()=>BApp.S.rows.length),5);
   await page.locator('#editorBox').focus();await page.keyboard.press('Delete');assert.equal(await page.evaluate(id=>BApp.row(id).segs.length,info.row),1);assert.equal(await page.evaluate(id=>JSON.stringify(BApp.row(id).segs[0]),info.row),info.keep);
   await page.keyboard.press('Control+z');
  });
  await check('Space+left drag still pans; step-two coach leads to expected count input',async()=>{
   await page.evaluate(()=>{BApp.selectBoxes([]);BApp.emit('select');});const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows));const cv=await page.locator('#editor').boundingBox();await page.locator('#editorBox').focus();await page.keyboard.down('Space');await page.mouse.move(cv.x+20,cv.y+30);await page.mouse.down();await page.mouse.move(cv.x+55,cv.y+50);await page.mouse.up();await page.keyboard.up('Space');assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);assert.equal(await page.evaluate(()=>BApp.boxSelection().length),0);
   await page.evaluate(()=>UI.openStep(2));assert.match(await page.locator('#coachText').innerText(),/expected lanes/);await page.click('#coach');assert.equal(await page.evaluate(()=>document.activeElement.id),'defaultLanesBefore');
  });
  await check('custom marker survives a closed page and a missing legacy preference, and stays at the top',async()=>{
   await page.evaluate(()=>UI.openStep(4));await page.click('#btnCustomMarker');await page.fill('#customMarkerName','Reusable lab marker');await page.fill('#customMarkerSizes','150, 100, 50, 25');await page.click('#saveCustomMarker');await page.waitForFunction(()=>document.getElementById('libraryDlg').classList.contains('hidden'));
   const id=await page.evaluate(()=>BApp.S.blots[0].ladderId);await page.evaluate(()=>localStorage.removeItem('blotfig.customLadders'));
   const other=await ctx.newPage();await other.goto(base+'/index.html?lang=en');await other.evaluate(()=>ProteinLadders.ready);
   assert.deepEqual(await other.evaluate(id=>ProteinLadders.get(id)?.sizes,id),[150,100,50,25]);assert.equal(await other.evaluate(()=>ProteinLadders.groups()[0].vendor),'Custom');assert(await other.evaluate(()=>ProteinLadders.persistent));await other.close();
  });
  await check('editing has no JavaScript errors',async()=>assert.deepEqual(errors,[]));
 }finally{await ctx.close();}
 for(const both of [false,true]){
  const c=await browser.newContext();await c.addInitScript(both=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}});if(both)Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('blocked','SecurityError');}});},both);
  const p=await c.newPage();try{
   await check(both?'unavailable storage reports session-only marker persistence':'IndexedDB retains markers when localStorage is blocked',async()=>{
    await p.goto(base+'/index.html?lang=en');await p.evaluate(()=>ProteinLadders.ready);const r=await p.evaluate(async()=>{const l=ProteinLadders.saveCustom('Blocked preferences marker',[100,50,25]);return{id:l.id,persisted:await ProteinLadders.flush()};});assert.equal(r.persisted,!both);
    if(!both){await p.reload();await p.evaluate(()=>ProteinLadders.ready);assert(await p.evaluate(id=>!!ProteinLadders.get(id),r.id));}
   });
  }finally{await c.close();}
 }
 return results;
}
