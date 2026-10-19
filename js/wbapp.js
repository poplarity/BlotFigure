/* BlotFigure application state.
 * images (not undoable): decoded pictures with kind (chemi | marker), exposure and signal.
 * S (undoable): membranes ("blots"), figure rows (one per protein crop), lanes, levels, annotations.
 * Figure lane j (1-based) maps to lane k = j + blot.shift of each membrane (k = 0 is the ladder lane).
 */
(function (G) {
  'use strict';
  const WB = G.WB;
  const MM = 72 / 25.4;
  let uidN = 1;
  const uid = p => p + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);
  const tick = () => new Promise(r => setTimeout(r, 16));

  const App = { images: new Map(), analysis: {}, S: null, hist: [], future: [], listeners: [], selRow: null, viewBlot: null, viewImg: null, mode: null };
  try { App.prefLadder = localStorage.getItem('blotfig.ladder') || null; } catch (e) { App.prefLadder = null; }

  const defaultStyle = () => ({ mmPerLane: 5, fontPt: 7, lineWidthPt: 0.5, labelAngle: 'auto', rowGapPt: 2, blotGapPt: 5,
    tickLenPt: 2.5, labelGapPt: 2.5, unitHeader: true, showMW: true, panelLetter: '', dpi: 600, invert: true });
  const newState = () => ({ blots: [], rows: [], lanes: [], range: [1, 1], levels: {}, conditions: [], groups: [], style: defaultStyle() });

  /* ---------- events / undo ---------- */
  App.on = fn => App.listeners.push(fn);
  App.emit = what => App.listeners.forEach(fn => fn(what));
  let raf = 0;
  App.refresh = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; App.emit('refresh'); }); };
  App.commit = function () {
    if (!App.S) return;
    App.refreshChoices();
    const snap = JSON.stringify(App.S);
    if (App.hist[App.hist.length - 1] !== snap) { App.hist.push(snap); if (App.hist.length > 120) App.hist.shift(); App.future = []; }
    App.emit('change');
  };
  App.undo = () => { if (App.hist.length < 2) return; App.future.push(App.hist.pop()); App.S = JSON.parse(App.hist[App.hist.length - 1]); App.emit('change'); };
  App.redo = () => { if (!App.future.length) return; const s = App.future.pop(); App.hist.push(s); App.S = JSON.parse(s); App.emit('change'); };

  function busy(on, text) {
    const b = document.getElementById('busy'); if (!b) return;
    b.classList.toggle('hidden', !on);
    if (text) document.getElementById('busyText').textContent = text;
  }
  App.busy = busy;

  /* ---------- lookups ---------- */
  App.blot = id => App.S.blots.find(b => b.id === id);
  App.row = id => App.S.rows.find(r => r.id === id);
  // shortest first: by exposure time when known, else by the estimated relative exposure
  App.chemiOf = blot => blot.images.map(id => App.images.get(id)).filter(r => r && r.kind === 'chemi')
    .sort((a, b) => (a.exposure != null && b.exposure != null ? a.exposure - b.exposure : (a.factor || 0) - (b.factor || 0)));
  App.markersOf = blot => blot.images.map(id => App.images.get(id)).filter(r => r && r.kind === 'marker');
  // exposure label: the time when known, else the rank among this membrane's exposures (1 = shortest)
  App.expoLabel = rec => {
    if (rec.exposure != null) return rec.exposure >= 60 ? (Math.round(rec.exposure / 6) / 10) + ' min' : (rec.exposure < 1 ? Math.round(rec.exposure * 1000) + ' ms' : (+rec.exposure.toFixed(2)) + ' s');
    // unknown time: the file name (a made-up rank would suggest an order that may not exist —
    // pieces of one membrane are often developed at different times), minus the part all exposures
    // of this membrane share (iBright names often differ only in a counter or a time stamp)
    const stem = n => n.replace(/\.[^.]+$/, '');
    const b = App.S && App.S.blots.find(x => x.images.includes(rec.id));
    const sib = b ? b.images.map(id => App.images.get(id)).filter(r => r && r.kind === 'chemi').map(r => stem(r.name)) : [];
    let s = stem(rec.name);
    if (sib.length > 1) {
      let p = 0; while (sib.every(n => n[p] === s[p]) && p < s.length) p++;
      while (p > 0 && /[0-9a-z]/i.test(s[p - 1])) p--;           // cut at a separator, not inside a number
      let q = 0; while (sib.every(n => n[n.length - 1 - q] === s[s.length - 1 - q]) && q < s.length - p) q++;
      while (q > 0 && /[0-9a-z]/i.test(s[s.length - q])) q--;
      const mid = s.slice(p, s.length - q).replace(/^[\s_\-.]+|[\s_\-.]+$/g, '');
      if (mid) s = mid;
    }
    return s.length > 14 ? s.slice(0, 13) + '…' : s;
  };
  App.blotName = b => b.name || `膜 ${App.S.blots.indexOf(b) + 1}`;

  /* ---------- loading ---------- */
  function resample(img, W, H) {
    const d = new Float32Array(W * H), sx = img.w / W, sy = img.h / H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = WB.bilinear(img, Math.min(img.w - 1, Math.max(0, (x + 0.5) * sx - 0.5)), Math.min(img.h - 1, Math.max(0, (y + 0.5) * sy - 0.5)));
      d[y * W + x] = isNaN(v) ? 0 : v;
    }
    return { w: W, h: H, data: d };
  }
  function thumbOf(rec) {
    const f = Math.max(1, Math.ceil(Math.max(rec.img.w, rec.img.h) / 96));
    if (rec.kind === 'chemi') {
      const d = WB.down({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, f);
      const th = WB.tophat(d.data, d.w, d.h, 6);
      for (let i = 0; i < th.length; i++) th[i] = Math.sqrt(th[i]);
      return { w: d.w, h: d.h, data: th };
    }
    const d = WB.down(rec.img, f), b = WB.blur2d(d.data, d.w, d.h, 1), t = WB.otsu(b, 1), m = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) m[i] = b[i] > t ? 1 : 0;
    return { w: d.w, h: d.h, data: m };
  }
  function prepare(rec) {
    rec.cs = rec.kind === 'chemi' ? WB.chemiSignal(rec.img) : null;
    rec.thumb = thumbOf(rec);
    rec._disp = null;
  }

  App.addFiles = async function (files) {
    files = [...files].filter(f => /\.(tiff?|png|jpe?g|bmp)$/i.test(f.name));
    if (!files.length) return 0;
    const first = !App.S;
    if (first) App.S = newState();
    busy(true, `读取图片 0/${files.length}…`);
    await tick();
    try {
      const recs = [];
      for (const f of files) {
        // {name, buffer} = already-read TIFF bytes (demo / tests)
        const d = f.buffer ? await G.TIFF.decode(f.buffer) : await G.TIFF.loadFile(f);
        recs.push({ id: uid('i'), name: f.name, img: { w: d.width, h: d.height, data: d.data }, spp: d.spp, bits: d.bits });
        busy(true, `读取图片 ${recs.length}/${files.length}…`); await tick();
      }
      busy(true, '识别曝光图与 Marker 图…'); await tick();
      recs.forEach(r => { r.kind = WB.classify(r.img, { name: r.name, spp: r.spp }); r.exposure = WB.exposureFromName(r.name); });
      // a marker photo saved at another resolution: resample to the matching exposure
      const chemiAll = recs.concat([...App.images.values()]).filter(c => c.kind === 'chemi');
      recs.filter(r => r.kind === 'marker').forEach(m => {
        if (chemiAll.some(c => c.img.w === m.img.w && c.img.h === m.img.h)) return;
        const c = chemiAll.find(c => Math.abs(c.img.w / c.img.h - m.img.w / m.img.h) < 0.015 * (c.img.w / c.img.h));
        if (c) { m.img = resample(m.img, c.img.w, c.img.h); m.resampled = true; }
      });
      recs.forEach(r => { prepare(r); App.images.set(r.id, r); });
      // group into membranes
      const groups = WB.groupSessions(recs.map(r => ({ id: r.id, name: r.name, w: r.img.w, h: r.img.h, kind: r.kind, thumb: r.thumb })));
      let blots = groups.map(g => ({ id: uid('b'), name: '', images: g.chemi.map(c => c.id).concat(g.markers.map(m => m.id)), marker: g.markers[0] ? g.markers[0].id : null, ladderId: null, ladderAuto: true, shift: 0 }));
      // stray marker photos join a membrane of the same size that has none
      blots.filter(b => !App.chemiOf(b).length).forEach(mb => {
        const m = App.images.get(mb.images[0]);
        const host = blots.concat(App.S.blots).find(b => b !== mb && App.chemiOf(b).length && !b.marker && App.chemiOf(b)[0].img.w === m.img.w && App.chemiOf(b)[0].img.h === m.img.h);
        if (host) { host.images.push(m.id); host.marker = m.id; mb.images = []; }
      });
      blots = blots.filter(b => b.images.length);
      for (const b of blots) {
        App.S.blots.push(b);
        busy(true, `分析 ${App.blotName(b)}：膜条、条带、泳道、Marker…`); await tick();
        App.analyze(b);
        App.S.rows.push(...App.rowsFromAnalysis(b));
      }
      App.fitLanes(first);
      if (!App.viewBlot || !App.blot(App.viewBlot)) App.viewBlot = App.S.blots[0] && App.S.blots[0].id;
      App.refreshChoices(true);
      App.hist = first ? [] : App.hist;
      App.commit();
      App.emit('loaded');
      return recs.length;
    } catch (e) {
      console.error(e); alert('读取失败：' + e.message);
      return 0;
    } finally { busy(false); }
  };

  /* ---------- analysis ---------- */
  App.analyze = function (blot) {
    const ch = App.chemiOf(blot);
    if (blot.marker && !blot.images.includes(blot.marker)) blot.marker = null;
    if (!blot.marker) { const m = App.markersOf(blot)[0]; blot.marker = m ? m.id : null; }
    const mk = blot.marker ? App.images.get(blot.marker) : null;
    if (!ch.length) { App.analysis[blot.id] = null; return null; }
    const A = WB.analyzeSession(ch.map(r => ({ id: r.id, img: r.img, exposure: r.exposure, cs: r.cs })), mk && { id: mk.id, img: mk.img },
      { ladderId: blot.ladderAuto ? null : blot.ladderId, prefLadder: App.prefLadder });
    A.chemiIds = ch.map(r => r.id);
    A.H = ch[0].img.h;
    App.analysis[blot.id] = A;
    if (blot.ladderAuto || !blot.ladderId) blot.ladderId = A.ladderId;
    A._calLadder = A.ladderId;
    // number lanes from the leftmost one (lanes can sit on both sides of a ladder)
    if (blot.shiftAuto !== false) blot.shift = A.minK - 1;
    // relative exposure factors when file names did not say
    ch.forEach((r, k) => { r.factor = A.factors[k]; });
    return A;
  };
  App.rowsFromAnalysis = function (blot) {
    const A = App.analysis[blot.id];
    if (!A) return [];
    return A.rows.map(r => {
      // very weak rows are offered but start hidden
      const best = r.expo[r.choice], weak = !best || best.snr < 6;
      return {
        id: uid('r'), blot: blot.id, name: '', img: A.chemiIds[r.choice], auto: true, hidden: weak, weak,
        geo: { region: r.region, strip: r.strip, angle: r.angle, ox: r.ox, oy: r.oy, uOrigin: r.uOrigin, pitch: r.pitch, bandH: r.bandH,
          vBand0: r.vBand0, vBand1: r.vBand1, vTop: r.vTop, vBot: r.vBot, stripV: r.stripV, ks: r.ks, pieces: r.pieces }
      };
    });
  };
  // re-run after the user changed which pictures belong to a membrane / their kind; keep names where rows match
  App.reanalyze = function (blot) {
    const old = App.S.rows.filter(r => r.blot === blot.id);
    App.analyze(blot);
    const fresh = App.rowsFromAnalysis(blot);
    fresh.forEach(n => {
      const o = old.find(o => Math.hypot(o.geo.ox - n.geo.ox, o.geo.oy - n.geo.oy) < Math.max(12, n.geo.bandH));
      if (o) { n.name = o.name; n.hidden = o.hidden; n.id = o.id; }
    });
    const at = App.S.rows.findIndex(r => r.blot === blot.id);
    App.S.rows = App.S.rows.filter(r => r.blot !== blot.id);
    App.S.rows.splice(at < 0 ? App.S.rows.length : at, 0, ...fresh);
    App.fitLanes(false);
  };
  App.calibFor = function (blot) {
    const A = App.analysis[blot.id];
    if (!A) return null;
    if (A._calLadder !== blot.ladderId) {
      const lad = G.ProteinLadders.get(blot.ladderId);
      const cal = lad ? WB.calibrate(A.ladderStrips, A.strips, lad.sizes, A.H) : null;
      A.calib = cal && cal.pinned ? cal : null;
      A._calLadder = blot.ladderId;
    }
    return A.calib;
  };
  App.rowKda = function (row) {
    const b = App.blot(row.blot), cal = b && App.calibFor(b), g = row.geo;
    if (!cal || g.strip < 0 || !cal.strips[g.strip]) return null;
    return WB.kdaAt(cal, g.strip, g.stripV + (g.vBand0 + g.vBand1) / 2);
  };

  /* ---------- lanes ---------- */
  App.fitLanes = function (resetRange) {
    const S = App.S;
    let lo = Infinity, hi = -Infinity;
    const cnt = new Map(), vis = S.rows.filter(r => !r.hidden);
    S.rows.forEach(r => { const b = App.blot(r.blot); r.geo.ks.forEach(k => { const j = k - b.shift; if (j >= 1) { lo = Math.min(lo, j); hi = Math.max(hi, j); if (!r.hidden) cnt.set(j, (cnt.get(j) || 0) + 1); } }); });
    if (!isFinite(lo)) { lo = 1; hi = Math.max(1, S.lanes.length); }
    // default range: drop edge lanes that only one or two rows claim (stray detections)
    let a = lo, b2 = hi;
    const need = Math.max(1, vis.length * 0.4);
    if (vis.length >= 3) { while (a < b2 && (cnt.get(a) || 0) < need) a++; while (b2 > a && (cnt.get(b2) || 0) < need) b2--; }
    while (S.lanes.length < hi) S.lanes.push({ name: '', hidden: false });
    // ladder lanes inside the figure: labelled M and left out by default (a white gap marks the splice)
    S.blots.forEach(b => {
      const A = App.analysis[b.id];
      if (!A || !A.ladderKs) return;
      A.ladderKs.forEach(k => {
        const j = k - b.shift;
        if (j < 1 || j > S.lanes.length) return;
        const l = S.lanes[j - 1];
        if (!l.touched && !l.ladder) { l.ladder = true; l.name = l.name || 'M'; l.hidden = true; }
      });
    });
    S.conditions.forEach(c => { while (c.values.length < S.lanes.length) c.values.push(''); });
    if (resetRange || S.range[1] > S.lanes.length) S.range = [a, b2];
  };
  App.figLanes = () => { const out = []; for (let j = App.S.range[0]; j <= App.S.range[1]; j++) if (App.S.lanes[j - 1] && !App.S.lanes[j - 1].hidden) out.push(j); return out; };
  App.segments = function () {
    const S = App.S, segs = []; let cur = null;
    for (let j = S.range[0]; j <= S.range[1]; j++) {
      if (S.lanes[j - 1].hidden) { cur = null; continue; }
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(j);
    }
    return segs;
  };
  App.ensureLane = j => { while (App.S.lanes.length < j) App.S.lanes.push({ name: '', hidden: false }); };

  /* ---------- rows: geometry, exposures, levels ---------- */
  App.rowGeoFull = function (row, j0, j1) {
    const b = App.blot(row.blot), g = row.geo;
    j0 = j0 == null ? App.S.range[0] : j0; j1 = j1 == null ? App.S.range[1] : j1;
    const laneUs = [];
    for (let j = j0; j <= j1; j++) laneUs.push(g.uOrigin + (j + b.shift) * g.pitch);
    return Object.assign({}, g, { laneUs });
  };
  const expoCache = new Map();
  App.rowExpo = function (row) {
    const b = App.blot(row.blot), ch = App.chemiOf(b);
    const key = row.id + JSON.stringify(row.geo) + App.S.range + b.shift + ch.map(c => c.id);
    if (expoCache.has(key)) return expoCache.get(key);
    const gf = App.rowGeoFull(row);
    const res = ch.map(c => Object.assign(WB.evalExposure(c.img, c.cs, gf, c.factor || 1), { id: c.id }));
    if (expoCache.size > 400) expoCache.clear();
    expoCache.set(key, res);
    return res;
  };
  App.refreshChoices = function (forceLevels) {
    const S = App.S;
    S.rows.forEach(r => {
      const ex = App.rowExpo(r);
      if (!ex.length) return;
      if (r.auto || !ex.some(e => e.id === r.img)) r.img = ex[WB.chooseExposure(ex)].id;
    });
    // display levels: one setting per image, from the rows that use it (whole-image, linear)
    const used = new Map();
    S.rows.forEach(r => { if (!r.hidden) { const e = App.rowExpo(r).find(x => x.id === r.img); if (e) { if (!used.has(r.img)) used.set(r.img, []); used.get(r.img).push(e); } } });
    App.images.forEach((rec, id) => {
      if (rec.kind !== 'chemi') return;
      const cur = S.levels[id];
      if (cur && cur.manual && !forceLevels) return;
      const es = used.get(id);
      let black, white;
      if (es && es.length) {
        const bg = Math.min(...es.map(e => e.bgMed));
        white = Math.max(...es.map(e => e.peak)) * 1.05;
        if (rec.cs.clip !== Infinity) white = Math.min(white, rec.cs.clip);
        // never stretch so far that noise dominates: noise sigma stays below ~3% of the range,
        // and display-scaled 8-bit exports are not stretched more than ~6x
        const noise = Math.max(...es.map(e => e.bgSig));
        white = Math.max(white, bg + 0.005, bg + noise * 30, rec.bits <= 8 ? bg + 0.16 : 0);
        black = Math.max(0, (bg - 0.06 * white) / 0.94);
      } else {
        const [p50, p999] = G.Engine.percentiles(rec.cs.sig, [50, 99.95], 7);
        black = p50; white = Math.max(p999, p50 + 0.01);
      }
      S.levels[id] = { black, white, manual: false };
    });
  };
  App.levelsOf = id => App.S.levels[id] || { black: 0, white: 1 };

  /* grey value for display: dark bands on light background when style.invert */
  App.mapper = function (id) {
    const lv = App.levelsOf(id), inv = App.S.style.invert, sc = 1 / Math.max(1e-6, lv.white - lv.black);
    return v => { let t = (v - lv.black) * sc; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.round((inv ? 1 - t : t) * 255); };
  };

  // straightened crop of a row for lanes j0..j1, rendered to a canvas
  const rasterCache = new Map();
  App.rowRaster = function (row, j0, j1, step) {
    const rec = App.images.get(row.img), b = App.blot(row.blot), g = row.geo, lv = App.levelsOf(row.img);
    const key = [row.img, lv.black, lv.white, App.S.style.invert, JSON.stringify(g), b.shift, j0, j1, step.toFixed(3)].join('|');
    if (rasterCache.has(key)) return rasterCache.get(key);
    const F = WB.frame(g.ox, g.oy, g.angle);
    const u0 = g.uOrigin + (j0 + b.shift - 0.5) * g.pitch, u1 = g.uOrigin + (j1 + b.shift + 0.5) * g.pitch;
    const win = WB.sampleWindow({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, F, u0, u1, g.vTop, g.vBot, step);
    const cv = document.createElement('canvas'); cv.width = win.w; cv.height = win.h;
    const ctx = cv.getContext('2d'), id = ctx.createImageData(win.w, win.h), map = App.mapper(row.img);
    // outside this row's own pieces (gaps, neighbouring pieces): plain background
    const pieces = (g.pieces || []).map(p => ({ p, Fp: WB.frame(p.cx, p.cy, p.angle) }));
    const bgV = map(App.levelsOf(row.img).black);
    for (let j = 0; j < win.h; j++) for (let i = 0; i < win.w; i++) {
      const k = j * win.w + i;
      let v = map(win.data[k]);
      if (pieces.length) {
        const [x, y] = WB.toImg(F, u0 + (i + 0.5) * step, g.vTop + (j + 0.5) * step);
        const inside = pieces.some(({ p, Fp }) => { const [u, vv] = WB.toFrame(Fp, x, y); return Math.abs(u) <= p.w / 2 + 1 && Math.abs(vv) <= p.h / 2 + 1; });
        if (!inside) v = bgV;
      }
      id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = v; id.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    const out = { href: cv.toDataURL('image/png'), w: win.w, h: win.h };
    if (rasterCache.size > 200) rasterCache.clear();
    rasterCache.set(key, out);
    return out;
  };

  /* ---------- best exposure per row ---------- */
  App.bestExpo = row => { const ex = App.rowExpo(row); return ex.length ? ex[WB.chooseExposure(ex)].id : null; };
  // what an exposure looks like for one row: 'sat' clipped band pixels, 'weak' barely above noise,
  // 'faint' visible but few grey levels (noisy once stretched), 'ok'
  App.expoVerdict = e => (!e ? 'weak' : e.satFrac > 0.002 ? 'sat' : e.snr < 6 ? 'weak' : WB.isCleanExposure(e) ? 'ok' : 'faint');
  // the row's exposures from weakest to strongest band signal
  App.expoOrder = row => App.rowExpo(row).slice().sort((a, b) => (a.peak - a.bgMed + a.satFrac) - (b.peak - b.bgMed + b.satFrac));
  // the row as it would look in the figure with one exposure (levels from this row alone); clipped pixels red
  const thumbCache = new Map();
  App.rowThumb = function (row, imgId, maxW) {
    const rec = App.images.get(imgId), b = App.blot(row.blot), e = App.rowExpo(row).find(x => x.id === imgId);
    if (!rec || !e) return null;
    const gf = App.rowGeoFull(row), inv = App.S.style.invert;
    const key = [row.id, imgId, JSON.stringify(row.geo), App.S.range, b.shift, inv, maxW].join('|');
    if (thumbCache.has(key)) return thumbCache.get(key);
    const u0 = Math.min(...gf.laneUs) - gf.pitch / 2, u1 = Math.max(...gf.laneUs) + gf.pitch / 2;
    const step = Math.max(1, (u1 - u0) / maxW), F = WB.frame(gf.ox, gf.oy, gf.angle);
    const win = WB.sampleWindow({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, F, u0, u1, gf.vTop, gf.vBot, step);
    let white = e.peak * 1.05;
    if (rec.cs.clip !== Infinity) white = Math.min(white, rec.cs.clip);
    white = Math.max(white, e.bgMed + 0.005, e.bgMed + e.bgSig * 30, rec.bits <= 8 ? e.bgMed + 0.16 : 0);
    const black = Math.max(0, (e.bgMed - 0.06 * white) / 0.94), sc = 1 / Math.max(1e-6, white - black);
    const cv = document.createElement('canvas'); cv.width = win.w; cv.height = win.h;
    const ctx = cv.getContext('2d'), id = ctx.createImageData(win.w, win.h), clip = rec.cs.clip;
    for (let k = 0; k < win.w * win.h; k++) {
      const s = isNaN(win.data[k]) ? e.bgMed : win.data[k];
      if (clip !== Infinity && s >= clip - 1e-6) { id.data[k * 4] = 229; id.data[k * 4 + 1] = 72; id.data[k * 4 + 2] = 77; }
      else { let t = (s - black) * sc; t = t < 0 ? 0 : t > 1 ? 1 : t; id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = Math.round((inv ? 1 - t : t) * 255); }
      id.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    const out = { href: cv.toDataURL('image/png'), w: win.w, h: win.h };
    if (thumbCache.size > 300) thumbCache.clear();
    thumbCache.set(key, out);
    return out;
  };

  /* ---------- adding rows by hand ---------- */
  function regionAt(A, x, y) {
    let best = null, bd = Infinity;
    A.regions.forEach((rg, i) => {
      const F = WB.frame(rg.cx * A.f, rg.cy * A.f, rg.angle), [u, v] = WB.toFrame(F, x, y);
      const d = Math.max(0, Math.abs(u) - rg.w * A.f / 2) + Math.max(0, Math.abs(v) - rg.h * A.f / 2);
      if (d < bd) { bd = d; best = { rg, i, F, u, v }; }
    });
    return best;
  }
  App.addRowAt = function (blotId, x, y) {
    const b = App.blot(blotId), A = App.analysis[blotId];
    if (!A) return null;
    const hit = regionAt(A, x, y);
    if (!hit) return null;
    const { rg, i, F, v } = hit;
    const peers = App.S.rows.filter(r => r.blot === blotId);
    const same = peers.filter(r => r.geo.region === i);
    const med = (arr, f) => { const s = arr.map(f).sort((a, c) => a - c); return s.length ? s[s.length >> 1] : null; };
    const pitch = med(peers, r => r.geo.pitch) || A.pitch;
    const uOrigin = med(same.length ? same : peers, r => r.geo.uOrigin);
    const bandH = med(peers, r => r.geo.bandH) || 16;
    const [ox, oy] = WB.toImg(F, 0, v);
    const margin = Math.min(100, Math.max(16, bandH * 2.5));
    const halfH = rg.h * A.f / 2;
    const geo = { region: i, strip: rg.strip, angle: rg.angle, ox, oy, uOrigin: uOrigin != null ? uOrigin : -rg.w * A.f / 2, pitch, bandH,
      vBand0: -bandH / 2, vBand1: bandH / 2, vTop: Math.max(-bandH / 2 - margin, -halfH - v + 2), vBot: Math.min(bandH / 2 + margin, halfH - v - 2), stripV: v,
      ks: same.length ? same[0].geo.ks.slice() : (peers[0] ? peers[0].geo.ks.slice() : []) };
    const row = { id: uid('r'), blot: blotId, name: '', img: App.chemiOf(b)[0].id, auto: true, hidden: false, geo, manual: true };
    // place it among the rows of the same membrane by position
    let at = App.S.rows.length;
    for (let k = 0; k < App.S.rows.length; k++) { const r = App.S.rows[k]; if (r.blot === blotId && (r.geo.region > i || (r.geo.region === i && r.geo.stripV > v))) { at = k; break; } }
    if (at === App.S.rows.length) { const last = App.S.rows.map(r => r.blot).lastIndexOf(blotId); if (last >= 0) at = last + 1; }
    App.S.rows.splice(at, 0, row);
    return row;
  };
  // place a row where a given molecular weight runs (on a membrane that covers it)
  App.addRowAtKda = function (kda, prefBlot) {
    const order = App.S.blots.slice().sort((a, c) => (a.id === prefBlot ? -1 : c.id === prefBlot ? 1 : 0));
    for (const b of order) {
      const cal = App.calibFor(b), A = App.analysis[b.id];
      if (!cal || !A) continue;
      for (let s = 0; s < A.strips.length; s++) {
        if (!cal.strips[s]) continue;
        const v = WB.vAt(cal, s, kda), st = A.strips[s];
        if (Math.abs(v) > st.h / 2 - 8) continue;
        const [x, y] = WB.toImg(WB.stripFrame(st), 0, v);
        return App.addRowAt(b.id, x, y);
      }
    }
    return null;
  };
  App.moveRowV = function (row, dv) {
    const g = row.geo, a = g.angle * Math.PI / 180;
    g.ox += -Math.sin(a) * dv; g.oy += Math.cos(a) * dv; g.stripV += dv;
  };

  /* ---------- membranes: moving pictures between them ---------- */
  App.moveImage = function (imgId, toBlotId) {
    const S = App.S, from = S.blots.find(b => b.images.includes(imgId));
    let to = toBlotId === 'new' ? null : App.blot(toBlotId);
    if (!to) { to = { id: uid('b'), name: '', images: [], marker: null, ladderId: null, ladderAuto: true, shift: 0 }; S.blots.push(to); }
    if (from === to) return;
    if (from) { from.images = from.images.filter(i => i !== imgId); if (from.marker === imgId) from.marker = null; }
    to.images.push(imgId);
    [from, to].forEach(b => { if (b) App.reanalyze(b); });
    if (from && !from.images.length) { S.blots = S.blots.filter(b => b !== from); S.rows = S.rows.filter(r => r.blot !== from.id); }
  };
  App.setKind = function (imgId, kind) {
    const rec = App.images.get(imgId);
    if (!rec || rec.kind === kind) return;
    rec.kind = kind; prepare(rec);
    const b = App.S.blots.find(b => b.images.includes(imgId));
    if (b) { if (kind === 'marker' && !b.marker) b.marker = imgId; App.reanalyze(b); }
  };
  App.setExposure = function (imgId, sec) {
    const rec = App.images.get(imgId); if (!rec) return;
    rec.exposure = sec > 0 ? sec : null;
    const b = App.S.blots.find(b => b.images.includes(imgId));
    if (b) { const ch = App.chemiOf(b); if (ch.every(c => c.exposure)) { const mx = Math.max(...ch.map(c => c.exposure)); ch.forEach(c => { c.factor = c.exposure / mx; }); } }
    expoCache.clear();
  };
  App.removeImage = function (imgId) {
    const S = App.S, b = S.blots.find(b => b.images.includes(imgId));
    App.images.delete(imgId);
    delete S.levels[imgId];
    if (!b) return;
    b.images = b.images.filter(i => i !== imgId);
    if (b.marker === imgId) b.marker = null;
    if (!b.images.length) { S.blots = S.blots.filter(x => x !== b); S.rows = S.rows.filter(r => r.blot !== b.id); }
    else App.reanalyze(b);
  };

  /* ---------- checks shown as warnings / legend text ---------- */
  App.isLoading = row => G.ProteinLadders.LOADING_RE.test(row.name || '');
  App.checks = function () {
    const S = App.S, warn = [], legend = [];
    const vis = S.rows.filter(r => !r.hidden);
    const label = r => r.name || `≈${Math.round(App.rowKda(r) || 0) || '?'} kDa 行`;
    vis.forEach(r => {
      const e = App.rowExpo(r).find(x => x.id === r.img);
      if (e && e.satFrac > 0.002) warn.push(`「${label(r)}」所选曝光中条带有过曝像素，定量不可靠，建议换短曝光`);
    });
    const blotsUsed = [...new Set(vis.map(r => r.blot))];
    if (blotsUsed.length > 1) {
      legend.push('Bands shown in separate rows were detected on different membranes processed in parallel; each row is an individual crop.');
      const loadBlots = new Set(vis.filter(App.isLoading).map(r => r.blot));
      if (loadBlots.size) blotsUsed.forEach(bid => {
        if (!loadBlots.has(bid) && vis.some(r => r.blot === bid)) warn.push(`${App.blotName(App.blot(bid))}上的蛋白没有同膜内参（期刊要求内参与目标蛋白在同一张膜上）`);
      });
      const pitches = blotsUsed.map(bid => { const rs = vis.filter(r => r.blot === bid); return rs[0].geo.pitch; });
      if (Math.max(...pitches) / Math.min(...pitches) > 1.08) warn.push('不同膜的泳道间距差异较大（可能用了不同梳子或成像倍率），已等比缩放对齐，请确认泳道一一对应');
    }
    blotsUsed.forEach(bid => {
      const b = App.blot(bid);
      if (S.style.showMW && !App.calibFor(b)) warn.push(b.marker ? `${App.blotName(b)}的 Marker 图无法确定分子量，未标注 kDa` : `${App.blotName(b)}没有 Marker 图，无法标注分子量`);
    });
    if (App.segments().length > 1) legend.push('Non-adjacent lanes from the same membranes are separated by white space.');
    if (S.style.invert) legend.push('Chemiluminescence images are shown inverted (dark bands on a light background) with linear whole-image contrast.');
    const lads = [...new Set(blotsUsed.map(bid => App.blot(bid).ladderId).filter(Boolean))].map(id => G.ProteinLadders.get(id)).filter(Boolean);
    if (lads.length) legend.push(`Molecular weights (kDa) from ${lads.map(l => l.name.replace(/\s*\(.*\)|\*/g, '')).join(' / ')}.`);
    const ex = [...new Set(vis.map(r => App.images.get(r.img)).filter(Boolean).map(rec => App.expoLabel(rec)))];
    if (ex.length) legend.push(`Exposure: ${vis.map(r => `${r.name || '?'} ${App.expoLabel(App.images.get(r.img))}`).join('; ')}.`);
    return { warn, legend };
  };

  G.BApp = App;
  G.BApp.MM = MM;
})(window);
