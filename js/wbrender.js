/* Figure layout: state -> SVG (pt units). Figure columns on a common grid across rows, white gaps where
 * neighbouring columns are not neighbouring lanes of one box; each row is drawn from its boxes as
 * straightened crops scaled so the lane spacing matches the grid. Beside the bands, each on the side chosen:
 * kDa ticks, target-band arrows, protein names, then side brackets; lane numbers / conditions / lane labels / groups
 * on top.
 * Text sizes: the figure font, else per kind (lane names, marker labels, protein names) or per item (a group,
 * a condition row, an arrow). Group labels never collide (wrapped, shrunk or moved up a tier, as GelFigure). */
(function (G) {
  'use strict';
  const App = G.BApp, MM = 72 / 25.4;
  const L = G.L || (zh => zh);
  const mctx = document.createElement('canvas').getContext('2d');
  /* *italic* runs. A star opens only before a non-space and closes only after one, never right after its opener
   * (as Markdown): the rest stay stars ("WT*", "siRNA* control", "**", "a * b") instead of vanishing.
   * Private-use characters: LIT a star kept as it is; TOG an italic switch put in by the line breaking */
  const LIT = '\uE000', TOG = '\uE001';
  function litStar(s) {
    s = String(s);
    if (!s.includes('*')) return s;
    const c = s.split(''), sp = ch => ch === undefined || /\s/.test(ch);
    let open = -1;
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== '*') continue;
      if (open >= 0 && i > open + 1 && !sp(c[i - 1])) { open = -1; continue; }
      if (!sp(c[i + 1])) { if (open >= 0) c[open] = LIT; open = i; continue; }
      c[i] = LIT;
    }
    if (open >= 0) c[open] = LIT;
    return c.join('');
  }
  const runs = t => { t = String(t); return (t.includes(TOG) ? t.split(TOG) : litStar(t).split('*')).map((s, i) => ({ t: s.replace(/\uE000/g, '*'), it: i % 2 === 1 })).filter(r => r.t); };
  function measure(text, pt, bold) {
    let w = 0;
    runs(text).forEach(r => { mctx.font = `${r.it ? 'italic ' : ''}${bold ? 'bold ' : ''}${pt * 4}px Arial`; w += mctx.measureText(r.t).width / 4; });
    return w;
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f = v => (Math.round(v * 100) / 100).toString();
  const PH = '#aab3be';                 // grey placeholders in the preview (never exported)
  let usedMin = Infinity;               // the smallest text printed in this build (pre-flight)
  function text(t, x, y, pt, anchor, extra) {
    if (!(extra || '').includes(PH) && String(t).trim()) usedMin = Math.min(usedMin, pt);
    return `<text x="${f(x)}" y="${f(y)}" font-size="${f(pt)}" text-anchor="${anchor}"${extra || ''}>${runs(t).map(r => r.it ? `<tspan font-style="italic">${esc(r.t)}</tspan>` : esc(r.t)).join('')}</text>`;
  }
  // a symbol as it is (in text() a * starts italics)
  const symText = (t, x, y, pt, anchor) => { usedMin = Math.min(usedMin, pt); return `<text x="${f(x)}" y="${f(y)}" font-size="${f(pt)}" text-anchor="${anchor}">${esc(t)}</text>`; };
  const symWidth = (t, pt) => { mctx.font = `${pt * 4}px Arial`; return mctx.measureText(t).width / 4; };
  const line = (x1, y1, x2, y2, lw) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#000" stroke-width="${f(lw)}"/>`;

  // ---- multi-line labels (as GelFigure) ----
  const LEAD = 1.18;   // line spacing, × font size
  // lines whose last baseline is y (they stack upwards from the line they label)
  const textLines = (lines, x, y, pt, anchor, extra) => lines.map((t, i) => text(t, x, y - (lines.length - 1 - i) * pt * LEAD, pt, anchor, extra)).join('');
  /* a label broken into lines no wider than maxW; typed breaks (\n) kept. Chinese / Japanese characters break
   * anywhere, other words after a space, "-" or "/"; *italic* runs closed at a line end and reopened */
  const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';
  // (the italic switches as TOG: a line that ends or starts inside italics is closed / reopened unambiguously)
  const TOKENS = new RegExp(`${TOG}|[${CJK}]|\\s+|[^\\s${TOG}${CJK}]+?[-/]|[^\\s${TOG}${CJK}]+`, 'g');
  function wrapText(t, pt, maxW) {
    const out = [];
    let it = false;
    litStar(t).replace(/\*/g, TOG).split('\n').forEach(par => {
      let startIt = it, cur = '';
      const ln = (s, endIt) => (startIt ? TOG : '') + s.replace(new RegExp(`\\s+(${TOG}*)$`), '$1') + (endIt ? TOG : '');
      for (const tk of par.match(TOKENS) || []) {
        if (tk === TOG) { cur += tk; it = !it; continue; }
        if (cur.split(TOG).join('').trim() && measure(ln(cur + tk, it), pt) > maxW) { out.push(ln(cur, it)); startIt = it; cur = /^\s+$/.test(tk) ? '' : tk; }
        else cur += tk;
      }
      out.push(ln(cur, it));
    });
    return out.filter((l, i, a) => l.split(TOG).join('').trim() || a.length === 1);
  }
  // as few lines as wrapText needs, evened out ("磷酸化 / 蛋白" rather than "磷酸化蛋 / 白")
  function balancedWrap(t, pt, maxW) {
    const first = wrapText(t, pt, maxW);
    if (first.length < 2) return first;
    let lo = maxW * 0.2, hi = maxW, best = first;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2, l = wrapText(t, pt, mid); if (l.length <= first.length) { hi = mid; best = l; } else lo = mid; }
    return best;
  }

  function build(preview) {
    usedMin = Infinity;
    const S = App.S, st = S.style, pt = st.fontPt, lw = st.lineWidthPt, P = !!preview;
    // per-kind sizes (null = the figure font)
    const lp = st.lanePt || pt, mp = st.markerPt || pt, np = st.namePt || pt;
    const ph = ` fill="${PH}"`;
    const ed = (attrs, inner) => (P ? `<g ${attrs} class="ed">${inner}</g>` : inner);
    const C = App.columns(), segs = C.segs, lanes = segs.flat();
    const laneW = st.mmPerLane * MM, gap = 1.6;
    // x of each figure lane centre
    const X = new Map(); let x = 0;
    segs.forEach((sg, si) => { if (si) x += gap; sg.forEach(j => { X.set(j, x + laneW / 2); x += laneW; }); });
    const W = x;
    const els = [], warnings = [], overlaps = [];
    const overlap = msg => { if (!overlaps.includes(msg)) { overlaps.push(msg); warnings.push(msg); } };
    const box = { x0: 0, y0: 0, x1: W, y1: 0 };
    const grow = (a, b, c, d) => { box.x0 = Math.min(box.x0, a); box.y0 = Math.min(box.y0, b); box.x1 = Math.max(box.x1, c); box.y1 = Math.max(box.y1, d); };
    if (!lanes.length) return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', w: 10, h: 10, warnings, overlaps, angle: 0, minPt: pt };

    /* ---- rows ---- */
    // (protein names and the kDa scale each on the left or the right; on the same side the names go outside)
    const mwRight = st.mwSide === 'right', nameLeft = st.nameSide === 'left';
    const rows = C.rows, rowNames = [], ticksOut = [], arrowsOut = [];
    let y = 0, prevBlot = null, maxLeft = 0, maxRight = 0, tickLabW = 0;
    const rowBoxes = [], placedTicks = [{ y: -mp * 0.6 }];   // the kDa header sits just above the first row
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
          const tag = P ? `data-row="${row.id}" data-piece="${cur.sg.piece}" ` : '';
          els.push(`<image ${tag}x="${f(x0)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none" href="${ras.href}" xlink:href="${ras.href}"/>`);
          if (st.border) els.push(`<rect ${tag}x="${f(x0)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="#000" stroke-width="${f(lw)}" pointer-events="none"/>`);
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
      // protein name (placed once the width of the kDa scale is known)
      const nm = row.name || (P ? L('蛋白名', 'Protein name') : '');
      const kdaHint = App.rowKda(row);
      rowNames.push({ row, nm, y: y + h / 2, h, hint: !row.name && P && kdaHint ? `≈${Math.round(kdaHint)} kDa` : '' });
      // target-band arrows of the row, at their band (placed once the widths beside the bands are known)
      (S.arrows || []).forEach((a, k) => {
        if (a.row !== row.id) return;
        const ya = y + (App.arrowV(a) - (row.segs[0].vc - row.above)) * sc, lab = App.arrowLabel(a), wait = !lab && P && a.sym === '◀' && a.auto;
        if (ya >= y - 0.5 && ya <= y + h + 0.5) arrowsOut.push({ a, k, y: ya, label: lab || (wait ? '? kDa' : ''), wait, pt: a.pt || pt });
      });
      // kDa ticks, from the leftmost piece of the row that has marker sizes
      const b = App.blot(row.blot);
      const tsg = st.showMW ? row.segs.find(sg => App.pieceTicks(b, App.piece(b, sg.piece)).length) : null;
      if (tsg) {
        const top = tsg.vc - row.above;
        const ticks = App.pieceTicks(b, App.piece(b, tsg.piece), tsg).filter(t => t.v > top + 1 && t.v < tsg.vc + row.below - 1)
          .map(t => ({ k: t.k, y: y + (t.v - top) * sc })).sort((a, c) => a.y - c.y);
        const kept = [], yBand = y + (row.above + (tsg.b0 + tsg.b1) / 2) * sc;
        // too close to fit both: the tick nearest the band wins (it tells the size best);
        // also keep clear of ticks already printed for the row above
        ticks.slice().sort((a, c) => Math.abs(a.y - yBand) - Math.abs(c.y - yBand))
          .forEach(t => { if (kept.concat(placedTicks).every(o => Math.abs(o.y - t.y) >= mp * 0.95)) kept.push(t); });
        kept.sort((a, c) => a.y - c.y);
        placedTicks.push(...kept);
        kept.forEach(t => {
          if (mwRight) { els.push(line(W + 1, t.y, W + st.tickLenPt + 1, t.y, lw)); els.push(text(String(t.k), W + st.tickLenPt + 2.5, t.y + mp * 0.35, mp, 'start')); }
          else { els.push(line(-st.tickLenPt - 1, t.y, -1, t.y, lw)); els.push(text(String(t.k), -st.tickLenPt - 2.5, t.y + mp * 0.35, mp, 'end')); }
          tickLabW = Math.max(tickLabW, measure(String(t.k), mp));
          ticksOut.push(t);
        });
        // (said once the piece's marks are done — 2 of them — not while they are being set)
        if (!kept.length && App.pieceCal(b, App.piece(b, tsg.piece))) {
          const ls = App.rowPieces(row).map(pc => pc.letter).join('+');
          warnings.push(L(`「${row.name || '膜条 ' + ls + ' 的行'}」的框里没有标过的 Marker 带，旁边不画分子量刻度：在第 4 步标出这一高度附近的 Marker 带，或把框的上下边拉大`,
            `"${row.name || 'row on strip ' + ls}" has no marked marker bands in its box, so no molecular weight ticks are drawn beside it: in step 4, mark marker bands near this height, or make the box taller`));
        }
      }
      rowBoxes.push({ id: row.id, y, h });
      y += h;
    });
    const H = y;
    // beside the bands, outwards: the kDa scale, the target-band arrows, the names (each on its own side)
    const scaleW = ticksOut.length ? st.tickLenPt + 2.5 + tickLabW : 0;
    if (mwRight) maxRight = scaleW; else maxLeft = scaleW;
    const scaleOn = right => (right === mwRight && scaleW ? scaleW + 2 : 0), arrowW = { left: 0, right: 0 };
    arrowsOut.forEach(t => {
      t.right = t.a.side !== 'left';
      t.as = t.pt * 0.8;
      t.w = (t.a.sym === '◀' ? t.as : symWidth(t.a.sym, t.pt)) + (t.label ? 2 + measure(t.label, t.pt) : 0);
      arrowW[t.right ? 'right' : 'left'] = Math.max(arrowW[t.right ? 'right' : 'left'], t.w);
    });
    arrowsOut.forEach(t => {
      // an arrowhead pointing at the band (or a symbol: *, #, †) and its text
      const dir = t.right ? 1 : -1, x0 = (t.right ? W : 0) + dir * (2 + scaleOn(t.right)), anchor = t.right ? 'start' : 'end', apt = t.pt;
      let g;
      if (t.a.sym === '◀') {
        const b = x0 + dir * t.as;
        g = `<path d="M${f(x0)} ${f(t.y)}L${f(b)} ${f(t.y - t.as * 0.55)}L${f(b)} ${f(t.y + t.as * 0.55)}Z"/>` + (t.label ? text(t.label, b + dir * 2, t.y + apt * 0.35, apt, anchor, t.wait ? ph : '') : '');
      } else {
        // (an asterisk sits high in its line: lowered onto the band)
        const sw = symWidth(t.a.sym, apt);
        g = symText(t.a.sym, x0, t.y + apt * (t.a.sym === '*' ? 0.55 : 0.35), apt, anchor) + (t.label ? text(t.label, x0 + dir * (sw + 2), t.y + apt * 0.35, apt, anchor) : '');
      }
      const hit = P ? `<rect x="${f(Math.min(x0, x0 + dir * t.w))}" y="${f(t.y - apt * 0.7)}" width="${f(t.w)}" height="${f(apt * 1.4)}" fill="transparent"/>` : '';
      els.push(ed(`data-edit="arrow" data-k="${t.k}"`, hit + g));
    });
    if (arrowW.right) maxRight = Math.max(maxRight, 2 + scaleOn(true) + arrowW.right);
    if (arrowW.left) maxLeft = Math.max(maxLeft, 2 + scaleOn(false) + arrowW.left);
    const sideW = nameLeft ? arrowW.left : arrowW.right;
    const off = 3 + ((nameLeft ? !mwRight : mwRight) && scaleW ? scaleW + 2 : 0) + (sideW ? sideW + 4 : 0);
    rowNames.forEach((n, i) => {
      const x = nameLeft ? -off : W + off, anchor = nameLeft ? 'end' : 'start';
      if (n.nm) {
        els.push(ed(`data-edit="rowname" data-row="${n.row.id}"`, text(n.nm, x, n.y + np * 0.35, np, anchor, n.row.name ? '' : ph)));
        const w = off + measure(n.nm, np);
        if (nameLeft) maxLeft = Math.max(maxLeft, w); else maxRight = Math.max(maxRight, w);
        // names of neighbouring thin rows run into each other
        const nx = rowNames[i + 1];
        if (nx && nx.nm && n.row.name && nx.row.name && nx.y - n.y < np * 1.05) overlap(L(`「${n.row.name}」和「${nx.row.name}」两行太窄，蛋白名会重叠：减小蛋白名字号，或加大行距、把框上下拉高`,
          `Rows "${n.row.name}" and "${nx.row.name}" are too thin, so their protein names overlap: use a smaller font size for protein names, a larger row gap or taller boxes`));
      }
      if (n.hint) {
        els.push(text(n.hint, x, n.y + np * 1.35, np * 0.8, anchor, ph));
        const w = off + measure(n.hint, np * 0.8);
        if (nameLeft) maxLeft = Math.max(maxLeft, w); else maxRight = Math.max(maxRight, w);
      }
    });
    /* side brackets (as GelFigure's), outermost on their side: over rows (IP / Input) or part of one (a smear).
     * Narrow ones first; one stepped out past another on its side at the same heights. A hidden end row: the
     * bracket ends at the nearest row shown */
    const ord = new Map(S.rows.map((r, i) => [r.id, i])), rbOf = new Map(rowBoxes.map(rb => [rb.id, rb])), brs = [];
    (S.brackets || []).forEach((bk, k) => {
      let a = { id: bk.r0, f: bk.f0 }, c = { id: bk.r1, f: bk.f1 };
      if (!ord.has(a.id) || !ord.has(c.id)) return;
      if (ord.get(a.id) > ord.get(c.id) || (a.id === c.id && a.f > c.f)) [a, c] = [c, a];
      const inside = rowBoxes.filter(rb => ord.get(rb.id) >= ord.get(a.id) && ord.get(rb.id) <= ord.get(c.id));
      if (!inside.length) return;
      const ta = rbOf.get(a.id), tc = rbOf.get(c.id), last = inside[inside.length - 1];
      const y1 = ta ? ta.y + a.f * ta.h : inside[0].y, y2 = tc ? tc.y + c.f * tc.h : last.y + last.h;
      if (y2 - y1 >= 1) brs.push({ bk, k, y1, y2 });
    });
    const base = { left: maxLeft, right: maxRight }, placedBr = { left: [], right: [] };
    brs.sort((p, q) => (p.y2 - p.y1) - (q.y2 - q.y1)).forEach(o => {
      const side = o.bk.side === 'right' ? 'right' : 'left', dir = side === 'right' ? 1 : -1, bp = o.bk.pt || pt, tk = pt * 0.45;
      const txt = o.bk.text || (P ? L('点击输入', 'Click to type') : ''), ls = txt ? String(txt).split('\n') : [];
      const tw = Math.max(0, ...ls.map(t => measure(t, bp))), th = ls.length ? bp + (ls.length - 1) * bp * LEAD : 0;
      const ym = (o.y1 + o.y2) / 2, yy1 = Math.min(o.y1, ym - th / 2), yy2 = Math.max(o.y2, ym + th / 2);
      let off = base[side] + 3;
      // (groups one above the other, IP over Input, share a column: only a real overlap steps out)
      placedBr[side].filter(q => yy1 < q.y2 - 0.5 && yy2 > q.y1 + 0.5).forEach(q => { off = Math.max(off, q.end + 2.5); });
      const xb = (side === 'right' ? W : 0) + dir * (off + tk), tx = xb + dir * 2;
      const path = `M${f(xb - dir * tk)} ${f(o.y1)}L${f(xb)} ${f(o.y1)}L${f(xb)} ${f(o.y2)}L${f(xb - dir * tk)} ${f(o.y2)}`;
      const hit = P ? `<rect x="${f(Math.min(xb - dir * tk, tx + dir * tw) - 1)}" y="${f(yy1 - 1)}" width="${f(tk + 2 + tw + 2)}" height="${f(yy2 - yy1 + 2)}" fill="transparent"/>` : '';
      els.push(ed(`data-edit="bracket" data-k="${o.k}"`, hit + `<path d="${path}" fill="none" stroke="#000" stroke-width="${f(lw)}"/>` +
        (ls.length ? textLines(ls, tx, ym + bp * 0.35 + (ls.length - 1) * bp * LEAD / 2, bp, side === 'right' ? 'start' : 'end', o.bk.text ? '' : ph) : '')));
      const end = off + tk + 2 + tw;
      placedBr[side].push({ y1: yy1, y2: yy2, end });
      if (side === 'right') maxRight = Math.max(maxRight, end); else maxLeft = Math.max(maxLeft, end);
      grow(0, yy1, W, yy2);
    });
    grow(-maxLeft, 0, W + maxRight, H);

    /* ---- top stack (y grows negative): lane numbers, conditions, lane names, groups ---- */
    let yTop = -st.labelGapPt;
    if (st.laneNumbers) {
      lanes.forEach((j, i) => { els.push(text(String(i + 1), X.get(j), yTop, lp, 'middle')); });
      grow(0, yTop - lp, W, yTop);
      yTop -= lp * 1.25;
    }
    const conds = S.conditions.map((c, r) => Object.assign({ r }, c)).filter(c => P || c.name || c.values.some(v => v));
    for (let k = conds.length - 1; k >= 0; k--) {
      const c = conds[k], cp = c.pt || pt;
      lanes.forEach(j => {
        const v = c.values[j - 1] || '', hit = P ? `<rect x="${f(X.get(j) - laneW * 0.45)}" y="${f(yTop - cp)}" width="${f(laneW * 0.9)}" height="${f(cp * 1.25)}" fill="transparent"/>` : '';
        if (v || P) els.push(ed(`data-edit="cond" data-r="${c.r}" data-j="${j}"`, hit + text(v || '·', X.get(j), yTop, cp, 'middle', v ? '' : ph)));
      });
      const nm = c.name || (P ? L('条件', 'Condition') : '');
      if (nm) { els.push(ed(`data-edit="condname" data-r="${c.r}"`, text(nm, -st.labelGapPt * 2, yTop, cp, 'end', c.name ? '' : ph))); grow(-st.labelGapPt * 2 - measure(nm, cp), yTop - cp, 0, yTop); }
      yTop -= cp * 1.3;
    }
    // placeholders count the lanes shown (hidden ladder lanes skipped), the order bulk paste fills them in (with the
    // lane numbers printed: a dot, not the number twice)
    const names = lanes.map((j, i) => S.lanes[j - 1].name || (P ? (st.laneNumbers ? '·' : String(i + 1)) : ''));
    const unitY = yTop;
    let angle = 0;
    if (names.some(t => t)) {
      const maxW = Math.max(...names.map(t => measure(t, lp)));
      angle = st.labelAngle === 'auto' ? (maxW <= laneW * 0.92 ? 0 : laneW >= lp * 1.6 ? 45 : 90) : +st.labelAngle;
      const rad = angle * Math.PI / 180, sn = Math.sin(rad), cs = Math.cos(rad);
      let hMax = lp;
      lanes.forEach((j, i) => {
        const t = names[i]; if (!t) return;
        const tw = measure(t, lp), xc = X.get(j), extra = S.lanes[j - 1].name ? '' : ph;
        if (angle === 0 || !S.lanes[j - 1].name) { els.push(ed(`data-edit="lane" data-j="${j}"`, text(t, xc, yTop, lp, 'middle', extra))); grow(xc - tw / 2, yTop - lp, xc + tw / 2, yTop); }
        else {
          const ox = xc + lp * 0.35 * sn;
          els.push(ed(`data-edit="lane" data-j="${j}"`, `<g transform="translate(${f(ox)},${f(yTop)}) rotate(${-angle})">${text(t, 0, 0, lp, 'start', extra)}</g>`));
          hMax = Math.max(hMax, tw * sn + lp * cs * 0.8);
          grow(ox - lp * sn, yTop - tw * sn - lp * cs, ox + tw * cs + lp * sn * 0.2, yTop);
        }
      });
      const named = lanes.filter(j => S.lanes[j - 1].name).map(j => measure(S.lanes[j - 1].name, lp));
      if (angle !== 0 && named.length && laneW < lp * 1.15) overlap(L('泳道太窄：即使 90° 泳道名也会重叠，请减小泳道名字号或加宽每道', 'Lanes are too narrow: lane names overlap even at 90°; use a smaller font size for lane names or wider lanes'));
      if (angle === 0 && st.labelAngle !== 'auto' && named.length && Math.max(...named) > laneW * 1.02) overlap(L('水平的泳道名互相重叠：改用"自动"或倾斜角度，或减小字号', 'Horizontal lane names overlap: use "Auto" or a tilted angle, or a smaller font size'));
      yTop -= angle === 0 ? lp * 1.3 : hMax + lp * 0.35;
    }
    // kDa header aligned with the lane-label row
    if (st.showMW && st.unitHeader && scaleW > 0) {
      if (mwRight) { els.push(text('kDa', W + st.tickLenPt + 2.5, unitY, mp, 'start')); grow(W, unitY - mp, W + st.tickLenPt + 2.5 + measure('kDa', mp), unitY); }
      else { els.push(text('kDa', -st.tickLenPt - 2.5, unitY, mp, 'end')); grow(-st.tickLenPt - 2.5 - measure('kDa', mp), unitY - mp, 0, unitY); }
    }
    /* groups: a line over the lanes (one piece per run of neighbouring columns: a group line never bridges a white
     * gap) and its text above; a text wider than its line is wrapped (default), shrunk (not below minFontPt) or
     * kept on one line, and stacked by its real width so labels never run into each other */
    const groups = S.groups.map((g, k) => Object.assign({ k }, g)).filter(g => lanes.some(j => j >= Math.min(g.from, g.to) && j <= Math.max(g.from, g.to)));
    if (groups.length) {
      const fit = st.groupFit || 'wrap', minPt = st.minFontPt || 5, half = laneW * 0.42;
      const items = groups.map(g => {
        const a = Math.min(g.from, g.to), b = Math.max(g.from, g.to), parts = [];
        segs.forEach(run => { const ins = run.filter(j => j >= a && j <= b); if (ins.length) parts.push([X.get(ins[0]) - half, X.get(ins[ins.length - 1]) + half]); });
        const x0 = parts[0][0], x1 = parts[parts.length - 1][1], cx = (x0 + x1) / 2;
        const gp = g.pt || pt, txt = g.text || (P ? L('点击输入', 'Click to type') : '');
        let size = gp, ls = txt ? String(txt).split('\n') : [];
        const widest = () => Math.max(0, ...ls.map(t => measure(t, size)));
        const room = Math.max(x1 - x0, gp * 2);
        if (g.text && widest() > room) {
          if (fit === 'wrap') ls = balancedWrap(g.text, size, room);
          else if (fit === 'shrink') size = Math.max(Math.min(minPt, gp), gp * room / widest());
        }
        const tw = widest(), th = ls.length ? size * 0.3 + (ls.length - 1) * size * LEAD + size : pt;
        return { g, parts, x0, x1, cx, size, ls, tw, th, ext0: Math.min(x0, cx - tw / 2), ext1: Math.max(x1, cx + tw / 2) };
      });
      // tiers: a group goes to the lowest tier where neither its line nor its text touches another's (narrow first)
      const tiers = [], pad = pt * 0.25;
      items.map((o, i) => i).sort((p, q) => (items[p].x1 - items[p].x0) - (items[q].x1 - items[q].x0)).forEach(i => {
        const o = items[i]; let t = 0;
        while ((tiers[t] || []).some(q => !(o.ext1 + pad < q.ext0 || o.ext0 - pad > q.ext1))) t++;
        (tiers[t] = tiers[t] || []).push(o); o.tier = t;
      });
      const tierH = tiers.map(ts => Math.max(pt * 1.7, ...ts.map(o => o.th + pt * 0.4)));
      const base = yTop - pt * 0.15, tierY = t => base - tierH.slice(0, t).reduce((s, v) => s + v, 0);
      items.forEach(o => {
        const yy = tierY(o.tier);
        o.parts.forEach(([r0, r1]) => {
          els.push(line(r0, yy, r1, yy, lw));
          if (st.groupTicks) { els.push(line(r0, yy, r0, yy + pt * 0.35, lw)); els.push(line(r1, yy, r1, yy + pt * 0.35, lw)); }
        });
        if (o.ls.length) {
          els.push(ed(`data-edit="group" data-k="${o.g.k}"`, textLines(o.ls, o.cx, yy - o.size * 0.3, o.size, 'middle', o.g.text ? '' : ph)));
          grow(o.cx - o.tw / 2, yy - o.th, o.cx + o.tw / 2, yy);
        }
        grow(o.x0, yy - pt, o.x1, yy);
      });
      yTop = tierY(tiers.length);
    }
    if (st.panelLetter) { const px = box.x0 - 2, py = box.y0 - 1; els.push(text(st.panelLetter, px, py + 8, 8, 'end', ' font-weight="bold"')); grow(px - measure(st.panelLetter, 8, true), py, px, py + 8); }

    const m = 2, vx = box.x0 - m, vy = box.y0 - m, vw = box.x1 - box.x0 + 2 * m, vh = box.y1 - box.y0 + 2 * m;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${f(vw / MM)}mm" height="${f(vh / MM)}mm" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" font-family="Arial, Helvetica, sans-serif" fill="#000">` +
      `<rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="#fff"/>` + els.join('') + '</svg>';
    return { svg, w: vw, h: vh, warnings, overlaps, angle, rowBoxes, laneX: X, laneW, figW: W, minPt: usedMin === Infinity ? pt : usedMin };
  }

  G.BRender = { build, measure, wrapText };
})(window);
