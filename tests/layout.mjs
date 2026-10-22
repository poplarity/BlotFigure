import assert from 'node:assert/strict';

export async function layoutChecks(browser, base) {
  const results = [], ctx = await browser.newContext({ viewport: { width: 1720, height: 1050 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const check = async (name, fn) => { console.log('layout:',name); try { await fn(); results.push(['ok', name]); } catch(e) { results.push(['FAIL', name, e.message]); } };
  try {
    await page.goto(`${base}/index.html?demo=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout:180000 });
    await page.evaluate(() => { UI.openStep(5); window.layoutInitial = JSON.stringify(BApp.S); });
    await check('add an empty optional column through the UI', async () => {
      await page.click('#addLayoutColumn');
      assert.equal(await page.evaluate(() => BApp.layoutColumns().length), 2);
      assert(await page.locator('#preview').textContent().then(s => s.includes('Drop a region here')));
    });
    await check('real drag into another column preserves pixels, crop, exposure and levels', async () => {
      const r = await page.evaluate(() => {
        const row = BApp.S.rows.find(r => !r.hidden), col = BApp.layoutColumns()[1].id;
        window.layoutRow = row.id; window.layoutColumn = col;
        window.layoutBefore = JSON.stringify({ img:row.img, lv:BApp.rowLevels(row), segs:row.segs, above:row.above, below:row.below });
        window.layoutPixels = BRender.build(true).svg.match(new RegExp('data-row="'+row.id+'"[^>]*href="([^"]+)"'))[1];
        return { id:row.id, col };
      });
      const src = await page.locator(`image[data-row="${r.id}"]`).first().boundingBox();
      const target = await page.locator(`[data-layout-column="${r.col}"] rect`).first().boundingBox();
      await page.mouse.move(src.x + src.width/2, src.y + src.height/2); await page.mouse.down();
      await page.mouse.move(target.x + target.width/2, target.y + target.height/2, {steps:15}); await page.mouse.up();
      assert(await page.evaluate(() => {
        const row = BApp.row(layoutRow);
        return BApp.rowColumn(row) === layoutColumn && layoutBefore === JSON.stringify({img:row.img,lv:BApp.rowLevels(row),segs:row.segs,above:row.above,below:row.below})
          && layoutPixels === BRender.build(true).svg.match(new RegExp('data-row="'+row.id+'"[^>]*href="([^"]+)"'))[1];
      }));
    });
    await check('column titles, lane names and Excel conditions are independent', async () => {
      await page.fill('#columnTitle', 'Drug response'); await page.locator('#columnTitle').press('Tab');
      await page.locator('#laneBulk').evaluate(el=>el.closest('details').open=true);
      await page.fill('#laneBulk', 'Ctrl, Drug'); await page.locator('#laneBulk').press('Tab');
      await page.locator('#conditionBulk').evaluate(el => el.closest('details').open = true);
      await page.fill('#conditionBulk', 'Dose\t0\t10 nM\nTime\t\t24 h'); await page.click('#condReplace');
      assert(await page.evaluate(() => {
        const c = BApp.columnData(layoutColumn);
        return c.conditions[1].values[0] === '' && c.conditions[1].values[1] === '24 h' && c.lanes[1].name === 'Drug' && BApp.S.conditions.length === 0 && BApp.S.lanes[0].name !== 'Ctrl';
      }));
    });
    await check('figure text editor edits only the clicked column, including IME', async () => {
      const col = await page.evaluate(() => layoutColumn);
      await page.locator(`g[data-edit="lane"][data-column="${col}"]`).first().click();
      await page.fill('#floatEd', '中文条件');
      await page.locator('#floatEd').dispatchEvent('keydown', {key:'Enter',isComposing:true,keyCode:229});
      assert(await page.locator('#floatEd').isVisible());
      await page.locator('#floatEd').press('Enter'); await page.locator('#floatEd').press('Escape');
      assert(await page.evaluate(() => BApp.columnData(layoutColumn).lanes[0].name === '中文条件' && BApp.S.lanes[0].name !== '中文条件'));
    });
    await check('custom condition values are edited without being erased by a click', async () => {
      const col = await page.evaluate(() => layoutColumn);
      await page.locator(`g[data-edit="cond"][data-column="${col}"][data-r="0"][data-j="2"]`).click();
      assert.equal(await page.inputValue('#conditionValue'), '10 nM');
      await page.fill('#conditionValue', '20 nM'); await page.click('#conditionDone');
      assert.equal(await page.evaluate(() => BApp.columnData(layoutColumn).conditions[0].values[1]), '20 nM');
    });
    await check('copying labels creates no shared references; oversized paste is rejected', async () => {
      assert(await page.evaluate(() => {
        const before = JSON.stringify(BApp.columnData(layoutColumn));
        const tooMany = BApp.pasteConditions('Dose\t' + Array(100).fill('+').join('\t'), layoutColumn, true);
        if (!tooMany.error || JSON.stringify(BApp.columnData(layoutColumn)) !== before) return false;
        BApp.copyColumnLabels(layoutColumn, 'main'); BApp.S.conditions[0].values[0] = 'independent';
        BApp.S.lanes[0].name = 'Different'; BApp.commit();
        return BApp.columnData(layoutColumn).conditions[0].values[0] === '0' && BApp.columnData(layoutColumn).lanes[0].name === '中文条件';
      }));
    });
    await check('top alignment and optional row alignment do not resize image content', async () => {
      assert(await page.evaluate(() => {
        const first = BApp.S.rows.find(r => BApp.rowColumn(r) === 'main' && !r.hidden);
        BApp.moveToColumn(BApp.S.rows.find(r => BApp.rowColumn(r) === 'main' && r !== first && !r.hidden), layoutColumn);
        BApp.commit(); const f = BRender.build(true), a=f.rowBoxes.filter(r=>r.columnId==='main'), b=f.rowBoxes.filter(r=>r.columnId===layoutColumn);
        const before = new Map(f.rowBoxes.map(r=>[r.id,r.h]));
        BApp.S.style.alignColumnRows=true; BApp.commit(); const g=BRender.build(true), aa=g.rowBoxes.filter(r=>r.columnId==='main'),bb=g.rowBoxes.filter(r=>r.columnId===layoutColumn);
        return a[0].y===b[0].y && aa[1].y===bb[1].y && g.rowBoxes.every(r=>r.h===before.get(r.id));
      }));
    });
    await check('marker size and hiding labels retain calibration and can be restored', async () => {
      await page.evaluate(() => {
        const r=BApp.row(layoutRow),s=r.segs[0],p=BApp.pieceOf(r,s); s.rot=0;
        p.marks=[{u:0,v:s.vc-1,kda:50},{u:0,v:s.vc+1,kda:40}]; BApp.S.style.showMW=true;
        BApp.activeColumn=layoutColumn; BApp.commit(); window.calBefore=JSON.stringify(BApp.pieceCal(BApp.blot(r.blot),p,s));
      });
      // Hit the label group (including its white backing), not the text-only quad:
      // WebKit reports an incorrect text quad inside this translated SVG group.
      const marker = page.locator(`g[data-edit="marker"][data-row="${await page.evaluate(()=>layoutRow)}"]`).last();
      await marker.click();
      await page.fill('#globalMarkerPt','4.5'); await page.locator('#globalMarkerPt').press('Tab');
      await page.locator('[data-mark-toggle]').first().uncheck(); await page.click('#markerDisplayDone');
      assert(await page.evaluate(() => {
        const r=BApp.row(layoutRow),s=r.segs[0],p=BApp.pieceOf(r,s);
        return BApp.S.style.markerPt===4.5 && !r.markerPt && r.hiddenMarkers.length===1 && p.marks.length===2 && JSON.stringify(BApp.pieceCal(BApp.blot(r.blot),p,s))===calBefore;
      }));
      await page.locator(`.row-menu[data-row="${await page.evaluate(()=>layoutRow)}"]`).click();
      await page.locator('[data-mark-toggle]').first().check(); await page.click('#markerDisplayDone');
      assert.equal(await page.evaluate(()=> BApp.row(layoutRow).hiddenMarkers.length),0);
    });
    await check('vertical side labels, bracket style and bottom titles fit SVG bounds', async () => {
      const r=await page.evaluate(()=>{
        const rows=BApp.rowsInColumn(layoutColumn);const k=BApp.addBracket(rows[0].id,0,rows[1].id,1);k.text='Immunoprecipitation';k.vertical=true;k.line=true;
        BApp.layoutColumns()[1].titleSide='bottom';BApp.commit(); const f=BRender.build(false);
        return {ok:f.svg.includes('rotate(-90)')&&f.svg.includes('Immunoprecipitation')&&f.svg.includes('Drug response'),w:f.w,h:f.h};
      }); assert(r.ok && r.w>0 && r.h>0);
    });
    await check('a bracket split across columns remains removable and undoable',async()=>{
      const k=await page.evaluate(()=>{const bk=BApp.S.brackets.at(-1);BApp.moveToColumn(BApp.row(bk.r1),'main');BApp.commit();return BApp.S.brackets.length-1;});
      const del=page.locator(`#annoList [data-bdel="${k}"]`);assert(await del.count()===1);
      await del.click();await page.click('#btnUndo');
      assert(await page.evaluate(()=>BApp.S.brackets.length>0&&!BApp.bracketRows(BApp.S.brackets.at(-1)).length));
      await page.click('#btnUndo');
      assert(await page.evaluate(()=>BApp.bracketRows(BApp.S.brackets.at(-1)).length===2));
    });
    await check('column deletion is safe, undo works, and projects/logs preserve column identities', async()=>{
      assert(await page.evaluate(async()=>{
        if(BApp.removeColumn(layoutColumn))return false;
        const c=BApp.addColumn();BApp.commit();BApp.removeColumn(c.id);BApp.commit();BApp.undo();
        if(!BApp.layoutColumns().some(x=>x.id===c.id))return false;
        BApp.redo();const log=BApp.processingLog();if(log.figure.layoutColumns.length!==2||!log.rows.some(r=>r.column===layoutColumn))return false;
        const snap=()=>JSON.stringify(BApp.S,(k,v)=>typeof v==='number'?Math.round(v*1e6)/1e6:v),before=snap(),data=await BApp.saveProject();
        await BApp.openProject(new File([data],'columns.blotfig'));return snap()===before;
      }));
    });
    await check('column templates never replace image settings',async()=>{
      assert(await page.evaluate(()=>{
        const t=BApp.template(), before=JSON.stringify(BApp.S.rows.map(r=>[r.img,r.lv,r.segs]));
        BApp.applyTemplate(t);BApp.commit();return BApp.layoutColumns().length===2&&before===JSON.stringify(BApp.S.rows.map(r=>[r.img,r.lv,r.segs]));
      }));
    });
    await check('multi-column PNG, uncropped originals and CSV export every column',async()=>{
      const out=await page.evaluate(async()=>{
        const downloads=[], original=Export.download;
        Export.download=(blob,name)=>downloads.push({blob,name});
        try {
          document.getElementById('btnQuant').click(); document.getElementById('btnRaw').click();
          const start=performance.now();while(downloads.length<2 && performance.now()-start<10000) await new Promise(r=>setTimeout(r,20));
          const csv=await downloads.find(x=>x.name.endsWith('.csv'))?.blob.text();
          const f=BRender.build(false),c=await Export.svgToCanvas(f.svg,f.w,f.h,150);
          return {csv,raw:downloads.some(x=>x.name==='uncropped_originals.png' && x.blob.size>1000),png:c.width>100&&c.height>10,cols:f.columnBoxes.length};
        } finally {Export.download=original;}
      });
      assert(out.raw&&out.png&&out.cols===2);assert.match(out.csv,/layout column,main/);assert.match(out.csv,/Drug response/);assert.match(out.csv,/20 nM|lane|protein/);
    });
    await check('region menu moves without merging; the empty first column can be removed',async()=>{
      const id=await page.evaluate(()=>{BApp.activeColumn=layoutColumn;BApp.commit();return layoutRow;});
      await page.locator(`.row-menu[data-row="${id}"]`).click();
      await page.selectOption('#regionColumn','main');
      assert.equal(await page.evaluate(()=>BApp.rowColumn(BApp.row(layoutRow))),'main');
      assert(await page.evaluate(()=>{
        BApp.rowsInColumn('main').slice().forEach(r=>BApp.moveToColumn(r,layoutColumn));BApp.commit();
        const before=JSON.stringify(BApp.S.rows.map(r=>[r.id,r.img,r.segs,r.lv]));
        if(!BApp.removeColumn('main'))return false;BApp.commit();
        const ok=BApp.layoutColumns().length===1 && BApp.S.rows.every(r=>BApp.rowColumn(r)==='main')&&before===JSON.stringify(BApp.S.rows.map(r=>[r.id,r.img,r.segs,r.lv]));
        BApp.undo();return ok&&BApp.layoutColumns().length===2;
      }));
    });
    await check('legacy project without column metadata opens as one column',async()=>{
      assert(await page.evaluate(async()=>{
        BApp.S=JSON.parse(layoutInitial);delete BApp.S.layoutColumns;BApp.S.rows.forEach(r=>delete r.column);
        BApp.activeColumn='main';const data=await BApp.saveProject();await BApp.openProject(new File([data],'legacy.blotfig'));
        return BApp.layoutColumns().length===1 && BRender.build(false).rowBoxes.length===BApp.S.rows.filter(r=>!r.hidden).length;
      }));
    });
    await check('multi-column layout has no JavaScript errors',async()=>assert.deepEqual(errors,[]));
  } catch(e) { results.push(['FAIL','layout run',e.stack]); }
  finally { await ctx.close(); }
  return results;
}
