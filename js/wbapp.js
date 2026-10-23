/* BlotFigure application state.
 * images (not undoable): decoded pictures with kind (chemi | marker), exposure and signal.
 * S (undoable): membranes ("blots") with their pieces, figure rows (one per protein), figure lanes
 * (columns), levels, annotations.
 * A row has a segment on each piece it runs across. Every segment is a box in its piece's frame (u along the
 * lanes, v down) — anywhere on the picture, not bound by the piece's outline; the piece gives its tilt, its
 * marker sizes; each box has its own id, label and figure position: x0..x1 across, vc-above … vc+below down (band b0..b1 around vc), and it has
 * lanes of its own — sg.lanes [{u, r}] with r 's' sample | 'm' marker | 'x' left out. The sample lanes fill
 * figure columns sg.c0, sg.c0+1, … in order. Lanes come from the analysis (the piece's lattice), from the
 * box's own pixels (WB.detectBoxLanes) or from the user; resizing a box keeps the lanes inside it and
 * continues their spacing into new room.
 * pc.marks (marker bands set by hand, {u, v, kda}) replace the automatic ladder calibration of a piece.
 */
(function (G) {
  'use strict';
  const WB = G.WB;
  const L = G.L || (zh => zh);
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
  App.VERSION = '0.12.0';
  App.activeColumn = 'main';
  const columnFields = new Set(['lanes', 'range', 'hiCol', 'groups', 'conditions']);
  App.layoutColumns = () => App.S.layoutColumns || (App.S.layoutColumns = [{ id: 'main', title: '', titleSide: 'top' }]);
  App.rowColumn = r => r.column || 'main';
  App.columnData = id => !id || id === 'main' ? App.S : App.layoutColumns().find(c => c.id === id) || App.S;
  App.rowsInColumn = id => App.S.rows.filter(r => App.rowColumn(r) === (id || 'main'));
  App.columnState = id => ({ ...App.S, ...Object.fromEntries([...columnFields].map(k => [k, App.columnData(id)[k]])), rows: App.rowsInColumn(id) });
  App.uiState = () => App.S && new Proxy(App.S, {
    get: (s, k) => columnFields.has(k) ? App.columnData(App.activeColumn)[k] : s[k],
    set: (s, k, v) => { (columnFields.has(k) ? App.columnData(App.activeColumn) : s)[k] = v; return true; }
  });
  App.addColumn = () => {
    const c = { id: uid('col'), title: '', titleSide: 'top', lanes: [], range: [1, 1], hiCol: 0, conditions: [], groups: [] };
    App.layoutColumns().push(c); App.activeColumn = c.id; return c;
  };
  App.removeColumn = id => {
    if (App.layoutColumns().length < 2 || App.rowsInColumn(id).length) return false;
    const remaining = App.layoutColumns().filter(c => c.id !== id);
    if (id === 'main') {
      const next = remaining[0], oldId = next.id;
      columnFields.forEach(k => { App.S[k] = next[k]; });
      App.rowsInColumn(oldId).forEach(r => { r.column = 'main'; }); next.id = 'main';
      columnFields.forEach(k => { delete next[k]; });
    }
    App.S.layoutColumns = remaining; App.activeColumn = 'main'; return true;
  };
  App.moveToColumn = (row, id, beforeId) => {
    if (!row || !App.S.rows.includes(row) || !App.layoutColumns().some(c => c.id === id)) return false;
    const from = App.rowColumn(row); row.column = id;
    const rows = App.S.rows, old = rows.indexOf(row); rows.splice(old, 1);
    let at = beforeId ? rows.findIndex(r => r.id === beforeId && App.rowColumn(r) === id) : -1;
    if (at < 0) { const last = rows.map(r => App.rowColumn(r)).lastIndexOf(id); at = last < 0 ? rows.length : last + 1; }
    rows.splice(at, 0, row); App.activeColumn = id;
    if (from !== id) { App.fitLanes(true, from); App.fitLanes(true, id); }
    return true;
  };
  App.copyColumnLabels = (from, to) => {
    if (from === to) return;
    const a = App.columnData(from), b = App.columnData(to), clone = x => JSON.parse(JSON.stringify(x));
    const n = Math.max(0, ...App.rowsInColumn(to).flatMap(r => r.segs.map(App.segEnd))) || a.lanes.length;
    b.lanes = Array.from({ length: n }, (_, i) => ({ name: (a.lanes[i] || {}).name || '', hidden: false }));
    b.conditions = clone(a.conditions).map(c => ({ ...c, values: Array.from({ length: n }, (_, i) => c.values[i] || '') }));
    b.groups = clone(a.groups).filter(g => g.from <= n).map(g => ({ ...g, to: Math.min(n, g.to) }));
    App.fitLanes(true, to);
  };
  App.pasteConditions = (raw, id, replace) => {
    const rows = String(raw).replace(/\r/g, '').replace(/\n+$/, '').split('\n');
    if (!raw.trim()) return { error: L('先粘贴条件表格。', 'Paste a condition table first.') };
    const fl = App.figLanes(id), data = App.columnData(id), cells = rows.map(s => s.split('\t'));
    if (cells.some(r => r.length - 1 > fl.length)) return { error: L('表格的值多于本列显示的泳道，请检查泳道范围或表格。', 'More values than visible lanes in this column. Check the lane range or table.') };
    const conditions = cells.map(r => { const values = data.lanes.map(() => ''); fl.forEach((j,i) => { values[j - 1] = (r[i + 1] || '').trim(); }); return { name: r[0].trim(), values }; });
    data.conditions = replace ? conditions : data.conditions.concat(conditions);
    return { count: conditions.length };
  };
  App.markerId = m => m.id || (m.id = uid('mark'));
  const retiredImages = new Map(); // reversible removal; only active images are saved/exported
  App.activeImageIds = () => new Set((App.S ? App.S.blots : []).flatMap(b => b.images));
  App.syncImages = () => {
    const active = App.activeImageIds();
    App.images.forEach((r, id) => { if (!active.has(id)) { retiredImages.set(id, r); App.images.delete(id); } });
    active.forEach(id => { if (!App.images.has(id) && retiredImages.has(id)) { App.images.set(id, retiredImages.get(id)); retiredImages.delete(id); } });
  };
  App.boxId = sg => sg.id || (sg.id = uid('box'));
  App.boxLabel = sg => {
    if (!sg.label) sg.label = 'B' + (1 + Math.max(0, ...(App.S ? App.S.rows : []).flatMap(r => r.segs.map(s => +(s.label || '').slice(1) || 0))));
    return sg.label;
  };
  App.boxAbove = (r, s) => s.above == null ? r.above : s.above;
  App.boxBelow = (r, s) => s.below == null ? r.below : s.below;
  App.fitRowHeight = r => { r.above = Math.max(...r.segs.map(s => App.boxAbove(r, s))); r.below = Math.max(...r.segs.map(s => App.boxBelow(r, s))); };
  App.prefLadder = G.PrefStorage.getItem('blotfig.ladder') || null;

  /* ---------- file fingerprints (as GelFigure): every picture's SHA-256, in the project, the processing log and
   * the exports' summary ---------- */
  App.sha256 = async function (buffer) {
    // forceJsHash: headless test runs (off-thread WebCrypto does not keep to their virtual clock)
    if (window.crypto && crypto.subtle && !App.forceJsHash) {
      try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { /* fall through */ }
    }
    return sha256js(new Uint8Array(buffer));
  };
  // small pure-JS fallback (some browsers have no crypto.subtle on file:// pages)
  function sha256js(m) {
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = m.length, nb = ((l + 9 + 63) >> 6) << 6, p = new Uint8Array(nb);
    p.set(m); p[l] = 0x80;
    const dv = new DataView(p.buffer);
    dv.setUint32(nb - 8, Math.floor(l / 0x20000000)); dv.setUint32(nb - 4, (l << 3) >>> 0);
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
  }

  /* the figure's layout. Text sizes per kind (lane names, marker labels, protein names; null = fontPt); a group
   * label wider than its line wraps ('wrap'), shrinks down to minFontPt ('shrink') or stays ('none') */
  const defaultStyle = () => ({ mmPerLane: 5, fontPt: 7, lineWidthPt: 0.5, labelAngle: 'auto', rowGapPt: 2, blotGapPt: 5,
    tickLenPt: 2.5, labelGapPt: 2.5, unitHeader: true, showMW: true, panelLetter: '', dpi: 600, invert: true, border: true, mwSide: 'left', nameSide: 'right',
    laneNumbers: false, lanePt: null, markerPt: null, namePt: null, groupFit: 'wrap', minFontPt: 5, groupTicks: false,
    columnGapMm: 6, alignColumnRows: false });
  App.defaultStyle = defaultStyle;
  /* step: how far the user has come (1 Marker picture confirmed → 2 pieces confirmed → 3 boxes → 4 marker →
   * 5 names); each step works on what the one before established */
  const newState = () => ({ step: 1, defaultLaneCount: null, blots: [], rows: [], lanes: [], range: [1, 1], hiCol: 0, levels: {}, align: {}, conditions: [], groups: [], arrows: [], brackets: [], layoutColumns: [{ id: 'main', title: '', titleSide: 'top' }], style: defaultStyle() });

  /* ---------- events / undo ---------- */
  App.on = fn => App.listeners.push(fn);
  App.emit = what => App.listeners.forEach(fn => fn(what));
  let raf = 0;
  App.refresh = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; App.emit('refresh'); }); };
  App.commit = function () {
    if (!App.S) return;
    App.S.rows.forEach(r => { delete r.markerPt; r.segs.forEach(s => { App.boxId(s); App.boxLabel(s); }); });
    App.S.blots.forEach(b => { if (App.S.rows.some(r => r.blot === b.id)) b.boxesReady = true; });
    const columnIds = new Set(App.layoutColumns().map(c => c.id));
    App.S.rows.forEach(r => { if (!columnIds.has(App.rowColumn(r))) r.column = 'main'; });
    if (!App.layoutColumns().some(c => c.id === App.activeColumn)) App.activeColumn = 'main';
    App.layoutColumns().forEach(c => { roomLeft(c.id); trimLeft(c.id); });
    App.S.blots.forEach(b => (b.pieces || []).forEach(pc => (pc.marks || []).forEach(App.markerId)));
    if (App.S.arrows) App.S.arrows = App.S.arrows.filter(a => App.row(a.row));     // (a deleted row takes its arrows; undo brings both)
    if (App.S.brackets) App.S.brackets = App.S.brackets.filter(k => App.row(k.r0) && App.row(k.r1));
    App.fitLanes(false);
    App.refreshChoices();
    const snap = JSON.stringify(App.S);
    if (App.hist[App.hist.length - 1] !== snap) { App.hist.push(snap); if (App.hist.length > 120) App.hist.shift(); App.future = []; App.saveDraftSoon(); }
    App.emit('change');
  };
  /* undo / redo put a new state object in place: open editors (they hold objects of the old one) are dropped
   * without writing back, selections that no longer exist cleared; pictures are resampled again where the
   * restored state aligns them differently */
  function swapState(json) {
    if (App.onSwap) App.onSwap();
    App.S = JSON.parse(json);
    if (!App.layoutColumns().some(c => c.id === App.activeColumn)) App.activeColumn = 'main';
    App.syncImages();
    App.selLane = null; App.selMark = null;
    if (App.selRow && !App.row(App.selRow)) { App.selRow = null; App.selSeg = null; }
    App.syncPieces(); App.syncAlign(); App.saveDraftSoon(); App.emit('change');
  }
  App.undo = () => { if (App.hist.length < 2) return; App.future.push(App.hist.pop()); swapState(App.hist[App.hist.length - 1]); };
  App.redo = () => { if (!App.future.length) return; const s = App.future.pop(); App.hist.push(s); swapState(s); };

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
  App.curSeg = row => (row ? row.segs.find(s => s.id === App.selSeg) || row.segs.find(s => s.piece === App.selSeg) || row.segs[0] : null);
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
  App.blotName = b => b.name || `${L('图片组', 'Image group')} ${App.S.blots.indexOf(b) + 1}`;
  // in what leaves the app (uncropped images, CSV, the processing log): English unless the user named it
  App.blotNameEn = b => b.name || `Image group ${App.S.blots.indexOf(b) + 1}`;
  App.pieceName = (b, pc) => (App.S.blots.length > 1 ? App.blotName(b) + ' · ' : '') + L('膜条 ', 'strip ') + (pc.letter || '?');
  App.rowLabel = row => { const k = App.rowKda(row); return row.name || (k ? L(`≈${Math.round(k)} kDa 行`, `≈${Math.round(k)} kDa row`) : L('未命名行', 'Unnamed row')); };

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
    rec._defaultLevels = null;
    rec.cs = rec.kind === 'chemi' ? WB.chemiSignal(rec.img) : null;
    rec.thumb = thumbOf(rec);
    rec._disp = null;
  }

  /* a membrane. Its ladder: the one the user chose last time (people keep one ladder), else none yet — it only
   * lists the sizes to pick from when marking (nothing is read automatically) */
  const newBlot = (images, marker) => ({ id: uid('b'), name: '', images, marker, ladderId: App.prefLadder || null, pieces: [] });
  // the ladder of a membrane chosen by the user: remembered for the next membranes
  App.setLadder = function (b, id) {
    b.ladderId = id || null;
    if (id) { App.prefLadder = id; G.PrefStorage.setItem('blotfig.ladder', id); }
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
    const head = { version: 1, app: 'BlotFigure ' + App.VERSION, savedAt: new Date().toISOString(), viewBlot: App.viewBlot, S: App.S, initial: App.initial,
      projectId: App.projectId, projectName: App.projectName, ladders: App.customLadders(),
      images: recs.map((r, i) => ({ id: r.id, name: r.name, kind: r.kind, exposure: r.exposure, size: bufs[i].byteLength, sha256: r.sha256 || null })) };
    const json = new TextEncoder().encode(JSON.stringify(head)), len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, json.length, true);
    let blob = new Blob([new TextEncoder().encode(MAGIC), len, json, ...bufs]);
    if (typeof CompressionStream !== 'undefined') blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return blob;
  };
  App.openProject = async function (file) {
    busy(true, L('打开项目…', 'Opening project…')); await tick();
    try {
      let buf = file.buffer || await file.arrayBuffer(), u8 = new Uint8Array(buf);
      if (u8[0] === 0x1f && u8[1] === 0x8b) { buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); u8 = new Uint8Array(buf); }
      if (new TextDecoder().decode(u8.subarray(0, 8)) !== MAGIC) throw new Error(L('这不是 BlotFigure 项目文件（.blotfig）', 'This is not a BlotFigure project file (.blotfig)'));
      const n = new DataView(buf, 8, 4).getUint32(0, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + n)));
      const bufs = [];
      let at = 12 + n;
      for (const im of head.images) { bufs.push(buf.slice(at, at + im.size)); at += im.size; }
      await restoreFrom(head, bufs, L('打开项目', 'Opening project'));
      return App.images.size;
    } finally { busy(false); }
  };
  /* a project's (or a draft's) pictures and state put in place: the pictures decoded and checked against their
   * fingerprints, the membranes analysed again (pieces found at the same places keep their ids, the boxes on
   * them stay as saved) */
  async function restoreFrom(head, bufs, what) {
    const recs = [];
    for (let i = 0; i < head.images.length; i++) {
      const im = head.images[i], b = bufs[i];
      busy(true, L(`${what}：读取图片 ${i + 1}/${head.images.length}…`, `${what}: reading pictures ${i + 1}/${head.images.length}…`)); await tick();
      const sha = await App.sha256(b);
      if (im.sha256 && sha !== im.sha256) throw new Error(L(`图片 ${im.name} 校验失败（SHA-256 不一致），文件可能已损坏`, `Picture ${im.name} failed its check (SHA-256 mismatch); the file may be damaged`));
      const d = await G.TIFF.decodeBuffer(b, im.name);
      recs.push({ id: im.id, name: im.name, img: { w: d.width, h: d.height, data: d.data }, spp: d.spp, bits: d.bits, src: new File([b], im.name), kind: im.kind, exposure: im.exposure,
        sha256: sha, bytes: b.byteLength, dpi: d.dpi || 0 });
    }
    if (App.onSwap) App.onSwap();
    App.images.clear(); retiredImages.clear(); App.analysis = {};
    matchSizes(recs);
    recs.forEach(r => { prepare(r); App.images.set(r.id, r); });
    App.S = head.S;
    App.projectId = head.projectId || uid('project'); App.projectName = head.projectName || '';
    G.ProteinLadders.importDefinitions(head.ladders || []);
    if (!App.S.step) App.S.step = 5;          // (projects saved before the steps: everything done)
    if (!App.S.arrows) App.S.arrows = [];
    if (!App.S.brackets) App.S.brackets = [];
    App.S.style = Object.assign(defaultStyle(), App.S.style || {});      // (settings added since: their defaults)
    App.selRow = App.selSeg = App.selLane = App.selMark = null; App.mode = null; App.activeColumn = 'main';
    App.viewBlot = App.blot(head.viewBlot) ? head.viewBlot : (App.S.blots[0] || {}).id; App.viewImg = null;
    App.loadWarnings = [];
    App.syncAlign();
    busy(true, L(`${what}：分析各张膜…`, `${what}: analysing the membranes…`)); await tick();
    App.S.blots.forEach(b => { if (!b.dirty) App.analyze(b); });
    App.hist = []; App.future = [];
    App.commit();
    App.saved = App.hist[App.hist.length - 1];
    // "back to import": the state saved with it (projects / drafts from before 0.7: the state as opened)
    App.initialAsOpened = typeof head.initial !== 'string';
    App.initial = App.initialAsOpened ? App.saved : head.initial;
    App.emit('loaded');
  }

  // The local project library is installed by wblibrary.js; raw bytes remain on this device.
  App.restoreSnapshot = restoreFrom;
  App.customLadders = () => [...new Set((App.S?.blots || []).map(b => b.ladderId))].map(G.ProteinLadders.get).filter(l => l?.custom);
  App.resetSession = () => {
    clearTimeout(App.draftTimer); if (App.onSwap) App.onSwap();
    App.S = null; App.images.clear(); retiredImages.clear(); App.analysis = {};
    App.hist = []; App.future = []; App.initial = null; App.saved = null;
    App.selRow = App.selSeg = App.selLane = App.selMark = null; App.viewBlot = App.viewImg = App.mode = null;
    App.projectId = null; App.projectName = ''; App.cachedSnapshot=null; App.cacheStatus=null; App.activeColumn = 'main'; App.curStep = 1;
    App.emit('empty');
  };
  App.deleteBox = (row, sg) => {
    if (!row || !App.S.rows.includes(row)) return false;
    sg = sg || App.curSeg(row); if (!sg || !row.segs.includes(sg)) return false;
    App.blot(row.blot).boxesReady = true;
    row.segs.forEach(s => { s.above = App.boxAbove(row, s); s.below = App.boxBelow(row, s); });
    row.segs = row.segs.filter(s => s !== sg);
    if (!row.segs.length) { App.S.rows = App.S.rows.filter(r => r !== row); App.selRow = null; }
    else App.fitRowHeight(row);
    App.selSeg = null; App.selLane = null; App.commit(); return true;
  };

  App.addFiles = async function (files) {
    files = [...files].filter(f => /\.(tiff?|png|jpe?g|bmp)$/i.test(f.name));
    if (!files.length) return 0;
    const first = !App.S;
    if (first) { App.S = newState(); App.projectId = uid('project'); App.projectName = files[0].name.replace(/\.[^.]+$/, ''); }
    busy(true, L(`读取图片 0/${files.length}…`, `Reading pictures 0/${files.length}…`));
    await tick();
    try {
      const recs = [];
      App.loadWarnings = [];
      for (const f of files) {
        // {name, buffer} = already-read bytes (demo / tests); the format told by the bytes, not the name
        const buf = f.buffer || await f.arrayBuffer();
        const d = await G.TIFF.decodeBuffer(buf, f.name);
        App.loadWarnings.push(...(d.warnings || []));
        // (tests: the membrane as if moved by a known transform before this picture)
        // (what comes into view is background: the tray of a white-light photo, an exposure's own background)
        const mv = App.devMove && App.devMove[f.name];
        if (mv) { const im = { w: d.width, h: d.height, data: d.data }; d.data = WB.regWarp(im, WB.regInverse(mv), [], G.Engine.percentiles(d.data, [WB.classify(im, { name: f.name, spp: d.spp }) === 'marker' ? 3 : 50], 97)[0]); }
        // (src: the file itself, read again when the project is saved)
        recs.push({ id: f.id || uid('i'), name: f.name, img: { w: d.width, h: d.height, data: d.data }, spp: d.spp, bits: d.bits, src: f,
          sha256: await App.sha256(buf), bytes: buf.byteLength, dpi: d.dpi || 0 });
        busy(true, L(`读取图片 ${recs.length}/${files.length}…`, `Reading pictures ${recs.length}/${files.length}…`)); await tick();
      }
      busy(true, L('识别曝光图与 Marker 图…', 'Identifying exposures and marker pictures…')); await tick();
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
      busy(true, L('比对各次拍摄中膜的位置…', 'Comparing where the membrane lay in each capture…')); await tick();
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
        b.dirty = true;
        b.pendingInit = Object.fromEntries(b.images.filter(id => init.has(id)).map(id => [id, init.get(id)]));
      }
      // a membrane new to the figure goes through the steps: its Marker picture confirmed first (the boxes come
      // once its pieces are)
      if (blots.length) App.S.step = 1;
      for (const b of joined) { b.dirty = true; b.pendingInit = Object.assign(b.pendingInit || {}, Object.fromEntries(b.images.filter(id => init.has(id)).map(id => [id, init.get(id)]))); }
      App.fitLanes(first);
      if (!App.viewBlot || !App.blot(App.viewBlot)) App.viewBlot = App.S.blots[0] && App.S.blots[0].id;
      App.refreshChoices(true);
      App.hist = first ? [] : App.hist;
      App.commit();
      App.initial = JSON.stringify(App.S);     // (reset to import: as the pictures were just loaded)
      App.initialAsOpened = false;
      App.emit('loaded');
      return recs.length;
    } catch (e) {
      console.error(e); alert(L('读取失败：', 'Could not read the pictures: ') + e.message);
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
    delete b.dirty; delete b.pendingInit;
  }
  App.alignAndAnalyze = alignAndAnalyze;
  App.ensurePrepared = async function () {
    try {
      for (const b of App.S.blots) if (b.dirty || !App.analysis[b.id]) {
        busy(true, L(`分析 ${App.blotName(b)}：对齐图片、检查膜条…`, `Preparing ${App.blotName(b)}: aligning pictures and finding strips…`));
        await tick();
        alignAndAnalyze(b, new Map(Object.entries(b.pendingInit || {})), true);
      }
    } finally { busy(false); }
  };
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
    const deg = Math.abs(al.a) < 0.05 ? '0' : al.a.toFixed(1), px = d < 1 ? '<1' : Math.round(d);
    return L(`旋转 ${deg}°、平移 ${px} px${n ? `；${n} 条膜条另外单独对齐` : ''}`,
      `rotated ${deg}°, shifted ${px} px${n ? `; ${n} strip${n === 1 ? '' : 's'} aligned separately` : ''}`);
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
    if (!ch.length && !mk) { App.analysis[blot.id] = null; return null; }
    // the white-light photo as taken, with where it lies on the grid (strips and ladder are read from it unresampled)
    const al = mk && App.alignOf(mk.id), mPcs = al && al.pieces ? (blot.pieces || []).filter(p => al.pieces[p.id]).map(p => ({ cx: p.cx, cy: p.cy, angle: p.angle, w: p.w, h: p.h, T: al.pieces[p.id] })) : [];
    const A = WB.analyzeSession(ch.map(r => ({ id: r.id, img: r.img, exposure: r.exposure, cs: r.cs })), mk && { id: mk.id, img: (mk.raw || mk).img, T: al ? { a: al.a, tx: al.tx, ty: al.ty } : null, pieces: mPcs },
      { noCalib: true, autoMarkerLanes: false, dividerLane:blot.dividerLane||null, laneCount: (blot.boxesReady ? blot.laneCountAtDetection : App.S.defaultLaneCount) || null, outlinesOnly: App.S.step < 3 && !App.S.rows.some(r => r.blot === blot.id), noChemiCheck: !!App.devNoChemi, strips: blot.userStrips || null });
    blot.laneCountAtDetection=(blot.boxesReady ? blot.laneCountAtDetection : App.S.defaultLaneCount)||null;
    A.chemiIds = ch.map(r => r.id);
    A.H = (ch[0] || mk).img.h;
    A._strips = JSON.stringify(blot.userStrips || null);
    App.analysis[blot.id] = A;
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
  App.pieceSlots = pc => { let c = pc.col0; return (pc.roles || []).map((role, m) => { role=role==='ladder'?'sample':role; return { m, role, u: pc.u0 + m * pc.pitch, col: role === 'sample' ? c++ : null }; }); };
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
    // Source lanes are local to each membrane; the figure's display range never trims them.
    const weak = r => { const best = r.expo[r.choice]; return !best || best.snr < 6; };
    return A.rows.map(r => {
      const isWeak = weak(r);
      const row = { id: uid('r'), blot: blot.id, name: '', img: A.chemiIds[r.choice], auto: true, hidden: false, weak: isWeak, partialBlock:!!r.partialBlock, segs: [], above: r.above, below: r.below };
      r.segs.forEach(s => {
        const pc = pcs[s.region], lat = latticeLanes(pc, -Infinity, Infinity);
        const sg = { piece: pc.id, vc: s.vc, b0: s.b0, b1: s.b1, lanes: lat.lanes, c0: lat.c0, p: lat.p, x0: s.x0 ?? -pc.w / 2, x1: s.x1 ?? pc.w / 2 };
        // a piece without lanes of its own in the analysis: read them from the row's box
        if(App.S.defaultLaneCount){sg.lanes=[];sg.c0=1;sg.laneCount=s.laneCount||App.S.defaultLaneCount;App.redetectBox(row,sg);}
        else if (!sg.lanes.length) App.redetectBox(row, sg);
        App.snapBox(sg);
        row.segs.push(sg);
      });
      App.splitExcluded(row);
      return row;
    });
  };
  /* Re-run after the user changed which pictures belong to a membrane, their kind or their alignment. The rows
   * stay as they are — boxes, lanes, figure columns, order, names: what the user arranged is not undone by a
   * fresh detection. Each box is carried onto the piece now found under it (the same place on the membrane); a
   * piece no longer found keeps the boxes on it. Lane roles remain the user's explicit choices.
   * A membrane without rows yet gets the rows detected (opt.fresh: always; the user asked to detect again). */
  App.reanalyze = function (blot, opt) {
    if(opt?.fresh)blot.laneCountAtDetection=App.S.defaultLaneCount||null;
    const rows = App.S.rows.filter(r => r.blot === blot.id);
    const oldPcs = (blot.pieces || []).map(p => JSON.parse(JSON.stringify(p)));
    App.analyze(blot);
    if (!App.analysis[blot.id]) { App.S.rows = App.S.rows.filter(r => r.blot !== blot.id); return; }
    // (before the pieces are confirmed (step 3) there are no boxes yet)
    if ((!rows.length && !blot.boxesReady && App.S.step >= 3) || (opt && opt.fresh)) {
      blot.boxesReady = true;
      const fresh = App.rowsFromAnalysis(blot), at = App.S.rows.findIndex(r => r.blot === blot.id);
      App.S.rows = App.S.rows.filter(r => r.blot !== blot.id);
      App.S.rows.splice(at < 0 ? App.S.rows.length : at, 0, ...fresh);
    } else carryRows(blot, oldPcs, rows);
    App.fitLanes(false);
  };
  function carryRows(blot, oldPcs, rows) {
    const pcs = blot.pieces;
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
        if (sg.cut) t.cut = { ...sg.cut, lanes: sg.cut.lanes.map(l => ({ u: at(l.u, sg.vc).u, r: l.r })) };
        // (a box's own tilt on the picture stays)
        if (sg.pu != null) t.pu = at(sg.pu, sg.vc).u;
        if (sg.rot || op.angle !== np.angle) t.rot = Math.round(((sg.rot || 0) + op.angle - np.angle) * 100) / 100;
        out.push(t); // independent crops stay independent even when they share a membrane strip
      });
      row.segs = out;
      if (out.length === before.length) App.keepJoined(row, out[0], before);
      out.forEach(App.snapBox);
      App.splitExcluded(row);
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
  // a piece's marks with sizes, their heights v in the frame of box sg on it (a turned box: a band level in the box
  // matches the marker band along the box's tilt, not along the piece's), else of the piece
  function marksIn(pc, sg) {
    const ms = (pc.marks || []).filter(m => m.kda > 0);
    if (!sg || !sg.rot) return ms.map(m => ({ id: App.markerId(m), v: m.v, kda: m.kda }));
    const F = pFrame(pc), B = App.segFrame(pc, sg);
    return ms.map(m => ({ id: App.markerId(m), v: WB.toFrame(B, ...WB.toImg(F, m.u, m.v))[1], kda: m.kda }));
  }
  /* size <-> position on one piece (sg: in that box's frame), from the marker bands the user marked on it —
   * nothing is read automatically (prestained ladders on real membranes are too varied for that).
   * {manual, c, knots: [{v, lk}]} for WB.kdaAtK / WB.vAtK; null below 2 marks */
  App.pieceCal = function (b, pc, sg) {
    if (!pc || !pc.marks) return null;
    const K = marksIn(pc, sg).map(m => ({ v: m.v, lk: Math.log(m.kda) })).sort((a, c) => a.v - c.v);
    if (K.length < 2) return null;
    const ml = K.reduce((s, k) => s + k.lk, 0) / K.length, mv = K.reduce((s, k) => s + k.v, 0) / K.length;
    let num = 0, den = 0; K.forEach(k => { num += (k.lk - ml) * (k.v - mv); den += (k.lk - ml) ** 2; });
    const c = den ? num / den : null;
    return { manual: true, c: c < 0 ? c : null, knots: K };
  };
  // kDa ticks a piece shows: its marks (sg: heights in that box's frame)
  App.pieceTicks = (b, pc, sg) => (pc && pc.marks ? marksIn(pc, sg).map(m => ({ id: m.id, v: m.v, k: m.kda })) : []);
  App.rowKda = function (row) {
    const b = App.blot(row.blot); if (!b) return null;
    for (const sg of row.segs) {
      const pcal = App.pieceCal(b, App.piece(b, sg.piece), sg);
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
  /* the frame of a box: its piece's, turned by sg.rot degrees (a band not quite level on its piece) about the
   * point (sg.pu, sg.vc) of the piece frame. Box coordinates — lanes u, x0..x1, vc — are numbers of this frame. */
  App.segFrame = function (pc, sg) {
    const F = pFrame(pc);
    if (!sg || !sg.rot) return F;
    const pu = sg.pu != null ? sg.pu : (sg.x0 + sg.x1) / 2, [px, py] = WB.toImg(F, pu, sg.vc), R = WB.frame(0, 0, pc.angle + sg.rot), [qx, qy] = WB.toImg(R, pu, sg.vc);
    return { ox: px - qx, oy: py - qy, c: R.c, s: R.s };
  };
  // a box turned to rot degrees (relative to its piece) about its middle: it stays where it is on the picture
  App.setSegRot = function (pc, sg, rot) {
    const uc = (sg.x0 + sg.x1) / 2, [cx, cy] = WB.toImg(App.segFrame(pc, sg), uc, sg.vc), [u2, v2] = WB.toFrame(pFrame(pc), cx, cy), du = u2 - uc;
    sg.x0 += du; sg.x1 += du; sg.lanes.forEach(l => { l.u += du; });
    sg.vc = v2; sg.pu = u2; sg.rot = Math.round(Math.max(-15, Math.min(15, rot)) * 100) / 100;
  };
  /* a band not quite level on its piece: the box turned to run along it — from the band's middle in each sample
   * lane of the row's picture, when 3 lanes or more show it clearly and agree on a line. The angle added
   * (degrees), or null. */
  App.levelBox = function (row, sg) {
    const pc = App.pieceOf(row, sg), rec = App.images.get(row.img);
    if (!pc || !rec || rec.kind !== 'chemi') return null;
    const F = App.segFrame(pc, sg), p = App.segPitch(sg), vT = sg.vc - App.boxAbove(row, sg), vB = sg.vc + App.boxBelow(row, sg), was = sg.vc + (sg.b0 + sg.b1) / 2;
    const found = sg.lanes.filter(l => l.r === 's').map(l => ({ u: l.u, bd: WB.bandInBox(sigOf(rec), F, [l.u], p * 0.25, vT, vB, was) })).filter(x => x.bd);
    const top = Math.max(0, ...found.map(x => x.bd.rel)), pts = found.filter(x => x.bd.rel >= top * 0.35 && Math.abs(x.bd.v - was) < (row.above + row.below) * 0.35);
    if (pts.length < 3) return null;
    // the median of the slopes between every two lanes (one odd lane does not tilt the box)
    const sl = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) sl.push((pts[j].bd.v - pts[i].bd.v) / (pts[j].u - pts[i].u));
    sl.sort((a, c) => a - c);
    const k = sl[sl.length >> 1], mu = pts.reduce((s, x) => s + x.u, 0) / pts.length, mv = pts.reduce((s, x) => s + x.bd.v, 0) / pts.length;
    const res = pts.map(x => Math.abs(x.bd.v - (mv + k * (x.u - mu)))).sort((a, c) => a - c);
    const deg = Math.atan(k) * 180 / Math.PI;
    if (res[res.length >> 1] > Math.max(3, (sg.b1 - sg.b0) * 0.3) || Math.abs(deg) < 0.15 || Math.abs(deg) > 6) return null;
    App.setSegRot(pc, sg, (sg.rot || 0) + deg);
    App.findBand(row, sg);
    return deg;
  };
  // edges of lane i: half-way to its neighbours, half a spacing out at the ends
  App.laneLeft = (sg, i) => { const lns = sg.lanes; return i > 0 ? (lns[i - 1].u + lns[i].u) / 2 : lns[i].u - App.segPitch(sg) / 2; };
  App.laneRight = (sg, i) => { const lns = sg.lanes; return i < lns.length - 1 ? (lns[i].u + lns[i + 1].u) / 2 : lns[i].u + App.segPitch(sg) / 2; };
  App.segCols = sg => { let c = sg.c0; return sg.lanes.map((l, i) => ({ i, u: l.u, r: l.r, col: l.r === 's' ? c++ : null })); };
  App.nSample = sg => sg.lanes.filter(l => l.r === 's').length;
  App.segEnd = sg => sg.c0 + App.nSample(sg) - 1;
  // the box spans its lanes exactly: what it shows is what the figure shows
  App.snapBox = sg => { if (sg.lanes.length) { sg.x0 = App.laneLeft(sg, 0); sg.x1 = App.laneRight(sg, sg.lanes.length - 1); } };
  // New source slots are samples. Only explicit user exclusions may change a crop.
  App.roleAt = () => 's'; // Sample by default; only a user's M / exclude action removes a lane.
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
  // A skipped internal lane is a real cut: expose the separate crops in the editor too.
  App.splitExcluded = function (row) {
    row.segs = row.segs.flatMap(sg => {
      const runs = []; let run = [];
      sg.lanes.forEach((l, i) => { if (l.r === 's') run.push(i); else if (run.length) { runs.push(run); run = []; } });
      if (run.length) runs.push(run);
      if (runs.length < 2) return [sg];
      const cut = sg.cut || { id: uid('cut'), lanes: sg.lanes.map(l => ({ ...l })) };
      let col = sg.c0;
      return runs.map((indices, k) => {
        const copy = { ...sg, id: k ? uid('box') : App.boxId(sg), label: k ? null : sg.label, cut,
          above: App.boxAbove(row, sg), below: App.boxBelow(row, sg),
          lanes: indices.map(i => ({ ...sg.lanes[i] })), c0: col, laneCount: sg.laneCount ? indices.length : undefined,
          x0: App.laneLeft(sg, indices[0]), x1: App.laneRight(sg, indices[indices.length - 1]) };
        col += indices.length;
        return copy;
      });
    });
  };
  App.restoreContinuous = function (row, cutId) {
    const parts = row.segs.filter(s => s.cut && s.cut.id === cutId);
    if (parts.length < 2 || parts.some(s => s.piece !== parts[0].piece || Math.abs(s.vc - parts[0].vc) > 1 || Math.abs((s.rot || 0) - (parts[0].rot || 0)) > 0.01)) return false;
    const first = parts[0], all = parts.flatMap(s => s.lanes).concat(first.cut.lanes);
    const lanes = []; all.sort((a,b) => a.u-b.u).forEach(l => { if (!lanes.some(x => Math.abs(x.u-l.u)<1)) lanes.push({u:l.u,r:'s'}); });
    first.lanes = lanes; first.x0 = Math.min(...parts.map(s=>s.x0)); first.x1 = Math.max(...parts.map(s=>s.x1));
    first.c0 = Math.min(...parts.map(s=>s.c0)); if(first.laneCount)first.laneCount=lanes.length; delete first.cut;
    row.segs = row.segs.filter(s => s === first || !parts.includes(s));
    return true;
  };

  /* The box of a segment set to x0..x1 (piece frame), from its lanes before the edit (base {lanes, c0, p}):
   * lanes whose centres lie inside stay where they are, the spacing continues into new room, and the lanes
   * that stay keep their figure columns. The edges are taken as given (snapBox squares them at the end). */
  App.setBox = function (row, sg, x0, x1, base) {
    base = base || { lanes: sg.lanes.map(l => ({ u: l.u, r: l.r })), c0: sg.c0, p: sg.p };
    const pc = App.pieceOf(row, sg), p = spacing(base.lanes, base.p);
    if(sg.laneCount && base.lanes.length) {
      const a=base.x0 ?? App.laneLeft({...sg,lanes:base.lanes,p:base.p},0),z=base.x1 ?? App.laneRight({...sg,lanes:base.lanes,p:base.p},base.lanes.length-1),scale=(x1-x0)/Math.max(1,z-a);
      sg.lanes=base.lanes.map(l=>({u:x0+(l.u-a)*scale,r:l.r}));sg.p=p*scale;sg.c0=base.c0;sg.x0=x0;sg.x1=x1;return;
    }
    const inside = l => l.u >= x0 - 1e-6 && l.u <= x1 + 1e-6;
    const lns = base.lanes.filter(inside).map(l => ({ u: l.u, r: l.r }));
    if (!lns.length) {
      // moved clear of its lanes: their lattice carried on into the box
      const o = base.lanes.length ? base.lanes[0].u : (x0 + x1) / 2;
      for (let u = o + Math.ceil((x0 - o) / p - 1e-9) * p; u <= x1 + 1e-6 && lns.length < 80; u += p) lns.push({ u, r: App.roleAt(pc, u, p) });
      if (!lns.length) lns.push({ u: (x0 + x1) / 2, r: App.roleAt(pc, (x0 + x1) / 2, p) });
    } else {
      for (let u = lns[0].u - p; u >= x0 - 1e-6 && lns.length < 80; u -= p) lns.unshift({ u, r: App.roleAt(pc, u, p) });
      for (let u = lns[lns.length - 1].u + p; u <= x1 + 1e-6 && lns.length < 80; u += p) lns.push({ u, r: App.roleAt(pc, u, p) });
    }
    // (lanes gained left of column 1 go below it for now: the commit makes room on the left for every row)
    let c0 = base.c0;
    const stay = base.lanes.find(l => l.r === 's' && inside(l));
    if (stay) {
      const col = base.c0 + base.lanes.filter(l => l.r === 's' && l.u < stay.u - 1e-6).length;
      c0 = col - lns.filter(l => l.r === 's' && l.u < stay.u - 1e-6).length;
    }
    sg.lanes = lns; sg.c0 = c0; sg.p = p; sg.x0 = x0; sg.x1 = x1;
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
    const count=sg.laneCount || App.S.defaultLaneCount || 0;
    let res = null;
    for (const rec of [...new Set(recs)]) {
      res = WB.detectBoxLanes(sigOf(rec), App.segFrame(pc, sg), x0, x1, sg.vc - App.boxAbove(row, sg), sg.vc + App.boxBelow(row, sg), { pitch: pc.pitch || App.segPitch(sg), count });
      if (res.lanes.length && (!count || res.confident)) break;
    }
    if (!res || !res.lanes.length) return 0;
    const oldCols = App.segCols(sg).filter(c => c.col != null), p = res.pitch > 4 ? res.pitch : App.segPitch(sg);
    const old=sg.lanes.slice();
    sg.lanes = res.lanes.map(u => {const near=old.find(l=>l.r!=='s'&&Math.abs(l.u-u)<p*.35);return {u,r:near?near.r:'s'};});
    if(count)sg.laneCount=count;
    sg.p = p;
    const first = sg.lanes.find(l => l.r === 's');
    const near = first && oldCols.slice().sort((a, c) => Math.abs(a.u - first.u) - Math.abs(c.u - first.u))[0];
    if (near && Math.abs(near.u - first.u) < p * 0.5) sg.c0 = near.col;
    return App.nSample(sg);
  };
  App.setDefaultLaneCount = n => { App.S.defaultLaneCount = n==null || n==='' ? null : Math.max(1,Math.min(60,Math.round(+n)||1)); };
  App.applyDefaultLanes = () => {
    const n=App.S.defaultLaneCount;if(!n)return 0;
    let applied=0;
    App.S.rows.forEach(row=>{
      const handled=new Set();
      row.segs.slice().forEach(original=>{
        if(!row.segs.includes(original)||handled.has(original.id))return;
        let sg=original,parts=null,roles=sg.lanes.filter(l=>l.r!=='s');
        if(sg.cut) {
          const candidates=row.segs.filter(s=>s.cut?.id===sg.cut.id), source=sg.cut.lanes;
          const together=candidates.length>1&&candidates.every(s=>s.piece===sg.piece&&Math.abs(s.vc-sg.vc)<.01&&Math.abs((s.rot||0)-(sg.rot||0))<.01&&App.boxAbove(row,s)===App.boxAbove(row,sg)&&App.boxBelow(row,s)===App.boxBelow(row,sg)&&s.lanes.every(l=>source.some(t=>Math.abs(t.u-l.u)<1)));
          if(together) {
            parts=candidates.map(s=>({id:s.id,label:s.label}));
            const live=candidates.flatMap(s=>s.lanes);
            roles=source.filter(l=>l.r!=='s'||!live.some(t=>Math.abs(t.u-l.u)<1)).map(l=>({...l,r:l.r==='s'?'x':l.r}));
            App.restoreContinuous(row,sg.cut.id);
          }
        }
        sg.laneCount=n;App.evenBox(row,sg,n);
        roles.forEach(l=>{const near=sg.lanes.slice().sort((a,b)=>Math.abs(a.u-l.u)-Math.abs(b.u-l.u))[0];if(near&&Math.abs(near.u-l.u)<sg.p*.4)near.r=l.r;});
        if(parts) {
          const index=row.segs.indexOf(sg),temporary={...row,segs:[sg]};App.splitExcluded(temporary);
          const created=temporary.segs;row.segs.splice(index,1,...created);
          created.forEach((s,i)=>{if(parts[i]){s.id=parts[i].id;s.label=parts[i].label;}handled.add(s.id);});
        }
        handled.add(sg.id);applied++;
      });
    });
    App.fitLanes(true);return applied;
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
    const lns = base.lanes, n = lns.length;
    if (n < 3 || (i !== 0 && i !== n - 1)) { App.moveLane(sg, i, u); return; }
    const a = i === 0 ? Math.min(u, lns[n - 1].u - 3 * (n - 1)) : lns[0].u, z = i === n - 1 ? Math.max(u, lns[0].u + 3 * (n - 1)) : lns[n - 1].u;
    sg.lanes = lns.map((l, k) => ({ u: a + (z - a) * k / (n - 1), r: l.r }));
    sg.p = (z - a) / (n - 1);
  };
  // n lanes spaced evenly between the box's first and last lane, which stay (one lane: across the box); a lane
  // keeps its role (sample / left out / marker) when one was close by
  App.evenEnds = function (row, sg, n) {
    const lns = sg.lanes, pc = App.pieceOf(row, sg);
    n = Math.max(1, Math.min(60, Math.round(n || lns.length)));
    if (lns.length < 2 || n < 2) return App.evenBox(row, sg, n);
    const a = lns[0].u, z = lns[lns.length - 1].u, p = (z - a) / (n - 1), old = App.segPitch(sg);
    sg.lanes = Array.from({ length: n }, (_, k) => {
      const u = a + k * p, near = lns.slice().sort((x, y) => Math.abs(x.u - u) - Math.abs(y.u - u))[0];
      return { u, r: near && Math.abs(near.u - u) < Math.min(p, old) * 0.45 ? near.r : App.roleAt(pc, u, p) };
    });
    sg.p = p;
    return n;
  };
  // a lane added at u; when it comes before the first sample lane the lanes already there keep their columns
  App.addLane = function (row, sg, u) {
    const pc = App.pieceOf(row, sg), p = App.segPitch(sg), r = App.roleAt(pc, u, p);
    const at = sg.lanes.filter(l => l.u < u).length, firstS = r === 's' && !sg.lanes.slice(0, at).some(l => l.r === 's');
    sg.lanes.splice(at, 0, { u, r }); if(sg.laneCount)sg.laneCount=sg.lanes.length;
    if (firstS && App.nSample(sg) > 1 && sg.c0 > 1) sg.c0--;
    return at;
  };
  // a lane taken out (detected where there is none): the lanes after it move up a column
  App.removeLane = (row, sg, i) => { if (sg.lanes.length > 1 && sg.lanes[i]) {sg.lanes.splice(i, 1);if(sg.laneCount)sg.laneCount=sg.lanes.length;} };
  App.moveLane = function (sg, i, u) {
    const lns = sg.lanes, lo = i > 0 ? lns[i - 1].u + 3 : -Infinity, hi = i < lns.length - 1 ? lns[i + 1].u - 3 : Infinity;
    lns[i].u = Math.max(lo, Math.min(hi, u));
  };
  // sample -> left out -> marker -> sample
  App.cycleLane = (sg, i) => { const l = sg.lanes[i]; if (l) l.r = { s: 'x', x: 'm', m: 's' }[l.r] || 's'; };
  App.nudgeLanes = (sg, du) => sg.lanes.forEach(l => { l.u += du; });
  App.scaleLanes = function (sg, dp) {
    const lns = sg.lanes; if (lns.length < 2) { sg.p = Math.max(6, App.segPitch(sg) + dp); return; }
    const mid = (lns[0].u + lns[lns.length - 1].u) / 2, p = App.segPitch(sg), k = Math.max(6, p + dp) / p;
    lns.forEach(l => { l.u = mid + (l.u - mid) * k; });
    sg.p = p * k;
  };
  /* figure columns of a segment (and the segments after it in the row) moved by d — not left of column 1 (the
   * other rows are never pushed aside: to have this box further left, move the others right). Returns whether
   * anything moved. */
  App.shiftCols = function (row, sg, d) {
    const i = row.segs.indexOf(sg);
    if (i < 0) return false;
    const segs = [sg];
    d = Math.max(d, 1 - Math.min(...segs.map(t => t.c0)));
    if (!d) return false;
    segs.forEach(t => { t.c0 += d; });
    return true;
  };

  /* ---------- arranging the figure: the order of the rows, the lanes lined up across pieces ----------
   * Every piece is a module of its own (its own angle, lanes, marker); the figure stacks rows in any order
   * and lines up each piece's lanes with the others' as needed (e.g. lanes 4-6 of one piece over lanes 1-3
   * of another, when the membrane was cut). */
  // room on the left: every column moves right by s, the lane names, conditions and groups with it
  App.makeRoom = function (s, columnId) {
    if (!(s > 0)) return;
    const S = App.columnState(columnId);
    S.rows.forEach(r => r.segs.forEach(sg => { sg.c0 += s; }));
    for (let k = 0; k < s; k++) S.lanes.unshift({ name: '', hidden: false });
    S.conditions.forEach(c => { for (let k = 0; k < s; k++) c.values.unshift(''); });
    S.groups.forEach(g => { g.from += s; g.to += s; });
    S.range = [S.range[0] <= 1 ? 1 : S.range[0] + s, S.range[1] + s];
    S.hiCol += s; Object.assign(App.columnData(columnId), { lanes: S.lanes, range: S.range, hiCol: S.hiCol });
  };
  // first figure column of every box with sample lanes
  const firstCols = columnId => App.rowsInColumn(columnId).flatMap(r => r.segs.filter(s => App.nSample(s)).map(s => s.c0));
  // a box widened past column 1 (lanes gained on its left): room on the left for it
  function roomLeft(columnId) {
    const lo = Math.min(...firstCols(columnId));
    if (lo < 1) App.makeRoom(1 - lo, columnId);
  }
  // columns on the left that no box fills and nothing was typed for: gone, everything moves left (a box moved
  // right and back again leaves no blank column behind)
  function trimLeft(columnId) {
    const S = App.columnState(columnId), cols = firstCols(columnId);
    if (!cols.length) return;
    const k = Math.min(...cols) - 1;
    const blank = n => { const l = S.lanes[n - 1]; return !l || (!l.name && !l.hidden && S.conditions.every(c => !c.values[n - 1]) && S.groups.every(g => Math.min(g.from, g.to) > n)); };
    let s = 0; while (s < k && blank(s + 1)) s++;
    if (!s) return;
    S.rows.forEach(r => r.segs.forEach(sg => { sg.c0 -= s; }));
    S.lanes.splice(0, s);
    S.conditions.forEach(c => c.values.splice(0, s));
    S.groups.forEach(g => { g.from -= s; g.to -= s; });
    S.range = [Math.max(1, S.range[0] - s), Math.max(1, S.range[1] - s)];
    S.hiCol = Math.max(0, S.hiCol - s); Object.assign(App.columnData(columnId), { lanes: S.lanes, range: S.range, hiCol: S.hiCol });
  }
  /* Move this box only, never its siblings on the same physical strip. The former onlyBox argument remains
   * accepted for saved test scenarios; it no longer changes the scope. Stop at column 1. */
  App.shiftAlign = function (row, sg, d, onlyBox) {
    const segs = [sg].filter(s => App.nSample(s));
    if (!segs.length) return { n: 0, d: 0 };
    d = Math.max(d, 1 - Math.min(...segs.map(s => s.c0)));
    if (!d) return { n: 0, d: 0 };
    segs.forEach(s => { s.c0 += d; });
    return { n: segs.length, d };
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
    const list = App.rowsInColumn(App.rowColumn(row)).filter(r => row.hidden || !r.hidden), i = list.indexOf(row), j = i + d;
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
    App.S.rows.forEach(r => { if (r !== row && App.rowColumn(r) === App.rowColumn(row)) r.segs.forEach(t => { if (t.piece === sg.piece) App.segCols(t).forEach(s => { if (s.col != null) refs.push(s); }); }); });
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
    const us = sg.lanes.filter(l => l.r === 's').map(l => l.u), vT = sg.vc - App.boxAbove(row, sg), vB = sg.vc + App.boxBelow(row, sg);
    const was = sg.vc + (sg.b0 + sg.b1) / 2;
    const bd = WB.bandInBox(sigOf(rec), App.segFrame(pc, sg), us, App.segPitch(sg) * 0.3, vT, vB, was > vT && was < vB ? was : null);
    if (bd) { sg.b0 = bd.v0 - sg.vc; sg.b1 = bd.v1 - sg.vc; }
  };

  /* ---------- target bands: an arrow at one band of a row, with its size ----------
   * S.arrows [{row, db, sym: '◀' | '*' | '#' | '†', side, text, auto}]: db = where it points, from the middle of
   * the band of the row's first box (that stays where it is on the membrane when the box is moved, turned or
   * carried onto other pieces); auto: the arrowhead's size from the marks */
  const bandMid = row => { const sg = row.segs[0]; return sg.vc + (sg.b0 + sg.b1) / 2; };
  App.arrowV = a => { const row = App.row(a.row); return row ? bandMid(row) + a.db : null; };
  // the band nearest v (within about a band height) in the row's picture, else v
  App.snapBandV = function (row, v) {
    const sg = row.segs[0], pc = sg && App.pieceOf(row, sg), rec = App.images.get(row.img);
    if (!pc || !rec || rec.kind !== 'chemi') return v;
    const us = sg.lanes.filter(l => l.r === 's').map(l => l.u), tol = Math.max(10, (sg.b1 - sg.b0) * 0.8);
    const bd = WB.bandInBox(sigOf(rec), App.segFrame(pc, sg), us, App.segPitch(sg) * 0.3, Math.max(sg.vc - App.boxAbove(row, sg), v - 2 * tol), Math.min(sg.vc + App.boxBelow(row, sg), v + 2 * tol), v);
    return bd && Math.abs(bd.v - v) <= tol ? bd.v : v;
  };
  App.addArrow = function (row, v) {
    const a = { row: row.id, db: Math.round((App.snapBandV(row, v) - bandMid(row)) * 10) / 10, sym: '◀', side: App.S.style.nameSide === 'left' ? 'left' : 'right', text: '', auto: true };
    (App.S.arrows = App.S.arrows || []).push(a);
    return a;
  };
  /* side brackets (as GelFigure's): a bar beside the figure with its label, over several rows (IP / Input / WCL)
   * or part of one (a smear: (Ub)n). S.brackets [{r0, f0, r1, f1, side, text, pt}]: from f0 of row r0 (0 = its
   * top, 1 = its bottom) to f1 of row r1. Default side: away from the protein names. */
  App.addBracket = function (r0, f0, r1, f1) {
    const ix = id => App.S.rows.findIndex(r => r.id === id);
    if (ix(r0) > ix(r1) || (r0 === r1 && f0 > f1)) [r0, f0, r1, f1] = [r1, f1, r0, f0];
    const k = { r0, f0: Math.round(f0 * 1000) / 1000, r1, f1: Math.round(f1 * 1000) / 1000, side: App.S.style.nameSide === 'left' ? 'right' : 'left', text: '' };
    (App.S.brackets = App.S.brackets || []).push(k);
    return k;
  };
  // the rows a bracket spans, in the figure's order
  App.bracketRows = k => { const r = App.row(k.r0); if (!r) return []; const rows = App.rowsInColumn(App.rowColumn(r)), ix = id => rows.findIndex(r => r.id === id), a = Math.min(ix(k.r0), ix(k.r1)), b = Math.max(ix(k.r0), ix(k.r1)); return a < 0 ? [] : rows.slice(a, b + 1); };
  // an arrow's size from the marks of its row's first box ('≈' beyond the marked bands); '' without 2 marks
  App.arrowSize = function (a) {
    const row = App.row(a.row), sg = row && row.segs[0], b = row && App.blot(row.blot), pcal = sg && App.pieceCal(b, App.piece(b, sg.piece), sg);
    const v = row && App.arrowV(a), k = pcal && WB.kdaAtK(pcal, v);
    if (!k) return '';
    const vs = pcal.knots.map(t => t.v), out = v < Math.min(...vs) - 2 || v > Math.max(...vs) + 2;
    return `${out ? '≈' : ''}${k < 10 ? k.toFixed(1) : Math.round(k)} kDa`;
  };
  /* the text beside an arrow: its name, its size (in brackets after a name) — typed in (a theoretical size), else
   * the estimate for an arrowhead; a symbol (* # †) marks a band as "not the one" and carries no estimate */
  App.arrowLabel = function (a) {
    const sz = a.auto ? (a.sizeText || (a.sym === '◀' ? App.arrowSize(a) : '')) : '';
    return a.text && sz ? `${a.text} (${sz})` : a.text || sz;
  };
  // lanes for a new box on a piece: those of the nearest other row on it (the user may have fixed them),
  // else the piece's lattice over the figure's columns
  App.pieceLanes = function (b, pc, v) {
    let best = null;
    App.S.rows.forEach(r => r.segs.forEach(sg => { if (sg.piece === pc.id && sg.lanes.length && (!best || Math.abs(sg.vc - v) < Math.abs(best.vc - v))) best = sg; }));
    if (best) return { lanes: best.lanes.map(l => ({ u: l.u, r: l.r })), c0: best.c0, p: App.segPitch(best) };
    return latticeLanes(pc, -Infinity, Infinity);
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
  App.fitLanes = function (resetRange, columnId) {
    if (columnId == null) { App.layoutColumns().forEach(c => App.fitLanes(resetRange, c.id)); return; }
    const S = App.columnState(columnId), wasEmpty = !S.hiCol;
    let hi = 1, hiVis = 0, lo = Infinity;
    S.rows.forEach(r => r.segs.forEach(sg => {
      if (!App.nSample(sg)) return;
      hi = Math.max(hi, App.segEnd(sg));
      if (!r.hidden) { hiVis = Math.max(hiVis, App.segEnd(sg)); lo = Math.min(lo, sg.c0); }
    }));
    if(!S.rows.some(r=>r.segs.some(s=>App.nSample(s)))){Object.assign(App.columnData(columnId),{range:[1,1],hiCol:0});return;}
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
    if(wasEmpty)S.lanes.forEach(l=>{l.hidden=false;});
    if (wasEmpty || resetRange || !S.range || S.range[0] > hiVis) S.range = [lo, hiVis];
    else if (S.hiCol && S.range[1] === S.hiCol && hiVis !== S.hiCol) S.range[1] = hiVis;   // the range ran to the last column: keep it so
    S.hiCol = hiVis; Object.assign(App.columnData(columnId), { lanes: S.lanes, range: S.range, hiCol: S.hiCol });
  };
  App.figLanes = (columnId = App.activeColumn) => { const S = App.columnData(columnId), out = []; for (let j = S.range[0]; j <= S.range[1]; j++) if (S.lanes[j - 1] && !S.lanes[j - 1].hidden) out.push(j); return out; };
  /* Figure columns shown, the source of every row in every column, and where a white gap separates
   * columns: wherever neighbouring columns are not neighbouring lanes of one box in some row. */
  App.columns = function (columnId = App.activeColumn) {
    const S = App.columnState(columnId), vis = App.figLanes(columnId), rows = S.rows.filter(r => !r.hidden && App.blot(r.blot) && App.images.has(r.img));
    const src = rows.map(r => vis.map(j => App.colSource(r, j)));
    const gapAfter = new Set();
    for (let k = 0; k + 1 < vis.length; k++) {
      if (vis[k + 1] !== vis[k] + 1) { gapAfter.add(k); continue; }
      // Local box splices are rendered only in that row; unrelated continuous rows stay continuous.
    }
    const segs = []; let cur = null;
    vis.forEach((j, k) => { if (!cur) { cur = []; segs.push(cur); } cur.push(j); if (gapAfter.has(k)) cur = null; });
    return { vis, rows, src, gapAfter, segs };
  };
  App.segments = () => App.columns().segs;
  App.ensureLane = (j, columnId = App.activeColumn) => { const S = App.columnData(columnId); while (S.lanes.length < j) S.lanes.push({ name: '', hidden: false }); };

  /* ---------- rows: geometry, exposures, levels ---------- */
  App.rowPieces = row => { const b = App.blot(row.blot); return [...new Set(row.segs.map(sg => App.piece(b, sg.piece)).filter(Boolean))]; };
  App.rowPitch = row => (row.segs.length ? row.segs.reduce((s, sg) => s + App.segPitch(sg), 0) / row.segs.length : 100);
  // image position of a row (band centre on its first piece)
  App.rowXY = row => { const b = App.blot(row.blot), sg = row.segs[0], pc = sg && App.piece(b, sg.piece); return pc ? WB.toImg(pFrame(pc), 0, sg.vc) : [0, 0]; };
  // the windows of a row on its boxes, over the lanes shown in the figure (all lanes if none is shown)
  App.rowParts = function (row, all) {
    const b = App.blot(row.blot), vis = new Set(App.figLanes(App.rowColumn(row))), parts = [];
    row.segs.forEach(sg => {
      const pc = App.piece(b, sg.piece); if (!pc || !sg.lanes.length) return;
      const cs = App.segCols(sg).filter(s => s.col != null && (all || vis.has(s.col)));
      if (!cs.length) return;
      parts.push({ F: App.segFrame(pc, sg), u0: App.laneLeft(sg, cs[0].i), u1: App.laneRight(sg, cs[cs.length - 1].i),
        vTop: sg.vc - App.boxAbove(row, sg), vBot: sg.vc + App.boxBelow(row, sg), b0: sg.vc + sg.b0, b1: sg.vc + sg.b1, sg, pc });
    });
    return parts.length || all ? parts : App.rowParts(row, true);
  };
  const expoCache = new Map();
  App.rowExpo = function (row) {
    const b = App.blot(row.blot); if (!b || b.dirty) return [];
    const ch = App.chemiOf(b);
    const key = row.id + JSON.stringify([row.segs, row.above, row.below]) + ch.map(c => c.id);
    if (expoCache.has(key)) return expoCache.get(key);
    const parts = App.rowParts(row, true);
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
      if (cur && cur.manual) return;
      // Once established, an exposure's baseline must not change because another protein switched pictures.
      if (cur && cur.stable) return;
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
        if (!rec._defaultLevels) { const [p50, p999] = G.Engine.percentiles(rec.cs.sig, [50, 99.95], 7); rec._defaultLevels = { black: p50, white: Math.max(p999, p50 + 0.01) }; }
        ({black, white} = rec._defaultLevels);
      }
      S.levels[id] = { black, white, manual: false, stable: !!(es && es.length) };
    });
  };
  App.levelsOf = id => App.S.levels[id] || { black: 0, white: 1 };

  /* grey value for display: dark bands on light background when style.invert */
  App.mapper = function (id, own) {
    const lv = own || App.levelsOf(id), inv = App.S.style.invert, sc = 1 / Math.max(1e-6, lv.white - lv.black);
    return v => { let t = (v - lv.black) * sc; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.round((inv ? 1 - t : t) * 255); };
  };

  // the display levels of a row: its own when set (adjusted for this crop alone), else its picture's
  App.rowLevels = row => row.lv || App.levelsOf(row.img);
  App.rowMapper = row => App.mapper(row.img, row.lv);
  // straightened crop of lanes iA..iB of one box for a row, rendered to a canvas
  const rasterCache = new Map();
  App.runRaster = function (row, sg, pc, iA, iB, step) {
    const rec = App.images.get(row.img), lv = App.rowLevels(row);
    const u0 = App.laneLeft(sg, iA), u1 = App.laneRight(sg, iB), v0 = sg.vc - App.boxAbove(row, sg), v1 = sg.vc + App.boxBelow(row, sg);
    const key = [row.img, lv.black, lv.white, App.S.style.invert, pc.cx, pc.cy, pc.angle, pc.w, pc.h, sg.rot || 0, sg.pu, u0, u1, v0, v1, step.toFixed(3)].join('|');
    if (rasterCache.has(key)) return rasterCache.get(key);
    const F = App.segFrame(pc, sg);
    const win = WB.sampleWindow(sigOf(rec), F, u0, u1, v0, v1, step);
    const cv = document.createElement('canvas'); cv.width = win.w; cv.height = win.h;
    // what the box covers, wherever it lies (the pieces found are only a guess; outside the picture: background)
    const ctx = cv.getContext('2d'), id = ctx.createImageData(win.w, win.h), map = App.rowMapper(row);
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
    const parts = App.rowParts(row, true), inv = App.S.style.invert;
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
    const lat = App.pieceLanes(b, pc, v);
    const sg = { piece: pc.id, vc: v, b0: -bandH / 2, b1: bandH / 2, lanes: lat.lanes, c0: lat.c0, p: lat.p, x0: -pc.w / 2, x1: pc.w / 2 };
    const row = { id: uid('r'), column: App.activeColumn, blot: blotId, name: '', img: App.chemiOf(b)[0].id, auto: true, hidden: false, manual: true, segs: [sg],
      above: Math.max(bandH / 2 + 4, Math.min(bandH / 2 + margin, v + half - 2)), below: Math.max(bandH / 2 + 4, Math.min(bandH / 2 + margin, half - v - 2)) };
    if(App.S.defaultLaneCount){sg.lanes=[];sg.c0=1;sg.laneCount=App.S.defaultLaneCount;App.redetectBox(row,sg);}
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
    const row = { id: uid('r'), column: App.activeColumn, blot: blotId, name: '', img: ch[ch.length - 1].id, auto: true, hidden: false, manual: true, segs: [sg], above: half, below: half };
    if(App.S.defaultLaneCount)sg.laneCount=App.S.defaultLaneCount;
    App.redetectBox(row, sg);
    const p = sg.lanes.length >= 2 ? App.segPitch(sg) : pc.pitch || 100;
    sg.x0 = u0; sg.x1 = u1;
    if(!sg.laneCount)App.evenBox(row, sg, Math.max(1, Math.round((u1 - u0) / p)));
    App.snapBox(sg);
    App.rehomeSeg(row, sg);
    if(!sg.laneCount)App.alignSeg(row, sg);
    App.findBand(row, sg);
    App.levelBox(row, sg);
    insertRow(row);
    return row;
  };
  /* A moved box inherits its new strip's marker frame but remains an independent box, including when another
   * box of the same row already uses that strip. Its position on the picture is preserved. */
  App.rehomeSeg = function (row, sg) {
    const b = App.blot(row.blot), op = App.piece(b, sg.piece);
    if (!op) return null;
    const mid = (sg.x0 + sg.x1) / 2, [mx, my] = WB.toImg(pFrame(op), mid, sg.vc), hit = App.pieceAt(b, mx, my, 0);
    if (!hit || hit.pc === op) return null;
    const np = hit.pc, vc0 = sg.vc, m = carry(op, np, mid, vc0), du = m.u - mid;
    sg.lanes = sg.lanes.map(l => ({ u: carry(op, np, l.u, vc0).u, r: l.r }));
    if (sg.pu != null) sg.pu = carry(op, np, sg.pu, vc0).u;
    // (its own tilt on the picture stays: relative to the new piece's)
    if (sg.rot || op.angle !== np.angle) sg.rot = Math.round(((sg.rot || 0) + op.angle - np.angle) * 100) / 100;
    sg.x0 += du; sg.x1 += du; sg.vc = m.v; sg.piece = np.id;
    return np;
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
  // A single source protein crop may have several fragments after excluding an internal marker lane.
  // Those fragments are one region; formerly joined independent crops have different region keys.
  App.bindingGroups = row => {
    const groups = new Map();
    row.segs.forEach(sg => { const key = sg.cut ? sg.cut.id : App.boxId(sg); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(sg); });
    return [...groups.values()];
  };
  App.boundRows = () => App.S.rows.filter(r => App.bindingGroups(r).length > 1);
  // Kept only so old diagnostic URLs fail gracefully. The product has no merge operation.
  App.mergeRows = () => 'disabled';
  App.splitRow = function (row) {
    if (!row) return [];
    const groups = App.bindingGroups(row);
    if (groups.length < 2) return [];
    const current = App.rowLevels(row), level = { black: current.black, white: current.white }, original = { ...row };
    const rest = groups.slice(1).map(segs => ({ ...original, id: uid('r'), segs, lv: { ...level }, auto: false }));
    row.segs = groups[0]; row.lv = { ...level }; row.auto = false;
    App.S.rows.splice(App.S.rows.indexOf(row) + 1, 0, ...rest);
    [row, ...rest].forEach(App.fitRowHeight);
    return [row, ...rest];
  };
  App.unbindAll = () => App.boundRows().forEach(App.splitRow);

  /* ---------- marker bands set by hand ---------- */
  App.ladderU = pc => {
    if (pc.ladderUs && pc.ladderUs.length) return pc.ladderUs[0];
    const s = App.pieceSlots(pc).find(x => x.role === 'ladder');
    return s ? s.u : ((pc.roles || []).length ? pc.u0 - pc.pitch * 0.5 : -pc.w / 2 + 30);
  };
  // the piece's marks, editable (none yet: an empty list)
  App.manualMarks = (b, pc) => pc.marks || (pc.marks = []);
  /* a size suggestion for a new mark at v: with 2 marks or more, the ladder size the piece's marks predict there
   * (the nearest one it has no mark for yet; none when even that is far off — a click between two bands); with
   * one, the ladder's next size on the side clicked (below it: the next smaller); none for the first */
  App.suggestKda = function (b, pc, v) {
    const lad = G.ProteinLadders.get(b.ladderId), ms = (pc.marks || []).filter(m => m.kda > 0), pcal = App.pieceCal(b, pc);
    if (pcal) {
      const k = WB.kdaAtK(pcal, v);
      if (!k) return null;
      if (!lad) return Math.round(k);
      const off = s => Math.abs(Math.log(s / k)), free = lad.sizes.filter(s => !ms.some(m => Math.abs(Math.log(m.kda / s)) < 0.01)).sort((p, q) => off(p) - off(q));
      return free.length && off(free[0]) < 0.5 ? free[0] : null;
    }
    if (ms.length === 1 && lad) {
      const i = lad.sizes.findIndex(s => Math.abs(Math.log(s / ms[0].kda)) < 0.01), j = v > ms[0].v ? i + 1 : i - 1;
      return i >= 0 && lad.sizes[j] != null ? lad.sizes[j] : null;
    }
    return null;
  };
  // the picture a membrane's marker is marked on (white light, or white light and chemiluminescence in one)
  App.markerRec = b => (b && b.marker && App.images.get(b.marker)) || null;
  // the lane a piece's marks sit on (their middle one); none before the first mark
  App.markLane = pc => { const ms = (pc.marks || []).map(m => m.u).sort((a, c) => a - c); return ms.length ? ms[ms.length >> 1] : null; };
  /* bands down lane u of a piece in the marker picture (piece frame v, top to bottom): where a mark snaps to.
   * Prestained bands are dark in white light; in a picture with the chemiluminescence laid over, a band can be
   * bright — both count, each against the lane's own level around it (a closing / opening over ±24 px). */
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
    const E = G.Engine, sm = E.gaussSmooth(prof, 1.2), r = 24, out = [];
    [[E.slide(E.slide(sm, r, true), r, false), 1], [E.slide(E.slide(sm, r, false), r, true), -1]].forEach(([bg, sign]) => {
      const d = new Float32Array(n);
      let mx = 0; for (let k = 0; k < n; k++) { d[k] = Math.max(0, sign * (bg[k] - sm[k])); mx = Math.max(mx, d[k]); }
      if (mx > 0) E.findPeaks(d, 5, mx * 0.12).forEach(p => out.push({ v: v0 + p.i, prom: p.prom / mx, dark: sign > 0 }));
    });
    out.sort((a, c) => a.v - c.v);
    if (peakCache.size > 200) peakCache.clear();
    peakCache.set(key, out);
    return out;
  };
  // the band nearest to v within tol (piece frame px), else v itself
  App.snapMarkV = function (b, pc, u, v, tol) {
    let best = null;
    App.ladderPeaks(b, pc, u).forEach(p => { const d = Math.abs(p.v - v); if (d <= tol && (!best || d < best.d)) best = { v: p.v, d }; });
    return best ? best.v : v;
  };
  // a piece's marker for the panel: 'manual' (2 marks or more: sizes known), 'few' (one), 'none'; its sizes
  App.markInfo = function (b, pc) {
    const ks = App.pieceTicks(b, pc).map(t => t.k).sort((a, c) => c - a);
    return { state: ks.length >= 2 ? 'manual' : ks.length ? 'few' : 'none', ks };
  };
  // every mark of a membrane taken away
  App.clearMarks = b => (b.pieces || []).forEach(pc => { pc.marks = null; });
  // pieces whose sizes the figure uses (a shown row runs across them)
  App.usedPieces = b => (b.pieces || []).filter(pc => App.S.rows.some(r => !r.hidden && r.blot === b.id && r.segs.some(s => s.piece === pc.id)));

  /* ---------- the steps ---------- */
  // step 1: the picture a membrane's pieces are found in and its marker is marked on, chosen by the user (a white-
  // light picture, or white light and chemiluminescence in one); the membrane is analysed on it again
  App.setMarkerImage = function (b, id) {
    const rec = App.images.get(id);
    if (!rec || !b.images.includes(id)) return;
    if (rec.kind !== 'marker') { delete App.S.align[id]; App.applyAlign(rec); rec._reg = null; rec.kind = 'marker'; prepare(rec); }
    b.marker = id;
    b.dirty = true;
  };
  // step 2 → 3: the boxes of every membrane that has none yet, read on its confirmed pieces, each turned along
  // its band
  App.makeBoxes = function () {
    App.S.step = Math.max(App.S.step, 3);
    App.S.blots.forEach(b => {
      const old = new Set(App.S.rows.map(r => r.id));
      if (b.dirty || !App.analysis[b.id]) alignAndAnalyze(b, new Map(Object.entries(b.pendingInit || {})), true);
      if (App.analysis[b.id] && App.analysis[b.id].outlinesOnly) App.analyze(b);
      if (!b.boxesReady && !App.S.rows.some(r => r.blot === b.id) && App.analysis[b.id]) App.S.rows.push(...App.rowsFromAnalysis(b));
      b.boxesReady = true;
      App.S.rows.filter(r => r.blot === b.id && !old.has(r.id)).forEach(r => r.segs.forEach(sg => App.levelBox(r, sg)));
    });
  };
  // the box a click on the membrane adds (step 3), in the frame of piece pc: as wide and high as the other boxes on
  // that piece (else about six lanes and a band with room around it), centred at (u, v)
  App.defaultBox = function (b, pc, u, v) {
    const segs = App.S.rows.filter(r => r.blot === b.id).flatMap(r => r.segs.map(s => ({ s, h: App.boxAbove(r, s) + App.boxBelow(r, s) })));
    const mine = segs.filter(x => x.s.piece === pc.id), use = mine.length ? mine : segs;
    const med = a => a.sort((p, q) => p - q)[a.length >> 1];
    const w = use.length ? (App.S.defaultLaneCount ? App.S.defaultLaneCount * med(use.map(x => (x.s.x1-x.s.x0)/Math.max(1,x.s.lanes.length))) : med(use.map(x => x.s.x1 - x.s.x0))) : Math.min(pc.w, (App.S.defaultLaneCount || 6) * (pc.pitch || 100));
    const h = use.length ? med(use.map(x => x.h)) : Math.min(pc.h, Math.max(40, (pc.pitch || 100) * 0.6));
    return { u0: u - w / 2, u1: u + w / 2, v0: v - h / 2, v1: v + h / 2 };
  };

  /* ---------- membranes: moving pictures between them ---------- */
  function invalidateGroup(b) {
    if (!b) return;
    b.dirty = true;
    if (!b.images.includes(b.marker)) b.marker = null;
    if (!b.marker) b.marker = (App.markersOf(b)[0] || {}).id || null;
    const ch = App.chemiOf(b);
    App.S.rows.filter(r => r.blot === b.id).forEach(r => {
      if (!ch.some(c => c.id === r.img)) { r.img = (ch[0] || {}).id || null; r.auto = true; }
    });
  }
  App.moveImages = function (ids, toBlotId) {
    const S = App.S, active = App.activeImageIds(), moving = [...new Set(ids)].filter(id => active.has(id));
    if (!moving.length) return 0;
    let to = toBlotId === 'new' ? null : App.blot(toBlotId);
    if (!to && toBlotId !== 'new') return 0;
    if (!to) { to = newBlot([], null); S.blots.push(to); }
    const changed = new Set(); let n = 0;
    moving.forEach(id => {
      const from = S.blots.find(b => b.images.includes(id));
      if (!from || from === to) return;
      from.images = from.images.filter(i => i !== id); to.images.push(id);
      changed.add(from); changed.add(to); n++;
      delete S.align[id]; App.applyAlign(App.images.get(id));
    });
    changed.forEach(invalidateGroup);
    S.blots = S.blots.filter(b => b.images.length);
    S.rows = S.rows.filter(r => App.blot(r.blot));
    if (n) { S.step = 1; App.viewBlot = to.id; App.viewImg = moving.find(id => to.images.includes(id)); }
    return n;
  };
  App.moveImage = (id, to) => App.moveImages([id], to);
  App.setKind = function (imgId, kind) {
    const rec = App.images.get(imgId);
    if (!rec || rec.kind === kind) return;
    // as taken again: the alignment was for the other kind of picture
    delete App.S.align[imgId]; App.applyAlign(rec); rec._reg = null;
    rec.kind = kind; prepare(rec);
    const b = App.S.blots.find(b => b.images.includes(imgId));
    if (b) { if (kind === 'marker' && !b.marker) b.marker = imgId; if (kind !== 'marker' && b.marker === imgId) b.marker = null; invalidateGroup(b); }
  };
  App.setExposure = function (imgId, sec) {
    const rec = App.images.get(imgId); if (!rec) return;
    rec.exposure = sec > 0 ? sec : null;
    const b = App.S.blots.find(b => b.images.includes(imgId));
    if (b) { const ch = App.chemiOf(b); if (ch.every(c => c.exposure)) { const mx = Math.max(...ch.map(c => c.exposure)); ch.forEach(c => { c.factor = c.exposure / mx; }); } }
    expoCache.clear();
  };
  App.removeImages = function (ids) {
    const active = App.activeImageIds(), removed = new Set(ids.filter(id => active.has(id)));
    if (!removed.size) return 0;
    const S = App.S;
    S.blots.forEach(b => {
      if (!b.images.some(id => removed.has(id))) return;
      b.images = b.images.filter(id => !removed.has(id)); invalidateGroup(b);
    });
    S.blots = S.blots.filter(b => b.images.length);
    S.rows = S.rows.filter(r => App.blot(r.blot));
    removed.forEach(id => { delete S.levels[id]; delete S.align[id]; });
    App.syncImages();
    if (!App.blot(App.viewBlot)) App.viewBlot = (S.blots[0] || {}).id;
    if (removed.has(App.viewImg)) App.viewImg = null;
    S.step = 1;
    return removed.size;
  };
  App.removeImage = id => App.removeImages([id]);

  /* ---------- checks shown as warnings / legend text ---------- */
  App.isLoading = row => G.ProteinLadders.LOADING_RE.test(row.name || '');
  App.checks = function () {
    const S = App.S, warn = [], legend = [];
    const vis = S.rows.filter(r => !r.hidden);
    // a row in words: its name, else its size, else the pieces it comes from
    const label = r => {
      if (r.name) return r.name;
      if (App.rowKda(r)) return L(`≈${Math.round(App.rowKda(r))} kDa 行`, `≈${Math.round(App.rowKda(r))} kDa row`);
      const on = S.blots.length > 1 ? App.blotName(App.blot(r.blot)) + ' ' : '', ls = App.rowPieces(r).map(pc => pc.letter).join('+');
      return L(`${on}膜条 ${ls} 的行`, `row on ${on}strip ${ls}`);
    };
    const grids = App.layoutColumns().map(c => App.columns(c.id));
    vis.forEach(r => {
      const C = App.columns(App.rowColumn(r));
      const e = App.rowExpo(r).find(x => x.id === r.img);
      if (e && e.satFrac > 0.002) warn.push(L(`「${label(r)}」所选曝光中条带有过曝像素，定量不可靠，建议换短曝光`,
        `"${label(r)}": the bands have saturated pixels in the chosen exposure, so quantification is unreliable; use a shorter exposure`));
      if (App.rowClash(r).length) warn.push(L(`「${label(r)}」的几个框占了相同的列：在第 3 步选中这一行，把右边那个框往后挪（›）`,
        `"${label(r)}" has boxes on the same columns: in step 3, select this row and move the right-hand box along (›)`));
      if (!C.vis.some(j => App.colSource(r, j))) warn.push(L(`「${label(r)}」的泳道都不在成图的列范围里：在第 5 步调整列范围，或在第 3 步把这一行的列挪过来（‹ ›）`,
        `"${label(r)}" has no lanes in the figure's column range: change the column range in step 5, or move this row's columns over in step 3 (‹ ›)`));
    });
    const blotsUsed = [...new Set(vis.map(r => r.blot))];
    if (blotsUsed.length > 1) {
      legend.push('Bands shown in separate rows were detected on different membranes processed in parallel; each row is an individual crop.');
      const loadBlots = new Set(vis.filter(App.isLoading).map(r => r.blot));
      if (loadBlots.size) blotsUsed.forEach(bid => {
        if (!loadBlots.has(bid) && vis.some(r => r.blot === bid)) warn.push(L(`${App.blotName(App.blot(bid))} 未标记内参；请核对目标蛋白与内参是否来自同一张物理膜（图片分组不能证明这一点）`,
          `Proteins on ${App.blotName(App.blot(bid))} have no marked loading control; verify that target and control came from the same physical membrane (image grouping does not establish this)`));
      });
    }
    // membranes whose figure rows show sizes
    const sized = new Set(blotsUsed.filter(bid => S.style.showMW && vis.some(r => r.blot === bid && App.rowPieces(r).some(pc => App.pieceTicks(App.blot(bid), pc).length))));
    blotsUsed.forEach(bid => {
      const b = App.blot(bid);
      if (S.style.showMW && S.step >= 5 && !sized.has(bid)) {
        warn.push(L(`${App.blotName(b)} 还没标 Marker，成图没有分子量：在第 4 步标出可见的 Marker 带（1 条也可以）（不需要的话在第 5 步"更多版式"里关掉"分子量刻度"）`,
          `${App.blotName(b)} has no ladder marked yet, so the figure shows no molecular weights: in step 4, mark the visible marker bands (one is enough for a tick) (if you don't need them, turn off "MW ticks" under "More layout" in step 5)`));
      }
      (b.pieces || []).forEach(pc => {
        const ms = (pc.marks || []).filter(m => m.kda > 0).sort((p, q) => p.v - q.v);
        if (ms.length < 2) return;
        if (ms.some((m, i) => i && m.kda >= ms[i - 1].kda)) warn.push(L(`${App.pieceName(b, pc)}的 Marker 刻度顺序不对：分子量应从上往下减小`,
          `Marker ticks on ${App.pieceName(b, pc)} are out of order: molecular weights should decrease from top to bottom`));
      });
    });
    const localCuts = grids.some(C => C.src.some(rs => rs.some((a, i) => i > 0 && a && rs[i - 1] && (a.sg !== rs[i - 1].sg || a.i !== rs[i - 1].i + 1))));
    if (grids.some(C => C.gapAfter.size) || localCuts) legend.push('White gaps indicate discontinuities between the displayed source lanes or crop fragments.');
    if (S.style.invert) legend.push('Chemiluminescence images are shown inverted (dark bands on a light background).');
    // (levels of the whole picture, or a row's own: said as they are)
    const ownLv = vis.filter(r => r.lv).length;
    legend.push(!ownLv ? 'Brightness and contrast were adjusted linearly and applied to each whole image.'
      : ownLv === vis.length ? 'Brightness and contrast were adjusted linearly for each cropped panel as a whole.'
      : 'Brightness and contrast were adjusted linearly, applied to the whole image or, for some panels, to the cropped panel as a whole.');
    // band marks: what they mean is the author's to say (as GelFigure)
    const shownArrows = (S.arrows || []).filter(a => vis.some(r => r.id === a.row)), syms = new Set(shownArrows.map(a => a.sym));
    if (syms.has('*')) legend.push('Asterisks (*) indicate non-specific bands.');
    if (syms.has('#')) legend.push('# indicates [describe, e.g. degradation products].');
    if (syms.has('†')) legend.push('† indicates [describe].');
    if (shownArrows.some(a => a.sym === '◀' && a.auto && !a.sizeText && /≈/.test(App.arrowSize(a)))) legend.push('Sizes marked ≈ were extrapolated beyond the marked ladder bands.');
    const lads = [...new Set([...sized].map(bid => App.blot(bid).ladderId).filter(Boolean))].map(id => G.ProteinLadders.get(id)).filter(Boolean);
    if (lads.length) legend.push(`Molecular-weight marker positions (${lads.map(l => l.name.replace(/\s*\(.*\)|\*/g, '')).join(' / ')}) are indicated in kDa on the ${S.style.mwSide === 'right' ? 'right' : 'left'}; sizes are apparent molecular weights.`);
    const ex = [...new Set(vis.map(r => App.images.get(r.img)).filter(Boolean).map(rec => App.expoLabel(rec)))];
    if (ex.length) legend.push(`Exposure: ${vis.map(r => `${r.name || '?'} ${App.expoLabel(App.images.get(r.img))}`).join('; ')}.`);
    return { warn, legend, label };
  };

  /* ---------- resolution: image pixels behind each printed lane ----------
   * A lane is printed mmPerLane wide from about one lane spacing (pitch) of picture pixels: the narrowest pitch
   * among the shown rows sets the resolution of the bands themselves (exporting at a higher dpi only enlarges
   * those pixels). */
  const shownPitches = () => App.S.rows.filter(r => !r.hidden).flatMap(r => r.segs.filter(sg => App.nSample(sg)).map(sg => App.segPitch(sg)));
  App.effectiveDpi = function () {
    const ps = shownPitches();
    return ps.length ? Math.min(...ps) / (App.S.style.mmPerLane / 25.4) : Infinity;
  };
  // the widest lane (mm, in 0.5 mm steps) that keeps the bands at dpi or more
  App.maxSafeMmPerLane = function (dpi) {
    const ps = shownPitches();
    return ps.length ? Math.floor(Math.min(...ps) / (dpi || 300) * 25.4 * 2) / 2 : null;
  };

  /* ---------- pre-flight before export (as GelFigure): what a reviewer or a journal check would catch. Items
   * {level: 'block' | 'warn' | 'info', text, fix: {label, run, leave}}; leave: the fix needs the user (the dialog
   * closes, the export waits). ---------- */
  App.preflight = function () {
    const S = App.S, st = S.style, out = [], add = (level, text, fix) => out.push({ level, text, fix });
    const vis = S.rows.filter(r => !r.hidden), ck = App.checks(), label = ck.label;
    if (S.blots.some(b => b.dirty)) { add('block', L('图片分组已修改，请先在第 1 步确认，再导出。', 'Picture groups changed. Confirm step 1 before exporting.')); return out; }
    if (!vis.length) { add('block', L('成图里还没有蛋白行。', 'The figure has no protein rows yet.')); return out; }
    if (App.boundRows().length) add('warn', L('旧版合并的独立区域仍共用曝光和亮度，建议先解除绑定，再分别检查。', 'Independent regions combined by an older version still share exposure and levels. Detach and review them separately.'),
      { label: L('解除旧版绑定', 'Detach legacy regions'), run: () => App.unbindAll() });
    const eff = App.effectiveDpi(), safe = App.maxSafeMmPerLane(300);
    if (eff < 300) add('block', L(`条带本身的有效分辨率只有 ${Math.round(eff)} dpi（< 300）：每道 ${st.mmPerLane} mm 太宽，导出 ${st.dpi} dpi 也只是把像素放大。`,
      `Effective resolution of the bands ${Math.round(eff)} dpi (< 300): ${st.mmPerLane} mm per lane is too wide, and exporting at ${st.dpi} dpi only enlarges the pixels.`),
      safe >= 2 ? { label: L(`改为每道 ${safe} mm`, `Set to ${safe} mm per lane`), run: () => { st.mmPerLane = safe; } } : null);
    // clipped pixels in the exposures shown: another exposure of the same row may be clean
    vis.forEach(r => {
      const ex = App.rowExpo(r), e = ex.find(x => x.id === r.img);
      if (!e || !(e.satFrac > 0.002)) return;
      const best = App.bestExpo(r), be = ex.find(x => x.id === best);
      add('warn', L(`「${label(r)}」所选曝光中 ${(e.satFrac * 100).toFixed(1)}% 的条带像素过曝（相机饱和），这一行不能定量。`,
        `"${label(r)}": ${(e.satFrac * 100).toFixed(1)}% of the band pixels are saturated in the chosen exposure (camera saturation); this row cannot be quantified.`),
        best !== r.img && be && be.satFrac < e.satFrac ? { label: L('改用推荐曝光', 'Use the recommended exposure'), run: () => { r.img = best; r.auto = true; } } : null);
    });
    // the smallest text actually printed (per-kind sizes count)
    const f = G.BRender.build(false), minPt = Math.round((f.minPt || st.fontPt) * 10) / 10;
    if (minPt < 5) add('warn', L(`最小字号 ${minPt} pt 偏小（多数期刊要求 ≥ 5–6 pt）。`, `The smallest text is ${minPt} pt (most journals ask for ≥ 5–6 pt).`), { label: L('全部至少 6 pt', 'Make all text ≥ 6 pt'), run: () => {
      const up = v => (v && v < 6 ? 6 : v);

      st.fontPt = Math.max(st.fontPt, 6); ['lanePt', 'markerPt', 'namePt'].forEach(k => { st[k] = up(st[k]); }); st.minFontPt = Math.max(st.minFontPt || 5, 6);
      [...App.layoutColumns().flatMap(c => [App.columnData(c.id).groups, App.columnData(c.id).conditions]), S.arrows, S.brackets].forEach(list => (list || []).forEach(o => { if (o.pt) o.pt = up(o.pt); }));
    } });
    if (st.lineWidthPt < 0.25) add('warn', L(`线宽 ${st.lineWidthPt} pt 太细。`, `Line width ${st.lineWidthPt} pt is too thin.`), { label: L('改为 0.5 pt', 'Use 0.5 pt'), run: () => { st.lineWidthPt = 0.5; } });
    const wmm = f.w / MM;
    if (wmm > 183) add('warn', L(`成图宽 ${wmm.toFixed(0)} mm，超过双栏宽度（约 180 mm）。`, `The figure is ${wmm.toFixed(0)} mm wide, wider than a double column (about 180 mm).`));
    (f.overlaps || []).forEach(w => add('warn', w));
    const unnamed = vis.filter(r => !r.name), nu = unnamed.length;
    if (nu) add('warn', L(`${nu} 行还没有蛋白名（成图上不显示名字）。`, `${nu} ${nu === 1 ? 'row has' : 'rows have'} no protein name yet (no name shows in the figure).`),
      { label: L('去填名字', 'Add names'), leave: true, run: () => { if (App.goNames) App.goNames(); } });
    const allLanes = App.layoutColumns().flatMap(c => App.figLanes(c.id).map(j => App.columnData(c.id).lanes[j - 1]));
    const lanesNoName = allLanes.filter(l => !l.name), nl = lanesNoName.length;
    if (App.layoutColumns().some(c => !App.rowsInColumn(c.id).some(r => !r.hidden))) add('info', L('空的排版列不会导出。', 'Empty layout columns are omitted from exports.'));
    if ((S.brackets || []).some(k => !App.bracketRows(k).length)) add('warn', L('有括号的两端已移到不同列：该括号暂不显示，可将区域移回或重新标注。', 'A bracket spans different columns and is not displayed. Move its regions back or redraw it.'));
    if (nl && nl < allLanes.length) add('info', L(`${nl} 条泳道还没有名字。`, `${nl} ${nl === 1 ? 'lane has' : 'lanes have'} no name yet.`));
    else if (nl) add('info', L('泳道还没有名字（成图上方只有空白）。', 'The lanes have no names yet (the top of the figure is blank).'),
      { label: L('去填泳道名', 'Add lane names'), leave: true, run: () => { if (App.goNames) App.goNames(true); } });
    // (checks() warnings that belong here, told by their words in either language)
    ck.warn.filter(w => /同膜内参|还没标 Marker|顺序不对|相同的列|列范围|loading control on the same membrane|no ladder marked yet|out of order|on the same columns|column range/.test(w)).forEach(w => add('warn', w));
    if (vis.some(r => r.lv)) add('info', L('有的行单独调过亮度 / 对比度（逐块线性调整），图注提示里已加说明。', 'Some rows have brightness / contrast of their own (linear, per panel); the legend notes say so.'));
    if ((S.arrows || []).some(a => a.sym === '◀' && a.auto && /≈/.test(App.arrowSize(a)))) add('info', L('有目标条带的分子量是外推值（已标 ≈）。', 'Some target band sizes are extrapolated (marked ≈).'));
    if (st.showMW && S.blots.some(b => b.ladderId)) add('info', L('预染 Marker 标注的是表观分子量（随胶浓度、缓冲体系偏移），图注中建议写 "apparent molecular weight"。', 'Prestained marker sizes are apparent molecular weights that shift with gel percentage and buffer; state "apparent molecular weight" in the legend.'));
    return out;
  };

  /* ---------- the processing log (JSON, as GelFigure's): sources with fingerprints, how every row was made,
   * every setting; and a short summary embedded in exported PNG / TIFF ---------- */
  const r1 = v => Math.round(v * 10) / 10;
  App.processingLog = function () {
    const S = App.S, f = G.BRender.build(false), ck = App.checks();
    const letter = (b, id) => (App.piece(b, id) || {}).letter || '?';
    return {
      tool: 'BlotFigure', version: App.VERSION, exportedAt: new Date().toISOString(),
      environment: { userAgent: navigator.userAgent, figureFont: 'Arial, Helvetica, sans-serif (vector text)' },
      images: [...App.images.values()].map(r => {
        const b = S.blots.find(x => x.images.includes(r.id)), al = S.align[r.id], raw = r.raw || r;
        return { file: r.name, sha256: r.sha256 || null, bytes: r.bytes || null, width: raw.img.w, height: raw.img.h, bitDepth: r.bits,
          kind: r.kind === 'chemi' ? 'exposure' : 'marker picture', exposureSec: r.exposure != null ? r.exposure : null, membrane: b ? App.blotNameEn(b) : null,
          markerPictureOf: b && b.marker === r.id ? App.blotNameEn(b) : undefined, resampledToExposureSize: !!r.resampled || undefined,
          alignment: al ? { rotationDeg: Math.round(al.a * 1000) / 1000, shiftPx: [r1(al.tx), r1(al.ty)], by: al.how === 'manual' ? 'hand' : 'automatic', pieces: al.pieces ? Object.keys(al.pieces).map(id => letter(b, id)) : undefined } : null,
          levels: S.levels[r.id] ? { black: S.levels[r.id].black, white: S.levels[r.id].white, manual: !!S.levels[r.id].manual, note: 'linear whole-image stretch; fractions of full scale' } : undefined };
      }),
      membranes: S.blots.map(b => ({ name: App.blotNameEn(b), markerPicture: (App.markerRec(b) || {}).name || null, ladder: (G.ProteinLadders.get(b.ladderId) || {}).name || null,
        piecesSetByHand: !!b.userStrips, manuallyExcludedDividerLane:b.dividerLane||null, laneCountAtDetection: b.laneCountAtDetection || null,
        pieces: (b.pieces || []).map(pc => ({ letter: pc.letter, centrePx: [r1(pc.cx), r1(pc.cy)], angleDeg: pc.angle, sizePx: [r1(pc.w), r1(pc.h)],
          markerMarks: (pc.marks || []).filter(m => m.kda > 0).map(m => ({ id: App.markerId(m), kDa: m.kda, vPx: r1(m.v) })) })) })),
      rows: S.rows.map(r => {
        const b = App.blot(r.blot), e = App.rowExpo(r).find(x => x.id === r.img), lv = App.rowLevels(r);
        return { column: App.rowColumn(r), hiddenMarkers: r.hiddenMarkers || [], name: r.name || null, shown: !r.hidden, membrane: App.blotNameEn(b), exposure: (App.images.get(r.img) || {}).name || null,
          recommendedExposure: (App.images.get(App.bestExpo(r)) || {}).name || null, saturatedBandFrac: e ? +e.satFrac.toFixed(5) : null,
          apparentKDa: App.rowKda(r) ? r1(App.rowKda(r)) : null,
          levels: { black: lv.black, white: lv.white, ownToThisRow: !!r.lv },
          boxes: r.segs.map(sg => ({ id: App.boxId(sg), label: App.boxLabel(sg), piece: letter(b, sg.piece), firstFigureColumn: sg.c0, fixedLaneCount: sg.laneCount || null, tiltDeg: sg.rot || 0,
            boxPx: { u0: r1(sg.x0), u1: r1(sg.x1), vTop: r1(sg.vc - App.boxAbove(r, sg)), vBottom: r1(sg.vc + App.boxBelow(r, sg)) },
            lanes: sg.lanes.map(l => ({ uPx: r1(l.u), role: l.r === 's' ? 'sample' : l.r === 'm' ? 'marker' : 'left out' })) })) };
      }),
      figure: { defaultLaneCount: S.defaultLaneCount || null, widthMm: r1(f.w / MM), heightMm: r1(f.h / MM), columns: App.figLanes('main'), laneNames: App.figLanes('main').map(j => (S.lanes[j - 1] || {}).name || ''),
        layoutColumns: App.layoutColumns().map(c => ({ id: c.id, title: c.title, titleSide: c.titleSide, ...Object.fromEntries([...columnFields].map(k => [k, App.columnData(c.id)[k]])) })),
        effectiveBandDpi: Math.round(Math.min(99999, App.effectiveDpi())), exportDpi: S.style.dpi },
      arrows: (S.arrows || []).map(a => ({ row: (App.row(a.row) || {}).name || null, symbol: a.sym, side: a.side, text: a.text || null, size: a.sym === '◀' ? (a.sizeText || App.arrowSize(a) || null) : null, userSize: a.sizeText || null })),
      brackets: (S.brackets || []).map(k => ({ fromRow: (App.row(k.r0) || {}).name || null, toRow: (App.row(k.r1) || {}).name || null, fromFrac: k.f0, toFrac: k.f1, side: k.side, vertical: !!k.vertical, line: !!k.line, text: k.text || null })),
      groups: S.groups, conditions: S.conditions, style: S.style,
      legendHints: ck.legend
    };
  };
  /* ---------- resets and style files (as GelFigure) ---------- */
  // the layout back to its defaults (the export resolution kept)
  App.resetLayout = function () { App.S.style = Object.assign(defaultStyle(), { dpi: App.S.style.dpi }); };
  // everything back to the moment after the pictures were loaded (one undoable step)
  App.resetAll = function () {
    if (!App.initial) return false;
    if (App.onSwap) App.onSwap();
    App.S = JSON.parse(App.initial); App.activeColumn = 'main';
    App.selRow = App.selSeg = App.selLane = App.selMark = null;
    App.syncPieces(); App.syncAlign();
    return true;
  };
  /* a style file: what one figure of a series shares with the next — lane names, groups and condition rows
   * (relative to the figure's first column), the protein names top to bottom, the ladder and the layout */
  App.template = function () {
    const S = App.S, fl = App.figLanes('main'), rel = j => fl.indexOf(j);
    return { blotfigTemplate: 1, defaultLaneCount: S.defaultLaneCount || null, app: 'BlotFigure ' + App.VERSION,
      layoutColumns: App.layoutColumns().map(c => ({ id: c.id, title: c.title, titleSide: c.titleSide, lanes: App.columnData(c.id).lanes.map(l => ({name:l.name})), groups: App.columnData(c.id).groups, conditions: App.columnData(c.id).conditions })),
      rowColumns: S.rows.filter(r => !r.hidden).map(App.rowColumn),
      lanes: fl.map(j => ({ name: (S.lanes[j - 1] || {}).name || '' })),
      groups: S.groups.map(g => ({ from: rel(Math.min(g.from, g.to)), to: rel(Math.max(g.from, g.to)), text: g.text || '', pt: g.pt || null })).filter(g => g.from >= 0 && g.to >= 0),
      conditions: S.conditions.map(c => ({ name: c.name || '', values: fl.map(j => c.values[j - 1] || ''), pt: c.pt || null })),
      proteins: S.rows.filter(r => !r.hidden).map(r => r.name || ''),
      ladderId: (S.blots.find(b => b.ladderId) || {}).ladderId || null,
      style: S.style };
  };
  App.applyTemplate = function (t) {
    if (!t || !t.blotfigTemplate) throw new Error(L('不是 BlotFigure 样式文件', 'Not a BlotFigure style file'));
    const S = App.S, fl = App.figLanes('main'), vis = S.rows.filter(r => !r.hidden);
    if('defaultLaneCount' in t)App.setDefaultLaneCount(t.defaultLaneCount);
    const abs = k => fl[Math.max(0, Math.min(fl.length - 1, k))];
    (t.lanes || []).forEach((l, k) => { if (fl[k] != null) S.lanes[fl[k] - 1].name = l.name || ''; });
    S.groups = (t.groups || []).filter(g => g.from < fl.length).map(g => Object.assign({ from: abs(g.from), to: abs(g.to), text: g.text || '' }, g.pt ? { pt: g.pt } : {}));
    S.conditions = (t.conditions || []).map(c => {
      const values = S.lanes.map(() => '');
      fl.forEach((j, k) => { values[j - 1] = (c.values || [])[k] || ''; });
      return Object.assign({ name: c.name || '', values }, c.pt ? { pt: c.pt } : {});
    });
    (t.proteins || []).forEach((n, k) => { if (vis[k] && n) vis[k].name = n; });
    if (t.ladderId && G.ProteinLadders.get(t.ladderId)) S.blots.forEach(b => App.setLadder(b, t.ladderId));
    if (t.layoutColumns?.length) {
      const cs = JSON.parse(JSON.stringify(t.layoutColumns));
      S.layoutColumns = cs.map(c => ({ ...c, lanes: (c.lanes || []).map(l => ({name:l.name || '', hidden:false})), range:[1,Math.max(1,c.lanes?.length || 1)], hiCol:0 }));
      const main = S.layoutColumns.find(c => c.id === 'main');
      if (!main) S.layoutColumns.unshift({ id:'main', title:'', titleSide:'top' });
      else { S.lanes = main.lanes; S.groups = main.groups || []; S.conditions = main.conditions || []; S.range = main.range; }
      const ids = new Set(S.layoutColumns.map(c => c.id));
      vis.forEach((r,i) => { r.column = ids.has(t.rowColumns?.[i]) ? t.rowColumns[i] : 'main'; });
      S.rows.forEach(r => { if (!ids.has(App.rowColumn(r))) r.column = 'main'; });
      if (main) columnFields.forEach(k => { delete main[k]; });
      App.fitLanes(true);
    }
    S.style = Object.assign(defaultStyle(), t.style || {});
    return { lanes: (t.lanes || []).length, figLanes: fl.length, proteins: (t.proteins || []).filter(Boolean).length, rows: vis.length };
  };
  App.summaryText = function () {
    const S = App.S, vis = S.rows.filter(r => !r.hidden);
    return JSON.stringify({
      tool: 'BlotFigure ' + App.VERSION,
      sources: [...new Set(vis.map(r => r.img))].map(id => App.images.get(id)).filter(Boolean).map(r => ({ file: r.name, sha256: r.sha256 || null })),
      rows: vis.map(r => ({ column: App.rowColumn(r), name: r.name || null, exposure: (App.images.get(r.img) || {}).name, levels: App.rowLevels(r), tilts: r.segs.map(sg => sg.rot || 0) })),
      effectiveBandDpi: Math.round(Math.min(99999, App.effectiveDpi())), disclosure: App.checks().legend.join(' ')
    });
  };

  G.BApp = App;
  G.BApp.MM = MM;
})(window);
