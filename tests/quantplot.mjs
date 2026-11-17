import { readFile } from 'node:fs/promises';

export async function quantPlotChecks(browser, base) {
  const results = [];
  const check = (name, passed, detail) => results.push(passed ? ['ok', name] : ['FAIL', name, detail || '']);
  const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(`${base}/index.html?demo=1&ladder=pr26619&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    const calculation = await page.evaluate(() => {
      const saved = JSON.parse(JSON.stringify(BApp.S.quant));
      const column = BApp.layoutColumns()[0], block = BApp.quantBlock(column.id);
      const control = block.rows[0], target = block.rows.find(candidate => candidate !== control && candidate.blot === control.blot);
      const original = WB.quantify, originalGroups = BApp.columnData(column.id).groups;
      const fractions = [2, 4, 8, 16, 32, 64, 128, 256, 512];
      BApp.columnData(column.id).groups = [{ from: block.lanes[0], to: block.lanes[1], text: 'Control' }, { from: block.lanes[2], to: block.lanes[3], text: 'Treatment' }];
      WB.quantify = (image, signal, specs) => specs.map((spec, index) => spec ? { volume: image === control.rec.img ? 10 : 10 * fractions[index], quantifiable: true } : null);
      try {
        BApp.setQuant({ method: 'control', controlRow: control.row.id, controls: {}, referenceGroups: {} });
        const ratio = BApp.quantBlock(column.id).rows.find(candidate => candidate.row.id === target.row.id);
        const group = BApp.columnData(column.id).groups[0];
        const key = BApp.quantGroupKey ? BApp.quantGroupKey(group) : 'Control';
        BApp.setQuant({ referenceGroups: { [column.id]: key } });
        const relative = BApp.quantBlock(column.id).rows.find(candidate => candidate.row.id === target.row.id);
        BApp.setQuant({ referenceGroups: { [column.id]: 'missing-group' } });
        const missing = BApp.quantBlock(column.id).rows.find(candidate => candidate.row.id === target.row.id);
        return { raw: ratio.norm, displayed: ratio.relative, relative: relative.relative, reference: relative.reference,
          missing: missing.relative, source: target.row.img, exposure: target.rec.exposure };
      } finally { WB.quantify = original; BApp.columnData(column.id).groups = originalGroups; BApp.S.quant = saved; }
    });
    check('normalisation without a reference group reports target/control rather than a first-lane fold change',
      calculation.raw && calculation.displayed && calculation.raw.every((value, index) => value === calculation.displayed[index]), JSON.stringify(calculation));
    check('relative expression divides every sample by the selected control-group mean',
      calculation.relative && Math.abs(calculation.relative[0] - 2 / 3) < 1e-9 && Math.abs(calculation.relative[1] - 4 / 3) < 1e-9
        && calculation.reference && calculation.reference.mean === 3, JSON.stringify(calculation));
    check('a removed reference group cannot silently fall back to the first lane', calculation.missing === null, JSON.stringify(calculation));
    await page.click('#btnExportMenu');
    await page.click('#btnQuant');
    const state = await page.evaluate(() => ({
      advanced: document.getElementById('qAdvanced')?.open === false,
      exposureOff: BApp.quantSettings().exposureCheck === false,
      chartTab: !!document.querySelector('#qPreviewSeg [data-preview="chart"]'),
      chartExport: !!document.getElementById('qPlotSVG'),
      readableActions: getComputedStyle(document.getElementById('qBack')).color === getComputedStyle(document.getElementById('qSetBtn')).color,
      sourceReadOnly: !!document.body.classList.contains('quant-mode')
    }));
    check('routine quantification opens without mandatory exposure checks and offers chart previews and exports',
      state.advanced && state.exposureOff && state.chartTab && state.chartExport && state.sourceReadOnly, JSON.stringify(state));
    check('workspace back and edit actions use the readable light-panel button colour', state.readableActions, JSON.stringify(state));
    await page.click('#btnLang');
    await page.waitForFunction(() => I18N.lang === 'zh');
    check('the current-source status follows workspace language switching', /[\u4e00-\u9fff]/.test(await page.textContent('#qSourceStatus')));
    await page.click('#btnLang');
    await page.waitForFunction(() => I18N.lang === 'en');
    check('the dedicated renderer is available without external plotting dependencies', await page.evaluate(() => typeof WBQuantPlot !== 'undefined' && typeof WBQuantPlot.render === 'function'));
    const fixture = await page.evaluate(() => {
      const block = BApp.quantData()[0], control = block.rows[0];
      const target = block.rows.find(entry => entry.row.id !== control.row.id);
      target.row.name = 'AKT';
      control.row.name = 'GAPDH';
      BApp.columnData(block.id).groups = [{ from: block.lanes[0], to: block.lanes[1], text: 'Control' }, { from: block.lanes[2], to: block.lanes.at(-1), text: 'Treatment' }];
      BApp.setQuant({ method: 'control', controlRow: control.row.id, referenceGroups: {}, exposureCheck: false });
      window.__quantPlotFixture = { column: block.id, target: target.row.id, control: control.row.id };
      const result = BApp.quantData()[0];
      return { ...window.__quantPlotFixture, matched: result.rows.every(entry => entry.control === control.row.id), blots: new Set(result.rows.map(entry => entry.row.blot)).size };
    });
    check('one explicit loading-control choice applies across source groups in the current figure', fixture.matched && fixture.blots > 1, JSON.stringify(fixture));
    const wrongControl = await page.evaluate(() => {
      const fixture = window.__quantPlotFixture, target = BApp.row(fixture.target), saved = BApp.S.quant;
      BApp.S.quant = { ...saved, controlRow: 'missing-control-row' };
      try { const result = BApp.quantData()[0].rows.find(entry => entry.row.id === target.id); return { norm: result.norm, control: result.control }; }
      finally { BApp.S.quant = saved; }
    });
    check('a deleted control cannot silently fall back to a different protein', wrongControl.norm === null && wrongControl.control === null, JSON.stringify(wrongControl));
    const source = await page.evaluate(() => {
      const fixture = window.__quantPlotFixture, row = BApp.row(fixture.target), before = BApp.quantData()[0].rows.find(entry => entry.row.id === row.id);
      const savedLevels = BApp.S.levels, signature = BApp.quantSignature();
      BApp.S.levels = { ...savedLevels, [row.img]: { lo: 0.25, hi: 0.5 } };
      const after = BApp.quantData()[0].rows.find(entry => entry.row.id === row.id);
      BApp.S.levels = savedLevels;
      const savedImage = row.img, alternative = BApp.rowExpo(row).find(exposure => exposure.id !== row.img);
      row.img = alternative.id;
      const switched = BApp.quantData()[0].rows.find(entry => entry.row.id === row.id), changed = BApp.quantSignature() !== signature;
      row.img = savedImage;
      const savedHidden = BApp.columnData(fixture.column).lanes[0].hidden;
      BApp.columnData(fixture.column).lanes[0].hidden = true;
      row.hidden = true;
      const hidden = BApp.quantData()[0];
      row.hidden = false; BApp.columnData(fixture.column).lanes[0].hidden = savedHidden;
      return { unchanged: JSON.stringify(before.d) === JSON.stringify(after.d), source: before.source, selected: savedImage,
        measured: before.d.find(value => value && value.quantifiable),
        switched: switched.source.image, alternative: alternative.id, changed,
        omitted: !hidden.rows.some(entry => entry.row.id === row.id) && !hidden.lanes.includes(1) };
    });
    check('quantification follows the selected source exposure and boxes, not display brightness', source.unchanged && source.source.image === source.selected && source.source.lanes.some(lane => lane && lane.integration), JSON.stringify(source));
    check('changing the figure exposure changes the source signature and hidden rows/lanes stay excluded', source.changed && source.switched === source.alternative && source.omitted, JSON.stringify(source));
    check('measured integration bounds are retained in source coordinates at their actual sampled width',
      source.measured && source.measured.bounds && Math.abs(source.measured.bounds.u1 - source.measured.bounds.u0 - source.measured.widthPx) < 1e-6,
      JSON.stringify(source.measured));
    const plotCases = await page.evaluate(() => {
      const block = BApp.quantData()[0], target = block.rows.find(entry => entry.row.id === window.__quantPlotFixture.target);
      const entry = { ...target, relative: [2, 4, null, 8], d: [{ volume: 20, quantifiable: true }, { volume: 40, quantifiable: true }, { volume: 60, quantifiable: false, saturated: true }, { volume: 80, quantifiable: true }], exclusions: [null, null, 'saturated', null] };
      const demo = { ...block, lanes: block.lanes.slice(0, 4), rows: [entry], settings: { ...block.settings, sampleUnit: 'unconfirmed' } };
      const render = () => WBQuantPlot.render([demo], { row: entry.row.id });
      const unconfirmed = render();
      demo.settings = { ...demo.settings, sampleUnit: 'independent', plotStyle: 'bars' };
      const independent = render();
      demo.settings = { ...demo.settings, sampleUnit: 'technical' };
      const technical = render();
      demo.overlapping = true;
      const overlapping = render();
      demo.settings = { ...demo.settings, sampleUnit: 'independent' };
      demo.overlapping = false;
      const savedGroups = BApp.columnData(block.id).groups;
      BApp.columnData(block.id).groups = [];
      const ungrouped = render();
      entry.relative = [-0.02, -0.01, null, -0.015];
      const negativeOnly = render();
      BApp.columnData(block.id).groups = savedGroups;
      return { unconfirmed: unconfirmed.svg, independent: independent.svg, technical: technical.svg, overlapping: overlapping.svg,
        ungrouped: ungrouped.svg, negativeOnly: negativeOnly.svg,
        points: independent.panels[0].result.buckets.flatMap(bucket => bucket.points.map(point => point.value)),
        count: independent.panels[0].result.exclusions.length };
    });
    check('plots retain individual values and disclose saturated exclusions without zero filling', JSON.stringify(plotCases.points) === '[2,4,8]' && plotCases.count === 1 && !/data-value="0"/.test(plotCases.independent), JSON.stringify(plotCases.points));
    check('independent-sample confirmation gates means and SD; technical repeats do not acquire biological error bars',
      !/class="q-plot-mean"/.test(plotCases.unconfirmed) && !/class="q-plot-error"/.test(plotCases.technical)
        && (plotCases.independent.match(/class="q-plot-error"/g) || []).length === 1 && /class="q-plot-bar"/.test(plotCases.independent), plotCases.independent.slice(-600));
    check('overlapping condition ranges fall back to individual lanes instead of counting points twice', !/class="q-plot-mean"/.test(plotCases.overlapping) && /Overlapping groups/.test(plotCases.overlapping));
    check('ungrouped lanes remain individual measurements and retain the confirmed sample-unit label', !/class="q-plot-mean"/.test(plotCases.ungrouped)
      && /Independent samples/.test(plotCases.ungrouped) && !/independence not confirmed/.test(plotCases.ungrouped));
    check('small negative-only values keep a finite compact axis without artificial positive headroom',
      (plotCases.negativeOnly.match(/font-size="8">/g) || []).length < 20 && !/NaN|Infinity/.test(plotCases.negativeOnly),
      String((plotCases.negativeOnly.match(/font-size="8">/g) || []).length));
    await page.click(`#qTableWrap tr[data-row="${fixture.target}"]`);
    await page.click('#qPlotShow');
    await page.waitForSelector('#qChartBox .q-plot-point');
    const point = page.locator('#qChartBox .q-plot-point').first();
    const pointLane = await point.getAttribute('data-lane');
    await point.click();
    check('clicking a quantitative point selects its source protein and corresponding table cell',
      await page.locator(`#qTableWrap tr.sel[data-row="${fixture.target}"] td.qpoint-sel[data-lane="${pointLane}"]`).count() === 1);
    await page.click('#qPreviewSeg [data-preview="figure"]');
    check('the selected data point reveals the actual integration window on the source-derived figure', await page.locator('#preview .q-integration').count() > 0);
    await page.click('#qPreviewSeg [data-preview="chart"]');
    const toolbar = await page.evaluate(async () => {
      const original = Export.exportPNG;
      let plotted = false;
      Export.exportPNG = async svg => { plotted = svg.includes('q-plot-point'); };
      try {
        const preflight = document.getElementById('preflightOn');
        if (preflight.checked) preflight.click();
        document.getElementById('btnPNG').click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { plotted, label: document.getElementById('btnPNG').textContent };
      } finally { Export.exportPNG = original; }
    });
    check('the familiar top export button exports the visible quantitative plot rather than the blot image', toolbar.plotted && /Plot/.test(toolbar.label), JSON.stringify(toolbar));
    const referenceKey = await page.evaluate(() => BApp.quantGroupKey(BApp.columnData(window.__quantPlotFixture.column).groups[0]));
    await page.selectOption('#qReference0', referenceKey);
    const referenceUI = await page.evaluate(() => {
      const entry = BApp.quantData()[0].rows.find(row => row.row.id === window.__quantPlotFixture.target);
      return { reference: entry.reference, relative: entry.relative,
        values: [...document.querySelectorAll('#qChartBox .q-plot-point')].map(point => +point.dataset.value) };
    });
    check('selecting an existing condition updates the plot to reference-group fold values immediately',
      referenceUI.reference && referenceUI.reference.group === 'Control' && referenceUI.reference.mean > 0
        && referenceUI.values.length > 0 && referenceUI.values.every(value => referenceUI.relative.includes(value)), JSON.stringify(referenceUI));
    await page.selectOption('#qReference0', '');
    const exposureCalls = await page.evaluate(async () => {
      const original = BApp.quantLinearity;
      let calls = 0;
      BApp.quantLinearity = row => { calls++; return original(row); };
      try {
        BApp.setQuant({ exposureCheck: false });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const off = calls;
        BApp.setQuant({ exposureCheck: true });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return { off, on: calls };
      } finally { BApp.quantLinearity = original; BApp.setQuant({ exposureCheck: false }); }
    });
    check('optional exposure checks are not calculated until explicitly enabled', exposureCalls.off === 0 && exposureCalls.on > 0, JSON.stringify(exposureCalls));
    await page.selectOption('#qSampleUnit', 'independent');
    await page.selectOption('#qPlotStyle', 'bars');
    await page.selectOption('#qPlotScope', 'selected');
    const svgDownload = page.waitForEvent('download');
    await page.click('#qPlotSVG');
    const svgFile = await svgDownload;
    const svg = await readFile(await svgFile.path(), 'utf8');
    check('SVG export contains editable axes, individual points and separate target panels', /<svg/.test(svg) && /q-plot-point/.test(svg) && /Normalised signal/.test(svg) && (svg.match(/class="q-plot-panel"/g) || []).length > 1 && !/<image/.test(svg), svg.slice(0, 250));
    const pngDownload = page.waitForEvent('download');
    await page.click('#qPlotPNG');
    const pngFile = await pngDownload, png = await readFile(await pngFile.path());
    check('PNG export is a real high-resolution raster with DPI metadata', png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) > 1500 && png.includes(Buffer.from('pHYs')), png.subarray(16, 24).toString('hex'));
    await page.locator(`#qTargets input[data-target="${fixture.target}"]`).uncheck();
    check('unchecked targets stay out of the selected-target plot even when their table row is current',
      await page.locator(`#qChartBox .q-plot-panel[data-row="${fixture.target}"]`).count() === 0);
    await page.locator(`#qTargets input[data-target="${fixture.target}"]`).check();
    const exported = await page.evaluate(async () => {
      const downloads = [], download = Export.download;
      Export.download = (blob, name) => downloads.push({ blob, name });
      try {
        document.getElementById('qJson').click(); document.getElementById('qCsv').click();
        const texts = await Promise.all(downloads.map(async item => ({ name: item.name, text: await item.blob.text() })));
        return texts;
      } finally { Export.download = download; }
    });
    const json = JSON.parse(exported.find(item => item.name.endsWith('.json')).text), csv = exported.find(item => item.name.endsWith('.csv')).text;
    check('data exports preserve the unified control, selected source geometry, ratios, sample unit and unrequested checks',
      json.settings.exposureCheck === false && json.sampleUnit === 'independent' && json.columns.every(column => column.linearity.every(fit => fit.mode !== 'exposure'))
        && json.columns.flatMap(column => column.rows).some(row => row.source && row.source.lanes.some(lane => lane && lane.integration) && row.controlRow)
        && /exposure-time check,not performed/.test(csv) && /source_geometry/.test(csv) && !/rel\. lane 1/.test(csv));
    const methods = await page.evaluate(async () => {
      let text = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { text = value; } } });
      document.getElementById('qMethodsBtn').click();
      await Promise.resolve();
      return text;
    });
    check('Methods describes the actual control-ratio calculation without claiming unrequested linearity validation',
      /loading-control signal/.test(methods) && /Exposure-time checks were not performed/.test(methods)
        && /not validated/.test(methods) && !/first quantifiable lane|relative to lane 1/.test(methods), methods);
    const signedPreview = await page.evaluate(async () => {
      const original = BApp.quantData, blocks = original(), row = blocks[0].rows.find(entry => entry.row.id === window.__quantPlotFixture.target);
      row.relative = row.relative.map((value, index) => index === 0 ? -2 : value);
      BApp.quantData = () => blocks;
      try {
        BApp.emit('change');
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const bar = document.querySelector('#qDetail .qchart rect[data-value="-2"]');
        const zero = document.querySelector('#qDetail .qchart .qzero');
        return { signed: !!bar && !!zero && Number(bar.getAttribute('y')) >= Number(zero.getAttribute('y1')),
          bar: bar && bar.getAttribute('y'), zero: zero && zero.getAttribute('y1') };
      } finally { BApp.quantData = original; BApp.emit('change'); }
    });
    check('the on-screen lane preview draws negative background-subtracted values below zero', signedPreview.signed, JSON.stringify(signedPreview));
    const roundtrip = await page.evaluate(async () => {
      const settings = JSON.stringify(BApp.quantSettings()), sources = BApp.quantSignature();
      BApp.setQuant({ errorBars: 'none' }); BApp.undo();
      const undo = JSON.stringify(BApp.quantSettings()) === settings;
      const project = await BApp.saveProject();
      await BApp.openProject(project);
      return { undo, same: JSON.stringify(BApp.quantSettings()) === settings, sources: BApp.quantSignature() === sources };
    });
    check('plot and reference settings survive undo and portable project restoration without changing source exposures', roundtrip.undo && roundtrip.same && roundtrip.sources, JSON.stringify(roundtrip));
    check('quantitative plotting has no JavaScript errors', errors.length === 0, errors.join(' | '));
  } catch (error) { check('quantitative plotting flow', false, error.stack || String(error)); }
  finally { await context.close(); }
  return results;
}
