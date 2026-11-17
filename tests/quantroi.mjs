export async function quantRoiChecks(browser, base) {
  const results = [];
  const check = (what, condition, detail) => results.push([condition ? 'ok' : 'FAIL', what, condition ? '' : detail || '']);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(`${base}/index.html?lang=en`);
    await page.waitForFunction(() => window.WB && window.BApp);
    const numerical = await page.evaluate(() => {
      const width = 180, height = 110, signal = new Float32Array(width * height).fill(0.1);
      for (let vertical = 45; vertical < 55; vertical++) for (let horizontal = 45; horizontal < 55; horizontal++) signal[vertical * width + horizontal] += 0.4;
      const spec = { mode: 'fixed', F: { ox: 50, oy: 50, c: 1, s: 0 }, roiWidth: 24, roiHeight: 18,
        backgroundDirection: 'sides', backgroundGap: 3, backgroundWidth: 5, bits: 16 };
      const run = (specs, clip = Infinity) => WB.quantify({ w: width, h: height }, { sig: signal, clip }, specs);
      const measured = run([spec, { ...spec, F: { ...spec.F, ox: 120 } }]);
      const outside = run([{ ...spec, F: { ...spec.F, ox: 5 } }])[0];
      const overlap = run([spec, { ...spec, F: { ...spec.F, ox: 65 } }]);
      const backgroundOverlap = run([spec, { ...spec, F: { ...spec.F, ox: 79 } }]);
      const saturated = run([spec], 0.49)[0];
      const rotated = run([{ ...spec, F: { ox: 85, oy: 70, c: Math.cos(0.1), s: Math.sin(0.1) } }])[0];
      const outsideCrop = run([{ ...spec, sourceCrop: { F: spec.F, bounds: { u0: -10, u1: 10, v0: -20, v1: 20 } } }])[0];
      const negative = Float32Array.from(signal);
      for (let vertical = 41; vertical <= 59; vertical++) for (let horizontal = 108; horizontal <= 132; horizontal++) negative[vertical * width + horizontal] = 0.08;
      const signed = WB.quantify({ w: width, h: height }, { sig: negative, clip: Infinity }, [{ ...spec, F: { ...spec.F, ox: 120 } }])[0];
      const dirty = Float32Array.from(signal); dirty[45 * width + 31] = 1;
      const clippedBackground = WB.quantify({ w: width, h: height }, { sig: dirty, clip: 0.9 }, [spec])[0];
      const broadSignal = new Float32Array(300 * height).fill(0.1);
      for (let vertical = 0; vertical < height; vertical++) for (let horizontal = 0; horizontal < 300; horizontal++) {
        broadSignal[vertical * 300 + horizontal] += 0.2 * Math.exp(-0.5 * (((horizontal - 70) / 3) ** 2 + ((vertical - 50) / 3) ** 2))
          + 0.1 * Math.exp(-0.5 * (((horizontal - 200) / 6) ** 2 + ((vertical - 50) / 3) ** 2));
      }
      const broad = WB.quantify({ w: 300, h: height }, { sig: broadSignal, clip: Infinity }, [70, 200].map(horizontal => ({ ...spec, F: { ...spec.F, ox: horizontal }, roiWidth: 60, roiHeight: 30, backgroundGap: 10 })));
      return { measured, outside, overlap, backgroundOverlap, saturated, rotated, outsideCrop, signed, clippedBackground, broad };
    });
    check('fixed ROI uses identical original-pixel area, not each lane peak width', numerical.measured.every(value => value.widthPx === 24 && value.heightPx === 18 && value.areaPx === 432), JSON.stringify(numerical.measured));
    check('fixed ROI recovers integrated signal and an unbiased blank without positive clamping', Math.abs(numerical.measured[0].volume - 40) < 0.001 && Math.abs(numerical.measured[1].volume) < 0.001, JSON.stringify(numerical.measured));
    check('fixed ROI background strips and rotated source geometry are recorded', numerical.measured[0].backgroundBounds?.length === 2 && numerical.rotated.areaPx === 432 && numerical.rotated.bounds?.step === 1);
    check('edge ROIs are excluded rather than silently resized or clamped', !numerical.outside.quantifiable && /outside/i.test(numerical.outside.reason || ''), JSON.stringify(numerical.outside));
    check('overlapping integration and background windows are excluded with explicit reasons', numerical.overlap.every(value => !value.quantifiable && /overlap/i.test(value.reason || '')) && numerical.backgroundOverlap.some(value => !value.quantifiable && /background.*overlap/i.test(value.reason || '')), JSON.stringify({ overlap: numerical.overlap, background: numerical.backgroundOverlap }));
    check('any saturated fixed ROI is excluded rather than accepted as a smaller corrected band', numerical.saturated.saturated && !numerical.saturated.quantifiable, JSON.stringify(numerical.saturated));
    check('fixed integration retains negative signed signal and rejects extension beyond the chosen figure crop', numerical.signed.quantifiable && Math.abs(numerical.signed.volume + 8.64) < 0.001 && !numerical.outsideCrop.quantifiable && numerical.outsideCrop.reason === 'ROI outside figure crop');
    check('fixed equal-area integration recovers equal protein signal despite different peak widths and heights', numerical.broad.every(value => value.quantifiable && value.areaPx === 1800) && Math.abs(numerical.broad[0].volume / numerical.broad[1].volume - 1) < 0.01, JSON.stringify(numerical.broad));
    check('a clipped background source pixel cannot be hidden by interpolation', !numerical.clippedBackground.quantifiable && numerical.clippedBackground.reason === 'background saturated', JSON.stringify(numerical.clippedBackground));
    const available = await page.evaluate(() => typeof BApp.quantRoiConfig === 'function' && typeof BApp.setQuantRoi === 'function');
    check('quantification exposes independently persisted per-protein ROI settings', available);
    if (!available) return results;
    await page.goto(`${base}/index.html?demo=1&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    const fixture = await page.evaluate(() => {
      const block = BApp.quantData()[0], control = block.rows[0].row, target = block.rows[1].row;
      control.name = 'GAPDH'; target.name = 'Target'; BApp.setQuant({ controlRow: control.id });
      window.__roiFixture = { control: control.id, target: target.id };
      return window.__roiFixture;
    });
    const defaults = await page.evaluate(() => {
      const row = BApp.row(window.__roiFixture.target), entry = BApp.quantData().flatMap(block => block.rows).find(entry => entry.row === row);
      return { config: BApp.quantRoiConfig(row), widths: entry.d.filter(Boolean).map(value => value.widthPx), heights: entry.d.filter(Boolean).map(value => value.heightPx) };
    });
    check('workspace defaults to one fixed-width/fixed-height template for each protein', defaults.config.mode === 'fixed' && new Set(defaults.widths).size === 1 && new Set(defaults.heights).size === 1, JSON.stringify(defaults));
    const migration = await page.evaluate(() => {
      const saved = BApp.S.quant;
      try { BApp.S.quant = { ...saved, version: 3 }; return BApp.quantSettings().roiMigration; }
      finally { BApp.S.quant = saved; }
    });
    check('older adaptive analyses are explicitly marked for method-change review rather than silently relabelled', migration === true);
    await page.click('#btnExportMenu'); await page.click('#btnQuant');
    const controlCells = page.locator(`#qTableWrap tr[data-row="${fixture.control}"] td[data-lane]`);
    check('the control shows original per-lane signals in place, explicitly distinguished from ratios', await controlCells.count() === 9 && /source signal/i.test(await page.locator(`#qTableWrap tr[data-row="${fixture.control}"]`).textContent()) && !/details below|signal in details/i.test(await page.locator(`#qTableWrap tr[data-row="${fixture.control}"]`).textContent()));
    await page.click(`#qTableWrap tr[data-row="${fixture.control}"] td[data-lane="1"]`);
    check('clicking a restored control value highlights its actual source integration window', await page.locator('#preview .q-integration').count() > 0);
    check('selecting the control exposes measurements and the same ROI-edit entry as targets', /GAPDH/.test(await page.textContent('#qDetail')) && await page.locator('#qEditRoi').count() === 1 && /background/i.test(await page.textContent('#qDetail')));
    await page.click(`#qTableWrap tr[data-row="${fixture.target}"]`);
    const figureBefore = await page.evaluate(() => JSON.stringify({ rows: BApp.S.rows, levels: BApp.S.levels, lanes: BApp.S.lanes, align: BApp.S.align }));
    await page.click('#qEditRoi');
    await page.waitForSelector('#qRoiDialog[open]');
    const firstWidth = Number(await page.inputValue('#qRoiWidth'));
    await page.fill('#qRoiWidth', String(firstWidth - 2)); await page.locator('#qRoiWidth').press('Tab');
    check('ROI dimension edits update draft measurements immediately while leaving saved settings unchanged', await page.locator('#qRoiValues td[data-volume]').count() === 9 && await page.evaluate(() => !BApp.quantSettings().rois[window.__roiFixture.target]));
    await page.click('#qRoiCancel');
    check('cancelled ROI edits leave source pixels, figure geometry and settings untouched', await page.evaluate(() => !BApp.quantSettings().rois[window.__roiFixture.target]) && figureBefore === await page.evaluate(() => JSON.stringify({ rows: BApp.S.rows, levels: BApp.S.levels, lanes: BApp.S.lanes, align: BApp.S.align })));
    await page.click('#qEditRoi');
    await page.click('#qRoiAdvanced > summary');
    await page.fill('#qRoiWidth', '32'); await page.fill('#qRoiHeight', '18'); await page.fill('#qRoiGap', '2'); await page.fill('#qRoiBackgroundWidth', '3');
    await page.selectOption('#qRoiBackgroundDirection', 'above-below');
    await page.fill('#qRoiAngle', '3'); await page.locator('#qRoiAngle').press('Tab');
    await page.click('#qRoiToolSeg [data-roi-tool="lane"]');
    const canvas = page.locator('#qRoiCanvas'), canvasBox = await canvas.boundingBox();
    const centre = await page.evaluate(() => WBQuantROI.selectedCanvasPoint());
    await page.mouse.move(canvasBox.x + centre[0], canvasBox.y + centre[1]); await page.mouse.down(); await page.mouse.move(canvasBox.x + centre[0] + 8, canvasBox.y + centre[1] + 5, { steps: 4 }); await page.mouse.up();
    await page.click('#qRoiApply');
    const applied = await page.evaluate(() => ({ config: BApp.quantRoiConfig(BApp.row(window.__roiFixture.target)), saved: BApp.quantSettings().rois[window.__roiFixture.target], control: BApp.quantRoiConfig(BApp.row(window.__roiFixture.control)) }));
    check('applying a template locks dimensions, background and angle per protein without changing the control template', applied.config.width === 32 && applied.config.height === 18 && applied.config.backgroundDirection === 'above-below' && applied.config.angle === 3 && Object.keys(applied.saved.lanes).length > 0 && applied.control.width !== 32, JSON.stringify(applied));
    check('quantification-only ROI editing never modifies figure crops, exposures, levels or lane layout', figureBefore === await page.evaluate(() => JSON.stringify({ rows: BApp.S.rows, levels: BApp.S.levels, lanes: BApp.S.lanes, align: BApp.S.align })));
    const history = await page.evaluate(() => { BApp.undo(); const absent = !BApp.quantSettings().rois[window.__roiFixture.target]; BApp.redo(); return { absent, restored: BApp.quantSettings().rois[window.__roiFixture.target]?.width }; });
    check('one ROI apply is one undoable/restorable project change', history.absent && history.restored === 32, JSON.stringify(history));
    const review = await page.evaluate(() => {
      const row = BApp.row(window.__roiFixture.target), image = row.img, reviewed = BApp.quantRoiConfig(row).reviewed;
      row.img = 'changed-source'; const stale = BApp.quantRoiConfig(row).reviewed; row.img = image;
      const geometry = BApp.columns(BApp.rowColumn(row)), sources = geometry.src[geometry.rows.indexOf(row)].filter(Boolean);
      const template = { ...BApp.quantRoiConfig(row), pitch: 50, lanes: {}, offsetU: 0, offsetV: 0 };
      const same = sources.filter(source => source.sg === sources[0].sg), frame = BApp.quantSourceLaneSpec(row, same[0], BApp.images.get(row.img)).F;
      const centres = same.map(source => { const spec = BApp.quantLaneSpec(row, source, BApp.images.get(row.img), template); return WB.toFrame(frame, spec.F.ox, spec.F.oy)[0]; });
      return { reviewed, stale, distances: centres.slice(1).map((value, index) => value - centres[index]) };
    });
    check('equal spacing is explicit and source changes invalidate the prior review without changing figure lanes', review.reviewed && !review.stale && review.distances.every(value => Math.abs(value - 50) < 1e-6), JSON.stringify(review));
    await page.click('#qEditRoi');
    await page.click('#qRoiAdvanced > summary');
    await page.fill('#qRoiPitch', '60'); await page.locator('#qRoiPitch').press('Tab');
    await page.click('#qRoiToolSeg [data-roi-tool="draw"]');
    const point = await page.evaluate(() => WBQuantROI.selectedCanvasPoint()), box = await canvas.boundingBox();
    await page.mouse.move(box.x + point[0] - 10, box.y + point[1] - 7); await page.mouse.down(); await page.mouse.move(box.x + point[0] + 10, box.y + point[1] + 7, { steps: 4 }); await page.mouse.up();
    check('drawing a template sets one shared size while optional spacing stays independently editable', Number(await page.inputValue('#qRoiWidth')) > 0 && Number(await page.inputValue('#qRoiPitch')) === 60);
    await page.selectOption('#qRoiMode', 'adaptive');
    check('adaptive peak-following integration is explicitly labelled as an advanced alternative', /advanced|35%|adaptive/i.test(await page.textContent('#qRoiHint')));
    await page.click('#qRoiCancel');
    await page.click('#qEditRoi'); await page.locator('#qRoiCanvas').focus(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Escape');
    await page.locator('#qRoiDialog').waitFor({ state: 'detached' });
    check('Escape cancels keyboard ROI moves without leaving the quantification workspace', await page.locator('#qRoiDialog').count() === 0 && await page.evaluate(() => document.body.classList.contains('quant-mode') && BApp.quantSettings().rois[window.__roiFixture.target].offsetU === 0));
    const provenance = await page.evaluate(() => {
      const entry = BApp.quantData().flatMap(block => block.rows).find(entry => entry.row.id === window.__roiFixture.target);
      return { integration: entry.source.lanes[0].integration, measurement: entry.d[0], settings: BApp.quantSettings() };
    });
    check('canonical provenance retains fixed dimensions, source frame and actual background boundaries', provenance.integration.mode === 'fixed' && provenance.integration.roiWidth === 32 && provenance.measurement.backgroundBounds?.length === 2 && provenance.settings.version === 4);
    const exported = await page.evaluate(async () => {
      const saved = Export.download, files = [];
      Export.download = (blob, name) => files.push({ blob, name });
      try {
        document.getElementById('qJson').click(); document.getElementById('qCsv').click();
        const output = await Promise.all(files.map(async file => ({ name: file.name, text: await file.blob.text() })));
        let methods = '';
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { methods = text; } } });
        document.getElementById('qMethodsBtn').click(); await Promise.resolve();
        return { output, methods };
      } finally { Export.download = saved; }
    });
    const json = JSON.parse(exported.output.find(file => file.name.endsWith('.json')).text), csv = exported.output.find(file => file.name.endsWith('.csv')).text;
    check('real CSV/JSON exports retain ROI templates, areas, background windows and exclusion reasons', json.settings.version === 4 && json.columns.flatMap(column => column.rows).some(row => row.roi?.width === 32 && row.volumes.some(value => value?.backgroundBounds?.length === 2 && value.areaPx === 576)) && /integration_mode/.test(csv) && /backgroundBounds/.test(csv));
    check('Methods accurately distinguishes fixed-area sampling and records applied versus unreviewed templates', /one locked width and height per protein/.test(exported.methods) && /32 x 18 source pixels/.test(exported.methods) && /Any saturated ROI/.test(exported.methods) && /not yet reviewed/.test(exported.methods) && !/Each band was integrated over a window taken from its own profile/.test(exported.methods));
    const roundtrip = await page.evaluate(async () => {
      const settings = JSON.stringify(BApp.quantSettings()), geometry = BApp.quantSignature(), project = await BApp.saveProject();
      await BApp.openProject(project);
      return { settings: settings === JSON.stringify(BApp.quantSettings()), geometry: geometry === BApp.quantSignature() };
    });
    check('portable project round trips preserve fixed ROI settings and do not rewrite figure provenance', roundtrip.settings && roundtrip.geometry, JSON.stringify(roundtrip));
    await page.click('#btnLang'); await page.click('#qEditRoi'); await page.setViewportSize({ width: 1100, height: 900 });
    check('the ROI editor stays usable at narrow desktop width', await page.evaluate(() => document.getElementById('qRoiDialog').scrollWidth <= document.getElementById('qRoiDialog').clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth));
    await page.click('#qRoiCancel');
    check('ROI interactions produce no JavaScript errors', !errors.length, errors.join('\n'));
  } catch (error) { check('fixed ROI suite completed', false, String(error)); }
  finally { await context.close(); }
  return results;
}
