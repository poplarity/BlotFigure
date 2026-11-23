import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPptx as readZip } from './pptx-read.mjs';

function makePaletteTiff(w, h, bits, idx, cmap, opt = {}) {
  const packed = bits < 8, rowB = Math.ceil(w * bits / 8);
  const raw = new Uint8Array(packed ? rowB * h : w * h);
  if (packed) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = x * bits, sh = 8 - bits - (bit & 7);
      raw[y * rowB + (bit >> 3)] |= (idx[y * w + x] & ((1 << bits) - 1)) << sh;
    }
  } else raw.set(idx);
  const hasCmap = Array.isArray(cmap);
  const tags = [
    [256, 4, 1, w], [257, 4, 1, h], [258, 3, 1, bits], [259, 3, 1, 1],
    [262, 3, 1, opt.photometric ?? (hasCmap ? 3 : 1)], [273, 4, 1, 0], [277, 3, 1, 1],
    [278, 4, 1, h], [279, 4, 1, raw.length]
  ];
  if (hasCmap) tags.push([320, 3, cmap.length, 0]);
  tags.sort((a, b) => a[0] - b[0]);
  const ifdOff = 8, cmapOff = ifdOff + 2 + tags.length * 12 + 4;
  const dataOff = cmapOff + (hasCmap ? cmap.length * 2 : 0);
  const buf = new ArrayBuffer(dataOff + raw.length), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, tags.length, true);
  tags.forEach(([t, type, count, val], k) => {
    const p = ifdOff + 2 + k * 12;
    dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true);
    const v = t === 273 ? dataOff : t === 320 ? cmapOff : val;
    if (type === 3 && count === 1) dv.setUint16(p + 8, v, true); else dv.setUint32(p + 8, v, true);
  });
  dv.setUint32(ifdOff + 2 + tags.length * 12, 0, true);
  if (hasCmap) cmap.forEach((v, i) => dv.setUint16(cmapOff + i * 2, v, true));
  u8.set(raw, dataOff);
  return buf;
}

function pngChunk(type, data) {
  const buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, 4, 'ascii');
  Buffer.from(data).copy(buf, 8);
  return buf;
}

export async function gelParityChecks(browser, base, root) {
  const results = [], context = await browser.newContext({ viewport: { width: 1650, height: 1000 } }), errors = [];
  let page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const check = async (name, fn) => {
    console.log('gelparity:', name);
    try { await fn(); results.push(['ok', name]); }
    catch (e) { results.push(['FAIL', name, e.message]); }
  };

  try {
    await page.goto(base + '/index.html?lang=en');
    await page.waitForFunction(() => !!window.BApp && !!window.TIFF && !!window.ProteinLadders);

    await check('Clipboard paste loads an image on the start screen', async () => {
      const ok = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 160; c.height = 100;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#eee'; ctx.fillRect(0, 0, 160, 100);
        ctx.fillStyle = '#222'; ctx.fillRect(30, 40, 100, 12);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        const file = new File([blob], '', { type: 'image/png' });
        const dt = new DataTransfer(); dt.items.add(file);
        const ev = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', { value: dt });
        window.dispatchEvent(ev);
        const t0 = Date.now();
        while ((!BApp.S || BApp.S.blots.length < 1 || BApp.images.size < 1) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 40));
        return !!BApp.S && BApp.S.blots.length === 1 && /^pasted_blot_/.test(BApp.images.values().next().value.name);
      });
      assert(ok, 'expected pasted image to load with generated pasted_blot_* name');
    });

    await check('Palette (grey, false-colour, colour) and 4-bit/1-bit TIFFs decode properly', async () => {
      const w = 16, h = 12;
      const idx8 = Array.from({ length: w * h }, (_, i) => i % 256);
      const grey = Array.from({ length: 256 }, (_, i) => i * 257);
      const heat = [...Array.from({ length: 256 }, (_, i) => Math.min(65535, i * 514)), ...Array.from({ length: 256 }, (_, i) => Math.max(0, (i - 80) * 380)), ...Array.from({ length: 256 }, (_, i) => Math.max(0, (i - 170) * 760))];
      const g16 = Array.from({ length: 16 }, (_, i) => i * 4369);
      const idx4 = Array.from({ length: w * h }, (_, i) => i % 16);
      const idx1 = Array.from({ length: w * h }, (_, i) => i % 2);
      const bufs = {
        grey: Array.from(new Uint8Array(makePaletteTiff(w, h, 8, idx8, [...grey, ...grey, ...grey]))),
        heat: Array.from(new Uint8Array(makePaletteTiff(w, h, 8, idx8, heat))),
        b4: Array.from(new Uint8Array(makePaletteTiff(w, h, 4, idx4, [...g16, ...g16, ...g16]))),
        b1: Array.from(new Uint8Array(makePaletteTiff(w, h, 1, idx1, null, { photometric: 1 })))
      };
      const r = await page.evaluate(async bufs => {
        const dec = async arr => TIFF.decodeBuffer(new Uint8Array(arr).buffer, 't.tif');
        const g = await dec(bufs.grey), ht = await dec(bufs.heat), b4 = await dec(bufs.b4), b1 = await dec(bufs.b1);
        return {
          gw: g.width, g0: g.data[0], g1: g.data[10], gWarn: g.warnings.length,
          ht10: ht.data[10], htWarn: ht.warnings[0] || '',
          b4max: b4.actualMax, b1v0: b1.data[0], b1v1: b1.data[1]
        };
      }, bufs);
      assert.equal(r.gw, w);
      assert(Math.abs(r.g1 - 10 / 255) < 1e-4 && r.gWarn === 1);
      assert(Math.abs(r.ht10 - 10 / 255) < 1e-4 && /palette|调色板/i.test(r.htWarn));
      assert(Math.abs(r.b4max - 1) < 1e-4 && r.b1v0 === 0 && r.b1v1 === 1);
    });

    await check('DecompressionStream guard reports clear message for compressed projects', async () => {
      const msg = await page.evaluate(async () => {
        const orig = window.DecompressionStream;
        window.DecompressionStream = undefined;
        try {
          await BApp.openProject({ buffer: Uint8Array.of(0x1f, 0x8b, 0x08, 0x00).buffer });
          return '';
        } catch (e) {
          return e.message;
        } finally {
          window.DecompressionStream = orig;
        }
      });
      assert(/compressed projects|压缩项目/i.test(msg), msg);
    });

    await page.waitForTimeout(100);
    const demoPage = await context.newPage();
    demoPage.on('pageerror', e => errors.push(e.message));
    demoPage.on('dialog', d => d.accept());
    await page.close();
    page = demoPage;
    await page.goto(base + '/index.html?demo=1&lang=en');
    await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 180000 });

    await check('Custom marker parser accepts kDa/Da units and rejects bp/kb', async () => {
      const r = await page.evaluate(() => {
        const ok = ProteinLadders.parseSizes('250kDa, 130 kDa; 15000 Da\n70');
        let err = '';
        try { ProteinLadders.parseSizes('5000bp, 1000bp'); } catch (e) { err = e.message; }
        return { ok, err };
      });
      assert.deepEqual(r.ok, [250, 130, 70, 15]);
      assert(/bp\/kb/i.test(r.err), r.err);
    });

    await check('Searchable marker chooser and starred favourites pin at top and apply cleanly', async () => {
      await page.evaluate(() => UI.openStep(4));
      await page.locator('.ladder-search-btn').first().click();
      await page.locator('#markerModelDlg').waitFor({ state: 'visible' });
      await page.fill('#markerModelSearch', '26619');
      await page.locator('[data-star-id="pr26619"]').click();
      await page.locator('[data-model-id="pr26619"]').click();
      await page.click('#markerModelApply');
      await page.locator('#markerModelDlg').waitFor({ state: 'hidden' });
      const state = await page.evaluate(() => ({
        lad: BApp.S.blots[0].ladderId,
        fav: ProteinLadders.isFavorite('pr26619'),
        firstOptGroup: document.querySelector('.ladder-sel optgroup')?.label || ''
      }));
      assert.equal(state.lad, 'pr26619');
      assert.equal(state.fav, true);
      assert(state.firstOptGroup.includes('★'), state.firstOptGroup);
      await page.evaluate(() => ProteinLadders.setFavorites([]));
    });

    await page.evaluate(() => UI.openStep(5));

    await check('Per-item font weights render in SVG, survive templates, and map >=600 to PPTX bold', async () => {
      await page.locator('#preview g[data-edit="lane"]').first().click();
      await page.fill('#floatEd', 'LaneOne');
      await page.selectOption('#fedWeight', '600');
      await page.locator('#floatEd').press('Enter');
      await page.locator('#floatEd').press('Escape');

      await page.locator('#preview g[data-edit="rowname"]').first().click();
      await page.fill('#floatEd', 'ProtOne');
      await page.selectOption('#fedWeight', '700');
      await page.locator('#floatEd').press('Enter');
      await page.locator('#floatEd').press('Escape');

      await page.evaluate(() => {
        const rs = BApp.rowsInColumn('main');
        BApp.S.conditions = [{ name: 'Dox', weight: 500, values: BApp.S.lanes.map(() => '+') }];
        BApp.S.groups = [{ from: 1, to: 3, text: 'Grp', weight: 700 }];
        BApp.S.arrows = [{ row: rs[0].id, sym: '◀', v: rs[0].segs[0].vc, text: 'Band', auto: false, side: 'right', weight: 600 }];
        BApp.S.brackets = [{ r0: rs[0].id, r1: rs[0].id, f0: 0, f1: 1, text: 'Brk', side: 'left', weight: 700 }];
        BApp.S.style.markerWeight = 600;
        BApp.commit();
      });

      const svg = await page.evaluate(() => BRender.build(false).svg);
      assert(svg.includes('font-weight="500"') && svg.includes('font-weight="600"') && svg.includes('font-weight="700"'), 'expected 500/600/700 weights in SVG');

      const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await PPTX.build()).arrayBuffer())));
      const entries = readZip(Buffer.from(bytes));
      const slide = Buffer.from(entries.get('ppt/slides/slide1.xml')).toString('utf8');
      assert(slide.includes('b="1"'), 'expected bold run in PPTX for >=600');
      // Verify PNG embedded in PPTX has no eXIf chunk
      const media = entries.get('ppt/media/blot1.png');
      assert(media && !Buffer.from(media).includes(Buffer.from('eXIf')), 'expected no eXIf chunk in PPTX PNG');
    });

    await check('Free multiline text box and side text with angle/at render, drag, and export to PPTX', async () => {
      await page.click('#btnNoteText');
      const box = await page.locator('#preview image[data-row]').first().boundingBox();
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
      await page.locator('#notePopover').waitFor({ state: 'visible' });
      await page.fill('#noteText', '5% input\nIgG HC');
      await page.fill('#noteAngle', '-12');
      await page.selectOption('#noteAlign', 'left');
      await page.selectOption('#noteBg', 'white');
      await page.check('#noteBorder');
      await page.check('#noteArrow');
      await page.selectOption('#noteWeight', '700');
      await page.click('#noteDone');

      await page.click('#btnSideText');
      await page.fill('#noteText', 'IB: anti-Flag');
      await page.selectOption('#notePos', 'right');
      await page.fill('#noteAngle', '90');
      await page.locator('#noteAt').fill('25');
      await page.locator('#noteAt').dispatchEvent('input');
      await page.locator('#noteAt').dispatchEvent('change');
      await page.click('#noteDone');

      const svg = await page.evaluate(() => BRender.build(false).svg);
      assert(svg.includes('5% input') && svg.includes('IgG HC') && svg.includes('IB: anti-Flag'));
      assert(svg.includes('rotate(-12)') && svg.includes('rotate(90)'));

      const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await PPTX.build()).arrayBuffer())));
      const slide = Buffer.from(readZip(Buffer.from(bytes)).get('ppt/slides/slide1.xml')).toString('utf8');
      assert(slide.includes('5% input') && slide.includes('IgG HC') && slide.includes('IB: anti-Flag'));
    });

    await check('PNG export strips synthetic eXIf chunks in pngDecorate', async () => {
      const stripped = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 40; c.height = 20;
        const raw = await new Promise(r => c.toBlob(r, 'image/png'));
        const u8 = new Uint8Array(await raw.arrayBuffer());
        // Insert a dummy eXIf chunk after IHDR (byte 33)
        const payload = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]);
        const chunk = new Uint8Array(12 + payload.length);
        new DataView(chunk.buffer).setUint32(0, payload.length);
        chunk.set([0x65, 0x58, 0x49, 0x66], 4); chunk.set(payload, 8);
        const dirty = new Blob([u8.subarray(0, 33), chunk, u8.subarray(33)], { type: 'image/png' });
        const clean = await Export.pngDecorate(dirty, 300, { Software: 'BlotFigureTest' });
        const out = new Uint8Array(await clean.arrayBuffer());
        let hasExif = false;
        for (let p = 33; p + 8 <= out.length;) {
          const len = ((out[p] << 24) | (out[p + 1] << 16) | (out[p + 2] << 8) | out[p + 3]) >>> 0;
          const t = String.fromCharCode(out[p + 4], out[p + 5], out[p + 6], out[p + 7]);
          if (t === 'eXIf') hasExif = true;
          p += 12 + len;
        }
        return !hasExif;
      });
      assert(stripped, 'expected eXIf chunk to be stripped by pngDecorate');
    });

    await check('laneNamesAboveConditions toggle and mwUnit modes (kDa / kDa-inline / none) work', async () => {
      await page.locator('#secNames details.adv').last().evaluate(d => { d.open = true; });
      await page.uncheck('#laneNamesAboveConditions');
      const belowOrder = await page.evaluate(() => {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-9999px;top:0';
        host.innerHTML = BRender.build(false).svg;
        document.body.appendChild(host);
        const laneY = [...host.querySelectorAll('text')].find(t => t.textContent === 'LaneOne')?.getBoundingClientRect().bottom;
        const condY = [...host.querySelectorAll('text')].find(t => t.textContent === 'Dox')?.getBoundingClientRect().bottom;
        host.remove();
        return { laneY, condY };
      });
      assert(Number.isFinite(belowOrder.laneY) && Number.isFinite(belowOrder.condY) && belowOrder.laneY > belowOrder.condY, 'with laneNamesAboveConditions=false, lane names should be lower (closer to blot) than conditions: ' + JSON.stringify(belowOrder));
      await page.check('#laneNamesAboveConditions');

      await page.evaluate(() => {
        const b = BApp.S.blots[0], r = BApp.rowsInColumn('main')[0];
        const sg = r.segs[0], pc = BApp.piece(b, sg.piece);
        pc.marks = [{ id: 'mk_test_1', kda: 50, v: sg.vc }];
        BApp.commit();
      });

      await page.selectOption('#mwUnit', 'kDa-inline');
      let svg = await page.evaluate(() => BRender.build(false).svg);
      assert(svg.includes('50 kDa</text>') && !svg.includes('data-unit-header'), 'expected inline kDa labels without header');

      await page.selectOption('#mwUnit', 'none');
      svg = await page.evaluate(() => BRender.build(false).svg);
      assert(svg.includes('>50</text>') && !svg.includes(' kDa</text>') && !svg.includes('data-unit-header'), 'expected bare numbers without header');

      await page.selectOption('#mwUnit', 'kDa');
      svg = await page.evaluate(() => BRender.build(false).svg);
      assert(svg.includes('data-unit-header') && svg.includes('(kDa)'), 'expected (kDa) header restored');
    });

    await check('Offline single-file build exposes new controls with zero errors', async () => {
      const offCtx = await browser.newContext();
      try {
        await offCtx.setOffline(true);
        const p = await offCtx.newPage(), offErrs = [];
        p.on('pageerror', e => offErrs.push(e.message));
        await p.goto(pathToFileURL(path.join(root, 'dist/BlotFigure.html')).href + '?demo=1&lang=zh');
        await p.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 180000 });
        const has = await p.evaluate(() => ({
          searchBtn: !!document.querySelector('.ladder-search-btn'),
          freeTextBtn: !!document.getElementById('btnNoteText'),
          mwUnit: !!document.getElementById('mwUnit'),
          orderChk: !!document.getElementById('laneNamesAboveConditions'),
          cs: getComputedStyle(document.documentElement).colorScheme
        }));
        assert(has.searchBtn && has.freeTextBtn && has.mwUnit && has.orderChk);
        assert.equal(has.cs, 'light');
        assert.deepEqual(offErrs, []);
      } finally {
        await offCtx.close();
      }
    });

    await check('No unhandled JS errors', async () => assert.deepEqual(errors, []));
  } finally {
    await context.close();
  }
  return results;
}
