// Regenerate public documentation using synthetic demo data only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href + '?demo=1&ladder=pr26619&lang=en');
  await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 180000 });
  await page.evaluate(() => {
    const S = BApp.S;
    const sessions = { Blot1: WBDemo.cutSession(), Blot2: WBDemo.scatterSession() };
    for (const b of S.blots) {
      const source = BApp.images.get(b.marker);
      const ses = source && sessions[source.name.split('_')[0]];
      if (!ses) throw new Error('Expected a synthetic demo membrane');
      for (const pc of b.pieces) {
        const F = WB.frame(pc.cx, pc.cy, pc.angle);
        const marks = ses.ladderTruth.map(m => {
          const [u, v] = WB.toFrame(F, ...m.xy);
          return { u, v, kda: m.kda };
        }).filter(m => Math.abs(m.u) < pc.w / 2 && Math.abs(m.v) < pc.h / 2);
        BApp.manualMarks(b, pc).push(...marks);
      }
    }
    const visible = S.rows.filter(r => !r.hidden), fl = BApp.figLanes();
    visible.forEach((r, i) => { r.name = ['Target A', 'Target B', 'Loading ctrl', 'Target C', 'Loading ctrl'][i] || 'Target'; });
    fl.forEach((j, k) => { S.lanes[j - 1].name = ['Ctrl', 'siA #1', 'siA #2'][k % 3]; });
    S.groups = [0, 3, 6].filter(i => fl[i + 2]).map((i, k) => ({ from: fl[i], to: fl[i + 2], text: ['0 h', '24 h', '48 h'][k] }));
    S.conditions = [{ name: 'EGF', values: S.lanes.map((_, i) => i % 2 ? '+' : '−') }];
    S.style.fontPt = 7;
    BApp.commit(); UI.openStep(5);
    BApp.selRow = null; BApp.emit('select');
  });
  await page.waitForTimeout(3500); // transient messages should not obscure the documentation
  await page.mouse.move(1590, 990);
  const info = await page.evaluate(() => {
    const f = BRender.build(false);
    return { widthMm: f.w / BApp.MM, heightMm: f.h / BApp.MM, overlaps: f.overlaps.length };
  });
  if (errors.length || info.overlaps) throw new Error(JSON.stringify({ errors, ...info }));
  await page.screenshot({ path: path.join(root, 'docs/screenshot-en.png') });
  const png = await page.evaluate(async () => {
    const f = BRender.build(false), c = await Export.svgToCanvas(f.svg, f.w, f.h, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(path.join(root, 'docs/example-figure.png'), Buffer.from(png, 'base64'));
  await page.click('#btnLang');
  await page.waitForTimeout(300);
  await page.mouse.move(1590, 990);
  await page.screenshot({ path: path.join(root, 'docs/screenshot-zh.png') });
  console.log('Documentation screenshots (synthetic demo only):', info);
} finally { await browser.close(); }
