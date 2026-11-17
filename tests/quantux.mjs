export async function quantUxChecks(browser, base) {
  const results = [], errors = [];
  const check = (name, passed, detail) => results.push(passed ? ['ok', name] : ['FAIL', name, detail || '']);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(`${base}/index.html?demo=1&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    const fixture = await page.evaluate(() => {
      UI.openStep(3); const row = BApp.S.rows.find(candidate => !candidate.hidden), segment = row.segs[0];
      row.name = 'GAPDH'; BApp.selRow = row.id; BApp.selSeg = BApp.boxId(segment); BApp.viewBlot = row.blot; BApp.viewImg = row.img;
      BApp.setQuant({ controlRow: row.id });
      return { row: row.id, box: BApp.boxId(segment), width: segment.x1 - segment.x0, height: BApp.boxAbove(row, segment) + BApp.boxBelow(row, segment) };
    });
    check('selected protein crop dimensions are visible in source pixels without becoming figure content', await page.locator('#boxDimensions').count() === 1 && /px/.test(await page.textContent('#boxDimensions'))
      && await page.evaluate(() => !/Crop size|Source size/.test(BRender.build(false).svg)));
    const dimensionApi = await page.evaluate(fixture => {
      const row = BApp.row(fixture.row), segment = row.segs.find(candidate => BApp.boxId(candidate) === fixture.box);
      return BApp.boxDimensions ? BApp.boxDimensions(row, segment) : null;
    }, fixture);
    check('protein-box dimensions use actual rotated source geometry, not displayed CSS sizes', dimensionApi && Math.abs(dimensionApi.width - fixture.width) < 1e-6 && Math.abs(dimensionApi.height - fixture.height) < 1e-6, JSON.stringify(dimensionApi));
    await page.click('#btnExportMenu'); await page.click('#btnQuant');
    check('ROI editing has a first-class sidebar section before normalisation and a preview-toolbar shortcut', await page.locator('#qRoiSetup').count() === 1 && await page.locator('#qRoiEdit').isVisible() && await page.locator('#qRoiToolbar').isVisible()
      && await page.evaluate(() => document.getElementById('qRoiSetup').compareDocumentPosition(document.getElementById('qMethodBox')) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (!await page.locator('#qRoiEdit').count()) return results;
    await page.selectOption('#qRoiRow', fixture.row);
    check('the sidebar row picker includes the loading control and shows its fixed dimensions and review state', await page.locator(`#qRoiRow option[value="${fixture.row}"]`).count() === 1 && /px/.test(await page.textContent('#qRoiSummary')));
    const unchanged = await page.evaluate(() => JSON.stringify({ rows: BApp.S.rows, quant: BApp.S.quant, levels: BApp.S.levels }));
    await page.click('#qRoiEdit'); await page.waitForSelector('#qRoiDialog[open]');
    check('the ROI editor groups shared dimensions upfront and folds optional background/method settings', await page.locator('#qRoiAdvanced').count() === 1 && await page.locator('#qRoiAdvanced').getAttribute('open') === null
      && await page.locator('#qRoiWidth').isVisible() && await page.locator('#qRoiHeight').isVisible() && await page.locator('#qRoiToolSeg button').count() === 3);
    check('shared dimensions and area are displayed next to the source canvas', /px/.test(await page.textContent('#qRoiSize')) && /px²/.test(await page.textContent('#qRoiSize')));
    const available = await page.evaluate(() => typeof WBQuantROI.probe === 'function');
    check('the selected fixed rectangle exposes direct shared-template resize handles', available);
    if (!available) return results;
    await page.click('#qRoiFocus');
    const canvas = page.locator('#qRoiCanvas'), rectangle = await canvas.boundingBox(), before = await page.evaluate(() => WBQuantROI.probe());
    const handle = before.handles.se;
    await page.mouse.move(rectangle.x + handle[0], rectangle.y + handle[1]); await page.mouse.down();
    await page.mouse.move(rectangle.x + handle[0] + 10, rectangle.y + handle[1] + 8, { steps: 5 }); await page.mouse.up();
    const resized = await page.evaluate(() => WBQuantROI.probe());
    check('dragging one resize handle updates the common source-pixel size for every lane', resized.width > before.width && resized.height > before.height
      && new Set(resized.measurements.filter(Boolean).map(value => value.widthPx)).size === 1 && new Set(resized.measurements.filter(Boolean).map(value => value.heightPx)).size === 1, JSON.stringify({ before: [before.width, before.height], after: [resized.width, resized.height] }));
    await page.click('#qRoiFit');
    const point = await page.evaluate(() => WBQuantROI.probe().centres[1]), canvasBox = await canvas.boundingBox();
    await page.mouse.click(canvasBox.x + point[0], canvasBox.y + point[1]);
    check('clicking a lane on the source selects it without a move or jump', await page.inputValue('#qRoiLane') === '1');
    await page.click('#qRoiNext');
    check('previous/next controls select lanes and keep the canvas and table selection in sync', await page.inputValue('#qRoiLane') === '2' && await page.locator('#qRoiValues tr.sel td').first().textContent() === '3');
    await page.locator('#qRoiValues tr[data-lane-index="0"]').click();
    check('the live measurement table selects and focuses the corresponding source rectangle', await page.inputValue('#qRoiLane') === '0');
    await page.click('#qRoiToolSeg [data-roi-tool="row"]');
    const rowBefore = await page.evaluate(() => WBQuantROI.probe()), centre = rowBefore.centres[0], area = await canvas.boundingBox();
    await page.mouse.move(area.x + centre[0], area.y + centre[1]); await page.mouse.down(); await page.mouse.move(area.x + centre[0] + 8, area.y + centre[1] + 4, { steps: 4 }); await page.mouse.up();
    const rowAfter = await page.evaluate(() => WBQuantROI.probe());
    check('move-all shifts the entire row without changing the shared dimensions', rowAfter.width === rowBefore.width && rowAfter.height === rowBefore.height
      && rowAfter.centres.every((value, index) => Math.abs(value[0] - rowBefore.centres[index][0] - 8) < 0.1));
    await page.click('#qRoiCancel');
    check('direct resize and move drafts are discarded together on cancel', unchanged === await page.evaluate(() => JSON.stringify({ rows: BApp.S.rows, quant: BApp.S.quant, levels: BApp.S.levels })));
    await page.click('#qRoiToolbar'); await page.click('#qRoiAdvanced > summary');
    await page.fill('#qRoiWidth', '32'); await page.fill('#qRoiHeight', '18'); await page.fill('#qRoiAngle', '5'); await page.locator('#qRoiAngle').press('Tab');
    await page.click('#qRoiFocus');
    const rotated = await page.evaluate(() => WBQuantROI.probe()), rotatedBox = await canvas.boundingBox();
    await page.mouse.move(rotatedBox.x + rotated.handles.e[0], rotatedBox.y + rotated.handles.e[1]); await page.mouse.down();
    await page.mouse.move(rotatedBox.x + rotated.handles.e[0] + 8, rotatedBox.y + rotated.handles.e[1], { steps: 3 }); await page.mouse.up();
    const edge = await page.evaluate(() => WBQuantROI.probe());
    check('rotated edge resizing changes only the requested dimension and keeps one shared area', edge.width > 32 && edge.height === 18);
    await page.click('#qRoiApply');
    check('apply persists the shared template and refreshes sidebar dimensions', await page.evaluate(row => BApp.quantSettings().rois[row]?.height === 18, fixture.row) && /18/.test(await page.textContent('#qRoiSummary')));
    await page.click('#qEditRoi'); await page.click('#qRoiApply');
    await page.locator('#qRoiDialog').waitFor({ state: 'detached' });
    check('applying from a regenerated detail action restores keyboard focus to its replacement', await page.evaluate(() => document.activeElement?.id === 'qEditRoi'), await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 220)));
    await page.click('#qRoiToolbar'); await page.fill('#qRoiWidth', ''); await page.click('#qRoiAdvanced > summary'); await page.click('#qRoiReset');
    check('resetting an invalid size restores both measurements and the enabled Apply action', await page.locator('#qRoiApply').isEnabled() && Number(await page.inputValue('#qRoiWidth')) >= 2 && !/Enter valid/.test(await page.textContent('#qRoiValidation')));
    await page.click('#qRoiCancel');
    await page.evaluate(rowId => {
      const row = BApp.row(rowId); window.__uxSavedSegments = JSON.parse(JSON.stringify(row.segs));
      row.segs.forEach(segment => segment.lanes = segment.lanes.slice(0, 4)); BApp.commit();
    }, fixture.row);
    await page.click('#qRoiToolbar'); await page.click('#qRoiFocus'); await page.selectOption('#qRoiLane', { value: '4' });
    const missingSelection = await page.evaluate(() => ({ lane: document.getElementById('qRoiLane').value, selected: document.querySelector('#qRoiValues tr.sel')?.dataset.laneIndex, text: document.querySelector('#qRoiValues tr.sel')?.textContent }));
    const missingBox = await page.locator('#qRoiCanvas').boundingBox();
    await page.mouse.click(missingBox.x + missingBox.width - 2, missingBox.y + 2);
    check('a missing source lane retains working navigation and an explicit empty selection in zoom mode', missingSelection.lane === '4' && missingSelection.selected === '4' && /No source/.test(missingSelection.text)
      && await page.inputValue('#qRoiLane') === await page.locator('#qRoiValues tr.sel').getAttribute('data-lane-index'), JSON.stringify(missingSelection));
    await page.click('#qRoiCancel'); await page.evaluate(rowId => { BApp.row(rowId).segs = window.__uxSavedSegments; BApp.commit(); }, fixture.row);
    await page.click('#btnLang'); await page.click('#qRoiToolbar'); await page.setViewportSize({ width: 1100, height: 800 });
    check('the Chinese compact editor preserves visible canvas, dimensions and action buttons', /定量框/.test(await page.textContent('#qRoiDialog')) && await page.locator('#qRoiApply').isVisible() && await page.evaluate(() => {
      const dialog = document.getElementById('qRoiDialog'), canvas = document.getElementById('qRoiCanvas').getBoundingClientRect(), apply = document.getElementById('qRoiApply').getBoundingClientRect();
      return dialog.scrollWidth <= dialog.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth && canvas.height > 140 && apply.bottom <= innerHeight;
    }));
    await page.click('#qRoiCancel'); await page.click('#qSetBtn'); await page.click('#qBack');
    check('ROI usability interactions preserve no JavaScript errors', !errors.length, errors.join('\n'));
  } catch (error) { check('ROI usability flow', false, error.stack || String(error)); }
  finally { await context.close(); }
  return results;
}
