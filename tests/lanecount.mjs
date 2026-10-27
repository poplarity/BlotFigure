import assert from 'node:assert/strict';
export async function laneCountChecks(browser,base){
  const ctx=await browser.newContext({viewport:{width:1680,height:1040}}),page=await ctx.newPage(),errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const check=async(name,fn)=>{try{await fn();results.push(['ok',name]);}catch(e){results.push(['FAIL',name,e.message]);}};
  try{
    await page.goto(`${base}/test/boxlanes.html`);await page.waitForFunction(()=>window.__done);
    await check('known-count grid fits signal positions, missing lanes, wide margins and blank boxes',async()=>{const r=JSON.parse((await page.title()).slice(4));assert.equal(r.fails,0,r.out.filter(l=>l.startsWith('FAIL')).join('\n'));});
    await page.goto(`${base}/index.html?demo=1&step=2&lang=en`);await page.waitForFunction(()=>document.title.startsWith('READY '),null,{timeout:180000});
    await check('set lane count before generating protein boxes',async()=>{
      await page.fill('#defaultLanesBefore','9');await page.locator('#defaultLanesBefore').press('Tab');
      assert.equal(await page.evaluate(()=>BApp.S.defaultLaneCount),9);assert.equal(await page.evaluate(()=>BApp.S.rows.length),0);
      await page.evaluate(()=>{BApp.makeBoxes();BApp.commit();UI.openStep(3);});
      assert(await page.evaluate(()=>BApp.S.rows.length===5&&BApp.S.rows.every(r=>r.segs.length===1&&r.segs[0].lanes.length===9&&r.segs[0].laneCount===9)));
    });
    await check('detected protein crops include every synthetic ground-truth band in its own membrane',async()=>{
      const check=await page.evaluate(()=>BApp.S.blots.flatMap((b,bi)=>{
        const truth=(bi===0?WBDemo.cutSession():WBDemo.scatterSession()).truth,rows=BApp.S.rows.filter(r=>r.blot===b.id);
        return truth.map(t=>{
          const r=rows.slice().sort((a,b)=>Math.abs(BApp.rowXY(a)[1]-t.cy)-Math.abs(BApp.rowXY(b)[1]-t.cy))[0],sg=r.segs[0],pc=BApp.pieceOf(r,sg),F=BApp.segFrame(pc,sg);
          const points=t.laneXs.map(x=>[x,t.cy+Math.tan(t.angle*Math.PI/180)*(x-t.cx)]).map(p=>WB.toFrame(F,...p));
          const inside=points.every(([u,v])=>u>=sg.x0&&u<=sg.x1&&v>=sg.vc-BApp.boxAbove(r,sg)&&v<=sg.vc+BApp.boxBelow(r,sg));
          const err=Math.max(...points.map(([u],i)=>Math.abs(u-sg.lanes[i].u)));return {name:t.name,inside,err};
        });
      }));assert(check.every(r=>r.inside&&r.err<6),JSON.stringify(check));
    });
    await check('automatic marker guesses never silently exclude sample lanes or split boxes',async()=>{
      assert(await page.evaluate(()=>BApp.S.blots.every(b=>b.pieces.every(p=>!p.ladderUs.length))&&BApp.S.rows.every(r=>r.segs.length===1&&r.segs[0].lanes.every(l=>l.r==='s'))));
    });
    await check('legacy automatic ladder slots cannot silently exclude lanes from newly added crops',async()=>{
      assert(await page.evaluate(()=>{const b=BApp.S.blots[0],p=b.pieces[0],roles=p.roles.slice();p.roles[1]='ladder';const slots=BApp.pieceSlots(p);p.roles=roles;return slots.length===roles.length&&slots.every(s=>s.role==='sample');}));
    });
    await check('single-box count is an independent override, retained during resizing and re-detection',async()=>{
      await page.evaluate(()=>{const r=BApp.S.rows[0];BApp.selRow=r.id;BApp.emit('select');});
      await page.locator('.bt-even input').first().fill('6');await page.locator('.bt-even input').first().press('Tab');
      assert(await page.evaluate(()=>{const r=BApp.S.rows[0],s=r.segs[0];BApp.setBox(r,s,s.x0-10,s.x1+10,JSON.parse(JSON.stringify(s)));BApp.redetectBox(r,s);BApp.commit();return s.lanes.length===6&&s.laneCount===6&&BApp.S.defaultLaneCount===9&&BApp.S.rows.slice(1).every(r=>r.segs[0].lanes.length===9);}));
    });
    await check('changing default does not modify existing crops; explicit batch count retains image settings',async()=>{
      const before=await page.evaluate(()=>JSON.stringify(BApp.S.rows));
      await page.fill('#defaultLanesNew','8');await page.locator('#defaultLanesNew').press('Tab');assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows)),before);
      const settings=await page.evaluate(()=>JSON.stringify(BApp.S.rows.map(r=>[r.id,r.img,r.lv,r.above,r.below,r.segs.map(s=>[s.piece,s.x0,s.x1,s.vc,s.rot])])));
      await page.click('#applyDefaultLanes');
      assert(await page.evaluate(()=>BApp.S.rows.every(r=>r.segs[0].lanes.length===8)));
      assert.equal(await page.evaluate(()=>JSON.stringify(BApp.S.rows.map(r=>[r.id,r.img,r.lv,r.above,r.below,r.segs.map(s=>[s.piece,s.x0,s.x1,s.vc,s.rot])]))),settings);
      await page.click('#btnUndo');assert(await page.evaluate(()=>BApp.S.rows[0].segs[0].lanes.length===6));
    });
    await check('batch counts preserve a manually excluded internal lane as fragments of one source box',async()=>{
      assert(await page.evaluate(()=>{
        const r=BApp.S.rows[1],sg=r.segs[0],before=JSON.stringify(BApp.S);sg.lanes[4].r='m';BApp.splitExcluded(r);BApp.commit();
        const ids=r.segs.map(s=>s.id);BApp.setDefaultLaneCount(9);BApp.applyDefaultLanes();BApp.commit();
        const ok=r.segs.length===2&&r.segs.reduce((n,s)=>n+s.lanes.length,0)===8&&r.segs.every((s,i)=>s.id===ids[i]);
        BApp.S=JSON.parse(before);BApp.commit();return ok;
      }));
    });
    await check('clear every box, then add by an actual click: all prescribed lanes appear again',async()=>{
      await page.evaluate(()=>{BApp.S.range=[1,1];BApp.S.lanes.forEach((l,i)=>l.hidden=i>0);BApp.commit();BApp.S.rows.slice().forEach(r=>r.segs.slice().forEach(s=>BApp.deleteBox(r,s)));UI.openStep(3);BApp.viewBlot=BApp.S.blots[0].id;View.fitFull();});
      await page.click('#btnAddRow');const point=await page.evaluate(()=>{const p=BApp.S.blots[0].pieces[0],s=View.toScr(p.cx,p.cy),r=document.getElementById('editor').getBoundingClientRect();return{x:r.left+s.x,y:r.top+s.y};});
      await page.mouse.click(point.x,point.y);
      assert(await page.evaluate(()=>BApp.S.rows.length===1&&BApp.S.rows[0].segs[0].lanes.length===8&&BApp.figLanes().length===8&&BRender.build(false).laneX.size===8));
    });
    await check('later larger boxes do not inherit hidden lanes from the deleted figure',async()=>{
      assert(await page.evaluate(()=>{BApp.setDefaultLaneCount(9);const b=BApp.S.blots[0],pc=b.pieces[0],d=BApp.defaultBox(b,pc,0,0);const r=BApp.addRowBox(b.id,pc.id,d.u0,d.u1,d.v0,d.v1);BApp.commit();return r.segs[0].lanes.length===9&&BApp.figLanes().length===9&&!BApp.S.lanes[8].hidden;}));
    });
    await check('blank default also recovers from an empty one-lane range, scoped to its layout column',async()=>{
      assert(await page.evaluate(()=>{
        BApp.setDefaultLaneCount(null);const existing=BApp.S.rows[0],c=BApp.addColumn();BApp.commit();
        const before=JSON.stringify(BApp.columnData('main')),b=BApp.blot(existing.blot),pc=BApp.pieceOf(existing,existing.segs[0]);
        const r=BApp.addRowAt(b.id,pc.cx,pc.cy);BApp.commit();const n=BApp.figLanes(c.id).length;
        const safe=JSON.stringify(BApp.columnData('main').range)===JSON.stringify(JSON.parse(before).range);
        return n>1&&safe&&r.segs[0].lanes.length>1;
      }));
    });
    await check('typing a default immediately enables the batch action without an extra confirmation keystroke',async()=>{
      await page.evaluate(()=>{BApp.setDefaultLaneCount(null);BApp.commit();UI.openStep(3);});
      assert(await page.locator('#applyDefaultLanes').isDisabled());await page.fill('#defaultLanesNew','7');
      await page.evaluate(()=>new Promise(resolve=>{BApp.refresh();requestAnimationFrame(()=>requestAnimationFrame(resolve));}));assert.equal(await page.inputValue('#defaultLanesNew'),'7');
      // Let Playwright scroll and wait for the actual button, rather than clicking stale
      // viewport coordinates. Verify the user-visible result, not browser focus internals.
      await page.click('#applyDefaultLanes');assert(await page.evaluate(()=>BApp.S.defaultLaneCount===7&&BApp.S.rows.every(r=>r.segs.every(s=>s.lanes.length===7))));
    });
    await check('presets, project save/reopen and undo retain default and local counts',async()=>{
      assert(await page.evaluate(async()=>{
        BApp.setDefaultLaneCount(7);BApp.commit();const p=BApp.savePreset('Lane test');BApp.setDefaultLaneCount(3);BApp.applyPreset(p);if(BApp.S.defaultLaneCount!==7)return false;
        const snap=()=>JSON.stringify(BApp.S,(k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v),before=snap(),data=await BApp.saveProject();await BApp.openProject(new File([data],'lanes.blotfig'));return snap()===before;
      }));
    });
    await check('lane-count flow has no JavaScript errors',async()=>assert.deepEqual(errors,[]));
  }catch(e){results.push(['FAIL','lane-count run',e.stack]);}finally{await ctx.close();}return results;
}
