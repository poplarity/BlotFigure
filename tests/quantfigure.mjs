import { readFile } from 'node:fs/promises';

export async function quantFigureChecks(browser, base) {
  const results = [], errors = [];
  const check = (name, passed, detail) => results.push(passed ? ['ok', name] : ['FAIL', name, detail || '']);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(`${base}/index.html?demo=1&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    const fixture = await page.evaluate(() => {
      const block = BApp.quantData()[0], control = block.rows[0];
      control.row.name = 'GAPDH';
      const target = block.rows.find(entry => entry.row.blot !== control.row.blot);
      target.row.name = 'Protein 3';
      BApp.setQuant({ controlRow: control.row.id, controls: {}, method: 'control', sampleUnit: 'unconfirmed', referenceGroups: {} });
      window.__figureFixture = { column: block.id, control: control.row.id, target: target.row.id };
      return window.__figureFixture;
    });
    const shared = await page.evaluate(() => {
      const block = BApp.quantData()[0], fixture = window.__figureFixture;
      const control = block.rows.find(entry => entry.row.id === fixture.control), target = block.rows.find(entry => entry.row.id === fixture.target);
      return { ratios: target.norm, expected: target.d.map((value, index) => value && value.quantifiable && control.d[index]?.quantifiable && control.d[index].volume > 0 ? value.volume / control.d[index].volume : null),
        control: target.control, source: target.controlSource, selected: BApp.quantSettings().controlRow, groups: new Set(block.rows.map(entry => entry.row.blot)).size };
    });
    check('one selected figure control supplies target ratios across image groups', shared.groups > 1 && shared.control === fixture.control
      && JSON.stringify(shared.ratios) === JSON.stringify(shared.expected), JSON.stringify(shared));
    const legacy = await page.evaluate(() => {
      const saved = BApp.S.quant, fixture = window.__figureFixture;
      try {
        BApp.S.quant = { version: 2, method: 'control', controlRow: fixture.control, controls: { main: { first: fixture.control, second: fixture.target } } };
        const ambiguous = BApp.quantSettings();
        BApp.S.quant = { version: 2, method: 'control', controls: { main: { first: fixture.control } } };
        const single = BApp.quantSettings();
        BApp.S.quant = { version: 2, method: 'control', controlRow: fixture.control, controlSource: 'suggested' };
        const suggested = BApp.quantSettings();
        return { ambiguous: ambiguous.controlRow, single: single.controlRow, suggested: suggested.controlRow };
      } finally { BApp.S.quant = saved; }
    });
    check('ambiguous legacy per-group controls require reselection while a single explicit choice migrates',
      legacy.ambiguous === null && legacy.single === fixture.control && legacy.suggested === null, JSON.stringify(legacy));
    const invalid = await page.evaluate(() => {
      const fixture = window.__figureFixture, original = WB.quantify, control = BApp.row(fixture.control), image = BApp.images.get(control.img).img;
      WB.quantify = (source, signal, specs) => original(source, signal, specs).map((value, index) => source === image && value && index === 0 ? { ...value, quantifiable: false, saturated: true } : value);
      try {
        const block = BApp.quantData()[0], entry = block.rows.find(row => row.row.id === fixture.target);
        return { ratios: entry.norm, exclusions: entry.exclusions, provenance: entry.controlSource };
      } finally { WB.quantify = original; }
    });
    check('an invalid control lane stays missing without shifting later lane pairings', invalid.ratios?.[0] === null
      && invalid.ratios?.[1] != null && /control.*saturated/i.test(invalid.exclusions[0]), JSON.stringify(invalid));
    const columns = await page.evaluate(() => {
      const saved = JSON.parse(JSON.stringify(BApp.S)), fixture = window.__figureFixture;
      try {
        const target = BApp.row(fixture.target), column = BApp.addColumn();
        BApp.moveToColumn(target, column.id); BApp.commit();
        const controlColumn = BApp.rowColumn(BApp.row(fixture.control));
        BApp.columnData(controlColumn).lanes[0].hidden = true;
        const blocks = BApp.quantData(), entry = blocks.find(block => block.id === column.id).rows.find(row => row.row.id === fixture.target);
        return { ratios: entry.norm, source: entry.controlSource, control: entry.control, column: column.id };
      } finally { BApp.S = saved; BApp.commit(); }
    });
    check('a unified control works across layout columns and a hidden control lane does not shift matches',
      columns.control === fixture.control && columns.ratios?.[0] === null && columns.ratios?.[1] != null
        && columns.source?.column !== columns.column && columns.source?.lanes[1]?.lane === 2, JSON.stringify(columns));
    const hidden = await page.evaluate(() => {
      const row = BApp.row(window.__figureFixture.control); row.hidden = true;
      try { const entry = BApp.quantData().flatMap(block => block.rows).find(entry => entry.row.id === window.__figureFixture.target); return { norm: entry.norm, control: entry.control }; }
      finally { row.hidden = false; }
    });
    check('a hidden control is not silently used outside the completed figure', hidden.norm === null && hidden.control === null, JSON.stringify(hidden));
    await page.click('#btnExportMenu');
    await page.click('#btnQuant');
    check('the workspace offers one loading-control selector containing every visible figure row',
      await page.locator('#qDep select').count() === 1 && await page.locator('#qControl option').count() === await page.evaluate(() => BApp.quantData().flatMap(block => block.rows).length + 1));
    check('the top-level result panel no longer offers competing volume and normalisation modes', await page.locator('#qViewSeg').count() === 0
      && /Quantitative results/.test(await page.locator('#quantData .col-title').textContent()));
    check('the selected control row is identified instead of displaying unexplained missing ratios',
      /Control.*source signal/.test(await page.locator(`#qTableWrap tr[data-row="${fixture.control}"]`).textContent())
        && await page.locator(`#qTableWrap tr[data-row="${fixture.control}"] td[data-lane]`).count() === 9);
    await page.click(`#qTableWrap tr[data-row="${fixture.target}"]`);
    check('the result detail names the actual target divided by the unified control', /Protein 3\s*\/\s*GAPDH/.test(await page.textContent('#qDetail')));
    check('raw measurements live in folded details without changing the chart scale', await page.locator('#qRawDetails').count() === 1
      && await page.locator('#qRawDetails').getAttribute('open') === null);
    if (await page.locator('#qRawDetails').count()) {
      await page.locator('#qRawDetails > summary').click();
      check('expanded raw measurements include the loading control and target source signals', await page.locator('#qRawTable tr').count() > 3
        && /GAPDH/.test(await page.textContent('#qRawTable')));
      await page.locator('#qRawDetails > summary').click();
    }
    await page.selectOption('#qPlotStyle', 'bars');
    check('selecting bars immediately opens a visible quantitative bar preview', await page.locator('#qChartBox').isVisible()
      && await page.locator('#qChartBox .q-plot-bar').count() > 0);
    check('unconfirmed sample wording does not contradict the available individual-bar mode',
      !/points only/.test(await page.locator('#qSampleUnit option[value="unconfirmed"]').textContent()));
    await page.click('#qPlotShow');
    const cases = await page.evaluate(() => {
      const block = BApp.quantData()[0], target = block.rows.find(entry => entry.row.id === window.__figureFixture.target);
      const entry = { ...target, relative: [-2, 0, 4, null], exclusions: [null, null, null, 'control saturated'] };
      const demo = { ...block, lanes: block.lanes.slice(0, 4), rows: [entry], overlapping: false,
        settings: { ...block.settings, plotStyle: 'bars', sampleUnit: 'unconfirmed' } };
      const saved = BApp.columnData(block.id).groups;
      const render = () => WBQuantPlot.render([demo], { row: entry.row.id });
      try {
        BApp.columnData(block.id).groups = [{ from: 1, to: 2, text: 'Control' }, { from: 3, to: 4, text: 'Treatment' }];
        const unconfirmed = render();
        demo.settings.sampleUnit = 'technical'; const technical = render();
        demo.settings.sampleUnit = 'independent'; const independent = render();
        demo.overlapping = true; const overlapping = render();
        demo.overlapping = false; BApp.columnData(block.id).groups = []; const ungrouped = render();
        demo.settings.plotStyle = 'points'; const points = render();
        return Object.fromEntries(Object.entries({ unconfirmed, technical, independent, overlapping, ungrouped, points }).map(([name, result]) => [name, result.svg]));
      } finally { BApp.columnData(block.id).groups = saved; }
    });
    const count = (svg, kind) => (svg.match(new RegExp(`class="q-plot-${kind}"`, 'g')) || []).length;
    check('unconfirmed bar mode renders each valid measurement including signed and zero values', count(cases.unconfirmed, 'bar') === 3
      && /data-value="-2"/.test(cases.unconfirmed) && /data-value="0"/.test(cases.unconfirmed), String(count(cases.unconfirmed, 'bar')));
    check('technical-repeat bars never acquire group means or biological error bars', count(cases.technical, 'bar') === 3
      && count(cases.technical, 'mean') === 0 && count(cases.technical, 'error') === 0);
    check('confirmed independent groups retain mean bars and sample SD only where calculable', count(cases.independent, 'bar') === 2
      && count(cases.independent, 'mean') === 2 && count(cases.independent, 'error') === 1);
    check('overlapping or absent groups still produce individual bars rather than silently keeping points', count(cases.overlapping, 'bar') === 3
      && count(cases.ungrouped, 'bar') === 3 && count(cases.overlapping, 'mean') === 0);
    check('point mode removes the bars without changing the retained values or exclusions', count(cases.points, 'bar') === 0
      && count(cases.points, 'point') === 3 && /1 excluded/.test(cases.points));
    await page.selectOption('#qPlotStyle', 'points');
    check('switching back to points updates the live preview immediately', await page.locator('#qChartBox .q-plot-bar').count() === 0
      && await page.locator('#qChartBox .q-plot-point').count() > 0);
    await page.selectOption('#qPlotStyle', 'bars');
    const download = page.waitForEvent('download');
    await page.click('#qPlotSVG');
    const svg = await readFile(await (await download).path(), 'utf8');
    check('exported SVG matches the individual bar preview without unconfirmed group summaries', count(svg, 'bar') > 0
      && count(svg, 'mean') === 0 && count(svg, 'error') === 0 && /Protein 3 \/ GAPDH/.test(svg));
    const exported = await page.evaluate(async () => {
      const original = Export.download, files = [];
      Export.download = (blob, name) => files.push({ blob, name });
      try {
        document.getElementById('qJson').click(); document.getElementById('qCsv').click();
        return Promise.all(files.map(async file => ({ name: file.name, text: await file.blob.text() })));
      } finally { Export.download = original; }
    });
    const json = JSON.parse(exported.find(file => /json$/.test(file.name)).text), csv = exported.find(file => /csv$/.test(file.name)).text;
    const exportedTarget = json.columns.flatMap(column => column.rows).find(row => row.row === fixture.target);
    check('exports preserve the unified control source and exact figure-lane correspondence', json.settings.controlRow === fixture.control
      && exportedTarget.controlSource?.row === fixture.control && exportedTarget.controlSource?.lanes.some(lane => lane?.source?.box)
      && /control_source/.test(csv), JSON.stringify(exportedTarget.controlSource));
    const methods = await page.evaluate(async () => {
      let text = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { text = value; } } });
      document.getElementById('qMethodsBtn').click(); await Promise.resolve(); return text;
    });
    check('Methods states figure-lane control matching without falsely requiring the same source group',
      /figure.*lane/i.test(methods) && /user/.test(methods) && !/same membrane and layout column/.test(methods), methods);
    await page.click('#btnLang');
    await page.waitForFunction(() => I18N.lang === 'zh');
    check('the simplified results and bar explanation update in Chinese', /定量结果/.test(await page.locator('#quantData .col-title').textContent())
      && /逐道/.test(await page.textContent('#qPlotHint')));
    await page.setViewportSize({ width: 1100, height: 900 });
    check('the simplified workspace retains the narrow desktop layout without document overflow',
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check('unified controls and bar previews produce no JavaScript errors', errors.length === 0, errors.join('\n'));
  } catch (error) { results.push(['FAIL', 'unified-control/bar workflow completes', error.stack || String(error)]); }
  finally { await context.close(); }
  return results;
}
