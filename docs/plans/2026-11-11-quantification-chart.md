# Current-Figure Quantification Implementation Plan

> Historical plan. The figure-wide loading-control selection, direct results/raw-details presentation and individual-lane bar fallback are superseded by [the 2026-11-12 plan](2026-11-12-unified-control-bars.md). Preserve this record for the original chart implementation, not as the current control-selection contract.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Quantify the current figure's selected source exposures and boxes, normalise to explicitly selected loading controls, and export interactive quantitative plots and traceable data.

**Architecture:** Keep `BApp.quantData()` authoritative for measurements, per-column/per-membrane loading controls, optional control-group scaling and descriptive summaries. Add a dependency-free SVG plot module consumed by both the workspace and PNG/SVG exports. Keep multi-exposure and dilution checks opt-in, not prerequisites.

**Tech Stack:** Plain browser JavaScript, SVG, Canvas, existing Playwright three-engine runner; no runtime dependencies or network requests.

## Confirmed design

- One current figure per analysis; no cross-experiment pooling. Source image, exposure, boxes, visible lanes and order follow the figure. Display levels and exported bitmap pixels never supply quantitative measurements.
- Loading controls are explicitly selected per membrane in each layout column. Corresponding lanes are paired by source sample positions, not by rendered proximity. Missing or invalid controls never produce zero-filled ratios.
- The default normalised result is target/control, not a first-lane fold change. A user-selected existing condition group optionally supplies the mean reference for relative expression. A missing or non-positive reference produces no relative value and an explicit reason.
- Existing group labels and ordering are reused. Plot defaults to individual points; means and optional sample SD require confirmation of independent samples. Single measurements never receive error bars. Technical measurements are not labelled biological replicates.
- Current/all selected targets can be exported as PNG at the figure DPI or SVG. All figure labels, captions and data exports are English; workspace controls are bilingual. No significance tests or stars.
- Reopening after source/exposure/box changes refreshes data and discloses the change. Quantification never changes the figure's selected exposure. Unused advanced checks do not produce routine warnings.

## Task 1 — RED coverage

Files: `tests/quantplot.mjs`, `tests/run.mjs`, then update intentionally changed expectations in `tests/quant.mjs`.

1. Add synthetic demo checks for no first-lane scaling, selected control-group mean, per-membrane control isolation, invalid reference, source/exposure fidelity and settings round trip.
2. Add real UI checks for folded advanced controls, opt-in checks, plot controls, data-point linking, SVG/PNG exports and independent-replicate gating.
3. Run `node tests/run.mjs --suite=quantplot --browser=chromium`; record expected failures before implementation.

## Task 2 — Authoritative calculation

File: `js/wbapp.js`.

1. Extend persisted settings with per-column/per-membrane controls, reference groups, targets, plot style, error bars, sample-unit confirmation and optional exposure check.
2. Compute control ratios and reference-group fold values from current-source measurements, retaining both scales and reference provenance.
3. Preserve previous explicit control choices; never promote suggestions. Expose source provenance and refresh signature without modifying the figure.
4. Rerun calculation counterexamples until passing.

## Task 3 — Plot renderer and workspace

Files: `js/wbquantplot.js`, `index.html`, `scripts/bundle-onefile.mjs`, `js/wbui.js`, `css/style.css`.

1. Render deterministic points, optional bars/means/SD, English labels, axes that include zero, visible exclusions and compact small multiples from canonical results.
2. Place target/control/reference settings first; other methods and quality checks are folded. Add figure/chart preview tabs, shared data table, target selection and plot export controls.
3. Link point selection to table/source band, keep drawer/keyboard access, and stop accidental figure edits.
4. Rerun `quantplot` and `quant` in Chromium; fix production defects without discarding counterexamples.

## Task 4 — Exports and provenance

Files: `js/wbui.js`, `js/wbapp.js`, `tests/quantplot.mjs`.

1. Export the same SVG renderer as standalone SVG and DPI-scaled PNG, with current/all selected targets.
2. Update CSV, JSON and Methods with raw volumes, control ratios, reference values, source/box identifiers, exclusions, sample-unit and chart settings.
3. Treat unrequested exposure checks as not performed; do not claim linearity validation. Verify project/undo settings and results round trips.

## Task 5 — Final verification and documentation

Files: `AGENTS.md`, `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `docs/quantification-plan.md`, `docs/quantification-workbench.md`.

1. Run syntax checks and `git diff --check`.
2. Run `node tests/run.mjs --suite=quantplot` and `node tests/run.mjs --suite=quant` across all engines.
3. Run `npm test` against the frozen final runtime tree; inspect Chinese/English wide/narrow screenshots and single-file offline charts.
4. Deliver the verified offline dev HTML. Do not commit, push, bump versions or release without explicit permission.

## Manual acceptance checklist

1. Open the dev HTML and restore a `.blotfig` project, or use the synthetic demo. Finish the existing five steps and open the optional Quantification workspace.
2. Select the appropriate loading control for each image group/layout column and confirm lane-to-sample correspondence. Without a reference group, compare a displayed value with target volume divided by its same-lane control volume; the first lane must not automatically become one.
3. Select an existing condition as the reference group. Its valid ratios should average to one; individual reference samples need not each equal one. A missing/invalid reference must not silently switch to another lane.
4. Preview the current target and all checked targets. Confirm points, axis labels and panels; confirm means/SD appear only after independent-sample confirmation. Technical repeats must not gain biological error bars.
5. Click a point, inspect the selected table cell, then switch to the blot to inspect the actual integration window. Check that this is the intended band, especially when a crop contains multiple signals.
6. Export PNG, SVG, CSV, JSON and Methods. PNG should use the selected DPI, SVG text/axes remain vector, and data retain source geometry and exclusions. In chart preview the familiar top PNG/SVG actions must export the chart.
7. Return to step 3, change a selected exposure or protein box, and reopen. Measurements must refresh with a source-change message. Changing display brightness alone must not change the quantitative values.
8. Check a narrow desktop window and both interface languages. Advanced QC starts folded and exposure-time checking starts off; unrequested checks never prevent plotting. Save/reopen the project to retain quantitative settings.

All automated and screenshot checks use synthetic demo data. They do not certify real-sample accuracy, loading-control stability, biological independence, or native Safari.app download/storage behaviour.

## Completion evidence

- Final frozen-tree full runs: Chromium 218 checks / 270 s; Firefox 218 / 326 s; WebKit 218 / 287 s. All passed; 654 checks in total. Runtime, scripts and tests retained identical SHA-256 hashes throughout these runs.
- The full runs include 30 quantitative-plot checks and 43 existing/expanded quantitative checks per engine. Counterexamples were observed failing before the corresponding fixes, including chart-aware top exports, source integration bounds, signed previews, small negative-only axes, ungrouped independence captions, bilingual source status and light-panel ghost buttons.
- Offline bundled-file smoke checks in Chromium/WebKit cover English/Chinese at 1600×1000 and 1100×900, 3 panels / 27 synthetic points, source/table linking, the drawer, folded/disabled-by-default exposure QC, and no page errors, document overflow or outbound HTTP requests.
- JavaScript syntax checks and `git diff --check` passed. No commit, push, version bump, merge or release was performed.
