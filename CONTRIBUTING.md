# Contributing to BlotFigure

Thank you for helping! Issues and pull requests in English or Chinese are both welcome. 中文或英文提交均可。

## Reporting a problem

Please use the [issue templates](https://github.com/poplarity/BlotFigure/issues/new/choose). The most useful reports include:

- browser and operating system, and whether you used the online version, the single-file `BlotFigure-vVERSION.html`, or `index.html` from an extracted ZIP;
- the imager and the file type (e.g. "ChemiDoc, 16-bit TIFF, three exposures and a white-light picture"; "iBright, merged picture");
- which step it happened in (marker picture, strips, protein boxes, marker, names / export), what you expected and what happened; a screenshot helps a lot;
- the **processing log** (*Export ▾ → Processing log (JSON)*). It contains settings, file fingerprints and statistics but no pixel data. Remove protein or lane names first if they are confidential.

**Blot pictures.** A set of pictures on which detection fails is the best possible bug report, but only attach them if you are allowed to share them publicly. Unpublished data, patient-derived material or anything under a confidentiality agreement should not be posted. A screenshot of the problem is often enough.

## Adding a ladder

Built-in prestained protein ladders live in [`js/wbladders.js`](js/wbladders.js):

```js
{ id: 'pr26619', vendor: 'Thermo / Invitrogen', name: 'Thermo PageRuler Plus Prestained 10–250 kDa (26619)', sizes: [250, 130, 100, 70, 55, 35, 25, 15, 10], ref: [70, 25, 10] },
{ id: 'by_p0068', vendor: 'Chinese vendors', name: 'Beyotime Prestained 10–180 kDa (P0068/P0069)', zh: 'Beyotime 碧云天 Prestained 10–180 kDa (P0068/P0069)', sizes: [180, 130, 95, 72, 55, 43, 34, 26, 17, 10], ref: [72, 10] },
```

- `id`: short, unique, lowercase.
- `name`: `Vendor Product name (catalogue number)`, in English: it goes into figure legends and logs. `zh` (optional): the name shown in the Chinese interface, e.g. with the Chinese brand name.
- `sizes`: every band visible on the membrane, largest to smallest, in kDa (the apparent molecular weights the manufacturer prints; Tris-glycine values unless the name says otherwise).
- `ref`: the coloured or brighter reference bands, if the datasheet marks any.
- `chemi: true` for ladders that show up in the chemiluminescence image rather than the white-light picture (e.g. MagicMark).

Also add a row to [`docs/ladders.md`](docs/ladders.md) with the catalogue number and a link to the manufacturer's datasheet the sizes come from. A wrong size produces a wrong figure, so ladders without a source cannot be merged. The list is shared with [GelFigure](https://github.com/poplarity/GelFigure); a correction usually belongs in both.

## Development

There is no build step. Edit the files and reload `index.html`. Read [AGENTS.md](AGENTS.md) for the current architecture, product constraints, handover and release process. [DEVELOP.md](DEVELOP.md) (in Chinese) has debugging URL parameters, test pages and historical implementation notes. `CLAUDE.md` imports the same handover rather than maintaining a separate copy.

- **Keep it dependency-free** and loadable from `file://`: plain scripts, no CDN and no automatic external requests. Explicit text feedback is the sole submission exception; keep the exact endpoint allowance in CSP and attach no project/image data. Tests must mock feedback delivery, never send live messages.
- **Every interface string is bilingual.** In JavaScript, write `L('中文', 'English')`; in HTML, put the English text in `data-en` (or `data-en-html`, `data-en-title`, `data-en-placeholder`). Text that goes into figures, legends, logs and exported files stays in English.
- **Image-processing changes must stay honest:** only linear adjustments, one picture per row (never splice exposures or membranes within a row), nothing removed silently, and anything that changes how the data looks is recorded in the legend notes and the processing log.
- Match the existing style: small functions, comments that explain *why*.

### Tests

```bash
npm install
npx playwright install chromium firefox webkit
npm test                        # all three engines
npm test -- --browser=firefox   # a single engine
```

`tests/run.mjs` starts the app from a local server and checks, in each engine: startup with browser storage blocked or full, from `file://` and as the single file offline; the engine test pages (`test/boxlanes.html`, `test/ladderlane.html`, `test/register.html`, `test/engine.html`, all on synthetic membranes); the interface on the demo membranes (`tests/ui.mjs`: steps, names on the figure, pre-flight check, PNG / TIFF / SVG / log exports, projects, style files, reset, drafts, labels that never overlap, target-band arrows, the language switch, and no Chinese text left in the English interface); and that no request ever leaves the page. Please add a check for new behaviour.

`npm run build` writes the single-file `dist/BlotFigure.html` (the release workflow does this for every `v*` tag).

## Pull requests

1. Fork and create a branch.
2. Make the change, with tests where it makes sense.
3. Run `npm test`.
4. Describe what changed and why; add a line to [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
