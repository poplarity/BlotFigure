# Quantification usability, condition layout and source dimensions

**Goal:** Make ROI editing discoverable and direct, keep the established interface style, support condition-name placement/alignment and display source-pixel dimensions without changing measurement science.

**Approved design:** The user approved a visible quantification sidebar/preview action, direct canvas movement/resizing, per-condition name side/alignment, and separate source-pixel dimensions for protein crops and quantification ROIs. Keep five figure steps, fixed-size per-protein integration, explicit apply/cancel and portable projects. No commit/push/version bump/release.

## Tasks

1. Add failing real-UI tests for visible entry points, same-style controls, resize handles, selecting and moving lanes, dimensions and cancellation. Add renderer/UI/export tests for left/right condition names with left/centre/right alignment and independent layout columns.
2. Put ROI selection/review and editing in the quantification sidebar and preview toolbar. Keep the existing detail action as a shortcut.
3. Reorganise the editor into a source canvas with compact shared-size controls and segmented direct tools; collapse background/spacing/angle/method settings. Add resize handles, cursor feedback, dimensions, selection/keyboard controls, reliable zoom/resize and sticky apply/cancel. No saved mutations until apply.
4. Render condition-name side and shared-column alignment using persisted condition fields; expose these in the existing condition settings and preserve preview/PPT/PNG/SVG bounds. Add source width/height badges for selected protein crop boxes without exporting editing overlays.
5. Verify targeted then full three-engine regression, inspect offline wide/narrow bilingual UI and actual exports, update handover/user docs, deliver a new dev HTML.

## Invariants

Retain all pre-existing uncommitted work. No private experimental data. Geometry badges use actual source units, never CSS or exported millimetres. Resizing one quantification rectangle changes the common width/height for that protein, not per-lane areas; moving a centre never changes figure geometry. Existing old-project defaults and annotation editing stay compatible. WebKit automation does not establish native Safari download/storage validation.

## Completion and verification — 2026-11-12

All five tasks are complete. New tests were first observed failing for missing entry points/dimension badges, then for review counterexamples (missing-lane zoom, reset after invalid input and focus after Apply). Fixed the underlying empty-view handling, shared validity refresh, explicit opener/replacement focus and animation-frame ResizeObserver scheduling. The condition renderer has a separate implementation/verification record in [2026-11-12-condition-layout.md](2026-11-12-condition-layout.md).

- Full frozen-tree runs `npm test -- --browser=chromium`, `firefox` and `webkit` all exit 0: **304 checks per engine, 912 total**, taking 422 s / 603 s / 445 s respectively. The new suites contribute 20 `quantux` checks and 11 `conditionlayout` checks per engine; the existing 30-check fixed-ROI suite and all prior suites remain included.
- All 56 runtime, tool, dependency-manifest and test files retain identical SHA-256 hashes before/after the final runs. JavaScript syntax, patch-whitespace and release-metadata checks pass; version stays 0.14.0.
- The rebuilt single-file bundle is exercised offline from `file://` in Chromium/WebKit, English/Chinese, 1600×1000 and 1100×900. Screenshots of condition-name controls and rendered left/right labels, selected protein crop dimensions, the control-value linkage, default/zoomed ROI editors, compact Chinese editing and plots were inspected manually. No page errors, document/modal horizontal overflow or HTTP requests. Real SVG downloads contain bars, points and the matching formula; condition tests also generate raster PNG and editable PPT and verify native text anchors/formatting. Desktop PowerPoint was not run.
- Deliver the verified offline bundle as `BlotFigure-dev-ui-refined.html`. No commit, push, merge, version bump or release. Native Safari.app storage/download and real experimental validation remain outside this synthetic/offline verification.
