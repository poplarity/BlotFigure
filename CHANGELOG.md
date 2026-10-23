# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org/).

## [Unreleased]

## [0.12.1] - 2026-10-23

Fix over-segmentation with small lane counts and make strip-stage detection repeatable.

**中文摘要**
- 修复「每框 2 道」把全膜网格按每个候选高度机械铺满的问题。宽膜先按局部水平信号形成区域，再约束泳道数；不再给空白网格生成框，不把同一条带的主峰、双带和拖尾重复框选。
- 新区域直接保留支持它的泳道中心，避免随后再次拟合跳到半条宽带或其他区域。各区域仍独立选曝光，弱候选显示供人工核对；自动检测不推断蛋白身份，也不修改源图片。
- 检查膜条可反复修改膜框、泳道数与分隔参数，点击「按当前设置重新识别本组蛋白框」。上方操作栏也提供同一入口；「保留已有框，返回编辑」是单独动作。
- 修复完成步骤后按钮被样式隐藏的问题。重新识别只替换本组，Ctrl+Z 恢复原框；删光后仍可生成；识别失败保留原状态。
- 用用户提供的三张 TIFF 在本地复现 36 框问题，并验证修正后主要区域与条带对应。真实图片不进入仓库。新增含空白、窄边伪影、不同高度蛋白的合成测试与重复识别点击测试。

### Fixed
- Count-constrained regions require local signal support instead of tiling a membrane-wide lattice at every detected height.
- Preserve supported lane centres, refine each region's own band height and reconcile nearby duplicate detections while retaining vertically separate proteins.
- Explicit per-group redetection in the strip-review step, completed-step button visibility, keep-vs-regenerate actions, undo, empty-group recovery and atomic failure handling.

## [0.12.0] - 2026-10-23

Clear image groups, reliable step navigation, independent lane blocks and editable PowerPoint export.

**中文摘要**
- 第一步改为「分组与 Marker 参考图」，默认「图片组 1、2」。相册直接说明分组用途、判断原则和例子：同一拍摄布局的曝光与参考图放一组；不按蛋白名或曝光强弱分组，一组可包含多条膜。
- 确认图片后从第一组检查膜条；整张分组卡片支持鼠标和键盘点击。生成或点击蛋白框会展开第 3 栏并显示对应设置，收起上一步；已有框和几何保留。
- 新项目默认添加条带边框，旧项目的手动选择保留。kDa 标题参考 GelFigure，固定在条带旁，按字体占用避开条件表。
- 预设泳道数不再将整条宽膜压成一个框：识别多个独立区域，分别选曝光与亮度，上下排列。中间 Marker 可手动指定序号，例如每框 4 道、分隔第 5 道 → 左右各一框。未指定时保留余道候选，不把弱信号自动当作 Marker 删除。
- 新增完全离线的可编辑 PPTX：文字、刻度、线条、边框为原生对象，各蛋白图片独立保留完整的旋转和色阶处理后图像，PowerPoint「图片格式 → 裁剪」可恢复裁切。不是原始 TIFF；裁切改变后标注不会自动跟随。

### Added / fixed
- Capture-based image groups with visible rationale/examples, full-card strip review, first-group entry, and automatic protein-control expansion.
- Default borders for new projects and compact marker-unit headings with measured clearance from condition names.
- Multiple count-constrained regions per wide strip; an optional explicitly identified divider, with uncertain remaining lanes retained. Each region selects exposure independently.
- Dependency-free PPTX adapted from GelFigure: native editable annotations, multiple full-source pictures with native crops, source deduplication and offline single-HTML support.
- Real-click workflow, known-coordinate 9-lane split, typography, ZIP/XML and offline PPT tests; Windows PowerPoint open/edit/recrop/save validation. macOS PowerPoint, Keynote and WPS need separate validation.

## [0.11.0] - 2026-10-23

Count-constrained lane positioning and source-crop fixes.

**中文摘要**
- 第 2 步识别前可指定每个蛋白框的总泳道数；各框按自身图像拟合位置，弱带、空道不再改变指定数量。新加框沿用默认值，可逐框覆盖，支持明确操作后统一已有框。
- 修复删除全部蛋白框后旧的单道显示范围继续限制新增框的问题。空排版列首次添加框时恢复完整范围；源泳道不再受成图范围过滤。
- 关闭应用中自动 Marker 泳道推断造成的自动删道、拆框与全局范围裁切。只有用户手动标 M 或排除泳道才拆分框；手动裁切片段在批量调整时按原始框处理。
- 指定条数随缩放和重定位保留，单框例外独立；项目、预设和样式文件记录默认值。保存重开使用该膜原来的检测参数，不因为后来修改默认值而重算现有几何。
- 增加缺带、弱带、双峰、宽背景、空框、真实鼠标新增、清空恢复、手动 Marker 和已知条带坐标覆盖测试。用户提供的 TIFF 仅在本地验证。

### Added / fixed
- Optional lane-count constraint before detection, local signal fitting, per-box overrides, batch counts, and persistence through projects/presets.
- Empty-to-populated display-range recovery and source-lane inference independent of figure cropping.
- Manual-only lane exclusions in the app; automatic marker guesses cannot silently crop or split protein regions.
- Regression tests verify ground-truth band coverage as well as counts, including weak/missing lanes and deletion/re-addition flows.

## [0.10.0] - 2026-10-23

Direct editing, a photo workspace, and persistent local projects.

**中文摘要**
- 第 1 步改为中间相册分组、右侧大图浏览：放大查看、多选、跨膜组拖动，直接指定复合 Marker 图或曝光图。
- 各步骤增加展开/收起按钮，返回修改保留已有调整；已删除的框不再因重新检查膜条而生成回来。添加蛋白框置顶，补充放置/拖画引导。
- 选中蛋白框后按退格只删这个框；同膜其他框不受影响；输入框和中文输入法维持正常行为。泳道仍可用 Delete 单独删除。
- 去除左侧重复的名称输入和标注编辑，直接在成图填写；行旁 ⋯ 保留隐藏 Marker 和区域设置入口。
- Marker 字号全局统一，移除逐区域字号；固定短刻度、按实际字形高度判断重叠，不再延长到额外标签列。可统一适配字号或手动隐藏数字，校准保留。
- 自定义 Marker 可粘贴数字或导入 TXT/CSV/JSON；提供预览和填写示例，定义随项目文件保存。
- 自动缓存多个历史项目，支持恢复、改名和删除；旧版单草稿无损迁移，共用原图按指纹只存一份，缓存失败不会覆盖上一次完整记录。参数预设可保存、套用与导入导出。
- 修正 iBright 名称中的 bright 误判，以及 Chemi 文件名抢先覆盖复合图像特征的问题。用户提供的两张 TIFF 在本地导入测试中正确分为 Marker 复合图和曝光图；公开测试只用合成数据。

### Added / changed
- Central photo browser with zoomable inspection, drag grouping and direct picture-role controls.
- Expandable tools, box-scoped Backspace deletion, direct figure naming and annotation controls.
- Uniform marker font, fixed tick lengths, glyph-based overlap warnings and easy custom marker import.
- Atomic multi-project IndexedDB cache with image deduplication, legacy-draft migration and recoverable quota failures; reusable parameter presets.
- Composite classification no longer defers to ambiguous iBright/Chemi filenames. Expanded browser regression tests cover these flows and local storage failures.

## [0.9.0] - 2026-10-22

Lightweight column layout and more direct annotation controls.

**中文摘要**
- 第 4 步直接调 Marker 全局字号；点成图数字或蛋白名旁 ⋯ 可逐区域设字号、隐藏/恢复数字，保留校准点。修复密集刻度引线挡住数字和点击的问题。
- 第 5 步可选多列排版：各列独立标题、泳道范围、名称、分组和条件。拖区域跨列移动或用菜单选择目的列；曝光、亮度、裁切保持独立，无自动拼接。
- 默认顶部对齐，可按行对齐；可调列间距、复制列标签、删除空列。空列不导出。
- 支持粘贴 Excel 条件表，保留空格和任意值；Shift+点击编辑时间/剂量。行旁括号增加竖排文字和直线样式。
- 保存、撤销、样式文件、来源日志、未裁切原图与定量 CSV 支持多列；旧单列项目保持兼容。

### Added
- Optional columns inside one WB figure, with independent titles, lane labels/ranges, group labels and condition tables. Move regions explicitly between columns without combining their data or image settings.
- Top or bottom titles, optional row alignment, adjustable spacing and label-only copying. Empty columns are omitted from exports.
- Global and per-region Marker font controls, and hide/show labels without removing calibration marks. Tick leaders render behind labels and do not intercept clicks.
- Excel/TSV condition tables, with explicit append or replace for the selected column, preserved blanks and editable time/dose values. Vertical side-label text and straight-line bracket style.

### Changed
- Exposure recommendations use the source region, independent of selected layout columns or display lane ranges.
- Project, template, processing-log, uncropped-original and CSV exports record column placement. Previous single-column projects remain compatible.
- Browser regression coverage includes actual cross-column drags, pixel invariance, IME editing, calibration retention and project round trips.

## [0.8.2] - 2026-10-22

Simplify the workflow: independent protein regions, without joining.

**中文摘要**
- 取消根据高度/强度自动拼接不同膜条，也取消拖到另一行时误触发的拼接；上下拖动只排序。
- 每个蛋白区域独立选择曝光和调整亮度。固定已确定的图片默认显示范围，避免一个区域换曝光后其他区域跟着变。
- 只有明确选择「高级：整张曝光」才全图调整；浏览其他图片时不会自动切成全图调整。
- 旧项目的合并区域提供「解除绑定，分别编辑」和「全部解除绑定」，沿用当前曝光、亮度、名称及裁切范围。已被旧版覆盖的历史独立设置无法推回。
- 保留同一原始区域剔除内部 Marker 泳道后的片段和可见分隔，不把这些片段误当作旧版跨区域绑定。

### Changed
- Removed the cross-strip height/intensity joining heuristic and the drop-on-another-row merge gesture. Vertical drags only reorder independent protein regions.
- Existing automatic image display ranges remain stable when other regions change exposure. Whole-exposure editing requires an explicit advanced action, with no silent fallback when viewing a different picture.
- Legacy combined rows can be detached individually or together, keeping current exposures, levels, names and crop bounds. Opening a project does not silently rearrange it.
- Updated guidance, examples and regression coverage, including pixel invariance of an untouched region when another is edited.

## [0.8.1] - 2026-10-22

Faster image organisation, independent protein boxes and manual marker labels that stay visible.

**中文摘要**
- 第 1 步只读取和整理图片，确认分组后才对齐并分析膜条；批量删除、移动不再重复全量分析，支持撤销。
- 缩略图直接拖放到膜组，可多选一起移动/移除，或拖出新膜组；长文件名自动截断或换行。
- 每个蛋白框有独立编号，同膜上的其他框不再跟着横移；同一膜条上的不同区域可以拼成一行，裁切范围独立保留。
- 弱信号框默认显示，隐藏操作改成明确的「隐藏 / 显示」，可一键恢复全部隐藏框。
- 排除中间 Marker 泳道时拆成多个源框，接缝只作用于对应行；误排除时可恢复连续框。
- 修改泳道数即生效，去掉重复的对齐按钮；高级操作说明折叠。
- 一条 Marker 也能显示刻度；两条以上才估算其他分子量。拥挤的刻度错列排布，不再直接丢弃。

### Changed
- Import defers alignment and strip analysis until picture groups are confirmed. Step 2 computes outlines only; protein detection runs in step 3.
- Batch image moves and removal update the groups immediately, without re-running analysis. Removed pictures can be restored with Undo and are excluded from saved projects until restored.
- Thumbnail selection, drag-and-drop between groups, a new-group drop target and direct removal buttons. Same-page drag IDs cover WebKit's custom MIME filtering.
- Independent stable box IDs, per-box figure positioning and crop heights. Separate boxes on the same strip may be joined, while duplicate source regions are refused and each row still uses one exposure.
- All detected protein rows are initially shown, including weak candidates. Explicit visibility buttons and a restore-all action make hidden rows discoverable.
- Excluded internal lanes appear as separate source boxes; local splices no longer add gaps to unrelated continuous rows. Incorrect exclusions can be restored to a continuous box.
- Lane count changes apply immediately between the end lanes. Manual edits and re-detection remain available without the redundant spacing button.
- A single marker band is accepted for tick annotation. Calibration of other sizes still needs two marks. Close manual ticks use extra label columns instead of being dropped.

### Fixed
- Long picture names overflowing the image menu, summary or tabs.
- Joined boxes on one physical strip collapsing back into a single crop on re-analysis.
- Independent crop bounds being lost when rows of different heights were joined.

### Validation
- Added browser interaction coverage for the above workflows, plus project round trips and no shared movement between sibling boxes.
- On the same 14-picture local fixture: first-step readiness improved from about 12.6 s to 6.9 s; single-picture removal from about 3.4 s to 49 ms. Full analysis now happens after confirmation; these are not total analysis-time measurements.

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
