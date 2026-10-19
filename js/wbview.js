/* Middle panel: one image of one membrane at a time, with the figure rows drawn as rotated boxes.
 * Drag a row box edge to change its height, drag inside to move it, click empty membrane in "add" mode
 * to add a row there. Lane ticks show where figure lanes fall on this membrane. */
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
    view.s = Math.min((r.width - 2 * pad) / rec.img.w, (r.height - 2 * pad) / rec.img.h);
    view.ox = (r.width - rec.img.w * view.s) / 2; view.oy = (r.height - rec.img.h * view.s) / 2;
    fitted = App.viewBlot;
    draw();
  }

  // the four corners of a row box (image coords) and helpers
  function rowCorners(row, vTop, vBot) {
    const b = App.blot(row.blot), g = row.geo, F = WB.frame(g.ox, g.oy, g.angle);
    const [j0, j1] = App.S.range;
    const u0 = g.uOrigin + (j0 + b.shift - 0.5) * g.pitch, u1 = g.uOrigin + (j1 + b.shift + 0.5) * g.pitch;
    return { F, u0, u1, pts: [[u0, vTop], [u1, vTop], [u1, vBot], [u0, vBot]].map(([u, v]) => WB.toImg(F, u, v)) };
  }

  function draw() {
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!App.S) return;
    const rec = curImage(); if (!rec) return;
    const b = App.blot(App.viewBlot), A = App.analysis[b.id];
    ctx.imageSmoothingEnabled = view.s < 2;
    ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s);
    ctx.drawImage(dispCanvas(rec), 0, 0);
    if (document.getElementById('showSat').checked && rec.kind === 'chemi') ctx.drawImage(satCanvas(rec), 0, 0);
    ctx.restore();
    const line = (pts, close) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const p = toScr(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); if (close) ctx.closePath(); };
    // ladder bands from the calibration (dashed amber)
    const cal = App.calibFor(b), lad = G.ProteinLadders.get(b.ladderId);
    if (A && cal && lad) {
      ctx.font = '600 10.5px -apple-system, Segoe UI, Arial'; ctx.textAlign = 'right';
      A.strips.forEach((s, si) => {
        const ls = A.ladderStrips[si]; if (!ls || ls.uStrip == null || !cal.strips[si]) return;
        const F = WB.stripFrame(s);
        lad.sizes.forEach(k => {
          const v = WB.vAt(cal, si, k); if (Math.abs(v) > s.h / 2) return;
          const seen = cal.strips[si].bands.some(x => x.kda === k);
          const a = WB.toImg(F, ls.uStrip - A.pitch * 0.45, v), c = WB.toImg(F, ls.uStrip + A.pitch * 0.45, v);
          ctx.strokeStyle = seen ? '#e0a800' : 'rgba(224,168,0,.5)'; ctx.lineWidth = 1.4; ctx.setLineDash(seen ? [] : [3, 3]);
          line([a, c]); ctx.stroke(); ctx.setLineDash([]);
          const p = toScr(a[0], a[1]);
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(k, p.x - 4, p.y + 3.5);
          ctx.fillStyle = '#8a6100'; ctx.fillText(k, p.x - 4, p.y + 3.5);
        });
      });
    }
    // rows
    App.S.rows.filter(r => r.blot === b.id).forEach(row => {
      const g = row.geo, sel = App.selRow === row.id, col = App.rowColor(row);
      const { F, u0, u1, pts } = rowCorners(row, g.vTop, g.vBot);
      ctx.globalAlpha = row.hidden ? 0.4 : 1;
      ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.4 : 1.4; ctx.setLineDash(row.img === rec.id || rec.kind === 'marker' ? [] : [6, 4]);
      line(pts, true); ctx.stroke(); ctx.setLineDash([]);
      if (sel) { ctx.fillStyle = col + '14'; line(pts, true); ctx.fill(); }
      // lane ticks
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      for (let j = App.S.range[0]; j <= App.S.range[1]; j++) {
        const u = g.uOrigin + (j + b.shift) * g.pitch;
        const a = WB.toImg(F, u, g.vTop), c = WB.toImg(F, u, g.vTop + Math.min(8 / view.s, (g.vBot - g.vTop) * 0.3));
        line([a, c]); ctx.stroke();
      }
      // label chip
      const p = toScr(pts[1][0], pts[1][1]);
      const kda = App.rowKda(row), on = App.images.get(row.img);
      const txt = `${row.name || (kda ? '≈' + Math.round(kda) + ' kDa' : '未命名')} · ${on ? (row.img === App.bestExpo(row) ? '★ ' : '') + App.expoLabel(on) : ''}`;
      ctx.font = '600 11px -apple-system, Segoe UI, Arial'; ctx.textAlign = 'left';
      const tw = ctx.measureText(txt).width + 12;
      ctx.fillStyle = col; roundRect(p.x + 6, p.y - 1, tw, 18, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, p.x + 12, p.y + 12);
      ctx.globalAlpha = 1;
    });
    if (App.mode === 'addrow' && hover && hover.p) {
      ctx.strokeStyle = '#2f6feb'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      const p = toScr(hover.p.x, hover.p.y); ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke(); ctx.setLineDash([]);
    }
    document.getElementById('zoomLabel').textContent = Math.round(view.s * 100) + '%';
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function hitTest(sx, sy) {
    const b = App.blot(App.viewBlot); if (!b) return { type: 'pan' };
    if (spaceDown) return { type: 'pan' };
    const p = toImg(sx, sy), tol = 7 / view.s;
    const rows = App.S.rows.filter(r => r.blot === b.id);
    // selected row first
    rows.sort((a, c) => (a.id === App.selRow ? -1 : c.id === App.selRow ? 1 : 0));
    for (const row of rows) {
      const g = row.geo, F = WB.frame(g.ox, g.oy, g.angle), [u, v] = WB.toFrame(F, p.x, p.y);
      const { u0, u1 } = rowCorners(row, g.vTop, g.vBot);
      if (u < u0 - tol || u > u1 + tol) continue;
      if (Math.abs(v - g.vTop) <= tol) return { type: 'top', row };
      if (Math.abs(v - g.vBot) <= tol) return { type: 'bot', row };
      if (v > g.vTop && v < g.vBot) return { type: 'move', row, v };
    }
    return { type: 'pan', p };
  }
  const cursorFor = h => (!h ? 'default' : h.type === 'top' || h.type === 'bot' ? 'ns-resize' : h.type === 'move' ? 'move' : App.mode === 'addrow' ? 'crosshair' : 'grab');

  cv.addEventListener('mousedown', e => {
    if (!App.S) return;
    box.focus({ preventScroll: true });
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, p = toImg(sx, sy);
    if (App.mode === 'addrow') {
      const row = App.addRowAt(App.viewBlot, p.x, p.y);
      App.setMode(null);
      if (row) { App.selRow = row.id; App.commit(); G.UI.toast('已添加一行：在右侧成图上点"蛋白名"输入名称；选不同曝光看看'); G.UI.editRowName(row.id); }
      return;
    }
    const h = hitTest(sx, sy);
    drag = { h, sx, sy, p0: p, view0: Object.assign({}, view), moved: false };
    if (h.row) { App.selRow = h.row.id; drag.geo0 = JSON.parse(JSON.stringify(h.row.geo)); App.emit('select'); }
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
      if (App.mode === 'addrow') draw();
      return;
    }
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 2) drag.moved = true;
    const h = drag.h;
    if (h.type === 'pan') { view.ox = drag.view0.ox + sx - drag.sx; view.oy = drag.view0.oy + sy - drag.sy; draw(); return; }
    const row = h.row, g = row.geo, g0 = drag.geo0, F = WB.frame(g0.ox, g0.oy, g0.angle);
    const p = toImg(sx, sy), [, v] = WB.toFrame(F, p.x, p.y), [, v0] = WB.toFrame(F, drag.p0.x, drag.p0.y), dv = v - v0;
    if (h.type === 'top') g.vTop = Math.min(g0.vTop + dv, g.vBand0 - 2);
    else if (h.type === 'bot') g.vBot = Math.max(g0.vBot + dv, g.vBand1 + 2);
    else if (h.type === 'move') { Object.assign(g, JSON.parse(JSON.stringify(g0))); App.moveRowV(row, dv); }
    row.manualGeo = true;
    draw(); App.refresh();
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.h.type === 'pan' && !d.moved) { App.selRow = null; App.emit('select'); }
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
    const row = App.selRow && App.row(App.selRow);
    if (!row || e.target !== box) return;
    const st = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { App.moveRowV(row, e.key === 'ArrowUp' ? -st : st); App.commit(); e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { row.geo.uOrigin += e.key === 'ArrowLeft' ? -st : st; App.commit(); e.preventDefault(); }
    if (e.key === 'Delete') { App.S.rows = App.S.rows.filter(r => r !== row); App.selRow = null; App.commit(); G.UI.toast('已删除该行（Ctrl+Z 可撤销）'); e.preventDefault(); }
  });

  new ResizeObserver(resize).observe(box);
  App.on(w => {
    if (w === 'loaded') { document.getElementById('dropHint').classList.add('hidden'); fitted = null; resize(); }
    else if (fitted !== App.viewBlot && App.S) fitFull();
    else draw();
  });
  G.View = { draw, fitFull, resize, curImage, dispCanvas };
})(window);
