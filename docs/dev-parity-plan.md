# Desktop parity work (dev only)

User scope, 2026-10-27: implement the retained GelFigure parity features, finish and push to `dev`. Do not merge or deploy `main` until the user confirms.

Excluded by the user's latest correction: original-colour/gray switching and RGB source-image processing; phone/tablet adaptation; redesigning Marker operations, catalogue previews/favourites, draggable marker panels or other minor Marker UX changes. Marker changes are limited to substantiated serious bugs (the imported-definition ID collision).

Image detection, independent exposure/linear levels, regional lane counts, image groups, manual marker anchors, unified marker font and row sorting remain unchanged. No new image-processing controls. RGB TIFF is only needed to retain red annotation pixels over grayscale WB images.

Implementation checklist:

- [x] Safe custom-marker ID imports; remap imported projects/presets and reset snapshots.
- [x] Desktop layout controls, system fonts and 0–90° lane-name angles.
- [x] Selection-based text formatting, name overrides, red annotation controls; persistence and editable exports.
- [x] Region annotation boxes, ×2/×3/×4 insets, side text, directly adjustable brackets; independent WB object anchors.
- [x] Compact layout/export checks and existing-core regression. Existing WB numbering stays regional; no forced global well numbering.
- [x] Offline update history, explicit text feedback, voluntary support/Star and post-export notices.
- [x] Bilingual docs, single-file build, meaningful browser/export tests.
- [ ] Commit and push `dev`, verify remote/CI. Keep `main` unchanged.

This file replaces the earlier broad planning documents for implementation scope.
