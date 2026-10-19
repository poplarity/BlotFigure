/* BlotFigure application state.
 * images (not undoable): decoded pictures with kind (chemi | marker), exposure and signal.
 * S (undoable): membranes ("blots") with their pieces, figure rows (one per protein), figure lanes
 * (columns), levels, annotations.
 * Pieces are often not put back where they were on the membrane, so each piece has its own lanes:
 * slot m at u = u0 + m*pitch in the piece frame, role sample | ladder | skip; the sample slots fill figure
 * columns col0, col0+1, … in order. A row has a segment on each piece it runs across (band centre vc in
 * that piece's frame, band b0..b1 around it); every segment is cropped vc-above … vc+below.
 * pc.marks (marker bands set by hand, {u, v, kda}) replace the automatic ladder calibration of a piece.
 */
(function (G) {
  'use strict';
  const WB = G.WB;
  const MM = 72 / 25.4;
  let uidN = 1;
  const uid = p => p + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);
  const tick = () => new Promise(r => setTimeout(r, 16));

  const App = { images: new Map(), analysis: {}, S: null, hist: [], future: [], listeners: [], selRow: null, selPiece: null, viewBlot: null, viewImg: null, mode: null };
  try { App.prefLadder = localStorage.getItem('blotfig.ladder') || null; } catch (e) { App.prefLadder = null; }

  const defaultStyle = () => ({ mmPerLane: 5, fontPt: 7, lineWidthPt: 0.5, labelAngle: 'auto', rowGapPt: 2, blotGapPt: 5,
    tickLenPt: 2.5, labelGapPt: 2.5, unitHeader: true, showMW: true, panelLetter: '', dpi: 600, invert: true, border: false });
  const newState = () => ({ blots: [], rows: [], lanes: [], range: [1, 1], hiCol: 0, levels: {}, conditions: [], groups: [], style: defaultStyle() });

  /* ---------- events / undo ---------- */
  App.on = fn => App.listeners.push(fn);
  App.emit = what => App.listeners.forEach(fn => fn(what));
  let raf = 0;
  App.refresh = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; App.emit('refresh'); }); };
  App.commit = function () {
    if (!App.S) return;
    App.fitLanes(false);
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
  App.piece = (b, id) => (b && b.pieces ? b.pieces.find(p => p.id === id) : null);
  App.findPiece = id => { for (const b of App.S.blots) { const p = App.piece(b, id); if (p) return { b, pc: p }; } return null; };
  // shortest first: by exposure time when known, else by the estimated relative exposure
  App.chemiOf = blot => blot.images.map(id => App.images.get(id)).filter(r => r && r.kind === 'chemi')
    .sort((a, b) => (a.exposure != null && b.exposure != null ? a.exposure - b.exposure : (a.factor || 0) - (b.factor || 0)));
  App.markersOf = blot => blot.images.map(id => App.images.get(id)).filter(r => r && r.kind === 'marker');
  // exposure label: the time when known, else the part of the file name that differs between exposures
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
  App.pieceName = (b, pc) => (App.S.blots.length > 1 ? App.blotName(b) + ' · ' : '') + '膜条 ' + (pc.letter || '?');

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
      let blots = groups.map(g => ({ id: uid('b'), name: '', images: g.chemi.map(c => c.id).concat(g.markers.map(m => m.id)), marker: g.markers[0] ? g.markers[0].id : null, ladderId: null, ladderAuto: true, pieces: [] }));
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
    if (!ch.length) { App.analysis[blot.id] = null; blot.pieces = []; return null; }
    const A = WB.analyzeSession(ch.map(r => ({ id: r.id, img: r.img, exposure: r.exposure, cs: r.cs })), mk && { id: mk.id, img: mk.img },
      { ladderId: blot.ladderAuto ? null : blot.ladderId, prefLadder: App.prefLadder });
    A.chemiIds = ch.map(r => r.id);
    A.H = ch[0].img.h;
    App.analysis[blot.id] = A;
    if (blot.ladderAuto || !blot.ladderId) blot.ladderId = A.ladderId;
    A._calLadder = A.ladderId;
    // pieces, in analysis order; a piece found again at the same place keeps the user's marks and lane edits
    const old = blot.pieces || [];
    const fresh = A.pieces.map(p => Object.assign({ id: uid('p'), marks: null, edited: false }, JSON.parse(JSON.stringify(p))));
    fresh.forEach(n => {
      const o = old.find(o => Math.hypot(o.cx - n.cx, o.cy - n.cy) < 40 && Math.abs(o.w - n.w) < 60);
      if (!o) return;
      n.id = o.id; n.marks = o.marks;
      if (o.edited) Object.assign(n, { u0: o.u0, pitch: o.pitch, roles: o.roles.slice(), col0: o.col0, edited: true });
    });
    // letters in reading order: top to bottom, left to right within a band
    const top = p => p.cy - p.h / 2;
    fresh.map((p, i) => i).sort((i, k) => (Math.abs(top(fresh[i]) - top(fresh[k])) < 60 ? fresh[i].cx - fresh[k].cx : top(fresh[i]) - top(fresh[k])))
      .forEach((i, n) => { fresh[i].letter = String.fromCharCode(65 + (n % 26)); });
    blot.pieces = fresh;
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
        segs: r.segs.map(sg => ({ piece: blot.pieces[sg.region].id, vc: sg.vc, b0: sg.b0, b1: sg.b1, ms: sg.ms.slice() })),
        above: r.above, below: r.below
      };
    });
  };
  // re-run after the user changed which pictures belong to a membrane / their kind; keep names where rows match
  App.reanalyze = function (blot) {
    const old = App.S.rows.filter(r => r.blot === blot.id);
    App.analyze(blot);
    const fresh = App.rowsFromAnalysis(blot);
    fresh.forEach(n => {
      const o = old.find(o => o.segs.some(s => n.segs.some(t => t.piece === s.piece && Math.abs(t.vc - s.vc) < Math.max(12, t.b1 - t.b0))));
      if (o) { n.name = o.name; n.hidden = o.hidden; n.id = o.id; }
    });
    const at = App.S.rows.findIndex(r => r.blot === blot.id);
    App.S.rows = App.S.rows.filter(r => r.blot !== blot.id);
    App.S.rows.splice(at < 0 ? App.S.rows.length : at, 0, ...fresh);
    App.fitLanes(false);
  };
  // automatic ladder calibration of a membrane (all its pieces)
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
  /* size <-> position on one piece: the marks set by hand when there are any, else the automatic
   * calibration. {manual, c, knots: [{v, lk}]} for WB.kdaAtK / WB.vAtK */
  App.pieceCal = function (b, pc) {
    if (!pc) return null;
    if (pc.marks && pc.marks.length) {
      const K = pc.marks.filter(m => m.kda > 0).map(m => ({ v: m.v, lk: Math.log(m.kda) })).sort((a, c) => a.v - c.v);
      let c = null;
      if (K.length >= 2) {
        const ml = K.reduce((s, k) => s + k.lk, 0) / K.length, mv = K.reduce((s, k) => s + k.v, 0) / K.length;
        let num = 0, den = 0; K.forEach(k => { num += (k.lk - ml) * (k.v - mv); den += (k.lk - ml) ** 2; });
        c = den ? num / den : null;
      }
      if (!(c < 0)) { const ac = App.calibFor(b); c = ac && ac.c < 0 ? ac.c : null; }
      return { manual: true, c, knots: K };
    }
    const cal = App.calibFor(b), cs = cal && pc.strip >= 0 ? cal.strips[pc.strip] : null;
    return cs ? { manual: false, c: cal.c, a: cs.a, knots: cs.knots || [], bands: cs.bands || [] } : null;
  };
  // kDa ticks a piece can show: the hand-set marks, or every ladder size of the automatic calibration
  App.pieceTicks = function (b, pc) {
    const pcal = App.pieceCal(b, pc); if (!pcal) return [];
    if (pcal.manual) return pc.marks.filter(m => m.kda > 0).map(m => ({ v: m.v, k: m.kda }));
    const lad = G.ProteinLadders.get(b.ladderId); if (!lad) return [];
    return lad.sizes.map(k => ({ v: WB.vAtK(pcal, k), k })).filter(t => t.v != null && Math.abs(t.v) <= pc.h / 2);
  };
  App.rowKda = function (row) {
    const b = App.blot(row.blot); if (!b) return null;
    for (const sg of row.segs) {
      const pcal = App.pieceCal(b, App.piece(b, sg.piece));
      const k = pcal && WB.kdaAtK(pcal, sg.vc + (sg.b0 + sg.b1) / 2);
      if (k) return k;
    }
    return null;
  };

  /* ---------- lanes: per piece, into figure columns ---------- */
  App.nSample = pc => pc.roles.filter(r => r === 'sample').length;
  App.slots = pc => { let c = pc.col0; return pc.roles.map((role, m) => ({ m, role, u: pc.u0 + m * pc.pitch, col: role === 'sample' ? c++ : null })); };
  // where figure column j of a row comes from: {sg, pc, m, u} or null (no lane of the row's pieces there)
  App.colSource = function (row, j) {
    const b = App.blot(row.blot);
    for (const sg of row.segs) {
      const pc = App.piece(b, sg.piece); if (!pc) continue;
      const s = App.slots(pc).find(x => x.col === j);
      if (s) return { sg, pc, m: s.m, u: s.u };
    }
    return null;
  };
  // columns of a row that two of its pieces both claim (the pieces need shifting apart)
  App.rowClash = function (row) {
    const b = App.blot(row.blot), seen = new Map(), clash = [];
    row.segs.forEach(sg => { const pc = App.piece(b, sg.piece); if (pc) App.slots(pc).forEach(s => { if (s.col == null) return; if (seen.has(s.col) && seen.get(s.col) !== pc) clash.push(s.col); seen.set(s.col, pc); }); });
    return clash;
  };
  App.fitLanes = function (resetRange) {
    const S = App.S;
    let hi = 0;
    S.blots.forEach(b => (b.pieces || []).forEach(pc => { const n = App.nSample(pc); if (n) hi = Math.max(hi, pc.col0 + n - 1); }));
    hi = Math.max(hi, 1);
    while (S.lanes.length < hi) S.lanes.push({ name: '', hidden: false });
    S.conditions.forEach(c => { while (c.values.length < S.lanes.length) c.values.push(''); });
    // default range: drop edge columns where few rows show a band (stray detections at a piece's end)
    const vis = S.rows.filter(r => !r.hidden), cnt = new Map();
    vis.forEach(r => {
      const b = App.blot(r.blot), seen = new Set();
      r.segs.forEach(sg => { const pc = App.piece(b, sg.piece); if (!pc) return; const sl = App.slots(pc); (sg.ms || []).forEach(m => { if (sl[m] && sl[m].col) seen.add(sl[m].col); }); });
      seen.forEach(c => cnt.set(c, (cnt.get(c) || 0) + 1));
    });
    let a = 1, z = hi;
    const need = Math.max(1, vis.length * 0.4);
    if (vis.length >= 3) { while (a < z && (cnt.get(a) || 0) < need) a++; while (z > a && (cnt.get(z) || 0) < need) z--; }
    if (resetRange || !S.range || S.range[0] > hi) S.range = [a, z];
    else if (S.hiCol && S.range[1] === S.hiCol && hi !== S.hiCol) S.range[1] = hi;   // the range ran to the last column: keep it so
    S.hiCol = hi;
  };
  App.figLanes = () => { const out = []; for (let j = App.S.range[0]; j <= App.S.range[1]; j++) if (App.S.lanes[j - 1] && !App.S.lanes[j - 1].hidden) out.push(j); return out; };
  /* Figure columns shown, the source of every row in every column, and where a white gap separates
   * columns: wherever neighbouring columns are not neighbouring lanes of one piece in some row. */
  App.columns = function () {
    const S = App.S, vis = App.figLanes(), rows = S.rows.filter(r => !r.hidden && App.blot(r.blot));
    const src = rows.map(r => vis.map(j => App.colSource(r, j)));
    const gapAfter = new Set();
    for (let k = 0; k + 1 < vis.length; k++) {
      if (vis[k + 1] !== vis[k] + 1) { gapAfter.add(k); continue; }
      if (src.some(rs => { const a = rs[k], c = rs[k + 1]; return a && c && (a.pc !== c.pc || c.m !== a.m + 1); })) gapAfter.add(k);
    }
    const segs = []; let cur = null;
    vis.forEach((j, k) => { if (!cur) { cur = []; segs.push(cur); } cur.push(j); if (gapAfter.has(k)) cur = null; });
    return { vis, rows, src, gapAfter, segs };
  };
  App.segments = () => App.columns().segs;
  App.ensureLane = j => { while (App.S.lanes.length < j) App.S.lanes.push({ name: '', hidden: false }); };

  /* Lane edits on one piece (every row on the piece follows: the lanes belong to the piece). Pieces that
   * continue its columns side by side (sharing a row, starting right after it) keep following it. */
  function followerOf(pc) {
    const ids = new Set(App.S.rows.filter(r => r.segs.some(s => s.piece === pc.id)).flatMap(r => r.segs.map(s => s.piece)));
    ids.delete(pc.id);
    for (const id of ids) { const f = App.findPiece(id); if (f && f.pc.cx > pc.cx && sideBySide(pc, f.pc) && f.pc.col0 === pc.col0 + App.nSample(pc)) return f.pc; }
    return null;
  }
  function editPiece(pc, fn) {
    const chain = [];
    for (let q = followerOf(pc); q && !chain.includes(q) && q !== pc; q = followerOf(q)) chain.push(q);
    fn();
    let prev = pc;
    chain.forEach(q => { q.col0 = prev.col0 + App.nSample(prev); q.edited = true; prev = q; });
    pc.edited = true;
  }
  App.setRole = (pc, m, role) => editPiece(pc, () => { pc.roles[m] = role; });
  App.cycleRole = (pc, m) => App.setRole(pc, m, { sample: 'skip', skip: 'ladder', ladder: 'sample' }[pc.roles[m]] || 'sample');
  App.shiftPiece = (pc, d) => editPiece(pc, () => { pc.col0 = Math.max(1, pc.col0 + d); });
  App.nudgePiece = (pc, du) => { pc.u0 += du; pc.edited = true; };
  App.scalePitch = function (pc, dp) {
    const n = pc.roles.length, mid = pc.u0 + (n - 1) / 2 * pc.pitch;
    pc.pitch = Math.max(8, pc.pitch + dp); pc.u0 = mid - (n - 1) / 2 * pc.pitch; pc.edited = true;
  };
  App.extendPiece = (pc, side) => editPiece(pc, () => {
    if (side < 0) {
      pc.roles.unshift('sample'); pc.u0 -= pc.pitch;
      if (pc.col0 > 1) pc.col0--;          // the lanes already there keep their columns
      App.S.rows.forEach(r => r.segs.forEach(sg => { if (sg.piece === pc.id && sg.ms) sg.ms = sg.ms.map(m => m + 1); }));
    } else pc.roles.push('sample');
  });
  App.dropEnd = (pc, side) => editPiece(pc, () => {
    if (pc.roles.length < 2) return;
    if (side < 0) {
      const wasSample = pc.roles[0] === 'sample';
      pc.roles.shift(); pc.u0 += pc.pitch; if (wasSample) pc.col0++;
      App.S.rows.forEach(r => r.segs.forEach(sg => { if (sg.piece === pc.id && sg.ms) sg.ms = sg.ms.map(m => m - 1).filter(m => m >= 0); }));
    } else pc.roles.pop();
  });
  App.resetPiece = function (b, pc) {
    const A = App.analysis[b.id], d = A && A.pieces[b.pieces.indexOf(pc)];
    if (d) Object.assign(pc, { u0: d.u0, pitch: d.pitch, roles: d.roles.slice(), col0: d.col0, edited: false });
  };

  /* ---------- rows: geometry, exposures, levels ---------- */
  App.rowPieces = row => { const b = App.blot(row.blot); return row.segs.map(sg => App.piece(b, sg.piece)).filter(Boolean); };
  App.rowPitch = row => { const ps = App.rowPieces(row); return ps.length ? ps.reduce((s, p) => s + p.pitch, 0) / ps.length : 100; };
  // image position of a row (band centre on its first piece)
  App.rowXY = row => { const b = App.blot(row.blot), sg = row.segs[0], pc = sg && App.piece(b, sg.piece); return pc ? WB.toImg(WB.frame(pc.cx, pc.cy, pc.angle), 0, sg.vc) : [0, 0]; };
  // the windows of a row on its pieces, over the lanes shown in the figure (all lanes if none is shown)
  App.rowParts = function (row, all) {
    const b = App.blot(row.blot), vis = new Set(App.figLanes()), parts = [];
    row.segs.forEach(sg => {
      const pc = App.piece(b, sg.piece); if (!pc) return;
      const ms = App.slots(pc).filter(s => s.col != null && (all || vis.has(s.col))).map(s => s.m);
      if (!ms.length) return;
      parts.push({ F: WB.frame(pc.cx, pc.cy, pc.angle), u0: pc.u0 + (Math.min(...ms) - 0.5) * pc.pitch, u1: pc.u0 + (Math.max(...ms) + 0.5) * pc.pitch,
        vTop: sg.vc - row.above, vBot: sg.vc + row.below, b0: sg.vc + sg.b0, b1: sg.vc + sg.b1, sg, pc });
    });
    return parts.length || all ? parts : App.rowParts(row, true);
  };
  const expoCache = new Map();
  App.rowExpo = function (row) {
    const b = App.blot(row.blot); if (!b) return [];
    const ch = App.chemiOf(b);
    const key = row.id + JSON.stringify([row.segs, row.above, row.below, App.rowPieces(row).map(p => [p.u0, p.pitch, p.roles, p.col0]), App.S.range, App.figLanes()]) + ch.map(c => c.id);
    if (expoCache.has(key)) return expoCache.get(key);
    const parts = App.rowParts(row);
    const res = parts.length ? ch.map(c => Object.assign(WB.evalExposure(c.img, c.cs, parts, c.factor || 1), { id: c.id })) : [];
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
        // never stretch so far that noise dominates: pixel noise stays below ~3% of the range,
        // and display-scaled 8-bit exports are not stretched more than ~6x
        const noise = Math.max(...es.map(e => (e.noise != null ? e.noise : e.bgSig)));
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

  // straightened crop of lanes mA..mB of one piece for a row, rendered to a canvas
  const rasterCache = new Map();
  App.runRaster = function (row, sg, pc, mA, mB, step) {
    const rec = App.images.get(row.img), lv = App.levelsOf(row.img);
    const key = [row.img, lv.black, lv.white, App.S.style.invert, pc.cx, pc.cy, pc.angle, pc.w, pc.h, pc.u0, pc.pitch, sg.vc, row.above, row.below, mA, mB, step.toFixed(3)].join('|');
    if (rasterCache.has(key)) return rasterCache.get(key);
    const F = WB.frame(pc.cx, pc.cy, pc.angle);
    const u0 = pc.u0 + (mA - 0.5) * pc.pitch, u1 = pc.u0 + (mB + 0.5) * pc.pitch, v0 = sg.vc - row.above, v1 = sg.vc + row.below;
    const win = WB.sampleWindow({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, F, u0, u1, v0, v1, step);
    const cv = document.createElement('canvas'); cv.width = win.w; cv.height = win.h;
    const ctx = cv.getContext('2d'), id = ctx.createImageData(win.w, win.h), map = App.mapper(row.img), bgV = map(lv.black);
    for (let j = 0; j < win.h; j++) for (let i = 0; i < win.w; i++) {
      const k = j * win.w + i, u = u0 + (i + 0.5) * step, v = v0 + (j + 0.5) * step;
      // outside the piece (a gap, a neighbouring piece): plain background
      const val = Math.abs(u) <= pc.w / 2 + 1 && Math.abs(v) <= pc.h / 2 + 1 ? map(win.data[k]) : bgV;
      id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = val; id.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    const out = { href: cv.toDataURL('image/png'), w: win.w, h: win.h };
    if (rasterCache.size > 300) rasterCache.clear();
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
    const rec = App.images.get(imgId), e = App.rowExpo(row).find(x => x.id === imgId);
    if (!rec || !e) return null;
    const parts = App.rowParts(row), inv = App.S.style.invert;
    if (!parts.length) return null;
    const key = [row.id, imgId, JSON.stringify([row.segs, row.above, row.below, parts.map(p => [p.u0, p.u1])]), inv, maxW].join('|');
    if (thumbCache.has(key)) return thumbCache.get(key);
    const step = Math.max(1, parts.reduce((s, p) => s + p.u1 - p.u0, 0) / maxW), sep = 2;
    const wins = parts.map(p => WB.sampleWindow({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, p.F, p.u0, p.u1, p.vTop, p.vBot, step));
    let white = e.peak * 1.05;
    if (rec.cs.clip !== Infinity) white = Math.min(white, rec.cs.clip);
    white = Math.max(white, e.bgMed + 0.005, e.bgMed + (e.noise != null ? e.noise : e.bgSig) * 30, rec.bits <= 8 ? e.bgMed + 0.16 : 0);
    const black = Math.max(0, (e.bgMed - 0.06 * white) / 0.94), sc = 1 / Math.max(1e-6, white - black);
    const W = wins.reduce((s, w) => s + w.w, 0) + sep * (wins.length - 1), H = Math.max(...wins.map(w => w.h));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), id = ctx.createImageData(W, H), clip = rec.cs.clip;
    id.data.fill(255);
    let x0 = 0;
    wins.forEach(win => {
      for (let j = 0; j < win.h; j++) for (let i = 0; i < win.w; i++) {
        const s = win.data[j * win.w + i], k = (j * W + x0 + i) * 4;
        if (clip !== Infinity && s >= clip - 1e-6) { id.data[k] = 229; id.data[k + 1] = 72; id.data[k + 2] = 77; }
        else { let t = (s - black) * sc; t = t < 0 ? 0 : t > 1 ? 1 : t; id.data[k] = id.data[k + 1] = id.data[k + 2] = Math.round((inv ? 1 - t : t) * 255); }
      }
      x0 += win.w + sep;
    });
    ctx.putImageData(id, 0, 0);
    const out = { href: cv.toDataURL('image/png'), w: W, h: H };
    if (thumbCache.size > 300) thumbCache.clear();
    thumbCache.set(key, out);
    return out;
  };

  /* ---------- adding, moving and stitching rows ---------- */
  App.pieceAt = function (b, x, y, pad) {
    let best = null;
    (b && b.pieces || []).forEach(pc => {
      const [u, v] = WB.toFrame(WB.frame(pc.cx, pc.cy, pc.angle), x, y);
      const d = Math.max(0, Math.abs(u) - pc.w / 2) + Math.max(0, Math.abs(v) - pc.h / 2);
      if (!best || d < best.d) best = { pc, u, v, d };
    });
    return best && best.d <= (pad == null ? Infinity : pad) ? best : null;
  };
  function insertRow(row) {
    const S = App.S, y = App.rowXY(row)[1];
    let at = S.rows.findIndex(r => r.blot === row.blot && App.rowXY(r)[1] > y);
    if (at < 0) { const last = S.rows.map(r => r.blot).lastIndexOf(row.blot); at = last >= 0 ? last + 1 : S.rows.length; }
    S.rows.splice(at, 0, row);
  }
  App.addRowAt = function (blotId, x, y) {
    const b = App.blot(blotId), hit = App.pieceAt(b, x, y, 60);
    if (!hit || !App.chemiOf(b).length) return null;
    const { pc, v } = hit;
    const hs = App.S.rows.filter(r => r.blot === blotId).flatMap(r => r.segs.map(s => s.b1 - s.b0)).sort((a, c) => a - c);
    const bandH = hs.length ? hs[hs.length >> 1] : 16, margin = Math.min(100, Math.max(16, bandH * 2.5)), half = pc.h / 2;
    const row = { id: uid('r'), blot: blotId, name: '', img: App.chemiOf(b)[0].id, auto: true, hidden: false, manual: true,
      segs: [{ piece: pc.id, vc: v, b0: -bandH / 2, b1: bandH / 2, ms: [] }],
      above: Math.max(bandH / 2 + 4, Math.min(bandH / 2 + margin, v + half - 2)), below: Math.max(bandH / 2 + 4, Math.min(bandH / 2 + margin, half - v - 2)) };
    insertRow(row);
    return row;
  };
  // place a row where a given molecular weight runs (on a piece that covers it)
  App.addRowAtKda = function (kda, prefBlot) {
    const order = App.S.blots.slice().sort((a, c) => (a.id === prefBlot ? -1 : c.id === prefBlot ? 1 : 0));
    for (const b of order) for (const pc of b.pieces || []) {
      const pcal = App.pieceCal(b, pc), v = pcal && WB.vAtK(pcal, kda);
      if (v == null || Math.abs(v) > pc.h / 2 - 8) continue;
      const [x, y] = WB.toImg(WB.frame(pc.cx, pc.cy, pc.angle), 0, v);
      return App.addRowAt(b.id, x, y);
    }
    return null;
  };
  const xRange = pc => { const a = Math.abs(pc.angle) * Math.PI / 180, hw = (pc.w * Math.cos(a) + pc.h * Math.sin(a)) / 2; return [pc.cx - hw, pc.cx + hw]; };
  const sideBySide = (p, q) => { const A = xRange(p), B = xRange(q), ov = Math.min(A[1], B[1]) - Math.max(A[0], B[0]); return ov < 0.25 * Math.min(A[1] - A[0], B[1] - B[0]); };
  // two pieces one above the other with their lanes on one grid hold the same lanes: never one row
  function sameLanes(p, q) {
    if (sideBySide(p, q) || !App.nSample(p) || !App.nSample(q)) return false;
    const xs = pc => App.slots(pc).map(s => WB.toImg(WB.frame(pc.cx, pc.cy, pc.angle), s.u, 0)[0]);
    const a = xs(p), c = xs(q), tol = 0.25 * Math.min(p.pitch, q.pitch);
    return a.filter(x => c.some(y => Math.abs(x - y) < tol)).length >= 0.7 * Math.min(a.length, c.length);
  }
  App.stacked = (row, pc) => App.rowPieces(row).some(q => q !== pc && sameLanes(q, pc));
  /* Columns of pieces newly joined to a row: a piece whose columns clash with the row's other pieces goes
   * right after them (or right before, if it lies to their left and there is room). */
  function placeNew(row, newIds) {
    const b = App.blot(row.blot), cols = pcs => pcs.flatMap(pc => App.slots(pc).filter(s => s.col != null).map(s => s.col));
    const old = App.rowPieces(row).filter(pc => !newIds.includes(pc.id));
    newIds.map(id => App.piece(b, id)).filter(Boolean).sort((p, q) => p.cx - q.cx).forEach(pc => {
      const have = cols(old);
      if (!have.length || !cols([pc]).some(c => have.includes(c))) { old.push(pc); return; }
      const lo = Math.min(...have), hi = Math.max(...have), n = App.nSample(pc), left = old.every(o => pc.cx < o.cx);
      editPiece(pc, () => { pc.col0 = left && lo - n >= 1 ? lo - n : hi + 1; });
      old.push(pc);
    });
    const first = sg => { const pc = App.piece(b, sg.piece), s = pc && App.slots(pc).find(x => x.col != null); return s ? s.col : 1e9; };
    row.segs.sort((s, t) => first(s) - first(t));
  }
  App.joinRows = function (row, other) {
    const added = other.segs.filter(s => !row.segs.some(t => t.piece === s.piece));
    row.segs.push(...added);
    if (!row.name && other.name) row.name = other.name;
    App.S.rows = App.S.rows.filter(r => r !== other);
    if (App.selRow === other.id) App.selRow = row.id;
    placeNew(row, added.map(s => s.piece));
  };
  // stitch: the protein of `row` continues on the piece clicked at (x, y)
  App.addSeg = function (row, x, y) {
    const b = App.blot(row.blot), hit = App.pieceAt(b, x, y, 20);
    if (!hit) return 'none';
    const { pc, v } = hit, mine = row.segs.find(s => s.piece === pc.id);
    if (mine) { mine.vc = v; return 'moved'; }
    if (App.stacked(row, pc)) return 'stacked';
    // clicked on another row on that piece: take its band
    const other = App.S.rows.find(r => r !== row && r.blot === row.blot && r.segs.some(s => s.piece === pc.id && v >= s.vc - r.above && v <= s.vc + r.below));
    if (other) { if (App.rowPieces(other).some(q => App.stacked(row, q))) return 'stacked'; App.joinRows(row, other); return 'joined'; }
    const ref = row.segs[0];
    row.segs.push({ piece: pc.id, vc: v, b0: ref ? ref.b0 : -8, b1: ref ? ref.b1 : 8, ms: [] });
    placeNew(row, [pc.id]);
    return 'added';
  };
  App.splitRow = function (row) {
    if (row.segs.length < 2) return;
    const rest = row.segs.slice(1).map(sg => ({ id: uid('r'), blot: row.blot, name: '', img: row.img, auto: row.auto, hidden: false, segs: [sg], above: row.above, below: row.below }));
    row.segs = [row.segs[0]];
    App.S.rows.splice(App.S.rows.indexOf(row) + 1, 0, ...rest);
  };

  /* ---------- marker bands set by hand ---------- */
  App.ladderU = pc => { const s = App.slots(pc).find(x => x.role === 'ladder'); return s ? s.u : (pc.roles.length ? pc.u0 - pc.pitch * 0.5 : 0); };
  // the piece's marks as editable values; the first edit starts from what was detected automatically
  App.manualMarks = function (b, pc) {
    if (pc.marks) return pc.marks;
    const pcal = App.pieceCal(b, pc), u = App.ladderU(pc);
    pc.marks = pcal ? pcal.knots.filter(k => Math.abs(k.v) <= pc.h / 2).map(k => ({ u, v: k.v, kda: +Math.exp(k.lk).toPrecision(3) })) : [];
    return pc.marks;
  };
  // a size suggestion for a new mark at v: the ladder size nearest to what the piece's sizes predict
  App.suggestKda = function (b, pc, v) {
    const pcal = App.pieceCal(b, pc), k = pcal && WB.kdaAtK(pcal, v), lad = G.ProteinLadders.get(b.ladderId);
    if (!k) return null;
    if (!lad) return Math.round(k);
    return lad.sizes.slice().sort((p, q) => Math.abs(Math.log(p / k)) - Math.abs(Math.log(q / k)))[0];
  };

  /* ---------- membranes: moving pictures between them ---------- */
  App.moveImage = function (imgId, toBlotId) {
    const S = App.S, from = S.blots.find(b => b.images.includes(imgId));
    let to = toBlotId === 'new' ? null : App.blot(toBlotId);
    if (!to) { to = { id: uid('b'), name: '', images: [], marker: null, ladderId: null, ladderAuto: true, pieces: [] }; S.blots.push(to); }
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
    const C = App.columns();
    vis.forEach(r => {
      const e = App.rowExpo(r).find(x => x.id === r.img);
      if (e && e.satFrac > 0.002) warn.push(`「${label(r)}」所选曝光中条带有过曝像素，定量不可靠，建议换短曝光`);
      if (App.rowClash(r).length) warn.push(`「${label(r)}」跨的几条膜条泳道列重叠了：在"泳道"里把其中一条往后挪（‹ ›）`);
      if (!C.vis.some(j => App.colSource(r, j))) warn.push(`「${label(r)}」的泳道都不在成图的列范围里：在"泳道"里调整范围或膜条的起始列`);
    });
    const blotsUsed = [...new Set(vis.map(r => r.blot))];
    if (blotsUsed.length > 1) {
      legend.push('Bands shown in separate rows were detected on different membranes processed in parallel; each row is an individual crop.');
      const loadBlots = new Set(vis.filter(App.isLoading).map(r => r.blot));
      if (loadBlots.size) blotsUsed.forEach(bid => {
        if (!loadBlots.has(bid) && vis.some(r => r.blot === bid)) warn.push(`${App.blotName(App.blot(bid))}上的蛋白没有同膜内参（期刊要求内参与目标蛋白在同一张膜上）`);
      });
    }
    blotsUsed.forEach(bid => {
      const b = App.blot(bid);
      if (S.style.showMW && !vis.some(r => r.blot === bid && App.rowPieces(r).some(pc => App.pieceCal(b, pc)))) {
        warn.push(`${App.blotName(b)}${b.marker ? '的 Marker 条带没能自动识别' : '没有 Marker 图'}，未标 kDa：可在中间膜图上方点"标 Marker"手动标出 Marker 条带`);
      }
      (b.pieces || []).forEach(pc => {
        const ms = (pc.marks || []).filter(m => m.kda > 0).sort((p, q) => p.v - q.v);
        if (ms.length < 2) return;
        if (ms.some((m, i) => i && m.kda >= ms[i - 1].kda)) warn.push(`${App.pieceName(b, pc)}的 Marker 刻度顺序不对：分子量应从上往下减小`);
      });
    });
    if (C.gapAfter.size) legend.push('Non-adjacent lanes, or lanes from different pieces of a membrane, are separated by white space.');
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
