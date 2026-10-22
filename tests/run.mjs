#!/usr/bin/env node
/* Runs BlotFigure's checks in real browsers through Playwright (as GelFigure's tests/run.mjs):
 *   tests/startup.mjs                     storage blocked / full, file://, the single file offline, language switch
 *   test/*.html                           engine: lanes in boxes, ladder lanes, registration of moved membranes
 *   tests/ui.mjs                          the interface on the demo membranes (English UI)
 *   a second origin                       no request ever leaves the page
 * The app is served from a throw-away local HTTP server (no network access is needed).
 * Usage: node tests/run.mjs [--browser=chromium,firefox,webkit] [--channel=msedge] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { startupChecks } from './startup.mjs';
import { uiChecks } from './ui.mjs';
import { workflowChecks } from './workflow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const browsers = (arg('browser') || 'chromium,firefox,webkit').split(',').filter(Boolean);
const channel = arg('channel');   // e.g. msedge to use an installed Edge instead of Playwright's Chromium
const ENGINES = { chromium, firefox, webkit };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// engine pages: each reports {fails, out} in its title
const PAGES = [
  ['lanes found inside boxes', 'test/boxlanes.html', 'BOX '],
  ['ladder lane per strip', 'test/ladderlane.html', 'LADDER '],
  ['moved membranes registered', 'test/register.html', 'REG '],
];

async function runIn(name, base) {
  const out = { browser: name, results: [], ok: true };
  const fail = (what, detail) => { out.ok = false; out.results.push(['FAIL', what, detail]); };
  const pass = what => out.results.push(['ok', what]);
  const add = list => { out.results.push(...list); if (list.some(r => r[0] === 'FAIL')) out.ok = false; };
  const browser = await ENGINES[name].launch(channel && name === 'chromium' ? { channel } : {});
  try {
    if (arg('suite') === 'workflow') { add(await workflowChecks(browser, base)); return out; }
    add(await startupChecks(browser, base, ROOT));
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
    for (const [what, url, prefix] of PAGES) {
      const page = await ctx.newPage(), errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      try {
        await page.goto(`${base}/${url}`, { waitUntil: 'commit' });      // (their scripts run before the load event)
        await page.waitForFunction(p => window.__done === true && document.title.startsWith(p), prefix, { timeout: 240000 });
        const t = await page.title(), r = JSON.parse(t.slice(prefix.length));
        r.fails === 0 && !errs.length ? pass(what) : fail(what, (r.out || []).filter(l => !/^ok/.test(l)).slice(0, 3).join(' | ') + errs.join(' | '));
      } catch (e) { fail(what, e.message.split('\n')[0]); }
      await page.close();
    }
    // the engine on the three demo sessions runs through without an error
    {
      const page = await ctx.newPage();
      await page.goto(`${base}/test/engine.html`, { waitUntil: 'commit' });
      await page.waitForFunction(() => document.getElementById('out').textContent.length > 10, null, { timeout: 240000 });
      const r = JSON.parse(await page.textContent('#out'));
      !r.error && r.cut && r.scatter && r.moved ? pass('engine on the demo sessions') : fail('engine on the demo sessions', String(r.error).slice(0, 300));
      await page.close();
    }
    await ctx.close();
    add(await uiChecks(browser, base));
    add(await workflowChecks(browser, base));
    // privacy: the Content Security Policy must stop every request to another origin
    {
      const c2 = await browser.newContext(), page = await c2.newPage();
      await page.goto(`${base}/index.html`);
      outside.hits = [];
      await page.evaluate(async t => {
        try { await fetch(t + '/fetch', { method: 'POST', body: 'x' }); } catch (e) { /* expected */ }
        await new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = t + '/img'; });
        try { navigator.sendBeacon(t + '/beacon', 'x'); } catch (e) { /* expected */ }
        try { const x = new XMLHttpRequest(); x.open('GET', t + '/xhr'); x.send(); } catch (e) { /* expected */ }
        try { new WebSocket(t.replace('http', 'ws') + '/ws'); } catch (e) { /* expected */ }
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = t + '/css'; document.head.appendChild(l);
      }, outside.url);
      await page.waitForTimeout(2000);
      outside.hits.length ? fail('no request leaves the page', outside.hits.join(', ')) : pass('no request leaves the page');
      await c2.close();
    }
    // the Chinese interface loads the demo too
    {
      const c3 = await browser.newContext(), page = await c3.newPage(), errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      await page.goto(`${base}/index.html?demo=1&lang=zh`);
      await page.waitForFunction(() => document.title.startsWith('READY '), null, { timeout: 240000 });
      const r = await page.evaluate(() => ({ blots: BApp.S.blots.length, zh: /[一-鿿]/.test(document.getElementById('panel').innerText) }));
      r.blots === 2 && r.zh && !errs.length ? pass('Chinese UI + demo') : fail('Chinese UI + demo', JSON.stringify(r) + errs.join(' | '));
      await c3.close();
    }
  } catch (e) {
    fail('runner', e.message);
  } finally { await browser.close(); }
  return out;
}

execFileSync(process.execPath, ['scripts/bundle-onefile.mjs'], { cwd: ROOT });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
// a second origin that records anything the page manages to send
const outside = { hits: [] };
const sink = http.createServer((req, res) => { outside.hits.push(`${req.method} ${req.url}`); res.end(); });
await new Promise(r => sink.listen(0, '127.0.0.1', r));
outside.url = `http://localhost:${sink.address().port}`;
let allOk = true;
for (const name of browsers) {
  if (!ENGINES[name]) { console.error(`unknown browser: ${name}`); allOk = false; continue; }
  const t0 = Date.now();
  const r = await runIn(name, base);
  console.log(`\n${name}${channel && name === 'chromium' ? ` (${channel})` : ''} — ${r.ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  r.results.forEach(([s, what, detail]) => console.log(`  ${s === 'ok' ? '✓' : '✗'} ${what}${detail ? `\n      ${detail}` : ''}`));
  allOk = allOk && r.ok;
}
server.close(); sink.close();
process.exit(allOk ? 0 : 1);
