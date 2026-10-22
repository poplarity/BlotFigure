/* Build dist/BlotFigure.html: a single file with every JS and CSS inlined, so it runs by double-click (as
 * GelFigure's). The app itself does not change: the bundled scripts keep their load order and page structure. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'dist', 'BlotFigure.html');

const read = p => fs.readFileSync(p, 'utf8');
let html = read(path.join(root, 'index.html'));

// inline css
const cssFiles = fs.readdirSync(path.join(root, 'css')).filter(f => f.endsWith('.css')).sort((a, b) => a === 'style.css' ? -1 : b === 'style.css' ? 1 : a.localeCompare(b));
let style = '';
for (const f of cssFiles) style += `/* css/${f} */\n` + read(path.join(root, 'css', f)) + '\n';
html = html.replace(/<link rel="stylesheet" href="css\/[^"]+"\s*\/?>/g, () => `<style>\n${style}\n</style>`);

// inline scripts; the order must match index.html exactly
for (const f of ['storage', 'i18n', 'tiff', 'engine', 'export', 'wbladders', 'wbengine', 'wbdemo', 'wbapp', 'wblibrary', 'wbrender', 'wbview', 'wbui', 'wbextras']) {
  // "</script" inside a string would end the inline element early
  const code = read(path.join(root, 'js', f + '.js')).replace(/<\/script/gi, '<\\/script');
  const tag = new RegExp(`<script src="js/${f}\\.js"><\\/script>`, 'g');
  if (!tag.test(html)) { console.error(`index.html does not load js/${f}.js`); process.exit(1); }
  html = html.replace(tag, () => `<script>/* js/${f}.js */\n${code}\n</script>`);
}
// a script added to index.html but not to the list above would silently be missing from the single file
const left = html.match(/<script src="js\/[^"]+"><\/script>/g);
if (left) { console.error('not inlined:', left.join(' ')); process.exit(1); }

// single-file mode needs inline scripts; replace the CSP with one that allows them, keeps everything else
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' file: data: blob:; script-src \'self\' file: \'unsafe-inline\'; style-src \'self\' file: \'unsafe-inline\'; img-src \'self\' file: data: blob:; connect-src \'self\' file: data: blob:; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`${outPath}  ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB`);
