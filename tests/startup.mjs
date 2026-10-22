/* Startup checks (as GelFigure's) must not supply ?lang=: that would mask a failing storage read. Web, file://
 * and the single file, in real browsers; storage blocked or full must never stop editing. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function startupChecks(browser, base, root) {
  const results = [];
  for (const [label, url, mode] of [
    ['startup and editing with storage blocked', `${base}/index.html`, 'blocked'],
    ['editing when storage quota is full', `${base}/index.html`, 'quota'],
    ['offline folder startup and demo', pathToFileURL(path.join(root, 'index.html')).href, 'file'],
    ['single-file startup and demo without network', pathToFileURL(path.join(root, 'dist/BlotFigure.html')).href, 'bundle'],
  ]) {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
    try {
      if (mode === 'blocked') await ctx.addInitScript(() => {
        for (const key of ['localStorage', 'indexedDB']) Object.defineProperty(window, key, {
          get() { throw new DOMException('Storage is blocked', 'SecurityError'); }
        });
      });
      if (mode === 'quota') await ctx.addInitScript(() => {
        localStorage.setItem('blotfig.lang', 'en');
        Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
      });
      const page = await ctx.newPage(), errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', async d => { errors.push(d.message()); await d.dismiss(); });
      if (mode === 'bundle') {
        page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
        await ctx.setOffline(true);
      }
      await page.goto(url);
      assert.equal(await page.evaluate(() => !!(window.BApp && window.UI && window.View && window.I18N && window.BRender)), true, 'all modules start');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).display), 'flex', 'stylesheet applies');
      assert.equal(await page.evaluate(() => I18N.lang), 'en', 'English for an English browser');
      await page.locator('#btnLang').click();
      assert.equal(await page.evaluate(() => I18N.lang), 'zh');
      assert.match(await page.textContent('#btnDemo'), /[一-鿿]/, 'Chinese after the switch');
      await page.locator('#btnLang').click();
      assert.equal(await page.evaluate(() => I18N.lang), 'en');
      assert.equal(await page.textContent('#btnDemo'), 'Try the example');
      await page.locator('#btnDemo').click();
      await page.waitForFunction(() => window.BApp && BApp.S && BApp.S.blots.length && document.getElementById('busy').classList.contains('hidden') && !document.getElementById('sections').classList.contains('hidden'), null, { timeout: 120000 });
      assert.equal(await page.evaluate(() => BApp.S.blots.length), 2, 'the demo has two membranes');
      if (mode === 'blocked' || mode === 'quota') {
        assert.equal(await page.locator('#sections .storage-note').isVisible(), true, 'the storage note shows');
        const r = await page.evaluate(async () => {
          PrefStorage.setItem('blotfig.preflight', '0');
          const prefsWork = PrefStorage.getItem('blotfig.preflight') === '0';
          BApp.makeBoxes(); BApp.S.step = 5; BApp.commit();
          const row = BApp.S.rows.find(r => !r.hidden); row.name = 'Edited offline'; BApp.commit();
          const blob = await BApp.saveProject();
          await BApp.openProject(new File([blob], 'x.blotfig'));
          const projectWorks = BApp.S.rows.some(r => r.name === 'Edited offline');
          const f = BRender.build(false);
          const canvas = await Export.svgToCanvas(f.svg, f.w, f.h, 300);
          const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          return { prefsWork, projectWorks, pngWorks: png.size > 1000, persistent: PrefStorage.persistent };
        });
        assert.deepEqual(r, { prefsWork: true, projectWorks: true, pngWorks: true, persistent: false });
      }
      assert.deepEqual(errors, [], 'no startup/editing errors');
      assert.deepEqual(requests, [], 'single-file app makes no HTTP requests');
      results.push(['ok', label]);
    } catch (e) {
      results.push(['FAIL', label, e.message.split('\n')[0]]);
    } finally { await ctx.close(); }
  }
  return results;
}
