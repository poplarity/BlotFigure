/* Middle panel: one image of one membrane at a time.
 * Every row is a box on each piece it runs across, with lanes of its own. The selected row's boxes show
 * their lanes (vertical lines; above each its figure column, M = marker lane, × = left out) and eight
 * handles: drag an edge or a corner to resize a box — its lanes stay where they are and new room gets lanes
 * at the same spacing; drag inside to move it (Shift: all the row's boxes up/down); drag a lane line to move
 * that lane; double-click inside to add a lane; click a label to switch sample / left out / marker.
 * The dot above the selected box turns it (also [ ]). Modes: 'addrow' a click puts a box down where it is (as
 * big as the other boxes), or drag one out; 'marks' the Marker picture: a click on a piece adds a mark at the
 * band nearest it (its size to pick), a mark's label or line drags it (snapping onto the lane's bands; Alt:
 * free), a click on it changes its size or deletes it; with 2 marks the other sizes show where they are
 * expected (dashed, a click adds one); the selected mark ↑↓ / Delete / Enter; 'align' the picture as taken is
 * dragged / turned until its bands sit in the boxes (the membrane had moved); 'pieces' the pieces' outlines by
 * hand. The right or middle button pans in every mode. Boxes go anywhere on the picture (dropped on another
 * piece, a box belongs to it); dragging the first or last lane spreads the lanes between evenly (Alt: that lane
 * alone). */
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
    const pts = App.mode === 'align' || !b || App.curStep === 1 ? [] : (b.pieces || []).flatMap(corners);
    if (pts.length) {
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      // (marking: room on the right for the ladder's reference card)
      const L = 56, R = App.mode === 'marks' ? 170 : App.mode === 'pieces' ? 40 : 165, T = App.mode ? 64 : 36, B = 24;
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
    const lane = App.markLane(pc), ys = corners(pc).map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), cx = WB.toImg(pFrame(pc), lane != null ? lane : App.ladderU(pc), 0)[0], T = 64, B = 24;
    view.s = Math.min((r.height - T - B) / (y1 - y0), (r.width - 100) / (5 * (pc.pitch || 60)), 2);
    view.ox = r.width * 0.42 - cx * view.s;
    view.oy = T + (r.height - T - B - (y1 - y0) * view.s) / 2 - y0 * view.s;
    fitted = App.viewBlot;
    draw();
  }

  /* ---------- geometry on screen ---------- */
  function letterTag(pc) { const [x, y] = WB.toImg(pFrame(pc), -pc.w / 2, -pc.h / 2); const p = toScr(x, y); return { x: p.x + 4, y: p.y + 4, w: 18, h: 16 }; }
  // a row's box on one piece: edges in the box's frame (its piece's, turned by its own tilt), corners in image
  // coordinates
  function segBox(row, sg, pc) {
    const F = App.segFrame(pc, sg), vTop = sg.vc - row.above, vBot = sg.vc + row.below, x0 = sg.x0, x1 = sg.x1;
    return { F, x0, x1, vTop, vBot, pts: [[x0, vTop], [x1, vTop], [x1, vBot], [x0, vBot]].map(([u, v]) => WB.toImg(F, u, v)) };
  }
  const HANDLES = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
  const handles = bx => HANDLES.map(([k, a, c]) => { const [x, y] = WB.toImg(bx.F, bx.x0 + (bx.x1 - bx.x0) * a, bx.vTop + (bx.vBot - bx.vTop) * c); return Object.assign({ k }, toScr(x, y)); });
  // the turning dot of a selected box: above the middle of its top edge, clear of the lane labels
  function rotHandle(bx) {
    const top = toScr(...WB.toImg(bx.F, (bx.x0 + bx.x1) / 2, bx.vTop)), up = toScr(...WB.toImg(bx.F, (bx.x0 + bx.x1) / 2, bx.vTop - 1)), d = Math.hypot(up.x - top.x, up.y - top.y) || 1;
    return { x: top.x + (up.x - top.x) / d * 36, y: top.y + (up.y - top.y) / d * 36, top };
  }
  // labels above a box's lanes (screen): the figure column, M or ×
  const labelsFit = sg => App.segPitch(sg) * view.s >= 15;
  function laneChips(sg, bx) {
    return App.segCols(sg).map(s => {
      const [x, y] = WB.toImg(bx.F, s.u, bx.vTop), p = toScr(x, y), txt = s.r === 's' ? String(s.col) : s.r === 'm' ? 'M' : '×';
      return { s, txt, x: p.x, y: p.y - 10, w: Math.max(16, txt.length * 7 + 6), h: 14 };
    });
  }
  /* marker bands of a piece as drawn: the user's marks. While marking, once 2 are set, also the ladder sizes they
   * predict where none is set yet (predicted: dashed, a click adds it) — never before: nothing is guessed from
   * the picture alone. */
  function marksOf(b, pc) {
    if (!pc.marks || !pc.marks.length) return [];
    const pcal = App.pieceCal(b, pc), lad = G.ProteinLadders.get(b.ladderId), u = App.markLane(pc), have = pc.marks.map(m => m.kda);
    const predicted = App.mode === 'marks' && pcal && lad ? lad.sizes.filter(k => !have.some(h => Math.abs(Math.log(h / k)) < 0.02))
      .map(k => ({ u, v: WB.vAtK(pcal, k), k, predicted: true })).filter(t => t.v != null && Math.abs(t.v) <= pc.h / 2 - 2) : [];
    return pc.marks.map((m, i) => ({ u: m.u, v: m.v, k: m.kda, i, seen: true, manual: true })).concat(predicted);
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
    const marking = App.mode === 'marks', pcsEd = editing();
    // pieces: outline and letter (being edited: drawn by drawPieceEdit; step 1: not looked at yet)
    (pcsEd || App.curStep === 1 ? [] : b.pieces || []).forEach(pc => {
      const F = pFrame(pc);
      const pts = [[-pc.w / 2, -pc.h / 2], [pc.w / 2, -pc.h / 2], [pc.w / 2, pc.h / 2], [-pc.w / 2, pc.h / 2]].map(([u, v]) => WB.toImg(F, u, v));
      ctx.strokeStyle = 'rgba(120,130,145,.7)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      line(pts, true); ctx.stroke(); ctx.setLineDash([]);
      const t = letterTag(pc);
      ctx.fillStyle = 'rgba(60,70,85,.85)'; roundRect(t.x, t.y, t.w, t.h, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(pc.letter || '?', t.x + t.w / 2, t.y + 12);
    });
    // marker bands (amber) outside marking: the bands read, small, with their sizes
    if (!marking && !pcsEd) {
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
      ctx.globalAlpha = marking || pcsEd ? 0.18 : row.hidden ? 0.4 : 1;
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
      if (last && (!row.hidden || sel) && !marking && !pcsEd) {
        const p = toScr(last[0], last[1]);
        const on = App.images.get(row.img), ex = on ? App.expoLabel(on) : '';
        const txt = `${App.rowLabel(row).replace(/ 行$/, '')} · ${on ? (row.img === App.bestSeen(row) ? '★ ' : '') + (ex.length > 10 ? ex.slice(0, 9) + '…' : ex) : ''}`;
        ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left';
        const tw = ctx.measureText(txt).width + 12;
        ctx.fillStyle = col; roundRect(p.x + 6, p.y - 1, tw, 18, 6); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(txt, p.x + 12, p.y + 12);
      }
      ctx.globalAlpha = 1;
    });
    // the selected row's handles, on top: edges, corners and the turning dot
    if (selRow && selRow.blot === b.id && !App.mode) selRow.segs.forEach(sg => {
      const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) return;
      const col = App.rowColor(selRow), bx = segBox(selRow, sg, pc), r = rotHandle(bx);
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(r.top.x, r.top.y); ctx.lineTo(r.x, r.y); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r.x, r.y, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText('↻', r.x, r.y + 3.5);
      if (sg.rot) { ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(`${sg.rot > 0 ? '+' : ''}${sg.rot.toFixed(1)}°`, r.x + 10, r.y + 4); }
      handles(bx).forEach(hd => {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        roundRect(hd.x - 4.5, hd.y - 4.5, 9, 9, 2); ctx.fill(); ctx.stroke();
      });
    });
    if (marking) drawMarking(b, line);
    if (pcsEd) drawPieceEdit(line);
    // a box being drawn (adding a row)
    if (drag && drag.h.type === 'newbox' && drag.moved && drag.cur) {
      const [ua, va] = drag.a, [ub, vb] = WB.toFrame(drag.F, drag.cur.x, drag.cur.y);
      const pts = [[ua, va], [ub, va], [ub, vb], [ua, vb]].map(([u, v]) => WB.toImg(drag.F, u, v));
      ctx.fillStyle = 'rgba(47,111,235,.08)'; line(pts, true); ctx.fill();
      ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); line(pts, true); ctx.stroke(); ctx.setLineDash([]);
    } else if (App.mode === 'addrow' && hover && hover.p) {
      // the box a click puts down, under the pointer (the size of the other boxes; dragging draws one instead)
      const g = ghostBox(b, hover.p);
      if (g) {
        const pts = [[g.u0, g.v0], [g.u1, g.v0], [g.u1, g.v1], [g.u0, g.v1]].map(([u, v]) => WB.toImg(g.F, u, v));
        ctx.fillStyle = 'rgba(47,111,235,.10)'; line(pts, true); ctx.fill();
        ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); line(pts, true); ctx.stroke(); ctx.setLineDash([]);
        const t = toScr(...WB.toImg(g.F, g.u1, g.v0));
        ctx.fillStyle = '#2f6feb'; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('点一下放在这里', t.x + 6, t.y + 4);
      }
    }
    document.getElementById('zoomLabel').textContent = Math.round(view.s * 100) + '%';
  }
  // adding a row: the box a click puts down — in the frame of the nearest piece, centred at p, as big as the
  // other boxes there
  function ghostBox(b, p) {
    const hit = App.pieceAt(b, p.x, p.y);
    return hit ? Object.assign({ F: pFrame(hit.pc), pc: hit.pc }, App.defaultBox(b, hit.pc, hit.u, hit.v)) : null;
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

  /* marking: the lane of each piece's marks highlighted and the marks as handles with their sizes (filled);
   * once a piece has 2, the ladder's other sizes where they predict them (faint, dashed, "?") */
  function drawMarking(b, line) {
    const sm = selMark(b), hov = hover && hover.type === 'mark' ? hover : null;
    (b.pieces || []).forEach(pc => {
      const F = pFrame(pc), h = laneHalf(pc);
      // the piece picked in the panel
      if (App.markFocus === pc.id) { ctx.strokeStyle = '#e0a800'; ctx.lineWidth = 2; line(corners(pc), true); ctx.stroke(); }
      // the lane the user's marks are on (nothing before the first mark: no lane is guessed)
      const lane = App.markLane(pc), lanes = lane != null ? [lane] : [];
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
    // where a click adds a mark: across the lane under the pointer, at the band it snaps to
    if (hover && hover.type === 'newmark' && !drag) {
      const pc = hover.pc, u = newMarkU(pc, hover.u), v = App.snapMarkV(b, pc, u, hover.v, 10 / view.s), F = pFrame(pc), h = laneHalf(pc);
      const pts = [[u - h, -pc.h / 2], [u + h, -pc.h / 2], [u + h, pc.h / 2], [u - h, pc.h / 2]].map(([x, y]) => WB.toImg(F, x, y));
      ctx.fillStyle = 'rgba(255,190,0,.07)'; line(pts, true); ctx.fill();
      const a = toScr(...WB.toImg(F, u - h, v)), c = toScr(...WB.toImg(F, u + h, v));
      ctx.strokeStyle = '#e0a800'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c58f00'; ctx.font = `700 14px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText('+', c.x + 5, c.y + 5);
    }
  }
  // the lane a new mark goes on: the lane of the piece's marks when the click is within about a lane of it,
  // else where clicked
  function newMarkU(pc, u) {
    const lane = App.markLane(pc);
    return lane != null && Math.abs(lane - u) < (pc.pitch || 60) * 0.8 ? lane : u;
  }

  /* ---------- the pieces of the membrane by hand ('pieces' mode): a working copy of their outlines — drag one
   * to move it, its edges / corners to resize it, the dot above it to turn it; drag on empty picture to draw a
   * new one; Delete takes the selected one away. Applied (the membrane analysed on them) when the mode ends with
   * 应用. ---------- */
  let pedit = null;            // {pcs: [{id, cx, cy, angle, w, h, letter}], sel, changed}
  const editing = () => App.mode === 'pieces' && pedit;
  function piecesStart() {
    const b = App.blot(App.viewBlot);
    pedit = { pcs: ((b && b.pieces) || []).map(p => ({ id: p.id, cx: p.cx, cy: p.cy, angle: p.angle, w: p.w, h: p.h, letter: p.letter })), sel: null, changed: false };
    fitFull();
  }
  // the outlines as edited (apply) or nothing (dropped)
  function piecesEnd(apply) { const e = pedit; pedit = null; draw(); return apply && e && e.changed ? e.pcs : null; }
  const ROT = 26;              // the turning dot: px above the middle of the top edge
  function pieceHandles(pc) {
    const F = pFrame(pc);
    const hs = HANDLES.map(([k, a, c]) => Object.assign({ k }, toScr(...WB.toImg(F, -pc.w / 2 + pc.w * a, -pc.h / 2 + pc.h * c))));
    const top = toScr(...WB.toImg(F, 0, -pc.h / 2)), up = toScr(...WB.toImg(F, 0, -pc.h / 2 - 1)), d = Math.hypot(up.x - top.x, up.y - top.y) || 1;
    hs.push({ k: 'rot', x: top.x + (up.x - top.x) / d * ROT, y: top.y + (up.y - top.y) / d * ROT, top });
    return hs;
  }
  function drawPieceEdit(line) {
    pedit.pcs.forEach(pc => {
      const sel = pc.id === pedit.sel, pts = corners(pc);
      ctx.fillStyle = sel ? 'rgba(47,111,235,.10)' : 'rgba(47,111,235,.04)'; line(pts, true); ctx.fill();
      ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = sel ? 2.2 : 1.4; line(pts, true); ctx.stroke();
      const t = letterTag(pc);
      ctx.fillStyle = sel ? '#2f6feb' : 'rgba(47,111,235,.85)'; roundRect(t.x, t.y, t.w, t.h, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(pc.letter || '+', t.x + t.w / 2, t.y + 12);
      if (!sel) return;
      const hs = pieceHandles(pc), r = hs.pop();
      ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(r.top.x, r.top.y); ctx.lineTo(r.x, r.y); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(r.x, r.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2f6feb'; ctx.font = `700 10px ${FONT}`; ctx.fillText('↻', r.x, r.y + 3.5);
      hs.forEach(hd => { ctx.fillStyle = '#fff'; roundRect(hd.x - 4.5, hd.y - 4.5, 9, 9, 2); ctx.fill(); ctx.stroke(); });
    });
    if (drag && drag.h.type === 'pcnew' && drag.moved && drag.cur) {
      const a = toScr(drag.p0.x, drag.p0.y), c = toScr(drag.cur.x, drag.cur.y);
      ctx.strokeStyle = '#2f6feb'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6; ctx.strokeRect(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.abs(c.x - a.x), Math.abs(c.y - a.y)); ctx.setLineDash([]);
    }
  }
  function pieceHit(sx, sy) {
    const sel = pedit.pcs.find(p => p.id === pedit.sel), p = toImg(sx, sy);
    if (sel) for (const hd of pieceHandles(sel)) if (Math.hypot(sx - hd.x, sy - hd.y) <= (hd.k === 'rot' ? 9 : 7)) return { type: hd.k === 'rot' ? 'pcrot' : 'pcsize', k: hd.k, pc: sel };
    const inside = pedit.pcs.filter(pc => { const [u, v] = WB.toFrame(pFrame(pc), p.x, p.y); return Math.abs(u) <= pc.w / 2 && Math.abs(v) <= pc.h / 2; });
    // the selected one first, then the smallest (a piece drawn inside a big wrong one stays reachable)
    inside.sort((a, c) => (a === sel ? -1 : c === sel ? 1 : a.w * a.h - c.w * c.h));
    return inside.length ? { type: 'pcmove', pc: inside[0] } : { type: 'pcnew', p };
  }
  function pieceDrag(d, p, e) {
    const pc = d.h.pc, o = d.orig;
    if (d.h.type === 'pcmove') { pc.cx = o.cx + p.x - d.p0.x; pc.cy = o.cy + p.y - d.p0.y; }
    else if (d.h.type === 'pcrot') {
      // the dot moved along the piece as if on a lever half the piece long (pieces lie tilted by a degree or two)
      const F = pFrame(o), du = WB.toFrame(F, p.x, p.y)[0] - WB.toFrame(F, d.p0.x, d.p0.y)[0];
      pc.angle = Math.round((o.angle + Math.atan2(du, Math.max(o.w / 2, 80 / view.s)) * 180 / Math.PI) * 20) / 20;
    } else if (d.h.type === 'pcsize') {
      // the opposite edge stays where it is
      const F = pFrame(o), [u, v] = WB.toFrame(F, p.x, p.y), [u0, v0] = WB.toFrame(F, d.p0.x, d.p0.y), du = u - u0, dv = v - v0, k = d.h.k;
      let w = o.w, h = o.h, su = 0, sv = 0;
      if (k.includes('e')) { w = Math.max(20, o.w + du); su = (w - o.w) / 2; }
      if (k.includes('w')) { w = Math.max(20, o.w - du); su = -(w - o.w) / 2; }
      if (k.includes('s')) { h = Math.max(20, o.h + dv); sv = (h - o.h) / 2; }
      if (k.includes('n')) { h = Math.max(20, o.h - dv); sv = -(h - o.h) / 2; }
      [pc.cx, pc.cy] = WB.toImg(F, su, sv); pc.w = w; pc.h = h;
    } else if (d.h.type === 'pcnew') d.cur = p;
    pedit.changed = pedit.changed || d.h.type !== 'pcnew';
  }
  function pieceDrop(d) {
    if (d.h.type !== 'pcnew' || !d.moved || !d.cur) return;
    const w = Math.abs(d.cur.x - d.p0.x), h = Math.abs(d.cur.y - d.p0.y);
    if (w * view.s < 12 || h * view.s < 12) return;
    // a new piece, upright on the picture (turn it with the dot)
    const pc = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), cx: (d.p0.x + d.cur.x) / 2, cy: (d.p0.y + d.cur.y) / 2, angle: 0, w, h, letter: '+' };
    pedit.pcs.push(pc); pedit.sel = pc.id; pedit.changed = true;
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
    if (App.mode === 'pieces') return editing() ? pieceHit(sx, sy) : { type: 'pan', p };
    if (App.mode) return { type: 'mode', p };
    // the selected row first: its handles, lane labels and lane lines
    const selRow = App.selRow && App.row(App.selRow);
    if (selRow && selRow.blot === b.id) for (const sg of selRow.segs) {
      const pc = App.piece(b, sg.piece); if (!pc || sg.x0 == null) continue;
      const bx = segBox(selRow, sg, pc);
      const rh = rotHandle(bx);
      if (Math.hypot(sx - rh.x, sy - rh.y) <= 9) return { type: 'rotate', row: selRow, sg, pc };
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
  const cursorFor = h => (!h ? 'default' : h.type === 'resize' || h.type === 'pcsize' ? CURSORS[h.k] : h.type === 'mark' ? 'ns-resize' : h.type === 'lane' ? 'ew-resize'
    : h.type === 'move' || h.type === 'align' || h.type === 'pcmove' ? 'move' : h.type === 'lanechip' || h.type === 'pcrot' || h.type === 'rotate' ? 'pointer'
    : h.type === 'newmark' || h.type === 'mode' || h.type === 'pcnew' ? 'crosshair' : App.mode ? 'crosshair' : 'grab');

  cv.addEventListener('mousedown', e => {
    if (!App.S) return;
    box.focus({ preventScroll: true });
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toImg(sx, sy);
    const b = App.blot(App.viewBlot);
    // the right or middle button always pans (the left one is busy with boxes)
    if (e.button === 1 || e.button === 2) { drag = { h: { type: 'pan' }, sx, sy, p0: p, view0: Object.assign({}, view), moved: false, button: e.button }; cv.style.cursor = 'grabbing'; e.preventDefault(); return; }
    if (App.mode === 'addrow') {
      // anywhere on the picture: the frame (its tilt) of the nearest piece
      const hit = App.pieceAt(b, p.x, p.y);
      if (!hit) { G.UI.toast('这张膜还没有膜条：先回到第 2 步在图上拖出一条'); return; }
      drag = { h: { type: 'newbox', pc: hit.pc }, sx, sy, p0: p, moved: false, F: pFrame(hit.pc), a: [hit.u, hit.v] };
      e.preventDefault();
      return;
    }
    const h = hitTest(sx, sy);
    if (/^pc/.test(h.type)) {
      pedit.sel = h.pc ? h.pc.id : null;
      drag = { h, sx, sy, p0: p, orig: h.pc ? Object.assign({}, h.pc) : null, moved: false };
      cv.style.cursor = cursorFor(h); draw(); e.preventDefault();
      return;
    }
    if (h.type === 'lanechip') {
      App.editLanes(h.row, h.sg, () => App.cycleLane(h.sg, h.i));
      App.selSeg = h.sg.piece; App.selLane = h.i; App.commit();
      return;
    }
    if (h.type === 'newmark') {
      // a mark on the marker lane at the band nearest the click (Alt: exactly there), its size to pick (the
      // size suggested from the marks there are; none picked: the mark goes again)
      const was = h.pc.marks, u = newMarkU(h.pc, h.u), v = e.altKey ? h.v : App.snapMarkV(b, h.pc, u, h.v, 10 / view.s);
      const marks = App.manualMarks(b, h.pc), mark = { u, v, kda: App.suggestKda(b, h.pc, v) || 0 };
      marks.push(mark); App.selMark = { pc: h.pc.id, i: marks.length - 1 }; draw();
      G.UI.markPicker(b, h.pc, mark, e.clientX, e.clientY, true, was);
      return;
    }
    drag = { h, sx, sy, p0: p, view0: Object.assign({}, view), moved: false };
    if (h.type === 'align') { drag.T0 = Object.assign({}, align.T); drag.turn = e.shiftKey; drag.pivot = App.membraneCentre(b); }
    if (h.type === 'mark') {
      // a mark grabbed to drag (a click: its size picker); a predicted size becomes a mark at the band nearest it
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
      // (moves in the box's own frame; turning: about its middle)
      drag.F = App.segFrame(h.pc, h.sg);
      App.dragging = true;          // (the figure follows the drag; checks and scores wait for the release)
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
    if (/^pc/.test(h.type)) { if (drag.moved && pedit) { pieceDrag(drag, p, e); draw(); } return; }
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
    const F = drag.F || pFrame(h.pc), [u, v] = WB.toFrame(F, p.x, p.y), [u0, v0] = WB.toFrame(F, drag.p0.x, drag.p0.y), du = u - u0, dv = v - v0;
    if (h.type === 'rotate') {
      // turned about its middle, from where it was (0.05° steps): the dot moved along the box as if on a lever
      // half the box long — a band tilts by a degree or two, and a short lever would make that a twitch
      if (!drag.moved) return;
      const s0 = drag.geo0.segs[drag.k], sg = h.row.segs[drag.k], arm = Math.max((s0.x1 - s0.x0) / 2, 80 / view.s);
      const deg = Math.atan2(du, arm) * 180 / Math.PI;
      Object.assign(sg, JSON.parse(JSON.stringify(s0)));
      App.setSegRot(h.pc, sg, Math.round(((s0.rot || 0) + deg) * 20) / 20);
      draw(); App.refresh();
      return;
    }
    if (h.type === 'mark') {
      // follows the pointer, snapping onto a dark band of the lane within reach (Alt: no snapping)
      if (drag.mark && drag.moved) { const b = App.blot(App.viewBlot); drag.mark.v = e.altKey ? drag.v0 + dv : App.snapMarkV(b, h.pc, drag.mark.u, drag.v0 + dv, 10 / view.s); draw(); App.refresh(); }
      return;
    }
    if (!drag.moved) return;
    const row = h.row, g0 = drag.geo0, k = drag.k, s0 = g0.segs[k], sg = row.segs[k];
    // an end lane spreads the lanes between it and the other end (Alt: this lane alone)
    if (h.type === 'lane') { if (e.altKey) App.moveLane(sg, h.i, s0.lanes[h.i].u + du); else App.dragLane(sg, h.i, s0.lanes[h.i].u + du, s0); }
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
    App.dragging = false;
    if (d.h.type === 'newbox') {
      const b = App.blot(App.viewBlot);
      let row = null;
      if (d.moved && d.cur) {
        const [ua, va] = d.a, [ub, vb] = WB.toFrame(d.F, d.cur.x, d.cur.y);
        if (Math.abs(ub - ua) * view.s >= 8 && Math.abs(vb - va) * view.s >= 6) row = App.addRowBox(b.id, d.h.pc.id, Math.min(ua, ub), Math.max(ua, ub), Math.min(va, vb), Math.max(va, vb));
      } else {
        // a click: the box shown under the pointer, put down there
        const g = ghostBox(b, d.p0);
        if (g) row = App.addRowBox(b.id, g.pc.id, g.u0, g.u1, g.v0, g.v1);
      }
      App.setMode(null);
      if (row) {
        App.selRow = row.id; App.selSeg = row.segs[0].piece; App.selLane = null; App.commit();
        G.UI.toast(`已添加一个框（${App.nSample(row.segs[0])} 道，成图里就是框住的部分）：拖边角调大小；泳道线没对准就把最左、最右两条拖到泳道中心`, 4600);
      } else draw();
      return;
    }
    if (d.h.type === 'align') { if (d.moved) alignCommit(); return; }
    if (/^pc/.test(d.h.type)) { if (pedit) pieceDrop(d); draw(); if (G.UI.piecesChanged) G.UI.piecesChanged(); return; }
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
      // moved onto another piece: the box belongs to it now
      if (d.h.type === 'move') { const np = App.rehomeSeg(row, d.h.sg); if (np) { App.selSeg = d.h.sg.piece; G.UI.toast(`这个框移到了膜条 ${np.letter} 上（分子量按膜条 ${np.letter} 的 Marker 算）`); } }
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
  // space = pan (not on form fields, buttons and links, where Space types or presses)
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !/^(input|textarea|select|button|summary|a)$/i.test(e.target.tagName || '')) { spaceDown = true; if (e.target === box) e.preventDefault(); } });
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
    // pieces: the selected one moved by the arrows (Shift 10 px), turned by [ ] (0.1°, Shift 1°), taken away
    if (editing()) {
      const pc = pedit.pcs.find(p => p.id === pedit.sel), k = e.key, big = e.shiftKey;
      if (!pc) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (dir) { pc.cx += dir[0] * (big ? 10 : 1); pc.cy += dir[1] * (big ? 10 : 1); }
      else if (k === '[' || k === ']' || k === '{' || k === '}') pc.angle = Math.round((pc.angle + (k === '[' || k === '{' ? -1 : 1) * (big ? 1 : 0.1)) * 100) / 100;
      else if (k === 'Delete' || k === 'Backspace') { pedit.pcs = pedit.pcs.filter(p => p !== pc); pedit.sel = null; }
      else return;
      pedit.changed = true; e.preventDefault(); draw(); if (G.UI.piecesChanged) G.UI.piecesChanged();
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
    // [ ] turn the box 0.1° (Shift: 1°)
    if (e.key === '[' || e.key === ']' || e.key === '{' || e.key === '}') {
      const pc = App.pieceOf(row, sg); if (!pc) return;
      App.setSegRot(pc, sg, (sg.rot || 0) + (e.key === '[' || e.key === '{' ? -1 : 1) * (e.shiftKey ? 1 : 0.1));
      App.findBand(row, sg); App.commit(); e.preventDefault();
      return;
    }
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
  // the pieces being edited: their middles and handles on screen (tests)
  const probePieces = () => (pedit ? pedit.pcs.map(pc => ({ id: pc.id, letter: pc.letter, c: toScr(pc.cx, pc.cy), angle: pc.angle, w: pc.w, h: pc.h, handles: pc.id === pedit.sel ? Object.fromEntries(pieceHandles(pc).map(hd => [hd.k, [hd.x, hd.y]])) : null })) : null);
  G.View = { draw, fitFull, fitRow, fitPiece, resize, curImage, dispCanvas, probe, probeMarks, probePieces, scrOf, toScr, probeScale: () => view.s, hitAt: hitTest, alignStart, alignEnd,
    alignLive: () => align && Object.assign({}, align.T), piecesStart, piecesEnd, piecesSel: () => pedit && pedit.pcs.find(p => p.id === pedit.sel) };
})(window);
