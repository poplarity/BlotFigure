import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readPptx} from './pptx-read.mjs';
export async function iterationChecks(browser,base,root,engine){
 const ctx=await browser.newContext({viewport:{width:1680,height:1050}}),page=await ctx.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=async(name,fn)=>{try{await fn();results.push(['ok',name]);}catch(e){results.push(['FAIL',name,e.message]);}};
 const out=path.join(root,'test-results','iteration012',engine);fs.mkdirSync(out,{recursive:true});
 try{
  await page.goto(base+'/index.html?lang=en');await page.evaluate(()=>PrefStorage.setItem('blotfig.tour','1'));
  await page.click('#btnDemo');await page.waitForFunction(()=>BApp.S?.blots.length===2,null,{timeout:180000});
  await check('first step explains why and how to group captures, not physical membranes',async()=>{
   assert(await page.locator('.group-guide').isVisible());assert.match(await page.locator('.group-guide').innerText(),/Exposure comparison/);
   assert.equal(await page.evaluate(()=>BApp.blotName(BApp.S.blots[0])),'Image group 1');
   await page.screenshot({path:path.join(out,'01-groups.png')});
  });
  await check('confirming from the last gallery group starts strip review at the first group',async()=>{
   await page.evaluate(()=>{BApp.viewBlot=BApp.S.blots[1].id;BApp.viewImg=BApp.S.blots[1].marker;BApp.emit('select');});
   await page.click('#galleryDone');await page.waitForFunction(()=>BApp.curStep===2 && !BApp.busyNow,null,{timeout:180000});
   assert(await page.evaluate(()=>BApp.viewBlot===BApp.S.blots[0].id));
  });
  await check('whole review cards support mouse and keyboard; generating boxes opens step three only',async()=>{
   const cards=page.locator('#pieceList .pc-blot');await cards.nth(1).click();assert(await page.evaluate(()=>BApp.viewBlot===BApp.S.blots[1].id));
   await cards.nth(0).focus();await page.keyboard.press('Enter');assert(await page.evaluate(()=>BApp.viewBlot===BApp.S.blots[0].id));
   await page.click('#next2');await page.waitForFunction(()=>BApp.curStep===3,null,{timeout:180000});
   assert(await page.locator('#secRows').evaluate(e=>e.classList.contains('open')));assert(!await page.locator('#secPieces').evaluate(e=>e.classList.contains('open')));
   assert(await page.evaluate(()=>BApp.S.style.border));assert.equal(await page.evaluate(()=>BApp.S.rows.length),5);
  });
  await check('clicking a source box or figure band reveals that box controls without moving its geometry',async()=>{
   await page.evaluate(()=>{BApp.S.step=5;UI.openStep(5);BApp.viewBlot=BApp.S.rows[0].blot;View.fitFull();});
   const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows));
   const pt=await page.evaluate(()=>{const r=BApp.S.rows[0],s=r.segs[0],p=BApp.pieceOf(r,s),xy=WB.toImg(BApp.segFrame(p,s),(s.x0+s.x1)/2,s.vc),q=View.toScr(...xy),b=document.getElementById('editor').getBoundingClientRect();return{x:b.left+q.x,y:b.top+q.y};});
   await page.mouse.click(pt.x,pt.y);assert(await page.locator('#secRows .row-detail').isVisible());assert(await page.locator('#secRows').evaluate(e=>e.classList.contains('open')));
   assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
   await page.evaluate(()=>UI.openStep(5));await page.locator('#preview image[data-row]').nth(1).click();
   assert(await page.locator('#secRows .row-detail').isVisible());assert.equal(await page.evaluate(()=>BApp.curStep),3);
   await page.evaluate(()=>UI.openStep(4));await page.locator('#preview image[data-row]').first().click();assert.equal(await page.evaluate(()=>BApp.mode),null);assert.equal(await page.evaluate(()=>BApp.curStep),3);
   await page.screenshot({path:path.join(out,'02-box-controls.png')});
  });
  await check('wide 9-lane region yields both 4-lane blocks; middle lane is removed only when specified',async()=>{
   const r=await page.evaluate(()=>{
    const w=900,h=180,data=new Float32Array(w*h),xs=Array.from({length:9},(_,i)=>90+i*90);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){let v=.02+.0003*Math.sin(x*12.3+y*4.1);for(let k=0;k<9;k++)v+=(k===4?.18:.55)*Math.exp(-(((x-xs[k])/20)**6)-((y-90)/5)**2);data[y*w+x]=v;}
    const img={w,h,data},cs=WB.chemiSignal(img),args=[[{id:'a',img,cs,exposure:1}],null];
    const opt={strips:[{cx:450,cy:90,w:880,h:150,angle:0}],noCalib:true,autoMarkerLanes:false,laneCount:4};
    const all=WB.analyzeSession(...args,opt),split=WB.analyzeSession(...args,{...opt,dividerLane:5});
    return {all:all.rows.map(r=>r.segs.map(s=>({n:s.laneCount,x0:s.x0,x1:s.x1}))),split:split.rows.map(r=>r.segs.map(s=>({n:s.laneCount,x0:s.x0,x1:s.x1}))),pc:split.pieces};
   });
   assert.equal(r.split.length,2,JSON.stringify(r));assert(r.split.every(row=>row.length===1&&row[0].n===4),JSON.stringify(r));
   assert(r.split[0][0].x1<0&&r.split[1][0].x0>0,JSON.stringify(r));assert.equal(r.all.flat().reduce((s,x)=>s+x.n,0),9,JSON.stringify(r));
  });
  await check('app generates separate left/right boxes with independent exposure and four lanes each',async()=>{
   const p=await ctx.newPage();p.on('dialog',d=>d.accept());
   try{
    await p.goto(base+'/index.html?demo=1&step=2&lang=en');await p.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});
    const r=await p.evaluate(()=>{const b=BApp.S.blots[0];BApp.S.blots=[b];BApp.setDefaultLaneCount(4);b.dividerLane=5;BApp.makeBoxes();BApp.commit();
     return {rows:BApp.S.rows.map(r=>({id:r.id,img:r.img,n:r.segs[0].lanes.length,x0:r.segs[0].x0,x1:r.segs[0].x1,c0:r.segs[0].c0})),range:BApp.S.range};});
    assert.equal(r.rows.length,6,JSON.stringify(r));assert(r.rows.every(x=>x.n===4&&x.c0===1),JSON.stringify(r));assert.deepEqual(r.range,[1,4]);
    assert(await p.evaluate(()=>{const [a,b]=BApp.S.rows,before=JSON.stringify(b);a.auto=false;a.img=BApp.chemiOf(BApp.blot(a.blot))[0].id;a.lv={black:.02,white:.4,manual:true};BApp.commit();return JSON.stringify(b)===before;}));
   }finally{await p.close();}
  });
  await check('kDa stays beside the band and clears conditions across font sizes and sides',async()=>{
   const checks=await page.evaluate(()=>{
    const r=BApp.S.rows[0],s=r.segs[0],pc=BApp.pieceOf(r,s);pc.marks=[{u:0,v:s.vc,kda:50}];BApp.S.conditions=[{name:'Treatment',values:BApp.S.lanes.map(()=>'+')}];
    const out=[];
    for(const side of ['left','right'])for(const pt of [5,7,14])for(const tickAtTop of [false,true]){
     Object.assign(BApp.S.style,{mwSide:side,markerPt:pt});pc.marks[0].v=tickAtTop?s.vc-BApp.boxAbove(r,s)+1:s.vc;
     const f=BRender.build(false),host=document.createElement('div');host.innerHTML=f.svg;document.body.appendChild(host);
     const u=host.querySelector('[data-unit-header] text'),c=Array.from(host.querySelectorAll('text')).find(t=>t.textContent==='Treatment');
     const a=u.getBBox(),b=c.getBBox(),overlap=a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
     out.push({side,pt,tickAtTop,overlap,y:+u.getAttribute('y')});host.remove();
    }
    pc.marks[0].v=s.vc;Object.assign(BApp.S.style,{mwSide:'left',markerPt:7});BApp.commit();return out;
   });assert(checks.every(x=>!x.overlap),JSON.stringify(checks));
  });
  await check('PPTX uses independent recroppable images and native text/shapes in multiple WB columns',async()=>{
   await page.evaluate(()=>{
    const S=BApp.S;S.rows.forEach((r,i)=>{r.name='Protein '+(i+1);r.lv={black:.01,white:.3+i*.08,manual:true};});
    Object.assign(BApp.addArrow(S.rows[1],S.rows[1].segs[0].vc),{text:'Target',sizeText:'50 kDa'});
    Object.assign(BApp.addBracket(S.rows[0].id,0,S.rows[1].id,1),{text:'IP',vertical:true});
    S.lanes.forEach((l,i)=>l.name='Lane '+(i+1));S.groups=[{from:1,to:4,text:'Control\n*replicates*',pt:7}];
    const c=BApp.addColumn();c.title='Other experiment';BApp.moveToColumn(S.rows[4],c.id);BApp.commit();
   });
   const before=await page.evaluate(()=>JSON.stringify(BApp.S));
   const data=await page.evaluate(async()=>{const f=BRender.build(false);const blob=await PPTX.build();const bytes=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return {b64:btoa(s),svg:f.svg,w:f.w,h:f.h};});
   assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S)),before);
   const bytes=Buffer.from(data.b64,'base64'),files=readPptx(bytes),slide=files.get('ppt/slides/slide1.xml').toString();
   assert.equal((slide.match(/<p:pic>/g)||[]).length,5);assert((slide.match(/<p:txBody>/g)||[]).length>10);assert.match(slide,/<a:srcRect l="[1-9]/);assert.match(slide,/Other experiment/);assert.match(slide,/i="1"/);assert.match(slide,/<a:custGeom>/);assert.match(slide,/Target/);
   const media=[...files].filter(([n])=>n.startsWith('ppt/media/'));assert.equal(media.length,5);
   for(const [name,b] of media){assert(b.readUInt32BE(16)>900,name);assert(b.readUInt32BE(20)>600,name);}
   const bad=await page.evaluate(xmls=>xmls.filter(s=>new DOMParser().parseFromString(s,'application/xml').querySelector('parsererror')).length,[...files].filter(([n])=>/xml$|rels$/.test(n)).map(([,b])=>b.toString()));assert.equal(bad,0);
   fs.writeFileSync(path.join(out,'editable.pptx'),bytes);fs.writeFileSync(path.join(out,'editable.svg'),data.svg);
   await page.evaluate(()=>UI.openStep(5));await page.screenshot({path:path.join(out,'03-figure.png')});
  });
  await check('offline single HTML exports PPT with no external request',async()=>{
   const offline=await browser.newContext({offline:true,viewport:{width:1600,height:1000}}),p=await offline.newPage(),requests=[];
   try{p.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await p.goto(pathToFileURL(path.join(root,'dist','BlotFigure.html')).href+'?demo=1&lang=en');await p.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});assert(await p.evaluate(async()=>{const b=await PPTX.build();return b.size>10000;}));assert.deepEqual(requests,[]);}finally{await offline.close();}
  });
  await check('interaction and export have no JavaScript errors',async()=>assert.deepEqual(errors,[]));
 }finally{await ctx.close();}
 return results;
}
