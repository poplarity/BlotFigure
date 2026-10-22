/* The interface, driven like a user would (English UI): the demo membranes go through the steps, names are typed
 * on the figure, the pre-flight check, the exports checked byte by byte, projects, style files, reset, the draft,
 * labels that never collide, target-band arrows, and no Chinese left anywhere in the English interface. */
const CJK = /[㐀-鿿！-～　-〿]/;

export async function uiChecks(browser, base) {
  const results = [];
  const check = (what, ok, detail) => results.push(ok ? ['ok', what] : ['FAIL', what, detail || '']);
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && /Content.Security.Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // every text the interface shows (hidden parts excluded); the demo's own names are English
  const leftovers = async where => {
    const t = await ev(() => document.body.innerText);
    const bad = t.split('\n').filter(l => CJK.test(l) && !/^(EN|中文)$/.test(l.trim()));
    if (bad.length) leftoverLines.push(...bad.map(l => `[${where}] ${l.trim().slice(0, 90)}`));
  };
  const leftoverLines = [];
  try {
    await page.goto(`${base}/index.html?lang=en`);
    await leftovers('start screen');
    await page.goto(`${base}/index.html?demo=1&ladder=pr26619&draft=1&lang=en`);
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
    const s0 = await ev(() => ({ blots: BApp.S.blots.length, rows: BApp.S.rows.filter(r => !r.hidden).length, step: BApp.S.step }));
    check('demo: two membranes, protein rows, step 5', s0.blots === 2 && s0.rows >= 4 && s0.step === 5, JSON.stringify(s0));

    // every toast, kept for the check at the end
    await ev(() => { window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => window.__toasts.push(n.textContent)))).observe(document.getElementById('toasts'), { childList: true }); });
    // every step of the panel, the menus and the help in English
    for (const k of [1, 2, 3, 4, 5]) { await ev(k => UI.openStep(k), k); await page.waitForTimeout(150); await leftovers('step ' + k); }
    // a picture's ⋯ menu, a selected row's tools, the annotation modes' banners
    await ev(() => UI.openStep(1));
    const more = await page.$('#blotList .thumb .more');
    if (more) { await more.click(); await page.waitForTimeout(150); await leftovers('picture menu'); await page.keyboard.press('Escape'); await page.mouse.click(5, 300); }
    await ev(() => { UI.openStep(3); const r = BApp.S.rows.find(r => !r.hidden); BApp.selRow = r.id; BApp.emit('select'); BApp.emit('change'); });
    await page.waitForTimeout(200); await leftovers('row tools');
    for (const m of ['group', 'bracket', 'cond', 'arrow']) { await ev(m => { UI.openStep(5); BApp.setMode(m); }, m); await page.waitForTimeout(100); await leftovers('mode ' + m); }
    await ev(() => BApp.setMode(null));
    await ev(() => UI.openStep(5));
    await page.click('#btnFile'); await leftovers('file menu'); await page.keyboard.press('Escape'); await page.mouse.click(5, 300);
    await page.click('#btnExportMenu'); await leftovers('export menu'); await page.mouse.click(5, 300);
    await page.click('#btnHelp'); await leftovers('help'); await page.click('#btnHelpClose');

    // marks on each strip's ladder lane: the rows get sizes
    await ev(() => {
      const S = BApp.S;
      S.blots.forEach(b => (b.pieces || []).forEach(pc => {
        const r = S.rows.find(r => r.segs.some(s => s.piece === pc.id)); if (!r) return;
        const sg = r.segs.find(s => s.piece === pc.id), u = BApp.ladderU(pc);
        BApp.manualMarks(b, pc).push({ u, v: sg.vc - r.above * 0.6, kda: 130 }, { u, v: sg.vc + r.below * 0.6, kda: 100 });
      }));
      BApp.commit();
    });

    // lane names typed on the figure: Enter goes on to the next lane
    await page.locator('#preview g[data-edit="lane"]').first().click();
    await page.keyboard.type('Ctrl'); await page.keyboard.press('Enter'); await page.keyboard.type('siA');
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    const ln = await ev(() => BApp.figLanes().slice(0, 2).map(j => BApp.S.lanes[j - 1].name));
    check('lane names typed on the figure, Enter moves on', ln[0] === 'Ctrl' && ln[1] === 'siA', JSON.stringify(ln));

    // the pre-flight check: unnamed proteins are listed and the export waits
    await page.click('#btnPNG'); await page.waitForTimeout(300);
    const pf = await ev(() => ({ open: !document.getElementById('preflightDlg').classList.contains('hidden'), n: document.querySelectorAll('#pfList .pf-item').length, text: document.getElementById('pfList').innerText }));
    check('pre-flight check lists unnamed proteins', pf.open && pf.n > 0 && /protein/i.test(pf.text), pf.text.slice(0, 200));
    await leftovers('pre-flight');
    await page.click('#pfBack');

    // groups: never overlapping, in each fit mode
    await ev(() => {
      const fl = BApp.figLanes(), S = BApp.S;
      S.rows.filter(r => !r.hidden).forEach((r, i) => { r.name = ['mTOR', 'p-ERK1/2', 'GAPDH', 'Target-X', 'b-actin', 'P6', 'P7'][i] || 'P' + i; });
      fl.forEach((j, k) => { S.lanes[j - 1].name = 'L' + (k + 1); });
      S.groups = [{ from: fl[0], to: fl[2], text: 'siRNA control knockdown' }, { from: fl[3], to: fl[5], text: 'siRNA target knockdown 72 h' }];
      BApp.commit();
    });
    const fit = {};
    for (const m of ['wrap', 'shrink', 'none']) fit[m] = await ev(m => { BApp.S.style.groupFit = m; BApp.commit(); return BRender.build(false).overlaps.length; }, m);
    check('long group labels never overlap (wrap / shrink / one line)', fit.wrap === 0 && fit.shrink === 0 && fit.none === 0, JSON.stringify(fit));
    await ev(() => { BApp.S.style.groupFit = 'wrap'; BApp.commit(); });

    // exports, byte by byte
    const download = async (btn, menu) => {
      if (menu) await page.click('#btnExportMenu');
      const wait = page.waitForEvent('download', { timeout: 60000 });
      await page.click(btn);
      await page.waitForTimeout(300);
      if (await page.isVisible('#preflightDlg')) await page.click('#pfGo');
      const d = await wait, p = await d.path();
      return { name: d.suggestedFilename(), bytes: [...(await import('node:fs')).readFileSync(p)] };
    };
    const png = await download('#btnPNG');
    const b = Buffer.from(png.bytes), chunks = [];
    for (let p = 8; p + 8 <= b.length;) { const len = b.readUInt32BE(p); chunks.push(b.toString('latin1', p + 4, p + 8)); p += 12 + len; }
    const dpi = Math.round(b.readUInt32BE(b.indexOf('pHYs') + 4) * 0.0254);
    check('PNG carries pHYs and sRGB once, a summary, 600 dpi', chunks.filter(c => c === 'pHYs').length === 1 && chunks.filter(c => c === 'sRGB').length === 1 && chunks.includes('iTXt') && dpi === 600,
      `${chunks.join(',')} dpi ${dpi}`);
    const tif = await download('#btnTIFF', true);
    const t = await ev(async arr => { const r = await TIFF.decodeBuffer(new Uint8Array(arr).buffer, 'x.tif'); return { w: r.width, h: r.height, dpi: Math.round(r.dpi), bits: r.bits }; }, tif.bytes);
    check('TIFF export decodes, 8-bit, 600 dpi', t.w > 500 && t.bits === 8 && t.dpi === 600, JSON.stringify(t));
    const svg = await download('#btnSVG', true);
    const svgOk = await ev(s => { const d = new DOMParser().parseFromString(s, 'image/svg+xml'); return !d.querySelector('parsererror') && d.querySelectorAll('image').length > 0; }, Buffer.from(svg.bytes).toString('utf8'));
    check('SVG export is well-formed with the band images', svgOk);
    const log = JSON.parse(Buffer.from((await download('#btnLog', true)).bytes).toString('utf8'));
    check('processing log: every source with its SHA-256', log.images.length > 0 && log.images.every(i => /^[0-9a-f]{64}$/.test(i.sha256)), `${log.images.length} images`);
    const figText = Buffer.from(svg.bytes).toString('utf8').replace(/<image[^>]*>/g, '');
    check('the figure is English only', !CJK.test(figText) && !CJK.test(JSON.stringify(log.legendHints || [])), (figText.match(/.{0,30}[㐀-鿿].{0,30}/) || [''])[0]);

    // project round trip
    const proj = await ev(async () => {
      // (numbers to 1e-6: marks carried through the strips' frames on re-analysis differ in the last bits)
      const snap = () => JSON.stringify(BApp.S, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
      const before = snap(), blob = await BApp.saveProject();
      await BApp.openProject(new File([blob], 'x.blotfig'));
      return { same: snap() === before, mb: +(blob.size / 1048576).toFixed(1) };
    });
    check('project file round trip', proj.same, JSON.stringify(proj));

    // style file round trip
    const tpl = await ev(() => {
      const shown = () => JSON.stringify({ rows: BApp.S.rows.filter(r => !r.hidden).map(r => r.name), lanes: BApp.figLanes().map(j => BApp.S.lanes[j - 1].name), groups: BApp.S.groups.map(g => g.text), font: BApp.S.style.fontPt });
      const before = shown(), T = JSON.parse(JSON.stringify(BApp.template()));
      BApp.S.rows.forEach(r => { r.name = ''; }); BApp.S.lanes.forEach(l => { l.name = ''; }); BApp.S.groups = []; BApp.S.style.fontPt = 5; BApp.commit();
      BApp.applyTemplate(T); BApp.commit();
      return { same: shown() === before };
    });
    check('style file round trip', tpl.same);

    // back to import, and undo
    const reset = await ev(() => {
      const named = () => BApp.S.rows.filter(r => r.name).length;
      const before = named(); BApp.resetAll(); BApp.commit();
      const after = named(); BApp.undo();
      return { before, after, back: named() };
    });
    check('back to import clears the work; Ctrl+Z brings it back', reset.before > 0 && reset.after === 0 && reset.back === reset.before, JSON.stringify(reset));

    // target-band arrow: snaps to a band and gets a size; a typed size; undo with its popover open
    await ev(() => BApp.setMode('arrow'));
    const rowId = await ev(() => BApp.S.rows.filter(r => !r.hidden)[1].id);
    const box = await (await page.$(`#preview image[data-row="${rowId}"]`)).boundingBox();
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.waitForTimeout(200);
    const ar = await ev(() => ({ n: BApp.S.arrows.length, label: BApp.S.arrows[0] && BApp.arrowLabel(BApp.S.arrows[0]), pop: !document.getElementById('popover').classList.contains('hidden') }));
    check('target-band arrow gets a size from the marker', ar.n === 1 && /\d+ kDa/.test(ar.label) && ar.pop, JSON.stringify(ar));
    await leftovers('arrow popover');
    await page.fill('#paSize', '44 kDa'); await page.waitForTimeout(100);
    const typed = await ev(() => BApp.arrowLabel(BApp.S.arrows[0]));
    await page.click('#btnUndo'); await page.waitForTimeout(150);
    const und = await ev(() => document.getElementById('popover').classList.contains('hidden'));
    check('typed size; undo closes the open popover', typed === '44 kDa' && und, `${typed} ${und}`);
    await ev(() => BApp.setMode(null));

    // switching the language re-renders what the scripts wrote
    await page.click('#btnLang'); await page.waitForTimeout(200);
    const zh = await ev(() => ({ lang: I18N.lang, panel: document.getElementById('panel').innerText }));
    await page.click('#btnLang'); await page.waitForTimeout(200);
    await leftovers('after switching back');
    check('language switch re-renders the panel', zh.lang === 'zh' && CJK.test(zh.panel));

    (await ev(() => window.__toasts || [])).filter(t => CJK.test(t)).forEach(t => leftoverLines.push('[toast] ' + t.slice(0, 90)));
    // the draft: written shortly after a change, offered after a reload, restored identically, discarded
    await page.waitForTimeout(2500);
    const before = await ev(() => JSON.stringify({ rows: BApp.S.rows.map(r => r.name), lanes: BApp.S.lanes.map(l => l.name), imgs: BApp.images.size }));
    await ev(() => { BApp.leaving = true; PrefStorage.setItem('blotfig.tour', '1'); });
    await page.goto(`${base}/index.html?lang=en`);
    await page.waitForTimeout(1200);
    const offered = await page.isVisible('#draftBox');
    await leftovers('draft offer');
    let restored = false;
    if (offered) {
      await page.click('#btnDraftRestore');
      await page.waitForFunction(() => window.BApp && BApp.S && BApp.S.rows.length, null, { timeout: 120000 });
      await page.waitForTimeout(400);
      restored = before === await ev(() => JSON.stringify({ rows: BApp.S.rows.map(r => r.name), lanes: BApp.S.lanes.map(l => l.name), imgs: BApp.images.size }));
    }
    await ev(() => BApp.dropDraft());
    const dropped = !(await ev(() => BApp.peekDraft()));
    check('draft is saved, offered, restored and discarded', offered && restored && dropped, JSON.stringify({ offered, restored, dropped }));

    dialogs.filter(t => CJK.test(t)).forEach(t => leftoverLines.push('[dialog] ' + t.slice(0, 90)));
    check('no Chinese left in the English interface', !leftoverLines.length, [...new Set(leftoverLines)].slice(0, 12).join('\n      '));
    check('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  } catch (e) {
    results.push(['FAIL', 'interface run', e.message.split('\n')[0]]);
  } finally { await ctx.close(); }
  return results;
}
