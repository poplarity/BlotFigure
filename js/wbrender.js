/* Figure layout: state -> SVG (pt units). Figure columns on a common grid across rows, white gaps where
 * neighbouring columns are not neighbouring lanes of one box; each row is drawn from its boxes as
 * straightened crops scaled so the lane spacing matches the grid. kDa ticks on the left, protein names on
 * the right, lane labels / conditions / groups on top. */
(function (G) {
  'use strict';
  const App = G.BApp, WB = G.WB, MM = 72 / 25.4;
  const mctx = document.createElement('canvas').getContext('2d');
  const runs = t => String(t).split('*').map((s, i) => ({ t: s, it: i % 2 === 1 })).filter(r => r.t);
  function measure(text, pt, bold) {
    let w = 0;
    runs(text).forEach(r => { mctx.font = `${r.it ? 'italic ' : ''}${bold ? 'bold ' : ''}${pt * 4}px Arial`; w += mctx.measureText(r.t).width / 4; });
    return w;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f = v => (Math.round(v * 100) / 100).toString();
  const text = (t, x, y, pt, anchor, extra) => `<text x="${f(x)}" y="${f(y)}" font-size="${f(pt)}" text-anchor="${anchor}"${extra || ''}>${runs(t).map(r => r.it ? `<tspan font-style="italic">${esc(r.t)}</tspan>` : esc(r.t)).join('')}</text>`;
  const line = (x1, y1, x2, y2, lw) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#000" stroke-width="${f(lw)}"/>`;

  function build(preview) {
    const S = App.S, st = S.style, pt = st.fontPt, lw = st.lineWidthPt, P = !!preview;
    const ph = ' fill="#aab3be"';
    const ed = (attrs, inner) => (P ? `<g ${attrs} class="ed">${inner}</g>` : inner);
    const C = App.columns(), segs = C.segs, lanes = segs.flat();
    const laneW = st.mmPerLane * MM, gap = 1.6;
    // x of each figure lane centre
    const X = new Map(); let x = 0;
    segs.forEach((sg, si) => { if (si) x += gap; sg.forEach(j => { X.set(j, x + laneW / 2); x += laneW; }); });
    const W = x;
    const els = [], warnings = [];
    const box = { x0: 0, y0: 0, x1: W, y1: 0 };
    const grow = (a, b, c, d) => { box.x0 = Math.min(box.x0, a); box.y0 = Math.min(box.y0, b); box.x1 = Math.max(box.x1, c); box.y1 = Math.max(box.y1, d); };
    if (!lanes.length) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', w: 10, h: 10, warnings, angle: 0 };

    /* ---- rows ---- */
    const rows = C.rows;
    let y = 0, prevBlot = null, maxLeft = 0, maxRight = 0;
    const rowBoxes = [], placedTicks = [{ y: -pt * 0.6 }];   // the kDa header sits just above the first row
    rows.forEach((row, ri) => {
      if (prevBlot !== null) y += row.blot === prevBlot ? st.rowGapPt : st.blotGapPt;
      prevBlot = row.blot;
      const pitch = App.rowPitch(row), sc = laneW / pitch;       // pt per image px
      const h = (row.above + row.below) * sc;
      const step = Math.max(0.35, Math.min(2, pitch / 60));      // ~60 px per lane in the raster
      const srcOf = new Map(C.vis.map((j, k) => [j, C.src[ri][k]]));
      // one image per run of columns that are neighbouring lanes of one box; no lane = background
      segs.forEach(run => {
        let cur = null;
        const flush = () => {
          if (!cur) return;
          const ras = App.runRaster(row, cur.sg, cur.pc, cur.i0, cur.i1, step);
          const x0 = X.get(cur.j0) - laneW / 2, w = (cur.i1 - cur.i0 + 1) * laneW;
          els.push(`<image ${P ? `data-row="${row.id}" ` : ''}x="${f(x0)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none" href="${ras.href}" xlink:href="${ras.href}"/>`);
          if (st.border) els.push(`<rect x="${f(x0)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="#000" stroke-width="${f(lw)}" pointer-events="none"/>`);
          cur = null;
        };
        run.forEach(j => {
          const s = srcOf.get(j);
          if (s && cur && s.sg === cur.sg && s.i === cur.i1 + 1) cur.i1 = s.i;
          else { flush(); if (s && s.pc) cur = { sg: s.sg, pc: s.pc, i0: s.i, i1: s.i, j0: j }; }
        });
        flush();
      });
      if (P && App.selRow === row.id) els.push(`<rect x="-1" y="${f(y - 1)}" width="${f(W + 2)}" height="${f(h + 2)}" fill="none" stroke="#2f6feb" stroke-width="1.2" pointer-events="none"/>`);
      // protein name on the right
      const nm = row.name || (P ? '蛋白名' : '');
      const kdaHint = App.rowKda(row);
      if (nm) {
        const t = ed(`data-edit="rowname" data-row="${row.id}"`, text(nm, W + 3, y + h / 2 + pt * 0.35, pt, 'start', row.name ? '' : ph));
        els.push(t); maxRight = Math.max(maxRight, 3 + measure(nm, pt));
      }
      if (!row.name && P && kdaHint) els.push(text(`≈${Math.round(kdaHint)} kDa`, W + 3, y + h / 2 + pt * 1.35, pt * 0.8, 'start', ph));
      // kDa ticks on the left, from the leftmost piece of the row that has marker sizes
      const b = App.blot(row.blot);
      const tsg = st.showMW ? row.segs.find(sg => App.pieceTicks(b, App.piece(b, sg.piece)).length) : null;
      if (tsg) {
        const top = tsg.vc - row.above;
        const ticks = App.pieceTicks(b, App.piece(b, tsg.piece)).filter(t => t.v > top + 1 && t.v < tsg.vc + row.below - 1)
          .map(t => ({ k: t.k, y: y + (t.v - top) * sc })).sort((a, c) => a.y - c.y);
        const kept = [], yBand = y + (row.above + (tsg.b0 + tsg.b1) / 2) * sc;
        // too close to fit both: the tick nearest the band wins (it tells the size best);
        // also keep clear of ticks already printed for the row above
        ticks.slice().sort((a, c) => Math.abs(a.y - yBand) - Math.abs(c.y - yBand))
          .forEach(t => { if (kept.concat(placedTicks).every(o => Math.abs(o.y - t.y) >= pt * 0.95)) kept.push(t); });
        kept.sort((a, c) => a.y - c.y);
        placedTicks.push(...kept);
        kept.forEach(t => {
          els.push(line(-st.tickLenPt - 1, t.y, -1, t.y, lw));
          els.push(text(String(t.k), -st.tickLenPt - 2.5, t.y + pt * 0.35, pt, 'end'));
          maxLeft = Math.max(maxLeft, st.tickLenPt + 2.5 + measure(String(t.k), pt));
        });
        if (!kept.length) warnings.push(`「${row.name || '某行'}」的裁切范围里没有 Marker 条带，无法标分子量（可在原图上把该行上下边界拉大）`);
      }
      rowBoxes.push({ id: row.id, y, h });
      y += h;
    });
    const H = y;
    grow(-maxLeft, 0, W + maxRight, H);

    /* ---- top stack ---- */
    let yTop = -st.labelGapPt;
    const conds = S.conditions.map((c, r) => Object.assign({ r }, c)).filter(c => P || c.name || c.values.some(v => v));
    for (let k = conds.length - 1; k >= 0; k--) {
      const c = conds[k];
      lanes.forEach(j => {
        const v = c.values[j - 1] || '', hit = P ? `<rect x="${f(X.get(j) - laneW * 0.45)}" y="${f(yTop - pt)}" width="${f(laneW * 0.9)}" height="${f(pt * 1.25)}" fill="transparent"/>` : '';
        if (v || P) els.push(ed(`data-edit="cond" data-r="${c.r}" data-j="${j}"`, hit + text(v || '·', X.get(j), yTop, pt, 'middle', v ? '' : ph)));
      });
      const nm = c.name || (P ? '条件' : '');
      if (nm) { els.push(ed(`data-edit="condname" data-r="${c.r}"`, text(nm, -st.labelGapPt * 2, yTop, pt, 'end', c.name ? '' : ph))); grow(-st.labelGapPt * 2 - measure(nm, pt), yTop - pt, 0, yTop); }
      yTop -= pt * 1.3;
    }
    // placeholders count the lanes shown (hidden ladder lanes skipped), the order bulk paste fills them in
    const names = lanes.map((j, i) => S.lanes[j - 1].name || (P ? String(i + 1) : ''));
    const unitY = yTop;
    let angle = 0;
    if (names.some(t => t)) {
      const maxW = Math.max(...names.map(t => measure(t, pt)));
      angle = st.labelAngle === 'auto' ? (maxW <= laneW * 0.92 ? 0 : laneW >= pt * 1.6 ? 45 : 90) : +st.labelAngle;
      const rad = angle * Math.PI / 180, sn = Math.sin(rad), cs = Math.cos(rad);
      let hMax = pt;
      lanes.forEach((j, i) => {
        const t = names[i]; if (!t) return;
        const tw = measure(t, pt), xc = X.get(j), extra = S.lanes[j - 1].name ? '' : ph;
        if (angle === 0 || !S.lanes[j - 1].name) { els.push(ed(`data-edit="lane" data-j="${j}"`, text(t, xc, yTop, pt, 'middle', extra))); grow(xc - tw / 2, yTop - pt, xc + tw / 2, yTop); }
        else {
          const ox = xc + pt * 0.35 * sn;
          els.push(ed(`data-edit="lane" data-j="${j}"`, `<g transform="translate(${f(ox)},${f(yTop)}) rotate(${-angle})">${text(t, 0, 0, pt, 'start', extra)}</g>`));
          hMax = Math.max(hMax, tw * sn + pt * cs * 0.8);
          grow(ox - pt * sn, yTop - tw * sn - pt * cs, ox + tw * cs + pt * sn * 0.2, yTop);
        }
      });
      yTop -= angle === 0 ? pt * 1.3 : hMax + pt * 0.35;
    }
    // kDa header aligned with the lane-label row
    if (st.showMW && st.unitHeader && maxLeft > 0) { els.push(text('kDa', -st.tickLenPt - 2.5, unitY, pt, 'end')); grow(-st.tickLenPt - 2.5 - measure('kDa', pt), unitY - pt, 0, unitY); }
    // groups
    const groups = S.groups.map((g, k) => Object.assign({ k }, g)).filter(g => lanes.some(j => j >= Math.min(g.from, g.to) && j <= Math.max(g.from, g.to)));
    if (groups.length) {
      const tiers = [], tierOf = [];
      groups.map((g, i) => ({ i, a: Math.min(g.from, g.to), b: Math.max(g.from, g.to) })).sort((p, q) => (p.b - p.a) - (q.b - q.a)).forEach(s => {
        let t = 0; while ((tiers[t] || []).some(o => !(s.b < o.a || s.a > o.b))) t++;
        (tiers[t] = tiers[t] || []).push(s); tierOf[s.i] = t;
      });
      const base = yTop - pt * 0.15, tierH = pt * 1.7;
      groups.forEach((g, i) => {
        const inL = lanes.filter(j => j >= Math.min(g.from, g.to) && j <= Math.max(g.from, g.to));
        const x0 = X.get(inL[0]) - laneW * 0.42, x1 = X.get(inL[inL.length - 1]) + laneW * 0.42, yy = base - tierOf[i] * tierH;
        els.push(line(x0, yy, x1, yy, lw));
        const t = g.text || (P ? '点击输入' : '');
        if (t) { els.push(ed(`data-edit="group" data-k="${g.k}"`, text(t, (x0 + x1) / 2, yy - pt * 0.3, pt, 'middle', g.text ? '' : ph))); grow((x0 + x1) / 2 - measure(t, pt) / 2, yy - pt * 1.3, (x0 + x1) / 2 + measure(t, pt) / 2, yy); }
        grow(x0, yy - pt, x1, yy);
      });
      yTop = base - tiers.length * tierH;
    }
    if (st.panelLetter) { const px = box.x0 - 2, py = box.y0 - 1; els.push(text(st.panelLetter, px, py + 8, 8, 'end', ' font-weight="bold"')); grow(px - measure(st.panelLetter, 8, true), py, px, py + 8); }

    const m = 2, vx = box.x0 - m, vy = box.y0 - m, vw = box.x1 - box.x0 + 2 * m, vh = box.y1 - box.y0 + 2 * m;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(vw / MM)}mm" height="${f(vh / MM)}mm" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" font-family="Arial, Helvetica, sans-serif" fill="#000">` +
      `<rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="#fff"/>` + els.join('') + '</svg>';
    return { svg, w: vw, h: vh, warnings, angle, rowBoxes, laneX: X, laneW };
  }

  G.BRender = { build, measure };
})(window);
