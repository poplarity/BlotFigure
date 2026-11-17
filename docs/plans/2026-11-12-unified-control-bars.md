# Unified current-figure control and responsive bar preview

> Historical record: inline control-source measurements and the default integration algorithm are superseded by [the fixed-ROI plan](2026-11-12-fixed-quantification-roi.md). Its earlier verification counts do not validate the later tree.

## Approved design

- The user selects one loading-control row from the completed figure, without image-group partitions. All targets divide by that control's corresponding figure-lane number, including targets from other source groups. Missing/invalid control lanes remain missing; they never shift subsequent pairings.
- Source groups remain provenance, not loading-control eligibility. One figure does not establish sample correspondence: the UI asks the user to confirm matching sample lanes. Hidden/deleted controls require reselection.
- The right panel defaults to quantitative results with an explicit target/control formula. Original background-subtracted measurements move to a folded detail table, not a competing top-level scale switch. The control row is labelled as the control rather than an unexplained row of dashes.
- Selecting bars immediately opens/updates the quantitative preview. Independent, nonoverlapping groups can use mean bars with individual points and optional SD. Otherwise bars show individual lane values with points and no group mean/SD; the UI explains which representation is active.
- Existing source exposures and measurements stay unchanged. CSV/JSON/Methods and portable projects preserve the unified control, lane mapping, exclusions and plot settings. Ambiguous legacy multiple-control choices are not silently promoted to one.

## Implementation steps

1. Add failing synthetic and real-UI counterexamples for unified selection, cross-group/cross-column lane matching, invalid control lanes, legacy ambiguity, simplified results, and bars without independent groups.
2. Resolve one figure-level control against measured visible rows; map denominators by figure-lane number and retain control provenance.
3. Simplify workspace result/raw-data presentation and make bar preview responsive without inventing group statistics.
4. Update exports, existing intentional expectations and bilingual docs.
5. Verify targeted and full three-engine regression, inspect offline wide/narrow UI and real exports, then deliver an offline dev HTML. Do not commit, push, bump version or release.

## Verification boundaries

Use synthetic demo data only. No automated p-values, no inferred biological replication, and no publication or native Safari.app guarantees. Previously passing tests are not evidence for this change.

## Completed verification — 2026-11-12

- Added the failing unified-control/bar-preview counterexamples before implementation, including a separate failing wording check for the obsolete “points only” sample-unit label. Final `quantfigure` run passes 25 checks per engine in Chromium, Firefox and WebKit; the existing 30-check `quantplot` and 43-check `quant` suites also passed across all three engines.
- Full final-tree commands `npm test -- --browser=chromium`, `npm test -- --browser=firefox` and `npm test -- --browser=webkit` all exit 0: 243 checks per engine, 729 total (182 s / 371 s / 322 s). The 52 runtime, tool, dependency-manifest and test files retain identical SHA-256 hashes before/after validation.
- Final `npm run build` succeeds. The rebuilt single-file HTML is checked offline from `file://` in Chromium/WebKit, Chinese/English and 1600×1000 / 1100×900: one control selector, cross-source target results, 9 individual bars plus 9 points without means/SD, 4 independently grouped panels with 8 mean bars/SD, folded/expanded raw data, source-point linkage and narrow settings drawer. No document overflow, page errors or HTTP requests. Final screenshots inspected manually.
- `node --check` for the changed quantification runtime/test modules and `git diff --check` pass. The delivered dev HTML is a copy of this validated bundle. No commit, push, merge, release or version bump; version remains 0.14.0. Real experiment accuracy and native Safari.app download/storage behaviour remain unverified.
