import assert from 'node:assert/strict';
export async function usabilityChecks(browser,base){
  const results=[],ctx=await browser.newContext({viewport:{width:1720,height:1060},locale:'en-US'}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const check=async(name,fn)=>{console.log('usability:',name);try{await fn();results.push(['ok',name]);}catch(e){results.push(['FAIL',name,e.message]);}};
  try{
    await page.goto(`${base}/index.html?demo=1&lang=en`);await page.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});
    await page.evaluate(()=>UI.openStep(5));
    await check('steps expand independently and returning does not regenerate deleted boxes',async()=>{
      await page.evaluate(()=>{const r=BApp.S.rows[0];window.deletedBox=r.id;BApp.deleteBox(r);window.keptBoxes=BApp.S.rows.map(r=>r.id);});
      await page.locator('#toolNav [data-tool="2"]').click();
      assert(await page.locator('#secPieces .step-body').isVisible());
      await page.locator('#secNames .step-toggle').click();
      await page.waitForFunction(()=>BApp.curStep===5);
      assert(await page.evaluate(()=>BApp.S.step===5&&!BApp.row(deletedBox)&&JSON.stringify(keptBoxes)===JSON.stringify(BApp.S.rows.map(r=>r.id))));
      await page.locator('#secNames .step-toggle').click();assert(!(await page.locator('#secNames .step-body').isVisible()));
      await page.locator('#secNames .step-toggle').click();assert(await page.locator('#secNames .step-body').isVisible());
    });
    await check('Backspace removes only the selected box, including boxes on the same membrane strip',async()=>{
      const id=await page.evaluate(()=>{UI.openStep(3);const r=BApp.S.rows[0],copy=JSON.parse(JSON.stringify(r));copy.id='same-strip-copy';copy.segs.forEach((s,i)=>{s.id='copy-box-'+i;delete s.label;});BApp.S.rows.push(copy);BApp.selRow=copy.id;BApp.selSeg=copy.segs[0].id;BApp.selLane=0;BApp.commit();window.siblingSnapshot=JSON.stringify(BApp.S.rows.filter(r=>r.id!==copy.id));return copy.id;});
      await page.locator('#editorBox').focus();await page.keyboard.press('Backspace');
      assert(await page.evaluate(id=>!BApp.row(id)&&siblingSnapshot===JSON.stringify(BApp.S.rows),id));
      await page.click('#btnUndo');assert(await page.evaluate(id=>!!BApp.row(id),id));
      await page.evaluate(()=>UI.openStep(5));
      await page.locator(`image[data-row="${id}"]`).first().click();await page.keyboard.press('Backspace');
      assert(!(await page.evaluate(id=>!!BApp.row(id),id)));
    });
    await check('protein and lane names are edited on the figure; Backspace and IME do not delete boxes',async()=>{
      assert.equal(await page.locator('#nameList input,.row-item input[type=text]').count(),0);
      const id=await page.evaluate(()=>BApp.S.rows[0].id),n=await page.evaluate(()=>BApp.S.rows.length);
      await page.locator(`g[data-edit="rowname"][data-row="${id}"]`).click();await page.fill('#floatEd','Protein中文');
      await page.locator('#floatEd').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});assert(await page.locator('#floatEd').isVisible());
      await page.keyboard.press('Backspace');await page.keyboard.press('Enter');await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>BApp.S.rows.length),n);
    });
    await check('add protein button is at the top of the protein tool',async()=>{
      assert(await page.evaluate(()=>{const body=document.querySelector('#secRows .step-body');return body.firstElementChild.contains(document.getElementById('btnAddRow'));}));
    });
    await check('photo workspace supports large previews, zoom and return to editing without resets',async()=>{
      const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows));
      await page.evaluate(()=>UI.openStep(1));assert(await page.locator('#imageGallery #blotList').count()===1);
      assert(await page.locator('#galleryCanvas').isVisible());
      const ids=await page.evaluate(()=>[...BApp.images.keys()]);await page.locator(`.thumb[data-image="${ids[1]}"] canvas`).click();
      assert(await page.locator('.gallery-caption b').textContent()===await page.evaluate(id=>BApp.images.get(id).name,ids[1]));
      await page.click('#galleryZoomIn');assert(await page.locator('#galleryCanvas').evaluate(el=>el.style.width==='150%'));
      await page.click('#galleryDone');await page.waitForFunction(()=>BApp.curStep===5);
      assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
    });
    await check('global marker font ignores legacy overrides and ticks never extend into extra label columns',async()=>{
      assert(await page.evaluate(()=>{
        const r=BApp.S.rows[0],s=r.segs[0],p=BApp.pieceOf(r,s);s.rot=0;p.marks=[{u:0,v:s.vc-1,kda:55},{u:0,v:s.vc+1,kda:50}];r.markerPt=14;BApp.S.style.markerPt=6;BApp.S.style.showMW=true;
        const f=BRender.build(true),d=new DOMParser().parseFromString(f.svg,'image/svg+xml'),labels=[...d.querySelectorAll('[data-edit=marker] text')];
        BApp.commit();return labels.length>=2&&labels.every(t=>+t.getAttribute('font-size')===6)&&new Set(labels.map(t=>t.getAttribute('x'))).size===1&&!r.markerPt&&f.overlaps.some(x=>/Marker/i.test(x));
      }));
      await page.locator('.row-menu').first().click();assert.equal(await page.locator('#regionMarkerPt').count(),0);await page.fill('#globalMarkerPt','5');await page.locator('#globalMarkerPt').press('Tab');await page.click('#markerDisplayDone');
      assert.equal(await page.evaluate(()=>BApp.S.style.markerPt),5);
    });
    await check('custom marker accepts pasted sizes, CSV files and survives portable project saving',async()=>{
      await page.evaluate(()=>UI.openStep(4));await page.click('#btnCustomMarker');
      await page.fill('#customMarkerName','Lab marker');await page.fill('#customMarkerSizes','10, 25, 50 kDa, 100, 50');
      assert.equal(await page.locator('#customMarkerPreview span').count(),4);await page.click('#saveCustomMarker');
      assert(await page.evaluate(()=>ProteinLadders.get(BApp.blot(BApp.viewBlot).ladderId).sizes.join(',')==='100,50,25,10'));
      await page.click('#btnCustomMarker');await page.locator('#customMarkerFile').setInputFiles({name:'my-ladder.csv',mimeType:'text/csv',buffer:Buffer.from('kDa\n250\n100\n50\n25\n')});
      await page.waitForFunction(()=>document.getElementById('customMarkerSizes').value==='250, 100, 50, 25');await page.click('#saveCustomMarker');
      assert(await page.evaluate(async()=>{const id=BApp.blot(BApp.viewBlot).ladderId,data=await BApp.saveProject();PrefStorage.setItem('blotfig.customLadders','[]');await BApp.openProject(new File([data],'custom.blotfig'));return ProteinLadders.get(id)?.sizes.join(',')==='250,100,50,25';}));
    });
    await check('parameter presets change style without touching source crops or image levels',async()=>{
      assert(await page.evaluate(()=>{BApp.S.style.markerPt=6;const p=BApp.savePreset('Journal');const before=JSON.stringify(BApp.S.rows.map(r=>[r.segs,r.img,r.lv]));BApp.S.style.markerPt=12;BApp.applyPreset(p);return BApp.S.style.markerPt===6&&before===JSON.stringify(BApp.S.rows.map(r=>[r.segs,r.img,r.lv]))&&BApp.presets().some(p=>p.name==='Journal');}));
    });
    await check('two projects keep separate edits while sharing cached original image bytes',async()=>{
      const report=await page.evaluate(async()=>{
        BApp.noDraft=false;BApp.projectName='Experiment A';BApp.S.rows[0].name='Saved A';BApp.commit();await UI.flushPending();await BApp.saveDraft();window.projectA=BApp.projectId;window.snapshotA=JSON.stringify(BApp.S);
        BApp.resetSession();await BApp.addFiles(WBDemo.files(WBDemo.cutSession()));BApp.projectName='Experiment B';BApp.makeBoxes();BApp.S.step=5;BApp.S.rows[0].name='Saved B';BApp.commit();await BApp.saveDraft();window.projectB=BApp.projectId;
        const db=await new Promise((r,j)=>{const q=indexedDB.open('blotfigure');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
        const keys=await new Promise(r=>{const q=db.transaction('drafts').objectStore('drafts').getAllKeys();q.onsuccess=()=>r(q.result);});db.close();
        return {projects:(await BApp.listHistory()).length,images:keys.filter(k=>k.startsWith('img:')).length};
      });assert.equal(report.projects,2);assert.equal(report.images,6);
      await page.evaluate(()=>Extras.history());const a=await page.evaluate(()=>projectA);await page.locator(`[data-project="${a}"] .open-project`).click();
      await page.waitForFunction(()=>BApp.projectId===projectA && BApp.S.rows.some(r=>r.name==='Saved A'));
      assert(await page.evaluate(()=>JSON.stringify(BApp.S)===snapshotA));
    });
    await check('history persists across reload; deleting one project retains shared images of the other',async()=>{
      const ids=await page.evaluate(()=>({a:projectA,b:projectB}));await page.evaluate(async()=>{await BApp.saveDraft();BApp.leaving=true;});await page.goto(`${base}/index.html?lang=en`);
      await page.click('#btnHistoryStart');await page.locator(`[data-project="${ids.b}"] .open-project`).click();
      await page.waitForFunction(()=>BApp.S?.rows.some(r=>r.name==='Saved B'),null,{timeout:120000});
      assert(await page.evaluate(async({a,b})=>{await BApp.saveDraft();await BApp.deleteHistory(a);await BApp.restoreHistory(b);return(await BApp.listHistory()).length===1&&BApp.S.rows.some(r=>r.name==='Saved B')&&BApp.images.size===4;},ids));
    });
    await check('legacy single drafts migrate without losing images or their saved adjustments',async()=>{
      assert(await page.evaluate(async()=>{
        await BApp.saveDraft();const m=await BApp.peekDraft(),oldId=m.projectId;delete m.projectId;delete m.projectName;
        const db=await new Promise(r=>{const q=indexedDB.open('blotfigure');q.onsuccess=()=>r(q.result);});
        await new Promise((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),st=tx.objectStore('drafts');st.delete('project:'+oldId);st.put(m,'meta');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
        BApp.resetSession();await BApp.addFiles(WBDemo.files(WBDemo.cutSession()));BApp.projectName='After migration';await BApp.saveDraft();const fresh=BApp.projectId,list=await BApp.listHistory(),legacy=list.find(p=>p.projectId.startsWith('legacy_'));
        if(!legacy||list.length!==2)return false;await BApp.restoreHistory(legacy.projectId);await BApp.deleteHistory(fresh);return BApp.S.rows.some(r=>r.name==='Saved B')&&BApp.images.size===4&&(await BApp.listHistory()).length===1;
      }));
    });
    await check('failed caching leaves the previous complete project intact and reports the failure',async()=>{
      assert(await page.evaluate(async()=>{
        await BApp.saveDraft();const name=BApp.S.rows[0].name,put=IDBObjectStore.prototype.put;BApp.S.rows[0].name='Must not replace saved project';
        IDBObjectStore.prototype.put=function(v,k){if(String(k).startsWith('project:'))throw new DOMException('full','QuotaExceededError');return put.call(this,v,k);};
        let ok;try{ok=await BApp.saveDraft();}finally{IDBObjectStore.prototype.put=put;}
        const reported=!ok&&BApp.cacheStatus==='error'&&!!(await BApp.peekDraft());await BApp.restoreHistory(BApp.projectId);return reported&&BApp.S.rows[0].name===name;
      }));
    });
    await check('iBright brand and Chemi export names do not override obvious composite content',async()=>{
      assert(await page.evaluate(()=>{
        const w=200,h=160,overlay=new Float32Array(w*h),exposure=new Float32Array(w*h).fill(.99),raw=new Float32Array(w*h);
        for(let y=30;y<130;y++)for(let x=20;x<170;x++)overlay[y*w+x]=.75;
        for(let lane=0;lane<6;lane++)for(let y=68;y<75;y++)for(let x=30+lane*22;x<40+lane*22;x++){overlay[y*w+x]=.95;exposure[y*w+x]=.02;raw[y*w+x]=.9;}
        return WB.classify({w,h,data:overlay},{name:'iBright_Chemi_01.tif'})==='marker'&&WB.classify({w,h,data:exposure},{name:'iBright_02.tif'})==='chemi'&&WB.classify({w,h,data:raw},{name:'iBright_03.tif'})==='chemi'&&WB.classify({w,h,data:exposure},{name:'highlight_transfection_01.tif'})==='chemi';
      }));
    });
    await check('usability flow has no JavaScript errors',async()=>assert.deepEqual(errors,[]));
  }catch(e){results.push(['FAIL','usability run',e.stack]);}finally{await ctx.close();}return results;
}
