# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-10-22

English interface, a one-file offline download, and the project's GitHub home set up like GelFigure's.

**中文摘要**
- **中英双语界面**：右上角 EN / 中文 随时切换，按浏览器语言自动选择，记住你的选择。成图、图注、导出文件始终是英文。
- **单文件离线版**：每个版本在 Releases 里附一个 `BlotFigure-v版本号.html`，下载后双击即可用，不用安装、不用解压、断网也能用。开始页有下载链接。
- **浏览器存储被禁用或已满时照常可用**：偏好只在本页暂存，开始页和第 5 步会提示，关闭前请保存项目。
- **国内厂家 Marker 的名称**：中文界面显示中文品牌名，图注里写英文名（之前会把中文写进英文图注）。
- GitHub 仓库：MIT 许可证、英文 / 中文说明、更新记录、问题反馈模板、自动测试（Chromium / Firefox / WebKit）、引用信息。

### Added
- **English interface.** Every panel, menu, dialog, message and the help are in English and Chinese, switchable at any time with **EN / 中文** in the top bar; the first visit follows the browser's language and the choice is remembered (`?lang=en` / `?lang=zh` also work). Figures, legends and exported files are always English.
- **Single-file offline build.** Every release attaches `BlotFigure-vVERSION.html`: all scripts and styles in one file that runs by double-click, without installation, extraction or a network connection. A ZIP of the source folder is attached too. The start screen links to the download.
- **Works with browser storage blocked or full.** Preferences fall back to memory for the session; a note on the start screen and in step 5 says so (there is no autosaved draft then: save a project before closing).
- **Tests in three engines.** `npm test` runs startup checks (storage blocked / full, `file://`, the single file offline), the engine test pages and an interface run on the demo membranes (steps, names on the figure, pre-flight, PNG / TIFF / SVG / log exports, projects, style files, reset, drafts, labels, arrows, the language switch, and no Chinese left in the English interface) in Chromium, Firefox and WebKit, on every push.
- The help shows the version and links to the source and the issue tracker.
- Project files on GitHub: MIT licence, English README and `README.zh-CN.md`, this changelog, contributing guide, security policy, citation file, issue and pull-request templates, `docs/ladders.md` (every built-in ladder with its catalogue number).

### Changed
- Built-in ladders of Chinese vendors have English names in figure legends and logs (the Chinese brand name shows only in the Chinese interface); custom ladders are grouped under "Custom".
- GitHub Pages is deployed by a workflow that publishes only the app itself.

### Fixed
- Typing immediately after Enter moves to the next lane editor without losing the first characters, including in WebKit.
- English annotation labels take the width they need instead of overlapping the adjacent input.
- Documentation screenshots use the synthetic demo's actual marker positions and sizes.

## [0.7.0] - 2026-10-22

Everything GelFigure 0.6.5 does that a Western blot figure needs.

### Added
- **File menu**: projects (`.blotfig`) carry the SHA-256 of every picture and are checked on opening; an autosaved draft in the browser, offered on the start screen after a reload; style files (lane names, groups, condition rows, protein order, ladder and layout for the next figure of a series); "back to import" (undoable, also after opening a project or a draft); New.
- **Exports**: PNG with resolution (`pHYs`), `sRGB` and a processing summary (`iTXt`); LZW TIFF with resolution; processing log (JSON) with each source's SHA-256, alignment, every row's boxes, exposure, levels and tilt; a **pre-flight check** before export (unnamed rows, saturated exposures, text below 5 pt, thin lines, effective resolution below 300 dpi, wider than a double column, overlapping text) with one-click fixes.
- **Layout**: journal-width presets (85 / 120 / 180 mm) solved for the lane width; the bands' effective resolution with the widest lane that keeps 300 dpi; separate sizes for lane names, protein names and molecular weights; line width; lane numbers; group labels that wrap, shrink or stay on one line and are tiered by their real width so they never overlap; reset layout; a size bar under the text editor (A− / A+ / Default / ↵).
- **Side brackets** beside rows: IP / Input groups across rows, or a stretch of one row such as a (Ub)n smear.
- **Target-band arrows**: a typed (theoretical) size instead of the estimate; dragged up or down onto another band of the row.
- Content Security Policy: the page cannot contact any server. File formats are told by their content, not the extension; 8-bit pictures are flagged.

### Fixed
- Tilted boxes are drawn tilted in the uncropped originals and read along their tilt in the densitometry CSV.
- An unpaired `*` stays a star (`WT*`, `K48R*`); `*italic*` as before.
- Exports name membranes in English ("Membrane 1"); the legend states per-row levels correctly.

## Earlier development (2026-10-19 to 2026-10-22, before version numbers)

- **Five steps in order** (9fcc9f2): marker picture → strips → protein boxes → marker → names and export, one step open at a time; the marker is marked by hand only, predictions appear after two marks; boxes level themselves along their bands and turn by hand; per-row levels; molecular weights and protein names on either side; target-band arrows; "+ add a box" places it where you click.
- **Boxes anywhere, strips by hand, GelFigure lanes, projects** (7ef2971): fast box dragging; boxes not bound by the strips found; strips moved, resized, turned and drawn by hand; first / last lane spreading the lanes between; GelFigure's prestained ladder list with a reference card while marking; project files.
- **Marker as its own step** (1b0ab46) with marking on the white-light picture; boxes kept when the membrane is analysed again.
- **Membranes moved between captures** (b739b89) recognised as one membrane and aligned, as a whole or strip by strip, adjustable by hand.
- **Arranging the figure by mouse** (e9ad13c): row order, lane alignment per strip, one protein across two strips joined into one row.
- **Lanes per box** (b952ab3), **lanes per strip and manual marker bands** (4b0deb5), and the first version (1bc319f, 2026-10-19).
