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

    // ---- 8. a stain is read with the opposite polarity, and a chemi frame is refused ----
    const tot = await page.evaluate(() => {
      const w = 40, h = 40;
      const light = new Float32Array(w * h).fill(0.9), dark = new Float32Array(w * h).fill(0.05);
      for (let y = 18; y < 22; y++) for (let x = 10; x < 30; x++) light[y * w + x] = 0.5;   // dark band on a light membrane
      for (let y = 18; y < 22; y++) for (let x = 10; x < 30; x++) dark[y * w + x] = 0.9;    // bright band on a dark one
      const st = WB.totalSignal({ w, h, data: light }), ch = WB.totalSignal({ w, h, data: dark });
      return { stain: !!st, peak: st ? Math.max.apply(null, st.sig) : null, chemiRefused: ch === null };
    });
    check('a stain (dark bands on a light membrane) is inverted; a chemiluminescence frame is refused',
      tot.stain && Math.abs(tot.peak - 0.5) < 1e-6 && tot.chemiRefused, JSON.stringify(tot));

    // ---- 9. the panel, opened with real clicks ----
    await page.goto(`${base}/index.html?demo=1&ladder=pr26619&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    // name a row as a loading control, so the suggested-control path is the one exercised
    await page.evaluate(() => { const r = BApp.S.rows.find(x => !x.hidden); r.name = 'GAPDH'; BApp.commit(); });
    await page.click('#btnExportMenu');
    await page.click('#btnQuant');
    await page.waitForSelector('#quantDlg:not(.hidden)', { timeout: 10000 });
    const panel = await page.evaluate(() => ({
      method: document.getElementById('qMethod').value,
      control: document.getElementById('qControl').value,
      rows: document.querySelectorAll('#qControl option').length,
      lin: document.querySelectorAll('#qLin .ql-item').length,
      dilDisabled: document.getElementById('qDil').disabled,
      warn: document.getElementById('qWarn').innerText.trim()
    }));
    check('the panel opens on the figure with a suggested control and one linearity line per row',
      panel.method === 'control' && !!panel.control && panel.rows >= 2 && panel.lin >= panel.rows && !panel.dilDisabled,
      JSON.stringify(panel));
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
    await page.selectOption('#qMethod', 'sum');
    const sumState = await page.evaluate(() => {
      const b = BApp.quantData()[0], rows = b.rows.filter(x => x.norm);
      return { nRows: rows.length, sum: rows.map(x => { const v = x.norm.filter(y => y != null); return v.reduce((a, c) => a + c, 0); }) };
    });
    await page.selectOption('#qMethod', 'none');
    const noneState = await page.evaluate(() => {
      const b = BApp.quantData()[0];
      return { norm: b.rows.filter(x => x.norm).length, warn: b.warnings.map(w => w.code) };
    });
    await page.selectOption('#qMethod', 'control');
    check('the lane-sum method makes every lane a fraction of that row\'s total, and "none" gives no ratio',
      sumState.nRows > 0 && sumState.sum.every(s => s > 0.99 && s <= 1 + 1e-6) && noneState.norm === 0,
      JSON.stringify({ sumState, noneState }));

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
      C.setQuant({ method: 'control', controlRow: null });
      return { skip: false, n: codes.length, frac: codes.length ? codes[0].frac : null, row: codes.length ? (codes[0].row.name || '') : '' };
    });
    check('a control far weaker than the band it normalises raises a warning instead of a clean ratio',
      !weak.skip && weak.n > 0 && weak.frac != null && weak.frac < 0.1, JSON.stringify(weak));

    // ---- 12. conditions become n / mean / SD / CV, with no test applied ----
    const conds = await page.evaluate(() => {
      const C = BApp, n = C.columns(C.layoutColumns()[0].id).vis.length;
      C.S.groups = [{ from: 1, to: Math.min(3, n), text: 'Control' }, { from: Math.min(3, n - 1) + 1, to: n, text: 'KD' }];
      C.commit();
      const b = C.quantData()[0], x = b.rows.find(r => r.conditions && r.conditions.some(c => c.n > 1));
      return x ? x.conditions.map(c => ({ text: c.text, n: c.n, mean: c.mean, sd: c.sd, cv: c.cv })) : null;
    });
    check('the lane ranges the figure already labels become replicates with n, mean, SD and CV',
      !!conds && conds.some(c => c.n > 1 && c.mean > 0 && c.sd != null && c.cv != null)
        && conds.every(c => c.n < 2 || c.sd != null), JSON.stringify(conds));

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
    // the methods text has to describe the stain integration it actually used, not the band profile
    await page.click('#qMethods');
    const totalMethods = await takeClip();
    check('the methods paragraph describes total-protein integration instead of reusing the band-window sentence',
      !!totalMethods && /total protein/i.test(totalMethods) && /full width of each lane/.test(totalMethods),
      (totalMethods || '').slice(0, 300));
    await page.evaluate(() => {
      const C = BApp, blot = C.S.blots.find(b => b.images.includes('stainT'));
      C.setQuant({ method: 'control', totalImage: null });
      if (blot) blot.images = blot.images.filter(id => id !== 'stainT');
      C.images.delete('stainT');
      C.commit();
    });

    // ---- 14. the exports, through the panel's own buttons ----
    const csv = await grab('qCsv');
    check('the exported CSV carries the volume table and every traceability block',
      !!csv && /# normalisation/.test(csv.text) && /# lane detail/.test(csv.text) && /# linearity/.test(csv.text)
        && /# conditions/.test(csv.text) && /rel\. lane 1/.test(csv.text) && /lower bound/.test(csv.text),
      (csv && csv.text || '').slice(0, 300));
    const json = await grab('qJson');
    const parsed = json ? JSON.parse(json.text) : null;
    check('the exported JSON records the software, the method and the per-lane numbers',
      !!parsed && /^BlotFigure \d/.test(parsed.software) && parsed.method === 'control' && !!parsed.parameters
        && parsed.columns[0].rows.some(r => r.volumes.some(v => v && v.volume > 0)),
      JSON.stringify(parsed && { software: parsed.software, method: parsed.method, cols: parsed.columns.length }));

    await page.evaluate(() => { window.__clip = null; });
    await page.click('#qMethods');
    const methods = await takeClip();
    check('the methods paragraph names the software, the normalisation and says no test was applied',
      !!methods && /BlotFigure \d/.test(methods) && /normalised/i.test(methods) && /No significance test/.test(methods),
      (methods || '').slice(0, 240));

    check('no JavaScript errors during quantification', errs.length === 0, errs.join(' | '));
  } catch (e) {
    check('quantification suite ran', false, e.message);
  } finally {
    await ctx.close();
  }
  return results;
}
