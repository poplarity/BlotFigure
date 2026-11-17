# Fixed-size quantification ROI and visible loading-control signals

## Approved behaviour

- Restore loading-control measurements in their original table cells, explicitly labelled as background-subtracted source signals rather than target/control ratios. Selecting the control shows its actual measurements and ROI editor, not a pointer to hidden details.
- Default each protein row to a fixed-width/fixed-height source-pixel ROI template. Automatic detection supplies initial centres and a suggested template, not independent signal-dependent widths. Different proteins retain independent templates.
- Provide a separate quantification-only source editor: draw a template, edit width/height, move one lane or the whole row, set optional equal spacing and relative angle, and preview values immediately. Cancel leaves all data unchanged; apply is one undoable project setting change. Never modify the figure's selected exposure, protein boxes, lane positions, display levels or layout.
- Use consistent, visible local background strips per protein, with configurable direction, gap and strip width. Integrate signed source signal minus local median background with original-pixel sampling. Do not silently clip edge ROIs, infer missing backgrounds or accept saturated fixed-ROI measurements. Detect overlapping signal/background regions and disclose exclusions.
- Keep the adaptive-profile calculation only as an explicitly labelled advanced alternative. Preserve dimensions, positions, background geometry, mode, exclusions and review/source provenance in projects and exports; accurately distinguish the methods.

## Execution

1. Add failing fixed-ROI numerical, state and real-UI tests.
2. Implement fixed-ROI measurement, geometry settings and provenance.
3. Add the bilingual interactive source editor and inline control values.
4. Update intentional legacy expectations, documentation and export descriptions.
5. Run targeted and full three-engine tests, inspect offline wide/narrow UI and actual exports, deliver a dev HTML without commit/push/release.

## Boundaries

Synthetic data only. A suggested ROI is not validated automatically. Equal spacing is optional, not evidence of sample correspondence. No automatic biological independence or publication guarantee. Version stays 0.14.0.

## Progress

All five implementation steps are complete. Failing counterexamples were observed before the fixed-ROI path, migration warning, source-value highlighting and raw background-saturation fix.

## Final verification — 2026-11-12

- Frozen-tree commands `npm test -- --browser=chromium`, `npm test -- --browser=firefox` and `npm test -- --browser=webkit` each exit 0: 273 checks per engine, 819 total (393 s / 515 s / 427 s). The new `quantroi` suite contributes 30 checks per engine, including numerical truth, variable band profiles with equal integrated mass, signed blanks, original-pixel saturation, real UI gestures, exports and portable projects. Existing `quant`, `quantplot` and `quantfigure` remain in the complete regression.
- All 54 runtime, dependency-manifest, build-tool and test files have identical SHA-256 hashes before and after the final runs. `node --check`, `git diff --check`, release-metadata validation and the final single-file build pass. Documentation-only edits do not change that frozen runtime.
- The final single-file HTML is checked from `file://` in Chromium/WebKit, English/Chinese and 1600×1000 / 1100×900. Real control cells show nine source signals; their integration/background overlays link correctly. The source editor, all-lane view, zoom, fixed dimensions, angle/background settings, apply/cancel, quantitative preview and SVG download work without document/modal horizontal overflow, page errors or HTTP requests. Final wide/narrow/control screenshots are manually inspected; exported SVGs each contain nine bars, nine points and the correct target/control formula with no external references.
- Deliver the validated bundle as `BlotFigure-dev-fixed-roi.html`. No commit, push, merge, release or application-version bump. Real experimental accuracy and native Safari.app download/storage behaviour remain unverified; suggested ROI geometry still requires experimental review.
