import assert from 'node:assert/strict';
import { readPptx as readZip } from './pptx-read.mjs';

export async function parityChecks(browser,base){
 const results=[],context=await browser.newContext({viewport:{width:1700,height:1050}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=async(name,fn)=>{console.log('parity:',name);try{await fn();results.push(['ok',name]);}catch(e){results.push(['FAIL',name,e.message]);}};
 try{
  await page.goto(base+'/index.html?demo=1&lang=en');await page.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});
  await page.evaluate(()=>{UI.openStep(5);window.parityInitial=JSON.stringify(BApp.S);window.parityCore=JSON.stringify(BApp.S.rows.map(r=>({id:r.id,img:r.img,lv:r.lv,segs:r.segs})));});
  await check('Marker import preserves conflicting definitions and validates before mutation',async()=>{
   assert(await page.evaluate(async()=>{await ProteinLadders.ready;const a=ProteinLadders.saveCustom('Original',[100,50,25],{id:'parity-collision'}),map=ProteinLadders.importDefinitions([{custom:true,id:a.id,name:'Changed',sizes:[150,75,37]}]);
    const b=ProteinLadders.get(map.get(a.id)),before=JSON.stringify(ProteinLadders.custom());let rejected=false;
    try{ProteinLadders.importDefinitions([{custom:true,id:'valid',name:'Valid',sizes:[100]},{custom:true,id:'bad',name:'Bad',sizes:['oops']}]);}catch{rejected=true;}
    return map.get(a.id)!==a.id&&ProteinLadders.get(a.id).sizes[0]===100&&b.sizes[0]===150&&rejected&&before===JSON.stringify(ProteinLadders.custom());}));
  });
  await check('Typeface and manual angle controls preserve independent image settings',async()=>{
   await page.click('#figureFontButton');await page.selectOption('#figureFont','Times New Roman');await page.selectOption('#angleMode','manual');await page.fill('#angleNumber','32');await page.locator('#angleNumber').press('Tab');
   assert(await page.evaluate(()=>BApp.S.style.fontFamily==='Times New Roman'&&+BApp.S.style.labelAngle===32&&parityCore===JSON.stringify(BApp.S.rows.map(r=>({id:r.id,img:r.img,lv:r.lv,segs:r.segs})))&&BRender.build(false).svg.includes('Times New Roman')));
  });
  await check('Real inline selection formats subscript and colour; local undo and redo work',async()=>{
   await page.locator('#preview g[data-edit="lane"]').first().click();await page.fill('#floatEd','ERH2');await page.locator('#floatEd').evaluate(e=>e.setSelectionRange(3,4));
   await page.click('[data-format="sub"]');await page.click('[data-format="red"]');
   assert(await page.evaluate(()=>{const l=UI.textEditing.target(UI.textEditing.current);return l.name==='ERH2'&&l.nameRuns.some(r=>r.text==='2'&&r.script==='sub'&&r.color==='red');}));
   await page.locator('#floatEd').press('Control+z');assert(await page.evaluate(()=>!UI.textEditing.target(UI.textEditing.current).nameRuns.some(r=>r.color==='red')));
   await page.locator('#floatEd').press('Control+Shift+z');assert(await page.evaluate(()=>UI.textEditing.target(UI.textEditing.current).nameRuns.some(r=>r.color==='red')));
   await page.locator('#floatEd').press('Enter');await page.locator('#floatEd').press('Escape');
   const svg=await page.evaluate(()=>BRender.build(false).svg);assert(svg.includes('data-name-baseline="-1.54"')&&svg.includes('#d32f2f'),svg.slice(-400));
  });
  await check('Shared italic defaults are optional and explicit upright runs override them',async()=>{
   await page.click('#figureFontButton');await page.check('#laneItalic');
   assert(await page.evaluate(()=>{const lane=BApp.S.lanes[BApp.figLanes()[0]-1],m=FigureText.metrics({name:lane.name,nameRuns:lane.nameRuns,italicDefault:BApp.S.style.laneItalic},7,'Arial');return m.runs.every(r=>r.italic);}));
   await page.uncheck('#laneItalic');await page.click('#figureFontButton');
   assert(await page.evaluate(()=>{const m=FigureText.metrics({name:'A',nameRuns:[{text:'A',italic:false}],italicDefault:true},7,'Arial');return !m.runs[0].italic;}));
  });
  await check('Name override is opt-in and Escape restores text and formatting',async()=>{
   await page.locator('#preview g[data-edit="lane"]').first().click();const before=await page.evaluate(()=>JSON.stringify(UI.textEditing.target(UI.textEditing.current)));
   await page.check('#nameOverride');await page.fill('#nameOwnAngle','0');await page.locator('#nameOwnAngle').press('Tab');
   assert(await page.evaluate(()=>UI.textEditing.target(UI.textEditing.current).nameStyle.angle==='0'));
   await page.locator('#floatEd').press('Escape');assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.lanes[BApp.figLanes()[0]-1])),before);
  });
  await check('Templates preserve rich names, colours and per-lane overrides without sharing objects',async()=>{
   assert(await page.evaluate(()=>{const l=BApp.S.lanes[BApp.figLanes()[0]-1];l.nameStyle={angle:'0',pt:8};BApp.S.groups=[{from:1,to:3,text:'Group',color:'red',textRuns:[{text:'Group',italic:true}]}];
    const t=BApp.template(),expected=JSON.stringify(t);BApp.applyTemplate(t);const fresh=BApp.template();BApp.S.lanes[0].nameRuns[0].text='changed';
    const ok=fresh.lanes[0].nameStyle.angle==='0'&&fresh.groups[0].color==='red'&&JSON.stringify(t)===expected;BApp.applyTemplate(JSON.parse(expected));BApp.commit();return ok;}));
  });
  await check('Resetting a local name size inherits lane size, and clearing group format resets its line colour',async()=>{
   await page.evaluate(()=>{BApp.S.style.lanePt=9;BApp.S.lanes[BApp.figLanes()[0]-1].nameStyle={pt:7,angle:'0'};BApp.commit();});
   await page.locator('#preview g[data-edit="lane"]').first().click();await page.click('#fedReset');assert.equal(await page.textContent('#fedSize'),'9 pt');await page.click('#fedBar [data-fz="+"]');assert.equal(await page.textContent('#fedSize'),'9.5 pt');await page.locator('#floatEd').press('Escape');
   await page.locator('#preview g[data-edit="group"]').first().click();await page.click('[data-format="clear"]');assert(await page.evaluate(()=>!BApp.S.groups[0].color));await page.locator('#floatTa').press('Escape');
   await page.evaluate(()=>{BApp.S.style.lanePt=null;BApp.commit();});
  });
  await check('Editable PPT preserves font, colour and native baseline runs',async()=>{
   const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await PPTX.build()).arrayBuffer())));const entries=readZip(Buffer.from(bytes));
   const xml=Buffer.from(entries.get('ppt/slides/slide1.xml')).toString('utf8');assert(xml.includes('Times New Roman')&&xml.includes('D32F2F')&&xml.includes('baseline="'));
  });
  await check('Grayscale source with red annotations exports RGB TIFF',async()=>{
   const wait=page.waitForEvent('download');await page.evaluate(async()=>{const f=BRender.build(false);await Export.exportTIFF(f.svg,f.w,f.h,150,'parity.tif',{});});
   const d=await wait;const stream=await d.createReadStream();const chunks=[];for await(const b of stream)chunks.push(b);const b=Buffer.concat(chunks),off=b.readUInt32LE(4),n=b.readUInt16LE(off),tags=new Map();for(let k=0;k<n;k++){const p=off+2+k*12;tags.set(b.readUInt16LE(p),b.readUInt16LE(p+8));}assert.equal(tags.get(262),2);assert.equal(tags.get(277),3);
  });
  await check('New controls fit small desktop and use the current language',async()=>{
   await page.setViewportSize({width:1024,height:780});assert(await page.evaluate(()=>{const t=document.getElementById('figureToolbar'),r=t.getBoundingClientRect();return r.right<=innerWidth+1&&t.scrollWidth<=t.clientWidth+1&&!/[\u4e00-\u9fff]/.test(t.innerText);}));
  });
  await page.setViewportSize({width:1700,height:1050});
  await page.evaluate(()=>{BApp.S=JSON.parse(parityInitial);BApp.commit();UI.openStep(5);});
  await check('Draw a region annotation without modifying the protein crop, then export its inset',async()=>{
   const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows));
   await page.click('#btnNoteBox');const r=await page.locator('#preview image[data-row]').first().boundingBox();
   await page.mouse.move(r.x+r.width*.2,r.y+r.height*.15);await page.mouse.down();await page.mouse.move(r.x+r.width*.55,r.y+r.height*.85,{steps:12});await page.mouse.up();
   await page.fill('#noteText','Doublet');await page.selectOption('#noteZoom','3');await page.selectOption('#noteColor','red');await page.click('#noteDone');
   assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
   assert(await page.evaluate(()=>{const f=BRender.build(false,true);return BApp.S.notes[0].zoom===3&&f.exportSlices.some(s=>s.id.startsWith('note_')&&Number.isFinite(s.u0))&&f.svg.includes('Doublet')&&f.svg.includes('#d32f2f');}));
   const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await(await PPTX.build()).arrayBuffer())));const zip=readZip(Buffer.from(bytes)),xml=zip.get('ppt/slides/slide1.xml').toString();assert(xml.includes('Doublet'));assert((xml.match(/<a:srcRect /g)||[]).length>5);
  });
  await check('Annotation follows sorting and columns and survives template round-trip',async()=>{
   assert(await page.evaluate(()=>{const a=BApp.S.notes[0],row=BApp.row(a.row),corners=JSON.stringify(a.corners),source=JSON.stringify(row.segs);BApp.moveRowBy(row.id,1);const c=BApp.addColumn();BApp.moveToColumn(row,c.id);BApp.commit();const t=JSON.parse(JSON.stringify(BApp.template()));BApp.applyTemplate(t);BApp.commit();const n=BApp.S.notes.find(n=>n.kind==='box');return n.row===row.id&&JSON.stringify(row.segs)===source&&n.corners.every((p,i)=>p.every((v,j)=>Math.abs(v-JSON.parse(corners)[i][j])<1e-6))&&BRender.build(true).noteHits.some(h=>h.id===n.id);}));
  });
  await check('A bracket endpoint can be dragged to another row without rebuilding it',async()=>{
   await page.evaluate(()=>{BApp.activeColumn='main';const rs=BApp.rowsInColumn('main');BApp.S.brackets=[{r0:rs[0].id,r1:rs[0].id,f0:.2,f1:.8,text:'IP',side:'left'}];BApp.commit();});
   const handle=await page.locator('[data-bracket="0"][data-bracket-end="1"]').boundingBox(),target=await page.evaluate(()=>{const b=BApp.rowsInColumn('main')[1],e=document.querySelector(`image[data-row="${b.id}"]`),r=e.getBoundingClientRect();return{x:r.x+r.width*.2,y:r.y+r.height*.5,id:b.id};});
   await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:12});await page.mouse.up();assert.equal(await page.evaluate(()=>BApp.S.brackets[0].r1),target.id);
  });
  await check('Side text can be edited directly and redrawn without changing exposure',async()=>{
   const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows.map(r=>[r.img,r.lv])));
   await page.click('#btnSideText');await page.fill('#noteText','IB: anti-HA');await page.selectOption('#notePos','right');await page.selectOption('#noteColor','red');await page.click('#noteDone');
   assert(await page.evaluate(()=>BRender.build(false).svg.includes('IB: anti-HA')));assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows.map(r=>[r.img,r.lv]))),before);
  });
  await check('Deleting one annotation never deletes a protein region and is undoable',async()=>{
   const counts=await page.evaluate(()=>({rows:BApp.S.rows.length,notes:BApp.S.notes.length}));
   const g=page.locator('#preview g[data-edit="note"]').first();await g.click();await page.click('#noteDelete');
   assert.deepEqual(await page.evaluate(()=>({rows:BApp.S.rows.length,notes:BApp.S.notes.length})),{rows:counts.rows,notes:counts.notes-1});
   await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>BApp.S.notes.length),counts.notes);
  });
  await check('Projects restore formatted annotations and remap conflicting Marker IDs in reset snapshots',async()=>{
   assert(await page.evaluate(async()=>{
    const original=ProteinLadders.saveCustom('Project marker',[100,50,25],{id:'project-marker-collision'});BApp.S.blots[0].ladderId=original.id;BApp.initial=JSON.stringify(BApp.S);BApp.commit();
    const blob=await BApp.saveProject(),expected=JSON.stringify(BApp.S.notes);ProteinLadders.saveCustom('Local newer definition',[150,75,37],{id:original.id});
    await BApp.openProject({buffer:await blob.arrayBuffer()});const id=BApp.S.blots[0].ladderId,ok=id!==original.id&&ProteinLadders.get(original.id).sizes[0]===150&&ProteinLadders.get(id).sizes[0]===100&&JSON.stringify(BApp.S.notes)===expected;BApp.resetAll();BApp.commit();return ok&&BApp.S.blots[0].ladderId===id;
   }));
  });
  await check('No new JavaScript errors',async()=>assert.deepEqual(errors,[]));
 }finally{await context.close();}
 return results;
}
