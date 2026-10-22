/* Export: PNG (resolution + sRGB + an embedded processing summary), TIFF (LZW, grayscale), SVG.
 * Follows GelFigure 0.6.5's export module (the gel-specific uncropped image and log live in BlotFigure's own
 * wbapp / wbui). */
(function (G) {
  'use strict';
  const L = G.L || (zh => zh);

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---- PNG chunks ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  const latin1 = s => Uint8Array.from(String(s), ch => { const c = ch.charCodeAt(0); return c < 256 ? c : 63; });
  // iTXt keeps UTF-8 (Chinese protein and lane names survive)
  function itxt(key, text) {
    const k = latin1(key), t = new TextEncoder().encode(text);
    const d = new Uint8Array(k.length + 5 + t.length);
    d.set(k, 0); d.set(t, k.length + 5);   // keyword\0, compression flag 0, method 0, empty lang\0, empty translated\0
    return chunk('iTXt', d);
  }
  /* pHYs (dpi), sRGB and text right after IHDR. dpi is the pixel density of THIS raster (text and lines are
   * rendered at it); the bands' own effective resolution is written in the summary and checked before export,
   * never passed off as the raster's. */
  async function pngDecorate(blob, dpi, texts) {
    const src = new Uint8Array(await blob.arrayBuffer());
    const ppm = Math.round(dpi / 0.0254), ph = new Uint8Array(9), dv = new DataView(ph.buffer);
    dv.setUint32(0, ppm); dv.setUint32(4, ppm); ph[8] = 1;
    const parts = [chunk('pHYs', ph), chunk('sRGB', Uint8Array.of(0))];
    Object.entries(texts || {}).forEach(([k, v]) => parts.push(itxt(k, v)));
    // the encoder's own chunks, without the ones replaced (each may appear only once; iCCP and sRGB exclude
    // each other), ours right after IHDR
    const keep = [src.subarray(0, 33)];
    for (let p = 33; p + 8 <= src.length;) {
      const len = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
      const type = String.fromCharCode(src[p + 4], src[p + 5], src[p + 6], src[p + 7]);
      if (!['pHYs', 'sRGB', 'iCCP', 'gAMA', 'cHRM'].includes(type)) keep.push(src.subarray(p, p + 12 + len));
      p += 12 + len;
    }
    return new Blob([keep[0], ...parts, ...keep.slice(1)], { type: 'image/png' });
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
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(L('SVG 栅格化失败', 'Could not rasterise the SVG'))); };
      img.src = url;
    });
  }

  // texts: PNG text chunks, e.g. {Software, Description}
  async function exportPNG(svg, wPt, hPt, dpi, name, texts) {
    const c = await svgToCanvas(svg, wPt, hPt, dpi);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    download(await pngDecorate(blob, dpi, texts), name);
  }

  // ---- TIFF (8-bit grayscale, LZW, with resolution) ----
  function lzwEncode(bytes) {
    const out = []; let acc = 0, nacc = 0, width = 9;
    const emit = c => { acc = (acc << width) | c; nacc += width; while (nacc >= 8) { out.push((acc >>> (nacc - 8)) & 255); nacc -= 8; } acc &= (1 << nacc) - 1; };
    let dict = new Map(), next = 258;
    emit(256);
    let w = bytes[0];
    for (let i = 1; i < bytes.length; i++) {
      const c = bytes[i], key = w * 256 + c;
      const hit = dict.get(key);
      if (hit !== undefined) { w = hit; continue; }
      emit(w);
      dict.set(key, next++);
      if (next > (1 << width) - 1 && width < 12) width++;
      if (next >= 4094) { emit(256); dict = new Map(); next = 258; width = 9; }
      w = c;
    }
    // the reader adds a table entry for this last code before it reads the end code, so the end code must
    // already use the wider code if that entry crosses a width boundary (as libtiff writes it)
    emit(w);
    if (bytes.length > 1 && ++next > (1 << width) - 1 && width < 12) width++;
    emit(257);
    if (nacc) out.push((acc << (8 - nacc)) & 255);
    return Uint8Array.from(out);
  }
  // one strip per ~64 KB of pixels keeps every LZW stream small and readers happy
  function encodeTiffGray(gray, w, h, dpi, desc, software) {
    const rps = Math.max(1, Math.floor(65536 / w)), nStrips = Math.ceil(h / rps);
    const strips = [];
    for (let s = 0; s < nStrips; s++) strips.push(lzwEncode(gray.subarray(s * rps * w, Math.min(h, (s + 1) * rps) * w)));
    // TIFF ASCII fields are 7-bit: the summary is JSON, so other characters (Chinese names, ≈) are written as
    // \u escapes and nothing is lost
    const ascii = s => String(s).replace(/[^\x00-\x7f]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    const d = latin1(ascii(desc || '')), sw = latin1(software || 'BlotFigure');
    const tags = 14;
    let off = 8 + 2 + tags * 12 + 4;
    const resOff = off; off += 16;
    const soOff = off; off += 4 * nStrips;
    const sbOff = off; off += 4 * nStrips;
    const descOff = off; off += d.length + 1;
    const swOff = off; off += sw.length + 1;
    const dataOff = off;
    const total = dataOff + strips.reduce((n, s) => n + s.length, 0);
    const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    let p = 8; dv.setUint16(p, tags, true); p += 2;
    const tag = (t, type, count, val) => { dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true); if (type === 3 && count === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true); p += 12; };
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 8); tag(259, 3, 1, 5); tag(262, 3, 1, 1);
    tag(270, 2, d.length + 1, descOff);
    tag(273, 4, nStrips, nStrips === 1 ? dataOff : soOff);
    tag(277, 3, 1, 1); tag(278, 4, 1, rps);
    tag(279, 4, nStrips, nStrips === 1 ? strips[0].length : sbOff);
    tag(282, 5, 1, resOff); tag(283, 5, 1, resOff + 8); tag(296, 3, 1, 2);
    tag(305, 2, sw.length + 1, swOff);
    dv.setUint32(p, 0, true);
    dv.setUint32(resOff, dpi, true); dv.setUint32(resOff + 4, 1, true); dv.setUint32(resOff + 8, dpi, true); dv.setUint32(resOff + 12, 1, true);
    u8.set(d, descOff); u8.set(sw, swOff);
    let q = dataOff;
    strips.forEach((s, i) => { if (nStrips > 1) { dv.setUint32(soOff + 4 * i, q, true); dv.setUint32(sbOff + 4 * i, s.length, true); } u8.set(s, q); q += s.length; });
    return buf;
  }
  // texts: {Software, Description} as for PNG
  async function exportTIFF(svg, wPt, hPt, dpi, name, texts) {
    const c = await svgToCanvas(svg, wPt, hPt, dpi);
    const id = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = c.width * c.height;
    const g = new Uint8Array(n);
    for (let i = 0; i < n; i++) g[i] = Math.round(0.299 * id[i * 4] + 0.587 * id[i * 4 + 1] + 0.114 * id[i * 4 + 2]);
    const t = texts || {};
    download(new Blob([encodeTiffGray(g, c.width, c.height, dpi, t.Description, t.Software)], { type: 'image/tiff' }), name);
  }

  function exportSVG(svg, name) {
    download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }), name);
  }

  G.Export = { download, exportPNG, exportTIFF, exportSVG, svgToCanvas, pngDecorate, encodeTiffGray };
})(window);
