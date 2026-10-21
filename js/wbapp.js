/* BlotFigure application state.
 * images (not undoable): decoded pictures with kind (chemi | marker), exposure and signal.
 * S (undoable): membranes ("blots") with their pieces, figure rows (one per protein), figure lanes
 * (columns), levels, annotations.
 * A row has a segment on each piece it runs across. Every segment is a box in its piece's frame (u along the
 * lanes, v down) — anywhere on the picture, not bound by the piece's outline; the piece gives its tilt, its
 * marker sizes and its module in the figure: x0..x1 across, vc-above … vc+below down (band b0..b1 around vc), and it has
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
  // a point (u, v) of piece a, in the frame of piece b (the same place on the membrane)
  const carry = (a, b, u, v) => { const [x, y] = WB.toImg(pFrame(a), u, v), [u2, v2] = WB.toFrame(pFrame(b), x, y); return { u: u2, v: v2 }; };
  // letters in reading order: top to bottom, left to right within a band
  function letterPieces(blot) {
    const pcs = blot.pieces || [], top = p => p.cy - p.h / 2;
    pcs.map((p, i) => i).sort((i, k) => (Math.abs(top(pcs[i]) - top(pcs[k])) < 60 ? pcs[i].cx - pcs[k].cx : top(pcs[i]) - top(pcs[k])))
      .forEach((i, n) => { pcs[i].letter = String.fromCharCode(65 + (n % 26)); });
  }

  const App = { images: new Map(), analysis: {}, S: null, hist: [], future: [], listeners: [], selRow: null, selSeg: null, selLane: null, viewBlot: null, viewImg: null, mode: null };
  try { App.prefLadder = localStorage.getItem('blotfig.ladder') || null; } catch (e) { App.prefLadder = null; }

  const defaultStyle = () => ({ mmPerLane: 5, fontPt: 7, lineWidthPt: 0.5, labelAngle: 'auto', rowGapPt: 2, blotGapPt: 5,
    tickLenPt: 2.5, labelGapPt: 2.5, unitHeader: true, showMW: true, panelLetter: '', dpi: 600, invert: true, border: false });
  const newState = () => ({ blots: [], rows: [], lanes: [], range: [1, 1], hiCol: 0, levels: {}, align: {}, conditions: [], groups: [], style: defaultStyle() });

  /* ---------- events / undo ---------- */
  App.on = fn => App.listeners.push(fn);
  App.emit = what => App.listeners.forEach(fn => fn(what));
  let raf = 0;
  App.refresh = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; App.emit('refresh'); }); };
  App.commit = function () {
    if (!App.S) return;
    roomLeft();
    App.fitLanes(false);
    App.refreshChoices();
    const snap = JSON.stringify(App.S);
    if (App.hist[App.hist.length - 1] !== snap) { App.hist.push(snap); if (App.hist.length > 120) App.hist.shift(); App.future = []; }
    App.emit('change');
  };
  // (pictures are resampled again where the restored state aligns them differently)
  App.undo = () => { if (App.hist.length < 2) return; App.future.push(App.hist.pop()); App.S = JSON.parse(App.hist[App.hist.length - 1]); App.selLane = null; App.syncPieces(); App.syncAlign(); App.emit('change'); };
  App.redo = () => { if (!App.future.length) return; const s = App.future.pop(); App.hist.push(s); App.S = JSON.parse(s); App.selLane = null; App.syncPieces(); App.syncAlign(); App.emit('change'); };

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

  /* a membrane. Its ladder: the one the user chose last time (people keep one ladder; ladderFrom 'pref'), else
   * guessed from the marker bands (ladderAuto: to be confirmed) */
  const newBlot = (images, marker) => ({ id: uid('b'), name: '', images, marker, ladderId: App.prefLadder || null, ladderAuto: !App.prefLadder,
    ladderFrom: App.prefLadder ? 'pref' : null, pieces: [] });
  // the ladder of a membrane chosen by the user: remembered for the next membranes
  App.setLadder = function (b, id) {
    b.ladderAuto = !id; b.ladderFrom = id ? 'user' : null;
    b.ladderId = id || (App.analysis[b.id] && App.analysis[b.id].autoLadderId) || null;
    if (id) { App.prefLadder = id; try { localStorage.setItem('blotfig.ladder', id); } catch (e) { /* storage off */ } }
  };
  // a marker photo saved at another resolution: resampled to the matching exposure
  function matchSizes(recs) {
    const chemiAll = recs.concat([...App.images.values()]).filter(c => c.kind === 'chemi');
    recs.filter(r => r.kind === 'marker').forEach(m => {
      if (chemiAll.some(c => c.img.w === m.img.w && c.img.h === m.img.h)) return;
      const c = chemiAll.find(c => Math.abs(c.img.w / c.img.h - m.img.w / m.img.h) < 0.015 * (c.img.w / c.img.h));
      if (c) { m.img = resample(m.img, c.img.w, c.img.h); m.resampled = true; }
    });
  }

  /* ---------- projects: one file with everything (state: boxes, names, marks, settings; the pictures as
   * loaded, byte for byte) to go on later or on another computer. 'BLOTFIG1', the header's length (u32), the
   * header (JSON), then the pictures' files one after the other; gzip-compressed where the browser can. ---------- */
  const MAGIC = 'BLOTFIG1';
  App.saveProject = async function () {
    const recs = [...App.images.values()], bufs = [];
    for (const r of recs) bufs.push(r.src && r.src.buffer ? r.src.buffer : await r.src.arrayBuffer());
    const head = { version: 1, app: 'BlotFigure', viewBlot: App.viewBlot, S: App.S,
      images: recs.map((r, i) => ({ id: r.id, name: r.name, kind: r.kind, exposure: r.exposure, size: bufs[i].byteLength })) };
    const json = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, json.length, true);
    let blob = new Blob([new TextEncoder().encode(MAGIC), len, json, ...bufs]);
    if (typeof CompressionStream !== 'undefined') blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return blob;
  };
  App.openProject = async function (file) {
    busy(true, '打开项目…'); await tick();
    try {
      let buf = file.buffer || await file.arrayBuffer(), u8 = new Uint8Array(buf);
      if (u8[0] === 0x1f && u8[1] === 0x8b) { buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); u8 = new Uint8Array(buf); }
      if (new TextDecoder().decode(u8.subarray(0, 8)) !== MAGIC) throw new Error('这不是 BlotFigure 项目文件（.blotfig）');
      const n = new DataView(buf, 8, 4).getUint32(0, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + n)));
      const recs = [];
      let at = 12 + n;
      for (const im of head.images) {
        busy(true, `打开项目：读取图片 ${recs.length + 1}/${head.images.length}…`); await tick();
        const f = new File([buf.slice(at, at + im.size)], im.name); at += im.size;
        const d = await G.TIFF.loadFile(f);
        recs.push({ id: im.id, name: im.name, img: { w: d.width, h: d.height, data: d.data }, spp: d.spp, bits: d.bits, src: f, kind: im.kind, exposure: im.exposure });
      }
      App.images.clear(); App.analysis = {};
      matchSizes(recs);
      recs.forEach(r => { prepare(r); App.images.set(r.id, r); });
      App.S = head.S;
      App.selRow = App.selSeg = App.selLane = App.selMark = null; App.mode = null;
      App.viewBlot = App.blot(head.viewBlot) ? head.viewBlot : (App.S.blots[0] || {}).id; App.viewImg = null;
      App.syncAlign();
      busy(true, '打开项目：分析各张膜…'); await tick();
      // the analysis again (pieces found at the same places keep their ids, the boxes on them stay as saved)
      App.S.blots.forEach(b => App.analyze(b));
      App.hist = []; App.future = [];
      App.commit();
      App.saved = App.hist[App.hist.length - 1];
      App.emit('loaded');
      return App.images.size;
    } finally { busy(false); }
  };

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
        // (tests: the membrane as if moved by a known transform before this picture)
        // (what comes into view is background: the tray of a white-light photo, an exposure's own background)
        const mv = App.devMove && App.devMove[f.name];
        if (mv) { const im = { w: d.width, h: d.height, data: d.data }; d.data = WB.regWarp(im, WB.regInverse(mv), [], G.Engine.percentiles(d.data, [WB.classify(im, { name: f.name, spp: d.spp }) === 'marker' ? 3 : 50], 97)[0]); }
        // (src: the file itself, read again when the project is saved)
        recs.push({ id: f.id || uid('i'), name: f.name, img: { w: d.width, h: d.height, data: d.data }, spp: d.spp, bits: d.bits, src: f });
        busy(true, `读取图片 ${recs.length}/${files.length}…`); await tick();
      }
      busy(true, '识别曝光图与 Marker 图…'); await tick();
      recs.forEach(r => { r.kind = WB.classify(r.img, { name: r.name, spp: r.spp }); r.exposure = WB.exposureFromName(r.name); });
      matchSizes(recs);
      recs.forEach(r => { prepare(r); App.images.set(r.id, r); });
      // group into membranes
      const groups = WB.groupSessions(recs.map(r => ({ id: r.id, name: r.name, w: r.img.w, h: r.img.h, kind: r.kind, thumb: r.thumb })));
      let blots = groups.map(g => newBlot(g.chemi.map(c => c.id).concat(g.markers.map(m => m.id)), g.markers[0] ? g.markers[0].id : null));
      // stray marker photos (all of one place) join a membrane of the same size that has none
      blots.filter(b => !App.chemiOf(b).length).forEach(mb => {
        const m = App.images.get(mb.images[0]);
        const host = blots.concat(App.S.blots).find(b => b !== mb && App.chemiOf(b).length && !b.marker && App.chemiOf(b)[0].img.w === m.img.w && App.chemiOf(b)[0].img.h === m.img.h);
        if (host) { host.images.push(...mb.images); host.marker = m.id; mb.images = []; }
      });
      blots = blots.filter(b => b.images.length);
      // the same membrane photographed in another place (moved between captures) is one membrane, also with one
      // loaded before: its white-light photo matches once moved back (pictures of exposures alone never join:
      // replicate membranes show the same bands)
      busy(true, '比对各次拍摄中膜的位置…'); await tick();
      const init = new Map(), joined = new Set(), anchors = App.S.blots.filter(b => b.marker).map(b => ({ b, old: true }));
      blots = blots.filter(b => {
        const m = b.marker && App.images.get(b.marker);
        if (!m || App.devNoAlign) return true;
        for (const a of anchors) {
          const R = sameMembrane(App.images.get(a.b.marker), m);
          if (!R) continue;
          a.b.images.push(...b.images); b.images.forEach(id => init.set(id, round(R)));
          if (a.old) joined.add(a.b);
          return false;
        }
        anchors.push({ b, old: false });
        return true;
      });
      for (const b of blots) {
        App.S.blots.push(b);
        busy(true, `分析 ${App.blotName(b)}：对齐各张图、膜条、条带、泳道、Marker…`); await tick();
        alignAndAnalyze(b, init, false);
        App.S.rows.push(...App.rowsFromAnalysis(b));
      }
      for (const b of joined) { busy(true, `重新分析 ${App.blotName(b)}…`); await tick(); alignAndAnalyze(b, init, true); }
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

  /* ---------- pictures of one membrane taken in other places ----------
   * The membrane is often moved between captures (substrate added, the pieces put back by hand), so its pictures
   * do not all show it at the same place. Each is brought onto the grid of the membrane's reference picture —
   * the white-light photo of the place most pictures share — by a rigid transform, and pieces put back on their
   * own get one of their own: S.align[imgId] = {a, tx, ty, pieces: {pieceId: {a, tx, ty}}, how: 'auto' |
   * 'manual', by}, mapping reference coordinates to the picture's own. White-light photos are registered to the
   * reference by the edges of the membrane; exposures to each other by their bands (each paired with the one
   * most like it), then put on the place of a white-light photo they fit (each capture has a photo of its own).
   * The picture as taken stays in rec.raw (uncropped originals, another alignment); rec.img / rec.cs hold it
   * resampled onto the reference grid, so everything else works on aligned pictures. */
  const I0 = { a: 0, tx: 0, ty: 0 };
  const placesOf = new Map();      // blot id -> [{T, ids}]: where its white-light photos were taken (reference first)
  // registration features of a picture as taken
  const regOf = rec => {
    if (!rec._reg) { const raw = rec.raw || rec; rec._reg = WB.regFeatures(rec.kind === 'chemi' ? { w: raw.img.w, h: raw.img.h, data: raw.cs.sig } : raw.img, rec.kind); }
    return rec._reg;
  };
  // the membrane's extent in a picture (white light: its mask; exposure: where the signal is), full resolution
  function membraneBox(rec) {
    const t = rec.thumb, f = rec.img.w / t.w;
    const thr = rec.kind === 'marker' ? 0.5 : Array.from(t.data).sort((a, b) => a - b)[Math.floor(t.data.length * 0.9)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) if (t.data[y * t.w + x] > thr) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return x1 > x0 && y1 > y0 ? { x0: x0 * f, y0: y0 * f, x1: (x1 + 1) * f, y1: (y1 + 1) * f } : { x0: rec.img.w * 0.1, y0: rec.img.h * 0.1, x1: rec.img.w * 0.9, y1: rec.img.h * 0.9 };
  }
  const pieceBox = pc => { const F = pFrame(pc), xs = [], ys = []; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([i, j]) => { const [x, y] = WB.toImg(F, i * pc.w / 2, j * pc.h / 2); xs.push(x); ys.push(y); }); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; };
  const round = T => ({ a: Math.round(T.a * 1e4) / 1e4, tx: Math.round(T.tx * 100) / 100, ty: Math.round(T.ty * 100) / 100 });
  /* the white-light photo of another group shows the same membrane (moved): the transform, else null. As a
   * whole it matches almost perfectly — or, its pieces put back on their own, every piece does by itself. */
  function sameMembrane(refRec, rec) {
    if (!refRec || !rec || refRec.img.w !== rec.img.w || refRec.img.h !== rec.img.h) return null;
    const area = r => r.thumb.data.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0), ra = area(refRec), rb = area(rec);
    if (!(Math.min(ra, rb) > 0.75 * Math.max(ra, rb))) return null;
    const R = WB.registerRigid(regOf(refRec), regOf(rec), { coarse: true });
    if (App._dbg) App._dbg.push(`same? ${refRec.name}~${rec.name} areas ${ra}/${rb} T ${R.a.toFixed(2)},${R.tx.toFixed(1)},${R.ty.toFixed(1)} ncc ${R.ncc.toFixed(3)}`);
    if (R.ncc >= 0.9) return R;
    if (R.ncc < 0.5) return null;
    const raw = (refRec.raw || refRec).img;
    const strips = refRec._strips || (refRec._strips = WB.findStrips(raw, Math.max(1, Math.ceil(Math.max(raw.w, raw.h) / 760))));
    if (strips.length < 2) return null;
    // (by area: a piece partly out of view matches a little less)
    const P = WB.registerPieces(regOf(refRec), regOf(rec), R, strips);
    if (P.some(p => !p || p.ncc < 0.6)) return null;
    const total = strips.reduce((s, st) => s + st.w * st.h, 0), mean = P.reduce((s, p, k) => s + p.ncc * strips[k].w * strips[k].h, 0) / total;
    if (App._dbg) App._dbg.push(`  pieces ${P.map(p => `${p.a.toFixed(2)},${p.tx.toFixed(0)},${p.ty.toFixed(0)}/${p.ncc.toFixed(3)}`).join(' ')} mean ${mean.toFixed(3)}`);
    return mean >= 0.85 ? R : null;
  }
  /* transforms of all pictures of a membrane (S.align) onto the grid of blot.frame (a white-light photo of the
   * place most pictures share: the fewest resampled); init: known starting transforms (pictures of a group that
   * joined this membrane). The photo the analysis reads strips and ladder from (blot.marker) stays the one it
   * was — white-light photos taken after an exposure can show strong bands glowing through — resampled onto
   * the grid like the others. Then all are resampled. */
  App.alignBlot = function (blot, init) {
    const S = App.S; S.align = S.align || {};
    const mks = App.markersOf(blot), chs = App.chemiOf(blot), all = mks.concat(chs);
    if (!all.length) return;
    const W = all[0].img.w, H = all[0].img.h;
    let box = null;
    const set = (rec, T, by, extra) => {
      rec._regBy = by;
      if (S.align[rec.id] && S.align[rec.id].how === 'manual') return;
      if (!T || WB.regDist(T, I0, W, H, box) < 1) delete S.align[rec.id];
      else S.align[rec.id] = Object.assign(round(T), { how: 'auto', by }, extra || {});
    };
    // white-light photos against the first one, grouped by place; the reference is the place most share
    const places = [];
    if (mks.length) {
      const m0 = mks.find(m => m.id === blot.marker) || mks[0], R0 = regOf(m0);
      box = membraneBox(m0);
      const Ts = new Map([[m0.id, I0]]);
      mks.forEach(m => {
        if (m === m0) return;
        const R = WB.registerRigid(R0, regOf(m), { init: init && init.get(m.id) });
        m._regNcc = R.ncc;
        Ts.set(m.id, R.ncc > 0.6 ? R : (init && init.get(m.id)) || I0);
      });
      m0._regNcc = 1;
      mks.forEach(m => { const T = Ts.get(m.id), p = places.find(p => WB.regDist(T, p.T, W, H, box) < 1.5); if (p) p.ids.push(m.id); else places.push({ T, ids: [m.id] }); });
      places.sort((p, q) => q.ids.length - p.ids.length || q.ids.includes(m0.id) - p.ids.includes(m0.id));
      const inv = WB.regInverse(Ts.get(places[0].ids[0]));
      blot.frame = places[0].ids[0]; blot.marker = m0.id;
      places.forEach(p => { p.T = WB.regCompose(p.T, inv); });
      mks.forEach(m => set(m, WB.regCompose(Ts.get(m.id), inv), 'white light'));
    } else { box = membraneBox(chs[0]); blot.frame = null; }
    placesOf.set(blot.id, places);
    // exposures: all at the one place when every capture has its own white-light photo there
    chs.forEach(c => { c._place = null; });
    if (chs.length && places.length === 1 && mks.length >= chs.length) { chs.forEach(c => { c._place = places[0].ids[0]; set(c, I0, 'white light'); }); }
    else if (chs.length === 1) { chs[0]._place = places.length ? places[0].ids[0] : null; set(chs[0], places.length ? places[0].T : I0, 'white light'); }
    else if (chs.length > 1) {
      // exposures paired up with the ones most like them (a tree from the most typical one), each registered with
      // the weaker of the two as the reference (its bands are in the stronger one too)
      const F = chs.map(regOf), n = chs.length;
      F.forEach(x => { if (!x.pts) x.pts = WB.regPoints(x.hi); x.energy = x.energy || x.hi.data.reduce((s, v) => s + v, 0); });
      const cH = WB.regC(F[0].hi), sim = [...Array(n)].map(() => new Array(n).fill(-1));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) sim[i][j] = sim[j][i] = (WB.regNcc(F[i].hi, F[j].hi, I0, cH, F[i].pts) + WB.regNcc(F[j].hi, F[i].hi, I0, cH, F[j].pts)) / 2;
      const tot = sim.map(r => r.reduce((s, v) => s + Math.max(0, v), 0)), root = tot.indexOf(Math.max(...tot));
      const X = new Array(n), q = new Array(n).fill(1), inT = new Set([root]);
      X[root] = I0;
      const start = (i, j) => { const a = init && init.get(chs[i].id), b = init && init.get(chs[j].id); return a || b ? WB.regCompose(b || I0, WB.regInverse(a || I0)) : null; };
      while (inT.size < n) {
        let bi = -1, bj = -1, bs = -Infinity;
        inT.forEach(i => { for (let j = 0; j < n; j++) if (!inT.has(j) && sim[i][j] > bs) { bs = sim[i][j]; bi = i; bj = j; } });
        const s0 = start(bi, bj);
        let T, ncc;
        if (F[bj].energy <= F[bi].energy) { const R = WB.registerRigid(F[bj], F[bi], { init: s0 && WB.regInverse(s0), fit: 0.3 }); T = WB.regInverse(R); ncc = R.ncc; }
        else { const R = WB.registerRigid(F[bi], F[bj], { init: s0, fit: 0.3 }); T = R; ncc = R.ncc; }
        X[bj] = WB.regCompose(T, X[bi]); q[bj] = Math.min(q[bi], ncc); inT.add(bj);
      }
      if (places.length) {
        // where the most typical exposure was taken: the place that puts the most exposures on a place too
        const nearest = T => places.map(p => ({ p, d: WB.regDist(T, p.T, W, H, box) })).sort((a, b) => a.d - b.d)[0];
        let C0 = places[0].T, best = -1;
        places.forEach(pk => { const s = X.reduce((s, x, i) => s + (q[i] >= 0.5 && nearest(WB.regCompose(x, pk.T)).d < 4 ? 1 : 0), 0); if (s > best) { best = s; C0 = pk.T; } });
        // bands pin an exposure down to a few px: within 6 px of a place it was taken there; with a white-light
        // photo for every exposure each was taken at one of the places, the nearest (a weak exposure's bands
        // are a few px less sure)
        const own = mks.length >= chs.length;
        chs.forEach((c, i) => {
          const T = WB.regCompose(X[i], C0), nn = nearest(T);
          if (nn.d < 6 || (own && nn.d < 40) || q[i] < 0.5) { const p = nn.d < 40 || q[i] >= 0.5 ? nn.p : places[0]; c._place = p.ids[0]; set(c, p.T, 'white light'); }
          else set(c, T, 'bands');
        });
      } else chs.forEach((c, i) => set(c, X[i], 'bands'));
    }
    all.forEach(App.applyAlign);
  };
  /* pieces put back on their own: after the analysis found the pieces, each piece of each white-light photo
   * against the reference photo; exposures take the pieces of their place's photo (without white light:
   * against the most typical exposure). Returns whether anything changed (analyse again). */
  App.alignPieces = function (blot) {
    const S = App.S, pcs = blot.pieces || [];
    if (pcs.length < 2) return false;
    const mks = App.markersOf(blot), chs = App.chemiOf(blot), ref = blot.frame && App.images.get(blot.frame);
    if (!ref && !chs.length) return false;
    const W = (ref || chs[0]).img.w, H = (ref || chs[0]).img.h;
    let changed = false;
    const alT = r => S.align[r.id] ? { a: S.align[r.id].a, tx: S.align[r.id].tx, ty: S.align[r.id].ty } : I0;
    const setPieces = (rec, out) => {
      if (S.align[rec.id] && S.align[rec.id].how === 'manual') return;
      const before = JSON.stringify((S.align[rec.id] || {}).pieces || null);
      if (out && Object.keys(out).length) S.align[rec.id] = Object.assign(S.align[rec.id] || { a: 0, tx: 0, ty: 0, how: 'auto', by: rec._regBy || 'white light' }, { pieces: out });
      else if (S.align[rec.id]) { delete S.align[rec.id].pieces; if (WB.regDist(alT(rec), I0, W, H, pieceBox(pcs[0])) < 1e-6 && !S.align[rec.id].pieces) delete S.align[rec.id]; }
      if (JSON.stringify((S.align[rec.id] || {}).pieces || null) !== before) changed = true;
    };
    const fromResults = (P, base) => {
      const out = {};
      P.forEach((p, k) => { if (p && p.ncc >= 0.7 && p.ncc >= p.ncc0 + 0.02 && WB.regDist(p, base, W, H, pieceBox(pcs[k])) > 1.5) out[pcs[k].id] = round(p); });
      return out;
    };
    if (ref) {
      const R = regOf(ref);
      // a photo matching the reference almost perfectly as a whole has no piece out of place
      mks.forEach(m => { if (m !== ref) setPieces(m, (m._regNcc || 0) > 0.99 ? null : fromResults(WB.registerPieces(R, regOf(m), alT(m), pcs), alT(m))); });
      chs.forEach(c => { if (c._place) { const src = S.align[c._place]; setPieces(c, src && src.pieces ? JSON.parse(JSON.stringify(src.pieces)) : null); } });
    } else {
      const root = chs.find(c => !S.align[c.id]) || chs[0], R = regOf(root);
      chs.forEach(c => { if (c !== root && S.align[c.id]) setPieces(c, fromResults(WB.registerPieces(R, regOf(c), alT(c), pcs), alT(c))); });
    }
    if (changed) mks.concat(chs).forEach(App.applyAlign);
    return changed;
  };
  // align the pictures of a membrane, analyse it, and again if pieces turned out to be put back on their own
  function alignAndAnalyze(b, init, again) {
    if (!App.devNoAlign) App.alignBlot(b, init);       // (tests: &noalign=1 leaves every picture as taken)
    if (again) App.reanalyze(b); else App.analyze(b);
    if (!App.devNoAlign && App.alignPieces(b)) { if (again) App.reanalyze(b); else App.analyze(b); }
  }
  App.alignAndAnalyze = alignAndAnalyze;
  /* a picture resampled onto the reference grid as S.align says (none: as taken). Returns whether it changed. */
  App.applyAlign = function (rec) {
    const S = App.S, al = S && S.align && S.align[rec.id], b = al && S.blots.find(x => x.images.includes(rec.id));
    const pcs = al && al.pieces && b ? (b.pieces || []).filter(p => al.pieces[p.id]).map(p => ({ cx: p.cx, cy: p.cy, angle: p.angle, w: p.w, h: p.h, T: al.pieces[p.id] })) : [];
    const moved = al && (pcs.length || Math.abs(al.a) > 1e-9 || Math.abs(al.tx) > 1e-9 || Math.abs(al.ty) > 1e-9);
    const key = moved ? JSON.stringify([al.a, al.tx, al.ty, pcs]) : '';
    if ((rec._alignKey || '') === key) return false;
    const raw = rec.raw || { img: rec.img, cs: rec.cs };
    if (!moved) { rec.img = raw.img; rec.cs = raw.cs; rec.raw = null; }
    else {
      rec.raw = raw;
      const { w, h } = raw.img;
      if (rec.kind === 'chemi') {
        // an exposure is only read through its signal once loaded: that alone is resampled (outside the picture:
        // the background, its median)
        const sig = WB.regWarp({ w, h, data: raw.cs.sig }, al, pcs, WB.mad(raw.cs.sig, 97).med, raw.cs.clip === Infinity ? undefined : raw.cs.clip);
        rec.cs = Object.assign({}, raw.cs, { sig });
        rec.img = { w, h, data: sig };
      } else rec.img = { w, h, data: WB.regWarp(raw.img, al, pcs, G.Engine.percentiles(raw.img.data, [5], 37)[0]) };
    }
    rec._alignKey = key; rec.thumb = thumbOf(rec); rec._disp = null; rec._sat = null;
    App.clearCaches();
    return true;
  };
  App.syncAlign = () => { let n = 0; App.images.forEach(r => { if (App.applyAlign(r)) n++; }); return n; };
  App.alignOf = id => (App.S && App.S.align && App.S.align[id]) || null;
  // whether a picture is resampled at all (moved as a whole or piece by piece)
  App.isMoved = id => { const al = App.alignOf(id); return !!al && (!!al.pieces || Math.abs(al.a) > 1e-9 || Math.abs(al.tx) > 1e-9 || Math.abs(al.ty) > 1e-9); };
  // the middle of a membrane on its grid (its pieces), else of the picture
  App.membraneCentre = function (b) {
    const pcs = (b && b.pieces) || [];
    if (pcs.length) return [pcs.reduce((s, p) => s + p.cx, 0) / pcs.length, pcs.reduce((s, p) => s + p.cy, 0) / pcs.length];
    const r = b && App.images.get(b.images[0]);
    return r ? [r.img.w / 2, r.img.h / 2] : [0, 0];
  };
  // how a picture lies relative to the grid, in words: the turn and the shift of the membrane's middle
  App.alignText = function (id) {
    const al = App.alignOf(id), rec = App.images.get(id), b = App.S.blots.find(x => x.images.includes(id));
    if (!al || !rec) return '';
    const [cx, cy] = App.membraneCentre(b), [x, y] = WB.regPoint(al, rec.img.w, rec.img.h, cx, cy), d = Math.hypot(x - cx, y - cy);
    const n = al.pieces ? Object.keys(al.pieces).length : 0;
    return `旋转 ${Math.abs(al.a) < 0.05 ? '0' : al.a.toFixed(1)}°、平移 ${d < 1 ? '<1' : Math.round(d)} px${n ? `；${n} 条膜条另外单独对齐` : ''}`;
  };
  /* turning the transform by hand (the picture's content on the grid): shifted by (dx, dy), turned by deg
   * about (px, py). T maps the grid to the picture, so the content moves the other way. */
  const rotDeg = (deg, x, y) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c * x - s * y, s * x + c * y]; };
  App.alignShifted = (T, dx, dy) => { const [x, y] = rotDeg(T.a, dx, dy); return { a: T.a, tx: T.tx - x, ty: T.ty - y }; };
  App.alignTurned = (T, deg, px, py, W, H) => {
    const P = [px - W / 2, py - H / 2], [x1, y1] = rotDeg(T.a, P[0], P[1]), [x2, y2] = rotDeg(T.a - deg, P[0], P[1]);
    return { a: T.a - deg, tx: T.tx + x1 - x2, ty: T.ty + y1 - y2 };
  };
  // a point of the grid (on piece pcId) in the picture as taken
  App.rawPoint = function (id, pcId, x, y) {
    const al = App.alignOf(id), rec = App.images.get(id);
    if (!al || !rec) return [x, y];
    return WB.regPoint((al.pieces && al.pieces[pcId]) || al, rec.img.w, rec.img.h, x, y);
  };
  // set by hand (the whole picture; pieces keep their own shift relative to it)
  App.setAlign = function (id, T) {
    const S = App.S, old = S.align[id], rec = App.images.get(id);
    if (!rec) return;
    if (!T) { S.align[id] = { a: 0, tx: 0, ty: 0, how: 'manual', by: 'hand' }; }
    else S.align[id] = Object.assign(round(T), { how: 'manual', by: 'hand' }, old && old.pieces ? { pieces: old.pieces } : {});
    App.applyAlign(rec);
  };
  // back to the automatic alignment of the membrane
  App.autoAlign = function (id) {
    const S = App.S, b = S.blots.find(x => x.images.includes(id));
    if (S.align[id]) delete S.align[id];
    if (b) alignAndAnalyze(b, null, true);
  };

  /* ---------- analysis ---------- */
  App.analyze = function (blot) {
    const ch = App.chemiOf(blot);
    if (blot.marker && (!blot.images.includes(blot.marker) || (App.images.get(blot.marker) || {}).kind !== 'marker')) blot.marker = null;
    if (!blot.marker) { const m = App.markersOf(blot)[0]; blot.marker = m ? m.id : null; }
    const mk = blot.marker ? App.images.get(blot.marker) : null;
    if (!ch.length) { App.analysis[blot.id] = null; blot.pieces = []; return null; }
    // the white-light photo as taken, with where it lies on the grid (strips and ladder are read from it unresampled)
    const al = mk && App.alignOf(mk.id), mPcs = al && al.pieces ? (blot.pieces || []).filter(p => al.pieces[p.id]).map(p => ({ cx: p.cx, cy: p.cy, angle: p.angle, w: p.w, h: p.h, T: al.pieces[p.id] })) : [];
    const A = WB.analyzeSession(ch.map(r => ({ id: r.id, img: r.img, exposure: r.exposure, cs: r.cs })), mk && { id: mk.id, img: (mk.raw || mk).img, T: al ? { a: al.a, tx: al.tx, ty: al.ty } : null, pieces: mPcs },
      { ladderId: blot.ladderAuto ? null : blot.ladderId, prefLadder: App.prefLadder, noChemiCheck: !!App.devNoChemi, strips: blot.userStrips || null });
    A.chemiIds = ch.map(r => r.id);
    A.H = ch[0].img.h;
    A._strips = JSON.stringify(blot.userStrips || null);
    App.analysis[blot.id] = A;
    if (blot.ladderAuto || !blot.ladderId) blot.ladderId = A.ladderId;
    A._calLadder = A.ladderId;
    // pieces, in analysis order; a piece found again at the same place (each old piece once, nearest first)
    // keeps its id and the marker bands set by hand, moved along with it
    const old = blot.pieces || [];
    const fresh = A.pieces.map(p => Object.assign({ id: uid('p'), marks: null }, JSON.parse(JSON.stringify(p))));
    const pairs = [];
    // pieces set by hand are themselves, in order (ids from the user's list); found ones: the old piece at the
    // same place
    if (blot.userStrips) fresh.forEach((n, k) => { const us = blot.userStrips[k], o = us && old.find(p => p.id === us.id); if (us) n.id = us.id; if (o) pairs.push({ n, o, d: 0 }); });
    else fresh.forEach(n => old.forEach(o => { const d = Math.hypot(o.cx - n.cx, o.cy - n.cy); if (d < 40 && Math.abs(o.w - n.w) < 60 && Math.abs(o.h - n.h) < 60) pairs.push({ n, o, d }); }));
    const taken = new Set();
    pairs.sort((a, c) => a.d - c.d).forEach(({ n, o }) => {
      if (taken.has(n) || taken.has(o)) return;
      taken.add(n); taken.add(o);
      n.id = o.id; n.marks = o.marks ? o.marks.map(m => Object.assign({}, m, carry(o, n, m.u, m.v))) : null;
    });
    blot.pieces = fresh;
    letterPieces(blot);
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
  /* Re-run after the user changed which pictures belong to a membrane, their kind or their alignment. The rows
   * stay as they are — boxes, lanes, figure columns, order, names: what the user arranged is not undone by a
   * fresh detection. Each box is carried onto the piece now found under it (the same place on the membrane); a
   * piece no longer found keeps the boxes on it. Lanes on a ladder lane found only now become marker lanes.
   * A membrane without rows yet gets the rows detected (opt.fresh: always; the user asked to detect again). */
  App.reanalyze = function (blot, opt) {
    const rows = App.S.rows.filter(r => r.blot === blot.id);
    const oldPcs = (blot.pieces || []).map(p => JSON.parse(JSON.stringify(p)));
    App.analyze(blot);
    if (!App.analysis[blot.id]) { App.S.rows = App.S.rows.filter(r => r.blot !== blot.id); return; }
    if (!rows.length || (opt && opt.fresh)) {
      const fresh = App.rowsFromAnalysis(blot), at = App.S.rows.findIndex(r => r.blot === blot.id);
      App.S.rows = App.S.rows.filter(r => r.blot !== blot.id);
      App.S.rows.splice(at < 0 ? App.S.rows.length : at, 0, ...fresh);
    } else carryRows(blot, oldPcs, rows);
    App.fitLanes(false);
  };
  function carryRows(blot, oldPcs, rows) {
    const pcs = blot.pieces;
    const hadLadder = new Map(oldPcs.map(p => [p.id, (p.ladderUs || []).length > 0]));
    rows.forEach(row => {
      const out = [], before = App.segsState(row);
      row.segs.forEach(sg => {
        const op = oldPcs.find(p => p.id === sg.piece);
        if (!op) return;
        const [mx, my] = WB.toImg(pFrame(op), (sg.x0 + sg.x1) / 2, sg.vc);
        // (pieces set by hand: one taken away hands its boxes to the nearest one left)
        let np = pcs.find(p => p.id === op.id) || (App.pieceAt(blot, mx, my, blot.userStrips ? Infinity : 0) || {}).pc;
        // no piece there any more: the old one stays (its own marker bands; no automatic sizes)
        if (!np) { np = Object.assign(JSON.parse(JSON.stringify(op)), { strip: -1 }); pcs.push(np); }
        const at = (u, v) => carry(op, np, u, v), m = at((sg.x0 + sg.x1) / 2, sg.vc), du = m.u - (sg.x0 + sg.x1) / 2;
        const t = Object.assign({}, sg, { piece: np.id, vc: m.v, x0: sg.x0 + du, x1: sg.x1 + du, lanes: sg.lanes.map(l => ({ u: at(l.u, sg.vc).u, r: l.r })) });
        // a ladder lane found only now (a white-light picture added): the lanes on it are marker lanes
        if (!hadLadder.get(op.id) && (np.ladderUs || []).length) {
          const p = App.segPitch(t);
          t.lanes.forEach(l => { if (l.r === 's' && App.roleAt(np, l.u, p) === 'm') l.r = 'm'; });
        }
        // two boxes of the row now on one piece: one box over both
        const same = out.find(s => s.piece === np.id);
        if (same) {
          const p = App.segPitch(same);
          t.lanes.forEach(l => { if (!same.lanes.some(k => Math.abs(k.u - l.u) < p * 0.3)) same.lanes.push(l); });
          same.lanes.sort((a, c) => a.u - c.u);
          same.x0 = Math.min(same.x0, t.x0); same.x1 = Math.max(same.x1, t.x1);
        } else out.push(t);
      });
      row.segs = out;
      if (out.length === before.length) App.keepJoined(row, out[0], before);
      out.forEach(App.snapBox);
    });
    App.S.rows = App.S.rows.filter(r => r.blot !== blot.id || r.segs.length);
    letterPieces(blot);
  }
  /* the pieces of a membrane set by hand (moved, resized, turned, drawn, taken away): the analysis reads the
   * ladder in these from now on; the boxes stay where they are on the picture. null: found automatically again. */
  App.setPieces = function (blot, list) {
    blot.userStrips = list ? list.map(p => ({ id: p.id, cx: p.cx, cy: p.cy, angle: Math.round(p.angle * 100) / 100, w: p.w, h: p.h })) : null;
    App.reanalyze(blot);
    App.syncAlign();          // (pieces aligned on their own are resampled over their new outline)
  };
  // after undo / redo: a membrane whose pieces set by hand differ from what was analysed is analysed again
  App.syncPieces = () => App.S.blots.forEach(b => { const A = App.analysis[b.id]; if (A && A._strips !== JSON.stringify(b.userStrips || null)) App.analyze(b); });
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
    // (lanes gained left of column 1 go below it for now: the commit makes room on the left for every row)
    let c0 = base.c0;
    const stay = base.lanes.find(l => l.r === 's' && inside(l));
    if (stay) {
      const col = base.c0 + base.lanes.filter(l => l.r === 's' && l.u < stay.u - 1e-6).length;
      c0 = col - L.filter(l => l.r === 's' && l.u < stay.u - 1e-6).length;
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
  /* GelFigure's way: lanes on one membrane come from one comb, so once the first and last lane lines sit on their
   * lanes every lane between follows from the count. An end lane dragged to u (lanes as before the drag: base)
   * spreads the lanes between evenly; any other lane moves alone. */
  App.dragLane = function (sg, i, u, base) {
    const L = base.lanes, n = L.length;
    if (n < 3 || (i !== 0 && i !== n - 1)) { App.moveLane(sg, i, u); return; }
    const a = i === 0 ? Math.min(u, L[n - 1].u - 3 * (n - 1)) : L[0].u, z = i === n - 1 ? Math.max(u, L[0].u + 3 * (n - 1)) : L[n - 1].u;
    sg.lanes = L.map((l, k) => ({ u: a + (z - a) * k / (n - 1), r: l.r }));
    sg.p = (z - a) / (n - 1);
  };
  // n lanes spaced evenly between the box's first and last lane, which stay (one lane: across the box); a lane
  // keeps its role (sample / left out / marker) when one was close by
  App.evenEnds = function (row, sg, n) {
    const L = sg.lanes, pc = App.pieceOf(row, sg);
    n = Math.max(1, Math.min(60, Math.round(n || L.length)));
    if (L.length < 2 || n < 2) return App.evenBox(row, sg, n);
    const a = L[0].u, z = L[L.length - 1].u, p = (z - a) / (n - 1), old = App.segPitch(sg);
    sg.lanes = Array.from({ length: n }, (_, k) => {
      const u = a + k * p, near = L.slice().sort((x, y) => Math.abs(x.u - u) - Math.abs(y.u - u))[0];
      return { u, r: near && Math.abs(near.u - u) < Math.min(p, old) * 0.45 ? near.r : App.roleAt(pc, u, p) };
    });
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
    if (i < 0) return false;
    row.segs.slice(i).forEach(t => { t.c0 += d; });
    roomLeft();
    return true;
  };

  /* ---------- arranging the figure: the order of the rows, the lanes lined up across pieces ----------
   * Every piece is a module of its own (its own angle, lanes, marker); the figure stacks rows in any order
   * and lines up each piece's lanes with the others' as needed (e.g. lanes 4-6 of one piece over lanes 1-3
   * of another, when the membrane was cut). */
  // room on the left: every column moves right by s, the lane names, conditions and groups with it
  App.makeRoom = function (s) {
    if (!(s > 0)) return;
    const S = App.S;
    S.rows.forEach(r => r.segs.forEach(sg => { sg.c0 += s; }));
    for (let k = 0; k < s; k++) S.lanes.unshift({ name: '', hidden: false });
    S.conditions.forEach(c => { for (let k = 0; k < s; k++) c.values.unshift(''); });
    S.groups.forEach(g => { g.from += s; g.to += s; });
    S.range = [S.range[0] <= 1 ? 1 : S.range[0] + s, S.range[1] + s];
    S.hiCol += s;
  };
  function roomLeft() {
    const lo = Math.min(...App.S.rows.flatMap(r => r.segs.map(s => s.c0)));
    if (lo < 1) App.makeRoom(1 - lo);
  }
  // the figure columns of everything on the piece of box sg moved by d (a piece's rows share its lanes), or
  // with onlyBox just that box; left of column 1 makes room on the left. Returns the number of boxes moved.
  App.shiftAlign = function (row, sg, d, onlyBox) {
    const segs = onlyBox ? [sg] : App.S.rows.flatMap(r => r.segs.filter(s => s.piece === sg.piece));
    segs.forEach(s => { s.c0 += d; });
    roomLeft();
    return segs.length;
  };
  // a row put before the row now at index `to` of S.rows (S.rows.length: at the end); the figure stacks rows
  // in this order. Returns whether anything moved.
  App.moveRow = function (id, to) {
    const rows = App.S.rows, i = rows.findIndex(r => r.id === id);
    if (i < 0) return false;
    const [r] = rows.splice(i, 1);
    const at = Math.max(0, Math.min(rows.length, to > i ? to - 1 : to));
    rows.splice(at, 0, r);
    return at !== i;
  };
  // one place up (-1) or down (+1) among the rows the figure shows (a hidden row: among all rows)
  App.moveRowBy = function (id, d) {
    const row = App.row(id); if (!row) return false;
    const list = row.hidden ? App.S.rows : App.S.rows.filter(r => !r.hidden), i = list.indexOf(row), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return false;
    return App.moveRow(id, App.S.rows.indexOf(list[j]) + (d > 0 ? 1 : 0));
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
    // columns past the last row (a piece dragged right and back again): gone when nothing was set for them
    const blank = n => { const l = S.lanes[n - 1]; return !l.name && !l.hidden && S.conditions.every(c => !c.values[n - 1]) && S.groups.every(g => Math.max(g.from, g.to) < n); };
    while (S.lanes.length > hi && blank(S.lanes.length)) S.lanes.pop();
    S.conditions.forEach(c => {
      while (c.values.length < S.lanes.length) c.values.push('');
      while (c.values.length > S.lanes.length && !c.values[c.values.length - 1]) c.values.pop();
    });
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
  // the recommended exposure of every row as of the last change (drawn while dragging, when scoring every
  // exposure on every mouse move would be far too slow)
  const bestSeen = new Map();
  App.bestSeen = row => bestSeen.get(row.id) || null;
  App.refreshChoices = function (forceLevels) {
    const S = App.S;
    S.rows.forEach(r => {
      const ex = App.rowExpo(r);
      if (!ex.length) return;
      const best = ex[WB.chooseExposure(ex)].id;
      bestSeen.set(r.id, best);
      if (r.auto || !ex.some(e => e.id === r.img)) r.img = best;
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
    // what the box covers, wherever it lies (the pieces found are only a guess; outside the picture: background)
    const ctx = cv.getContext('2d'), id = ctx.createImageData(win.w, win.h), map = App.mapper(row.img);
    for (let k = 0; k < win.w * win.h; k++) { const val = map(win.data[k]); id.data[k * 4] = id.data[k * 4 + 1] = id.data[k * 4 + 2] = val; id.data[k * 4 + 3] = 255; }
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
  // pictures changed (aligned again): everything computed from their pixels
  App.clearCaches = () => { expoCache.clear(); rasterCache.clear(); thumbCache.clear(); peakCache.clear(); };

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
  /* a row from a box drawn anywhere (frame units of piece pcId): the figure shows exactly the box drawn, split
   * into lanes of equal width — as many as the lane spacing found in the box says (the end lanes can then be
   * dragged onto their bands, the lanes between follow). The box belongs to the piece under its middle. */
  App.addRowBox = function (blotId, pcId, u0, u1, v0, v1) {
    const b = App.blot(blotId), pc = App.piece(b, pcId), ch = App.chemiOf(b);
    if (!pc || !ch.length) return null;
    const half = Math.max(3, (v1 - v0) / 2);
    const sg = { piece: pc.id, vc: (v0 + v1) / 2, b0: -half / 2, b1: half / 2, lanes: [], c0: 1, p: pc.pitch || 100, x0: u0, x1: u1 };
    const row = { id: uid('r'), blot: blotId, name: '', img: ch[ch.length - 1].id, auto: true, hidden: false, manual: true, segs: [sg], above: half, below: half };
    App.redetectBox(row, sg);
    const p = sg.lanes.length >= 2 ? App.segPitch(sg) : pc.pitch || 100;
    sg.x0 = u0; sg.x1 = u1;
    App.evenBox(row, sg, Math.max(1, Math.round((u1 - u0) / p)));
    App.rehomeSeg(row, sg);
    App.alignSeg(row, sg);
    App.findBand(row, sg);
    insertRow(row);
    return row;
  };
  /* a box moved (or drawn) onto another piece belongs to that piece from then on (its sizes, its module in the
   * figure); it stays where it is on the picture. Not when the row has a box on that piece already. */
  App.rehomeSeg = function (row, sg) {
    const b = App.blot(row.blot), op = App.piece(b, sg.piece);
    if (!op) return null;
    const mid = (sg.x0 + sg.x1) / 2, [mx, my] = WB.toImg(pFrame(op), mid, sg.vc), hit = App.pieceAt(b, mx, my, 0);
    if (!hit || hit.pc === op || row.segs.some(s => s !== sg && s.piece === hit.pc.id)) return null;
    const np = hit.pc, vc0 = sg.vc, m = carry(op, np, mid, vc0), du = m.u - mid;
    sg.lanes = sg.lanes.map(l => ({ u: carry(op, np, l.u, vc0).u, r: l.r }));
    sg.x0 += du; sg.x1 += du; sg.vc = m.v; sg.piece = np.id;
    return np;
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
  /* one protein on a membrane cut through: the boxes of `other` join `row`, side by side (row keeps its place
   * and name). Refused when that would put two proteins in one row: other membranes (other pictures), two
   * bands of one piece, or pieces one above the other on the same lanes. */
  App.mergeRows = function (row, other) {
    if (!row || !other || row === other) return 'none';
    if (row.blot !== other.blot) return 'blot';
    if (other.segs.some(s => row.segs.some(t => t.piece === s.piece))) return 'same';
    if (App.rowPieces(other).some(q => App.stacked(row, q))) return 'stacked';
    App.joinRows(row, other);
    return 'joined';
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
  // a size suggestion for a new mark at v: the ladder size nearest to what the piece's sizes predict, preferring
  // one the piece has no mark for yet (when it is not much further off)
  App.suggestKda = function (b, pc, v) {
    const pcal = App.pieceCal(b, pc), k = pcal && WB.kdaAtK(pcal, v), lad = G.ProteinLadders.get(b.ladderId);
    if (!k) return null;
    if (!lad) return Math.round(k);
    const taken = (pc.marks || []).map(m => m.kda), off = s => Math.abs(Math.log(s / k));
    const free = lad.sizes.filter(s => !taken.some(t => Math.abs(Math.log(t / s)) < 0.01) && off(s) < 0.25);
    return (free.length ? free : lad.sizes).slice().sort((p, q) => off(p) - off(q))[0];
  };
  // the white-light picture a membrane's marker is read from
  App.markerRec = b => (b && b.marker && App.images.get(b.marker)) || null;
  // the lane a piece's marks sit on: their own, else the piece's (first) ladder lane
  App.markLane = pc => { const ms = (pc.marks || []).map(m => m.u).sort((a, c) => a - c); return ms.length ? ms[ms.length >> 1] : App.ladderU(pc); };
  /* dark bands down lane u of a piece in the white-light picture (piece frame v, top to bottom): where a mark
   * snaps to. Darkness against the lane's own brightness around it (a closing over about ±24 px). */
  const peakCache = new Map();
  App.ladderPeaks = function (b, pc, u) {
    const rec = App.markerRec(b);
    if (!rec || !pc) return [];
    const key = [rec.id, rec._alignKey || '', pc.cx, pc.cy, pc.angle, pc.w, pc.h, Math.round(u)].join('|');
    if (peakCache.has(key)) return peakCache.get(key);
    const F = pFrame(pc), hw = Math.max(5, Math.min(pc.pitch || 60, 160) * 0.28), v0 = -pc.h / 2 + 4, n = Math.max(0, Math.floor(pc.h - 8));
    const prof = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let s = 0, c = 0;
      for (let du = -hw; du <= hw; du += 2) { const [x, y] = WB.toImg(F, u + du, v0 + k), val = WB.bilinear(rec.img, x, y); if (!isNaN(val)) { s += val; c++; } }
      prof[k] = c ? s / c : 0;
    }
    const E = G.Engine, sm = E.gaussSmooth(prof, 1.2), r = 24, bg = E.slide(E.slide(sm, r, true), r, false), dark = new Float32Array(n);
    let mx = 0; for (let k = 0; k < n; k++) { dark[k] = Math.max(0, bg[k] - sm[k]); mx = Math.max(mx, dark[k]); }
    const out = mx > 0 ? E.findPeaks(dark, 5, mx * 0.12).map(p => ({ v: v0 + p.i, prom: p.prom / mx })).sort((a, c) => a.v - c.v) : [];
    if (peakCache.size > 200) peakCache.clear();
    peakCache.set(key, out);
    return out;
  };
  // the dark band nearest to v within tol (piece frame px), else v itself
  App.snapMarkV = function (b, pc, u, v, tol) {
    let best = null;
    App.ladderPeaks(b, pc, u).forEach(p => { const d = Math.abs(p.v - v); if (d <= tol && (!best || d < best.d)) best = { v: p.v, d }; });
    return best ? best.v : v;
  };
  /* a piece's marker for the panel: 'manual' (marks set or confirmed by hand; 'few': one mark and no slope to
   * size with), 'auto' (read automatically, not checked yet), 'none'; and the sizes it shows */
  App.markInfo = function (b, pc) {
    if (pc.marks && pc.marks.length) {
      const ks = pc.marks.filter(m => m.kda > 0).map(m => m.kda).sort((a, c) => c - a), pcal = App.pieceCal(b, pc);
      return { state: ks.length >= 2 || (ks.length && pcal && pcal.c < 0) ? 'manual' : 'few', ks };
    }
    const ks = App.pieceTicks(b, pc).map(t => t.k);
    return ks.length ? { state: 'auto', ks } : { state: 'none', ks: [] };
  };
  // marks of every piece of a membrane back to the automatic reading
  App.autoMarks = b => (b.pieces || []).forEach(pc => { pc.marks = null; });
  /* the sizes read automatically, checked by the user: every such piece's marks set by hand from now on (the
   * bands seen; a piece where none was seen keeps the sizes as shown). The number of pieces confirmed. */
  App.confirmMarks = function (b) {
    let n = 0;
    (b.pieces || []).forEach(pc => {
      if (App.markInfo(b, pc).state !== 'auto') return;
      const ticks = App.pieceTicks(b, pc), u = App.ladderU(pc);
      if (!App.manualMarks(b, pc).length) pc.marks = ticks.map(t => ({ u, v: t.v, kda: t.k }));
      n++;
    });
    return n;
  };
  // pieces whose sizes the figure uses (a shown row runs across them)
  App.usedPieces = b => (b.pieces || []).filter(pc => App.S.rows.some(r => !r.hidden && r.blot === b.id && r.segs.some(s => s.piece === pc.id)));

  /* ---------- membranes: moving pictures between them ---------- */
  App.moveImage = function (imgId, toBlotId) {
    const S = App.S, from = S.blots.find(b => b.images.includes(imgId));
    let to = toBlotId === 'new' ? null : App.blot(toBlotId);
    if (!to) { to = newBlot([], null); S.blots.push(to); }
    if (from === to) return;
    if (from) { from.images = from.images.filter(i => i !== imgId); if (from.marker === imgId) from.marker = null; }
    to.images.push(imgId);
    // put onto the other membrane's grid (it may lie elsewhere in the picture), then analysed again
    if (S.align[imgId] && S.align[imgId].how === 'manual') delete S.align[imgId];
    [from, to].forEach(b => { if (b && b.images.length) alignAndAnalyze(b, null, true); });
    if (from && !from.images.length) { S.blots = S.blots.filter(b => b !== from); S.rows = S.rows.filter(r => r.blot !== from.id); }
  };
  App.setKind = function (imgId, kind) {
    const rec = App.images.get(imgId);
    if (!rec || rec.kind === kind) return;
    // as taken again: the alignment was for the other kind of picture
    delete App.S.align[imgId]; App.applyAlign(rec); rec._reg = null;
    rec.kind = kind; prepare(rec);
    const b = App.S.blots.find(b => b.images.includes(imgId));
    if (b) { if (kind === 'marker' && !b.marker) b.marker = imgId; alignAndAnalyze(b, null, true); }
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
    delete S.levels[imgId]; delete S.align[imgId];
    if (!b) return;
    b.images = b.images.filter(i => i !== imgId);
    if (b.marker === imgId) b.marker = null;
    if (!b.images.length) { S.blots = S.blots.filter(x => x !== b); S.rows = S.rows.filter(r => r.blot !== b.id); }
    else alignAndAnalyze(b, null, true);
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
        warn.push(`${App.blotName(b)}${b.marker ? '的 Marker 条带没能自动识别' : '没有 Marker 图'}，未标 kDa：在左侧第 2 步点"在白光图上核对 / 标注 Marker"，标出 2 条 Marker 带`);
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
