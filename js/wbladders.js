/* Prestained protein ladders (kDa, largest -> smallest) as visible on the membrane.
 * Verified against manufacturer pages 2026-10 unless noted. ref = coloured reference bands.
 * chemi: true = ladder shows up in the chemiluminescence image (antibody-detected), not the marker photo.
 */
(function (G) {
  'use strict';
  const L = [
    { id: 'pr26616', name: 'Thermo PageRuler Prestained (26616)', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 10] },
    { id: 'pr26619', name: 'Thermo PageRuler Plus Prestained (26619)', sizes: [250, 130, 100, 70, 55, 35, 25, 15, 10], ref: [70, 25, 10] },
    { id: 'sp26634', name: 'Thermo Spectra Multicolor Broad (26634)', sizes: [260, 140, 100, 70, 50, 40, 35, 25, 15, 10], ref: [] },
    { id: 'sp26625', name: 'Thermo Spectra Multicolor High (26625)', sizes: [300, 250, 180, 130, 100, 70, 50, 40], ref: [] },
    { id: 'br_pp', name: 'Bio-Rad Precision Plus Dual Color 1610374 / All Blue 1610373 / Kaleidoscope 1610375', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], ref: [75, 50, 25] },
    { id: 'br_ppx', name: 'Bio-Rad Precision Plus Dual Xtra (1610377)', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10, 5, 2], ref: [75, 25] },
    { id: 'neb7719', name: 'NEB Color Prestained Broad (P7719)*', sizes: [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10], ref: [72, 26], note: '部分条带大小未能从厂家页面核实' },
    { id: 'rpn800e', name: 'Amersham ECL Rainbow Full-Range (RPN800E)', sizes: [225, 150, 102, 76, 52, 38, 31, 24, 17, 12], ref: [] },
    { id: 'rpn756e', name: 'Amersham ECL Rainbow High-Range (RPN756E)', sizes: [225, 76, 52, 38, 31, 24, 17, 12], ref: [] },
    { id: 'odyssey1', name: 'LI-COR Odyssey One-Color', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10], ref: [75, 50, 25] },
    { id: 'vazmp102', name: 'Vazyme 180 kDa Prestained (MP102)', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 10] },
    { id: 'tgmp211', name: 'Tiangen 三色预染 (MP211)', sizes: [180, 130, 100, 72, 50, 40, 30, 25, 20, 15, 10], ref: [72, 25] },
    { id: 'mmxp', name: 'Thermo MagicMark XP (LC5602，抗体显色)', sizes: [220, 120, 100, 80, 60, 50, 40, 30, 20], ref: [], chemi: true }
  ];
  const KEY = 'blotfig.customLadders';
  function loadCustom() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function saveCustom(name, sizes) {
    const list = loadCustom().filter(l => l.name !== name);
    const lad = { id: 'c_' + Date.now(), name, sizes: sizes.slice().sort((a, b) => b - a), ref: [], custom: true };
    list.push(lad);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage off */ }
    return lad;
  }
  const all = () => L.concat(loadCustom());
  const get = id => all().find(l => l.id === id);

  // common loading controls / reference proteins (apparent kDa) for name suggestions
  const REF_PROTEINS = [
    ['GAPDH', 37], ['β-actin', 42], ['α-tubulin', 50], ['β-tubulin', 55], ['Vinculin', 124], ['HSP90', 90],
    ['Lamin B1', 68], ['Histone H3', 15], ['Total ERK1/2', 43], ['β-catenin', 92], ['PCNA', 36], ['Cofilin', 19]
  ];
  function suggest(kda) {
    if (!kda) return [];
    return REF_PROTEINS.map(([n, k]) => ({ n, d: Math.abs(Math.log(kda / k)) })).filter(o => o.d < 0.16).sort((a, b) => a.d - b.d).slice(0, 3).map(o => o.n);
  }
  const LOADING_RE = /gapdh|actin|tubulin|vinculin|lamin|histone|h3\b|hsp90|pcna|cofilin|total protein|ponceau|内参/i;

  G.ProteinLadders = { all, get, saveCustom, suggest, LOADING_RE };
})(window);
