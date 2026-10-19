/* BlotFigure application state.
 * images (not undoable): decoded pictures with kind (chemi | marker), exposure and signal.
 * S (undoable): membranes ("blots") with their pieces, figure rows (one per protein), figure lanes
 * (columns), levels, annotations.
 * A row has a segment on each piece it runs across. Every segment is a box on its piece, in the piece frame
 * (u along the lanes, v down): x0..x1 across, vc-above … vc+below down (band b0..b1 around vc), and it has
 * lanes of its own — sg.lanes [{u, r}] with r 's' sample | 'm' marker | 'x' left out. The sample lanes fill
 * figure columns sg.c0, sg.c0+1, … in order. Lanes come from the analysis (the piece's lattice), from the
 * box's own pixels (WB.detectBoxLanes) or from the user; resizing a box keeps the lanes inside it and
 * continues their spacing into new room.
 * pc.marks (marker bands set by hand, {u, v, kda}) replace the automatic ladder calibration of a piece.
 */
(function (G) {
  'use strict';
  const WB = G.WB;
  const MM = 72 / 25.4;
  let uidN = 1;
  const uid = p => p + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);
  const tick = () => new Promise(r => setTimeout(r, 16));
  const pFrame = pc => WB.frame(pc.cx, pc.cy, pc.angle);

  const App = { images: new Map(), analysis: {}, S: null, hist: [], future: [], listeners: [], selRow: null, selSeg: null, selLane: null, viewBlot: null, viewImg: null, mode: null };
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
  App.undo = () => { if (App.hist.length < 2) return; App.future.push(App.hist.pop()); App.S = JSON.parse(App.hist[App.hist.length - 1]); App.selLane = null; App.emit('change'); };
  App.redo = () => { if (!App.future.length) return; const s = App.future.pop(); App.hist.push(s); App.S = JSON.parse(s); App.selLane = null; App.emit('change'); };

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
  App.pieceOf = (row, sg) => App.piece(App.blot(row.blot), sg.piece);
  App.findPiece = id => { for (const b of App.S.blots) { const p = App.piece(b, id); if (p) return { b, pc: p }; } return null; };
  // the selected row's segment the lane tools work on (the one clicked last, else the first)
  App.curSeg = row => (row ? row.segs.find(s => s.piece === App.selSeg) || row.segs[0] : null);
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
  App.rowLabel = row => { const k = App.rowKda(row); return row.name || (k ? `≈${Math.round(k)} kDa 行` : '未命名行'); };

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
    // pieces, in analysis order; a piece found again at the same place keeps the marker bands set by hand
    const old = blot.pieces || [];
    const fresh = A.pieces.map(p => Object.assign({ id: uid('p'), marks: null }, JSON.parse(JSON.stringify(p))));
    fresh.forEach(n => {
      const o = old.find(o => Math.hypot(o.cx - n.cx, o.cy - n.cy) < 40 && Math.abs(o.w - n.w) < 60);
      if (o) { n.id = o.id; n.marks = o.marks; }
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
  /* the lanes of a piece's lattice (analysis) that fall in figure columns a..z, with the marker / empty slots
   * between them: the lanes a new box on the piece starts with */
  App.pieceSlots = pc => { let c = pc.col0; return (pc.roles || []).map((role, m) => ({ m, role, u: pc.u0 + m * pc.pitch, col: role === 'sample' ? c++ : null })); };
  function latticeLanes(pc, a, z) {
    const sl = App.pieceSlots(pc), isS = s => s.role === 'sample';
    let inR = s => isS(s) && s.col >= a && s.col <= z;
    if (!sl.some(inR)) inR = isS;
    const i0 = sl.findIndex(inR), i1 = sl.length - 1 - sl.slice().reverse().findIndex(inR);
    if (i0 < 0) return { lanes: [], c0: 1, p: pc.pitch || 100 };
    return { lanes: sl.slice(i0, i1 + 1).map(s => ({ u: s.u, r: isS(s) ? 's' : s.role === 'ladder' ? 'm' : 'x' })), c0: sl[i0].col, p: pc.pitch || 100 };
  }
  App.rowsFromAnalysis = function (blot) {
    const A = App.analysis[blot.id];
    if (!A) return [];
    const pcs = blot.pieces;
    // the figure columns most rows have bands in: a stray lattice slot at a piece's end stays out of the boxes
    const weak = r => { const best = r.expo[r.choice]; return !best || best.snr < 6; };
    const vis = A.rows.filter(r => !weak(r)), cnt = new Map();
    vis.forEach(r => {
      const seen = new Set();
      r.segs.forEach(sg => { const sl = App.pieceSlots(pcs[sg.region]); sg.ms.forEach(m => { if (sl[m] && sl[m].col) seen.add(sl[m].col); }); });
      seen.forEach(c => cnt.set(c, (cnt.get(c) || 0) + 1));
    });
    let hi = 1; pcs.forEach(pc => App.pieceSlots(pc).forEach(s => { if (s.col) hi = Math.max(hi, s.col); }));
    let a = 1, z = hi;
    const need = Math.max(1, vis.length * 0.4);
    if (vis.length >= 3) { while (a < z && (cnt.get(a) || 0) < need) a++; while (z > a && (cnt.get(z) || 0) < need) z--; }
    return A.rows.map(r => {
      const isWeak = weak(r);
      const row = { id: uid('r'), blot: blot.id, name: '', img: A.chemiIds[r.choice], auto: true, hidden: isWeak, weak: isWeak, segs: [], above: r.above, below: r.below };
      r.segs.forEach(s => {
        const pc = pcs[s.region], L = latticeLanes(pc, a, z);
        const sg = { piece: pc.id, vc: s.vc, b0: s.b0, b1: s.b1, lanes: L.lanes, c0: L.c0, p: L.p, x0: -pc.w / 2, x1: pc.w / 2 };
        // a piece without lanes of its own in the analysis: read them from the row's box
        if (!sg.lanes.length) App.redetectBox(row, sg);
        App.snapBox(sg);
        row.segs.push(sg);
      });
      return row;
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

  /* ---------- lanes: every box has its own ---------- */
  const spacing = (lanes, p) => {
    if (!lanes || lanes.length < 2) return p > 4 ? p : 100;
    const g = []; for (let i = 1; i < lanes.length; i++) g.push(lanes[i].u - lanes[i - 1].u);
    g.sort((a, b) => a - b);
    return Math.max(4, g[g.length >> 1]);
  };
  App.segPitch = sg => spacing(sg.lanes, sg.p);
  // edges of lane i: half-way to its neighbours, half a spacing out at the ends
  App.laneLeft = (sg, i) => { const L = sg.lanes; return i > 0 ? (L[i - 1].u + L[i].u) / 2 : L[i].u - App.segPitch(sg) / 2; };
  App.laneRight = (sg, i) => { const L = sg.lanes; return i < L.length - 1 ? (L[i].u + L[i + 1].u) / 2 : L[i].u + App.segPitch(sg) / 2; };
  App.segCols = sg => { let c = sg.c0; return sg.lanes.map((l, i) => ({ i, u: l.u, r: l.r, col: l.r === 's' ? c++ : null })); };
  App.nSample = sg => sg.lanes.filter(l => l.r === 's').length;
  App.segEnd = sg => sg.c0 + App.nSample(sg) - 1;
  // the box spans its lanes exactly: what it shows is what the figure shows
  App.snapBox = sg => { if (sg.lanes.length) { sg.x0 = App.laneLeft(sg, 0); sg.x1 = App.laneRight(sg, sg.lanes.length - 1); } };
  // a lane on a ladder lane of the white-light picture is a marker lane (within a third of a real lane width,
  // whatever spacing the box's lanes have)
  App.roleAt = (pc, u, p) => (pc && (pc.ladderUs || []).some(x => Math.abs(x - u) < Math.min(p, pc.pitch || p) * 0.3) ? 'm' : 's');
  App.segX = (row, sg) => { const pc = App.pieceOf(row, sg); return pc ? WB.toImg(pFrame(pc), (sg.x0 + sg.x1) / 2, sg.vc)[0] : 0; };
  // segments of a row continue each other's columns: when one gains or loses lanes, the ones that followed it
  // keep following it (before: [{c0, n}] of the row's segments before the edit)
  const segsState = row => row.segs.map(s => ({ c0: s.c0, n: App.nSample(s) }));
  function keepJoined(row, sg, before) {
    const i = row.segs.indexOf(sg);
    let end = App.segEnd(sg);
    for (let k = i + 1; k < row.segs.length; k++) {
      const t = row.segs[k], was = before[k], prev = before[k - 1];
      if (!was || !prev || was.c0 !== prev.c0 + prev.n) break;
      t.c0 = end + 1; end = App.segEnd(t);
    }
  }
  App.segsState = segsState;
  App.keepJoined = keepJoined;
  // run a lane edit of one segment; the row's later segments keep following it, the box hugs the lanes
  App.editLanes = function (row, sg, fn, keepBox) {
    const before = segsState(row);
    const out = fn();
    if (!keepBox) App.snapBox(sg);
    keepJoined(row, sg, before);
    return out;
  };

  /* The box of a segment set to x0..x1 (piece frame), from its lanes before the edit (base {lanes, c0, p}):
   * lanes whose centres lie inside stay where they are, the spacing continues into new room, and the lanes
   * that stay keep their figure columns. The edges are taken as given (snapBox squares them at the end). */
  App.setBox = function (row, sg, x0, x1, base) {
    base = base || { lanes: sg.lanes.map(l => ({ u: l.u, r: l.r })), c0: sg.c0, p: sg.p };
    const pc = App.pieceOf(row, sg), p = spacing(base.lanes, base.p);
    const inside = l => l.u >= x0 - 1e-6 && l.u <= x1 + 1e-6;
    const L = base.lanes.filter(inside).map(l => ({ u: l.u, r: l.r }));
    if (!L.length) {
      // moved clear of its lanes: their lattice carried on into the box
      const o = base.lanes.length ? base.lanes[0].u : (x0 + x1) / 2;
      for (let u = o + Math.ceil((x0 - o) / p - 1e-9) * p; u <= x1 + 1e-6 && L.length < 80; u += p) L.push({ u, r: App.roleAt(pc, u, p) });
      if (!L.length) L.push({ u: (x0 + x1) / 2, r: App.roleAt(pc, (x0 + x1) / 2, p) });
    } else {
      for (let u = L[0].u - p; u >= x0 - 1e-6 && L.length < 80; u -= p) L.unshift({ u, r: App.roleAt(pc, u, p) });
      for (let u = L[L.length - 1].u + p; u <= x1 + 1e-6 && L.length < 80; u += p) L.push({ u, r: App.roleAt(pc, u, p) });
    }
    let c0 = base.c0;
    const stay = base.lanes.find(l => l.r === 's' && inside(l));
    if (stay) {
      const col = base.c0 + base.lanes.filter(l => l.r === 's' && l.u < stay.u - 1e-6).length;
      c0 = Math.max(1, col - L.filter(l => l.r === 's' && l.u < stay.u - 1e-6).length);
    }
    sg.lanes = L; sg.c0 = c0; sg.p = p; sg.x0 = x0; sg.x1 = x1;
  };
  // the chemi signal of an image as a WB image
  const sigOf = rec => ({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig });
  /* Lanes again from the box's own pixels: in the row's recommended exposure (clear and not clipped), else
   * the one it shows, else the longest. The first sample lane keeps the column of the old lane at its place.
   * Returns the number of sample lanes found. */
  App.redetectBox = function (row, sg, imgId) {
    const b = App.blot(row.blot), pc = App.piece(b, sg.piece);
    if (!pc) return 0;
    const ch = App.chemiOf(b), best = imgId ? null : sg.lanes.length && App.S.rows.includes(row) ? App.bestExpo(row) : null;
    const recs = [imgId, best, row.img].map(id => id && App.images.get(id)).concat(ch.slice().reverse()).filter(r => r && r.kind === 'chemi');
    const x0 = sg.x0 != null ? sg.x0 : -pc.w / 2, x1 = sg.x1 != null ? sg.x1 : pc.w / 2;
    let res = null;
    for (const rec of recs) {
      res = WB.detectBoxLanes(sigOf(rec), pFrame(pc), x0, x1, sg.vc - row.above, sg.vc + row.below, { pitch: pc.pitch || App.segPitch(sg) });
      if (res.lanes.length) break;
    }
    if (!res || !res.lanes.length) return 0;
    const oldCols = App.segCols(sg).filter(c => c.col != null), p = res.pitch > 4 ? res.pitch : App.segPitch(sg);
    sg.lanes = res.lanes.map(u => ({ u, r: App.roleAt(pc, u, p) }));
    sg.p = p;
    const first = sg.lanes.find(l => l.r === 's');
    const near = first && oldCols.slice().sort((a, c) => Math.abs(a.u - first.u) - Math.abs(c.u - first.u))[0];
    if (near && Math.abs(near.u - first.u) < p * 0.5) sg.c0 = near.col;
    return App.nSample(sg);
  };
  // n lanes spread evenly across the box (default: as many as it has now)
  App.evenBox = function (row, sg, n) {
    const pc = App.pieceOf(row, sg);
    n = Math.max(1, Math.min(60, Math.round(n || sg.lanes.length || 1)));
    const p = (sg.x1 - sg.x0) / n;
    sg.lanes = Array.from({ length: n }, (_, k) => { const u = sg.x0 + (k + 0.5) * p; return { u, r: App.roleAt(pc, u, p) }; });
    sg.p = p;
    return n;
  };
  // a lane added at u; when it comes before the first sample lane the lanes already there keep their columns
  App.addLane = function (row, sg, u) {
    const pc = App.pieceOf(row, sg), p = App.segPitch(sg), r = App.roleAt(pc, u, p);
    const at = sg.lanes.filter(l => l.u < u).length, firstS = r === 's' && !sg.lanes.slice(0, at).some(l => l.r === 's');
    sg.lanes.splice(at, 0, { u, r });
    if (firstS && App.nSample(sg) > 1 && sg.c0 > 1) sg.c0--;
    return at;
  };
  // a lane taken out (detected where there is none): the lanes after it move up a column
  App.removeLane = (row, sg, i) => { if (sg.lanes.length > 1 && sg.lanes[i]) sg.lanes.splice(i, 1); };
  App.moveLane = function (sg, i, u) {
    const L = sg.lanes, lo = i > 0 ? L[i - 1].u + 3 : -Infinity, hi = i < L.length - 1 ? L[i + 1].u - 3 : Infinity;
    L[i].u = Math.max(lo, Math.min(hi, u));
  };
  // sample -> left out -> marker -> sample
  App.cycleLane = (sg, i) => { const l = sg.lanes[i]; if (l) l.r = { s: 'x', x: 'm', m: 's' }[l.r] || 's'; };
  App.nudgeLanes = (sg, du) => sg.lanes.forEach(l => { l.u += du; });
  App.scaleLanes = function (sg, dp) {
    const L = sg.lanes; if (L.length < 2) { sg.p = Math.max(6, App.segPitch(sg) + dp); return; }
    const mid = (L[0].u + L[L.length - 1].u) / 2, p = App.segPitch(sg), k = Math.max(6, p + dp) / p;
    L.forEach(l => { l.u = mid + (l.u - mid) * k; });
    sg.p = p * k;
  };
  // figure columns of a segment (and the segments after it in the row) moved by d
  App.shiftCols = function (row, sg, d) {
    const i = row.segs.indexOf(sg);
    if (i < 0 || sg.c0 + d < 1) return false;
    row.segs.slice(i).forEach(t => { t.c0 = Math.max(1, t.c0 + d); });
    return true;
  };
  /* figure columns of a segment from where its lanes lie: as another row's lanes at the same place on the
   * same piece, else as the piece's lattice from the analysis; unchanged when nothing lines up */
  App.alignSeg = function (row, sg) {
    const pc = App.pieceOf(row, sg); if (!pc) return;
    const p = App.segPitch(sg), mine = App.segCols(sg).filter(s => s.col != null);
    if (!mine.length) return;
    let refs = [];
    App.S.rows.forEach(r => { if (r !== row) r.segs.forEach(t => { if (t.piece === sg.piece) App.segCols(t).forEach(s => { if (s.col != null) refs.push(s); }); }); });
    if (!refs.length) refs = App.pieceSlots(pc).filter(s => s.col != null);
    const offs = [];
    mine.forEach((s, k) => {
      const m = refs.filter(q => Math.abs(q.u - s.u) < p * 0.35).sort((a, c) => Math.abs(a.u - s.u) - Math.abs(c.u - s.u))[0];
      if (m) offs.push(m.col - k);
    });
    if (offs.length && offs.length >= mine.length * 0.5) { offs.sort((a, c) => a - c); sg.c0 = Math.max(1, offs[offs.length >> 1]); }
  };
  // the band inside a box (the row's picture), down its sample lanes: the one it had when that is still
  // there, else the strongest
  App.findBand = function (row, sg) {
    const pc = App.pieceOf(row, sg), rec = App.images.get(row.img);
    if (!pc || !rec || rec.kind !== 'chemi') return;
    const us = sg.lanes.filter(l => l.r === 's').map(l => l.u), vT = sg.vc - row.above, vB = sg.vc + row.below;
    const was = sg.vc + (sg.b0 + sg.b1) / 2;
    const bd = WB.bandInBox(sigOf(rec), pFrame(pc), us, App.segPitch(sg) * 0.3, vT, vB, was > vT && was < vB ? was : null);
    if (bd) { sg.b0 = bd.v0 - sg.vc; sg.b1 = bd.v1 - sg.vc; }
  };
  // lanes for a new box on a piece: those of the nearest other row on it (the user may have fixed them),
  // else the piece's lattice over the figure's columns
  App.pieceLanes = function (b, pc, v) {
    let best = null;
    App.S.rows.forEach(r => r.segs.forEach(sg => { if (sg.piece === pc.id && sg.lanes.length && (!best || Math.abs(sg.vc - v) < Math.abs(best.vc - v))) best = sg; }));
    if (best) return { lanes: best.lanes.map(l => ({ u: l.u, r: l.r })), c0: best.c0, p: App.segPitch(best) };
    return latticeLanes(pc, App.S.range[0], App.S.range[1]);
  };

  /* ---------- figure columns ---------- */
  // where figure column j of a row comes from: {sg, pc, i: lane index, u} or null (no lane of the row there)
  App.colSource = function (row, j) {
    const b = App.blot(row.blot);
    for (const sg of row.segs) {
      const s = App.segCols(sg).find(x => x.col === j);
      if (s) return { sg, pc: App.piece(b, sg.piece), i: s.i, u: s.u };
    }
    return null;
  };
  // columns of a row that two of its boxes both claim (one of them needs shifting)
  App.rowClash = function (row) {
    const seen = new Map(), clash = [];
    row.segs.forEach(sg => App.segCols(sg).forEach(s => { if (s.col == null) return; if (seen.has(s.col) && seen.get(s.col) !== sg) clash.push(s.col); seen.set(s.col, sg); }));
    return clash;
  };
  App.fitLanes = function (resetRange) {
    const S = App.S;
    let hi = 1, hiVis = 0, lo = Infinity;
    S.rows.forEach(r => r.segs.forEach(sg => {
      if (!App.nSample(sg)) return;
      hi = Math.max(hi, App.segEnd(sg));
      if (!r.hidden) { hiVis = Math.max(hiVis, App.segEnd(sg)); lo = Math.min(lo, sg.c0); }
    }));
    if (!hiVis) hiVis = hi;
    if (!(lo <= hiVis)) lo = 1;
    while (S.lanes.length < hi) S.lanes.push({ name: '', hidden: false });
    S.conditions.forEach(c => { while (c.values.length < S.lanes.length) c.values.push(''); });
    if (resetRange || !S.range || S.range[0] > hiVis) S.range = [lo, hiVis];
    else if (S.hiCol && S.range[1] === S.hiCol && hiVis !== S.hiCol) S.range[1] = hiVis;   // the range ran to the last column: keep it so
    S.hiCol = hiVis;
  };
  App.figLanes = () => { const out = []; for (let j = App.S.range[0]; j <= App.S.range[1]; j++) if (App.S.lanes[j - 1] && !App.S.lanes[j - 1].hidden) out.push(j); return out; };
  /* Figure columns shown, the source of every row in every column, and where a white gap separates
   * columns: wherever neighbouring columns are not neighbouring lanes of one box in some row. */
  App.columns = function () {
    const S = App.S, vis = App.figLanes(), rows = S.rows.filter(r => !r.hidden && App.blot(r.blot));
    const src = rows.map(r => vis.map(j => App.colSource(r, j)));
    const gapAfter = new Set();
    for (let k = 0; k + 1 < vis.length; k++) {
      if (vis[k + 1] !== vis[k] + 1) { gapAfter.add(k); continue; }
      if (src.some(rs => { const a = rs[k], c = rs[k + 1]; return a && c && (a.sg !== c.sg || c.i !== a.i + 1); })) gapAfter.add(k);
    }
    const segs = []; let cur = null;
    vis.forEach((j, k) => { if (!cur) { cur = []; segs.push(cur); } cur.push(j); if (gapAfter.has(k)) cur = null; });
    return { vis, rows, src, gapAfter, segs };
  };
  App.segments = () => App.columns().segs;
  App.ensureLane = j => { while (App.S.lanes.length < j) App.S.lanes.push({ name: '', hidden: false }); };

  /* ---------- rows: geometry, exposures, levels ---------- */
  App.rowPieces = row => { const b = App.blot(row.blot); return row.segs.map(sg => App.piece(b, sg.piece)).filter(Boolean); };
  App.rowPitch = row => (row.segs.length ? row.segs.reduce((s, sg) => s + App.segPitch(sg), 0) / row.segs.length : 100);
  // image position of a row (band centre on its first piece)
  App.rowXY = row => { const b = App.blot(row.blot), sg = row.segs[0], pc = sg && App.piece(b, sg.piece); return pc ? WB.toImg(pFrame(pc), 0, sg.vc) : [0, 0]; };
  // the windows of a row on its boxes, over the lanes shown in the figure (all lanes if none is shown)
  App.rowParts = function (row, all) {
    const b = App.blot(row.blot), vis = new Set(App.figLanes()), parts = [];
    row.segs.forEach(sg => {
      const pc = App.piece(b, sg.piece); if (!pc || !sg.lanes.length) return;
      const cs = App.segCols(sg).filter(s => s.col != null && (all || vis.has(s.col)));
      if (!cs.length) return;
      parts.push({ F: pFrame(pc), u0: App.laneLeft(sg, cs[0].i), u1: App.laneRight(sg, cs[cs.length - 1].i),
        vTop: sg.vc - row.above, vBot: sg.vc + row.below, b0: sg.vc + sg.b0, b1: sg.vc + sg.b1, sg, pc });
    });
    return parts.length || all ? parts : App.rowParts(row, true);
  };
  const expoCache = new Map();
  App.rowExpo = function (row) {
    const b = App.blot(row.blot); if (!b) return [];
    const ch = App.chemiOf(b);
    const key = row.id + JSON.stringify([row.segs, row.above, row.below, App.S.range, App.figLanes()]) + ch.map(c => c.id);
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

  // straightened crop of lanes iA..iB of one box for a row, rendered to a canvas
  const rasterCache = new Map();
  App.runRaster = function (row, sg, pc, iA, iB, step) {
    const rec = App.images.get(row.img), lv = App.levelsOf(row.img);
    const u0 = App.laneLeft(sg, iA), u1 = App.laneRight(sg, iB), v0 = sg.vc - row.above, v1 = sg.vc + row.below;
    const key = [row.img, lv.black, lv.white, App.S.style.invert, pc.cx, pc.cy, pc.angle, pc.w, pc.h, u0, u1, v0, v1, step.toFixed(3)].join('|');
    if (rasterCache.has(key)) return rasterCache.get(key);
    const F = pFrame(pc);
    const win = WB.sampleWindow(sigOf(rec), F, u0, u1, v0, v1, step);
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
    const key = [row.id, imgId, JSON.stringify([row.above, row.below, parts.map(p => [p.u0, p.u1, p.vTop])]), inv, maxW].join('|');
    if (thumbCache.has(key)) return thumbCache.get(key);
    const step = Math.max(1, parts.reduce((s, p) => s + p.u1 - p.u0, 0) / maxW), sep = 2;
    const wins = parts.map(p => WB.sampleWindow(sigOf(rec), p.F, p.u0, p.u1, p.vTop, p.vBot, step));
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
      const [u, v] = WB.toFrame(pFrame(pc), x, y);
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
  // a row at a clicked height: a box over the lanes the piece's other rows have
  App.addRowAt = function (blotId, x, y) {
    const b = App.blot(blotId), hit = App.pieceAt(b, x, y, 60);
    if (!hit || !App.chemiOf(b).length) return null;
    const { pc, v } = hit;
    const hs = App.S.rows.filter(r => r.blot === blotId).flatMap(r => r.segs.map(s => s.b1 - s.b0)).sort((a, c) => a - c);
    const bandH = hs.length ? hs[hs.length >> 1] : 16, margin = Math.min(100, Math.max(16, bandH * 2.5)), half = pc.h / 2;
    const L = App.pieceLanes(b, pc, v);
    const sg = { piece: pc.id, vc: v, b0: -bandH / 2, b1: bandH / 2, lanes: L.lanes, c0: L.c0, p: L.p, x0: -pc.w / 2, x1: pc.w / 2 };
    const row = { id: uid('r'), blot: blotId, name: '', img: App.chemiOf(b)[0].id, auto: true, hidden: false, manual: true, segs: [sg],
      above: Math.max(bandH / 2 + 4, Math.min(bandH / 2 + margin, v + half - 2)), below: Math.max(bandH / 2 + 4, Math.min(bandH / 2 + margin, half - v - 2)) };
    if (!sg.lanes.length && !App.redetectBox(row, sg)) App.evenBox(row, sg, Math.max(1, Math.round(pc.w / (pc.pitch || 100))));
    App.snapBox(sg);
    insertRow(row);
    return row;
  };
  // a row from a box drawn on a piece (frame units): lanes and band read from the box alone
  App.addRowBox = function (blotId, pcId, u0, u1, v0, v1) {
    const b = App.blot(blotId), pc = App.piece(b, pcId), ch = App.chemiOf(b);
    if (!pc || !ch.length) return null;
    const half = Math.max(3, (v1 - v0) / 2);
    const sg = { piece: pc.id, vc: (v0 + v1) / 2, b0: -half / 2, b1: half / 2, lanes: [], c0: 1, p: pc.pitch || 100, x0: u0, x1: u1 };
    const row = { id: uid('r'), blot: blotId, name: '', img: ch[ch.length - 1].id, auto: true, hidden: false, manual: true, segs: [sg], above: half, below: half };
    if (!App.redetectBox(row, sg)) App.evenBox(row, sg, Math.max(1, Math.round((u1 - u0) / (pc.pitch || 100))));
    App.alignSeg(row, sg);
    App.snapBox(sg);
    App.findBand(row, sg);
    insertRow(row);
    return row;
  };
  // place a row where a given molecular weight runs (on a piece that covers it)
  App.addRowAtKda = function (kda, prefBlot) {
    const order = App.S.blots.slice().sort((a, c) => (a.id === prefBlot ? -1 : c.id === prefBlot ? 1 : 0));
    for (const b of order) for (const pc of b.pieces || []) {
      const pcal = App.pieceCal(b, pc), v = pcal && WB.vAtK(pcal, kda);
      if (v == null || Math.abs(v) > pc.h / 2 - 8) continue;
      const [x, y] = WB.toImg(pFrame(pc), 0, v);
      return App.addRowAt(b.id, x, y);
    }
    return null;
  };
  const xRange = pc => { const a = Math.abs(pc.angle) * Math.PI / 180, hw = (pc.w * Math.cos(a) + pc.h * Math.sin(a)) / 2; return [pc.cx - hw, pc.cx + hw]; };
  const sideBySide = (p, q) => { const A = xRange(p), B = xRange(q), ov = Math.min(A[1], B[1]) - Math.max(A[0], B[0]); return ov < 0.25 * Math.min(A[1] - A[0], B[1] - B[0]); };
  // two pieces one above the other with their lanes on one grid hold the same lanes: never one row
  function sameLanes(p, q) {
    const sp = App.pieceSlots(p), sq = App.pieceSlots(q);
    if (sideBySide(p, q) || !sp.length || !sq.length) return false;
    const xs = (pc, sl) => sl.map(s => WB.toImg(pFrame(pc), s.u, 0)[0]);
    const a = xs(p, sp), c = xs(q, sq), tol = 0.25 * Math.min(p.pitch, q.pitch);
    return a.filter(x => c.some(y => Math.abs(x - y) < tol)).length >= 0.7 * Math.min(a.length, c.length);
  }
  App.stacked = (row, pc) => App.rowPieces(row).some(q => q !== pc && sameLanes(q, pc));
  /* Columns of boxes newly joined to a row: a box whose columns clash with the row's other boxes goes right
   * after them (or right before, if it lies to their left and there is room). */
  function placeNew(row, added) {
    const cols = segs => segs.flatMap(s => App.segCols(s).filter(x => x.col != null).map(x => x.col));
    const old = row.segs.filter(s => !added.includes(s));
    added.slice().sort((s, t) => App.segX(row, s) - App.segX(row, t)).forEach(sg => {
      const have = cols(old);
      if (have.length && cols([sg]).some(c => have.includes(c))) {
        const lo = Math.min(...have), hi = Math.max(...have), n = App.nSample(sg), left = old.every(o => App.segX(row, sg) < App.segX(row, o));
        sg.c0 = left && lo - n >= 1 ? lo - n : hi + 1;
      }
      old.push(sg);
    });
    row.segs.sort((s, t) => s.c0 - t.c0);
  }
  App.joinRows = function (row, other) {
    const added = other.segs.filter(s => !row.segs.some(t => t.piece === s.piece));
    row.segs.push(...added);
    if (!row.name && other.name) row.name = other.name;
    App.S.rows = App.S.rows.filter(r => r !== other);
    if (App.selRow === other.id) App.selRow = row.id;
    placeNew(row, added);
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
    const ref = row.segs[0], L = App.pieceLanes(b, pc, v);
    const sg = { piece: pc.id, vc: v, b0: ref ? ref.b0 : -8, b1: ref ? ref.b1 : 8, lanes: L.lanes, c0: L.c0, p: L.p, x0: -pc.w / 2, x1: pc.w / 2 };
    if (!sg.lanes.length) App.redetectBox(row, sg);
    App.snapBox(sg);
    row.segs.push(sg);
    placeNew(row, [sg]);
    return 'added';
  };
  App.splitRow = function (row) {
    if (row.segs.length < 2) return;
    const rest = row.segs.slice(1).map(sg => ({ id: uid('r'), blot: row.blot, name: '', img: row.img, auto: row.auto, hidden: false, segs: [sg], above: row.above, below: row.below }));
    row.segs = [row.segs[0]];
    App.S.rows.splice(App.S.rows.indexOf(row) + 1, 0, ...rest);
  };

  /* ---------- marker bands set by hand ---------- */
  App.ladderU = pc => {
    if (pc.ladderUs && pc.ladderUs.length) return pc.ladderUs[0];
    const s = App.pieceSlots(pc).find(x => x.role === 'ladder');
    return s ? s.u : ((pc.roles || []).length ? pc.u0 - pc.pitch * 0.5 : -pc.w / 2 + 30);
  };
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
      if (App.rowClash(r).length) warn.push(`「${label(r)}」的几个框占了相同的列：选中这一行，在"泳道"里把右边那个框往后挪（›）`);
      if (!C.vis.some(j => App.colSource(r, j))) warn.push(`「${label(r)}」的泳道都不在成图的列范围里：在"泳道"里调整范围，或把这一行的列挪过来（‹ ›）`);
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
