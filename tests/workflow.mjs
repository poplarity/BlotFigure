// Regression coverage for image organisation, independent crops and manual marker ticks.
import assert from 'node:assert/strict';
export async function workflowChecks(browser, base) {
  const results = [], ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const page = await ctx.newPage(), errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const check = async (name, fn) => { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
  try {
    await page.goto(`${base}/index.html?demo=1&step=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 180000 });
    await check('import defers strip/protein analysis until image groups are confirmed', async () => {
      assert.deepEqual(await page.evaluate(() => [Object.keys(BApp.analysis).length, BApp.S.rows.length, BApp.S.blots.length]), [0, 0, 2]);
    });
    await check('batch removal is immediate, does not analyse, and is undoable', async () => {
      const r = await page.evaluate(() => {
        const ids = BApp.S.blots[0].images.slice(0, 2), before = JSON.stringify(BApp.S);
        let analyses = 0; const fn = WB.analyzeSession; WB.analyzeSession = (...a) => { analyses++; return fn(...a); };
        const start = performance.now(); BApp.removeImages(ids); BApp.commit(); const ms = performance.now() - start;
        const gone = ids.every(id => !BApp.images.has(id)); BApp.undo();
        const restored = before === JSON.stringify(BApp.S) && ids.every(id => BApp.images.has(id));
        WB.analyzeSession = fn; return { gone, restored, analyses, ms };
      });
      assert(r.gone && r.restored, JSON.stringify(r)); assert.equal(r.analyses, 0); assert(r.ms < 1500, JSON.stringify(r));
    });
    await check('drag a picture directly between groups, then undo', async () => {
      const [from, to, id] = await page.evaluate(() => [BApp.S.blots[0].id, BApp.S.blots[1].id, BApp.S.blots[0].images[0]]);
      await page.locator(`.thumb[data-image="${id}"]`).dragTo(page.locator(`.blot-card[data-blot="${to}"] .blot-head`));
      assert(await page.evaluate(({to,id}) => BApp.blot(to).images.includes(id), {to,id}));
      await page.click('#btnUndo');
      assert(await page.evaluate(({from,id}) => BApp.blot(from).images.includes(id), {from,id}));
    });
    await check('select and remove pictures from the thumbnail toolbar', async () => {
      const count = await page.evaluate(() => BApp.images.size);
      await page.locator('.image-select').first().check();
      await page.click('#removeImages');
      assert.equal(await page.evaluate(() => BApp.images.size), count - 1);
      await page.click('#btnUndo');
      assert.equal(await page.evaluate(() => BApp.images.size), count);
    });
    await page.evaluate(() => UI.nextStep(1));
    await check('step 2 finds outlines but generates no protein boxes', async () => {
      assert(await page.evaluate(() => BApp.S.rows.length === 0 && BApp.S.blots.every(b => b.pieces.length > 0 && BApp.analysis[b.id].outlinesOnly)));
    });
    await page.evaluate(() => { BApp.makeBoxes(); BApp.commit(); UI.openStep(3); });
    await check('weak automatic rows are shown and have unique box identities', async () => {
      const r = await page.evaluate(() => {
        const b = BApp.S.blots[0], A = BApp.analysis[b.id], before = A.rows.map(r => r.expo[r.choice].snr);
        A.rows.forEach(r => { r.expo[r.choice].snr = 1; }); const weak = BApp.rowsFromAnalysis(b);
        A.rows.forEach((r,i) => { r.expo[r.choice].snr = before[i]; });
        const boxes = BApp.S.rows.flatMap(r => r.segs);
        return { shown: weak.every(r => r.weak && !r.hidden), n: boxes.length, ids: new Set(boxes.map(s=>s.id)).size, labels: new Set(boxes.map(s=>s.label)).size };
      });
      assert(r.shown && r.n === r.ids && r.n === r.labels, JSON.stringify(r));
    });
    await check('an excluded middle lane becomes two source boxes and can be restored', async () => {
      const r = await page.evaluate(() => {
        const row = BApp.S.rows[0], sg = row.segs[0], before = JSON.stringify(row);
        const n = sg.lanes.length; sg.lanes[Math.floor(n/2)].r = 'm'; BApp.splitExcluded(row); BApp.commit();
        const split = row.segs.length === 2 && row.segs.every(s => s.lanes.every(l=>l.r==='s')) && row.segs[0].x1 < row.segs[1].x0;
        const restored = BApp.restoreContinuous(row, row.segs[0].cut.id); BApp.commit();
        const complete = row.segs.length === 1 && row.segs[0].lanes.length === n;
        Object.assign(row, JSON.parse(before)); BApp.commit();
        return { split, restored, complete };
      }); assert(r.split && r.restored && r.complete, JSON.stringify(r));
    });
    await check('lane count applies without a second button', async () => {
      await page.evaluate(() => { BApp.selRow = BApp.S.rows[0].id; BApp.emit('select'); });
      const input = page.locator('.bt-even input').first();
      await input.fill('6'); await input.press('Tab');
      assert.equal(await page.evaluate(() => BApp.curSeg(BApp.row(BApp.selRow)).lanes.length), 6);
      assert.equal(await page.locator('[data-act="even"]').count(), 0);
    });
    await check('legacy combined regions detach without losing exposure, levels or names', async () => {
      await page.evaluate(() => {
        const row=BApp.S.rows[0], original=row.segs[0], clone=x=>JSON.parse(JSON.stringify(x));
        const a=clone(original), b=clone(original);
        a.lanes=a.lanes.slice(0,2);b.lanes=b.lanes.slice(-2);b.id=null;b.label=null;
        a.x1=BApp.laneRight(a,1);b.x0=BApp.laneLeft(b,0);b.c0=3;b.above=row.above*.75;b.below=row.below*.8;
        row.segs=[a,b];row.name='Legacy target';row.lv={black:.01,white:.7};row.auto=false;BApp.commit();
        window.legacyBefore={img:row.img,lv:JSON.stringify(row.lv),name:row.name,boxes:row.segs.map(s=>s.id)};
        BApp.selRow=row.id;BApp.emit('select');
      });
      await page.locator('[data-act="split"]').click();
      const r=await page.evaluate(()=>{
        const rows=BApp.S.rows.filter(r=>r.name===legacyBefore.name);
        return rows.length===2&&rows.every(r=>r.img===legacyBefore.img&&JSON.stringify(r.lv)===legacyBefore.lv&&!r.auto)&&BApp.boundRows().length===0;
      });assert(r);
    });
    await check('preview horizontal drag moves the picked region only', async () => {
      const info=await page.evaluate(()=>{const r=BApp.S.rows[0],s=r.segs[0],o=BApp.S.rows[1];return {id:s.id,row:r.id,otherId:o.id,c0:s.c0,other:o.segs[0].c0};});
      const rect=await page.locator(`#preview image[data-box="${info.id}"]`).first().boundingBox();
      await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
      await page.mouse.move(rect.x+rect.width,rect.y+rect.height/2,{steps:5});await page.mouse.up();
      const after=await page.evaluate(i=>[BApp.row(i.row).segs[0].c0,BApp.row(i.otherId).segs[0].c0],info);
      assert(after[0]>info.c0&&after[1]===info.other,JSON.stringify({info,after}));
    });
    await check('dropping onto another protein only reorders, never combines it', async () => {
      const orderBefore=await page.evaluate(()=>BApp.S.rows.map(r=>r.id));
      const before=await page.evaluate(()=>BApp.S.rows.map(r=>({id:r.id,boxes:r.segs.map(s=>s.id),img:r.img,lv:r.lv})).sort((a,b)=>a.id.localeCompare(b.id)));
      const imgs=page.locator('#preview image[data-row]'),a=await imgs.nth(0).boundingBox(),b=await imgs.nth(1).boundingBox();
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
      await page.mouse.move(a.x+a.width/2,b.y+b.height*.7,{steps:6});await page.mouse.up();
      const after=await page.evaluate(()=>BApp.S.rows.map(r=>({id:r.id,boxes:r.segs.map(s=>s.id),img:r.img,lv:r.lv})).sort((a,b)=>a.id.localeCompare(b.id)));
      assert.deepEqual(after,before);assert.notDeepEqual(await page.evaluate(()=>BApp.S.rows.map(r=>r.id)),orderBefore);
    });
    await check('switching exposure or levels of one region leaves the other pixels unchanged', async () => {
      const r=await page.evaluate(()=>{
        const rows=BApp.S.rows.filter(r=>r.name==='Legacy target'),[a,b]=rows,ch=BApp.chemiOf(BApp.blot(a.blot));
        a.img=b.img=ch[0].id;a.auto=b.auto=false;delete a.lv;delete b.lv;BApp.commit();
        const raster=r=>{const s=r.segs[0];return BApp.runRaster(r,s,BApp.pieceOf(r,s),0,s.lanes.length-1,1).href;};
        const before=raster(b),bi=b.img,lv=JSON.stringify(BApp.rowLevels(b));
        a.img=ch[ch.length-1].id;BApp.commit();const exposure=before===raster(b)&&b.img===bi&&JSON.stringify(BApp.rowLevels(b))===lv;
        a.lv={black:.02,white:.6};BApp.commit();return exposure&&before===raster(b);
      });assert(r);
    });
    await check('browsing another picture never silently enables whole-image level editing', async () => {
      await page.evaluate(()=>{const r=BApp.S.rows[0];BApp.selRow=r.id;BApp.viewBlot=r.blot;BApp.viewImg=BApp.chemiOf(BApp.blot(r.blot)).find(c=>c.id!==r.img).id;BApp.emit('select');});
      assert(await page.locator('#lvBlack').isDisabled());
      await page.click('#lvBackPic');assert(!(await page.locator('#lvBlack').isDisabled()));
    });
    await check('splicing one row does not insert a gap in continuous neighbouring rows', async () => {
      const r = await page.evaluate(() => {
        const cut=BApp.S.rows.find(r=>r.segs.length===1&&r.segs[0].lanes.length>=5);cut.segs[0].lanes[2].r='m';BApp.splitExcluded(cut);BApp.commit();
        const row = BApp.S.rows.find(r => r.segs.length === 1 && r.segs[0].lanes.every(l=>l.r==='s'));
        const d = new DOMParser().parseFromString(BRender.build(true).svg, 'image/svg+xml');
        return row && d.querySelectorAll(`image[data-row="${row.id}"]`).length === 1;
      }); assert(r);
    });
    await check('one marker is sufficient for a tick and needs no second-mark confirmation', async () => {
      await page.evaluate(() => {
        BApp.S.blots.forEach(b => b.pieces.forEach(pc => {
          const r=BApp.S.rows.find(r=>r.segs.some(s=>s.piece===pc.id)); if (!r) return;
          const sg=r.segs.find(s=>s.piece===pc.id); pc.marks=[{u:BApp.ladderU(pc),v:sg.vc,kda:75}];
        }));
        BApp.S.step=4;BApp.commit();UI.openStep(4);
      });
      const before = dialogs.length;
      await page.evaluate(() => UI.nextStep(4));
      assert.equal(dialogs.length,before);
      assert(await page.evaluate(() => BRender.build(false).svg.includes('data-marker-size="75"') && BApp.rowKda(BApp.S.rows[0])===null));
    });
    await check('crowded manual marker labels are retained across adjacent rows', async () => {
      const r=await page.evaluate(() => {
        const rows=BApp.S.rows.filter(r=>!r.hidden), a=rows[1], b=rows[2], sa=a.segs[0], sb=b.segs[0];
        BApp.pieceOf(a,sa).marks=[{u:0,v:sa.vc+BApp.boxBelow(a,sa)-1,kda:51}];
        BApp.pieceOf(b,sb).marks=[{u:0,v:sb.vc-BApp.boxAbove(b,sb)+1,kda:49}];
        BApp.commit();const svg=BRender.build(false).svg;
        return svg.includes('data-marker-size="51"')&&svg.includes('data-marker-size="49"');
      });assert(r);
    });
    await check('independent regions and marker-cut fragments survive project save and reopening', async () => {
      const r = await page.evaluate(async () => {
        const snapshot = () => JSON.stringify(BApp.S, (k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v);
        const before = snapshot(), data = await BApp.saveProject();
        await BApp.openProject(new File([data], 'boxes.blotfig'));
        return before === snapshot();
      }); assert(r);
    });
    await check('re-analysis keeps separate boxes on the same strip', async () => {
      const r = await page.evaluate(() => {
        const row = BApp.S.rows.find(r => r.segs.length > 1), ids = row.segs.map(s=>s.id).sort();
        BApp.reanalyze(BApp.blot(row.blot)); BApp.commit();
        return JSON.stringify(ids) === JSON.stringify(BApp.row(row.id).segs.map(s=>s.id).sort());
      }); assert(r);
    });
    await check('long image names remain inside the picture menu', async () => {
      await page.evaluate(() => {const rec=BApp.images.values().next().value;rec.name='very_long_marker_image_'.repeat(20)+'.tif';UI.openStep(1);});
      await page.locator('.thumb .more').first().click();
      const r=await page.locator('#popover').evaluate(el=>({w:el.clientWidth,scroll:el.scrollWidth}));
      assert(r.scroll<=r.w+2,JSON.stringify(r));
    });
    await check('side-by-side membrane pieces are never automatically combined by the app engine', async () => {
      const r=await page.evaluate(()=>{
        const ses=WBDemo.movedSession(),image=i=>({w:i.width,h:i.height,data:i.data});
        const chemi=ses.images.filter(i=>i.exposure).map(i=>({id:i.name,img:image(i),exposure:i.exposure}));
        const marker=ses.images.find(i=>!i.exposure);
        const out=WB.analyzeSession(chemi,{id:marker.name,img:image(marker)},{noCalib:true});
        return {n:out.rows.length,independent:out.rows.every(r=>r.segs.length===1)};
      });assert(r.n>=4&&r.independent,JSON.stringify(r));
    });
    await check('workflow has no JavaScript errors', async () => assert.deepEqual(errors,[]));
  } catch(e) { results.push(['FAIL','workflow run',e.stack]); }
  finally {await ctx.close();}
  return results;
}
