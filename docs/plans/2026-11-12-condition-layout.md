# Condition name layout / 条件名排版

**Goal:** Implement the approved per-condition name side and alignment without changing lane values or image geometry.

**Architecture:** `BRender.buildSingle()` measures condition title lines with the existing `FigureText` utilities. Each side uses its own maximum title width and sits two label gaps outside the lane grid. Alignment selects the left edge, midpoint or right edge of that shared column. SVG bounds and same-side unit collisions use the actual formatted line bounds. Existing SVG text and `data-pptx-lines` groups remain compatible with the editable PPT adapter.

**Tech stack:** Plain browser JavaScript; existing Playwright tests and Node assertions only.

1. Add `tests/conditionlayout.mjs`, exported as `conditionLayoutChecks(browser, base)`. Run it through a temporary standalone server/runner and record the expected failures before runtime changes.
2. Change only `js/wbrender.js`: normalize rendering defaults without mutating state, measure shared side widths, position title anchors, handle formatted multiline titles and grow bounds, then check unit collisions on the matching side.
3. Run the condition suite in Chromium, Firefox and WebKit. Run relevant existing layout/export regression checks. Inspect actual SVG/raster/PPT output.

## Parent UI hooks / 父任务需要添加的界面字段

- Read/write the selected column's condition object via `BApp.columnData(columnId).conditions[rowIndex]`.
- `nameSide`: `'left' | 'right'`; absent/invalid means `'left'`.
- `nameAlign`: `'left' | 'center' | 'right'`; absent/invalid means `'right'` for a left-side name, `'left'` for a right-side name.
- Add side and alignment selectors in the left condition-row settings. Use bilingual labels: 名称位置 / Name position, 左侧 / Left side, 右侧 / Right side; 名称对齐 / Name alignment, 左对齐 / Left, 居中 / Center, 右对齐 / Right.
- Selectors agreed with the parent: `[data-cond-side="index"]` and `[data-cond-align="index"]`. The suite uses real select interactions to check defaults, all six combinations, explicit-alignment retention, undo/redo and independent layout columns.
- Changing side should preserve an explicit alignment; leaving `nameAlign` unset follows the side-specific default. Commit through the existing undo/refresh flow. Existing `data-edit="condname"`, `data-r`, `data-column` hooks remain available.
- Register `conditionLayoutChecks` in `tests/run.mjs` under `conditionlayout` and in the complete run. This task does not edit the runner, state module or UI files.

No commits or pushes are authorized for this task.

## Verification / 验证记录

- Tests were written first: the unchanged renderer failed six condition-layout checks, including right-side placement, alignment, multiline rendering, unit collision scope and PPT anchors.
- The final condition suite passes 11/11 checks in each of Chromium, Firefox and WebKit (33 total), including real interactions with the parent's controls.
- Existing `layout` (18 checks) and `parity` (17 checks) suites pass in all three browsers (105 total), using a temporary standalone runner without editing the shared runner.
- `node --check js/wbrender.js`, `node --check tests/conditionlayout.mjs` and `git diff --check` pass.
- Actual SVG, raster PNG and editable PPTX were generated; SVG bounds, native PPT alignment/positions, multiline paragraphs and formatted runs were checked. A preview screenshot was visually inspected. Desktop PowerPoint was not run.
- Firefox exposed a 0.09 pt overlap at the former fixed multiline spacing. Condition titles now use measured adjacent-line heights with a small gap; the shared multiline helper retains its existing default spacing for other labels.

After parent registration: `node tests/run.mjs --suite=conditionlayout` runs the suite in all three browsers.
