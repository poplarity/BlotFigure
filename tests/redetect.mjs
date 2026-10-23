import assert from 'node:assert/strict';
export async function redetectChecks(browser,base){
 const ctx=await browser.newContext({viewport:{width:1680,height:1050}}),page=await ctx.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=async(name,fn)=>{try{await fn();results.push(['ok',name]);}catch(e){results.push(['FAIL',name,e.message]);}};
 try{
  await page.goto(base+'/index.html?demo=1&lang=en');await page.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});
  await check('two-lane detection uses local signal groups rather than tiling blank membrane grids',async()=>{
   const r=await page.evaluate(()=>{
    const w=900,h=360,xs=[180,260,620,700],data=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     let v=.02+.001*Math.sin(x*2.7+y*.4);
     for(const cy of [95,265])for(const cx of xs)v+=.5*Math.exp(-(((x-cx)/29)**6)-((y-cy)/5)**2);
     // A narrow edge and an isolated off-grid speck must not become a row of two-lane boxes.
     v+=.06*Math.exp(-((x-850)**2)/5-((y-150)/18)**2)+.05*Math.exp(-(((x-420)/3)**2)-((y-170)/2)**2);
     data[y*w+x]=v;
    }
    const img={w,h,data},a=WB.analyzeSession([{id:'source',img,cs:WB.chemiSignal(img),exposure:1}],null,{strips:[{cx:450,cy:180,w:880,h:340,angle:0}],laneCount:2,autoMarkerLanes:false,noCalib:true});
    return a.rows.map(r=>({y:r.oy,n:r.segs[0].laneCount,x0:r.segs[0].x0+450,x1:r.segs[0].x1+450}));
   });
   assert.equal(r.length,4,JSON.stringify(r));
   for(const [x,y] of [[220,95],[660,95],[220,265],[660,265]])assert(r.some(b=>b.n===2&&b.x0<x-40&&b.x1>x+40&&Math.abs(b.y-y)<10),JSON.stringify(r));
  });
  await check('return to strips, change count and rebuild only this group; one undo restores old boxes',async()=>{
   await page.evaluate(()=>{BApp.viewBlot=BApp.S.blots[0].id;UI.openStep(2);});
   assert(await page.locator('#btnRebuildGroup').isVisible());await page.fill('#defaultLanesBefore','9');await page.locator('#defaultLanesBefore').press('Tab');
   const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows)),other=await page.evaluate(()=>JSON.stringify(BApp.S.rows.filter(r=>r.blot===BApp.S.blots[1].id)));
   await page.click('#btnRebuildGroup');await page.waitForFunction(()=>BApp.curStep===3);
   assert.notEqual(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows.filter(r=>r.blot===BApp.S.blots[1].id))),other);
   assert(await page.evaluate(()=>BApp.S.rows.filter(r=>r.blot===BApp.S.blots[0].id).every(r=>r.segs.every(s=>s.lanes.length===9))));
   await page.click('#btnUndo');assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
  });
  await check('repeated detection honours changed parameters and the explicit keep-boxes action preserves edits',async()=>{
   await page.evaluate(()=>UI.openStep(2));await page.fill('#defaultLanesBefore','4');await page.locator('#defaultLanesBefore').press('Tab');
   await page.locator('#dividerLane').evaluate(el=>el.closest('details').open=true);await page.fill('#dividerLane','5');await page.locator('#dividerLane').press('Tab');
   await page.click('#vmPcNext');await page.waitForFunction(()=>BApp.curStep===3);
   assert(await page.evaluate(()=>{const b=BApp.S.blots[0],rs=BApp.S.rows.filter(r=>r.blot===b.id);return rs.length===6&&b.laneCountAtDetection===4&&rs.every(r=>r.segs[0].lanes.length===4);}));
   const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows));await page.evaluate(()=>UI.openStep(2));await page.fill('#defaultLanesBefore','3');await page.locator('#defaultLanesBefore').press('Tab');await page.click('#next2');await page.waitForFunction(()=>BApp.curStep===3);assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
  });
  await check('deleting every box in a group does not disable regeneration; failed reruns are atomic',async()=>{
   await page.evaluate(()=>{const b=BApp.S.blots[0];BApp.S.rows.filter(r=>r.blot===b.id).slice().forEach(r=>r.segs.slice().forEach(s=>BApp.deleteBox(r,s)));BApp.commit();UI.openStep(2);});
   await page.fill('#defaultLanesBefore','4');await page.locator('#defaultLanesBefore').press('Tab');await page.click('#btnRebuildGroup');await page.waitForFunction(()=>BApp.curStep===3);
   assert(await page.evaluate(()=>BApp.S.rows.some(r=>r.blot===BApp.S.blots[0].id)));
   assert(await page.evaluate(()=>{const before=JSON.stringify(BApp.S),fn=WB.analyzeSession,b=BApp.S.blots[0],pcs=b.pieces.map(p=>({...p,w:p.w*.95}));let calls=0;WB.analyzeSession=(...args)=>{if(++calls===2)throw new Error('test failure');return fn(...args);};let threw=false;try{BApp.rebuildBoxes([b.id],{[b.id]:pcs});}catch{threw=true;}finally{WB.analyzeSession=fn;}return threw&&before===JSON.stringify(BApp.S);}));
  });
  await check('repeat detection has no JavaScript errors',async()=>assert.deepEqual(errors,[]));
 }finally{await ctx.close();}return results;
}
