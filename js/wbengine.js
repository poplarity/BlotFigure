/* Western blot analysis engine. Works on decoded images {w, h, data: Float32Array 0..1}.
 *
 * Pipeline for one membrane ("session" = its chemiluminescence exposures + white-light marker photo):
 *   classify images -> signal & clip level per exposure -> relative exposure factors
 *   -> strips (membrane pieces) from the marker photo -> band rows (one per protein) in each piece's frame
 *   -> lanes of each piece on their own (pieces are often not put back in place) -> ladder calibration
 *   -> rows joined across pieces side by side -> first guess of figure columns -> best exposure per row.
 * Afterwards the editor's boxes (one per row and piece) are read on their own: detectBoxLanes, bandInBox.
 * Coordinates: a piece has a rotated frame centred on it: u along the piece (lanes), v across it (down).
 */
(function (G) {
  'use strict';
  const E = G.Engine;
  const { clamp, percentiles, gaussSmooth, findPeaks, slide } = E;

  /* ---------- small image helpers ---------- */
  function down(img, f) {
    if (f <= 1) return { w: img.w, h: img.h, data: img.data, f: 1 };
    const w = Math.floor(img.w / f), h = Math.floor(img.h / f), d = new Float32Array(w * h), n = f * f;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) { const r = (y * f + dy) * img.w + x * f; for (let dx = 0; dx < f; dx++) s += img.data[r + dx]; }
      d[y * w + x] = s / n;
    }
    return { w, h, data: d, f };
  }
  function lineOp(data, w, h, r, isMax, alongX) {
    const out = new Float32Array(w * h);
    if (alongX) {
      for (let y = 0; y < h; y++) out.set(slide(data.subarray(y * w, y * w + w), r, isMax), y * w);
    } else {
      const col = new Float32Array(h);
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) col[y] = data[y * w + x];
        const s = slide(col, r, isMax);
        for (let y = 0; y < h; y++) out[y * w + x] = s[y];
      }
    }
    return out;
  }
  // square-element morphological opening / closing (separable)
  function open2d(data, w, h, r) {
    let t = lineOp(data, w, h, r, false, true); t = lineOp(t, w, h, r, false, false);
    t = lineOp(t, w, h, r, true, true); return lineOp(t, w, h, r, true, false);
  }
  function close2d(data, w, h, r) {
    let t = lineOp(data, w, h, r, true, true); t = lineOp(t, w, h, r, true, false);
    t = lineOp(t, w, h, r, false, true); return lineOp(t, w, h, r, false, false);
  }
  function tophat(data, w, h, r) {
    const o = open2d(data, w, h, r), out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, data[i] - o[i]);
    return out;
  }
  function median3(data, w, h) {
    const out = new Float32Array(w * h), b = new Float32Array(9);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) b[k++] = data[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
      b.sort(); out[y * w + x] = b[4];
    }
    return out;
  }
  function blur2d(data, w, h, s) {
    const t = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) t.set(gaussSmooth(data.subarray(y * w, y * w + w), s), y * w);
    const col = new Float32Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) col[y] = t[y * w + x];
      const g = gaussSmooth(col, s);
      for (let y = 0; y < h; y++) out[y * w + x] = g[y];
    }
    return out;
  }
  function otsu(data, step) {
    const H = new Float64Array(256); let n = 0;
    for (let i = 0; i < data.length; i += step || 1) { H[clamp((data[i] * 255) | 0, 0, 255)]++; n++; }
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * H[i];
    let sB = 0, wB = 0, best = 0, thr = 0.5;
    for (let t = 0; t < 256; t++) {
      wB += H[t]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sB += t * H[t];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
      if (v > best) { best = v; thr = (t + 0.5) / 255; }
    }
    return thr;
  }
  function mad(data, step) {
    const s = []; for (let i = 0; i < data.length; i += step || 1) s.push(data[i]);
    s.sort((a, b) => a - b);
    const med = s[s.length >> 1], dev = s.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    return { med, sigma: 1.4826 * dev[dev.length >> 1] };
  }
  function components(mask, w, h) {
    const lab = new Int32Array(w * h), comps = [], stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i]) continue;
      const c = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: w, x1: 0, y0: h, y1: 0, id: comps.length + 1 };
      lab[i] = c.id; stack.push(i);
      while (stack.length) {
        const j = stack.pop(), x = j % w, y = (j / w) | 0;
        c.n++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
        for (const k of nb) if (k >= 0 && mask[k] && !lab[k]) { lab[k] = c.id; stack.push(k); }
      }
      comps.push(c);
    }
    return { lab, comps };
  }
  function bilinear(img, x, y) {
    if (x < 0 || y < 0 || x > img.w - 1 || y > img.h - 1) return NaN;
    const x0 = Math.min(img.w - 2, x | 0), y0 = Math.min(img.h - 2, y | 0), fx = x - x0, fy = y - y0, i = y0 * img.w + x0, d = img.data;
    return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + img.w] * (1 - fx) + d[i + img.w + 1] * fx) * fy;
  }

  /* ---------- rotated frames ---------- */
  const frame = (ox, oy, deg) => { const a = deg * Math.PI / 180; return { ox, oy, c: Math.cos(a), s: Math.sin(a) }; };
  const toImg = (F, u, v) => [F.ox + u * F.c - v * F.s, F.oy + u * F.s + v * F.c];
  const toFrame = (F, x, y) => { const dx = x - F.ox, dy = y - F.oy; return [dx * F.c + dy * F.s, -dx * F.s + dy * F.c]; };
  // resample a rotated window (u0..u1, v0..v1) at `step` image px per output px
  function sampleWindow(img, F, u0, u1, v0, v1, step) {
    step = step || 1;
    const w = Math.max(1, Math.round((u1 - u0) / step)), h = Math.max(1, Math.round((v1 - v0) / step)), d = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const [x, y] = toImg(F, u0 + (i + 0.5) * step, v0 + (j + 0.5) * step);
      const val = bilinear(img, x, y);
      d[j * w + i] = isNaN(val) ? 0 : val;
    }
    return { w, h, data: d, u0, v0, step };
  }

  /* ---------- per-image properties ---------- */
  function exposureFromName(name) {
    const m = String(name).match(/(\d+(?:\.\d+)?)\s*(ms|msec|s|sec|secs|seconds|min|mins|m)(?![a-z])/i);
    if (!m) return null;
    const v = parseFloat(m[1]), u = m[2].toLowerCase();
    return u.startsWith('ms') ? v / 1000 : u.startsWith('m') ? v * 60 : v;
  }
  const isMarkerName = n => /marker|white|light|colou?r|ladder|visible|epi|trans|rgb|bright|白光|marker/i.test(n);
  const isChemiName = n => /chemi|ecl|lumi|signal|exposure|曝光/i.test(n);

  /* classify: 'marker' (white-light photo of the membrane) or 'chemi'. RGB photos are markers.
   * A marker photo has large bright membrane areas on a darker tray: strong large-scale structure. */
  function classify(img, meta) {
    const name = (meta && meta.name) || '';
    if (isMarkerName(name) && !isChemiName(name)) return 'marker';
    if (isChemiName(name)) return 'chemi';
    // A white-light photo shows the whole membrane: a large mid/bright area on a dark tray.
    // Chemi images are mostly background: nearly all dark (raw) or nearly all white (inverted export,
    // as iBright does), even for long exposures with a glowing membrane.
    const sm = down(img, Math.max(1, Math.ceil(Math.max(img.w, img.h) / 300)));
    let bright = 0, dark = 0;
    for (let i = 0; i < sm.data.length; i++) { const v = sm.data[i]; if (v > 0.5) bright++; if (v < 0.15) dark++; }
    const fb = bright / sm.data.length, fd = dark / sm.data.length;
    return fb > 0.12 && fb < 0.8 && fd > 0.1 ? 'marker' : 'chemi';
  }

  /* signal image (bands = high values) and clip level for a chemi exposure */
  function chemiSignal(img) {
    const bright = E.detectBright(img);
    const n = img.data.length, sig = bright ? img.data : new Float32Array(n);
    if (!bright) for (let i = 0; i < n; i++) sig[i] = 1 - img.data[i];
    let mx = 0; for (let i = 0; i < n; i++) if (sig[i] > mx) mx = sig[i];
    let cnt = 0; for (let i = 0; i < n; i++) if (sig[i] >= mx - 1e-6) cnt++;
    // clipped if many pixels sit exactly at the maximum (a hot pixel or two does not count)
    const clipped = cnt >= Math.max(6, n * 2e-6) && mx > 0.2;
    return { sig, bright, clip: clipped ? mx : Infinity, max: mx };
  }

  /* ---------- session grouping ---------- */
  function stem(name) {
    return String(name).toLowerCase().replace(/\.[a-z]+$/, '').replace(/(\d+(\.\d+)?)\s*(ms|msec|s|sec|secs|seconds|min|mins|m)(?![a-z])/g, '')
      .replace(/chemi|ecl|lumi|marker|white|light|colou?r|ladder|visible|rgb|exposure|曝光|白光|[_\-\s]+|\d{1,2}$/g, '');
  }
  function ncc(a, b) {
    let ma = 0, mb = 0; const n = a.length;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
    return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
  }
  /* Group pictures into membranes.
   * items: [{id, name, w, h, kind, thumb}] — thumb = sqrt-tophat signal (chemi) or membrane mask (marker).
   * 1. Marker photos whose membrane masks overlap (IoU) show the same membrane. Imagers such as iBright
   *    take one white-light photo per capture, so a series of 7 exposures comes with 7 marker photos.
   * 2. Each chemi image joins the membrane its signal falls on.
   * 3. Chemi images with no matching marker are grouped among themselves by correlation. */
  function groupSessions(items) {
    const chemi = items.filter(i => i.kind === 'chemi'), markers = items.filter(i => i.kind === 'marker');
    const same = (a, b) => a.w === b.w && a.h === b.h && a.thumb.w === b.thumb.w;
    const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { const x = a[k] > 0.5, y = b[k] > 0.5; if (x && y) i++; if (x || y) u++; } return u ? i / u : 0; };
    const groups = [];
    markers.forEach(m => {
      const g = groups.find(g => same(g.markers[0], m) && (iou(g.markers[0].thumb.data, m.thumb.data) > 0.75 || (stem(m.name) && stem(m.name) === stem(g.markers[0].name))));
      if (g) g.markers.push(m); else groups.push({ chemi: [], markers: [m] });
    });
    const loose = [];
    chemi.forEach(c => {
      let best = null, bs = 0;
      groups.forEach(g => {
        const m = g.markers[0];
        if (!same(m, c)) return;
        // only clear signal counts: in a very short exposure the noise floor would otherwise dominate
        if (c._thr == null) { const z = mad(c.thumb.data, 1); c._thr = z.med + 4 * z.sigma; }
        let on = 0, tot = 0;
        for (let i = 0; i < c.thumb.data.length; i++) { const v = c.thumb.data[i] - c._thr; if (v <= 0) continue; tot += v; if (m.thumb.data[i] > 0.5) on += v; }
        let s = tot ? on / tot : 0;
        if (stem(c.name) && stem(c.name) === stem(m.name)) s += 0.3;
        if (s > bs) { bs = s; best = g; }
      });
      if (best && bs > 0.55) best.chemi.push(c); else loose.push(c);
    });
    // loose chemi: union by correlation (low bar: short exposures show few bands)
    const parent = new Map(loose.map(c => [c.id, c.id]));
    const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    for (let i = 0; i < loose.length; i++) for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i], b = loose[j];
      if (!same(a, b)) continue;
      const s = ncc(a.thumb.data, b.thumb.data) + (stem(a.name) && stem(a.name) === stem(b.name) ? 0.3 : 0);
      if (s > 0.3) parent.set(find(a.id), find(b.id));
    }
    const lg = new Map();
    loose.forEach(c => { const r = find(c.id); if (!lg.has(r)) lg.set(r, { chemi: [], markers: [] }); lg.get(r).chemi.push(c); });
    return groups.concat([...lg.values()]);
  }

  /* relative exposure factors (longest = 1) from pixels that are valid in both images */
  function exposureFactors(sigs) {
    if (sigs.length < 2) return sigs.map(() => 1);
    const totals = sigs.map(s => { let t = 0; for (let i = 0; i < s.th.length; i += 7) t += s.th[i]; return t; });
    const ref = totals.indexOf(Math.max(...totals));
    return sigs.map((s, k) => {
      if (k === ref) return 1;
      const r = sigs[ref], ratios = [];
      for (let i = 0; i < s.th.length; i++) {
        const a = s.th[i], b = r.th[i];
        if (a > s.noise * 8 && b > r.noise * 8 && s.raw[i] < 0.8 * s.clipDs && r.raw[i] < 0.8 * r.clipDs) ratios.push(a / b);
      }
      if (ratios.length < 30) return totals[k] / totals[ref];
      ratios.sort((x, y) => x - y);
      return ratios[ratios.length >> 1];
    });
  }

  /* ---------- strips from the marker photo ---------- */
  function findStrips(marker, fIn) {
    // pieces cut from one membrane are often put back with gaps of only a few pixels: work near full
    // resolution, split thin bridges by erosion, then grow the seeds back over the membrane mask
    const f = Math.max(1, Math.ceil(Math.max(marker.w, marker.h) / 1200));
    const sm = down(marker, f), { w, h } = sm;
    const thr = otsu(sm.data, 1);
    // the gap between pieces is dark but not as dark as the tray: use a threshold between tray and membrane
    const [pm] = percentiles(sm.data.filter((v, i) => v > thr && (i % 3 === 0)), [50], 1);
    const thr2 = thr + (pm - thr) * 0.35;
    let mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = sm.data[i] > thr2 ? 1 : 0;
    const m2 = open2d(Float32Array.from(mask), w, h, 1);
    for (let i = 0; i < w * h; i++) mask[i] = m2[i] > 0.5 ? 1 : 0;
    // seams between pieces that touch: narrow dark valleys (horizontal or vertical) inside the mask.
    // Prestained ladder bands are dark too, but only lane-wide, so they never cut a piece in two.
    {
      // A seam is a long straight line where the membrane is missing or slightly darker. Score each row
      // inside 64-px chunks (tolerates a tilt) by the share of pixels that are a gap or a shallow dark
      // valley while membrane lies just above and below; cut rows scoring high. Same for columns.
      const d = sm.data, R = 4, CH = 64, cut = new Uint8Array(w * h);
      const isSeamPx = (i, step) => {
        if (!mask[i - R * step] || !mask[i + R * step]) return -1;            // not between membrane
        if (!mask[i]) return 1;
        let a = 0, b = 0;
        for (let k = 2; k <= R; k++) { a = Math.max(a, d[i - k * step]); b = Math.max(b, d[i + k * step]); }
        return d[i] < 0.93 * Math.min(a, b) ? 1 : 0;
      };
      const scan = (horizontal) => {
        const L1 = horizontal ? h : w, L2 = horizontal ? w : h, step = horizontal ? w : 1;
        for (let c0 = 0; c0 < L2; c0 += CH) {
          const c1 = Math.min(L2, c0 + CH), sc = new Float32Array(L1);
          for (let t = R; t < L1 - R; t++) {
            let hit = 0, n = 0;
            for (let s = c0; s < c1; s++) {
              const i = horizontal ? t * w + s : s * w + t, r = isSeamPx(i, step);
              if (r < 0) continue; n++; hit += r;
            }
            sc[t] = n > (c1 - c0) * 0.6 ? hit / n : 0;
          }
          for (let t = R + 1; t < L1 - R - 1; t++) {
            if (sc[t] < 0.6 || sc[t] < sc[t - 1] || sc[t] < sc[t + 1]) continue;
            // a ladder band is lane-wide, not chunk-wide: the share above already excludes it
            dets.push({ s: (c0 + c1) / 2, t, horizontal });
          }
        }
      };
      const dets = [];
      // chain detections from neighbouring chunks into lines, fit t = a + b*s, then cut along the
      // whole line while membrane continues (touching pieces leave no gap at all in places)
      const cutLines = (horizontal) => {
        const ds = dets.filter(q2 => q2.horizontal === horizontal).sort((a, b) => a.s - b.s);
        const used = new Set(), L2 = horizontal ? w : h, L1 = horizontal ? h : w;
        const memb = (s, t) => { s = Math.round(s); t = Math.round(t); if (s < 0 || t < R || s >= L2 || t >= L1 - R) return false; const i = horizontal ? t * w + s : s * w + t, st = horizontal ? w : 1; return mask[i - R * st] && mask[i + R * st]; };
        ds.forEach((d0, k) => {
          if (used.has(k)) return;
          const chain = [d0]; used.add(k);
          ds.forEach((d1, j) => { if (!used.has(j) && d1.s > chain[chain.length - 1].s && d1.s - chain[chain.length - 1].s <= CH * 1.5 && Math.abs(d1.t - chain[chain.length - 1].t) <= 3) { chain.push(d1); used.add(j); } });
          if (chain.length < 2) return;
          let sw = 0, ss = 0, st2 = 0, sss = 0, sst = 0;
          chain.forEach(q2 => { sw++; ss += q2.s; st2 += q2.t; sss += q2.s * q2.s; sst += q2.s * q2.t; });
          const den = sw * sss - ss * ss, b = den ? (sw * sst - ss * st2) / den : 0, a = (st2 - b * ss) / sw;
          const lineAt = s => a + b * s;
          const mark = s => { for (let dt = -1; dt <= 1; dt++) { const t = Math.round(lineAt(s)) + dt; if (t < 0 || t >= L1 || s < 0 || s >= L2) continue; cut[horizontal ? t * w + s : s * w + t] = 1; } };
          const sA = Math.round(chain[0].s), sB = Math.round(chain[chain.length - 1].s);
          for (let s = sA; s <= sB; s++) mark(s);
          for (const dir of [-1, 1]) {
            let miss = 0;
            for (let s = dir < 0 ? sA - 1 : sB + 1; s >= 0 && s < L2 && miss < 6; s += dir) { if (memb(s, lineAt(s))) { miss = 0; mark(s); } else miss++; }
          }
        });
      };
      scan(true); scan(false);
      cutLines(true); cutLines(false);
      for (let i = 0; i < w * h; i++) if (cut[i]) mask[i] = 0;
      if (findStrips.debug) findStrips.debug = { w, h, cut, mask0: Uint8Array.from(mask), thr, thr2, pm };
    }
    // erode (5x5) -> seeds
    const er = lineOp(lineOp(Float32Array.from(mask), w, h, 3, false, true), w, h, 3, false, false);
    const seedMask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) seedMask[i] = er[i] > 0.5 ? 1 : 0;
    const seeds = components(seedMask, w, h);
    const keep = new Set(seeds.comps.filter(c => c.n > w * h * 0.006).map(c => c.id));
    // multi-source BFS: give every membrane pixel the label of the nearest seed
    const lab = new Int32Array(w * h), queue = new Int32Array(w * h);
    let qh = 0, qt = 0;
    for (let i = 0; i < w * h; i++) if (keep.has(seeds.lab[i])) { lab[i] = seeds.lab[i]; queue[qt++] = i; }
    while (qh < qt) {
      const j = queue[qh++], x = j % w;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w];
      for (const k of nb) if (k >= 0 && k < w * h && mask[k] && !lab[k]) { lab[k] = lab[j]; queue[qt++] = k; }
    }
    const byLab = new Map();
    for (let i = 0; i < w * h; i++) {
      const L = lab[i]; if (!L) continue;
      let c = byLab.get(L);
      if (!c) { c = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: w, x1: 0, y0: h, y1: 0, id: L }; byLab.set(L, c); }
      const x = i % w, y = (i / w) | 0;
      c.n++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
    }
    if (findStrips.debug) Object.assign(findStrips.debug, { lab: Int32Array.from(lab), seedMask });
    mask = new Uint8Array(w * h);
    const strips = [];
    [...byLab.values()].filter(c => c.n > w * h * 0.008).forEach(c => {
      for (let i = 0; i < w * h; i++) mask[i] = lab[i] === c.id ? 1 : 0;
      const mx = c.sx / c.n, my = c.sy / c.n;
      // angle = the rotation (within ±15°) giving the smallest bounding box of the piece's outline;
      // moments are unreliable for near-square pieces or pieces with a cut corner
      const edge = [];
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        const i = y * w + x;
        if (mask[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w])) edge.push([x, y]);
      }
      const stepE = Math.max(1, Math.floor(edge.length / 4000)), pts = edge.filter((p, i) => i % stepE === 0);
      const areaAt = a => {
        const r = a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), us2 = [], vs2 = [];
        pts.forEach(([x, y]) => { us2.push(x * cs + y * sn); vs2.push(-x * sn + y * cs); });
        us2.sort((p, q2) => p - q2); vs2.sort((p, q2) => p - q2);
        const qq = (arr, p) => arr[Math.round(p * (arr.length - 1))];
        return (qq(us2, 0.995) - qq(us2, 0.005)) * (qq(vs2, 0.995) - qq(vs2, 0.005));
      };
      let ang = 0, best = Infinity;
      for (let a = -15; a <= 15.001; a += 0.5) { const s = areaAt(a); if (s < best) { best = s; ang = a; } }
      const a0 = ang;
      for (let a = a0 - 0.5; a <= a0 + 0.501; a += 0.05) { const s = areaAt(a); if (s < best) { best = s; ang = a; } }
      // extents along the strip axes (robust percentiles over the component pixels)
      const F = frame(mx, my, ang), us = [], vs = [];
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
        if (!mask[y * w + x]) continue;
        const [u, v] = toFrame(F, x, y); us.push(u); vs.push(v);
      }
      us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
      const q = (a, p) => a[clamp(Math.round(p * (a.length - 1)), 0, a.length - 1)];
      const u0 = q(us, 0.003), u1 = q(us, 0.997), v0 = q(vs, 0.003), v1 = q(vs, 0.997);
      // recentre on the extents
      const [cx, cy] = toImg(F, (u0 + u1) / 2, (v0 + v1) / 2);
      strips.push({ cx: cx * f, cy: cy * f, angle: Math.round(ang * 100) / 100, w: (u1 - u0) * f, h: (v1 - v0) * f });
    });
    strips.sort((a, b) => a.cy - b.cy);
    return strips;
  }
  const stripFrame = s => frame(s.cx, s.cy, s.angle);
  function inStrip(s, x, y, pad) {
    const [u, v] = toFrame(stripFrame(s), x, y);
    return Math.abs(u) <= s.w / 2 + (pad || 0) && Math.abs(v) <= s.h / 2 + (pad || 0);
  }

  /* ---------- lattice of lane positions ---------- */
  function pitchFromGaps(gaps, lo, hi) {
    const cands = new Set();
    gaps.forEach(g => [1, 2, 3].forEach(k => { const p = g / k; if (p >= lo && p <= hi) cands.add(Math.round(p * 2) / 2); }));
    let pitch = 0, bestS = -Infinity;
    for (const p of cands) {
      let s = 0;
      for (const g of gaps) {
        const k = Math.max(1, Math.round(g / p)), err = Math.abs(g - k * p) / p;
        s += Math.exp(-((err / 0.15) ** 2)) - 0.45 * (k - 1);
        if (g < 0.6 * p) s -= 1;
      }
      if (s > bestS + 1e-9 || (Math.abs(s - bestS) < 1e-9 && p > pitch)) { bestS = s; pitch = p; }
    }
    // least-squares refinement over all gaps that fit
    let num = 0, den = 0;
    gaps.forEach(g => { const k = Math.round(g / pitch); if (k >= 1 && Math.abs(g - k * pitch) < 0.2 * pitch) { num += g * k; den += k * k; } });
    return den ? num / den : pitch;
  }
  // origin u0 such that positions ≈ u0 + k * pitch (circular mean of phases)
  function latticeOrigin(us, pitch, weights) {
    let sx = 0, sy = 0;
    us.forEach((u, i) => { const a = 2 * Math.PI * u / pitch, w = weights ? weights[i] : 1; sx += w * Math.cos(a); sy += w * Math.sin(a); });
    const ph = Math.atan2(sy, sx) / (2 * Math.PI) * pitch;
    return ph;
  }

  /* Lanes of one piece on its own (pieces are not assumed to sit where they were on the membrane):
   * slot m = 0..n-1 at u = u0 + m*pitch in the piece frame (working units), from the lane peaks of the
   * piece's rows and its ladder lanes. roles[m]: 'sample' | 'ladder' | 'skip' (an empty slot between lanes). */
  // lane candidates of one piece: lane peaks of its rows clustered (a lane needs a band in two rows, or
  // one clear band), plus its ladder lanes (weighted more: they are exact)
  function pieceAnchors(rows, ladUs, P) {
    const pts = [];
    rows.forEach((r, k) => r.peaks.forEach((u, i) => pts.push({ u, w: r.peakMass[i], row: k })));
    pts.sort((a, b) => a.u - b.u);
    const cl = [];
    pts.forEach(p => {
      const c = cl[cl.length - 1];
      if (c && p.u - c.u < P * 0.35) { c.items.push(p); c.w += p.w; c.u = c.items.reduce((s, q2) => s + q2.u * q2.w, 0) / c.w; }
      else cl.push({ u: p.u, w: p.w, items: [p] });
    });
    const wmax = Math.max(1e-9, ...cl.map(c => c.w));
    const lanes = cl.filter(c => new Set(c.items.map(q2 => q2.row)).size >= 2 || c.w > wmax * 0.15).map(c => ({ u: c.u, w: 0.5 + c.w / wmax }));
    return { lanes, anchors: lanes.concat(ladUs.map(u => ({ u, w: 2 }))) };
  }
  /* One lane spacing for all pieces of one picture (same membrane, same scale): the spacing near the
   * estimate P at which every piece's lane candidates sit best on a lattice of their own phase. */
  function jointPitch(sets, P) {
    let best = P, bs = -1;
    for (let p = P * 0.88; p <= P * 1.14; p += P * 0.002) {
      let s = 0;
      sets.forEach(A => {
        let x = 0, y = 0;
        A.forEach(a => { const t = 2 * Math.PI * a.u / p; x += a.w * Math.cos(t); y += a.w * Math.sin(t); });
        s += Math.hypot(x, y);
      });
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  }
  function pieceLattice(rg, cand, ladUs, p) {
    const { lanes, anchors } = cand;
    if (!anchors.length) return null;
    let a = latticeOrigin(anchors.map(x => x.u), p, anchors.map(x => x.w));
    // a piece spanning many lanes may differ slightly (gel smile, uneven wells): least squares u = a + p*m
    const ms0 = anchors.map(x => Math.round((x.u - a) / p)), span = Math.max(...ms0) - Math.min(...ms0);
    if (new Set(ms0).size >= 4 && span >= 4) {
      let sw = 0, sm = 0, su = 0;
      anchors.forEach((x, i) => { sw += x.w; sm += x.w * ms0[i]; su += x.w * x.u; });
      const mm = sm / sw, um = su / sw;
      let num = 0, den = 0;
      anchors.forEach((x, i) => { num += x.w * (ms0[i] - mm) * (x.u - um); den += x.w * (ms0[i] - mm) ** 2; });
      const b = den ? num / den : p;
      if (Math.abs(b / p - 1) < 0.03) { p = b; a = um - b * mm; }
    }
    const mOf = u => Math.round((u - a) / p);
    let lo = Infinity, hi = -Infinity;
    anchors.forEach(x => { const m = mOf(x.u); lo = Math.min(lo, m); hi = Math.max(hi, m); });
    const roles = [];
    for (let m = lo; m <= hi; m++) roles.push('skip');
    lanes.forEach(x => { roles[mOf(x.u) - lo] = 'sample'; });
    ladUs.forEach(u => { roles[mOf(u) - lo] = 'ladder'; });       // a ladder lane stays a ladder lane
    let u0 = a + lo * p;
    // a lane cut through at the end of the piece is not a lane of the figure (ladders stay, for the marker)
    const partial = m => Math.abs(u0 + m * p) > rg.w / 2 - p * 0.3;
    while (roles.length && (roles[0] === 'skip' || (roles[0] === 'sample' && partial(0)))) { roles.shift(); u0 += p; }
    while (roles.length && (roles[roles.length - 1] === 'skip' || (roles[roles.length - 1] === 'sample' && partial(roles.length - 1)))) roles.pop();
    // an empty slot between lanes is a sample with no band in any of this piece's rows (wells are
    // contiguous): leaving it out would shift every later lane by one column
    for (let m = 0; m < roles.length; m++) if (roles[m] === 'skip') roles[m] = 'sample';
    return roles.length ? { u0, pitch: p, roles } : null;
  }

  const pieceBox = s => { const a = Math.abs(s.angle) * Math.PI / 180, hw = (s.w * Math.cos(a) + s.h * Math.sin(a)) / 2, hh = (s.h * Math.cos(a) + s.w * Math.sin(a)) / 2; return [s.cx - hw, s.cy - hh, s.cx + hw, s.cy + hh]; };
  const boxesNear = (p, q, tol) => Math.max(p[0] - q[2], q[0] - p[2], p[1] - q[3], q[1] - p[3]) < tol;

  /* First guess of the figure column of every piece's lanes (pieces full resolution, rows with segs).
   * 1. Pieces that touch, share the lane spacing, sit on one lane grid and have ladder lanes where the
   *    others have them were put back in place: their lanes line up by position.
   * 2. Other pieces that carry the same protein band side by side continue the columns of their neighbour.
   * 3. Anything else starts at column 1 (a strip cut across the membrane holds every lane).
   * Sets pc.col0 (figure column of the first sample slot); empty slots of in-place pieces that line up with
   * a lane of another piece become sample slots. The user corrects the rest piece by piece. */
  function assignColumns(pieces, rows) {
    const nS = pc => pc.roles.filter(r => r === 'sample').length;
    const firstS = pc => pc.roles.indexOf('sample');
    const slotX = (pc, m) => toImg(frame(pc.cx, pc.cy, pc.angle), pc.u0 + m * pc.pitch, 0)[0];
    pieces.forEach(pc => { pc.col0 = 1; });
    const order = pieces.map((pc, i) => i).filter(i => nS(pieces[i])).sort((a, b) => nS(pieces[b]) - nS(pieces[a]) || pieces[b].w - pieces[a].w);
    if (!order.length) return;
    const R = pieces[order[0]], pxR = R.pitch * Math.cos(R.angle * Math.PI / 180), x0 = slotX(R, 0);
    const grid = new Map([[order[0], R.roles.map((_, m) => m)]]);
    const occ = new Map();                      // grid index -> 'L' (ladder) | 'S' (lane) | 'E' (empty)
    const mark = (role, g) => { const o = occ.get(g), k = role === 'ladder' ? 'L' : role === 'sample' ? 'S' : 'E'; if (!o || o === 'E') occ.set(g, k); };
    R.roles.forEach((r, m) => mark(r, m));
    order.slice(1).forEach(i => {
      const pc = pieces[i], px = pc.pitch * Math.cos(pc.angle * Math.PI / 180);
      if (Math.abs(px / pxR - 1) > 0.06) return;
      const t = pc.roles.map((_, m) => (slotX(pc, m) - x0) / pxR);
      const res = t.map(x => Math.abs(x - Math.round(x))).sort((a, b) => a - b);
      if (res[res.length >> 1] > 0.2) return;
      const g = t.map(Math.round);
      if (pc.roles.some((r, m) => { const o = occ.get(g[m]); return (o === 'L' && r === 'sample') || (o === 'S' && r === 'ladder'); })) return;
      if (![...grid.keys()].some(k => boxesNear(pieceBox(pieces[k]), pieceBox(pc), 40))) return;
      // as many lanes as the reference but offset by whole lanes: moved, not put back
      if (nS(pc) >= nS(R) && g[firstS(pc)] !== firstS(R)) return;
      grid.set(i, g);
      pc.roles.forEach((r, m) => mark(r, g[m]));
    });
    const lanesG = [...occ.keys()].filter(k => occ.get(k) === 'S').sort((a, b) => a - b), colOfG = new Map(lanesG.map((k, c) => [k, c + 1]));
    grid.forEach((g, i) => {
      const pc = pieces[i];
      pc.roles = pc.roles.map((r, m) => (r === 'skip' ? (occ.get(g[m]) === 'S' ? 'sample' : occ.get(g[m]) === 'L' ? 'ladder' : r) : r));
      pc.col0 = colOfG.get(g[firstS(pc)]) || 1;
    });
    const done = new Set(grid.keys());
    const shares = (i, k) => rows.some(r => r.segs.some(s => s.region === i) && r.segs.some(s => s.region === k));
    order.filter(i => !done.has(i)).sort((a, b) => pieces[a].cx - pieces[b].cx).forEach(i => {
      const pc = pieces[i], mate = [...done].filter(k => shares(i, k)).sort((a, b) => Math.abs(pieces[a].cx - pc.cx) - Math.abs(pieces[b].cx - pc.cx))[0];
      if (mate != null) { const q2 = pieces[mate]; pc.col0 = q2.cx < pc.cx ? q2.col0 + nS(q2) : Math.max(1, q2.col0 - nS(pc)); }
      done.add(i);
    });
    // an end lane can be empty in every row of a piece (no protein shows a band there): extend a piece over
    // lattice slots lying fully on it when other pieces have lanes in those columns
    const cols = new Set();
    pieces.forEach(pc => { let c = pc.col0; pc.roles.forEach(r => { if (r === 'sample') cols.add(c++); }); });
    pieces.forEach((pc, i) => {
      if (!nS(pc)) return;
      const inside = m => Math.abs(pc.u0 + m * pc.pitch) <= pc.w / 2 - pc.pitch * 0.45;
      let last = pc.col0 + nS(pc) - 1;
      while (cols.has(last + 1) && inside(pc.roles.length)) { pc.roles.push('sample'); last++; }
      while (pc.col0 > 1 && cols.has(pc.col0 - 1) && inside(-1)) {
        pc.roles.unshift('sample'); pc.u0 -= pc.pitch; pc.col0--;
        rows.forEach(r => r.segs.forEach(sg => { if (sg.region === i) sg.ms = sg.ms.map(m => m + 1); }));
      }
    });
  }

  /* ---------- ladder calibration shared by all strips ----------
   * stripBands: [[v positions of ladder bands in that strip's frame, ascending]] (some may be empty)
   * Each strip s: v = a_s + c * ln(kDa), one slope c < 0 for the whole membrane. Search c on a grid;
   * per strip pick the best ordered assignment (contiguous run of ladder sizes, optionally one skipped
   * ladder band or one extra detected band), then the best disjoint combination, then refine. */
  function calibrateLadder(stripBands, sizes, H, order) {
    const L = sizes.map(Math.log), n = sizes.length;
    const optsFor = (vs) => {
      const m = vs.length, out = [];
      if (!m) return out;
      const drops = m >= 3 ? [-1].concat(vs.map((_, i) => i)) : [-1];
      drops.forEach(dr => {
        const v = dr < 0 ? vs : vs.filter((_, i) => i !== dr), mm = v.length;
        for (let st = 0; st + mm <= n; st++) {
          out.push({ v, idx: v.map((_, i) => st + i), pen: dr >= 0 ? 0.08 : 0 });
          if (mm >= 2) for (let sk = 1; sk < mm && st + mm < n; sk++) out.push({ v, idx: v.map((_, i) => st + i + (i >= sk ? 1 : 0)), pen: 0.05 });
        }
      });
      return out;
    };
    const opts = stripBands.map(optsFor);
    const used = stripBands.map(v => v.length > 0);
    if (!used.some(Boolean)) return null;
    const fitA = (o, c) => { let s = 0; o.v.forEach((v, i) => { s += v - c * L[o.idx[i]]; }); return s / o.v.length; };
    const resid = (o, c) => { const a = fitA(o, c); let r = 0; o.v.forEach((v, i) => { r += (v - a - c * L[o.idx[i]]) ** 2; }); return r; };
    let best = null;
    for (let gi = 0; gi < 240; gi++) {
      const c = -Math.exp(Math.log(H * 0.02) + (Math.log(H * 1.5) - Math.log(H * 0.02)) * gi / 239);
      // top-3 per strip at this slope
      const tops = opts.map(os => os.map(o => ({ o, r: resid(o, c) / (c * c) + o.pen })).sort((a, b) => a.r - b.r).slice(0, 4));
      // best disjoint combination (strips usually <= 4)
      const S = tops.length;
      const rec = (s, usedIdx, acc, picks) => {
        if (s === S) {
          const tot = acc;
          if (!best || tot < best.score) best = { score: tot, c, picks: picks.slice() };
          return;
        }
        if (!tops[s].length) { picks.push(null); rec(s + 1, usedIdx, acc, picks); picks.pop(); return; }
        for (const t of tops[s]) {
          if (t.o.idx.some(i => usedIdx.has(i))) continue;
          // order prior: a strip lower in the image should carry smaller sizes
          let pen = 0;
          if (order) for (let q = 0; q < s; q++) {
            const p = picks[q]; if (!p) continue;
            if (order[q] < order[s] && Math.min(...p.idx) > Math.max(...t.o.idx)) pen += 0.1;
            if (order[q] > order[s] && Math.max(...p.idx) < Math.min(...t.o.idx)) pen += 0.1;
          }
          t.o.idx.forEach(i => usedIdx.add(i)); picks.push(t.o);
          rec(s + 1, usedIdx, acc + t.r + pen, picks);
          picks.pop(); t.o.idx.forEach(i => usedIdx.delete(i));
        }
      };
      rec(0, new Set(), 0, []);
    }
    if (!best) return null;
    // refine c with all picked pairs (shared slope, per-strip intercepts)
    let num = 0, den = 0;
    best.picks.forEach(o => {
      if (!o || o.v.length < 2) return;
      const mL = o.idx.reduce((s, i) => s + L[i], 0) / o.idx.length, mv = o.v.reduce((s, v) => s + v, 0) / o.v.length;
      o.idx.forEach((i, k) => { num += (L[i] - mL) * (o.v[k] - mv); den += (L[i] - mL) ** 2; });
    });
    const c = den > 0 && num / den < 0 ? num / den : best.c;
    const strips = best.picks.map(o => (o ? { a: fitA(o, c), bands: o.v.map((v, k) => ({ v, kda: sizes[o.idx[k]] })) } : null));
    const npts = best.picks.reduce((s, o) => s + (o ? o.v.length : 0), 0);
    let rss = 0; best.picks.forEach((o, s) => { if (o) rss += resid(o, c); });
    const rmsLn = Math.sqrt(rss / Math.max(1, npts)) / Math.abs(c);   // residual in ln(kDa) units
    return { c, strips, rmsLn, npts, score: best.score };
  }
  /* One continuous ladder (pieces in place): robust match of band positions ys (top->bottom) to sizes.
   * Any number of sizes may be missing (hidden in seams, cut off), extra marks are tolerated.
   * Hypotheses from every (band pair, size pair), scored after matching; then refined with a quadratic
   * in ln(kDa) (gradient gels are not log-linear over the full range) and matched again. */
  function fitSeries(ys, sizes, H) {
    const L = sizes.map(Math.log), n = ys.length, K = sizes.length, TOL = 0.2;
    if (n < 3) return null;
    const match = (pred, slope) => {
      const cand = [];
      ys.forEach((y, i) => { for (let k = 0; k < K; k++) { const r = Math.abs(y - pred(k)) / slope; if (r < TOL) cand.push({ i, k, r }); } });
      cand.sort((a, b) => a.r - b.r);
      const ui = new Set(), uk = new Set(); let pairs = [];
      cand.forEach(c => { if (!ui.has(c.i) && !uk.has(c.k)) { ui.add(c.i); uk.add(c.k); pairs.push(c); } });
      // sizes must run in order down the membrane
      pairs.sort((a, b) => a.i - b.i);
      pairs = pairs.filter((p, j) => pairs.slice(0, j).every(o => o.k < p.k));
      if (pairs.length < 2) return null;
      const kLo = Math.min(...pairs.map(p => p.k)), kHi = Math.max(...pairs.map(p => p.k));
      let miss = 0; for (let k = kLo; k <= kHi; k++) if (!pairs.some(p => p.k === k)) miss++;
      const cost = pairs.reduce((s, p) => s + (p.r / TOL) ** 2, 0) + (n - pairs.length) + 0.5 * miss;
      return { pairs, miss, unmatched: n - pairs.length, cost };
    };
    const lsq = (pairs, quad) => {
      // least squares y = a + b L (+ d L^2)
      const X = pairs.map(p => quad ? [1, L[p.k], L[p.k] ** 2] : [1, L[p.k]]), Y = pairs.map(p => ys[p.i]), m = X[0].length;
      const A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
      X.forEach((x, r) => { for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) A[i][j] += x[i] * x[j]; A[i][m] += x[i] * Y[r]; } });
      for (let i = 0; i < m; i++) {
        let piv = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
        [A[i], A[piv]] = [A[piv], A[i]]; if (Math.abs(A[i][i]) < 1e-12) return null;
        for (let r = 0; r < m; r++) if (r !== i) { const fct = A[r][i] / A[i][i]; for (let j = i; j <= m; j++) A[r][j] -= fct * A[i][j]; }
      }
      return A.map((row, i) => row[m] / row[i]);
    };
    let best = null;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let p = 0; p < K; p++) for (let q = p + 1; q < K; q++) {
      const c = (ys[j] - ys[i]) / (L[q] - L[p]);
      if (!(c < 0) || -c < H * 0.02 || -c > H * 1.5) continue;
      const a = ys[i] - c * L[p], m = match(k => a + c * L[k], -c);
      if (m && (!best || m.cost < best.m.cost)) best = { m, c };
    }
    if (!best) return null;
    let m = best.m, coef = null, c = best.c;
    for (let it = 0; it < 3; it++) {
      const quad = m.pairs.length >= 5;
      const cf = lsq(m.pairs, quad); if (!cf) break;
      const pred = k => cf[0] + cf[1] * L[k] + (quad ? cf[2] * L[k] ** 2 : 0);
      const lin = lsq(m.pairs, false); if (!lin || !(lin[1] < 0)) break;
      const m2 = match(pred, -lin[1]);
      if (!m2 || m2.cost > m.cost + 1e-9) { coef = coef || cf; c = lin[1]; break; }
      m = m2; coef = cf; c = lin[1];
    }
    const quad = coef && coef.length === 3;
    const model = lk => (coef ? coef[0] + coef[1] * lk + (quad ? coef[2] * lk * lk : 0) : ys[m.pairs[0].i] + c * (lk - L[m.pairs[0].k]));
    const res = m.pairs.map(p => (ys[p.i] - model(L[p.k])) / c);
    const rmsLn = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length);
    return { c, model, pairs: m.pairs.map(p => ({ i: p.i, y: ys[p.i], kda: sizes[p.k] })), miss: m.miss, unmatched: m.unmatched, npts: m.pairs.length, rmsLn,
      q: rmsLn * rmsLn + 0.06 * m.miss + 0.1 * m.unmatched };
  }

  /* Ladder calibration for one membrane. Pieces put back in place share one continuous ladder;
   * otherwise each piece has its own offset with a shared slope. Strip entries carry knots (detected
   * bands with their sizes) so sizes are interpolated between real ladder bands. */
  function piecesInPlace(strips) {
    if (strips.length < 2) return true;
    const boxes = strips.map(pieceBox), near = (p, q) => boxesNear(p, q, 40);
    const reach = new Set([0]);
    for (let grow = true; grow;) { grow = false; boxes.forEach((b, i) => { if (!reach.has(i) && [...reach].some(j => near(b, boxes[j]))) { reach.add(i); grow = true; } }); }
    return reach.size === strips.length;
  }
  function calibrate(ladderStrips, strips, sizes, H) {
    const stripBands = ladderStrips.map(l => (l ? l.bands : []));
    if (!stripBands.some(b => b.length)) return null;
    if (piecesInPlace(strips)) {
      // every detected band in image y, remembering which piece saw it (same band in two pieces = one entry)
      const obs = [];
      ladderStrips.forEach((Ls, si) => {
        if (!Ls) return;
        const F = stripFrame(strips[si]);
        (Ls.lanes && Ls.lanes.length ? Ls.lanes : [{ u: Ls.uStrip || 0, bands: Ls.bands }]).forEach(ln => ln.bands.forEach(v => obs.push({ y: toImg(F, ln.u, v)[1], s: si, v })));
      });
      obs.sort((a, b) => a.y - b.y);
      const ent = [];
      obs.forEach(o => { const e = ent[ent.length - 1]; if (e && o.y - e.y <= 10) { e.own.push(o); e.y = e.own.reduce((s, x) => s + x.y, 0) / e.own.length; } else ent.push({ y: o.y, own: [o] }); });
      if (ent.length >= 4) {
        const g = fitSeries(ent.map(e => e.y), sizes, H);
        if (g && g.npts >= 3) {
          // per-piece offset from the smooth curve (pieces are rarely put back to the pixel)
          const off = strips.map((_, si) => {
            const r = []; g.pairs.forEach(p => ent[p.i].own.filter(o => o.s === si).forEach(o => r.push(o.y - g.model(Math.log(p.kda)))));
            r.sort((a, b) => a - b); return r.length ? r[r.length >> 1] : null;
          });
          const cal = { c: g.c, rmsLn: g.rmsLn, npts: g.npts, miss: g.miss, unmatched: g.unmatched, q: g.q, global: true, pinned: true };
          cal.strips = strips.map((s, si) => {
            const knots = g.pairs.map(p => {
              const e = ent[p.i], mine = e.own.find(o => o.s === si);
              if (mine) return { v: mine.v, lk: Math.log(p.kda), own: true };
              const offs = e.own.map(o => off[o.s] || 0), eo = offs.reduce((a, b) => a + b, 0) / offs.length;
              return { v: e.y - eo + (off[si] || 0) - s.cy, lk: Math.log(p.kda) };
            }).sort((a, b) => a.v - b.v).reduce((acc, k) => {
              // sizes must fall down the piece; on a conflict a band seen on this piece wins
              const last = acc[acc.length - 1];
              if (!last || k.lk < last.lk) acc.push(k); else if (k.own && !last.own) acc[acc.length - 1] = k;
              return acc;
            }, []);
            const a = knots.length ? knots.reduce((t, k) => t + k.v - g.c * k.lk, 0) / knots.length : 0;
            return { a, knots, bands: knots.filter(k => k.own).map(k => ({ v: k.v, kda: Math.round(Math.exp(k.lk) * 10) / 10 })) };
          });
          return cal;
        }
      }
    }
    const cal = calibrateLadder(stripBands, sizes, H, strips.map(s => s.cy));
    if (!cal) return null;
    // ladder bands the fit predicts inside a strip but that were not seen count against it
    let miss = 0;
    cal.strips.forEach((cs, si) => {
      if (!cs) return;
      const s = strips[si];
      sizes.forEach(k => { const v = cs.a + cal.c * Math.log(k); if (Math.abs(v) < s.h / 2 - 12 && !cs.bands.some(b => b.kda === k)) miss++; });
      cs.knots = cs.bands.map(b => ({ v: b.v, lk: Math.log(b.kda) })).sort((x, y) => x.v - y.v);
    });
    cal.miss = miss; cal.q = cal.score / Math.max(1, cal.npts) + 0.06 * miss;
    // moved pieces with 2 bands each: which 2 sizes they are stays ambiguous (each has its own offset)
    cal.pinned = cal.npts >= 3 && stripBands.some(b => b.length >= 3);
    return cal;
  }
  /* size <-> position on one piece. pc = {knots: [{v, lk}] ascending v, c: slope (v per ln kDa, < 0) or null,
   * a: intercept when there are no knots}: interpolated between knots (real ladder bands), extended with the
   * slope beyond them (without a slope, with the slope of the nearest two knots). */
  function kdaAtK(pc, v) {
    if (!pc) return null;
    const K = pc.knots || [], c = pc.c < 0 ? pc.c : null;
    if (K.length < 2) {
      if (K.length === 1) return c ? Math.exp(K[0].lk + (v - K[0].v) / c) : null;
      return c && pc.a != null ? Math.exp((v - pc.a) / c) : null;
    }
    const z = K.length - 1, sl = (i, j) => (K[j].v - K[i].v) / (K[j].lk - K[i].lk || 1e-9);
    if (v <= K[0].v) return Math.exp(K[0].lk + (v - K[0].v) / (c || sl(0, 1)));
    if (v >= K[z].v) return Math.exp(K[z].lk + (v - K[z].v) / (c || sl(z - 1, z)));
    let i = 0; while (i < z - 1 && v > K[i + 1].v) i++;
    const t = (v - K[i].v) / Math.max(1e-9, K[i + 1].v - K[i].v);
    return Math.exp(K[i].lk + t * (K[i + 1].lk - K[i].lk));
  }
  function vAtK(pc, kda) {
    if (!pc) return null;
    const K = pc.knots || [], c = pc.c < 0 ? pc.c : null, lk = Math.log(kda);
    if (K.length < 2) {
      if (K.length === 1) return c ? K[0].v + (lk - K[0].lk) * c : (Math.abs(lk - K[0].lk) < 1e-3 ? K[0].v : null);
      return c && pc.a != null ? pc.a + c * lk : null;
    }
    const z = K.length - 1, sl = (i, j) => (K[j].v - K[i].v) / (K[j].lk - K[i].lk || 1e-9);
    if (lk >= K[0].lk) return K[0].v + (lk - K[0].lk) * (c || sl(0, 1));
    if (lk <= K[z].lk) return K[z].v + (lk - K[z].lk) * (c || sl(z - 1, z));
    let i = 0; while (i < z - 1 && lk < K[i + 1].lk) i++;
    const t = (K[i].lk - lk) / Math.max(1e-9, K[i].lk - K[i + 1].lk);
    return K[i].v + t * (K[i + 1].v - K[i].v);
  }
  const stripPC = (cal, s) => { const cs = cal && cal.strips[s]; return cs ? { c: cal.c, a: cs.a, knots: cs.knots || [] } : null; };
  const kdaAt = (cal, s, v) => kdaAtK(stripPC(cal, s), v);
  const vAt = (cal, s, kda) => vAtK(stripPC(cal, s), kda);

  /* ---------- the full session analysis ---------- */
  // chemis: [{id, img, exposure(s|null)}], marker: {id, img} | null
  function analyzeSession(chemis, marker, opt) {
    opt = opt || {};
    const W = (chemis[0] || marker).img.w, Himg = (chemis[0] || marker).img.h;
    const f = Math.max(1, Math.ceil(Math.max(W, Himg) / 760));
    const notes = [];
    // --- exposures: signal, clip, tophat at working resolution
    const sigs = chemis.map(c => {
      const cs = c.cs || chemiSignal(c.img);
      const sd = down({ w: c.img.w, h: c.img.h, data: cs.sig }, f);
      const th = tophat(sd.data, sd.w, sd.h, Math.max(6, Math.round(40 / f)));
      const nz = mad(th, 5);
      return { id: c.id, cs, raw: sd.data, th, w: sd.w, h: sd.h, noise: Math.max(1e-5, nz.sigma), clipDs: cs.clip === Infinity ? 1e9 : cs.clip, exposure: c.exposure };
    });
    let factors = exposureFactors(sigs);
    // exposure times from file names win when all are known
    if (chemis.length > 1 && chemis.every(c => c.exposure)) { const mx = Math.max(...chemis.map(c => c.exposure)); factors = chemis.map(c => c.exposure / mx); }
    const w = sigs.length ? sigs[0].w : Math.floor(W / f), h = sigs.length ? sigs[0].h : Math.floor(Himg / f);
    // --- HDR composite for detection: longest unclipped exposure per pixel, scaled to the longest
    const order = sigs.map((s, i) => i).sort((a, b) => factors[b] - factors[a]);
    const comp = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      for (const k of order) {
        const s = sigs[k];
        if (s.raw[i] < 0.85 * s.clipDs || k === order[order.length - 1]) { comp[i] = Math.sqrt(s.th[i] / factors[k]); break; }
      }
    }
    // --- strips from the marker photo. A photo taken elsewhere (marker.T: grid -> photo, marker.pieces: its
    // pieces' own) is read as taken — resampling would blur the thin cuts between pieces — and its strips are
    // mapped onto the grid; ladder lanes and bands are found in each strip's own frame, which carries over.
    const stripsRaw = marker ? findStrips(marker.img, f) : [];
    const strips = marker && marker.T ? stripsRaw.map(s => {
      const g = regFrame(regInverse(marker.T), W, Himg, s);
      const own = (marker.pieces || []).find(p => { const [u, v] = toFrame(frame(p.cx, p.cy, p.angle), g.cx, g.cy); return Math.abs(u) <= p.w / 2 && Math.abs(v) <= p.h / 2; });
      return Object.assign({}, s, own ? regFrame(regInverse(own.T), W, Himg, s) : g);
    }) : stripsRaw;
    if (marker && !strips.length) notes.push('Marker 图中没有识别出膜条');
    // --- regions: membrane strips from the marker photo, else clusters of chemi signal
    const compImg = { w, h, data: comp };
    const nzc = mad(comp, 3);
    let regions = strips.map((s, si) => ({ strip: si, cx: s.cx / f, cy: s.cy / f, angle: s.angle, w: s.w / f, h: s.h / f }));
    if (!regions.length) regions = regionsFromSignal(compImg, nzc);
    // --- rows and lanes per region
    let rowsRaw = [];
    regions.forEach((rg, ri) => {
      const F = frame(rg.cx, rg.cy, rg.angle);
      const win = sampleWindow(compImg, F, -rg.w / 2, rg.w / 2, -rg.h / 2, rg.h / 2, 1);
      detectRows(win, nzc).forEach(r => rowsRaw.push(Object.assign(r, { region: ri, rg, F })));
    });
    // --- global lane pitch: rows whose lane gaps are regular (loading controls usually are)
    const rowPitches = [];
    rowsRaw.forEach(r => {
      if (r.peaks.length < 3) return;
      const g = []; for (let i = 1; i < r.peaks.length; i++) g.push(r.peaks[i] - r.peaks[i - 1]);
      const gs = g.slice().sort((a, b) => a - b), med = gs[gs.length >> 1];
      const ok = g.filter(x => Math.abs(x - med) < 0.15 * med).length;
      rowPitches.push({ med, w: ok, all: g });
    });
    let pitchDs;
    if (rowPitches.length) {
      rowPitches.sort((a, b) => b.w - a.w);
      const base = rowPitches[0].med;
      pitchDs = pitchFromGaps(rowPitches.flatMap(p => p.all), base * 0.75, base * 1.35);
    } else {
      const g = rowsRaw.flatMap(r => { const o = []; for (let i = 1; i < r.peaks.length; i++) o.push(r.peaks[i] - r.peaks[i - 1]); return o; });
      pitchDs = g.length ? pitchFromGaps(g, 8, 200) : 40 / f;
    }
    if (!(pitchDs > 0)) pitchDs = 40 / f;
    const pitch = pitchDs * f;
    // --- ladder lane + bands from the marker photo, per strip
    let ladderStrips = [];
    if (marker && strips.length) {
      ladderStrips = findLadders(marker.img, stripsRaw, pitch);
      if (!ladderStrips.some(l => l && l.bands.length)) notes.push('Marker 图中没有找到 Ladder 条带');
    }
    // --- ladder choice + calibration (shared slope across strips)
    let calib = null, ladderId = opt.ladderId || null, ladderRank = [];
    const stripBands = ladderStrips.map(l => (l ? l.bands : []));
    if (stripBands.some(b => b.length)) {
      const cands = (opt.ladderId ? [G.ProteinLadders.get(opt.ladderId)] : G.ProteinLadders.all().filter(l => !l.chemi)).filter(Boolean);
      ladderRank = cands.map(l => {
        const cal = calibrate(ladderStrips, strips, l.sizes, Himg);
        return cal && { id: l.id, cal, q: cal.q + (l.id === opt.prefLadder ? -0.01 : 0), miss: cal.miss };
      }).filter(Boolean).sort((a, b) => a.q - b.q);
      // fewer than 3 ladder bands cannot pin down a size curve; neither can moved pieces with 2 bands each
      // (each piece has its own offset, so which 2 sizes they are stays ambiguous)
      const top = ladderRank[0];
      if (top && top.cal.pinned) { calib = top.cal; ladderId = top.id; }
      else if (top && top.cal.npts >= 3) notes.push('各条膜上可见的 Ladder 条带都不足 3 条，且膜条不在原位，分子量无法可靠确定，请手动标注');
      else if (top) notes.push('Marker 图中可用的 Ladder 条带太少（少于 3 条），无法标注分子量');
    }
    /* --- lanes, piece by piece. Pieces are often not put back where they were on the membrane, so each
     * piece (region) gets its own lattice from its own rows and ladder lanes; columns are assigned later. */
    const ladderU = regions.map(rg => {
      const l = rg.strip >= 0 ? ladderStrips[rg.strip] : null;
      return l && l.lanes ? l.lanes.map(L => L.u / f) : [];
    });
    const cands = regions.map((rg, ri) => pieceAnchors(rowsRaw.filter(r => r.region === ri), ladderU[ri], pitchDs));
    const pJoint = jointPitch(cands.map(c => c.anchors), pitchDs);
    const lat = regions.map((rg, ri) => pieceLattice(rg, cands[ri], ladderU[ri], pJoint));
    const slotOf = (ri, u) => { const L = lat[ri]; if (!L) return -1; const m = Math.round((u - L.u0) / L.pitch); return m >= 0 && m < L.roles.length && L.roles[m] === 'sample' ? m : -1; };
    // --- row records: one segment each (piece, band centre vc, band extent b0..b1 around it; full resolution)
    let out = rowsRaw.map(r => {
      const ri = r.region, rg = r.rg;
      const ms = [...new Set(r.peaks.map(u => slotOf(ri, u)).filter(m => m >= 0))].sort((a, b) => a - b);
      if (!ms.length) return null;
      const [ox, oy] = toImg(frame(rg.cx * f, rg.cy * f, rg.angle), 0, r.vc * f);
      const b0 = (r.v0 - r.vc) * f, b1 = (r.v1 - r.vc) * f;
      return { region: ri, segs: [{ region: ri, vc: r.vc * f, b0, b1, ms }], ox, oy, angle: Math.round(rg.angle * 100) / 100, bandH: Math.max(4, b1 - b0), strength: r.strength };
    }).filter(Boolean);
    // band contrast of a row in each picture (raw signal, its own lanes and band height)
    const rowContrast = r => {
      if (r._contrast) return r._contrast;
      const q2 = (a, p) => { if (!a.length) return 0; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))]; };
      const per = [];
      sigs.forEach(s => {
        const band = [], bgv = [], im = { w: s.w, h: s.h, data: s.raw };
        r.segs.forEach(sg => {
          const rg = regions[sg.region], F = frame(rg.cx, rg.cy, rg.angle), L = lat[sg.region];
          const v0 = (sg.vc + sg.b0) / f, v1 = (sg.vc + sg.b1) / f;
          sg.ms.forEach(m => {
            const uc = L.u0 + m * L.pitch, hw = L.pitch * 0.3;
            for (let u = uc - hw; u <= uc + hw; u += 1) {
              for (let v = v0; v <= v1; v += 1) { const [x, y] = toImg(F, u, v); const val = bilinear(im, x, y); if (!isNaN(val)) band.push(val); }
              for (const dv of [-6, -4, 4, 6]) { const [x, y] = toImg(F, u, (dv < 0 ? v0 : v1) + dv); const val = bilinear(im, x, y); if (!isNaN(val)) bgv.push(val); }
            }
          });
        });
        const hi = q2(band, 0.9), clipped = hi >= 0.98 * Math.min(1, s.clipDs);
        per.push({ c: hi - q2(bgv, 0.5), clipped });
      });
      return (r._contrast = per);
    };
    // relative strength of two rows, measured in the same pictures (where neither is clipped)
    const sameStrength = (a, b) => {
      const A = rowContrast(a), B = rowContrast(b), ratios = [];
      A.forEach((x, k) => { const y = B[k]; if (x.clipped || y.clipped || Math.max(x.c, y.c) < 0.03) return; ratios.push(Math.min(x.c, y.c) / Math.max(x.c, y.c)); });
      if (!ratios.length) return 1;     // no fair comparison possible: do not block on it
      ratios.sort((x, y) => x - y);
      return ratios[ratios.length >> 1];
    };
    // strength of a row relative to the strongest row on its own piece (1 = the piece's main band).
    // A faint secondary band of one antibody must not join the main band of another piece.
    const pieceRank = r => {
      if (r._rank != null) return r._rank;
      const A = rowContrast(r);
      let rank = 1;
      out.forEach(s => {
        if (s === r || s.region !== r.region) return;
        const B = rowContrast(s), ratios = [];
        A.forEach((x, k) => { const y = B[k]; if (x.clipped || y.clipped || Math.max(x.c, y.c) < 0.03) return; ratios.push(x.c / Math.max(y.c, 1e-9)); });
        if (!ratios.length) return;
        ratios.sort((x, y) => x - y);
        rank = Math.min(rank, ratios[ratios.length >> 1]);
      });
      return (r._rank = rank);
    };
    // --- one protein running across pieces placed side by side = one figure row
    const xExt = ri => { const b = pieceBox(regions[ri]); return [b[0], b[2]]; };
    const sideBySide = (ra, rb) => { const A = xExt(ra), B = xExt(rb), ov = Math.min(A[1], B[1]) - Math.max(A[0], B[0]); return ov < 0.25 * Math.min(A[1] - A[0], B[1] - B[0]); };
    out.sort((a, b) => b.segs[0].ms.length - a.segs[0].ms.length);
    const merged = [];
    out.forEach(r => {
      // same height is not enough: a neighbouring piece probed with another antibody can have faint bands
      // at that height. Require comparable band contrast (in the same pictures), and unless the contrast is
      // clearly alike, a comparable rank on the own piece (main band vs main band, not main vs secondary).
      const host = merged.find(m => !m.regions.has(r.region) && [...m.regions].every(ri => sideBySide(ri, r.region)) &&
        Math.abs(m.oy - r.oy) < Math.max(m.bandH, r.bandH) * 0.9 + 6 && Math.abs(m.angle - r.angle) < 3 &&
        sameStrength(m, r) > 0.3 && (sameStrength(m, r) > 0.6 || Math.min(pieceRank(m), pieceRank(r)) / Math.max(pieceRank(m), pieceRank(r)) > 0.35));
      if (host) { host.segs.push(r.segs[0]); host.regions.add(r.region); host.strength += r.strength; host.bandH = Math.max(host.bandH, r.bandH); }
      else merged.push(Object.assign(r, { regions: new Set([r.region]) }));
    });
    // two detections of one heavy band (core + smear edge) on the same piece: same lanes, close in height
    for (let i = 0; i < merged.length; i++) for (let j = merged.length - 1; j > i; j--) {
      const a = merged[i], b = merged[j];
      const sa = a.segs.find(s => b.segs.some(t => t.region === s.region)); if (!sa) continue;
      const sb = b.segs.find(t => t.region === sa.region);
      if (sa.ms.filter(m => sb.ms.includes(m)).length < Math.min(sa.ms.length, sb.ms.length) * 0.6) continue;
      if (Math.abs(sa.vc - sb.vc) > 30 + 0.5 * ((sa.b1 - sa.b0) + (sb.b1 - sb.b0)) / 2) continue;
      const keep = a.strength >= b.strength ? a : b, drop = keep === a ? b : a;
      drop.segs.forEach(d => {
        const k = keep.segs.find(s => s.region === d.region);
        if (!k) { keep.segs.push(d); keep.regions.add(d.region); return; }
        const top = Math.min(k.vc + k.b0, d.vc + d.b0), bot = Math.max(k.vc + k.b1, d.vc + d.b1);
        k.b0 = top - k.vc; k.b1 = bot - k.vc; k.ms = [...new Set(k.ms.concat(d.ms))].sort((x, y) => x - y);
      });
      keep.bandH = Math.max(...keep.segs.map(s => s.b1 - s.b0)); keep.strength += drop.strength;
      merged[i] = keep; merged.splice(j, 1);
    }
    // faint rows confined to one or two lanes are usually nonspecific bands or dust
    const nLanes = r => r.segs.reduce((s, sg) => s + sg.ms.length, 0);
    const smax = Math.max(1e-9, ...merged.map(r => r.strength)), maxLanes = Math.max(0, ...merged.map(nLanes));
    out = merged.filter(r => (nLanes(r) >= 3 || r.strength > smax * 0.06) && !(nLanes(r) <= 2 && maxLanes >= 4 && r.strength < smax * 0.15));
    out.forEach(r => {
      r.segs.sort((a, b) => regions[a.region].cx - regions[b.region].cx);        // left to right
      const half = sg => regions[sg.region].h * f / 2;
      // crop: about 2.5 band heights of background above and below the band centre, inside the pieces,
      // reaching a marker band if one is just outside
      const margin = clamp(r.bandH * 2.5, 16, 100);
      let above = Math.max(...r.segs.map(sg => -sg.b0)) + margin, below = Math.max(...r.segs.map(sg => sg.b1)) + margin;
      above = Math.min(above, ...r.segs.map(sg => sg.vc + half(sg) - 2)); below = Math.min(below, ...r.segs.map(sg => half(sg) - sg.vc - 2));
      const s0 = r.segs[0], strip = regions[s0.region].strip;
      let kda = null;
      if (calib && strip >= 0 && calib.strips[strip]) {
        kda = kdaAt(calib, strip, s0.vc + (s0.b0 + s0.b1) / 2);
        const ticks = calib.strips[strip].bands.map(b => b.v - s0.vc);
        if (!ticks.some(t => t > -above + 3 && t < below - 3)) {
          const near = ticks.map(t => ({ t, d: t < -above ? -above - t : t - below })).filter(o => o.d >= 0 && o.d < margin * 1.8).sort((a, b) => a.d - b.d)[0];
          if (near) { if (near.t < -above) above = Math.min(-near.t + 8, s0.vc + half(s0) - 1); else below = Math.min(near.t + 8, half(s0) - s0.vc - 1); }
        }
      }
      Object.assign(r, { kda, above, below, strip });
      r.regions = [...r.regions];
    });
    // --- pieces (full resolution) and the first guess of their figure columns
    const pieces = regions.map((rg, ri) => {
      const L = lat[ri];
      return { strip: rg.strip, cx: rg.cx * f, cy: rg.cy * f, angle: Math.round(rg.angle * 100) / 100, w: rg.w * f, h: rg.h * f,
        u0: L ? L.u0 * f : 0, pitch: L ? L.pitch * f : pitch, roles: L ? L.roles.slice() : [], col0: 1, ladderUs: ladderU[ri].map(u => u * f) };
    });
    assignColumns(pieces, out);
    const colOf = (pc, m) => { if (pc.roles[m] !== 'sample') return null; let c = pc.col0; for (let k = 0; k < m; k++) if (pc.roles[k] === 'sample') c++; return c; };
    // --- exposure choice per row (over all the lanes of its pieces)
    out.forEach(r => {
      const parts = r.segs.map(sg => {
        const pc = pieces[sg.region], sl = pc.roles.map((x, m) => m).filter(m => pc.roles[m] === 'sample');
        return { F: frame(pc.cx, pc.cy, pc.angle), u0: pc.u0 + (sl[0] - 0.5) * pc.pitch, u1: pc.u0 + (sl[sl.length - 1] + 0.5) * pc.pitch,
          vTop: sg.vc - r.above, vBot: sg.vc + r.below, b0: sg.vc + sg.b0, b1: sg.vc + sg.b1 };
      });
      r.expo = chemis.map((c, k) => evalExposure(c.img, sigs[k].cs, parts, factors[k]));
      r.choice = chooseExposure(r.expo);
      // figure columns the row has bands in (tests and default lane range)
      r.ks = [...new Set(r.segs.flatMap(sg => sg.ms.map(m => colOf(pieces[sg.region], m)).filter(c => c != null)))].sort((a, b) => a - b);
    });
    out.sort((a, b) => a.oy - b.oy);
    return { strips, regions, pieces, rows: out, pitch, factors, calib, ladderId, ladderRank: ladderRank.map(x => ({ id: x.id, q: x.q, rms: x.cal.rmsLn, miss: x.miss })), ladderStrips, notes, f };
  }

  /* rows (one per protein) in a straightened region window, plus lane peaks along each row.
   * Returned positions are in frame units (u, v relative to the region centre). */
  function detectRows(win, nz) {
    const { w, h, data } = win;
    const U = i => win.u0 + (i + 0.5) * win.step, V = j => win.v0 + (j + 0.5) * win.step;
    const vp = new Float32Array(h), buf = new Float32Array(w), k = Math.max(2, Math.round(w * 0.3));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) buf[x] = data[y * w + x];
      const s = buf.slice().sort(); let m = 0; for (let i = w - k; i < w; i++) m += s[i]; vp[y] = m / k;
    }
    const sm = gaussSmooth(vp, 1), bl = slide(slide(sm, 12, false), 12, true), q = new Float32Array(h);
    let mx = 0; for (let y = 0; y < h; y++) { q[y] = Math.max(0, sm[y] - bl[y]); mx = Math.max(mx, q[y]); }
    if (mx <= 0) return [];
    let pk = findPeaks(q, 4, Math.max(mx * 0.05, nz.sigma * 3));
    // extent at 35% of each peak; peaks whose extents touch belong to one row (doublets, smears)
    const ext = pk.map(p => {
      let a = p.i, b = p.i; const lim = p.v * 0.35;
      while (a > 0 && q[a - 1] > lim) a--;
      while (b < h - 1 && q[b + 1] > lim) b++;
      return { a, b, p };
    });
    const groups = [];
    ext.forEach(e => {
      const g = groups[groups.length - 1];
      // same row when the extents touch, or when the signal between the two peaks never falls back
      // near background (a heavy smeared band, a doublet)
      let shallow = false;
      if (g) {
        const pPrev = g.ps[g.ps.length - 1];
        let lo = Infinity; for (let y = pPrev.i; y <= e.p.i; y++) lo = Math.min(lo, q[y]);
        shallow = lo > 0.5 * Math.min(pPrev.v, e.p.v);
      }
      if (g && (e.a - g.b <= 3 || shallow)) { g.b = Math.max(g.b, e.b); g.ps.push(e.p); } else groups.push({ a: e.a, b: e.b, ps: [e.p] });
    });
    const rows = [];
    groups.forEach(g => {
      const up = new Float32Array(w);
      for (let x = 0; x < w; x++) { let s = 0; for (let y = g.a; y <= g.b; y++) s += data[y * w + x]; up[x] = s / (g.b - g.a + 1); }
      const us = gaussSmooth(up, 2.5), ubl = slide(slide(us, Math.max(6, Math.round(w / 8)), false), Math.max(6, Math.round(w / 8)), true);
      const uq = new Float32Array(w); let umx = 0;
      for (let x = 0; x < w; x++) { uq[x] = Math.max(0, us[x] - ubl[x]); umx = Math.max(umx, uq[x]); }
      const lp = findPeaks(uq, 6, Math.max(umx * 0.1, nz.sigma * 2));
      if (!lp.length) return;
      const strength = g.ps.reduce((s, p) => s + p.prom, 0);
      // centre: mass-weighted over the row profile
      let sw = 0, sv = 0; for (let y = g.a; y <= g.b; y++) { sw += q[y]; sv += q[y] * y; }
      rows.push({ vc: V(sw ? sv / sw : (g.a + g.b) / 2) , v0: V(g.a) - win.step / 2, v1: V(g.b) + win.step / 2,
        peaks: lp.map(p => U(p.i)), peakMass: lp.map(p => p.prom), strength, rel: strength / mx });
    });
    // weak single-lane rows are usually dust or a stray spot
    const smax = Math.max(0, ...rows.map(r => r.strength));
    return rows.filter(r => r.peaks.length >= 2 || r.strength > smax * 0.25);
  }

  /* without a marker photo: separate pieces of membrane = clusters of chemi signal; each gets its own angle */
  function regionsFromSignal(img, nz) {
    const { w, h, data } = img, mask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = data[i] > nz.med + 6 * nz.sigma ? 1 : 0;
    const cl = close2d(mask, w, h, 14), m8 = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) m8[i] = cl[i] > 0.5 ? 1 : 0;
    const { comps } = components(m8, w, h);
    const big = comps.filter(c => c.n > w * h * 0.003);
    const out = big.map(c => {
      const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2, rw = c.x1 - c.x0 + 40, rh = c.y1 - c.y0 + 40;
      // angle: the rotation that makes the row profile sharpest
      const score = a => {
        const win = sampleWindow(img, frame(cx, cy, a), -rw / 2, rw / 2, -rh / 2, rh / 2, 1.5);
        const vp = new Float32Array(win.h);
        for (let y = 0; y < win.h; y++) { let s = 0; for (let x = 0; x < win.w; x++) s += win.data[y * win.w + x]; vp[y] = s; }
        let e = 0; for (let y = 1; y < win.h; y++) e += (vp[y] - vp[y - 1]) ** 2;
        return e;
      };
      let best = 0, bs = -1;
      for (let a = -15; a <= 15.001; a += 1) { const s = score(a); if (s > bs) { bs = s; best = a; } }
      const a0 = best;
      for (let a = a0 - 1; a <= a0 + 1.001; a += 0.1) { const s = score(a); if (s > bs) { bs = s; best = a; } }
      return { strip: -1, cx, cy, angle: Math.round(best * 100) / 100, w: rw, h: rh };
    });
    return out.length ? out : [{ strip: -1, cx: w / 2, cy: h / 2, angle: 0, w, h }];
  }

  /* Ladder bands as 2-D marks in the white-light photo, for all pieces at once.
   * A prestained ladder band is a lane-wide, thin, horizontal dark mark on the membrane. Ladder lanes are
   * the x positions where such marks repeat (across pieces when they were put back in place; people
   * often cut right through the ladder lane, so one piece may hold only part of it).
   * Returns per strip {uStrip, bands: [v...], lanes: [{u, bands}]} in strip-frame full-res units. */
  function findLadders(img, strips, pitch) {
    const f = Math.max(1, Math.ceil(Math.max(img.w, img.h) / 1200));
    const sm = down(img, f), { w, h } = sm, d = sm.data, P = pitch / f;
    // background = closing with a wide, short rectangle: removes dark marks narrower than ~1 lane
    const rx = Math.max(3, Math.round(P * 0.6)), ry = Math.max(4, Math.round(16 / f));
    let bg = lineOp(d, w, h, rx, true, true); bg = lineOp(bg, w, h, ry, true, false);
    bg = lineOp(bg, w, h, rx, false, true); bg = lineOp(bg, w, h, ry, false, false);
    const dark = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dark[i] = Math.max(0, bg[i] - d[i]) / Math.max(0.05, bg[i]);   // relative darkening
    // only inside pieces, away from their cut edges
    const inside = new Uint8Array(w * h), Fs = strips.map(stripFrame);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = (x + 0.5) * f, Y = (y + 0.5) * f;
      for (let si = 0; si < strips.length; si++) {
        const s = strips[si], [u, v] = toFrame(Fs[si], X, Y);
        // cut edges have a dark rim up to ~15 px wide
        if (Math.abs(u) < s.w / 2 - 12 && Math.abs(v) < s.h / 2 - 16) { inside[y * w + x] = si + 1; break; }
      }
    }
    const nz = mad(dark.filter((v, i) => inside[i] && i % 5 === 0), 1);
    const thr = Math.max(0.06, nz.med + 5 * nz.sigma);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = inside[i] && dark[i] > thr ? 1 : 0;
    const { lab, comps } = components(mask, w, h);
    const blobs = [];
    comps.forEach(c => {
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
      if (bw < P * 0.28 || bw > P * 1.1 || bh > 44 / f || bw < bh * 1.8 || c.n < bw * 1.5) return;
      // the piece this mark is in (majority label)
      const si = inside[Math.round(c.sy / c.n) * w + Math.round(c.sx / c.n)] - 1;
      if (si < 0) return;
      let m = 0; for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * w + x] === c.id) m += dark[y * w + x];
      blobs.push({ x: (c.sx / c.n + 0.5) * f, y: (c.sy / c.n + 0.5) * f, si, mass: m });
    });
    // columns of marks (global x)
    blobs.sort((a, b) => a.x - b.x);
    const cols = [];
    blobs.forEach(b => {
      const c = cols.find(c => Math.abs(c.x - b.x) < pitch * 0.3);
      if (c) { c.items.push(b); c.x = c.items.reduce((s, q2) => s + q2.x, 0) / c.items.length; } else cols.push({ x: b.x, items: [b] });
    });
    const multi = strips.length > 1;
    const maxN = Math.max(0, ...cols.map(c => c.items.length));
    // a real ladder lane collects marks in most pieces; scratches and edge notches collect a few
    const ladderCols = cols.filter(c => c.items.length >= 2 && c.items.length >= maxN * 0.5 && (!multi || new Set(c.items.map(b => b.si)).size >= 2 || c.items.length >= 3));
    findLadders.debug = { thr, blobs: blobs.length, cols: cols.map(c => `${Math.round(c.x)}:${c.items.length}`), own: [] };
    return strips.map((s, si) => {
      const F = Fs[si];
      let lanes = ladderCols.map(c => {
        const mine = c.items.filter(b => b.si === si);
        const u = toFrame(F, c.x, s.cy)[0];
        if (Math.abs(u) > s.w / 2 + pitch * 0.2) return null;     // this column does not cross the piece
        return { u, own: mine.length, bands: mine.map(b => toFrame(F, b.x, b.y)[1]).sort((a, b) => a - b) };
      }).filter(Boolean);
      // a piece moved away from the others (scattered, tilted) has its ladder elsewhere in image x:
      // fall back to its own column of marks, in piece coordinates, if it is clearly a ladder: 3+ marks,
      // or 2 marks when that is the only such column and it sits within 1.5 lanes of a piece end
      if (!lanes.some(l => l.bands.length)) {
        const own = [];
        blobs.filter(b => b.si === si).map(b => toFrame(F, b.x, b.y)).sort((a, b) => a[0] - b[0]).forEach(([u, v]) => {
          const c = own.find(c => Math.abs(c.u - u) < pitch * 0.3);
          if (c) { c.vs.push(v); c.us.push(u); c.u = c.us.reduce((a, b) => a + b, 0) / c.us.length; } else own.push({ u, us: [u], vs: [v] });
        });
        const two = own.filter(c => c.vs.length >= 2);
        let best = own.filter(c => c.vs.length >= 3).sort((a, b) => b.vs.length - a.vs.length)[0];
        if (!best && two.length === 1 && Math.abs(two[0].u) > s.w / 2 - pitch * 1.5) best = two[0];
        findLadders.debug.own.push(`${si}:${own.map(c => Math.round(c.u) + '/' + c.vs.length).join(' ')}`);
        if (best) lanes = [{ u: best.u, own: best.vs.length, bands: best.vs.sort((a, b) => a - b) }];
      }
      // faint or broad ladder bands (e.g. the pink reference bands of two-colour ladders photograph
      // pale in grey) fail the blob test: read a darkness profile down each ladder lane as well
      lanes.forEach(l => {
        const hw = P * f * 0.3, vA = -s.h / 2 + 16, vB = s.h / 2 - 16, prof = [];
        for (let v = vA; v <= vB; v += f) {
          let sm = 0, n = 0;
          for (let du = -hw; du <= hw; du += f) {
            if (Math.abs(l.u + du) > s.w / 2 - 4) continue;
            const [x, y] = toImg(F, l.u + du, v), val = bilinear({ w, h, data: dark }, x / f - 0.5, y / f - 0.5);
            if (!isNaN(val)) { sm += val; n++; }
          }
          prof.push(n ? sm / n : 0);
        }
        if (prof.length < 5) return;
        const ps = gaussSmooth(Float32Array.from(prof), 1.5);
        const strong = l.bands.map(bv => ps[clamp(Math.round((bv - vA) / f), 0, ps.length - 1)]);
        // with marks of its own the lane is a ladder lane: fainter bands relative to them count; a column
        // seen only on other pieces needs clear bands here (pieces are often not put back in place)
        const pk = findPeaks(ps, Math.max(3, 18 / f), strong.length ? Math.max(thr * 0.35, Math.max(...strong) * 0.18) : thr * 0.8);
        const add = pk.map(q2 => vA + q2.i * f).filter(v => l.bands.every(b => Math.abs(b - v) > 10));
        findLadders.debug.prof = (findLadders.debug.prof || []).concat(`${si}@${Math.round(l.u)}: ${pk.map(q2 => Math.round(vA + q2.i * f + s.cy) + '/' + q2.prom.toFixed(3)).join(' ')} own=${l.own}`);
        l.bands = l.bands.concat(add).sort((a, b) => a - b);
      });
      lanes = lanes.filter(l => l.own > 0 || l.bands.length >= 2);
      // all ladder lanes in a piece show the same ladder: merge their bands for calibration
      const vs = [];
      lanes.flatMap(l => l.bands).sort((a, b) => a - b).forEach(v => { if (!vs.length || v - vs[vs.length - 1] > 10) vs.push(v); else vs[vs.length - 1] = (vs[vs.length - 1] + v) / 2; });
      const best = lanes.slice().sort((a, b) => b.bands.length - a.bands.length)[0];
      return { uStrip: best ? best.u : null, bands: vs, lanes: lanes.sort((a, b) => a.u - b.u) };
    });
  }

  /* ladder lane + band positions in one strip of the marker photo (strip frame, full-res units) */
  function findLadderInStrip(img, s, pitch, laneW) {
    const F = stripFrame(s), step = 2;
    // inset: the cut edges of a piece are a dark rim that would look like a ladder band in every lane
    const ins = Math.min(14, s.h * 0.06);
    const win = sampleWindow(img, F, -s.w / 2 + ins, s.w / 2 - ins, -s.h / 2 + ins, s.h / 2 - ins, step);
    const { w, h } = win, d = win.data;
    // dark bands on the bright membrane: signal = local brightness minus the pixel (column top-hat of the inverse)
    const inv = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) inv[i] = 1 - d[i];
    const r = Math.max(4, Math.round(laneW * 0.6 / step));
    const th = new Float32Array(w * h), col = new Float32Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) col[y] = inv[y * w + x];
      const o = slide(slide(col, r, false), r, true);
      for (let y = 0; y < h; y++) th[y * w + x] = Math.max(0, col[y] - o[y]);
    }
    // column score: mean of the top 4% values (a lane with a few sharp bands)
    const prof = new Float32Array(w), k = Math.max(2, Math.round(h * 0.04)), buf = new Float32Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) buf[y] = th[y * w + x];
      const srt = buf.slice().sort();
      let sm = 0; for (let i = h - k; i < h; i++) sm += srt[i];
      prof[x] = sm / k;
    }
    const ps = gaussSmooth(prof, Math.max(1, laneW / step / 4));
    const med = percentiles(ps, [50])[0];
    let pmax = 0; for (let x = 0; x < w; x++) pmax = Math.max(pmax, ps[x]);
    if (pmax < med * 2 + 0.01) return { uStrip: null, bands: [], lanes: [] };
    // every lane carrying a ladder (gels often have two), ignoring the piece's outer margins
    const margin = Math.round(4 / step);
    const cand = findPeaks(ps, Math.max(3, pitch * 0.6 / step), (pmax - med) * 0.35).filter(p => p.i > margin && p.i < w - margin && ps[p.i] > med * 1.8);
    const lanes = cand.map(p => {
      let l = p.i, rr = p.i; const half = med + (ps[p.i] - med) / 2;
      while (l > 0 && ps[l - 1] > half) l--;
      while (rr < w - 1 && ps[rr + 1] > half) rr++;
      const lc = (l + rr) / 2, lh = Math.max(2, (rr - l) / 2 * 0.7);
      const vp = new Float32Array(h);
      for (let y = 0; y < h; y++) { let sm = 0, n = 0; for (let x = Math.round(lc - lh); x <= Math.round(lc + lh); x++) if (x >= 0 && x < w) { sm += th[y * w + x]; n++; } vp[y] = sm / Math.max(1, n); }
      const vs = gaussSmooth(vp, 1);
      let mx = 0; for (let y = 0; y < h; y++) mx = Math.max(mx, vs[y]);
      // ignore the piece's top/bottom edges (dark rim)
      const pk = findPeaks(vs, Math.max(3, 10 / step), mx * 0.2).filter(q2 => q2.i > margin && q2.i < h - margin);
      return { u: win.u0 + (lc + 0.5) * step, bands: pk.map(q2 => win.v0 + (q2.i + 0.5) * step), score: ps[p.i] };
    }).filter(L => L.bands.length);
    if (!lanes.length) return { uStrip: null, bands: [], lanes: [] };
    // calibration uses the lane with the most bands (ties: the stronger)
    const best = lanes.slice().sort((a, b) => (b.bands.length - a.bands.length) || (b.score - a.score))[0];
    lanes.sort((a, b) => a.u - b.u);
    return { uStrip: best.u, bands: best.bands, lanes };
  }

  /* ---------- lanes and band inside one box ----------
   * The box a row is cropped with is the user's statement of where its lanes are, so these read nothing but
   * the box's own pixels. sig: signal image (bands high); F: piece frame; u0..u1 × v0..v1: the box.
   * Lanes: lattice positions from the first to the last lane with a band; empty positions between them stay
   * (wells are contiguous). The spacing is voted from the gaps between lane peaks, preferring the spacing that
   * implies the fewest empty lanes. opt.pitch, the spacing the membrane's rows show, stands when the box does
   * not clearly keep another one — unless the box's bands are wider than it, which no lane spacing can be.
   * Returns {lanes: [u], pitch} (frame units). */
  function detectBoxLanes(sig, F, u0, u1, v0, v1, opt) {
    opt = opt || {};
    // never finer than the pixels: interpolated neighbours would share their noise
    const step = Math.max(1, (u1 - u0) / 700, (v1 - v0) / 400);
    const win = sampleWindow(sig, F, u0, u1, v0, v1, step), { w, h, data } = win;
    const P0 = opt.pitch > 0 ? opt.pitch / step : 0;
    if (w < 8 || h < 3) return { lanes: [], pitch: opt.pitch || 0 };
    // column profile: the mean of each column's strongest 15 % (the rows its band runs through), compressed so
    // a faint lane counts next to a strong one; a background drifting across the box is taken off below
    const k = Math.max(2, Math.round(h * 0.15)), prof = new Float32Array(w), col = new Float32Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) col[y] = data[y * w + x];
      col.sort();
      let s = 0; for (let i = h - k; i < h; i++) s += col[i];
      prof[x] = Math.sqrt(Math.max(0, s / k));
    }
    const sig0 = Math.max(1, w / 250), q0 = gaussSmooth(prof, sig0);
    // background: an opening wider than any band (1.2 membrane lanes, at least a fifth of the box)
    const R = Math.max(4, Math.round(Math.min(w / 2.5, Math.max(P0 * 1.2, w / 5))));
    const bl = slide(slide(q0, R, false), R, true), q = new Float32Array(w);
    let mx = 0; for (let x = 0; x < w; x++) { q[x] = Math.max(0, q0[x] - bl[x]); mx = Math.max(mx, q[x]); }
    if (!(mx > 0)) return { lanes: [], pitch: opt.pitch || 0 };
    // pixel noise of the profile, from differences of columns 2 apart (a lane spans many columns, so they
    // hardly see the lanes), as it is left after the smoothing: a lane must stand well clear of it — in a
    // picture where the row's band is missing, noise ripples would otherwise read as dozens of lanes
    const dif = []; for (let x = 2; x < w; x++) dif.push(Math.abs(prof[x] - prof[x - 2]));
    dif.sort((a, b) => a - b);
    const noise = 1.4826 * dif[dif.length >> 1] / Math.SQRT2 / Math.sqrt(2 * Math.sqrt(Math.PI) * sig0);
    // two peaks of one lane (a band with a dip, the two edges of a smeared or clipped band) are one lane, at
    // their weighted middle: closer than 0.6 of the membrane's spacing, or — spacing unknown — with only a
    // shallow dip between them
    const peaks = [];
    findPeaks(q, Math.max(3, w / 60, P0 ? P0 * 0.25 : 0), Math.max(mx * 0.07, noise * 6)).forEach(p => {
      const pv = peaks[peaks.length - 1];
      if (pv) {
        let lo = Infinity; for (let x = Math.round(pv.i); x <= p.i; x++) lo = Math.min(lo, q[x]);
        if (P0 ? p.i - pv.i < 0.6 * P0 : lo > 0.6 * Math.min(pv.v, p.v)) {
          const wsum = pv.prom + p.prom;
          pv.i = (pv.i * pv.prom + p.i * p.prom) / wsum; pv.v = Math.max(pv.v, p.v); pv.prom = Math.max(pv.prom, p.prom);
          return;
        }
      }
      peaks.push({ i: p.i, v: p.v, prom: p.prom });
    });
    const U = x => win.u0 + (x + 0.5) * step;
    if (peaks.length < 2) return { lanes: peaks.map(p => U(p.i)), pitch: opt.pitch || (u1 - u0) };
    let xs = peaks.map(p => p.i);
    const gaps = [];
    for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
    const score = p => gaps.reduce((s, g) => {
      const kk = Math.max(1, Math.round(g / p)), err = Math.abs(g - kk * p) / p;
      return s + Math.exp(-((err / 0.22) ** 2)) - 0.5 * (kk - 1) - (g < 0.6 * p ? 1 : 0);
    }, 0);
    // band width (at half its prominence): neighbouring lanes are at least that far apart
    const halfW = p => { const lim = p.v - p.prom / 2, c = Math.round(p.i); let a = c, b = c; while (a > 0 && q[a - 1] > lim) a--; while (b < w - 1 && q[b + 1] > lim) b++; return b - a + 1; };
    const ws = peaks.map(halfW).sort((a, b) => a - b), wBand = ws[ws.length >> 1];
    // nor narrower than half the spacing the membrane's other rows show
    const cands = new Set(), pMin = Math.max(4, w / 80, P0 ? P0 * 0.45 : 0, wBand * 0.85);
    gaps.forEach(g => [1, 2, 3].forEach(d => { const p = g / d; if (p >= pMin && p <= w / 1.2) cands.add(Math.round(p * 2) / 2); }));
    let pitch = 0, bs = -Infinity;
    for (const p of cands) {
      const s = score(p);
      if (s > bs + 1e-9 || (Math.abs(s - bs) < 1e-9 && p > pitch)) { bs = s; pitch = p; }
    }
    // the membrane's spacing (read from all its rows) stands unless this box's lanes keep another one
    // throughout: gaps that are whole multiples of it are empty lanes, and a few peaks of a faint band, or of
    // noise, do not overrule it. Bands wider than it say it is not this membrane's spacing after all.
    const p0ok = P0 >= 4 && P0 >= wBand * 0.85;
    if (p0ok) {
      const ratio = pitch / P0, kr = Math.round(ratio);
      const multiple = kr >= 1 && Math.abs(ratio - kr) < 0.12 * kr;
      const steady = pitch > 0 && gaps.length >= 3 && gaps.every(g => { const kk = Math.max(1, Math.round(g / pitch)); return Math.abs(g - kk * pitch) / pitch < 0.15; });
      if (multiple || !steady) pitch = P0;
    }
    if (!(pitch > 0)) pitch = Math.max(4, wBand * 1.4);
    // peaks closer than 0.6 lanes are one lane (a doublet, a band with a dip, a smile): their weighted middle
    const kept = [];
    peaks.forEach(p => {
      const pv = kept[kept.length - 1];
      if (pv && p.i - pv.x < 0.6 * pitch) { const wsum = pv.w + p.prom; pv.x = (pv.x * pv.w + p.i * p.prom) / wsum; pv.w = wsum; }
      else kept.push({ x: p.i, w: p.prom });
    });
    xs = kept.map(c => c.x);
    // least-squares lattice x = o + P*k over the lanes with a band
    const idx = xs.map(x => Math.round((x - xs[0]) / pitch));
    let P = pitch, O = xs[0];
    const n = xs.length, sk = idx.reduce((a, b) => a + b, 0), sx = xs.reduce((a, b) => a + b, 0);
    const skk = idx.reduce((a, b) => a + b * b, 0), skx = idx.reduce((a, b, i) => a + b * xs[i], 0), den = n * skk - sk * sk;
    if (new Set(idx).size >= 3 && den > 0) { const b = (n * skx - sk * sx) / den; if (Math.abs(b / pitch - 1) < 0.08) P = b; }
    O = (sx - P * sk) / n;
    const lanes = [];
    for (let kk = 0; kk <= idx[idx.length - 1]; kk++) {
      const c = O + P * kk;
      // centroid of the lane's own signal when it has one (lanes drift a little); the lattice when empty
      const a = clamp(Math.round(c - P * 0.3), 0, w - 1), b = clamp(Math.round(c + P * 0.3), 0, w - 1);
      let lo = Infinity, sw = 0, sxw = 0;
      for (let x = a; x <= b; x++) lo = Math.min(lo, q[x]);
      for (let x = a; x <= b; x++) { const v = q[x] - lo; sw += v; sxw += v * x; }
      let cx = sw > 0 && sw / (b - a + 1) > mx * 0.08 ? sxw / sw : c;
      if (Math.abs(cx - c) > P * 0.2) cx = c;
      lanes.push(U(cx));
    }
    // a sliver of the neighbouring lane cut by the box edge is not a lane of this box
    const Pu = P * step;
    while (lanes.length > 1 && lanes[0] - u0 < Pu * 0.2) lanes.shift();
    while (lanes.length > 1 && u1 - lanes[lanes.length - 1] < Pu * 0.2) lanes.pop();
    return { lanes, pitch: Pu };
  }

  /* The band of a row inside its box: down the lanes' cores, a peak above the box's background and its extent
   * at 35 % of the peak height. us: lane centres; hw: half width of a lane core. With `near` (a position the
   * band was at), the band closest to it among those at least half as strong as the strongest; else the
   * strongest. Returns {v, v0, v1, rel} (frame units) or null. */
  function bandInBox(sig, F, us, hw, v0, v1, near) {
    if (!us.length || !(v1 - v0 > 4)) return null;
    const step = Math.max(0.5, (v1 - v0) / 300), n = Math.max(3, Math.round((v1 - v0) / step)), prof = new Float32Array(n);
    const du = Math.max(1, hw / 6);
    for (let j = 0; j < n; j++) {
      const v = v0 + (j + 0.5) * step;
      let s = 0, c = 0;
      us.forEach(u => { for (let d = -hw; d <= hw + 1e-6; d += du) { const [x, y] = toImg(F, u + d, v), val = bilinear(sig, x, y); if (!isNaN(val)) { s += val; c++; } } });
      prof[j] = c ? s / c : 0;
    }
    const sm = gaussSmooth(prof, 1), srt = Array.from(sm).sort((a, b) => a - b), bg = srt[Math.floor(n * 0.3)];
    let pk = 0; for (let j = 1; j < n; j++) if (sm[j] > sm[pk]) pk = j;
    if (!(sm[pk] - bg > 0)) return null;
    if (near != null) {
      const jn = (near - v0) / step - 0.5;
      findPeaks(sm, 3, 0).filter(p => p.v - bg >= (sm[pk] - bg) * 0.5)
        .forEach(p => { if (Math.abs(p.i - jn) < Math.abs(pk - jn)) pk = p.i; });
    }
    const top = sm[pk] - bg;
    const lim = bg + top * 0.35;
    let a = pk, b = pk;
    while (a > 0 && sm[a - 1] > lim) a--;
    while (b < n - 1 && sm[b + 1] > lim) b++;
    let sw = 0, sv = 0; for (let j = a; j <= b; j++) { const wt = sm[j] - lim; sw += wt; sv += wt * j; }
    const c = sw > 0 ? sv / sw : pk;
    return { v: v0 + (c + 0.5) * step, v0: v0 + a * step, v1: v0 + (b + 1) * step, rel: top };
  }

  /* exposure quality of a row in one picture (full resolution). parts: one per piece the row lies on,
   * {F: piece frame, u0, u1: lanes, vTop, vBot: crop, b0, b1: band} */
  function evalExposure(img, cs, parts, factor) {
    const band = [], bg = [], diffs = [];
    let sat = 0;
    const satAt = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 1 || yi < 1 || xi >= img.w - 1 || yi >= img.h - 1) return false; return cs.sig[yi * img.w + xi] >= cs.clip - 1e-6; };
    parts.forEach(p => {
      for (let v = p.vTop; v <= p.vBot; v += 1) {
        let prev = NaN, prev2 = NaN;
        for (let u = p.u0; u <= p.u1; u += 1) {
          const [x, y] = toImg(p.F, u, v);
          const xi = Math.round(x), yi = Math.round(y);
          if (xi < 0 || yi < 0 || xi >= img.w || yi >= img.h) { prev = prev2 = NaN; continue; }
          const val = cs.sig[yi * img.w + xi];
          if (v >= p.b0 - 2 && v <= p.b1 + 2) {
            band.push(val);
            // clipped pixel with clipped neighbours (single hot pixels are ignored)
            if (cs.clip !== Infinity && val >= cs.clip - 1e-6) {
              let nb = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (satAt(x + dx, y + dy)) nb++;
              if (nb >= 2) sat++;
            }
            prev = prev2 = NaN;
          } else {
            bg.push(val);
            // pixel noise from differences 2 px apart: smooth smears and gradients do not count as noise
            if (!isNaN(prev2)) diffs.push(Math.abs(val - prev2));
            prev2 = prev; prev = val;
          }
        }
      }
    });
    bg.sort((a, b) => a - b); band.sort((a, b) => a - b);
    const q = (a, p) => (a.length ? a[clamp(Math.round(p * (a.length - 1)), 0, a.length - 1)] : 0);
    const bgMed = q(bg, 0.5), bgSig = Math.max(1e-5, (q(bg, 0.84) - q(bg, 0.16)) / 2);
    const peak = q(band, 0.995);
    // pixel noise: mean |difference| of the lower 90 % (dust and edges left out), as a Gaussian sigma;
    // a mean rather than a median, which is 0 on the quantized background of 8-bit exports
    diffs.sort((a, b) => a - b);
    const nd = Math.max(1, Math.floor(diffs.length * 0.9));
    let sd = 0; for (let i = 0; i < nd && i < diffs.length; i++) sd += diffs[i];
    // (E|d| = 2σ/√π for the difference of two samples; the 90 % trimmed mean is 0.823 of the full mean)
    const noise = diffs.length ? Math.max(1e-5, (sd / nd) / 0.823 * Math.sqrt(Math.PI) / 2) : bgSig;
    return { sat, satFrac: band.length ? sat / band.length : 0, snr: (peak - bgMed) / bgSig, peak, bgMed, bgSig, noise, factor };
  }
  /* Pick the picture that shows a row best, judged on that row alone (pieces of one membrane are often
   * developed or imaged at different times, so a global short->long order does not hold).
   * Strong but unclipped bands, good SNR, clean background. A small clipped core is tolerated:
   * display-scaled exports (e.g. iBright 8-bit) clip strong bands in almost every picture. */
  function exposureScore(e) {
    if (e.snr < 4) return -1 + e.snr / 100;
    const contrast = Math.max(0, e.peak - e.bgMed);
    const s = contrast * Math.min(1, e.snr / 20) * Math.max(0, 1 - e.satFrac * 10) * Math.max(0, 1 - e.bgMed * 2);
    // publication first: a clean picture (no clipped band pixels, enough signal and grey levels) beats any clipped one
    return s + (isCleanExposure(e) ? 1 : 0);
  }
  const isCleanExposure = e => e.satFrac <= 0.002 && e.snr >= 15 && e.peak - e.bgMed >= 0.15;
  function chooseExposure(ex) {
    let best = 0, bs = -Infinity;
    ex.forEach((e, i) => { const s = exposureScore(e) + (e.factor || 0) * 1e-6; if (s > bs) { bs = s; best = i; } });
    return best;
  }

  /* display levels for one image from the rows that use it (applied to the whole image) */
  function autoLevels(cs, rowsUsing) {
    let bg = [], band = [];
    rowsUsing.forEach(r => { const e = r.expoOf(cs); bg.push(e.bgMed); band.push(e.peak); });
    if (!bg.length) return { black: 0, white: Math.max(0.01, cs.max) };
    const bgMed = Math.min(...bg);
    let white = Math.max(...band) * 1.04;
    if (cs.clip !== Infinity) white = Math.min(white, cs.clip);
    white = Math.max(white, bgMed + 0.01);
    // keep the background a light grey rather than paper white (about 7% of the range)
    const black = Math.max(0, (bgMed - 0.07 * white) / 0.93);
    return { black, white };
  }

  /* densitometry: lane volume above local background, in the chosen image.
   * lanes: [{F, uc, hw, vTop, vBot, b0, b1} | null] (null = no lane in that column) */
  function densitometry(img, cs, lanes) {
    return lanes.map(L => {
      if (!L) return null;
      const vals = [], bgs = []; let sat = 0;
      for (let v = L.vTop; v <= L.vBot; v += 1) for (let u = L.uc - L.hw; u <= L.uc + L.hw; u += 1) {
        const [x, y] = toImg(L.F, u, v);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= img.w || yi >= img.h) continue;
        const val = cs.sig[yi * img.w + xi];
        if (v >= L.b0 - 2 && v <= L.b1 + 2) { vals.push(val); if (val >= cs.clip - 1e-6) sat++; } else bgs.push(val);
      }
      bgs.sort((a, b) => a - b);
      const bg = bgs.length ? bgs[bgs.length >> 1] : 0;
      let vol = 0; vals.forEach(v => { vol += Math.max(0, v - bg); });
      return { volume: vol, saturated: sat > 0 };
    });
  }

  /* ---------- the same membrane photographed again after it was moved: rigid registration ----------
   * A transform T = {a, tx, ty} (degrees, full-resolution px) takes a point p of the reference picture to the
   * same point of the membrane in another picture: R(a)·(p − C) + C + t, C = centre of the picture. Exposures
   * are compared by their bands, white-light photos by the edges of the membrane and the ladder. A coarse
   * search (phase correlation over a few angles at ~200 px) is refined by normalised correlation at ~640 px;
   * the same refinement on one piece's window gives each piece of a cut membrane a transform of its own. */
  const pow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };
  const twiddles = new Map();
  function fft(re, im, inv) {
    const n = re.length;
    let tw = twiddles.get(n);
    if (!tw) {
      tw = { c: new Float64Array(n >> 1), s: new Float64Array(n >> 1) };
      for (let k = 0; k < n >> 1; k++) { tw.c[k] = Math.cos(2 * Math.PI * k / n); tw.s[k] = -Math.sin(2 * Math.PI * k / n); }
      twiddles.set(n, tw);
    }
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
        const wr = tw.c[k * step], wi = inv ? -tw.s[k * step] : tw.s[k * step];
        const a = i + k, b = a + half, xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
  // 2-D FFT of N×M (row length N); rows past `rows` are all zero (padding) and skipped in the first pass
  function fft2(re, im, N, M, inv, rows) {
    const r = new Float64Array(N), i2 = new Float64Array(N);
    for (let y = 0; y < (rows || M); y++) {
      const o = y * N;
      for (let x = 0; x < N; x++) { r[x] = re[o + x]; i2[x] = im[o + x]; }
      fft(r, i2, inv);
      for (let x = 0; x < N; x++) { re[o + x] = r[x]; im[o + x] = i2[x]; }
    }
    const c = new Float64Array(M), ci = new Float64Array(M);
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < M; y++) { c[y] = re[y * N + x]; ci[y] = im[y * N + x]; }
      fft(c, ci, inv);
      for (let y = 0; y < M; y++) { re[y * N + x] = c[y]; im[y * N + x] = ci[y]; }
    }
  }
  // what registration compares, at 1/f: the bands of an exposure (img = its signal), the edges of the membrane
  // and the ladder in a white-light photo
  function regFeature(img, kind, f) {
    const d = down(img, f), { w, h } = d;
    let out;
    if (kind === 'chemi') {
      out = tophat(d.data, w, h, Math.max(3, Math.round(40 / f)));
      for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(out[i]);
    } else {
      const b = blur2d(d.data, w, h, 1.2);
      out = new Float32Array(w * h);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; out[i] = Math.hypot(b[i + 1] - b[i - 1], b[i + w] - b[i - w]); }
    }
    return { w, h, data: out, f, W: img.w, H: img.h };
  }
  // the picture centre in feature px (feature px x ↔ full-resolution f·x + (f − 1)/2)
  const regC = F => [(F.W / 2 - (F.f - 1) / 2) / F.f, (F.H / 2 - (F.f - 1) / 2) / F.f];
  const rot = (deg, x, y) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c * x - s * y, s * x + c * y]; };
  // T about centre c (any units) re-expressed about centre d: R(p − c) + c + t = R(p − d) + d + t'
  function regRecentre(T, c, d) {
    const [rx, ry] = rot(T.a, d[0] - c[0], d[1] - c[1]);
    return { a: T.a, tx: T.tx + c[0] - d[0] + rx, ty: T.ty + c[1] - d[1] + ry };
  }
  // mov (same size as the reference) on the reference grid under T (feature px, about c)
  function regResample(mov, T, c) {
    const { w, h } = mov, out = new Float32Array(w * h), a = T.a * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - c[0], dy = y - c[1], v = bilinear(mov, c[0] + co * dx - si * dy + T.tx, c[1] + si * dx + co * dy + T.ty);
      out[y * w + x] = isNaN(v) ? 0 : v;
    }
    return { w, h, data: out };
  }
  // spectrum of a feature, mean-free and tapered towards the edges (the frame of the picture is no feature)
  function regSpectrum(F, N, M) {
    const { w, h, data } = F, re = new Float64Array(N * M), im = new Float64Array(N * M);
    let m = 0; for (let i = 0; i < w * h; i++) m += data[i]; m /= w * h;
    const bw = Math.max(2, Math.round(Math.min(w, h) * 0.08));
    const tp = (i, n) => { const d = Math.min(i, n - 1 - i); return d >= bw ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * (d + 0.5) / bw); };
    for (let y = 0; y < h; y++) { const ty = tp(y, h); for (let x = 0; x < w; x++) re[y * N + x] = (data[y * w + x] - m) * ty * tp(x, w); }
    fft2(re, im, N, M, false, h);
    return { re, im };
  }
  // shifts s with ref(q) ≈ mov(q + s) by phase correlation: the k highest peaks (height 0..1), strongest first
  function regPeaks(A, B, N, M, k) {
    const n = N * M, re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const xr = A.re[i] * B.re[i] + A.im[i] * B.im[i], xi = A.re[i] * B.im[i] - A.im[i] * B.re[i], m = Math.hypot(xr, xi);
      if (m > 1e-12) { re[i] = xr / m; im[i] = xi / m; }
    }
    fft2(re, im, N, M, true);
    const at = (x, y) => re[((y + M) % M) * N + ((x + N) % N)];
    const sub = (l, c, r) => { const d = l - 2 * c + r; return d < 0 ? clamp(0.5 * (l - r) / d, -0.5, 0.5) : 0; };
    // local maxima (3×3), the k highest
    const top = [];
    for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) {
      const v = re[y * N + x];
      if (top.length >= k && v <= top[top.length - 1].v) continue;
      if (v < at(x - 1, y) || v < at(x + 1, y) || v < at(x, y - 1) || v < at(x, y + 1) || v < at(x - 1, y - 1) || v < at(x + 1, y + 1) || v < at(x - 1, y + 1) || v < at(x + 1, y - 1)) continue;
      top.push({ x, y, v }); top.sort((a, b) => b.v - a.v); if (top.length > k) top.pop();
    }
    return top.map(({ x, y, v }) => {
      let sx = x + sub(at(x - 1, y), v, at(x + 1, y)), sy = y + sub(at(x, y - 1), v, at(x, y + 1));
      if (sx > N / 2) sx -= N; if (sy > M / 2) sy -= M;
      return { sx, sy, peak: v / n };
    });
  }
  /* coarse candidates (feature px, about the picture centre) over the candidate angles: the few highest peaks
   * of all angles — a regular pattern of lanes also correlates one lane off, so the refinement decides */
  function regCoarse(ref, mov, angles, keep, near) {
    const N = pow2(ref.w), M = pow2(ref.h), c = regC(ref), A = regSpectrum(ref, N, M);
    let all = [];
    (angles || [-10, -8, -6, -4, -2.5, -1.2, 0, 1.2, 2.5, 4, 6, 8, 10]).forEach(a => {
      regPeaks(A, regSpectrum(regResample(mov, { a, tx: 0, ty: 0 }, c), N, M), N, M, near ? 12 : 3).forEach(p => {
        const [tx, ty] = rot(a, p.sx, p.sy);
        if (!near || near({ a, tx, ty })) all.push({ a, tx, ty, peak: p.peak });
      });
    });
    all.sort((p, q) => q.peak - p.peak);
    // one candidate per place: the same shift at neighbouring angles is the same candidate
    const out = [];
    all.forEach(p => { if (out.length < (keep || 5) && !out.some(o => Math.hypot(o.tx - p.tx, o.ty - p.ty) < 2.5 && Math.abs(o.a - p.a) < 3)) out.push(p); });
    return out;
  }
  // sample points of a feature: its strongest pixels and a sparse grid over the rest, optionally only those
  // where keep(x, y) holds
  function regPoints(F, keep, max) {
    const { w, h, data } = F, pick = [];
    const vals = []; for (let i = 0; i < w * h; i += 3) vals.push(data[i]);
    vals.sort((a, b) => a - b);
    const thr = Math.max(1e-9, vals[Math.floor(vals.length * 0.88)]);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      if ((data[i] >= thr || (x % 4 === 0 && y % 4 === 0)) && (!keep || keep(x, y))) pick.push(i);
    }
    if (pick.length <= (max || 12000)) return pick;
    const k = pick.length / (max || 12000), out = [];
    for (let j = 0; j < pick.length; j += k) out.push(pick[Math.floor(j)]);
    return out;
  }
  // normalised correlation of ref and mov under T (about c) over the sample points that fall inside the other
  // picture (a membrane moved partly out of view still matches), scaled down when that is under 85 % of them
  // (a small overlap does not make a good match)
  function regNcc(ref, mov, T, c, pts) {
    const a = T.a * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), w = ref.w, mw = mov.w, mh = mov.h, md = mov.data, rd = ref.data;
    const ox = c[0] + T.tx - co * c[0] + si * c[1], oy = c[1] + T.ty - si * c[0] - co * c[1];
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let k = 0; k < pts.length; k++) {
      const i = pts[k], x = i % w, y = (i - x) / w, X = ox + co * x - si * y, Y = oy + si * x + co * y;
      if (X < 0 || Y < 0 || X > mw - 1 || Y > mh - 1) continue;
      const x0 = Math.min(mw - 2, X | 0), y0 = Math.min(mh - 2, Y | 0), fx = X - x0, fy = Y - y0, j = y0 * mw + x0;
      const v = (md[j] * (1 - fx) + md[j + 1] * fx) * (1 - fy) + (md[j + mw] * (1 - fx) + md[j + mw + 1] * fx) * fy, u = rd[i];
      n++; sa += u; sb += v; saa += u * u; sbb += v * v; sab += u * v;
    }
    if (n < 30) return -1;
    const cov = sab - sa * sb / n, va = saa - sa * sa / n, vb = sbb - sb * sb / n;
    return (va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0) * Math.min(1, n / (0.85 * pts.length));
  }
  // compass search for the best correlation near T0 (feature px, about c); turning about the middle of the
  // compared region (pivot) keeps angle and shift from trading off against each other
  function regRefine(ref, mov, T0, c, pts, opt) {
    opt = opt || {};
    const piv = opt.pivot || c;
    let T = regRecentre(T0, c, piv), best = regNcc(ref, mov, regRecentre(T, piv, c), c, pts);
    let st = opt.step || 1.5, sa = opt.aStep || 0.4;
    const minSt = opt.minStep || 0.06, minA = opt.minAStep || 0.015;
    for (let it = 0; it < 80 && (st > minSt || sa > minA); it++) {
      let moved = false;
      for (const [k, d] of [['tx', st], ['tx', -st], ['ty', st], ['ty', -st], ['a', sa], ['a', -sa]]) {
        if ((k === 'a' && sa <= minA) || (k !== 'a' && st <= minSt)) continue;
        const C = { a: T.a, tx: T.tx, ty: T.ty }; C[k] += d;
        const s = regNcc(ref, mov, regRecentre(C, piv, c), c, pts);
        if (s > best + 1e-7) { best = s; T = C; moved = true; }
      }
      if (!moved) { st /= 2; sa /= 2; }
    }
    return Object.assign(regRecentre(T, piv, c), { ncc: best });
  }
  // feature px about the feature centre <-> full resolution about the picture centre
  const regToFull = (T, F) => ({ a: T.a, tx: T.tx * F.f, ty: T.ty * F.f });
  const regToFeat = (T, F) => ({ a: T.a, tx: T.tx / F.f, ty: T.ty / F.f });
  const regIdentity = { a: 0, tx: 0, ty: 0 };
  // the features of a picture for registration (img = the signal of an exposure): coarse and fine
  function regFeatures(img, kind) {
    const big = Math.max(img.w, img.h);
    return { kind, lo: regFeature(img, kind, Math.max(1, Math.ceil(big / 200))), hi: regFeature(img, kind, Math.max(1, Math.ceil(big / 640))) };
  }
  /* Register a picture to the reference (features of the same kind, regFeatures). Returns the transform in
   * full-resolution px, its correlation (ncc) and that of the pictures as they are (ncc0).
   * opt.init: a transform to start from — the coarse search runs only when that does not fit (or opt.coarse). */
  function registerRigid(R, M, opt) {
    opt = opt || {};
    const ref = R.hi, mov = M.hi, cH = regC(ref), pts = R.pts || (R.pts = regPoints(ref));
    // turn about the centre of what is compared (the membrane)
    if (!R.pivot) { let sw = 0, sx = 0, sy = 0; pts.forEach(i => { const v = ref.data[i]; sw += v; sx += v * (i % ref.w); sy += v * Math.floor(i / ref.w); }); R.pivot = sw > 0 ? [sx / sw, sy / sw] : cH; }
    const pivot = R.pivot, ncc0 = regNcc(ref, mov, regIdentity, cH, pts), T0 = regToFeat(opt.init || regIdentity, ref);
    const cands = [regRefine(ref, mov, T0, cH, pts, { pivot, step: 1, aStep: 0.25 })];
    // a search that wandered far off its start may have stopped on a pattern one lane off: search widely too
    const wandered = regDist(regToFull(cands[0], ref), regToFull(T0, ref), ref.W, ref.H, { x0: 0, y0: 0, x1: ref.W, y1: ref.H }) > Math.max(3 * ref.f, 40);
    if (cands[0].ncc < (opt.fit || 0.6) || wandered || opt.coarse) {
      // every coarse candidate refined roughly, the best one finely
      const quick = regCoarse(R.lo, M.lo, opt.angles, 5).map(C => regRefine(ref, mov, regToFeat(regToFull(C, R.lo), ref), cH, pts, { pivot, step: 2, aStep: 0.5, minStep: 0.4, minAStep: 0.1 }));
      quick.sort((a, b) => b.ncc - a.ncc);
      if (quick.length) cands.push(regRefine(ref, mov, quick[0], cH, pts, { pivot, step: 0.4, aStep: 0.1 }));
    }
    const best = cands.sort((a, b) => b.ncc - a.ncc)[0];
    return Object.assign(regToFull(best, ref), { ncc: best.ncc, ncc0 });
  }
  // largest displacement between two transforms over the corners of a box (full resolution)
  function regDist(A, B, W, H, box) {
    const ma = regMatrix(A, W, H), mb = regMatrix(B, W, H);
    return Math.max(...[[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) =>
      Math.hypot(ma[0] * x + ma[1] * y + ma[2] - (mb[0] * x + mb[1] * y + mb[2]), ma[3] * x + ma[4] * y + ma[5] - (mb[3] * x + mb[4] * y + mb[5]))));
  }
  // A after B (both about the picture centre): R_A R_B (p − C) + C + R_A t_B + t_A
  const regCompose = (A, B) => { const [x, y] = rot(A.a, B.tx, B.ty); return { a: A.a + B.a, tx: x + A.tx, ty: y + A.ty }; };
  const regInverse = T => { const [x, y] = rot(-T.a, T.tx, T.ty); return { a: -T.a, tx: -x, ty: -y }; };
  /* each piece on its own: refine T on the piece's window (pieces in reference coordinates, full resolution).
   * Returns per piece {a, tx, ty, ncc, ncc0} or null where the piece shows too little to tell. */
  function registerPieces(R, M, T, pieces, opt) {
    opt = opt || {};
    const ref = R.hi, mov = M.hi, lo = R.lo, f = ref.f, g = lo.f, cH = regC(ref), cL = regC(lo), m = opt.margin == null ? 10 : opt.margin;
    return pieces.map(pc => {
      const F = frame(pc.cx, pc.cy, pc.angle), box = { x0: pc.cx - pc.w / 2, y0: pc.cy - pc.h / 2, x1: pc.cx + pc.w / 2, y1: pc.cy + pc.h / 2 };
      const on = (x, y, k) => { const [u, v] = toFrame(F, k * x + (k - 1) / 2, k * y + (k - 1) / 2); return Math.abs(u) <= pc.w / 2 + m && Math.abs(v) <= pc.h / 2 + m; };
      const pts = regPoints(ref, (x, y) => on(x, y, f), 6000), ptsL = regPoints(lo, (x, y) => on(x, y, g), 3000);
      if (pts.length < 60 || ptsL.length < 20) return null;
      const pivH = [(pc.cx - (f - 1) / 2) / f, (pc.cy - (f - 1) / 2) / f], pivL = [(pc.cx - (g - 1) / 2) / g, (pc.cy - (g - 1) / 2) / g];
      const ncc0 = regNcc(ref, mov, regToFeat(T, ref), cH, pts);
      // a piece that already fits where the whole membrane went stayed with it
      if (ncc0 >= (opt.fits || 0.95)) return Object.assign({ a: T.a, tx: T.tx, ty: T.ty }, { ncc: ncc0, ncc0 });
      // coarse to fine: broad basins at low resolution first (a long piece's edges alone barely pin it along its length)
      const local = T0 => {
        const a = regRefine(lo, M.lo, regToFeat(T0, lo), cL, ptsL, { pivot: pivL, step: 1, aStep: 0.4, minStep: 0.1, minAStep: 0.05 });
        return regRefine(ref, mov, regToFeat(regToFull(a, lo), ref), cH, pts, { pivot: pivH, step: 0.6, aStep: 0.15 });
      };
      let r = local(T);
      if (r.ncc < ncc0 + 0.02) { const near0 = regRefine(ref, mov, regToFeat(T, ref), cH, pts, { pivot: pivH, step: 0.6, aStep: 0.15 }); if (near0.ncc > r.ncc) r = near0; }
      // put back away from where the rest of the membrane went: the piece's window searched widely, within reach
      if (r.ncc < 0.9 || regDist(regToFull(r, ref), T, ref.W, ref.H, box) > 25) {
        const masked = new Float32Array(lo.data.length);
        for (let y = 0; y < lo.h; y++) for (let x = 0; x < lo.w; x++) if (on(x, y, g)) masked[y * lo.w + x] = lo.data[y * lo.w + x];
        const near = C => regDist(regToFull(C, lo), T, ref.W, ref.H, box) < (opt.reach || 220);
        regCoarse(Object.assign({}, lo, { data: masked }), M.lo, [-4, -2.5, -1.2, 0, 1.2, 2.5, 4].map(d => T.a + d), 4, near).forEach(C => {
          const q = local(regToFull(C, lo));
          if (opt.debug) opt.debug.push(`${pc.cx | 0}: cand ${C.a.toFixed(1)} ${(C.tx * g).toFixed(0)},${(C.ty * g).toFixed(0)} pk${C.peak.toFixed(3)} -> ${q.a.toFixed(2)} ${(q.tx * f).toFixed(0)},${(q.ty * f).toFixed(0)} ncc${q.ncc.toFixed(3)} (have ${r.ncc.toFixed(3)})`);
          if (q.ncc > r.ncc + 0.01) r = q;
        });
      }
      return Object.assign(regToFull(r, ref), { ncc: r.ncc, ncc0 });
    });
  }
  // the affine map of T (full resolution, about the centre of a W×H picture): [x', y'] = [m0 x + m1 y + m2, m3 x + m4 y + m5]
  function regMatrix(T, W, H) {
    const a = T.a * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), cx = W / 2, cy = H / 2;
    return [co, -si, cx + T.tx - co * cx + si * cy, si, co, cy + T.ty - si * cx - co * cy];
  }
  const regPoint = (T, W, H, x, y) => { const m = regMatrix(T, W, H); return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]; };
  // a piece's frame in the other picture
  const regFrame = (T, W, H, pc) => { const [x, y] = regPoint(T, W, H, pc.cx, pc.cy); return { cx: x, cy: y, angle: pc.angle + T.a }; };
  /* a picture resampled onto the reference grid: out(p) = src(T(p)), with the transform of the piece p lies on
   * where pieces have their own (pieces: [{cx, cy, angle, w, h, T}] in reference coordinates); fill outside.
   * clip: where the nearest source pixel is clipped the output is too (interpolation would hide saturation) */
  function regWarp(src, T, pieces, fill, clip) {
    const { w, h, data: d } = src, out = new Float32Array(w * h), q = 8;
    const mats = [regMatrix(T, w, h)].concat((pieces || []).map(p => regMatrix(p.T, w, h)));
    // which transform each 8×8 cell takes: the piece it lies on (closest edge if several), else the whole
    const gw = Math.ceil(w / q), gh = Math.ceil(h / q), lab = new Uint8Array(gw * gh);
    if (pieces && pieces.length) {
      const fr = pieces.map(p => frame(p.cx, p.cy, p.angle));
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        let best = 0, bd = 24;
        pieces.forEach((p, k) => {
          const [u, v] = toFrame(fr[k], gx * q + q / 2, gy * q + q / 2), dd = Math.max(Math.abs(u) - p.w / 2, Math.abs(v) - p.h / 2);
          if (dd < bd) { bd = dd; best = k + 1; }
        });
        lab[gy * gw + gx] = best;
      }
    }
    for (let y = 0; y < h; y++) {
      const gy = Math.floor(y / q) * gw;
      for (let x = 0; x < w; x++) {
        const m = mats[lab[gy + Math.floor(x / q)]], X = m[0] * x + m[1] * y + m[2], Y = m[3] * x + m[4] * y + m[5];
        if (X < 0 || Y < 0 || X > w - 1 || Y > h - 1) { out[y * w + x] = fill; continue; }
        const x0 = Math.min(w - 2, X | 0), y0 = Math.min(h - 2, Y | 0), fx = X - x0, fy = Y - y0, j = y0 * w + x0;
        out[y * w + x] = clip !== undefined && d[j + (fy >= 0.5 ? w : 0) + (fx >= 0.5 ? 1 : 0)] >= clip - 1e-6 ? clip
          : (d[j] * (1 - fx) + d[j + 1] * fx) * (1 - fy) + (d[j + w] * (1 - fx) + d[j + w + 1] * fx) * fy;
      }
    }
    return out;
  }

  G.WB = {
    fft, fft2, regFeature, regFeatures, regCoarse, regRefine, regNcc, regPoints, registerRigid, registerPieces, regMatrix, regPoint, regFrame, regWarp, regC,
    regDist, regCompose, regInverse,
    down, tophat, blur2d, median3, components, otsu, mad, bilinear, frame, toImg, toFrame, sampleWindow,
    exposureFromName, classify, chemiSignal, groupSessions, stem, findStrips, stripFrame, inStrip,
    pitchFromGaps, latticeOrigin, pieceLattice, assignColumns, calibrateLadder, calibrate, fitSeries, piecesInPlace, kdaAt, vAt, kdaAtK, vAtK,
    analyzeSession, detectRows, regionsFromSignal, findLadderInStrip, findLadders, detectBoxLanes, bandInBox,
    evalExposure, chooseExposure, exposureScore, isCleanExposure, autoLevels, densitometry
  };
})(window);
