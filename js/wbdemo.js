/* Synthetic Western blot sessions for the demo button and self-tests.
 * Scenario "cut": one membrane cut into 3 horizontal strips, imaged together roughly in place,
 *   exposures 2 s / 10 s / 60 s + a visible-light marker image. Each protein needs a different exposure.
 * Scenario "scatter": a second membrane, two strips placed apart and tilted, one exposure + marker.
 * Every image comes with ground truth (band rows, lanes, best exposure, ladder positions).
 */
(function (G) {
  'use strict';
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const LADDER = [250, 130, 100, 70, 55, 35, 25, 15, 10];   // generic prestained ladder for the demo

  // strip: {x, y, w, h (membrane coords), dx, dy (placement offset), angle (deg)}
  // protein: {name, kda, amounts[lane], thick, doublet?}
  function makeSession(opts) {
    const o = Object.assign({ W: 1500, H: 1150, lanes: 9, pitch: 92, laneW: 64, x0: 300, runTop: 90, runH: 900,
      exposures: [2, 10, 60], seed: 3 }, opts);
    const rnd = rng(o.seed);
    const yOf = kda => o.runTop + (Math.log(250) - Math.log(kda)) / (Math.log(250) - Math.log(8)) * o.runH;
    // membrane coords -> image coords for a strip
    const place = (s, x, y) => {
      const a = s.angle * Math.PI / 180, cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const u = x - cx, v = y - cy;
      return [cx + s.dx + u * Math.cos(a) - v * Math.sin(a), cy + s.dy + u * Math.sin(a) + v * Math.cos(a)];
    };
    const unplace = (s, X, Y) => {
      const a = -s.angle * Math.PI / 180, cx = s.x + s.w / 2 + s.dx, cy = s.y + s.h / 2 + s.dy;
      const u = X - cx, v = Y - cy;
      return [s.x + s.w / 2 + u * Math.cos(a) - v * Math.sin(a), s.y + s.h / 2 + u * Math.sin(a) + v * Math.cos(a)];
    };
    const laneX = k => o.x0 + k * o.pitch;          // lane 0 = ladder, 1..lanes = samples
    // pre-compute band list in membrane coords
    const bands = [];
    o.proteins.forEach(p => {
      const ys = p.doublet ? [yOf(p.kda) - p.thick * 0.9, yOf(p.kda) + p.thick * 0.9] : [yOf(p.kda)];
      p.amounts.forEach((amt, i) => ys.forEach((y, j) => bands.push({ x: laneX(i + 1), y, amt: amt * (j ? 0.7 : 1), thick: p.thick, p })));
    });
    const ladderBands = LADDER.map(k => ({ x: laneX(0), y: yOf(k), kda: k }));

    function render(kind, expo) {
      const { W, H } = o, d = new Float32Array(W * H);
      for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
        // which strip (if any) covers this pixel
        let s = null, mx = 0, my = 0;
        for (const st of o.strips) {
          const [ux, uy] = unplace(st, X, Y);
          if (ux >= st.x && ux <= st.x + st.w && uy >= st.y && uy <= st.y + st.h) { s = st; mx = ux; my = uy; break; }
        }
        let v;
        if (kind === 'marker') {
          v = s ? 0.78 - 0.04 * (my / H) : 0.08 + 0.03 * (X / W);     // dark tray, as on iBright white-light photos
          if (s) for (const b of ladderBands) {
            if (b.y < s.y || b.y > s.y + s.h) continue;
            const dx = (mx - b.x) / (o.laneW / 2), dy = (my - b.y) / 4.5;
            if (Math.abs(dx) < 1.2) v -= 0.42 * Math.exp(-dy * dy) / (1 + Math.exp((Math.abs(dx) - 1) * 9));
          }
        } else {
          // chemi: dark tray, faint membrane glow, slow gradient
          v = 0.012 + 0.006 * (Y / H) + (s ? 0.008 + 0.004 * Math.sin(mx / 210) : 0);
          if (s) for (const b of bands) {
            if (Math.abs(my - b.y) > b.thick * 4 || Math.abs(mx - b.x) > o.laneW) continue;
            const dx = (mx - b.x) / (o.laneW / 2), smile = 3 * dx * dx;
            const dy = (my - (b.y - smile)) / (b.thick / 2.2);
            v += b.amt * expo * 0.004 * Math.exp(-dy * dy) / (1 + Math.exp((Math.abs(dx) - 1) * 7));
          }
        }
        d[Y * W + X] = v;
      }
      // noise, hot pixels, saturation
      for (let i = 0; i < d.length; i++) {
        let v = d[i] + (rnd() - 0.5) * (kind === 'marker' ? 0.02 : 0.004);
        if (kind !== 'marker' && rnd() < 0.00004) v += 0.5;
        d[i] = Math.min(1, Math.max(0, v));
      }
      return { width: W, height: H, data: d };
    }

    const images = o.exposures.map(t => Object.assign(render('chemi', t), { name: `${o.prefix}_Chemi_${t}s.tif`, exposure: t }));
    images.push(Object.assign(render('marker'), { name: `${o.prefix}_Marker.tif` }));
    // ground truth: band row centres in image coords + best exposure (longest unsaturated)
    const truth = o.proteins.map(p => {
      const s = o.strips.find(st => yOf(p.kda) > st.y && yOf(p.kda) < st.y + st.h);
      const [cx, cy] = place(s, (laneX(1) + laneX(o.lanes)) / 2, yOf(p.kda));
      const peak = Math.max(...p.amounts) * (p.doublet ? 1 : 1);
      const ok = o.exposures.filter(t => peak * t * 0.004 + 0.03 < 0.97);
      return { name: p.name, kda: p.kda, cx, cy, angle: s.angle, bestExposure: ok.length ? Math.max(...ok) : Math.min(...o.exposures),
        laneXs: p.amounts.map((a, i) => place(s, laneX(i + 1), yOf(p.kda))[0]) };
    });
    const ladderTruth = ladderBands.map(b => {
      const s = o.strips.find(st => b.y >= st.y && b.y <= st.y + st.h);
      return s ? { kda: b.kda, xy: place(s, b.x, b.y) } : null;
    }).filter(Boolean);
    return { images, truth, ladderTruth, ladder: LADDER, opts: o };
  }

  const amt = (base, f) => f.map(x => base * x);
  function cutSession() {
    return makeSession({
      prefix: 'Blot1', seed: 3,
      strips: [
        { x: 230, y: 70, w: 1000, h: 300, dx: 0, dy: -10, angle: 0.6 },    // > 70 kDa
        { x: 230, y: 370, w: 1000, h: 250, dx: 4, dy: 8, angle: -0.4 },    // 40-70 kDa
        { x: 230, y: 620, w: 1000, h: 420, dx: -3, dy: 28, angle: 0.3 }    // < 40 kDa
      ],
      proteins: [
        { name: 'mTOR-like', kda: 110, thick: 11, amounts: amt(9, [1, 1.1, 0.9, 0.4, 0.3, 1, 1.2, 0.5, 0.35]) },
        { name: 'p-ERK1/2', kda: 50, thick: 9, doublet: true, amounts: amt(1.6, [0.15, 1, 1.6, 0.2, 0.1, 1.1, 1.8, 0.25, 0.1]) },
        { name: 'GAPDH', kda: 30, thick: 12, amounts: amt(42, [1, 1, 0.95, 1.05, 1, 1, 0.98, 1.02, 1]) }
      ]
    });
  }
  // a membrane cut across into three strips, put back with arbitrary sideways offsets; the top strip is
  // also cut down the middle and its two pieces lie side by side
  function movedSession() {
    return makeSession({
      prefix: 'Blot3', seed: 5,
      strips: [
        { x: 230, y: 70, w: 385, h: 300, dx: 0, dy: -8, angle: 0.4 },
        { x: 621, y: 70, w: 609, h: 300, dx: 3, dy: -8, angle: 0.4 },
        { x: 230, y: 370, w: 1000, h: 250, dx: 130, dy: 10, angle: -0.5 },
        { x: 230, y: 620, w: 1000, h: 420, dx: -75, dy: 30, angle: 0.3 }
      ],
      proteins: [
        { name: 'mTOR-like', kda: 110, thick: 11, amounts: amt(9, [1, 1.1, 0.9, 0.4, 0.3, 1, 1.2, 0.5, 0.35]) },
        { name: 'p-ERK1/2', kda: 50, thick: 9, doublet: true, amounts: amt(1.6, [0.15, 1, 1.6, 0.2, 0.1, 1.1, 1.8, 0.25, 0.1]) },
        { name: 'GAPDH', kda: 30, thick: 12, amounts: amt(42, [1, 1, 0.95, 1.05, 1, 1, 0.98, 1.02, 1]) }
      ]
    });
  }
  function scatterSession() {
    return makeSession({
      prefix: 'Blot2', seed: 9, exposures: [20], W: 1500, H: 1150,
      strips: [
        { x: 230, y: 250, w: 1000, h: 230, dx: -60, dy: -140, angle: 4.5 },
        { x: 230, y: 640, w: 1000, h: 300, dx: 40, dy: 90, angle: -6 }
      ],
      proteins: [
        { name: 'Target-X', kda: 75, thick: 10, amounts: amt(3, [1, 0.2, 0.1, 1.1, 0.9, 0.15, 0.2, 1, 0.05]) },
        { name: 'β-actin', kda: 28, thick: 11, amounts: amt(7, [1, 1, 1, 1, 1, 1, 1, 1, 1]) }
      ]
    });
  }

  // Uncompressed 16-bit grayscale TIFF
  function encodeTiff16(img) {
    const { width: w, height: h, data } = img;
    const nTags = 9, ifdOff = 8, dataOff = ifdOff + 2 + nTags * 12 + 4;
    const buf = new ArrayBuffer(dataOff + w * h * 2), dv = new DataView(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
    let p = ifdOff; dv.setUint16(p, nTags, true); p += 2;
    const tag = (t, type, val) => { dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, 1, true); if (type === 3) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true); p += 12; };
    tag(256, 4, w); tag(257, 4, h); tag(258, 3, 16); tag(259, 3, 1); tag(262, 3, 1);
    tag(273, 4, dataOff); tag(277, 3, 1); tag(278, 4, h); tag(279, 4, w * h * 2);
    dv.setUint32(p, 0, true);
    for (let i = 0; i < w * h; i++) dv.setUint16(dataOff + i * 2, Math.round(data[i] * 65535), true);
    return buf;
  }
  function files(session) { return session.images.map(im => ({ name: im.name, buffer: encodeTiff16(im) })); }

  G.WBDemo = { cutSession, scatterSession, movedSession, encodeTiff16, files, LADDER };
})(window);
