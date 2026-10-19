/* Export: SVG, PNG (with DPI metadata), uncropped annotated original, JSON processing log. */
(function (G) {
  'use strict';

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- PNG pHYs (DPI) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  async function pngWithDpi(blob, dpi) {
    const src = new Uint8Array(await blob.arrayBuffer());
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9);
    chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk.subarray(4, 17)));
    const out = new Uint8Array(src.length + 21);
    out.set(src.subarray(0, 33)); out.set(chunk, 33); out.set(src.subarray(33), 54);
    return new Blob([out], { type: 'image/png' });
  }

  function svgToCanvas(svg, wPt, hPt, dpi) {
    return new Promise((resolve, reject) => {
      const scale = dpi / 72;
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(wPt * scale); c.height = Math.round(hPt * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG 栅格化失败')); };
      img.src = url;
    });
  }

  async function exportPNG(svg, wPt, hPt, dpi, name) {
    const c = await svgToCanvas(svg, wPt, hPt, dpi);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    download(await pngWithDpi(blob, dpi), name);
  }

  function exportSVG(svg, name) {
    download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }), name);
  }

  /* Uncropped original for supplementary: full (rotated) image, same levels as figure,
   * crop box + lane labels, hidden lanes marked with X (PLOS style). */
  function exportUncropped(S, fullCanvas, name) {
    const W = fullCanvas.width, H = fullCanvas.height;
    const fs = Math.max(14, Math.round(W / 70));
    const top = fs * 4, bottom = fs * 3.2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H + top + bottom;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(fullCanvas, 0, top);
    const r = S.crop;
    ctx.strokeStyle = '#e53935'; ctx.lineWidth = Math.max(2, W / 600);
    ctx.setLineDash([fs * 0.6, fs * 0.4]);
    ctx.strokeRect(r.x, r.y + top, r.w, r.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#000'; ctx.font = `${fs}px Arial`; ctx.textAlign = 'center';
    S.lanes.forEach((l, i) => {
      const x = r.x + l.x;
      const label = l.hidden ? 'X' : String(i + 1);
      ctx.fillStyle = l.hidden ? '#e53935' : '#000';
      ctx.fillText(label, x, top - fs * 0.5);
    });
    ctx.fillStyle = '#000'; ctx.textAlign = 'left';
    ctx.font = `bold ${fs}px Arial`;
    ctx.fillText('Uncropped original', fs * 0.5, fs * 1.3);
    ctx.font = `${fs * 0.8}px Arial`;
    const lv = S.levels;
    const info = `${S.file.name} · ${S.file.bits}-bit · rotation ${S.rotation}° · levels ${(lv.black * 100).toFixed(2)}–${(lv.white * 100).toFixed(2)}% (linear${lv.gamma !== 1 ? ', gamma ' + lv.gamma : ''})${lv.invert ? ' · inverted' : ''}`;
    ctx.fillText(info, fs * 0.5, H + top + fs * 1.2);
    const key = S.lanes.map((l, i) => `${l.hidden ? 'X' : i + 1}: ${l.name || '—'}`).join('   ');
    ctx.fillText(key, fs * 0.5, H + top + fs * 2.4, W - fs);
    c.toBlob(b => download(b, name), 'image/png');
  }

  function processingLog(S) {
    return {
      tool: 'GelFigure', version: '0.1', exportedAt: new Date().toISOString(),
      source: { file: S.file.name, width: S.src.w, height: S.src.h, bitDepth: S.file.bits },
      rotationDeg: S.rotation,
      crop: S.crop,
      levels: Object.assign({ note: 'linear whole-image stretch; values are fractions of full scale' }, S.levels),
      saturatedPixelsInCrop: S.saturatedInCrop,
      lanes: S.lanes.map((l, i) => ({ lane: i + 1, xInCrop: l.x, name: l.name, removedFromFigure: !!l.hidden })),
      markers: S.markers.map(m => ({ lane: m.lane + 1, ladder: (G.Ladders.get(m.ladderId) || {}).name, bands: m.bands.map(b => ({ bp: b.bp, yInImage: Math.round(b.y * 10) / 10, autoMatched: b.matched, manual: b.manual, labelled: b.show })) })),
      groups: S.groups, conditions: S.conditions, arrows: S.arrows, style: S.style,
      legendHints: legendHints(S)
    };
  }

  function legendHints(S) {
    const h = [];
    if (S.lanes.some(l => l.hidden)) h.push('Lanes were removed from the same gel; splice sites are indicated by ' + (S.style.spliceStyle === 'line' ? 'lines.' : 'white gaps.'));
    if (S.levels.invert) h.push('Image colours were inverted for display.');
    if (S.levels.gamma !== 1) h.push(`A non-linear gamma adjustment (γ = ${S.levels.gamma}) was applied to the whole image.`);
    const names = [...new Set(S.markers.map(m => G.Ladders.get(m.ladderId)).filter(Boolean).map(l => l.name.replace(/\s*\(.*\)/, '')))];
    if (names.length === 1) h.push(`M, ${names[0]}.`);
    else if (names.length > 1) h.push(`M, DNA ladders (${S.markers.map(m => `lane ${m.lane + 1}: ${G.Ladders.get(m.ladderId).name.replace(/\s*\(.*\)/, '')}`).join('; ')}).`);    return h;
  }

  G.Export = { download, exportPNG, exportSVG, exportUncropped, processingLog, legendHints, svgToCanvas };
})(window);
