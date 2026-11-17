/* Quantification (densitometry): synthetic ground truth for the volume itself, then the panel and every
 * export driven through the real buttons.
 *
 * Synthetic bands have a known amplitude, so the recovered volume ratio can be checked against the truth —
 * something a real blot cannot give. What matters is that the ratio survives, that a clipped band is refused
 * rather than averaged in, that a faint band is not biased upwards by a zero clamp, that an 8-bit source is
 * marked as such, and that a normalisation which is not sound produces a warning instead of a number.
 * Every value below is computed inside the page: no eval (the app runs under a CSP without unsafe-eval). */
export async function quantChecks(browser, base) {
  const results = [];
  const check = (what, ok, detail) => results.push(ok ? ['ok', what] : ['FAIL', what, detail || '']);
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  // press the real button, keep the blob instead of saving it
  async function grab(id) {
    await page.evaluate(() => { window.__got = []; window.__origDl = Export.download; Export.download = (blob, name) => window.__got.push({ blob, name }); });
    await page.click('#' + id);
    return page.evaluate(async () => {
      const start = performance.now();
      while (!window.__got.length && performance.now() - start < 20000) await new Promise(r => setTimeout(r, 20));
      const g = window.__got[0]; Export.download = window.__origDl;
      return g ? { name: g.name, text: await g.blob.text() } : null;
    });
  }
  try {
    await page.goto(`${base}/index.html?lang=en`);
    await page.waitForFunction(() => window.WB && window.WB.quantify, null, { timeout: 60000 });

    // ---- 1..7. the engine, on bands of a known amplitude ----
    const eng = await page.evaluate(() => {
      // deterministic pseudo-noise: a real picture is never perfectly flat, and a clamp hides behind both
      let seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      function make(amps, opt) {
        opt = opt || {};
        const w = opt.w || 420, h = opt.h || 200, bg = opt.bg == null ? 0.05 : opt.bg, noise = opt.noise == null ? 0.004 : opt.noise;
        const sig = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sig[y * w + x] = bg + (rnd() - 0.5) * 2 * noise;
        const centres = amps.map((_, i) => 60 + i * 100), vc = 95, halfV = opt.halfV || 11, halfU = opt.halfU || 12;
        amps.forEach((a, i) => {
          const uc = centres[i];
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const dv = (y - vc) / halfV, du = (x - uc) / halfU, g = Math.exp(-0.5 * (dv * dv + du * du));
            if (g < 1e-4) continue;
            sig[y * w + x] = Math.min(opt.clipAt == null ? 99 : opt.clipAt, sig[y * w + x] + a * g);
          }
        });
        return { w, h, sig, centres, vc };
      }
      const spec = (syn, uc, bits, extra) => Object.assign({
        F: { ox: 0, oy: 0, c: 1, s: 0 }, uc, pitch: 100, hw: 55, bits,
        vTop: 40, vBot: 150, b0: syn.vc - 16, b1: syn.vc + 16 }, extra || {});
      const lanes = (syn, bits) => syn.centres.map(uc => spec(syn, uc, bits));
      const run = (syn, bits, clip) => WB.quantify({ w: syn.w, h: syn.h }, { sig: syn.sig, clip: clip == null ? Infinity : clip }, lanes(syn, bits));

      // a 8:4:2:1 series must come back as 8:4:2:1
      const s1 = make([0.8, 0.4, 0.2, 0.1]), q1 = run(s1, 16);
      const series = q1.map(v => v && v.volume), rel = series.map(v => v / series[0]);

      // a band far below the noise integrates to ~0, not to a positive floor
      const f = run(make([0.8, 0.004], { noise: 0.01 }), 16);

      // a clipped band is reported and refused
      const sat = run(make([0.8, 1.2], { clipAt: 1.0 }), 16, 1.0);

      // the integration window follows the band, it is not a fixed fraction of the spacing
      const wide = run(make([0.6, 0.6], { halfU: 12 }), 16), narrow = run(make([0.6, 0.6], { halfU: 5 }), 16);

      // bit depth grading
      const s5 = make([0.5, 0.5]);
      const grades = [16, 8, null].map(b => WB.quantify({ w: s5.w, h: s5.h }, { sig: s5.sig, clip: Infinity }, lanes(s5, b))[0].grade);

      // a whole lane (total protein) spans the lane, not the band profile
      const s6 = make([0.5, 0.5], { halfU: 6 });
      const band = WB.quantify({ w: s6.w, h: s6.h }, { sig: s6.sig, clip: Infinity }, [spec(s6, 60, 16)])[0];
      const lane = WB.quantify({ w: s6.w, h: s6.h }, { sig: s6.sig, clip: Infinity },
        [spec(s6, 60, 16, { hw: 48, fullLane: true, vTop: 40, vBot: 150, b0: 40, b1: 150 })])[0];

      // proportionality fit
      const fit = pts => WB.linearFit(pts);
      const fits = {
        clean: fit([{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 30 }]),
        bends: fit([{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 21 }]),
        two: fit([{ x: 1, y: 10 }, { x: 2, y: 20 }]),
        verdicts: [WB.linearVerdict(fit([{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 30 }])),
                   WB.linearVerdict(fit([{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 21 }])),
                   WB.linearVerdict(fit([{ x: 1, y: 10 }, { x: 2, y: 20 }]))]
      };
      return { series, rel, faint: { strong: f[0].volume, blank: f[1].volume },
        sat: { clean: { f: sat[0].excludedFrac, ok: sat[0].quantifiable },
               clipped: { f: sat[1].excludedFrac, ok: sat[1].quantifiable, sat: sat[1].saturated } },
        widths: { wide: wide[0].widthPx, narrow: narrow[0].widthPx },
        grades, laneW: { band: band.widthPx, lane: lane.widthPx, vol: lane.volume }, fits };
    });
    const truth = [1, 0.5, 0.25, 0.125];
    const relErr = eng.rel.map((v, i) => Math.abs(v - truth[i]) / truth[i]);
    check('a 8:4:2:1 amplitude series is recovered within 5%',
      eng.series.every(v => v > 0) && Math.max(...relErr) < 0.05,
      JSON.stringify({ volumes: eng.series.map(v => +v.toFixed(1)), relative: eng.rel.map(v => +v.toFixed(3)) }));
    check('a blank lane integrates to about zero instead of a positive floor',
      Math.abs(eng.faint.blank) < Math.abs(eng.faint.strong) * 0.12, JSON.stringify(eng.faint));
    check('a clipped band reports its excluded fraction and is not quantifiable',
      eng.sat.clipped.sat && eng.sat.clipped.f > 0.02 && !eng.sat.clipped.ok && eng.sat.clean.ok, JSON.stringify(eng.sat));
    check('the integration width follows the band profile (a narrow band is not read as wide)',
      eng.widths.narrow < eng.widths.wide * 0.75, JSON.stringify(eng.widths));
    check('16-bit is ok, 8-bit is flagged as display-scaled, an unknown depth is not assumed',
      eng.grades[0] === 'ok' && eng.grades[1] === 'display-8bit' && eng.grades[2] === 'ok', JSON.stringify(eng.grades));
    check('a full-lane region (total protein) spans the lane, not the band profile',
      Math.abs(eng.laneW.lane - 57) <= 2 && eng.laneW.lane > eng.laneW.band && eng.laneW.vol > 0, JSON.stringify(eng.laneW));
    check('the proportionality fit accepts a clean series and rejects one that bends',
      Math.abs(eng.fits.clean.r2 - 1) < 1e-9 && eng.fits.clean.maxDev < 1e-9
        && eng.fits.bends.r2 < 0.98 && eng.fits.bends.maxDev > 0.1 && eng.fits.two.r2 === null
        && eng.fits.verdicts.join(',') === 'proportional,deviates,not enough points',
      JSON.stringify(eng.fits));
    const invalidFits = await page.evaluate(() => [
      [{ x: 1, y: 10 }, { x: 1, y: 10 }, { x: 1, y: 10 }],
      [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      [{ x: 1, y: -10 }, { x: 2, y: -20 }, { x: 3, y: -30 }]
    ].map(points => { const fit = WB.linearFit(points); return { fit, verdict: WB.linearVerdict(fit) }; }));
    check('identical concentrations, zero signal and negative slopes cannot validate proportionality',
      invalidFits.every(result => result.fit.r2 == null && result.verdict !== 'proportional'), JSON.stringify(invalidFits));

    // ---- 8. a stain is read with the opposite polarity, and a chemi frame is refused ----
    const tot = await page.evaluate(() => {
      const w = 40, h = 40;
      const light = new Float32Array(w * h).fill(0.9), dark = new Float32Array(w * h).fill(0.05);
      for (let y = 18; y < 22; y++) for (let x = 10; x < 30; x++) light[y * w + x] = 0.5;   // dark band on a light membrane
      for (let y = 18; y < 22; y++) for (let x = 10; x < 30; x++) dark[y * w + x] = 0.9;    // bright band on a dark one
      const st = WB.totalSignal({ w, h, data: light }), ch = WB.totalSignal({ w, h, data: dark });
      const forced = WB.totalSignal({ w, h, data: dark }, 'bright');
      return { stain: !!st, peak: st ? Math.max.apply(null, st.sig) : null,
        fluorescence: !!ch, bright: ch && ch.bright, forcedPeak: forced ? Math.max.apply(null, forced.sig) : null };
    });
    check('a declared total-protein image supports dark stains and bright fluorescence with explicit polarity',
      tot.stain && Math.abs(tot.peak - 0.5) < 1e-6 && tot.fluorescence && tot.bright
        && Math.abs(tot.forcedPeak - 0.9) < 1e-6, JSON.stringify(tot));

    // ---- 9. the workspace, opened with real clicks ----
    await page.goto(`${base}/index.html?demo=1&ladder=pr26619&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    // name a row as a loading control, so the suggested-control path is the one exercised
    await page.evaluate(() => { const r = BApp.S.rows.find(x => !x.hidden); r.name = 'GAPDH'; BApp.commit(); });
    const rowChecks = await page.evaluate(() => {
      const app = BApp, row = app.S.rows.find(candidate => !candidate.hidden), records = app.chemiOf(app.blot(row.blot));
      const exposures = records.map(record => record.exposure), quantify = WB.quantify, rowExpo = app.rowExpo;
      try {
        records.forEach(record => { record.exposure = null; });
        const unknown = app.quantLinearity(row);
        records.forEach((record, index) => { record.exposure = index + 1; });
        app.rowExpo = candidate => rowExpo(candidate).map((exposure, index) => ({ ...exposure, factor: index + 1 }));
        const values = [[1.25, 1.35], [1.75, 2], [3, 3]];
        WB.quantify = (image, signal, specs) => {
          const index = records.findIndex(record => record.img === image);
          return specs.map((spec, lane) => spec ? { volume: values[index][lane === 0 ? 0 : 1], quantifiable: true } : null);
        };
        const deviating = app.quantLinearity(row);
        WB.quantify = (image, signal, specs) => {
          const index = records.findIndex(record => record.img === image);
          return specs.map((spec, lane) => spec ? { volume: index + 1, quantifiable: lane === 0 || index === 0 } : null);
        };
        const partial = app.quantLinearity(row);
        return { unknown, deviating, partial };
      } finally {
        records.forEach((record, index) => { record.exposure = exposures[index]; });
        WB.quantify = quantify;
        app.rowExpo = rowExpo;
      }
    });
    check('intensity-derived factors cannot replace missing exposure times in a linearity check',
      rowChecks.unknown.verdict !== 'proportional' && rowChecks.unknown.reason === 'times-unknown', JSON.stringify(rowChecks.unknown));
    check('a lane exceeding the residual limit makes the row fail even if another lane has a lower R2',
      rowChecks.deviating.verdict === 'deviates', JSON.stringify(rowChecks.deviating));
    check('one testable lane cannot mark the remaining untestable lanes as proportional',
      rowChecks.partial.verdict === 'partial' && rowChecks.partial.coverage.tested === 1
        && rowChecks.partial.coverage.total > 1, JSON.stringify(rowChecks.partial));
    await page.locator('#preview image[data-row]').first().click();
    const settledRows = await page.evaluate(() => BApp.S.rows.map(row => row.id));
    // the export-menu item is a shortcut to the same workspace, not a second dialog
    await page.click('#btnExportMenu');
    await page.click('#btnQuant');
    await page.waitForSelector('body.quant-mode', { timeout: 10000 });
    await page.locator('#preview image[data-row]').first().click();
    await page.keyboard.press('Backspace');
    const afterDelete = await page.evaluate(() => BApp.S.rows.map(row => row.id));
    check('the quantification workspace blocks inherited Backspace deletion of a selected figure box',
      JSON.stringify(afterDelete) === JSON.stringify(settledRows), JSON.stringify({ settledRows, afterDelete }));
    if (afterDelete.length !== settledRows.length) await page.evaluate(() => BApp.undo());
    await page.keyboard.press('Alt+ArrowDown');
    const afterReorder = await page.evaluate(() => BApp.S.rows.map(row => row.id));
    check('the quantification workspace blocks inherited figure-reordering shortcuts',
      JSON.stringify(afterReorder) === JSON.stringify(settledRows), JSON.stringify(afterReorder));
    const annotation = await page.evaluate(() => {
      const note = WBNotes.addLabel(BApp.S.rows[0].id, 'main'); note.text = 'Read-only note'; BApp.commit();
      return { id: note.id, before: JSON.stringify(note) };
    });
    const noteBox = await page.locator(`#preview [data-note="${annotation.id}"]`).first().boundingBox();
    await page.mouse.move(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(noteBox.x + noteBox.width / 2 + 20, noteBox.y + noteBox.height / 2 + 12, { steps: 5 });
    await page.mouse.up();
    const afterAnnotation = await page.evaluate(id => JSON.stringify(BApp.S.notes.find(note => note.id === id)), annotation.id);
    check('figure annotations cannot be dragged or edited inside the quantification workspace',
      annotation.before === afterAnnotation, afterAnnotation);
    await page.evaluate(id => { BApp.S.notes = BApp.S.notes.filter(note => note.id !== id); BApp.commit(); }, annotation.id);
    const fromMenu = await page.evaluate(() => ({
      mode: document.body.classList.contains('quant-mode'),
      dlgGone: !document.getElementById('quantDlg'),
      panel: !document.getElementById('quantPanel').classList.contains('hidden'),
      table: !document.getElementById('quantData').classList.contains('hidden'),
      curve: !!document.querySelector('.q-ov .q-hl.sel')
    }));
    await page.click('#qBack');
    const wentBack = await page.evaluate(() => !document.body.classList.contains('quant-mode'));
    check('the export-menu entry opens the workspace itself, and "back to the figure" leaves it',
      fromMenu.mode && fromMenu.dlgGone && fromMenu.panel && fromMenu.table && fromMenu.curve && wentBack,
      JSON.stringify({ fromMenu, wentBack }));
    // the primary entry is the step-5 card: the figure is settled, then the numbers are optional
    if (!(await page.isVisible('#qCard'))) await page.click('#secNames .sec-head');
    await page.click('#btnQuantOpen');
    await page.waitForSelector('body.quant-mode', { timeout: 10000 });
    const panel = await page.evaluate(() => ({
      method: (document.querySelector('#qMethodBox input:checked') || {}).value,
      control: document.getElementById('qControl') ? document.getElementById('qControl').value : null,
      suggested: (BApp.suggestControl && BApp.suggestControl()) || null,
      source: BApp.quantSettings().controlSource,
      rows: document.querySelectorAll('#qControl option').length,
      lin: document.querySelectorAll('#qLin .qlin').length,
      dilDisabled: document.getElementById('qDil').disabled
    }));
    check('the workspace proposes a loading control but waits for an explicit choice before using it',
      panel.method === 'control' && !!panel.suggested && panel.control === '' && panel.source === 'none'
        && panel.rows >= 2 && panel.lin === 0 && !panel.dilDisabled,
      JSON.stringify(panel));
    await page.locator('#qAdvanced > summary').click();
    await page.check('#qExposureCheck');
    const linearityNameWidths = await page.evaluate(() => [...document.querySelectorAll('#qLin .nm')].map(label => label.getBoundingClientRect().width));
    check('per-check diagnostics do not squeeze protein names into a single character',
      linearityNameWidths.length > 0 && linearityNameWidths.every(width => width >= 96), JSON.stringify(linearityNameWidths));
    const unconfirmed = await page.evaluate(() => {
      BApp.setQuant({ dilution: {} });
      return { source: BApp.quantSettings().controlSource, control: BApp.quantSettings().controlRow,
        ratios: BApp.quantData().flatMap(block => block.rows).filter(row => row.norm).length };
    });
    check('editing unrelated settings cannot turn a suggested control into a confirmed control',
      unconfirmed.source === 'none' && !unconfirmed.control && unconfirmed.ratios === 0, JSON.stringify(unconfirmed));
    const legacySuggestion = await page.evaluate(() => {
      const saved = BApp.S.quant;
      BApp.S.quant = { method: 'control', controlRow: BApp.suggestControl(), controlSource: 'suggested' };
      const settings = BApp.quantSettings(); BApp.S.quant = saved; return settings;
    });
    check('a legacy project marked suggested does not silently become an explicit control choice',
      !legacySuggestion.controlRow && legacySuggestion.controlSource === 'none', JSON.stringify(legacySuggestion));
    // "not enough points" reads as a broken tool when the bands look even: a point is an exposure, and the
    // reason has to name the exposures that were lost, not just count what is left
    const why = await page.evaluate(() => [...document.querySelectorAll('#qLin .qlin')].map(b => ({
      verdict: b.children[1].textContent.trim(),
      why: b.querySelector('.qwhy') ? b.querySelector('.qwhy').textContent.trim() : '',
      note: !!document.querySelector('#qLin .qlin-note')
    })));
    check('a row that cannot be checked says why (one exposure, or the saturated exposures by name)',
      why.length >= 4 && why.some(w => /usable/.test(w.why)) && why.some(w => /one exposure/.test(w.why))
        && why.every(w => !/not enough/.test(w.verdict) || w.why.length > 0) && why.some(w => w.note),
      JSON.stringify(why));
    // choosing the control is the user's decision, and the export records that it was a decision
    const otherControl = await page.evaluate(() => {
      const b = BApp.quantData()[0], cur = BApp.quantSettings().controlRow;
      const me = b.rows.find(x => x.row.id === cur);
      const x = b.rows.find(y => y.row.id !== cur && (!me || y.blot === me.blot));
      return x ? x.row.id : '';
    });
    await page.selectOption('#qControl', otherControl);
    const afterControl = await page.evaluate(() => {
      const b = BApp.quantData()[0];
      return { method: b.settings.method, source: BApp.quantSettings().controlSource,
        withNorm: b.rows.filter(x => x.norm).length };
    });
    check('choosing the control records it as chosen, and the ratios follow',
      afterControl.method === 'control' && afterControl.source === 'chosen' && afterControl.withNorm > 0,
      JSON.stringify(afterControl));
    // capture the methods paragraph instead of copying it to the real clipboard
    await page.evaluate(() => {
      window.__clip = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async t => { window.__clip = t; }, readText: async () => '' } });
    });
    const takeClip = () => page.evaluate(async () => {
      const start = performance.now();
      while (window.__clip == null && performance.now() - start < 5000) await new Promise(r => setTimeout(r, 20));
      const t = window.__clip; window.__clip = null; return t;
    });

    // ---- 10. each normalisation method means what it says ----
    await page.locator('#qOtherMethods > summary').click();
    await page.locator('#qMethodBox input[value="sum"]').check();
    const sumState = await page.evaluate(() => {
      const b = BApp.quantData()[0], rows = b.rows.filter(x => x.norm);
      return { nRows: rows.length, sum: rows.map(x => { const v = x.norm.filter(y => y != null); return v.reduce((a, c) => a + c, 0); }) };
    });
    await page.locator('#qMethodBox input[value="none"]').check();
    const noneState = await page.evaluate(() => {
      const b = BApp.quantData()[0];
      return { norm: b.rows.filter(x => x.norm).length, warn: b.warnings.map(w => w.code) };
    });
    const noneToggle = await page.evaluate(() => !document.getElementById('qViewSeg') && /Raw signal/.test(document.getElementById('qDetail').textContent));
    await page.locator('#qMethodBox input[value="control"]').check();
    check('the lane-sum method makes every lane a fraction of that row\'s total, and "none" gives no ratio',
      sumState.nRows > 0 && sumState.sum.every(s => s > 0.99 && s <= 1 + 1e-6) && noneState.norm === 0 && noneToggle,
      JSON.stringify({ sumState, noneState, noneToggle }));
    const normView = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#qTableWrap tbody tr')];
      const canonical = BApp.quantData().flatMap(block => block.rows);
      return rows.map(tr => {
        const entry = canonical.find(candidate => candidate.row.id === tr.dataset.row);
        return { row: tr.dataset.row, first: (tr.querySelector('td.qnc .qcell span') || {}).textContent,
          expected: (entry.isControl ? entry.d.map(value => value && value.quantifiable ? value.volume : null) : entry.relative || []).find(value => value != null) };
      });
    });
    check('the normalised view reports the actual control ratio without automatic first-lane scaling',
      normView.filter(x => x.first != null).length >= 2
        && normView.filter(x => x.first != null).every(x => Math.abs(Number(x.first) - x.expected) <= Math.max(0.001, Math.abs(x.expected) * 0.015)), JSON.stringify(normView));
    const normRow = await page.evaluate(() => {
      const b = BApp.quantData()[0];
      const x = b.rows.find(r => r.norm && r.norm.some(v => v != null));
      return x ? x.row.id : null;
    });
    await page.click(`#qTableWrap tbody tr[data-row="${normRow}"]`);
    const detailNorm = await page.evaluate(() => [...document.querySelectorAll('#qDetail .qd-sub')].pop().textContent);
    await page.locator('#qRawDetails > summary').click();
    const detailVol = await page.textContent('#qRawDetails');
    check('results name the control ratio while original signals remain in expanded details',
      /\//.test(detailNorm) && /Raw signal details/.test(detailVol) && await page.locator('#qRawTable .qtable').count() > 0, JSON.stringify({ detailNorm, detailVol }));
    await page.locator('#qRawDetails > summary').click();

    // ---- 10b. the table and the figure are two views of one selection ----
    const selId = () => page.evaluate(() => (document.querySelector('#qTableWrap tbody tr.sel') || { dataset: {} }).dataset.row);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#qTableWrap tbody tr')].map(tr => tr.dataset.row));
    await page.click(`#qTableWrap tbody tr[data-row="${ids[0]}"]`);
    const fromTable = await selId();
    const band = await page.locator(`#preview svg image[data-row="${ids[1]}"]`).first().boundingBox();
    await page.mouse.click(band.x + band.width / 2, band.y + band.height / 2);
    const fromFigure = await selId();
    check('clicking a row selects it, and clicking its band on the figure selects the same row',
      ids.length >= 2 && fromTable === ids[0] && fromFigure === ids[1],
      JSON.stringify({ ids, fromTable, fromFigure }));
    // the row menu can put another exposure under the same row — and that is one undo away
    const other = page.locator('#qTableWrap tbody tr[data-row="' + ids[1] + '"] .qmenu');
    const before = await page.evaluate(id => ({ img: BApp.row(id).img, auto: BApp.row(id).auto }), ids[1]);
    await other.click();
    const canSwitch = await page.locator('#popover [data-ex]').count() > 0;
    const switched = await page.evaluate(id => BApp.row(id).img, ids[1]);
    const restored = await page.evaluate(id => ({ img: BApp.row(id).img, auto: BApp.row(id).auto }), ids[1]);
    const returnSource = await page.locator('#qmEditSource').count();
    check('the row menu keeps the selected figure exposure read-only and offers a return to figure editing',
      !canSwitch && returnSource === 1 && switched === before.img && restored.img === before.img && restored.auto === before.auto,
      JSON.stringify({ before, switched, canSwitch, restored }));
    await page.keyboard.press('Escape');
    // Esc is the same exit as the back button
    await page.keyboard.press('Escape');
    const escLeft = await page.evaluate(() => !document.body.classList.contains('quant-mode'));
    check('Escape leaves the workspace without touching the figure', escLeft);
    await page.click('#btnQuantOpen');
    await page.waitForSelector('body.quant-mode', { timeout: 10000 });
    // the table can be pasted straight into Excel: TSV, header first, same numbers as the screen
    await page.evaluate(() => { window.__clip = null; });
    await page.click('#qCopy');
    const tsv = await takeClip();
    check('"copy table" copies TSV with a header row and one line per protein',
      !!tsv && tsv.split('\n')[0].split('\t')[0] === 'Protein' && tsv.split('\n').length > 2 && tsv.includes('\t'),
      (tsv || '').slice(0, 160));
    // on a narrow window the settings column becomes a drawer; clicking away (or Esc) folds it again
    await page.setViewportSize({ width: 1100, height: 900 });
    const drawerPos = await page.evaluate(() => getComputedStyle(document.getElementById('quantPanel')).position);
    await page.click('#qSetBtn');
    const drawerOpen = await page.evaluate(() => document.body.classList.contains('q-set-open'));
    await page.click('#quantData .col-title');
    const drawerShut = await page.evaluate(() => !document.body.classList.contains('q-set-open'));
    await page.setViewportSize({ width: 1600, height: 960 });
    check('on a small window the settings column becomes a drawer the figure header can open, and clicking away closes it',
      drawerPos === 'absolute' && drawerOpen && drawerShut, JSON.stringify({ drawerPos, drawerOpen, drawerShut }));

    // ---- 11. a control far weaker than what it normalises is called out ----
    const weak = await page.evaluate(() => {
      const C = BApp, rows = C.S.rows.filter(r => !r.hidden && r.segs && r.segs.length);
      const ctrl = rows[0], target = rows.find(r => r !== ctrl && r.blot === ctrl.blot);
      if (!target) return { skip: true };
      C.setQuant({ method: 'control', controlRow: ctrl.id });
      // synthesize the situation the rule is about: one row's bands read as 1000x the control's
      const origSpec = C.quantLaneSpec, origQ = WB.quantify;
      C.quantLaneSpec = function (row, s, rec) { const sp = origSpec.call(C, row, s, rec); if (sp && row === target) sp.__strong = 1; return sp; };
      WB.quantify = function (img, sig, specs) {
        const out = origQ.call(WB, img, sig, specs);
        specs.forEach((sp, i) => { if (sp && sp.__strong && out[i] && out[i].volume > 0) out[i].volume *= 1000; });
        return out;
      };
      let codes = [];
      try { codes = C.quantData()[0].warnings.filter(w => w.code === 'weak-control'); }
      finally { C.quantLaneSpec = origSpec; WB.quantify = origQ; }
      C.setQuant({ method: 'control', controlRow: ctrl.id });   // leave the workspace on a usable control
      return { skip: false, n: codes.length, frac: codes.length ? codes[0].frac : null, row: codes.length ? (codes[0].row.name || '') : '' };
    });
    check('a control far weaker than the band it normalises raises a warning instead of a clean ratio',
      !weak.skip && weak.n > 0 && weak.frac != null && weak.frac < 0.1, JSON.stringify(weak));

    // ---- 12. conditions become n / mean / SD / CV, with no test applied ----
    const conds = await page.evaluate(() => {
      const C = BApp, n = C.columns(C.layoutColumns()[0].id).vis.length;
      C.setQuant({ sampleUnit: 'independent' });
      C.S.groups = [{ from: 1, to: Math.min(3, n), text: 'Control' }, { from: Math.min(3, n - 1) + 1, to: n, text: 'KD' }];
      C.commit();
      const b = C.quantData()[0], x = b.rows.find(r => r.conditions && r.conditions.some(c => c.n > 1));
      return x ? x.conditions.map(c => ({ text: c.text, n: c.n, mean: c.mean, sd: c.sd, cv: c.cv })) : null;
    });
    check('the lane ranges the figure already labels become replicates with n, mean, SD and CV',
      !!conds && conds.some(c => c.n > 1 && c.mean > 0 && c.sd != null && c.cv != null)
        && conds.every(c => c.n < 2 || c.sd != null), JSON.stringify(conds));
    const statsRow = await page.evaluate(() => BApp.quantData()[0].rows.find(row => row.norm && row.norm[0] > 0).row.id);
    await page.click(`#qTableWrap tbody tr[data-row="${statsRow}"]`);
    const viewStats = [await page.evaluate(() => {
        const rowId = document.querySelector('#qTableWrap tr.sel').dataset.row;
        const row = BApp.quantData()[0].rows.find(candidate => candidate.row.id === rowId);
        const values = row.relative.slice(0, 3).filter(value => value != null);
        return { expected: values.reduce((sum, value) => sum + value, 0) / values.length,
          actual: Number(document.querySelector('#qDetail .qstat tbody tr td:nth-child(3)').textContent) };
      })];
    check('condition means follow the same control-ratio scale as the visible result table',
      viewStats.every(stat => Math.abs(stat.expected - stat.actual) <= Math.max(0.001, stat.expected * 0.015)), JSON.stringify(viewStats));

    // ---- 13. total protein, end to end: a painted stain normalises by what was loaded ----
    const total = await page.evaluate(() => {
      const C = BApp, cols = C.columns(C.layoutColumns()[0].id);
      const ri = cols.rows.findIndex(r => r.segs && r.segs.length && C.blot(r.blot));
      if (ri < 0) return { skip: true };
      const blot = C.blot(cols.rows[ri].blot), ref = C.images.get(blot.images[0]);
      const w = ref.img.w, h = ref.img.h, data = new Float32Array(w * h).fill(0.95);
      // lane j holds 1% x (j+1) of stain: the totals must come back in that proportion
      const painted = [];
      (cols.src[ri] || []).forEach((s, j) => {
        const sp = C.quantTotalLaneSpec(s);
        if (!sp) return;
        painted.push(j + 1);
        const half = sp.pitch * 0.2;
        for (let u = sp.uc - half; u <= sp.uc + half; u += 0.5)
          for (let v = sp.vTop; v <= sp.vBot; v += 0.5) {
            const p = WB.toImg(sp.F, u, v), xi = Math.round(p[0]), yi = Math.round(p[1]);
            if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
            data[yi * w + xi] = 0.95 - 0.01 * (j + 1);
          }
      });
      C.images.set('stainT', { name: 'Ponceau.tif', kind: 'marker', bits: 16, img: { w, h, data }, raw: null, cs: null, thumb: null });
      blot.images.push('stainT');
      C.setQuant({ method: 'total', totalImage: 'stainT' });
      const b = C.quantData()[0], x = b.rows[ri];
      const vols = (x.total || []).map(v => (v && v.quantifiable ? v.volume : null));
      const got = vols.map((v, i) => (v == null ? null : { lane: i + 1, v })).filter(Boolean);
      const base = got.length ? got[0].v : 0;
      const ratios = got.map(o => o.v / base);
      return { vols: vols.map(v => (v == null ? null : +v.toFixed(1))), lanes: got.map(o => o.lane), ratios: ratios.map(v => +v.toFixed(2)),
        painted, warnings: b.warnings.map(w => w.code) };
    });
    const totalOk = !total.skip && total.ratios.length >= 3
      && total.ratios.every((r, i) => Math.abs(r - total.lanes[i]) / total.lanes[i] < 0.12);
    check('a painted total-protein stain normalises the lanes in proportion to what was loaded',
      totalOk, JSON.stringify(total).slice(0, 400));
    const fluorescentTotal = await page.evaluate(() => {
      const stain = BApp.images.get('stainT');
      stain.img = { w: stain.img.w, h: stain.img.h, data: Float32Array.from(stain.img.data, value => 1 - value) };
      BApp.setQuant({ totalPolarity: 'bright' });
      const row = BApp.quantData()[0].rows.find(candidate => candidate.total && candidate.total.some(value => value && value.volume > 0));
      return row ? { volumes: row.total.map(value => value && value.volume), warnings: BApp.quantData()[0].warnings.map(warning => warning.code) } : null;
    });
    check('a user-declared fluorescent total-protein image works end to end',
      !!fluorescentTotal && fluorescentTotal.volumes.some(value => value > 0)
        && !fluorescentTotal.warnings.includes('total-not-stain'), JSON.stringify(fluorescentTotal));
    // the methods text has to describe the stain integration it actually used, not the band profile
    await page.click('#qMethodsBtn');
    const totalMethods = await takeClip();
    check('the methods paragraph describes total-protein integration instead of reusing the band-window sentence',
      !!totalMethods && /total protein/i.test(totalMethods) && /half-width 0\.28 of lane spacing/.test(totalMethods)
        && /sampling-grid-rounded/.test(totalMethods),
      (totalMethods || '').slice(0, 300));
    await page.evaluate(() => {
      const C = BApp, blot = C.S.blots.find(b => b.images.includes('stainT'));
      C.setQuant({ method: 'control', totalImage: null });
      if (blot) blot.images = blot.images.filter(id => id !== 'stainT');
      C.images.delete('stainT');
      C.commit();
    });
    const dilutionRow = await page.evaluate(() => {
      const row = BApp.quantData()[0].rows.find(candidate => candidate.norm && candidate.norm.some(value => value > 0)).row;
      row.name = 'Dilution target';
      BApp.setQuant({ dilution: { [row.id]: [1, 0.5, 0.25] } });
      return row.id;
    });
    await page.click(`#qTableWrap tbody tr[data-row="${dilutionRow}"]`);
    const declaredDilution = await page.evaluate(() => ({
      text: document.getElementById('qDilOut').textContent,
      fit: BApp.quantDilution(BApp.row(document.querySelector('#qTableWrap tr.sel').dataset.row), [1, 0.5, 0.25])
    }));

    // ---- 14. the exports, through the panel's own buttons ----
    const csv = await grab('qCsv');
    check('the exported CSV carries the volume table and every traceability block',
      !!csv && /# normalisation/.test(csv.text) && /# lane detail/.test(csv.text) && /# linearity/.test(csv.text)
        && /# conditions/.test(csv.text) && /control ratio/.test(csv.text) && /Fixed mode/.test(csv.text) && /integration_mode/.test(csv.text),
      (csv && csv.text || '').slice(0, 300));
    check('CSV includes the declared dilution fit, its failure and the original x/y points',
      declaredDilution.fit.verdict === 'deviates' && /deviates/.test(declaredDilution.text)
        && !!csv && /,dilution,/.test(csv.text) && /# linearity points/.test(csv.text), (csv && csv.text || '').slice(-1500));
    const json = await grab('qJson');
    const parsed = json ? JSON.parse(json.text) : null;
    check('the exported JSON records the software, the method and the per-lane numbers',
      !!parsed && /^BlotFigure \d/.test(parsed.software) && parsed.method === 'control' && !!parsed.parameters
        && parsed.columns[0].rows.some(r => r.volumes.some(v => v && v.volume > 0)),
      JSON.stringify(parsed && { software: parsed.software, method: parsed.method, cols: parsed.columns.length }));
    const dilutionExport = parsed && parsed.columns.flatMap(column => column.linearity).find(fit => fit.mode === 'dilution');
    check('JSON preserves the dilution settings, measured points and failed verdict',
      !!dilutionExport && dilutionExport.verdict === 'deviates' && dilutionExport.series.length === 3
        && parsed.parameters.settings.dilution[dilutionRow].join(',') === '1,0.5,0.25', JSON.stringify(dilutionExport));

    await page.evaluate(() => { window.__clip = null; });
    await page.click('#qMethodsBtn');
    const methods = await takeClip();
    check('the methods paragraph names the software, the normalisation and says no test was applied',
      !!methods && /BlotFigure \d/.test(methods) && /normalised/i.test(methods) && /No significance test/.test(methods),
      (methods || '').slice(0, 240));
    check('Methods explicitly discloses a failed dilution-series check, rather than only a passed exposure check',
      !!methods && /dilution/i.test(methods) && /not proportional to (the )?(protein )?amount/i.test(methods)
        && /Dilution target/.test(methods), methods);

    check('no JavaScript errors during quantification', errs.length === 0, errs.join(' | '));
  } catch (e) {
    check('quantification suite ran', false, e.message);
  } finally {
    await ctx.close();
  }
  return results;
}
