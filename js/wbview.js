/* Middle panel: one image of one membrane at a time.
 * Every row is a box on each piece it runs across, with lanes of its own. The selected row's boxes show
 * their lanes (vertical lines; above each its figure column, M = marker lane, × = left out) and eight
 * handles: drag an edge or a corner to resize a box — its lanes stay where they are and new room gets lanes
 * at the same spacing; drag inside to move it (Shift: all the row's boxes up/down); drag a lane line to move
 * that lane; double-click inside to add a lane; click a label to switch sample / left out / marker.
 * Modes: 'addrow' click adds a row at that height, or drag out a box: a row from that box alone; 'marks' the
 * white-light picture with every piece's marker lane: a click on a piece adds a mark at the dark band nearest
 * it (its size to pick), a mark's label or line drags it (snapping onto the lane's dark bands; Alt: free), a
 * click on it changes its size or deletes it, a dashed predicted size is added by a click; the selected mark
 * ↑↓ / Delete / Enter; 'align' the picture as taken is dragged / turned until its bands sit in the boxes (the
 * membrane had moved). The right or middle button pans in every mode. */
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

  // the picture a membrane opens with: the exposure most of its rows use (bands to see), else its first one
  function firstImage(b) {
    const n = id => App.S.rows.filter(r => r.blot === b.id && !r.hidden && r.img === id).length;
    return (App.chemiOf(b).slice().sort((p, q) => n(q.id) - n(p.id))[0] || App.markersOf(b)[0] || {}).id;
  }
  function curImage() {
    const b = App.S && App.blot(App.viewBlot);
    if (!b) return null;
    if (!App.viewImg || !b.images.includes(App.viewImg)) {
      const sel = App.selRow && App.row(App.selRow);
      App.viewImg = sel && sel.blot === b.id ? sel.img : firstImage(b);
    }
    return App.images.get(App.viewImg);
  }
  // display canvas of a whole image with its current levels (markers: auto stretch); raw: the picture as taken
  // (not resampled onto the membrane's grid)
  function dispCanvas(rec, raw) {
    const src = raw && rec.raw ? rec.raw : rec, slot = src === rec ? '_disp' : '_dispRaw';
    const lv = rec.kind === 'chemi' ? App.levelsOf(rec.id) : null;
    const key = (rec.kind === 'chemi' ? [lv.black, lv.white, App.S.style.invert].join('|') : 'm') + (src === rec ? '|' + (rec._alignKey || '') : '');
    if (rec[slot] && rec[slot + 'Key'] === key) return rec[slot];
    const c = document.createElement('canvas'); c.width = src.img.w; c.height = src.img.h;
    const id = new ImageData(src.img.w, src.img.h), n = src.img.w * src.img.h;
    if (rec.kind === 'chemi') {
      const map = App.mapper(rec.id), s = src.cs.sig;
      for (let i = 0; i < n; i++) { const v = map(s[i]); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    } else {
      const [lo, hi] = G.Engine.percentiles(src.img.data, [0.5, 99.5], 5), sc = 255 / Math.max(1e-6, hi - lo);
      for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, (src.img.data[i] - lo) * sc)); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    }
    c.getContext('2d').putImageData(id, 0, 0);
    rec[slot] = c; rec[slot + 'Key'] = key;
    if (src === rec) rec._sat = null;
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
  // the corners of a piece (image coordinates)
  const corners = pc => { const F = pFrame(pc); return [[-pc.w / 2, -pc.h / 2], [pc.w / 2, -pc.h / 2], [pc.w / 2, pc.h / 2], [-pc.w / 2, pc.h / 2]].map(([u, v]) => WB.toImg(F, u, v)); };
  /* the whole membrane: its pieces, with room for the size labels on the left, the row tags on the right and
   * the mode banner on top (aligning a picture: all of it) */
  function fitFull() {
    const rec = App.S && curImage(); if (!rec) return;
    const r = box.getBoundingClientRect(), pad = 24, b = App.blot(App.viewBlot);
    if (r.width < 10) return;
    const pts = App.mode === 'align' || !b ? [] : (b.pieces || []).flatMap(corners);
    if (pts.length) {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const L = 56, R = App.mode === 'marks' ? 40 : 165, T = App.mode ? 64 : 36, B = 24;
      view.s = Math.min((r.width - L - R) / (x1 - x0), (r.height - T - B) / (y1 - y0), 3);
      view.ox = L + (r.width - L - R - (x1 - x0) * view.s) / 2 - x0 * view.s;
      view.oy = T + (r.height - T - B - (y1 - y0) * view.s) / 2 - y0 * view.s;
    } else {
      view.s = Math.min((r.width - 2 * pad) / rec.img.w, (r.height - 2 * pad - 14) / rec.img.h);
      view.ox = (r.width - rec.img.w * view.s) / 2; view.oy = (r.height - rec.img.h * view.s) / 2 + 7;
    }
    fitted = App.viewBlot;
    draw();
  }
  // zoom to a row's boxes (with room for the lane labels above and the row's tag on the right)
  function fitRow(row) {
    const b = App.blot(row.blot), pts = [];
    row.segs.forEach(sg => { const pc = App.piece(b, sg.piece); if (pc && sg.x0 != null) pts.push(...segBox(row, sg, pc).pts); });
    const r = box.getBoundingClientRect();
    if (!pts.length || r.width < 10) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    view.s = Math.min((r.width - 220) / (x1 - x0), (r.height - 120) / (y1 - y0), 4);
    view.ox = 40 - x0 * view.s; view.oy = (r.height - (y1 - y0) * view.s) / 2 + 10 - y0 * view.s;
    fitted = App.viewBlot;
    draw();
  }

  /* marking one piece's ladder: its marker lane a little left of the middle (the size labels left of it) with
   * about five lanes around it, the piece's full height below the mode banner */
  function fitPiece(pc) {
    const r = box.getBoundingClientRect();
    if (!pc || r.width < 10) return;
    const ys = corners(pc).map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), cx = WB.toImg(pFrame(pc), App.markLane(pc), 0)[0], T = 64, B = 24;
    view.s = Math.min((r.height - T - B) / (y1 - y0), (r.width - 100) / (5 * (pc.pitch || 60)), 2);
    view.ox = r.width * 0.42 - cx * view.s;
    view.oy = T + (r.height - T - B - (y1 - y0) * view.s) / 2 - y0 * view.s;
    fitted = App.viewBlot;
    draw();
  }

  /* ---------- geometry on screen ---------- */
  function letterTag(pc) { const [x, y] = WB.toImg(pFrame(pc), -pc.w / 2, -pc.h / 2); const p = toScr(x, y); return { x: p.x + 4, y: p.y + 4, w: 18, h: 16 }; }
  // a row's box on one piece: edges in the piece frame, corners in image coordinates
  function segBox(row, sg, pc) {
    const F = pFrame(pc), vTop = sg.vc - row.above, vBot = sg.vc + row.below, x0 = sg.x0, x1 = sg.x1;
    return { F, x0, x1, vTop, vBot, pts: [[x0, vTop], [x1, vTop], [x1, vBot], [x0, vBot]].map(([u, v]) => WB.toImg(F, u, v)) };
  }
  const HANDLES = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
  const handles = bx => HANDLES.map(([k, a, c]) => { const [x, y] = WB.toImg(bx.F, bx.x0 + (bx.x1 - bx.x0) * a, bx.vTop + (bx.vBot - bx.vTop) * c); return Object.assign({ k }, toScr(x, y)); });
  // labels above a box's lanes (screen): the figure column, M or ×
  const labelsFit = sg => App.segPitch(sg) * view.s >= 15;
  function laneChips(sg, bx) {
    return App.segCols(sg).map(s => {
      const [x, y] = WB.toImg(bx.F, s.u, bx.vTop), p = toScr(x, y), txt = s.r === 's' ? String(s.col) : s.r === 'm' ? 'M' : '×';
      return { s, txt, x: p.x, y: p.y - 10, w: Math.max(16, txt.length * 7 + 6), h: 14 };
    });
  }
  /* marker bands of a piece as drawn: hand-set marks (manual), or the sizes read automatically (seen = a band
   * detected there; else interpolated). While marking, also the ladder sizes the marks predict where none is set
   * yet (predicted: dashed, a click adds it). */
  function marksOf(b, pc) {
    const pcal = App.pieceCal(b, pc), lad = G.ProteinLadders.get(b.ladderId), u = App.markLane(pc);
    const predicted = have => (App.mode === 'marks' && pcal && lad ? lad.sizes.filter(k => !have.some(h => Math.abs(Math.log(h / k)) < 0.02))
      .map(k => ({ u, v: WB.vAtK(pcal, k), k, predicted: true })).filter(t => t.v != null && Math.abs(t.v) <= pc.h / 2 - 2) : []);
    if (pc.marks) return pc.marks.map((m, i) => ({ u: m.u, v: m.v, k: m.kda, i, seen: true, manual: true })).concat(pcal && pcal.knots.length >= 2 ? predicted(pc.marks.map(m => m.kda)) : []);
    if (!pcal) return [];
    const bands = pcal.bands || [];
    return App.pieceTicks(b, pc).map(t => ({ u, v: t.v, k: t.k, seen: bands.some(x => Math.abs(x.v - t.v) < 4) }));
  }
  const fmtK = k => (k > 0 ? String(+(+k).toPrecision(3)) : '?');
  // half the width of a piece's marker lane (piece px)
  const laneHalf = pc => Math.max(8, Math.min(pc.pitch || 60, 160) * 0.42);
  /* where a mark is on screen while marking: the line across the lane (a..c) and the size label left of it */
  function markGeom(pc, m) {
    const F = pFrame(pc), h = laneHalf(pc), a = toScr(...WB.toImg(F, m.u - h, m.v)), c = toScr(...WB.toImg(F, m.u + h, m.v));
    const txt = fmtK(m.k) + (m.predicted ? '?' : '');
    ctx.font = `700 11px ${FONT}`;
    const w = ctx.measureText(txt).width + 12;
    return { a, c, txt, pill: { x: a.x - 6 - w, y: a.y - 8, w, h: 16 } };
  }
  const segDist = (px, py, a, c) => { const dx = c.x - a.x, dy = c.y - a.y, L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L)); return Math.hypot(px - a.x - t * dx, py - a.y - t * dy); };
  // the mark selected while marking ({pc: id, i: index in pc.marks}), if it still exists
  const selMark = b => { const s = App.selMark, pc = s && App.piece(b, s.pc); return pc && pc.marks && pc.marks[s.i] ? { pc, m: pc.marks[s.i] } : null; };

  function draw() {
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!App.S) return;
    const rec = curImage(); if (!rec) return;
    const b = App.blot(App.viewBlot);
    ctx.imageSmoothingEnabled = view.s < 2;
    ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s);
    if (aligning(rec)) {
      // the picture as taken, placed by the transform being set (it maps the grid to the picture: drawn with
      // its inverse), over the grid's outlines and boxes
      const m = WB.regMatrix(WB.regInverse(align.T), rec.img.w, rec.img.h);
      ctx.transform(m[0], m[3], m[1], m[4], m[2], m[5]);
      ctx.drawImage(dispCanvas(rec, true), 0, 0);
    } else {
      ctx.drawImage(dispCanvas(rec), 0, 0);
      if (document.getElementById('showSat').checked && rec.kind === 'chemi') ctx.drawImage(satCanvas(rec), 0, 0);
    }
    ctx.restore();
    const line = (pts, close) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const p = toScr(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); if (close) ctx.closePath(); };
    const marking = App.mode === 'marks';
    // pieces: outline and letter
    (b.pieces || []).forEach(pc => {
      const F = pFrame(pc);
      const pts = [[-pc.w / 2, -pc.h / 2], [pc.w / 2, -pc.h / 2], [pc.w / 2, pc.h / 2], [-pc.w / 2, pc.h / 2]].map(([u, v]) => WB.toImg(F, u, v));
      ctx.strokeStyle = 'rgba(120,130,145,.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      line(pts, true); ctx.stroke(); ctx.setLineDash([]);
      const t = letterTag(pc);
      ctx.fillStyle = 'rgba(60,70,85,.85)'; roundRect(t.x, t.y, t.w, t.h, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(pc.letter || '?', t.x + t.w / 2, t.y + 12);
    });
    // marker bands (amber) outside marking: the bands read, small, with their sizes
    if (!marking) {
      ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'right';
      (b.pieces || []).forEach(pc => {
        const F = pFrame(pc), h = laneHalf(pc);
        marksOf(b, pc).forEach(m => {
          if (!m.seen) return;
          const a = WB.toImg(F, m.u - h, m.v), c = WB.toImg(F, m.u + h, m.v);
          ctx.strokeStyle = '#e0a800'; ctx.lineWidth = m.manual ? 2 : 1.4;
          line([a, c]); ctx.stroke();
          const p = toScr(a[0], a[1]);
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(fmtK(m.k), p.x - 6, p.y + 3.5);
          ctx.fillStyle = '#8a6100'; ctx.fillText(fmtK(m.k), p.x - 6, p.y + 3.5);
        });
      });
    }
    // rows: a box on every piece the row runs across, with its lanes (faint while marking)
    const selRow = App.selRow && App.row(App.selRow);
    App.S.rows.filter(r => r.blot === b.id).forEach(row => {
      const sel = row === selRow, col = App.rowColor(row);
      ctx.globalAlpha = marking ? 0.18 : row.hidden ? 0.4 : 1;
      let last = null;
      row.segs.forEach(sg => {
        const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) return;
        const bx = segBox(row, sg, pc);
        ctx.strokeStyle = col; ctx.lineWidth = sel ? 2 : 1.4; ctx.setLineDash(row.img === rec.id || rec.kind === 'marker' ? [] : [6, 4]);
        line(bx.pts, true); ctx.stroke(); ctx.setLineDash([]);
        if (sel) { ctx.fillStyle = col + '12'; line(bx.pts, true); ctx.fill(); }
        drawLanes(row, sg, bx, sel, col, line);
        if (!last || bx.pts[1][0] > last[0]) last = bx.pts[1];
      });
      // (a hidden row keeps its faint box but no label, unless it is selected; marking: no labels)
      if (last && (!row.hidden || sel) && !marking) {
        const p = toScr(last[0], last[1]);
        const on = App.images.get(row.img), ex = on ? App.expoLabel(on) : '';
        const txt = `${App.rowLabel(row).replace(/ 行$/, '')} · ${on ? (row.img === App.bestExpo(row) ? '★ ' : '') + (ex.length > 10 ? ex.slice(0, 9) + '…' : ex) : ''}`;
        ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left';
        const tw = ctx.measureText(txt).width + 12;
        ctx.fillStyle = col; roundRect(p.x + 6, p.y - 1, tw, 18, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(txt, p.x + 12, p.y + 12);
      }
      ctx.globalAlpha = 1;
    });
    // the selected row's handles, on top
    if (selRow && selRow.blot === b.id && !App.mode) selRow.segs.forEach(sg => {
      const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) return;
      const col = App.rowColor(selRow);
      handles(segBox(selRow, sg, pc)).forEach(hd => {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        roundRect(hd.x - 4.5, hd.y - 4.5, 9, 9, 2); ctx.fill(); ctx.stroke();
      });
    });
    if (marking) drawMarking(b, line);
    // a box being drawn (adding a row)
    if (drag && drag.h.type === 'newbox' && drag.moved && drag.cur) {
      const [ua, va] = drag.a, [ub, vb] = WB.toFrame(drag.F, drag.cur.x, drag.cur.y);
      const pts = [[ua, va], [ub, va], [ub, vb], [ua, vb]].map(([u, v]) => WB.toImg(drag.F, u, v));
      ctx.fillStyle = 'rgba(47,111,235,.08)'; line(pts, true); ctx.fill();
      ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); line(pts, true); ctx.stroke(); ctx.setLineDash([]);
    } else if (App.mode === 'addrow' && hover && hover.p) {
      ctx.strokeStyle = '#2f6feb'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      const hit = App.pieceAt(b, hover.p.x, hover.p.y, 0);
      if (hit) {
        const F = pFrame(hit.pc);
        line([WB.toImg(F, -hit.pc.w / 2, hit.v), WB.toImg(F, hit.pc.w / 2, hit.v)]); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    document.getElementById('zoomLabel').textContent = Math.round(view.s * 100) + '%';
  }
  // lanes of one box: full lines and labels for the selected row, short ticks along the top edge otherwise
  function drawLanes(row, sg, bx, sel, col, line) {
    const cols = App.segCols(sg), cur = sel && App.curSeg(row) === sg;
    cols.forEach(s => {
      const a = WB.toImg(bx.F, s.u, bx.vTop);
      if (!sel) {
        ctx.strokeStyle = s.r === 's' ? col : 'rgba(150,158,168,.9)'; ctx.lineWidth = 1;
        line([a, WB.toImg(bx.F, s.u, bx.vTop + 6 / view.s)]); ctx.stroke();
        return;
      }
      const picked = cur && App.selLane === s.i;
      ctx.strokeStyle = s.r === 'm' ? '#e0a800' : s.r === 'x' ? 'rgba(130,138,150,.95)' : col;
      ctx.lineWidth = picked ? 2.6 : 1.2; ctx.setLineDash(s.r === 'x' ? [2, 3] : s.r === 'm' ? [] : [5, 4]);
      line([a, WB.toImg(bx.F, s.u, bx.vBot)]); ctx.stroke(); ctx.setLineDash([]);
    });
    if (!sel || !labelsFit(sg)) return;
    ctx.font = `600 10px ${FONT}`; ctx.textAlign = 'center';
    laneChips(sg, bx).forEach(ch => {
      const picked = cur && App.selLane === ch.s.i, r = ch.s.r;
      ctx.fillStyle = picked ? col : r === 'm' ? '#ffe8a3' : r === 'x' ? '#eef0f3' : '#fff';
      ctx.strokeStyle = r === 'm' ? '#e0a800' : r === 'x' ? '#c3c9d1' : col; ctx.lineWidth = 1;
      roundRect(ch.x - ch.w / 2, ch.y - ch.h / 2, ch.w, ch.h, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = picked ? '#fff' : r === 'm' ? '#7a5a00' : r === 'x' ? '#9aa3ad' : '#1d3f8f';
      ctx.fillText(ch.txt, ch.x, ch.y + 3.5);
    });
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* marking: every piece's marker lane highlighted and its marks as handles with their sizes (set by hand:
   * filled; read automatically: outlined, dashed where interpolated; predicted from the marks: faint, "?") */
  function drawMarking(b, line) {
    const sm = selMark(b), hov = hover && hover.type === 'mark' ? hover : null;
    (b.pieces || []).forEach(pc => {
      const F = pFrame(pc), h = laneHalf(pc);
      // the piece picked in the panel
      if (App.markFocus === pc.id) { ctx.strokeStyle = '#e0a800'; ctx.lineWidth = 2; line(corners(pc), true); ctx.stroke(); }
      const lanes = [...new Set((pc.ladderUs && pc.ladderUs.length ? pc.ladderUs : []).concat([App.markLane(pc)]).map(Math.round))];
      lanes.forEach(u => {
        const pts = [[u - h, -pc.h / 2], [u + h, -pc.h / 2], [u + h, pc.h / 2], [u - h, pc.h / 2]].map(([x, y]) => WB.toImg(F, x, y));
        ctx.fillStyle = 'rgba(255,190,0,.10)'; line(pts, true); ctx.fill();
        ctx.strokeStyle = 'rgba(224,168,0,.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); line(pts, true); ctx.stroke(); ctx.setLineDash([]);
      });
      marksOf(b, pc).forEach(m => {
        const g = markGeom(pc, m), on = sm && sm.pc === pc && m.manual && pc.marks[m.i] === sm.m;
        const hv = hov && hov.pc === pc && hov.m.k === m.k && Math.abs(hov.m.v - m.v) < 0.5;
        const seg = () => { ctx.beginPath(); ctx.moveTo(g.a.x, g.a.y); ctx.lineTo(g.c.x, g.c.y); };
        if (on) { ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 6; seg(); ctx.stroke(); }
        ctx.strokeStyle = m.predicted ? 'rgba(224,168,0,.65)' : '#e0a800'; ctx.lineWidth = on ? 3 : hv ? 2.5 : m.manual ? 2 : 1.5;
        ctx.setLineDash(m.predicted || (!m.manual && !m.seen) ? [4, 3] : []); seg(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = m.manual ? '#f5b800' : m.predicted ? 'rgba(255,255,255,.8)' : '#fff';
        ctx.strokeStyle = m.predicted ? 'rgba(224,168,0,.7)' : '#c58f00'; ctx.lineWidth = on || hv ? 2 : 1;
        if (m.predicted) ctx.setLineDash([3, 2]);
        roundRect(g.pill.x, g.pill.y, g.pill.w, g.pill.h, 8); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = m.manual ? '#3d2c00' : m.predicted ? 'rgba(122,90,0,.8)' : '#7a5a00'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(g.txt, g.pill.x + g.pill.w / 2, g.pill.y + 12);
      });
    });
    // where a click adds a mark: across the lane, at the height it snaps to
    if (hover && hover.type === 'newmark' && !drag) {
      const pc = hover.pc, u = newMarkU(pc, hover.u), v = App.snapMarkV(b, pc, u, hover.v, 10 / view.s), F = pFrame(pc), h = laneHalf(pc);
      const a = toScr(...WB.toImg(F, u - h, v)), c = toScr(...WB.toImg(F, u + h, v));
      ctx.strokeStyle = '#e0a800'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c58f00'; ctx.font = `700 14px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('+', c.x + 5, c.y + 5);
    }
  }
  // the lane a new mark goes on: the piece's marker lane when the click is within about a lane of it, else
  // where clicked (the ladder may run in a lane the automatic reading missed)
  function newMarkU(pc, u) {
    const lanes = (pc.ladderUs || []).concat(pc.marks && pc.marks.length ? [App.markLane(pc)] : []);
    const near = lanes.sort((p, q) => Math.abs(p - u) - Math.abs(q - u))[0];
    return near != null && Math.abs(near - u) < (pc.pitch || 60) * 1.2 ? near : u;
  }

  /* ---------- aligning a picture by hand ('align' mode): drag = shift, Shift+drag = turn about the membrane's
   * middle, ←→↑↓ 1 px (Shift 10), [ ] 0.1° (Shift 1°). Set when a drag ends / the keys rest. ---------- */
  let align = null;            // {id, T (live), T0 (as the mode began), timer}
  const aligning = rec => App.mode === 'align' && align && rec && rec.id === align.id;
  function alignStart(id) {
    const al = App.alignOf(id);
    align = { id, T: al ? { a: al.a, tx: al.tx, ty: al.ty } : { a: 0, tx: 0, ty: 0 } };
    align.T0 = Object.assign({}, align.T);
    fitFull();                 // (all of the picture: it may lie well off the membrane's place)
  }
  // the live transform made the picture's alignment (resampled), once it differs from what is set
  function alignCommit() {
    if (!align) return;
    clearTimeout(align.timer);
    const al = App.alignOf(align.id), cur = al ? { a: al.a, tx: al.tx, ty: al.ty } : { a: 0, tx: 0, ty: 0 };
    if (Math.abs(cur.a - align.T.a) < 1e-4 && Math.abs(cur.tx - align.T.tx) < 0.01 && Math.abs(cur.ty - align.T.ty) < 0.01) return;
    App.setAlign(align.id, align.T); App.commit();
  }
  function alignEnd() { alignCommit(); align = null; }
  const alignLater = () => { clearTimeout(align.timer); align.timer = setTimeout(alignCommit, 450); };

  function hitTest(sx, sy) {
    const b = App.blot(App.viewBlot); if (!b) return { type: 'pan' };
    if (spaceDown) return { type: 'pan' };
    const p = toImg(sx, sy), tol = 6 / view.s;
    if (App.mode === 'align') return aligning(curImage()) ? { type: 'align', p } : { type: 'pan', p };
    if (App.mode === 'marks') {
      // a mark by its size label or its line; else a click on a piece adds one
      let best = null;
      for (const pc of b.pieces || []) for (const m of marksOf(b, pc)) {
        const g = markGeom(pc, m), P = g.pill;
        const d = sx >= P.x - 2 && sx <= P.x + P.w + 2 && sy >= P.y - 2 && sy <= P.y + P.h + 2 ? 0 : segDist(sx, sy, g.a, g.c);
        if (d <= 7 && (!best || d < best.d)) best = { d, pc, m, pill: d === 0 };
      }
      if (best) return { type: 'mark', pc: best.pc, m: best.m, pill: best.pill };
      const hit = App.pieceAt(b, p.x, p.y, 0);
      return hit ? { type: 'newmark', pc: hit.pc, u: hit.u, v: hit.v } : { type: 'pan', p };
    }
    if (App.mode) return { type: 'mode', p };
    // the selected row first: its handles, lane labels and lane lines
    const selRow = App.selRow && App.row(App.selRow);
    if (selRow && selRow.blot === b.id) for (const sg of selRow.segs) {
      const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) continue;
      const bx = segBox(selRow, sg, pc);
      for (const hd of handles(bx)) if (Math.abs(sx - hd.x) <= 7 && Math.abs(sy - hd.y) <= 7) return { type: 'resize', k: hd.k, row: selRow, sg, pc };
      if (labelsFit(sg)) for (const ch of laneChips(sg, bx)) if (Math.abs(sx - ch.x) <= ch.w / 2 && Math.abs(sy - ch.y) <= ch.h / 2 + 1) return { type: 'lanechip', row: selRow, sg, pc, i: ch.s.i };
      const [u, v] = WB.toFrame(bx.F, p.x, p.y);
      if (v >= bx.vTop - tol && v <= bx.vBot + tol) {
        // a lane line is grabbed right on it; the rest of the box moves the box
        let best = null;
        sg.lanes.forEach((l, i) => { const d = Math.abs(l.u - u); if (d <= Math.min(4 / view.s, App.segPitch(sg) * 0.2) && (!best || d < best.d)) best = { i, d }; });
        if (best) return { type: 'lane', row: selRow, sg, pc, i: best.i };
      }
    }
    const rows = App.S.rows.filter(r => r.blot === b.id).sort((a, c) => (a === selRow ? -1 : c === selRow ? 1 : 0));
    for (const row of rows) for (const sg of row.segs) {
      const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) continue;
      const bx = segBox(row, sg, pc), [u, v] = WB.toFrame(bx.F, p.x, p.y);
      if (u < bx.x0 - tol || u > bx.x1 + tol || v < bx.vTop - tol || v > bx.vBot + tol) continue;
      const k = (Math.abs(v - bx.vTop) <= tol ? 'n' : Math.abs(v - bx.vBot) <= tol ? 's' : '') + (Math.abs(u - bx.x0) <= tol ? 'w' : Math.abs(u - bx.x1) <= tol ? 'e' : '');
      return k ? { type: 'resize', k, row, sg, pc } : { type: 'move', row, sg, pc };
    }
    return { type: 'pan', p };
  }
  const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  const cursorFor = h => (!h ? 'default' : h.type === 'resize' ? CURSORS[h.k] : h.type === 'mark' ? 'ns-resize' : h.type === 'lane' ? 'ew-resize'
    : h.type === 'move' || h.type === 'align' ? 'move' : h.type === 'lanechip' ? 'pointer' : h.type === 'newmark' || h.type === 'mode' ? 'crosshair' : App.mode ? 'crosshair' : 'grab');

  cv.addEventListener('mousedown', e => {
    if (!App.S) return;
    box.focus({ preventScroll: true });
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toImg(sx, sy);
    const b = App.blot(App.viewBlot);
    // the right or middle button always pans (the left one is busy with boxes)
    if (e.button === 1 || e.button === 2) { drag = { h: { type: 'pan' }, sx, sy, p0: p, view0: Object.assign({}, view), moved: false, button: e.button }; cv.style.cursor = 'grabbing'; e.preventDefault(); return; }
    if (App.mode === 'addrow') {
      const hit = App.pieceAt(b, p.x, p.y, 60);
      if (!hit) { G.UI.toast('点在膜条上：蛋白所在的高度，或拖出一个框'); return; }
      drag = { h: { type: 'newbox', pc: hit.pc }, sx, sy, p0: p, moved: false, F: pFrame(hit.pc), a: [hit.u, hit.v] };
      e.preventDefault();
      return;
    }
    const h = hitTest(sx, sy);
    if (h.type === 'lanechip') {
      App.editLanes(h.row, h.sg, () => App.cycleLane(h.sg, h.i));
      App.selSeg = h.sg.piece; App.selLane = h.i; App.commit();
      return;
    }
    if (h.type === 'newmark') {
      // a mark on the marker lane at the band nearest the click (Alt: exactly there), its size to pick (a size
      // the piece has no mark for; the piece's marks read automatically come back if none is picked)
      const was = h.pc.marks, u = newMarkU(h.pc, h.u), v = e.altKey ? h.v : App.snapMarkV(b, h.pc, u, h.v, 10 / view.s);
      const marks = App.manualMarks(b, h.pc), mark = { u, v, kda: App.suggestKda(b, h.pc, v) || 0 };
      marks.push(mark); App.selMark = { pc: h.pc.id, i: marks.length - 1 }; draw();
      G.UI.markPicker(b, h.pc, mark, e.clientX, e.clientY, true, was);
      return;
    }
    drag = { h, sx, sy, p0: p, view0: Object.assign({}, view), moved: false };
    if (h.type === 'align') { drag.T0 = Object.assign({}, align.T); drag.turn = e.shiftKey; drag.pivot = App.membraneCentre(b); }
    if (h.type === 'mark') {
      // touched, the piece's marks are set by hand from then on (starting from what was read automatically); a
      // predicted size becomes a mark at the band nearest it
      drag.was = h.pc.marks;
      const marks = App.manualMarks(b, h.pc);
      if (h.m.predicted) { drag.mark = { u: h.m.u, v: App.snapMarkV(b, h.pc, h.m.u, h.m.v, 14 / view.s), kda: h.m.k }; marks.push(drag.mark); drag.added = true; }
      else drag.mark = marks.find(m => Math.abs(m.v - h.m.v) < 0.5 && (!(h.m.k > 0) || Math.abs(m.kda - h.m.k) < 0.05 * h.m.k));
      if (!drag.mark) { drag.mark = { u: h.m.u, v: h.m.v, kda: h.m.k > 0 ? h.m.k : 0 }; marks.push(drag.mark); }
      drag.v0 = drag.mark.v;
      App.selMark = { pc: h.pc.id, i: marks.indexOf(drag.mark) };
      draw();
    }
    if (h.row) {
      if (App.selRow !== h.row.id || App.selSeg !== h.sg.piece) App.selLane = null;
      App.selRow = h.row.id; App.selSeg = h.sg.piece;
      if (h.type === 'lane') App.selLane = h.i; else if (h.type === 'move') App.selLane = null;
      drag.geo0 = JSON.parse(JSON.stringify({ segs: h.row.segs, above: h.row.above, below: h.row.below }));
      drag.k = h.row.segs.indexOf(h.sg);
      App.emit('select');
    }
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
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 3) drag.moved = true;      // (a click with a shaky hand moves nothing)
    const h = drag.h, p = toImg(sx, sy);
    if (h.type === 'newbox') { drag.cur = p; draw(); return; }
    if (h.type === 'pan') { view.ox = drag.view0.ox + sx - drag.sx; view.oy = drag.view0.oy + sy - drag.sy; draw(); return; }
    if (h.type === 'align') {
      const rec = curImage(), [px, py] = drag.pivot;
      if (drag.turn) {
        const deg = (Math.atan2(p.y - py, p.x - px) - Math.atan2(drag.p0.y - py, drag.p0.x - px)) * 180 / Math.PI;
        align.T = App.alignTurned(drag.T0, deg, px, py, rec.img.w, rec.img.h);
      } else align.T = App.alignShifted(drag.T0, p.x - drag.p0.x, p.y - drag.p0.y);
      draw();
      return;
    }
    const F = pFrame(h.pc), [u, v] = WB.toFrame(F, p.x, p.y), [u0, v0] = WB.toFrame(F, drag.p0.x, drag.p0.y), du = u - u0, dv = v - v0;
    if (h.type === 'mark') {
      // follows the pointer, snapping onto a dark band of the lane within reach (Alt: no snapping)
      if (drag.mark && drag.moved) { const b = App.blot(App.viewBlot); drag.mark.v = e.altKey ? drag.v0 + dv : App.snapMarkV(b, h.pc, drag.mark.u, drag.v0 + dv, 10 / view.s); draw(); App.refresh(); }
      return;
    }
    if (!drag.moved) return;
    const row = h.row, g0 = drag.geo0, k = drag.k, s0 = g0.segs[k], sg = row.segs[k];
    if (h.type === 'lane') App.moveLane(sg, h.i, s0.lanes[h.i].u + du);
    else if (h.type === 'resize') {
      if (h.k.includes('n')) row.above = Math.max(2, 6 - g0.below, g0.above - dv);
      if (h.k.includes('s')) row.below = Math.max(2, 6 - g0.above, g0.below + dv);
      if (h.k.includes('w') || h.k.includes('e')) {
        const x0 = h.k.includes('w') ? Math.min(s0.x0 + du, s0.x1 - 4) : s0.x0, x1 = h.k.includes('e') ? Math.max(s0.x1 + du, s0.x0 + 4) : s0.x1;
        App.setBox(row, sg, x0, x1, s0);
        // the row's later boxes keep continuing its columns
        row.segs.forEach((t, i) => { if (i > k) t.c0 = g0.segs[i].c0; });
        App.keepJoined(row, sg, g0.segs.map(t => ({ c0: t.c0, n: t.lanes.filter(l => l.r === 's').length })));
      }
    } else if (h.type === 'move') {
      // the band stays where it is on the membrane; the box slides over it (its lanes too, lane by lane)
      row.segs.forEach((t, i) => { if (i === k || e.shiftKey) { const t0 = g0.segs[i]; t.vc = t0.vc + dv; t.b0 = t0.b0 - dv; t.b1 = t0.b1 - dv; } });
      if (!e.shiftKey) App.setBox(row, sg, s0.x0 + du, s0.x1 + du, s0);
    }
    draw(); App.refresh();
  });
  window.addEventListener('mouseup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.h.type === 'newbox') {
      const b = App.blot(App.viewBlot);
      let row = null;
      if (d.moved && d.cur) {
        const [ua, va] = d.a, [ub, vb] = WB.toFrame(d.F, d.cur.x, d.cur.y);
        if (Math.abs(ub - ua) * view.s >= 8 && Math.abs(vb - va) * view.s >= 6) row = App.addRowBox(b.id, d.h.pc.id, Math.min(ua, ub), Math.max(ua, ub), Math.min(va, vb), Math.max(va, vb));
      } else row = App.addRowAt(b.id, d.p0.x, d.p0.y);
      App.setMode(null);
      if (row) {
        App.selRow = row.id; App.selSeg = row.segs[0].piece; App.selLane = null; App.commit();
        G.UI.toast(d.moved ? `已按框添加一行：框里识别出 ${App.nSample(row.segs[0])} 道；在右侧成图上点"蛋白名"输入名称` : '已添加一行：在右侧成图上点"蛋白名"输入名称；选不同曝光看看', 3400);
        G.UI.editRowName(row.id);
      } else draw();
      return;
    }
    if (d.h.type === 'align') { if (d.moved) alignCommit(); return; }
    if (d.h.type === 'pan' && !d.moved && !d.button) { App.selRow = null; App.selSeg = null; App.selLane = null; App.selMark = null; App.emit('select'); }
    if (d.h.type === 'mark') {
      if (d.moved || d.added) { App.commit(); if (d.added && !d.moved) G.UI.toast(`已加 ${fmtK(d.mark.kda)} kDa 刻度（对准了吗？不对就拖一下）`); }
      else if (d.mark) G.UI.markPicker(App.blot(App.viewBlot), d.h.pc, d.mark, e.clientX, e.clientY, false, d.was);
    }
    if (d.h.row && d.moved) {
      const row = d.h.row;
      row.segs.forEach((t, i) => {
        if (d.h.type === 'lane' && t !== d.h.sg) return;
        App.snapBox(t);
        if (d.h.type !== 'lane' && JSON.stringify(t) !== JSON.stringify(d.geo0.segs[i])) App.findBand(row, t);
      });
      if (d.h.type === 'resize' && (d.h.k.includes('n') || d.h.k.includes('s'))) row.segs.forEach(t => App.findBand(row, t));
      App.commit();
    }
    cv.style.cursor = cursorFor(hover);
  });
  // double-click inside the selected row's box: a lane there
  cv.addEventListener('dblclick', e => {
    if (!App.S || App.mode) return;
    const r = cv.getBoundingClientRect(), p = toImg(e.clientX - r.left, e.clientY - r.top), b = App.blot(App.viewBlot);
    const row = App.selRow && App.row(App.selRow);
    if (!row || row.blot !== b.id) return;
    for (const sg of row.segs) {
      const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) continue;
      const bx = segBox(row, sg, pc), [u, v] = WB.toFrame(bx.F, p.x, p.y), tol = 6 / view.s;
      if (u < bx.x0 - tol || u > bx.x1 + tol || v < bx.vTop || v > bx.vBot) continue;
      if (sg.lanes.some(l => Math.abs(l.u - u) < App.segPitch(sg) * 0.3)) { G.UI.toast('这里已经有一道：拖动它可以微调，选中后按 Delete 删除'); return; }
      const i = App.editLanes(row, sg, () => App.addLane(row, sg, u));
      App.selSeg = sg.piece; App.selLane = i; App.commit();
      G.UI.toast('已加一道：拖动竖线微调，选中后按 Delete 删除');
      return;
    }
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
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
  // keys only when the image area has focus: a selected lane moves / goes; else the selected box's lanes
  // move together (Alt: their spacing), ↑↓ moves the row, Delete removes it
  box.addEventListener('keydown', e => {
    if (e.target !== box || !App.S) return;
    if (App.mode === 'align' && aligning(curImage())) {
      const rec = curImage(), k = e.key, big = e.shiftKey;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (dir) align.T = App.alignShifted(align.T, dir[0] * (big ? 10 : 1), dir[1] * (big ? 10 : 1));
      else if (k === '[' || k === ']' || k === '{' || k === '}') { const [px, py] = App.membraneCentre(App.blot(App.viewBlot)); align.T = App.alignTurned(align.T, (k === '[' || k === '{' ? -1 : 1) * (big ? 1 : 0.1), px, py, rec.img.w, rec.img.h); }
      else return;
      e.preventDefault(); draw(); alignLater();
      return;
    }
    // marking: the selected mark ↑↓ (Shift 5 px), Delete, Enter (its size)
    if (App.mode === 'marks') {
      const b = App.blot(App.viewBlot), s = b && selMark(b);
      if (!s) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { s.m.v += (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 5 : 1); App.commit(); e.preventDefault(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { s.pc.marks.splice(App.selMark.i, 1); App.selMark = null; App.commit(); G.UI.toast('已删除这条刻度（Ctrl+Z 可撤销）'); e.preventDefault(); }
      else if (e.key === 'Enter') { const g = markGeom(s.pc, { u: s.m.u, v: s.m.v, k: s.m.kda }), R = cv.getBoundingClientRect(); G.UI.markPicker(b, s.pc, s.m, R.left + g.pill.x, R.top + g.pill.y, false); e.preventDefault(); }
      return;
    }
    const row = App.selRow && App.row(App.selRow), sg = App.curSeg(row), st = e.shiftKey ? 5 : 1;
    if (!row || !sg) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;     // Alt+↑↓ reorders the figure (wbui)
    const sideways = e.key === 'ArrowLeft' || e.key === 'ArrowRight', d = e.key === 'ArrowLeft' ? -1 : 1;
    if (App.selLane != null && sg.lanes[App.selLane]) {
      if (sideways) { const i = App.selLane; App.editLanes(row, sg, () => App.moveLane(sg, i, sg.lanes[i].u + d * st)); App.commit(); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sg.lanes.length < 2) { G.UI.toast('这个框只剩一道了：不要这一行可以在左侧删除整行'); return; }
        const i = App.selLane; App.editLanes(row, sg, () => App.removeLane(row, sg, i)); App.selLane = null; App.commit();
        G.UI.toast('已删除这一道（Ctrl+Z 可撤销）'); e.preventDefault(); return;
      }
    }
    if (sideways) { App.editLanes(row, sg, () => { if (e.altKey) App.scaleLanes(sg, d * 0.5); else App.nudgeLanes(sg, d * st); }); App.commit(); e.preventDefault(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dv = (e.key === 'ArrowUp' ? -1 : 1) * st;
      row.segs.forEach(t => { t.vc += dv; t.b0 -= dv; t.b1 -= dv; App.findBand(row, t); });
      App.commit(); e.preventDefault();
    }
    if (e.key === 'Delete') { App.S.rows = App.S.rows.filter(r => r !== row); App.selRow = null; App.selLane = null; App.commit(); G.UI.toast('已删除该行（Ctrl+Z 可撤销）'); e.preventDefault(); }
  });

  // screen positions (canvas px) of a row's box handles and of its lanes at mid-height (tests)
  function probe(row, sg) {
    const pc = App.pieceOf(row, sg), bx = segBox(row, sg, pc), vm = (bx.vTop + bx.vBot) / 2;
    return { scale: view.s, handles: Object.fromEntries(handles(bx).map(hd => [hd.k, [hd.x, hd.y]])),
      lanes: sg.lanes.map(l => { const [x, y] = WB.toImg(bx.F, l.u, vm), p = toScr(x, y); return [p.x, p.y]; }) };
  }

  new ResizeObserver(resize).observe(box);
  App.on(w => {
    if (w === 'loaded') { document.getElementById('dropHint').classList.add('hidden'); fitted = null; resize(); }
    else if (fitted !== App.viewBlot && App.S) fitFull();
    else draw();
  });
  // screen positions (canvas px) of a piece's marks while marking: label centre and line middle (tests)
  function probeMarks(pc) {
    const b = App.blot(App.viewBlot);
    return marksOf(b, pc).map(m => { const g = markGeom(pc, m); return { k: m.k, manual: !!m.manual, predicted: !!m.predicted, v: m.v, pill: [g.pill.x + g.pill.w / 2, g.pill.y + g.pill.h / 2], mid: [(g.a.x + g.c.x) / 2, (g.a.y + g.c.y) / 2] }; });
  }
  const scrOf = (pc, u, v) => toScr(...WB.toImg(pFrame(pc), u, v));
  G.View = { draw, fitFull, fitRow, fitPiece, resize, curImage, dispCanvas, probe, probeMarks, scrOf, probeScale: () => view.s, alignStart, alignEnd, alignLive: () => align && Object.assign({}, align.T) };
})(window);
