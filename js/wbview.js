/* Middle panel: one image of one membrane at a time.
 * Pieces: outline, letter, and lane labels along the top edge — the figure column of each lane, M = ladder,
 * × = not used; click a label to switch it. Rows: a box on every piece the row runs across; drag a box edge
 * to change the crop height, drag inside to move the band on that piece (Shift: on all its pieces).
 * Modes: 'addrow' click adds a row; 'addseg' click stitches the clicked piece into the selected row;
 * 'marks' click on a piece adds a marker band, drag moves one, click its size to change or delete it. */
(function (G) {
  'use strict';
  const App = G.BApp, WB = G.WB;
  const cv = document.getElementById('editor'), box = document.getElementById('editorBox'), ctx = cv.getContext('2d');
  const view = { s: 1, ox: 0, oy: 0 };
  let dpr = 1, drag = null, hover = null, spaceDown = false, fitted = null;
  const COLORS = ['#2f6feb', '#d6336c', '#0ca678', '#f08c00', '#7048e8', '#1098ad', '#e8590c', '#5c940d'];
  App.rowColor = row => COLORS[App.S.rows.indexOf(row) % COLORS.length];
  const toImg = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });
  const toScr = (x, y) => ({ x: x * view.s + view.ox, y: y * view.s + view.oy });
  const pFrame = pc => WB.frame(pc.cx, pc.cy, pc.angle);
  const FONT = '-apple-system, Segoe UI, Arial';

  function curImage() {
    const b = App.S && App.blot(App.viewBlot);
    if (!b) return null;
    if (!App.viewImg || !b.images.includes(App.viewImg)) {
      const sel = App.selRow && App.row(App.selRow);
      App.viewImg = sel && sel.blot === b.id ? sel.img : (App.chemiOf(b)[0] || App.markersOf(b)[0] || {}).id;
    }
    return App.images.get(App.viewImg);
  }
  // display canvas of a whole image with its current levels (markers: auto stretch)
  function dispCanvas(rec) {
    const lv = rec.kind === 'chemi' ? App.levelsOf(rec.id) : null;
    const key = rec.kind === 'chemi' ? [lv.black, lv.white, App.S.style.invert].join('|') : 'm';
    if (rec._disp && rec._dispKey === key) return rec._disp;
    const c = document.createElement('canvas'); c.width = rec.img.w; c.height = rec.img.h;
    const id = new ImageData(rec.img.w, rec.img.h), n = rec.img.w * rec.img.h;
    if (rec.kind === 'chemi') {
      const map = App.mapper(rec.id), s = rec.cs.sig;
      for (let i = 0; i < n; i++) { const v = map(s[i]); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    } else {
      const [lo, hi] = G.Engine.percentiles(rec.img.data, [0.5, 99.5], 5), sc = 255 / Math.max(1e-6, hi - lo);
      for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, (rec.img.data[i] - lo) * sc)); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    }
    c.getContext('2d').putImageData(id, 0, 0);
    rec._disp = c; rec._dispKey = key; rec._sat = null;
    return c;
  }
  function satCanvas(rec) {
    if (rec._sat) return rec._sat;
    const c = document.createElement('canvas'); c.width = rec.img.w; c.height = rec.img.h;
    const id = new ImageData(rec.img.w, rec.img.h);
    if (rec.cs && rec.cs.clip !== Infinity) for (let i = 0; i < rec.cs.sig.length; i++) if (rec.cs.sig[i] >= rec.cs.clip - 1e-6) { id.data[i * 4] = 255; id.data[i * 4 + 3] = 255; }
    c.getContext('2d').putImageData(id, 0, 0);
    return (rec._sat = c);
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = box.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    if (fitted !== App.viewBlot) fitFull(); else draw();
  }
  function fitFull() {
    const rec = App.S && curImage(); if (!rec) return;
    const r = box.getBoundingClientRect(), pad = 24;
    if (r.width < 10) return;
    view.s = Math.min((r.width - 2 * pad) / rec.img.w, (r.height - 2 * pad - 14) / rec.img.h);
    view.ox = (r.width - rec.img.w * view.s) / 2; view.oy = (r.height - rec.img.h * view.s) / 2 + 7;
    fitted = App.viewBlot;
    draw();
  }

  /* ---------- geometry on screen ---------- */
  // lane labels of a piece, just above its top edge
  function laneLabels(pc) {
    const F = pFrame(pc);
    return App.slots(pc).map(s => { const [x, y] = WB.toImg(F, s.u, -pc.h / 2); const p = toScr(x, y); return { s, x: p.x, y: p.y - 9 }; });
  }
  // lane labels of which pieces: the selected row's / piece's when something is selected, else all
  // (never while marking: the marks need the room)
  function labelled(pc) {
    if (App.mode === 'marks') return false;
    const row = App.selRow && App.row(App.selRow);
    if (!row && !App.selPiece) return true;
    return App.selPiece === pc.id || (row && row.segs.some(s => s.piece === pc.id));
  }
  const labelsFit = pc => labelled(pc) && pc.pitch * view.s >= 15;
  function letterTag(pc) { const [x, y] = WB.toImg(pFrame(pc), -pc.w / 2, -pc.h / 2); const p = toScr(x, y); return { x: p.x + 4, y: p.y + 4, w: 18, h: 16 }; }
  // the box of a row on one of its pieces: over the piece's lanes shown in the figure (else all of them)
  function segBox(row, sg, pc) {
    const vis = new Set(App.figLanes()), sl = App.slots(pc);
    let ms = sl.filter(s => s.col != null && vis.has(s.col)).map(s => s.m);
    const out = !ms.length;
    if (!ms.length) ms = sl.filter(s => s.role !== 'ladder').map(s => s.m);
    if (!ms.length) ms = [0];
    const F = pFrame(pc), u0 = pc.u0 + (Math.min(...ms) - 0.5) * pc.pitch, u1 = pc.u0 + (Math.max(...ms) + 0.5) * pc.pitch;
    const vTop = sg.vc - row.above, vBot = sg.vc + row.below;
    return { F, u0, u1, vTop, vBot, out, pts: [[u0, vTop], [u1, vTop], [u1, vBot], [u0, vBot]].map(([u, v]) => WB.toImg(F, u, v)) };
  }
  // marker bands of a piece as drawn: hand-set marks, or the automatic sizes (seen = a detected band)
  // (while marking, also the sizes the marks predict for the other ladder bands, dashed, to help find them)
  function marksOf(b, pc) {
    const pcal = App.pieceCal(b, pc), lad = G.ProteinLadders.get(b.ladderId), u = App.ladderU(pc);
    const predicted = have => (App.mode === 'marks' && pcal && lad ? lad.sizes.filter(k => !have.some(h => Math.abs(Math.log(h / k)) < 0.02))
      .map(k => ({ u, v: WB.vAtK(pcal, k), k, seen: false })).filter(t => t.v != null && Math.abs(t.v) <= pc.h / 2) : []);
    if (pc.marks) return pc.marks.map((m, i) => ({ u: m.u, v: m.v, k: m.kda, i, seen: true, manual: true })).concat(pcal && pcal.knots.length >= 2 ? predicted(pc.marks.map(m => m.kda)) : []);
    if (!pcal) return [];
    const bands = pcal.bands || [];
    return App.pieceTicks(b, pc).map(t => ({ u, v: t.v, k: t.k, seen: bands.some(x => Math.abs(x.v - t.v) < 4) }));
  }
  const fmtK = k => (k > 0 ? String(+(+k).toPrecision(3)) : '?');

  function draw() {
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!App.S) return;
    const rec = curImage(); if (!rec) return;
    const b = App.blot(App.viewBlot);
    ctx.imageSmoothingEnabled = view.s < 2;
    ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s);
    ctx.drawImage(dispCanvas(rec), 0, 0);
    if (document.getElementById('showSat').checked && rec.kind === 'chemi') ctx.drawImage(satCanvas(rec), 0, 0);
    ctx.restore();
    const line = (pts, close) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const p = toScr(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); if (close) ctx.closePath(); };
    const marking = App.mode === 'marks';
    // pieces
    (b.pieces || []).forEach(pc => {
      const F = pFrame(pc), sel = App.selPiece === pc.id;
      const pts = [[-pc.w / 2, -pc.h / 2], [pc.w / 2, -pc.h / 2], [pc.w / 2, pc.h / 2], [-pc.w / 2, pc.h / 2]].map(([u, v]) => WB.toImg(F, u, v));
      ctx.strokeStyle = sel ? '#2f6feb' : 'rgba(120,130,145,.7)'; ctx.lineWidth = sel ? 1.8 : 1; ctx.setLineDash(sel ? [] : [4, 4]);
      line(pts, true); ctx.stroke(); ctx.setLineDash([]);
      const t = letterTag(pc);
      ctx.fillStyle = sel ? '#2f6feb' : 'rgba(60,70,85,.85)'; roundRect(t.x, t.y, t.w, t.h, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(pc.letter || '?', t.x + t.w / 2, t.y + 12);
      // lane labels
      const vis = new Set(App.figLanes());
      laneLabels(pc).forEach(L => {
        const { s } = L;
        if (!labelsFit(pc)) {
          // small ticks only: blue = a lane in the figure, grey = ladder / not used
          const a = WB.toImg(F, s.u, -pc.h / 2), c = WB.toImg(F, s.u, -pc.h / 2 + 6 / view.s);
          ctx.strokeStyle = s.role === 'sample' ? 'rgba(47,111,235,.8)' : 'rgba(150,158,168,.8)'; ctx.lineWidth = 1; line([a, c]); ctx.stroke(); return;
        }
        const txt = s.role === 'sample' ? String(s.col) : s.role === 'ladder' ? 'M' : '×', bw = Math.max(16, txt.length * 7 + 6);
        const shown = s.role === 'sample' && vis.has(s.col);
        ctx.fillStyle = s.role === 'ladder' ? '#ffe8a3' : shown ? '#fff' : '#eef0f3';
        ctx.strokeStyle = s.role === 'ladder' ? '#e0a800' : shown ? '#2f6feb' : '#c3c9d1'; ctx.lineWidth = 1;
        roundRect(L.x - bw / 2, L.y - 7, bw, 14, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = s.role === 'ladder' ? '#7a5a00' : shown ? '#1d3f8f' : '#9aa3ad'; ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(txt, L.x, L.y + 3.5);
      });
    });
    // marker bands (amber): hand-set marks are solid with a handle, detected ones solid, predicted dashed
    ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'right';
    (b.pieces || []).forEach(pc => {
      const F = pFrame(pc);
      marksOf(b, pc).forEach(m => {
        if (!m.seen && !marking) return;
        const a = WB.toImg(F, m.u - pc.pitch * 0.45, m.v), c = WB.toImg(F, m.u + pc.pitch * 0.45, m.v);
        ctx.strokeStyle = m.seen ? '#e0a800' : 'rgba(224,168,0,.55)'; ctx.lineWidth = m.manual ? 2 : 1.4; ctx.setLineDash(m.seen ? [] : [3, 3]);
        line([a, c]); ctx.stroke(); ctx.setLineDash([]);
        const p = toScr(a[0], a[1]);
        if (m.manual && marking) { ctx.fillStyle = '#e0a800'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(fmtK(m.k), p.x - 6, p.y + 3.5);
        ctx.fillStyle = '#8a6100'; ctx.fillText(fmtK(m.k), p.x - 6, p.y + 3.5);
      });
    });
    // rows: one box per piece the row runs across
    App.S.rows.filter(r => r.blot === b.id).forEach(row => {
      const sel = App.selRow === row.id, col = App.rowColor(row);
      ctx.globalAlpha = row.hidden ? 0.4 : marking ? 0.5 : 1;
      let last = null;
      row.segs.forEach(sg => {
        const pc = App.piece(b, sg.piece); if (!pc) return;
        const bx = segBox(row, sg, pc);
        ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.4 : 1.4; ctx.setLineDash(bx.out ? [2, 3] : row.img === rec.id || rec.kind === 'marker' ? [] : [6, 4]);
        line(bx.pts, true); ctx.stroke(); ctx.setLineDash([]);
        if (sel) { ctx.fillStyle = col + '14'; line(bx.pts, true); ctx.fill(); }
        if (!last || bx.pts[1][0] > last[0]) last = bx.pts[1];
      });
      if (last) {
        const p = toScr(last[0], last[1]);
        const kda = App.rowKda(row), on = App.images.get(row.img);
        const txt = `${row.name || (kda ? '≈' + Math.round(kda) + ' kDa' : '未命名')} · ${on ? (row.img === App.bestExpo(row) ? '★ ' : '') + App.expoLabel(on) : ''}`;
        ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left';
        const tw = ctx.measureText(txt).width + 12;
        ctx.fillStyle = col; roundRect(p.x + 6, p.y - 1, tw, 18, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(txt, p.x + 12, p.y + 12);
      }
      ctx.globalAlpha = 1;
    });
    if ((App.mode === 'addrow' || App.mode === 'addseg' || marking) && hover && hover.p) {
      ctx.strokeStyle = marking ? '#e0a800' : '#2f6feb'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      const hit = App.pieceAt(b, hover.p.x, hover.p.y, 0);
      if (hit) {
        const F = pFrame(hit.pc);
        line([WB.toImg(F, -hit.pc.w / 2, hit.v), WB.toImg(F, hit.pc.w / 2, hit.v)]); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    document.getElementById('zoomLabel').textContent = Math.round(view.s * 100) + '%';
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function hitTest(sx, sy) {
    const b = App.blot(App.viewBlot); if (!b) return { type: 'pan' };
    if (spaceDown) return { type: 'pan' };
    const p = toImg(sx, sy), tol = 7 / view.s;
    if (App.mode === 'marks') {
      for (const pc of b.pieces || []) {
        const [u, v] = WB.toFrame(pFrame(pc), p.x, p.y);
        const m = marksOf(b, pc).find(m => Math.abs(v - m.v) <= tol && u >= m.u - pc.pitch * 0.6 - 30 / view.s && u <= m.u + pc.pitch * 0.6);
        if (m) return { type: 'mark', pc, m, v };
      }
      const hit = App.pieceAt(b, p.x, p.y, 0);
      return hit ? { type: 'newmark', pc: hit.pc, u: hit.u, v: hit.v } : { type: 'pan', p };
    }
    if (App.mode) return { type: 'mode', p };
    for (const pc of b.pieces || []) {
      if (labelsFit(pc)) for (const L of laneLabels(pc)) if (Math.abs(sx - L.x) <= 10 && Math.abs(sy - L.y) <= 8) return { type: 'lane', pc, m: L.s.m };
      const t = letterTag(pc);
      if (sx >= t.x && sx <= t.x + t.w && sy >= t.y && sy <= t.y + t.h) return { type: 'piece', pc };
    }
    const rows = App.S.rows.filter(r => r.blot === b.id).sort((a, c) => (a.id === App.selRow ? -1 : c.id === App.selRow ? 1 : 0));
    for (const row of rows) for (const sg of row.segs) {
      const pc = App.piece(b, sg.piece); if (!pc) continue;
      const bx = segBox(row, sg, pc), [u, v] = WB.toFrame(bx.F, p.x, p.y);
      if (u < bx.u0 - tol || u > bx.u1 + tol) continue;
      if (Math.abs(v - bx.vTop) <= tol) return { type: 'top', row, sg, pc };
      if (Math.abs(v - bx.vBot) <= tol) return { type: 'bot', row, sg, pc };
      if (v > bx.vTop && v < bx.vBot) return { type: 'move', row, sg, pc };
    }
    return { type: 'pan', p };
  }
  const cursorFor = h => (!h ? 'default' : h.type === 'top' || h.type === 'bot' || h.type === 'mark' ? 'ns-resize' : h.type === 'move' ? 'move'
    : h.type === 'lane' || h.type === 'piece' ? 'pointer' : h.type === 'newmark' || h.type === 'mode' ? 'crosshair' : App.mode ? 'crosshair' : 'grab');

  cv.addEventListener('mousedown', e => {
    if (!App.S) return;
    box.focus({ preventScroll: true });
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toImg(sx, sy);
    const b = App.blot(App.viewBlot);
    if (App.mode === 'addrow') {
      const row = App.addRowAt(App.viewBlot, p.x, p.y);
      App.setMode(null);
      if (row) { App.selRow = row.id; App.commit(); G.UI.toast('已添加一行：在右侧成图上点"蛋白名"输入名称；选不同曝光看看'); G.UI.editRowName(row.id); }
      return;
    }
    if (App.mode === 'addseg') {
      const row = App.row(App.selRow);
      const res = row ? App.addSeg(row, p.x, p.y) : 'none';
      if (res === 'none') { G.UI.toast('点到膜条上：这个蛋白在另一条膜条上的位置'); return; }
      if (res === 'stacked') { G.UI.toast('这条膜条和这一行所在的膜条上下叠放、泳道相同，是另一组蛋白，不能拼成一行', 3600); return; }
      App.setMode(null); App.commit();
      G.UI.toast(res === 'joined' ? '已把两行拼成一行（两条膜条按左右顺序接成连续的列）' : res === 'moved' ? '已移动这一行在该膜条上的位置' : '已拼接：这一行现在跨两条膜条');
      return;
    }
    const h = hitTest(sx, sy);
    if (h.type === 'lane') { App.cycleRole(h.pc, h.m); App.selPiece = h.pc.id; App.commit(); return; }
    if (h.type === 'piece') { App.selPiece = App.selPiece === h.pc.id ? null : h.pc.id; App.emit('select'); return; }
    if (h.type === 'newmark') {
      const marks = App.manualMarks(b, h.pc), k = App.suggestKda(b, h.pc, h.v);
      const mark = { u: h.u, v: h.v, kda: k || 0 };
      marks.push(mark); App.selPiece = h.pc.id; draw();
      G.UI.markPicker(b, h.pc, mark, e.clientX, e.clientY, true);
      return;
    }
    drag = { h, sx, sy, p0: p, view0: Object.assign({}, view), moved: false };
    if (h.type === 'mark') {
      // a detected or predicted band becomes a hand-set mark when touched
      const marks = App.manualMarks(b, h.pc);
      drag.mark = marks.find(m => Math.abs(m.v - h.m.v) < 0.5 && (!(h.m.k > 0) || Math.abs(m.kda - h.m.k) < 0.05 * h.m.k));
      if (!drag.mark) { drag.mark = { u: h.m.u, v: h.m.v, kda: h.m.k > 0 ? h.m.k : 0 }; marks.push(drag.mark); }
      drag.v0 = drag.mark.v; App.selPiece = h.pc.id;
    }
    if (h.row) { App.selRow = h.row.id; App.selPiece = h.pc.id; drag.geo0 = JSON.parse(JSON.stringify({ segs: h.row.segs, above: h.row.above, below: h.row.below })); App.emit('select'); }
    cv.style.cursor = h.type === 'pan' ? 'grabbing' : cursorFor(h);
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!App.S) return;
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (!drag) {
      if (e.target !== cv) return;
      hover = hitTest(sx, sy); hover.p = toImg(sx, sy);
      cv.style.cursor = cursorFor(hover);
      if (App.mode) draw();
      return;
    }
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 2) drag.moved = true;
    const h = drag.h;
    if (h.type === 'pan') { view.ox = drag.view0.ox + sx - drag.sx; view.oy = drag.view0.oy + sy - drag.sy; draw(); return; }
    const F = pFrame(h.pc), p = toImg(sx, sy), [, v] = WB.toFrame(F, p.x, p.y), [, v0] = WB.toFrame(F, drag.p0.x, drag.p0.y), dv = v - v0;
    if (h.type === 'mark') { if (drag.mark && drag.moved) { drag.mark.v = drag.v0 + dv; draw(); App.refresh(); } return; }
    const row = h.row, g0 = drag.geo0, k = row.segs.indexOf(h.sg), s0 = g0.segs[k];
    if (h.type === 'top') row.above = Math.max(g0.above - dv, -s0.b0 + 2);
    else if (h.type === 'bot') row.below = Math.max(g0.below + dv, s0.b1 + 2);
    else if (h.type === 'move') row.segs.forEach((sg, i) => { if (i === k || e.shiftKey) sg.vc = g0.segs[i].vc + dv; });
    row.manualGeo = true;
    draw(); App.refresh();
  });
  window.addEventListener('mouseup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.h.type === 'pan' && !d.moved) { App.selRow = null; App.selPiece = null; App.emit('select'); }
    if (d.h.type === 'mark') {
      if (d.moved) App.commit();
      else if (d.mark) G.UI.markPicker(App.blot(App.viewBlot), d.h.pc, d.mark, e.clientX, e.clientY, false);
    }
    if (d.h.row && d.moved) App.commit();
    cv.style.cursor = cursorFor(hover);
  });
  cv.addEventListener('wheel', e => {
    if (!App.S) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const ns = Math.max(0.02, Math.min(40, view.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    view.ox = sx - (sx - view.ox) * ns / view.s; view.oy = sy - (sy - view.oy) * ns / view.s; view.s = ns;
    draw();
  }, { passive: false });
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !/input|textarea|select/i.test(e.target.tagName || '')) { spaceDown = true; if (e.target === box) e.preventDefault(); } });
  window.addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  // keyboard nudges only when the image area has focus
  box.addEventListener('keydown', e => {
    if (e.target !== box || !App.S) return;
    const row = App.selRow && App.row(App.selRow), fp = App.selPiece && App.findPiece(App.selPiece), st = e.shiftKey ? 5 : 1;
    if (fp && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      if (e.altKey) App.scalePitch(fp.pc, d * 0.5); else App.nudgePiece(fp.pc, d * st);
      App.commit(); e.preventDefault(); return;
    }
    if (row && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { const d = (e.key === 'ArrowUp' ? -1 : 1) * st; row.segs.forEach(sg => { sg.vc += d; }); App.commit(); e.preventDefault(); }
    if (row && e.key === 'Delete') { App.S.rows = App.S.rows.filter(r => r !== row); App.selRow = null; App.commit(); G.UI.toast('已删除该行（Ctrl+Z 可撤销）'); e.preventDefault(); }
  });

  new ResizeObserver(resize).observe(box);
  App.on(w => {
    if (w === 'loaded') { document.getElementById('dropHint').classList.add('hidden'); fitted = null; resize(); }
    else if (fitted !== App.viewBlot && App.S) fitFull();
    else draw();
  });
  G.View = { draw, fitFull, resize, curImage, dispCanvas };
})(window);
