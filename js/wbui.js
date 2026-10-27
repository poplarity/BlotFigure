/* BlotFigure UI: panel, top bar, coach line, preview with direct editing, exports. */
(function (G) {
  'use strict';
  const App = G.BApp, WB = G.WB, $ = id => document.getElementById(id);
  // the interface language (i18n.js): L('中文', 'English'), called when the text is built
  const L = G.L || (zh => zh);
  const list = a => a.join(L('、', ', '));
  // English counts: pl(3, 'lane') = "3 lanes", pl(1, 'box', 'boxes') = "1 box"
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const S = () => App.uiState();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const composing = e => e.isComposing || e.keyCode === 229;
  const live = fn => e => { if (!S()) return; fn(e); App.refresh(); App.saveDraftSoon(); };
  const done = fn => e => { if (!S()) return; if (fn) fn(e); App.commit(); };
  // the pieces (modules) a row comes from: "B", "A+B"; with several membranes "2·B"
  const modLabel = row => row.segs.map(App.boxLabel).join('+') || '—';
  const shortLabel = row => row.segs.length > 1 ? App.boxLabel(row.segs[0]) + ' +' + (row.segs.length - 1) : modLabel(row);

  /* ---------- feedback ---------- */
  function toast(msg, ms) {
    const box = $('toasts');
    while (box.children.length >= 3) box.firstElementChild.remove();      // (the newest three: a pile is unreadable)
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.transition = '.25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, ms || 2600);
  }
  const dismissed = new Set();
  function showWarnings(list) {
    const box = $('warnings'); box.innerHTML = '';
    [...new Set(list)].filter(w => !dismissed.has(w)).slice(0, 4).forEach(w => {
      const d = document.createElement('div'); d.innerHTML = `<span>⚠ ${esc(w)}</span>`;
      const x = document.createElement('button'); x.textContent = '×'; x.title = L('不再提示', 'Dismiss'); x.onclick = () => { dismissed.add(w); d.remove(); };
      d.appendChild(x); box.appendChild(d);
    });
  }

  /* ---------- modes ---------- */
  App.setMode = function (m) {
    if (App.mode === 'marks' && m !== 'marks') closePop();
    if (App.mode === 'align' && m !== 'align') G.View.alignEnd();
    if (App.mode === 'pieces' && m !== 'pieces') G.View.piecesEnd(false);
    App.mode = m;
    if(m)App.selectedBoxes.clear();
    // the figure's banner for figure modes, the membrane view's banner for clicks on the membrane
    const onView = m === 'addrow' || m === 'marks' || m === 'align' || m === 'pieces';
    $('modeBanner').classList.toggle('hidden', !m || onView);
    $('viewBanner').classList.toggle('hidden', !onView);
    $('modeText').textContent = m === 'group' ? L('在成图上从第一个泳道名拖到最后一个', 'On the figure, drag from the first lane name to the last')
      : m === 'arrow' ? L('在成图上点目标条带：箭头吸附到条带，按 Marker 标分子量',
        'Click the target band on the figure: the arrow snaps to the band and gets its size from the marker')
      : m === 'bracket' ? L('在成图上沿着行上下拖出括号 · 点一行 = 整行 · Alt 不吸附行边',
        'Drag up or down along the rows on the figure · click a row = the whole row · Alt: no snapping to row edges') : '';
    $('viewModeText').textContent = m === 'addrow' ? L('移到蛋白条带上点一下放下框（或按住拖出任意大小）· Esc 取消',
      'Click on a protein band to place a box (or drag one out at any size) · Esc to cancel')
      : m === 'marks' ? L('第 4 步：点一条 Marker 带，选它的分子量 · 拖动对准（自动吸附，Alt 不吸附）· 点数字改',
        'Step 4: click a marker band and pick its size · drag to line it up (snaps; Alt: no snapping) · click a number to change it')
      : m === 'align' ? L('拖动图片让条带落进框里 · Shift+拖动或 [ ] 旋转 · 方向键微调',
        'Drag the picture so the bands sit in the boxes · Shift+drag or [ ] to rotate · arrow keys to nudge')
      : m === 'pieces' ? L('确认前先填预计泳道数（可选），每框仍独立识别。拖蓝框检查膜区；拖边角改大小。',
        'Before confirming, set expected lanes (optional); each box is still detected independently. Drag blue boxes or their corners to check strips.') : '';
    const vb = App.S && App.blot(App.viewBlot);
    // (the modes of steps 2 and 4 end with the step: their banners lead on to the next one)
    $('viewModeExtra').innerHTML = m === 'align' ? `<button id="vmAuto" title="${L('按白光图和条带自动对齐（整张膜的图都重新对齐）', 'Align automatically by the white-light picture and the bands (every picture of this membrane is aligned again)')}">${L('自动对齐', 'Auto-align')}</button>`
        + `<button id="vmNone" title="${L('按原样使用这张图，不移动', 'Use this picture as taken, without moving it')}">${L('不对齐', "Don't align")}</button>`
      : m === 'pieces' ? `${vb && vb.userStrips ? `<button id="vmPcAuto" title="${L('丢掉手动调整，按 Marker 图重新自动找膜条', 'Discard the changes made by hand and find the strips on the marker picture again')}">${L('恢复自动', 'Back to automatic')}</button>` : ''}`
        + `<button id="vmPcNext" class="go">${pcUnseen() ? L('这张对了，看下一组 →', 'This one is right. Next group →') : L('下一步 →', 'Next →')}</button>`
      : m === 'marks' ? `<button id="vmMkNext" class="go">${L('下一步 →', 'Next →')}</button>` : '';
    if (m === 'align') {
      const id = App.alignImg;
      $('vmAuto').onclick = () => {
        G.View.alignEnd(); App.mode = null; App.busy(true, L('自动对齐…', 'Aligning…'));
        setTimeout(() => { App.autoAlign(id); App.busy(false); App.commit(); App.setMode('align'); G.View.alignStart(id); toast(L('已重新自动对齐这张膜的图', "Aligned this membrane's pictures automatically again")); }, 20);
      };
      $('vmNone').onclick = () => { G.View.alignEnd(); App.setAlign(id, null); App.commit(); G.View.alignStart(id); toast(L('这张图按原样使用（不移动）', 'This picture is used as taken (not moved)')); };
    }
    if (m === 'pieces') {
      $('vmPcNext').onclick = () => vb?.boxesReady ? rebuildGroup() : nextStep(2);
      if(vb?.boxesReady)$('vmPcNext').textContent=L('重新识别本组 →','Detect this group again →');
      if(S().step>2)$('vmPcNext').textContent=L('完成，返回成图','Done, return to figure');
      if ($('vmPcAuto')) $('vmPcAuto').onclick = () => { G.View.piecesEnd(false); applyPieces(vb, null, true); };
    }
    if (m === 'marks') { $('vmMkNext').onclick = () => S().step>4 ? openStep(5) : nextStep(4); if(S().step>4)$('vmMkNext').textContent=L('完成，返回成图','Done, return to figure'); }
    $('viewModeCancel').classList.toggle('hidden', m === 'pieces' || m === 'marks');
    $('viewModeCancel').textContent = m === 'align' ? L('完成', 'Done') : L('取消 (Esc)', 'Cancel (Esc)');
    $('btnAddRow').classList.toggle('primary', m === 'addrow');
    $('btnAddGroup').classList.toggle('on', m === 'group');
    $('btnAddArrow').classList.toggle('on', m === 'arrow');
    $('btnAddBracket').classList.toggle('on', m === 'bracket');
    $('preview').classList.toggle('picking', m === 'arrow');
    $('preview').classList.toggle('bracketing', m === 'bracket');
    if (m !== 'marks') { App.selMark = null; App.markFocus = null; }
    if (S()) renderMarker();
    G.View.draw();
  };
  $('modeCancel').onclick = () => App.setMode(null);
  $('viewModeCancel').onclick = () => App.setMode(null);
  /* marking the ladder on a membrane's Marker picture (step 4; a piece: zoomed to it) */
  function startMarks(b, pc) {
    if (!S() || !b) return;
    if (App.mode && App.mode !== 'marks') App.setMode(null);
    closePop();
    App.viewBlot = b.id;
    const mk = App.markerRec(b);
    if (mk) App.viewImg = mk.id;
    App.selRow = null; App.selSeg = null; App.selLane = null;
    App.setMode('marks');
    App.markFocus = pc ? pc.id : null;
    App.emit('select');
    if (pc) G.View.fitPiece(pc); else G.View.fitFull();
    $('editorBox').focus({ preventScroll: true });
    if (!mk) toast(L('这张膜没有 Marker 图：在曝光图上标 Marker 带也可以（看得见 Marker 的话）',
      'This membrane has no marker picture: you can mark the marker bands on an exposure instead (if the marker shows there)'), 4200);
  }
  /* the membrane's pieces by hand (step 2): on its Marker picture (the outlines show best there). Several
   * membranes: one after the other ("next" goes on to the next one not looked at yet). */
  const pcSeen = new Set();
  const pcUnseen = () => S().blots.find(o => !pcSeen.has(o.id));
  function startPieces(b) {
    if (!S() || !b) return;
    if (App.mode) App.setMode(null);
    closePop();
    App.viewBlot = b.id;
    pcSeen.add(b.id);
    const mk = App.markerRec(b);
    if (mk) App.viewImg = mk.id;
    App.selRow = null; App.selSeg = null; App.selLane = null;
    App.setMode('pieces');
    App.emit('select');
    G.View.piecesStart();
    $('editorBox').focus({ preventScroll: true });
  }
  /* pcs: the outlines as edited (null: nothing changed) applied — the membrane analysed on them, its boxes
   * staying where they are; toAuto: the pieces found automatically again. then: once done. */
  function applyPieces(b, pcs, toAuto, then) {
    if (!b || (!pcs && !toAuto)) { if (then) then(); return; }
    App.busy(true, L('按膜条重新分析…', 'Analysing again by the strips…'));
    setTimeout(() => {
      App.setPieces(b, toAuto ? null : pcs);
      App.busy(false); App.commit();
      if (toAuto) { toast(L('膜条已恢复自动识别', 'Strips are detected automatically again')); if (App.curStep === 2) startPieces(b); }
      if (then) then();
    }, 20);
  }

  /* ---------- loading ---------- */
  async function addFiles(files) {
    const n = await App.addFiles(files);
    if (!n) return;
    const st = S(), moved = st.blots.reduce((s, b) => s + nMoved(b), 0);
    const nb = st.blots.length;
    toast(L(`已载入 ${n} 张图片（${nb} 个图片组）`, `Loaded ${pl(n, 'picture')} (${pl(nb, 'image group')})`)
      + (moved ? L(`，${moved} 张拍摄时膜的位置不同，已自动对齐`, `; ${moved} ${moved === 1 ? 'was' : 'were'} taken with the membrane elsewhere and aligned automatically`) : '')
      + L('。第 1 步：整理图片分组，确认各组的 Marker 参考图', '. Step 1: organise image groups and choose each marker reference'), moved ? 5200 : 4000);
    // (8-bit pictures: said once, not once per file)
    const lw = App.loadWarnings || [];
    if (lw.length) {
      toast(lw.length > 1 ? L(`有 ${lw.length} 张不是 16 位 TIFF，按 8 位处理：动态范围低，过曝像素不好判断；有成像仪导出的 16 位 TIFF 的话建议用它`,
        `${lw.length} pictures are not 16-bit TIFF and are read as 8-bit: low dynamic range, saturated pixels are hard to tell. If your imager exports 16-bit TIFF, use that`) : lw[0], 6000);
    }
  }
  ['fileInput', 'fileInput2', 'fileInput3'].forEach(id => $(id).addEventListener('change', e => { $('fileMenu').classList.add('hidden'); (G.Extras ? G.Extras.importFiles([...e.target.files], true) : addFiles(e.target.files)); e.target.value = ''; }));
  async function loadDemo() {
    App.busy(true, L('生成示例膜图…', 'Making the example blots…'));
    await new Promise(r => setTimeout(r, 30));
    const files = G.WBDemo.files(G.WBDemo.cutSession()).concat(G.WBDemo.files(G.WBDemo.scatterSession()));
    await addFiles(files);
  }
  $('btnDemo').onclick = loadDemo;
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if ([...(e.dataTransfer || {}).types || []].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer.files.length) (G.Extras ? G.Extras.importFiles([...e.dataTransfer.files]) : addFiles(e.dataTransfer.files)); });

  /* ---------- top bar ---------- */
  $('btnUndo').onclick = () => App.undo();
  $('btnRedo').onclick = () => App.redo();
  $('btnHelp').onclick = () => $('helpDlg').classList.remove('hidden');
  $('btnHelpClose').onclick = () => $('helpDlg').classList.add('hidden');
  $('btnExportMenu').onclick = e => { e.stopPropagation(); $('fileMenu').classList.add('hidden'); $('exportMenu').classList.toggle('hidden'); };
  $('btnFile').onclick = e => { e.stopPropagation(); $('exportMenu').classList.add('hidden'); $('fileMenu').classList.toggle('hidden'); };
  $('fileMenu').addEventListener('click', e => e.stopPropagation());
  $('exportMenu').addEventListener('click', e => { if (e.target.closest('.menu-check')) e.stopPropagation(); });   // (a tick keeps the menu open)
  document.addEventListener('click', () => { $('exportMenu').classList.add('hidden'); $('fileMenu').classList.add('hidden'); });
  /* the interface language: what is open was built in the old one — finished first (a popover, the text editor
   * on the figure, the menus); then everything the script writes is written again (the static page: i18n.js) */
  if (G.I18N) {
    if ($('btnLang')) {
      $('btnLang').onclick = () => {
        closePop(); if (edit) closeEd(false);
        $('exportMenu').classList.add('hidden'); $('fileMenu').classList.add('hidden');
        G.I18N.set(G.I18N.lang === 'en' ? 'zh' : 'en');
      };
    }
    G.I18N.onChange(() => {
      if (S()) { App.setMode(App.mode); App.emit('change'); }    // (the open mode's banner, then every panel)
      else offerDraft();
    });
  }
  /* ---------- projects ---------- */
  async function saveProject() {
    $('fileMenu').classList.add('hidden');
    if (!S()) { toast(L('还没有内容可保存', 'Nothing to save yet')); return; }
    App.busy(true, L('保存项目…', 'Saving project…'));
    try {
      await G.UI.flushPending(); const blob = await App.saveProject();
      G.Export.download(blob, 'blot_project.blotfig');
      App.saved = App.hist[App.hist.length - 1];
      const mb = (blob.size / 1048576).toFixed(1);
      toast(L(`已保存项目（${mb} MB）：下次"文件 → 打开项目"接着做`, `Saved project (${mb} MB). Open it later with File → Open project.`), 3600);
    } catch (e) { alert(L('保存失败：', 'Could not save: ') + e.message); } finally { App.busy(false); }
  }
  $('btnSaveProj').onclick = saveProject;
  $('projInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; $('fileMenu').classList.add('hidden');
    if (!f) return;
    if (G.Extras && !(await G.Extras.archiveCurrent())) return;
    try { const n = await App.openProject(f); toast(L(`已打开项目：${n} 张图片`, `Opened project: ${pl(n, 'picture')}`)); } catch (err) { alert(L('打开失败：', 'Could not open: ') + err.message); }
  });
  window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); } });
  // leaving with work not saved as a project: the browser asks first (the draft keeps it too, if it can)
  window.addEventListener('beforeunload', e => { if (!App.leaving && S() && (G.View.piecesDirty() || (S().rows.length && App.hist.length > 1 && App.hist[App.hist.length - 1] !== App.saved && !(App.cacheStatus==='saved' && App.cachedSnapshot===JSON.stringify(App.S))))) { e.preventDefault(); e.returnValue = ''; } });
  /* ---------- style files, resets (as GelFigure's file menu) ---------- */
  $('btnSaveTpl').onclick = () => {
    $('fileMenu').classList.add('hidden');
    if (!S() || !S().rows.length) { toast(L('先做出一张图，再保存它的样式', 'Make a figure first, then save its style')); return; }
    G.Export.download(new Blob([JSON.stringify(App.template(), null, 2)], { type: 'application/json' }), 'blot_style.json');
    toast(L('已保存样式：下一张同类的图"文件 → 载入样式"一键套用', 'Saved style. Use it on the next figure of the series with File → Apply style.'), 3600);
  };
  $('tplInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; $('fileMenu').classList.add('hidden');
    if (!f) return;
    if (!S() || !S().rows.length) { toast(L('先做到第 3 步（有了蛋白框），再套用样式', 'Get to step 3 (protein boxes) first, then apply a style')); return; }
    try {
      const t = JSON.parse(await f.text());
      if (!t || !t.blotfigTemplate) throw new Error(L('不是 BlotFigure 样式文件', 'Not a BlotFigure style file'));
      const fl = App.figLanes().length, vis = S().rows.filter(r => !r.hidden).length;
      const tl = (t.lanes || []).length, tp = (t.proteins || []).length;
      if (tl !== fl || tp !== vis) {
        if (!confirm(L(`样式里有 ${tl} 条泳道、${tp} 个蛋白，这张图是 ${fl} 条泳道、${vis} 个蛋白。\n会从第一条泳道、第一行起按顺序对应，多出来的忽略。继续？`,
          `The style has ${pl(tl, 'lane')} and ${pl(tp, 'protein')}; this figure has ${pl(fl, 'lane')} and ${pl(vis, 'protein')}.\nThey are matched in order from the first lane and the first row; any extra are ignored. Continue?`))) return;
      }
      App.applyTemplate(t); App.commit();
      toast(L('样式已套用（Ctrl+Z 可撤销）', 'Style applied (Ctrl+Z to undo)'));
    } catch (err) { alert(L('样式载入失败：', 'Could not apply the style: ') + err.message); }
  });
  $('btnResetAll').onclick = () => {
    $('fileMenu').classList.add('hidden');
    if (!S()) return;
    if (App.hist[App.hist.length - 1] === App.initial) {
      toast(App.initialAsOpened ? L('现在就是打开项目时的样子', 'This is already how the project was when opened')
        : L('现在就是刚导入时的样子，没有要撤回的改动', 'This is already how it was after import: nothing to take back'));
      return;
    }
    const when = App.initialAsOpened ? L('打开这个项目时（它保存时还没有记录导入时的状态）', 'when this project was opened (it was saved before the state after import was recorded)')
      : L('刚导入图片时', 'right after the pictures were imported');
    if (!confirm(L(`回到${when}的样子：膜条、蛋白框、名字、Marker 刻度和标注都会回到那时的状态。\n这一步可以用 Ctrl+Z 撤销。继续？`,
      `Go back to how it was ${when}: strips, protein boxes, names, marker ticks and annotations all return to that state.\nCtrl+Z undoes this. Continue?`))) return;
    if (App.resetAll()) { App.curStep = S().step; App.commit(); openStep(App.curStep); toast(L('已回到刚导入时（Ctrl+Z 可撤销）', 'Back to import (Ctrl+Z to undo)')); }
  };
  $('btnNew').onclick = () => G.Extras?.newProject();
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable || composing(e) || e.defaultPrevented || e.repeat) return;
    if ((e.key === 'Backspace' || e.key === 'Delete') && S() && App.boxSelection().length && !App.mode && (e.target === $('previewBox') || e.target === document.body)) { e.preventDefault(); deleteSelectedBoxes(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); }
    if(e.key==='Escape' && App.selectedBoxes.size){App.selectBoxes([]);App.emit('select');e.preventDefault();return;}
    if (e.key === 'Escape') {
      if (!$('helpDlg').classList.contains('hidden')) { $('helpDlg').classList.add('hidden'); return; }
      if (popOpen) { closePop(); return; }            // (one thing at a time: the popover, then the mode)
      // (the modes of steps 2 and 4 last as long as the step)
      if (App.mode && App.mode !== 'pieces' && App.mode !== 'marks') App.setMode(null);
    }
    // Alt+↑↓: the selected row one place up / down in the figure
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && S() && App.selRow) {
      e.preventDefault();
      if (App.moveRowBy(App.selRow, e.key === 'ArrowUp' ? -1 : 1)) App.commit();
    }
  });
  $('dpiTop').addEventListener('change', done(e => { S().style.dpi = +e.target.value; }));
  const baseName = () => 'blot_figure';
  const needFigure = () => { if (S() && S().rows.some(r => !r.hidden)) return false; toast(L('还没有可导出的行', 'No rows to export yet')); return true; };
  /* ---------- export, with a check first (as GelFigure) ---------- */
  const pref = (k, v) => { if (v === undefined) return G.PrefStorage.getItem('blotfig.' + k); G.PrefStorage.setItem('blotfig.' + k, v); return null; };
  $('preflightOn').checked = pref('preflight') !== '0';
  $('preflightOn').addEventListener('change', e => pref('preflight', e.target.checked ? '1' : '0'));
  // true = go ahead, false = the user went back to fix something
  function preflight() {
    return new Promise(resolve => {
      if (pref('preflight') === '0') return resolve(true);
      const items = App.preflight(), serious = items.filter(i => i.level === 'block' || i.level === 'warn');
      if (!serious.length) return resolve(true);
      const lab = { block: L('需处理', 'Fix'), warn: L('注意', 'Warning'), info: L('提示', 'Note') };
      $('pfList').innerHTML = items.map((it, k) => `<div class="pf-item"><span class="lv ${it.level}">${lab[it.level]}</span><span class="tx">${esc(it.text)}</span>${it.fix ? `<button class="btn sm" data-fix="${k}">${esc(it.fix.label)}</button>` : ''}</div>`).join('');
      const close = ok => { $('preflightDlg').classList.add('hidden'); if ($('pfOff').checked) { pref('preflight', '0'); $('preflightOn').checked = false; } resolve(ok); };
      $('pfList').querySelectorAll('[data-fix]').forEach(b => b.onclick = () => {
        const fx = items[+b.dataset.fix].fix;
        if (fx.leave) { close(false); fx.run(); return; }
        fx.run(); App.commit(); b.disabled = true; b.textContent = L('已修正', 'Fixed');
      });
      $('pfOff').checked = false;
      $('preflightDlg').classList.remove('hidden');
      $('pfBack').onclick = () => close(false);
      $('pfGo').onclick = () => close(true);
    });
  }
  const exportTexts = () => ({ Software: 'BlotFigure ' + App.VERSION, Description: App.summaryText() });
  async function exportRaster(kind) {
    if (needFigure() || !(await preflight())) return;
    App.busy(true, L('导出中…', 'Exporting…'));
    try {
      const f = G.BRender.build(false), dpi = S().style.dpi, eff = Math.round(App.effectiveDpi());
      if (kind === 'tiff') await G.Export.exportTIFF(f.svg, f.w, f.h, dpi, `${baseName()}_${dpi}dpi.tif`, exportTexts());
      else await G.Export.exportPNG(f.svg, f.w, f.h, dpi, `${baseName()}_${dpi}dpi.png`, exportTexts());
      G.dispatchEvent(new Event('blotfigure-figure-exported'));
      const fmt = kind === 'tiff' ? 'TIFF' : 'PNG';
      toast(L(`已导出 ${dpi} dpi ${fmt}`, `Exported ${dpi} dpi ${fmt}`) + (eff < dpi ? L(`（条带本身 ${eff} dpi）`, ` (the bands themselves are ${eff} dpi)`) : ''));
    } catch (e) { alert(e.message); } finally { App.busy(false); }
  }
  $('btnPNG').onclick = () => exportRaster('png');
  $('btnTIFF').onclick = () => exportRaster('tiff');
  $('btnPPTX').onclick=async()=>{
    if(needFigure() || !(await preflight()))return;
    App.busy(true,L('生成可编辑 PPT…','Building editable PPT…'));
    try { await new Promise(r=>setTimeout(r,20));await G.PPTX.exportFile(baseName()+'.pptx');G.dispatchEvent(new Event('blotfigure-figure-exported'));toast(L('已导出：文字可编辑，图片格式 → 裁剪可恢复全图','Exported: edit text or use Picture Format → Crop to restore the full picture'),5000); }
    catch(e){toast(L('PPT 导出失败：','PPT export failed: ')+e.message,6000);}finally{App.busy(false);}
  };
  $('btnSVG').onclick = async () => { if (needFigure() || !(await preflight())) return;try{G.Export.exportSVG(G.BRender.build(false).svg, baseName() + '.svg');G.dispatchEvent(new Event('blotfigure-figure-exported')); toast(L('已导出 SVG', 'Exported SVG'));}catch(e){toast(L('SVG 导出失败：','SVG export failed: ')+e.message,5000);} };
  $('btnLog').onclick = () => {
    if (needFigure()) return;
    G.Export.download(new Blob([JSON.stringify(App.processingLog(), null, 2)], { type: 'application/json' }), baseName() + '_processing_log.json');
    toast(L('已导出处理日志（含每张原图的 SHA-256）', 'Exported the processing log (with the SHA-256 of every original)'));
  };
  $('btnLegend').onclick = async () => {
    if (!S()) return;
    const t = App.checks().legend.join(' ');
    try { await navigator.clipboard.writeText(t); toast(L('图注文字已复制', 'Legend text copied')); } catch (e) { prompt(L('复制下面的图注文字：', 'Copy the legend text below:'), t); }
  };
  $('btnRaw').onclick = () => { if (S()) exportRaw(); };
  $('btnQuant').onclick = () => { if (S()) exportQuant(); };

  /* ---------- 1 membranes & pictures ---------- */
  function thumbCanvas(rec) {
    const size=App.curStep===1?240:96, cacheKey=rec.kind+'|'+size+'|'+JSON.stringify(App.S.levels[rec.id]||{})+'|'+App.S.style.invert;
    if(rec._uiThumb?.img===rec.img && rec._uiThumb.key===cacheKey)return rec._uiThumb.canvas;
    const c = document.createElement('canvas'), t = {w:Math.round(rec.img.w/Math.max(1,Math.ceil(Math.max(rec.img.w,rec.img.h)/size))),h:Math.round(rec.img.h/Math.max(1,Math.ceil(Math.max(rec.img.w,rec.img.h)/size)))};
    c.width = t.w; c.height = t.h;
    const src = rec.kind === 'chemi' ? WB.down({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, Math.max(1, Math.ceil(rec.img.w / t.w))) : WB.down(rec.img, Math.max(1, Math.ceil(rec.img.w / t.w)));
    const id = c.getContext('2d').createImageData(src.w, src.h);
    c.width = src.w; c.height = src.h;
    const map = rec.kind === 'chemi' ? App.mapper(rec.id) : null;
    const [lo, hi] = rec.kind === 'chemi' ? [0, 1] : G.Engine.percentiles(src.data, [1, 99], 1);
    for (let i = 0; i < src.w * src.h; i++) {
      const v = map ? map(src.data[i]) : clamp((src.data[i] - lo) / Math.max(1e-6, hi - lo) * 255, 0, 255);
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    c.getContext('2d').putImageData(id, 0, 0);
    rec._uiThumb={img:rec.img,key:cacheKey,canvas:c};return c;
  }
  const nMoved = b => b.images.filter(id => App.isMoved(id)).length;
  const wlOpen = new Set();          // membranes whose white-light pictures are all shown
  /* step 1: every membrane with its pictures — the Marker picture (★: the one its pieces are found in and its
   * marker is marked on) marked, any other set as it in one click; a picture's kind, exposure time, alignment
   * and membrane in its ⋯ */
  const imageSelection = new Set();
  const imageDragType = 'application/x-blotfigure-images';
  let imageDragIds = null; // Safari can strip custom MIME data; same-page drags also keep their IDs here.
  document.addEventListener('dragend', () => { imageDragIds = null; });
  function changedImages(message) {
    imageSelection.clear(); closePop(); App.curStep = 1; App.commit(); G.View.fitFull();
    toast(message + L('（Ctrl+Z 可撤销；确认分组后再分析）', ' (Ctrl+Z to undo; analysis waits until groups are confirmed)'), 3800);
  }
  function deletePictures(ids) { const n = App.removeImages(ids); if (n) changedImages(L(`已移除 ${n} 张图`, `Removed ${pl(n, 'picture')}`)); }
  function movePictures(ids, target) { const n = App.moveImages(ids, target); if (n) changedImages(L(`已移动 ${n} 张图`, `Moved ${pl(n, 'picture')}`)); }
  function imageDropTarget(el, target) {
    el.addEventListener('dragover', e => { if (!imageDragIds && !Array.from(e.dataTransfer.types).includes(imageDragType)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop-images'); });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-images'); });
    el.addEventListener('drop', e => {
      const data = e.dataTransfer.getData(imageDragType); if (!data && !imageDragIds) return;
      e.preventDefault(); e.stopPropagation(); el.classList.remove('drop-images');
      try { movePictures(imageDragIds || JSON.parse(data), target); imageDragIds = null; } catch (err) { toast(err.message); }
    });
  }
  function renderBlots() {
    const st = S(), box = $('blotList'); box.innerHTML = '';
    const active = App.activeImageIds(); imageSelection.forEach(id => { if (!active.has(id)) imageSelection.delete(id); });
    const tools = document.createElement('div'); tools.className = 'image-tools';
    tools.innerHTML = `<p class="hint">${L('拖动图片到正确的图片组；勾选多张可一起移动或移除。', 'Drag pictures into the correct image group. Select several to move or remove together.')}</p>
      <div class="image-actions"><label><input type="checkbox" id="selectImages" ${active.size && imageSelection.size === active.size ? 'checked' : ''}> ${L('全选', 'All')}</label><span>${L(`已选 ${imageSelection.size} 张`, `${imageSelection.size} selected`)}</span>
      <button class="btn sm danger" id="removeImages" ${imageSelection.size ? '' : 'disabled'}>${L('移除所选', 'Remove selected')}</button></div>
      ${imageSelection.size ? `<select id="moveImages" aria-label="${L('移动所选图片', 'Move selected pictures')}"><option value="">${L('移动到…', 'Move to…')}</option>${st.blots.map(b=>`<option value="${b.id}">${esc(App.blotName(b))}</option>`).join('')}<option value="new">${L('新图片组', 'New image group')}</option></select>` : ''}`;
    box.appendChild(tools);
    tools.querySelector('#selectImages').onchange = e => { imageSelection.clear(); if (e.target.checked) active.forEach(id => imageSelection.add(id)); renderBlots(); };
    tools.querySelector('#removeImages').onclick = () => deletePictures([...imageSelection]);
    const mover = tools.querySelector('#moveImages'); if (mover) mover.onchange = e => { if (e.target.value) movePictures([...imageSelection], e.target.value); };
    st.blots.forEach(b => {
      const card = document.createElement('div');
      card.className = 'blot-card' + (b.id === App.viewBlot ? ' view' : '');
      card.dataset.blot = b.id; imageDropTarget(card, b.id);
      const nCh = App.chemiOf(b).length, nM = App.markersOf(b).length, mk = App.markerRec(b);
      const nMv = nMoved(b);
      card.innerHTML = `<div class="blot-head"><input type="text" value="${esc(b.name)}" placeholder="${esc(App.blotName(b))}" title="${L('图片组名称（同一拍摄布局的参考图与各次曝光）', 'Image group name (one capture layout and its exposures)')}"><button class="link group-select">${L('选本组', 'Select group')}</button></div>
        <div class="blot-sub">${L(`${nCh} 张曝光 · ${nM} 张白光 / 复合图`, `${pl(nCh, 'exposure')} · ${nM} white-light / merged`)}${nMv ? ` · <span title="${L('拍摄之间膜的位置变过：这些图已对齐到同一位置', 'The membrane moved between captures: these pictures are aligned to one position')}">${L(`${nMv} 张已对齐`, `${nMv} aligned`)}</span>` : ''}</div>
        ${mk ? '' : `<p class="hint warn-t">${L('没认出 Marker 图：点看得见 Marker 的那张下面的"设为 Marker 图"。确实没有的话也可以继续，只是不能标分子量。',
          'No marker picture recognised: click "Set as marker picture" under the one that shows the marker. If there is none you can go on, only without molecular weights.')}</p>`}
        <div class="th-label">${L('白光 / 复合图', 'White light / merged')} <span>${nM}</span></div><div class="thumbs" data-kind="marker"></div>
        <div class="th-label">${L('曝光图', 'Exposures')} <span>${nCh}</span></div><div class="thumbs" data-kind="chemi"></div>`;
      // white-light pictures (often one per capture, all alike): the Marker picture and the grid's, the rest
      // behind "+N" unless opened or shown
      const wl = App.markersOf(b), keep = r => App.curStep===1 || wlOpen.has(b.id) || wl.length <= 3 || r.id === b.marker || r.id === b.frame || (r.id === App.viewImg && b.id === App.viewBlot);
      b.images.map(id => App.images.get(id)).filter(Boolean).filter(r => r.kind !== 'marker' || keep(r)).sort((x, y) => (y.id === b.marker) - (x.id === b.marker) || (x.exposure || 0) - (y.exposure || 0)).forEach(rec => {
        const th = card.querySelector(`.thumbs[data-kind="${rec.kind}"]`);
        const t = document.createElement('div');
        t.className = 'thumb' + (rec.id === App.viewImg && b.id === App.viewBlot ? ' on' : '') + (rec.id === b.marker ? ' mk' : '');
        t.dataset.image = rec.id; t.draggable = true; t.classList.toggle('selected', imageSelection.has(rec.id));
        t.ondragstart = e => { const ids = imageSelection.has(rec.id) ? [...imageSelection] : [rec.id]; imageDragIds = ids; e.dataTransfer.setData(imageDragType, JSON.stringify(ids)); e.dataTransfer.setData('text/plain', 'BlotFigure pictures'); e.dataTransfer.effectAllowed = 'move'; };
        t.ondragend = () => document.querySelectorAll('.drop-images').forEach(el => el.classList.remove('drop-images'));
        t.title = rec.name + (rec.resampled ? L('（已缩放到与曝光图相同尺寸）', " (resized to the exposures' size)") : '');
        t.appendChild(thumbCanvas(rec));
        // which figure rows take their bands from this exposure (row colours)
        const users = rec.kind === 'chemi' ? st.rows.filter(r => !r.hidden && r.img === rec.id) : [];
        const usesHtml = users.length ? `<span class="uses" title="${L('成图中用这张曝光的行：', 'Rows in the figure that use this exposure: ')}${esc(list(users.map(r => r.name || (App.rowKda(r) ? '≈' + Math.round(App.rowKda(r)) + ' kDa' : L('未命名', 'unnamed')))))}">${users.map(r => `<i style="background:${App.rowColor(r)}"></i>`).join('')}</span>` : '';
        // the membrane lay elsewhere in this picture: aligned onto the others (the grid's own picture: 基准)
        const al = App.alignOf(rec.id), alHtml = App.isMoved(rec.id) ? `<span class="aligned" title="${esc(alignWords(rec, b))}${L('；在 ⋯ 里可手动调整', '; adjust by hand in ⋯')}">${al.how === 'manual' ? L('手动', 'Manual') : L('已对齐', 'Aligned')}</span>`
          : b.frame === rec.id && b.images.some(id => App.isMoved(id)) ? `<span class="aligned base" title="${L('基准：这张膜的其他图都对齐到这张', 'Reference: the other pictures of this membrane are aligned to this one')}">${L('基准', 'Reference')}</span>` : '';
        // the Marker picture (★), else its label and "set as the Marker picture"
        const mkTip = L('膜条从这张图找，Marker 在这张图上标', 'The strips are found in this picture and the marker is marked on it');
        const cap = rec.id === b.marker ? `<span class="isx" title="${mkTip}">${L('★ Marker 图', '★ Marker picture')}</span>`
          : `${rec.kind === 'marker' ? L('白光', 'White light') : `<b>${esc(App.expoLabel(rec))}</b>`}<br><button class="setmk" title="${mkTip}">${L('设为 Marker 图', 'Set as marker picture')}</button>`;
        t.insertAdjacentHTML('beforeend', `${usesHtml}${alHtml}<div class="cap">${cap}</div><button class="more" title="${L('类型、曝光时间、对齐、移到别的膜、移除', 'Kind, exposure time, alignment, move to another membrane, remove')}">⋯</button>`);
        t.insertAdjacentHTML('beforeend', `<input class="image-select" type="checkbox" aria-label="${L('选择图片', 'Select picture')} ${esc(rec.name)}" ${imageSelection.has(rec.id) ? 'checked' : ''}><button class="image-remove" title="${L('移除这张图（可撤销）', 'Remove picture (undoable)')}">×</button>`);
        const check = t.querySelector('.image-select'); check.onclick = e => e.stopPropagation(); check.onchange = () => { if (check.checked) imageSelection.add(rec.id); else imageSelection.delete(rec.id); renderBlots(); };
        t.querySelector('.image-remove').onclick = e => { e.stopPropagation(); deletePictures([rec.id]); };
        t.onclick = e => { if (e.target.closest('button,input')) return; App.viewBlot = b.id; App.viewImg = rec.id; App.emit('select'); G.View.fitFull(); };
        t.querySelector('.more').onclick = e => { e.stopPropagation(); imagePopover(rec, b, t); };
        const sm = t.querySelector('.setmk');
        if (sm) sm.onclick = e => {
          e.stopPropagation();
          App.busy(true, L('设置 Marker 图…', 'Setting marker picture…'));
          setTimeout(() => {
            App.setMarkerImage(b, rec.id); App.viewBlot = b.id; App.viewImg = rec.id; App.busy(false); App.commit(); G.View.fitFull();
            toast(L(`${App.blotName(b)} 的 Marker 图改成了 ${rec.name}`, `The marker picture of ${App.blotName(b)} is now ${rec.name}`));
          }, 20);
        };
        th.appendChild(t);
      });
      const hidden = wl.filter(r => !keep(r)).length;
      if (hidden || (wlOpen.has(b.id) && wl.length > 3)) {
        const more = document.createElement('button');
        more.className = 'thumb-more'; more.textContent = hidden ? L(`+${hidden} 张`, `+${hidden}`) : L('收起', 'Fewer');
        more.title = hidden ? L('其余的白光图（每次拍摄一张，通常看起来一样）', 'The other white-light pictures (one per capture, usually alike)') : '';
        more.onclick = () => { if (wlOpen.has(b.id)) wlOpen.delete(b.id); else wlOpen.add(b.id); renderBlots(); };
        card.querySelector('.thumbs[data-kind="marker"]').appendChild(more);
      }
      card.querySelector('.blot-head input').addEventListener('change', done(e => { b.name = e.target.value.trim(); }));
      card.querySelector('.group-select').onclick = () => { b.images.forEach(id => imageSelection.add(id)); wlOpen.add(b.id); renderBlots(); };
      box.appendChild(card);
    });
    const newGroup = document.createElement('div'); newGroup.className = 'new-image-group';
    newGroup.textContent = L('拖到这里，新建图片组', 'Drop here to create an image group'); imageDropTarget(newGroup, 'new'); box.appendChild(newGroup);
    $('stBlots').textContent = L(`${st.blots.length} 个图片组 · ${App.images.size} 张图`, `${pl(st.blots.length, 'image group')} · ${pl(App.images.size, 'picture')}`);
    $('sum1').innerHTML = st.blots.map(b => {
      const mk = App.markerRec(b), mkName = mk ? esc(mk.name) : L('没有', 'none'), nc = App.chemiOf(b).length;
      return L(`${esc(App.blotName(b))}：Marker 图 <b>${mkName}</b>，${nc} 张曝光`, `${esc(App.blotName(b))}: marker picture <b>${mkName}</b>, ${pl(nc, 'exposure')}`);
    }).join('<br>');
  }
  /* step 2: the pieces of each membrane (outlines edited on the picture); several membranes: one at a time */
  ['defaultLanesBefore','defaultLanesNew'].forEach(id=>{
    $(id).addEventListener('input',e=>{if(S())$('applyDefaultLanes').disabled=!(+e.target.value>0)||!S().rows.length;});
    $(id).addEventListener('change',done(e=>{App.setDefaultLaneCount(e.target.value);}));
  });
  // Keep the draft focused until the click consumes it. A blur/change redraw can move the
  // button between Firefox's mousedown and mouseup, otherwise losing this explicit action.
  $('applyDefaultLanes').addEventListener('mousedown',e=>{if(e.button===0)e.preventDefault();});
  $('applyDefaultLanes').onclick=done(()=>{const input=['defaultLanesBefore','defaultLanesNew'].includes(document.activeElement?.id)?document.activeElement:$('defaultLanesNew');App.setDefaultLaneCount(input.value);const n=App.applyDefaultLanes();toast(L(`已统一 ${n} 个框的泳道数（Ctrl+Z 可撤销）`,`Lane counts applied to ${n} boxes (Ctrl+Z to undo)`));});
  function syncDefaultLanes(){
    const n=S().defaultLaneCount||'';['defaultLanesBefore','defaultLanesNew'].forEach(id=>{if(document.activeElement!==$(id))$(id).value=n;});
    const draft=['defaultLanesBefore','defaultLanesNew'].includes(document.activeElement?.id)?document.activeElement.value:n;
    $('applyDefaultLanes').disabled=!(+draft>0)||!S().rows.length;
    $('defaultLanesHint').textContent=n?L(`自动识别参考 ${n} 道，清晰区域保留各自数量；新手动框以此起步。仅点击「统一已有框」才强制统一。`,`Detection uses ${n} as a reference; clear regions keep their own counts. New manual boxes start with it. Only Apply count forces existing boxes to match.`):L('留空自动计数；填写后，新加的框按此数量定位。','Leave blank for automatic counting; set a count for newly added boxes.');
  }
  $('dividerLane').onchange=done(e=>{const b=App.blot(App.viewBlot);if(b)b.dividerLane=e.target.value?Math.max(1,Math.min(60,Math.round(+e.target.value)||1)):null;});
  function renderPieces() {
    syncDefaultLanes();
    $('dividerLane').value=App.blot(App.viewBlot)?.dividerLane||'';
    const st = S(), box = $('pieceList');
    box.innerHTML = st.blots.map(b => {
      const np = (b.pieces || []).length, ls = (b.pieces || []).map(p => p.letter).sort().join(' ');
      return `<button type="button" class="pc-blot${b.id === App.viewBlot ? ' view' : ''}" data-blot="${b.id}" aria-pressed="${b.id === App.viewBlot}"><b>${esc(App.blotName(b))}</b>
      <span>${L(`${np} 条膜条（${ls}）`, `${pl(np, 'strip')} (${ls})`)}${b.userStrips ? `<span class="tag-hand">${L('手动调整过', 'adjusted by hand')}</span>` : ''}</span>
      <span class="pc-status">${b.id === App.viewBlot ? L('正在检查', 'Reviewing') : pcSeen.has(b.id) ? L('已查看 · 点击复查', 'Viewed · review again') : L('点击检查 →', 'Review →')}</span></button>`;
    }).join('');
    box.querySelectorAll('.pc-blot').forEach(btn => btn.onclick = () => {
      if (btn.dataset.blot === App.viewBlot && App.curStep === 2) return;
      const to = App.blot(btn.closest('.pc-blot').dataset.blot), from = App.blot(App.viewBlot);
      // (the outlines edited on the membrane shown are applied first)
      applyPieces(from, App.curStep === 2 ? G.View.piecesEnd(true) : null, false, () => { App.curStep=2; openSteps.clear(); openSteps.add(2); startPieces(to); renderSteps(); updateCoach(); });
    });
    const nAll = st.blots.reduce((s, b) => s + (b.pieces || []).length, 0);
    const ready=!!App.blot(App.viewBlot)?.boxesReady;
    $('rebuildGroupTools').classList.toggle('hidden',!ready);
    $('next2').classList.toggle('primary',!ready);
    $('stPieces').textContent = L(`${nAll} 条膜条`, pl(nAll, 'strip'));
    $('next2').textContent = ready ? L('保留已有框，返回编辑 →','Keep existing boxes, return to editing →') : App.curStep === 2 && pcUnseen() ? L('这组膜条对了，看下一组 →', 'This group is right. Next group →')
      : st.rows.length ? L('膜条对了，回到蛋白框 →', 'Strips are right. Back to the protein boxes →') : L('膜条对了，下一步：生成蛋白框 →', 'Strips are right. Next: protein boxes →');
    $('sum2').innerHTML = st.blots.map(b => {
      const np = (b.pieces || []).length;
      return `${st.blots.length > 1 ? esc(App.blotName(b)) + L('：', ': ') : ''}<b>${np}</b>${L(' 条膜条', np === 1 ? ' strip' : ' strips')}${b.userStrips ? L('（手动调整过）', ' (adjusted by hand)') : ''}`;
    }).join('<br>');
  }

  /* ---------- popover ---------- */
  const pop = $('popover');
  let popOpen = false, popCancel = null, popAccept = null;
  // closing without a choice runs the pending cancel action (e.g. drops a new mark); accept: the pending choice
  // stands (marking band after band, the next click accepts the size suggested for the last)
  function closePop(accept) {
    if (!popOpen) return;
    popOpen = false; pop.classList.add('hidden');
    const c = accept ? popAccept : popCancel; popCancel = null; popAccept = null;
    if (c) c();
  }
  function placePop(anchor) { placePopNear(anchor.getBoundingClientRect()); }
  // beside a rect: on its right, or on its left when the right has no room (never over the thing it is about)
  function placePopNear(r) {
    pop.classList.remove('hidden'); popOpen = true;
    const pw = pop.offsetWidth || 260, ph = pop.offsetHeight;
    pop.style.left = clamp(r.right + 10 + pw > innerWidth - 6 ? r.left - pw - 10 : r.right + 10, 6, innerWidth - pw - 6) + 'px';
    pop.style.top = clamp(r.top - 10, 8, Math.max(8,innerHeight - ph - 8)) + 'px';
  }
  function placePopAt(x, y) {
    pop.classList.remove('hidden'); popOpen = true;
    const pw = pop.offsetWidth || 260, ph = pop.offsetHeight;
    pop.style.left = clamp(x, 6, innerWidth - pw - 6) + 'px';
    pop.style.top = clamp(y, 8, Math.max(8,innerHeight - ph - 8)) + 'px';
  }
  // the popover dropped without its pending actions (the state it belongs to is being replaced)
  window.addEventListener('resize',()=>{if(popOpen)placePopAt(pop.offsetLeft,pop.offsetTop);});
  function dropPop() { popOpen = false; popCancel = popAccept = null; pop.classList.add('hidden'); }
  document.addEventListener('mousedown', e => { if (popOpen && !pop.contains(e.target) && !e.target.classList.contains('more') && e.target !== $('editor')) closePop(); });
  const shortName = name => name.replace(/\s*\(.*?\)/g, '').replace(/\*$/, '');
  /* size of a marker band: the ladder's sizes (the suggested one highlighted; Enter takes it) or any value. A new
   * mark: Esc or a click elsewhere drops it; the next band clicked accepts the suggestion. was: the piece's marks
   * before (null: none — left without a choice, it stays so) */
  function markPicker(b, pc, mark, cx, cy, isNew, was) {
    if (popOpen) closePop(true);
    const lad = G.ProteinLadders.get(b.ladderId);
    const sizes = lad ? lad.sizes : [250, 180, 150, 130, 100, 75, 70, 55, 50, 40, 37, 35, 25, 20, 15, 10];
    const sug = mark.kda > 0 ? mark.kda : App.suggestKda(b, pc, mark.v);
    pop.innerHTML = `<h4>${L(`膜条 ${esc(pc.letter)}：这条 Marker 带是多少 kDa？`, `Strip ${esc(pc.letter)}: what size is this marker band (kDa)?`)}</h4>
      <div class="kda-grid">${sizes.map(k => `<button data-k="${k}" class="${k === sug ? 'on' : ''}${lad && (lad.ref || []).includes(k) ? ' ref' : ''}"${lad && (lad.ref || []).includes(k) ? ` title="${L('参考带（彩色 / 加粗）', 'Reference band (coloured / bold)')}"` : ''}>${k}</button>`).join('')}</div>
      <div class="field inline"><label class="inline-label">${L('其他', 'Other')}</label><input type="number" id="pKda" class="num" step="any" min="0" placeholder="${sug || 'kDa'}"> kDa${sug ? `<span class="hint" style="margin:0 0 0 auto">${L('回车', 'Enter')} = ${sug}</span>` : ''}</div>
      <p class="hint">${lad ? L(`按 ${esc(shortName(lad.name))} 列出（橙色 = 参考带）`, `Sizes of ${esc(shortName(lad.name))} (orange = reference bands)`)
        : L('还没选 Marker 型号（左侧第 4 步最上面），列出的是常见分子量', 'No ladder chosen yet (top of step 4 on the left): these are common sizes')}</p>
      <div class="actions">${isNew ? `<button class="btn sm" id="pNo">${L('不加了', "Don't add")}</button>` : `<button class="btn sm danger" id="pDelMark">${L('删除这条', 'Delete this one')}</button>`}<button class="btn sm primary" id="pOk">${L('确定', 'OK')}</button></div>`;
    placePopAt(cx + 14, cy - 30);
    const back = () => $('editorBox').focus({ preventScroll: true });
    const drop = () => { if (pc.marks) pc.marks = pc.marks.filter(m => m !== mark); App.selMark = null; };
    const done1 = k => { if (!(k > 0)) { toast(L('先选一个分子量', 'Pick a size first')); return; } mark.kda = k; popCancel = popAccept = null; closePop(); App.commit(); back(); };
    popCancel = () => { if (isNew || !(mark.kda > 0)) drop(); if (was === null) { pc.marks = null; App.selMark = null; } App.commit(); };
    popAccept = () => { if (!(mark.kda > 0)) drop(); App.commit(); };
    pop.querySelectorAll('[data-k]').forEach(btn => btn.onclick = () => done1(+btn.dataset.k));
    const inp = pop.querySelector('#pKda');
    inp.addEventListener('keydown', e => {
      if (composing(e)) return;
      if (e.key === 'Enter') done1(+inp.value || sug);
      if (e.key === 'Escape') { e.stopPropagation(); closePop(); back(); }
    });
    pop.querySelector('#pOk').onclick = () => done1(+inp.value || sug);
    const no = pop.querySelector('#pNo');
    if (no) no.onclick = () => { closePop(); back(); };
    const del = pop.querySelector('#pDelMark');
    if (del) del.onclick = () => { drop(); popCancel = popAccept = null; closePop(); App.commit(); back(); toast(L('已删除这条刻度（Ctrl+Z 可撤销）', 'Tick deleted (Ctrl+Z to undo)')); };
    setTimeout(() => inp.focus({ preventScroll: true }), 0);
  }

  /* ---------- 4 marker ---------- */
  // the ladder of each membrane and the marks of every piece (set by hand: nothing is read automatically).
  // Clicking a piece's chip marks that piece, zoomed in.
  const markState = s => ({ manual: L('可算分子量', 'MW ready'), few: L('已标 1 条', '1 tick marked'), none: L('未标', 'Not marked') })[s];
  // the ladder menu, grouped by maker
  const ladderOptions = sel => G.ProteinLadders.groups().map(g => `<optgroup label="${esc(g.vendor)}">${g.ladders.map(l => `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`).join('');
  /* while marking: the ladder as its maker shows it — the bands spaced by log size (about how a gradient gel runs
   * them), the coloured reference bands in orange; the sizes the piece in view already has are ticked */
  let cardHidden = false;
  function ladderCard(b) {
    const card = $('ladderCard'), lad = b && G.ProteinLadders.get(b.ladderId);
    if (App.mode !== 'marks' || !lad || cardHidden) { card.classList.add('hidden'); return; }
    const pc = App.markFocus && App.piece(b, App.markFocus), have = pc ? App.markInfo(b, pc).ks.map(k => +(+k).toPrecision(3)) : [];
    const ks = lad.sizes, l0 = Math.log(ks[0]), l1 = Math.log(ks[ks.length - 1]), H = Math.max(180, Math.min(320, ks.length * 30)), top = 10;
    const y = k => top + (l0 - Math.log(k)) / Math.max(1e-6, l0 - l1) * H;
    const bands = ks.map(k => {
      const ref = (lad.ref || []).includes(k), got = have.includes(+k.toPrecision(3));
      return `<rect x="8" y="${(y(k) - (ref ? 3 : 2)).toFixed(1)}" width="40" height="${ref ? 6 : 4}" rx="2" fill="${ref ? '#e8590c' : '#4263eb'}" opacity="${ref ? 1 : 0.85}"/>` +
        `<text x="56" y="${(y(k) + 4).toFixed(1)}" font-size="12" font-weight="${ref ? 700 : 500}" fill="${ref ? '#c2410c' : '#24324a'}">${k}${got ? ' ✓' : ''}</text>`;
    }).join('');
    card.innerHTML = `<div class="lc-head"><b>${L('Marker 参考', 'Marker reference')}</b><button id="lcHide" title="${L('收起（左侧第 4 步里可再打开）', 'Hide (show it again in step 4 on the left)')}">×</button></div>
      <div class="lc-name" title="${esc(lad.name)}">${esc(shortName(lad.name))}</div>
      <svg width="116" height="${H + 2 * top}" viewBox="0 0 116 ${H + 2 * top}"><rect x="6" y="2" width="44" height="${H + 2 * top - 4}" rx="4" fill="#f1f4fa"/>${bands}</svg>
      <p class="lc-note">${L('按 log 分子量等距的示意，实际间距随胶浓度而变；<b>橙色</b> = 彩色 / 加粗的参考带', 'A sketch spaced by log size; the real spacing depends on the gel; <b>orange</b> = coloured / bold reference bands')}${pc ? L(`；✓ = 膜条 ${esc(pc.letter)} 已标`, `; ✓ = marked on strip ${esc(pc.letter)}`) : ''}</p>`;
    card.classList.remove('hidden');
    $('lcHide').onclick = () => { cardHidden = true; card.classList.add('hidden'); renderMarker(); };
  }
  /* step 4: the ladder of each membrane (its sizes as the maker lists them, the reference bands in orange) and
   * the marks of each piece — the pieces the figure uses first */
  function renderMarker() {
    const st = S(), box = $('markerPanel');
    let html = `<p class="lead">${L('在中间的 Marker 图上<b>点一条 Marker 带</b>，选它的分子量（会吸附到条带上，按住 Alt 不吸附）。<b>1 条就能显示刻度</b>；标 2 条以上才估算其他分子量并提示其余条带。只标看得见的即可。',
      "On the marker picture in the middle, <b>click a marker band</b> and pick its size (it snaps to the band; hold Alt to stop that). <b>One mark displays a tick</b>. Two or more allow size estimates and dashed hints for the other bands. Mark only the bands you can see.")}</p>`;
    let todo = 0;
    st.blots.forEach(b => {
      const hasM = !!App.markerRec(b), lad = G.ProteinLadders.get(b.ladderId);
      const used = new Set(App.usedPieces(b).map(pc => pc.id));
      const pcs = (b.pieces || []).slice().sort((p, q) => (used.has(q.id) - used.has(p.id)) || (p.letter || '').localeCompare(q.letter || ''));
      html += `<div class="mk-blot" data-blot="${b.id}">${st.blots.length > 1 ? `<div class="mk-title">${esc(App.blotName(b))}</div>` : ''}
        <label class="mk-label">${L('Marker 型号', 'Ladder')}${b.ladderId && b.ladderId === App.prefLadder ? `<span class="mk-note">${L('上次用的', 'used last time')}</span>` : ''}</label>
        <select class="ladder-sel${lad ? '' : ' todo'}"><option value=""${lad ? '' : ' selected'}>${L('— 选你用的 Marker —', '— Choose your ladder —')}</option>${ladderOptions(lad ? b.ladderId : null)}</select>
        ${lad ? `<div class="mk-sizes" title="${L('这个型号的条带（官方列表），橙色是彩色 / 加粗的参考带', "This ladder's bands (the maker's list); orange = coloured / bold reference bands")}">${lad.sizes.map(k => `<span class="${(lad.ref || []).includes(k) ? 'ref' : ''}">${k}</span>`).join('')}</div>` : ''}
        ${hasM ? '' : `<p class="hint warn-t">${L('这张膜没有 Marker 图（第 1 步）：在曝光图上看得见 Marker 的话也可以标。', 'This membrane has no marker picture (step 1): if the marker shows on an exposure, you can mark it there.')}</p>`}
        <div class="mk-chips">${pcs.map(pc => {
          const mi = App.markInfo(b, pc), ms = markState(mi.state), ks = mi.ks.join(' / ');
          if (mi.state === 'none' && used.has(pc.id)) todo++;
          const tip = L(`膜条 ${esc(pc.letter)}：${ms}${mi.ks.length ? '，' + ks + ' kDa' : ''}${used.has(pc.id) ? '' : '（成图没有用到这条膜条）'}。点一下放大到它`,
            `Strip ${esc(pc.letter)}: ${ms}${mi.ks.length ? ', ' + ks + ' kDa' : ''}${used.has(pc.id) ? '' : ' (not used in the figure)'}. Click to zoom to it`);
          return `<button class="mk-chip ${mi.state}${used.has(pc.id) ? '' : ' unused'}" data-pc="${pc.id}" title="${tip}"><b>${esc(pc.letter)}</b><span>${mi.ks.length ? mi.ks.slice(0, 4).map(k => +k.toPrecision(3)).join('·') + (mi.ks.length > 4 ? '…' : '') : '—'}</span><i>${ms}</i></button>`;
        }).join('')}</div>
        ${pcs.some(pc => pc.marks && pc.marks.length) ? `<div class="mk-links"><button class="link mk-clear" title="${L('这张膜上标的所有刻度都去掉（Ctrl+Z 可撤销）', 'Remove every tick marked on this membrane (Ctrl+Z to undo)')}">${L('清除这张膜的刻度', "Clear this membrane's ticks")}</button></div>` : ''}</div>`;
    });
    if (cardHidden && App.mode === 'marks') html += `<p><button class="link mk-card-on">${L('显示 Marker 参考图', 'Show the marker reference')}</button></p>`;
    box.innerHTML = html;
    box.querySelectorAll('.mk-blot').forEach(div => {
      const b = App.blot(div.dataset.blot);
      div.querySelector('.ladder-sel').addEventListener('change', done(e => {
        const id = e.target.value;
        App.setLadder(b, id);
        // (the other membranes without one yet: most likely the same ladder)
        const more = id ? S().blots.filter(o => o !== b && !o.ladderId) : [];
        more.forEach(o => App.setLadder(o, id));
        const nm = id && shortName(G.ProteinLadders.get(id).name);
        if (id) {
          toast(L(`已选 ${nm}${more.length ? '，其他膜也用它（不同就在那张膜下面改）' : ''}；以后新载入的膜默认用它`,
            `Chose ${nm}${more.length ? ' for the other membranes too (change it under a membrane if it differs)' : ''}; membranes loaded later use it by default`), 3600);
        }
      }));
      div.querySelectorAll('.mk-chip').forEach(c => c.onclick = () => { if (App.curStep !== 4) openStep(4); startMarks(b, App.piece(b, c.dataset.pc)); });
      const cl = div.querySelector('.mk-clear');
      if (cl) cl.onclick = done(() => { App.clearMarks(b); toast(L('已清除这张膜的刻度（Ctrl+Z 可撤销）', "Cleared this membrane's ticks (Ctrl+Z to undo)")); });
    });
    const con = box.querySelector('.mk-card-on');
    if (con) con.onclick = () => { cardHidden = false; renderMarker(); };
    $('stMarker').textContent = todo ? L(`${todo} 条膜条没标完`, `${pl(todo, 'strip')} to mark`) : '';
    $('stMarker').classList.toggle('warn', !!todo);
    $('sum4').innerHTML = st.style.showMW ? st.blots.map(b => `${st.blots.length > 1 ? esc(App.blotName(b)) + L('：', ': ') : ''}${(b.pieces || []).map(pc => {
      const n = App.markInfo(b, pc).ks.length;
      return `${esc(pc.letter)} ${L(`${n} 条`, pl(n, 'tick'))}`;
    }).join(' · ')}`).join('<br>') : L('这次不标分子量', 'No molecular weights this time');
    // the ladder's own pattern beside the picture while marking
    ladderCard(App.blot(App.viewBlot));
  }
  // where a picture lies on its membrane's grid, in words
  function alignWords(rec, b) {
    const al = App.alignOf(rec.id), anyMoved = b.images.some(id => App.isMoved(id));
    if (App.isMoved(rec.id)) {
      return `${al.how === 'manual' ? L('手动对齐', 'Aligned by hand') : L('拍这张时膜的位置不同，已自动对齐', 'The membrane lay elsewhere in this picture: aligned automatically')}`
        + L(`（${App.alignText(rec.id)}）`, ` (${App.alignText(rec.id)})`);
    }
    if (al && al.how === 'manual') return L('按原样使用（不移动）', 'Used as taken (not moved)');
    return b.frame === rec.id && anyMoved ? L('基准：这张膜的其他图都对齐到这张', 'Reference: the other pictures of this membrane are aligned to this one')
      : L('与其他图位置一致', 'Same position as the other pictures');
  }
  function imagePopover(rec, b, anchor) {
    const others = S().blots.filter(x => x !== b), al = App.alignOf(rec.id);
    pop.innerHTML = `<h4>${esc(rec.name)}</h4>
      <div class="field inline"><label class="inline-label">${L('类型', 'Kind')}</label>
        <div class="seg"><button data-k="chemi" class="${rec.kind === 'chemi' ? 'on' : ''}">${L('曝光图', 'Exposure')}</button><button data-k="marker" class="${rec.kind === 'marker' ? 'on' : ''}">${L('Marker 白光', 'Marker / white light')}</button></div></div>
      ${rec.kind === 'chemi' ? `<div class="field inline"><label class="inline-label">${L('曝光时间', 'Exposure time')}</label><input type="number" id="pExpo" class="num" step="any" value="${rec.exposure != null ? rec.exposure : ''}" placeholder="${L('秒', 'seconds')}"> s</div>` : ''}
      <div class="field inline"><label class="inline-label">${L('移到', 'Move to')}</label><select id="pMove" style="flex:1"><option value="">—</option>${others.map(o => `<option value="${o.id}">${esc(App.blotName(o))}</option>`).join('')}<option value="new">${L('新图片组', 'A new image group')}</option></select></div>
      <div class="field inline align-row"><label class="inline-label">${L('位置', 'Position')}</label><span class="align-info">${esc(alignWords(rec, b))}</span></div>
      <div class="actions left"><button class="btn sm" id="pAlign" title="${L('在膜图上拖动这张图，让条带落进框里', 'Drag this picture on the membrane view so the bands sit in the boxes')}">${L('手动对齐…', 'Align by hand…')}</button>${al && al.how === 'manual' ? `<button class="btn sm" id="pAutoAlign">${L('恢复自动对齐', 'Back to auto-align')}</button>` : ''}</div>
      <div class="actions"><button class="btn sm danger" id="pDel">${L('移除这张图', 'Remove this picture')}</button><button class="btn sm primary" id="pOk">${L('完成', 'Done')}</button></div>`;
    placePop(anchor);
    pop.querySelector('#pAlign').onclick = () => {
      closePop();
      if (App.mode) App.setMode(null);
      App.viewBlot = b.id; App.viewImg = rec.id; App.alignImg = rec.id;
      App.emit('select'); G.View.fitFull();
      App.setMode('align'); G.View.alignStart(rec.id);
      $('editorBox').focus({ preventScroll: true });
    };
    const aa = pop.querySelector('#pAutoAlign');
    if (aa) aa.onclick = () => { App.busy(true, L('自动对齐…', 'Aligning…')); setTimeout(() => { App.autoAlign(rec.id); App.busy(false); App.commit(); closePop(); toast(L('已恢复自动对齐', 'Aligned automatically again')); }, 20); };
    pop.querySelectorAll('[data-k]').forEach(btn => btn.onclick = () => { App.busy(true, L('重新分析…', 'Analysing again…')); setTimeout(() => { App.setKind(rec.id, btn.dataset.k); App.busy(false); App.commit(); closePop(); }, 20); });
    const ex = pop.querySelector('#pExpo');
    if (ex) ex.addEventListener('change', done(e => { App.setExposure(rec.id, +e.target.value); }));
    pop.querySelector('#pMove').addEventListener('change', e => { if (e.target.value) movePictures([rec.id], e.target.value); });
    pop.querySelector('#pDel').onclick = () => deletePictures([rec.id]);
    pop.querySelector('#pOk').onclick = closePop;
  }

  /* ---------- 2 rows ---------- */
  function renderRows() {
    const st = S(), box = $('rowList'); box.innerHTML = '';
    let prev = null;
    st.rows.forEach((row, i) => {
      const b = App.blot(row.blot);
      if (st.blots.length > 1 && row.blot !== prev) box.insertAdjacentHTML('beforeend', `<div class="hint" style="margin:8px 0 2px">${esc(App.blotName(b))}</div>`);
      prev = row.blot;
      const kda = App.rowKda(row), ex = App.rowExpo(row), best = App.bestExpo(row), sel = row.id === App.selRow;
      const cur = App.images.get(row.img), curE = ex.find(x => x.id === row.img), isBest = row.img === best;
      const el = document.createElement('div');
      el.className = 'row-item' + (sel ? ' sel' : '') + (row.hidden ? ' off' : '');
      el.dataset.id = row.id;
      const sugg = G.ProteinLadders.suggest(kda);
      // the tag: the row's colour on the membrane and the pieces it comes from; dragged = order in the figure
      el.innerHTML = `<span class="grip" style="--c:${App.rowColor(row)}" title="${L(`蛋白框 ${esc(modLabel(row))}。上下拖动调整这一行在成图里的位置（或选中后 Alt+↑↓）`, `Boxes ${esc(modLabel(row))}. Drag up or down to move this row in the figure (or select it and press Alt+↑↓)`)}">${esc(shortLabel(row))}</span>
        <button class="row-name-link link" title="${L('在成图上填写名称', 'Edit the name on the figure')}">${esc(row.name || L('未命名蛋白', 'Unnamed protein'))}</button>
        <span class="kda">${row.partialBlock ? L('余道 · 请核对','Remaining lanes · review') : kda ? '≈' + Math.round(kda) + ' kDa' : row.weak ? L('弱信号', 'Weak signal') : ''}</span>
        <button class="expo-chip${isBest ? ' best' : ' other'}${App.expoVerdict(curE) === 'sat' ? ' sat' : ''}" data-act="expo" title="${cur ? esc(App.expoLabel(cur)) + L('：', ': ') : ''}${isBest ? L('正在用推荐的曝光', 'Using the recommended exposure') : L('正在用的不是推荐曝光', 'Not the recommended exposure')}${L('｜点开对比全部曝光', ' | click to compare all exposures')}">${isBest ? '★ ' : ''}${cur ? esc(App.expoLabel(cur)) : '—'}</button>
        <button class="x visibility" data-act="hide" title="${row.hidden ? L('显示这一行', 'Show this row') : L('隐藏这一行', 'Hide this row')}">${row.hidden ? L('显示', 'Show') : L('隐藏', 'Hide')}</button>
        <button class="x" data-act="del" title="${L('删除这一行', 'Delete this row')}">×</button>`;
      el.querySelector('.row-name-link').onclick = () => { activateColumn(App.rowColumn(row)); App.emit('change'); editRowName(row.id); };
      el.querySelector('[data-act="expo"]').onclick = () => selectRow(sel ? null : row.id, !sel);
      el.querySelector('[data-act="hide"]').onclick = done(() => { row.hidden = !row.hidden; });
      el.querySelector('[data-act="del"]').onclick = done(() => { st.rows = st.rows.filter(r => r !== row); if (App.selRow === row.id) App.selRow = null; toast(L('已删除该行（Ctrl+Z 可撤销）', 'Row deleted (Ctrl+Z to undo)')); });
      el.onclick = e => { if (e.target === el || e.target.classList.contains('kda') || e.target.classList.contains('grip')) selectRow(row.id, true); };
      box.appendChild(el);
      if (sel) box.appendChild(rowDetail(row, ex, best));
    });
    if (!st.rows.length) {
      box.innerHTML = `<p class="hint">${L('没有找到蛋白条带：点顶部的"+ 添加一个蛋白框"，再到膜上点一下放下。',
        'No protein bands found: click "+ Add a protein box" at the top, then click on the membrane to place it.')}</p>`;
    }
    const bound = App.boundRows();
    if (bound.length && !(bound.length === 1 && App.selRow === bound[0].id)) {
      const note = document.createElement('div'); note.className = 'legacy-binding';
      note.innerHTML = `<b>${L(`发现 ${bound.length} 处旧版合并`, `${bound.length} legacy combined rows`)}</b><p>${L('这里的不同区域共用曝光。可一键解除，保留当前图像设置；也可选中某行单独处理。', 'These regions share exposure. Detach all while preserving their current settings, or select a row to detach just that one.')}</p><button class="btn sm primary">${L('全部解除绑定', 'Detach all')}</button>`;
      note.querySelector('button').onclick = done(() => { App.unbindAll(); toast(L('各区域已独立；Ctrl+Z 可撤销', 'Regions are independent; Ctrl+Z to undo')); });
      box.prepend(note);
    }
    const vis = st.rows.filter(r => !r.hidden).length, hid = st.rows.length - vis;
    if (hid) { const restore = document.createElement('button'); restore.className = 'btn sm show-all-rows'; restore.textContent = L(`显示全部 ${hid} 个隐藏框`, `Show all ${hid} hidden boxes`); restore.onclick = done(() => st.rows.forEach(r => { r.hidden = false; })); box.prepend(restore); }
    $('stRows').textContent = st.rows.length ? L(`${vis} 行${hid ? ` · ${hid} 行隐藏` : ''}`, `${pl(vis, 'row')}${hid ? ` · ${hid} hidden` : ''}`) : '';
    $('sum3').innerHTML = L(`<b>${vis}</b> 个蛋白框${hid ? `（另有 ${hid} 个已隐藏）` : ''}`,
      `<b>${vis}</b> protein box${vis === 1 ? '' : 'es'}${hid ? ` (${hid} manually hidden ${hid === 1 ? 'one' : 'ones'} hidden)` : ''}`);
  }
  /* step 5: the proteins' names in figure order (Enter: the next one) */
  function renderNames() {
    const st = S(), vis = App.rowsInColumn(App.activeColumn).filter(r => !r.hidden);
    const named = vis.filter(r => r.name).length, fl = App.figLanes(), ln = fl.filter(j => st.lanes[j - 1].name).length;
    $('stLanes').textContent = L(`蛋白名 ${named}/${vis.length} · 泳道名 ${ln}/${fl.length}`, `Proteins ${named}/${vis.length} · lanes ${ln}/${fl.length}`);
    $('sum5').innerHTML = L(`蛋白名 <b>${named}/${vis.length}</b> · 泳道名 <b>${ln}/${fl.length}</b>`, `Protein names <b>${named}/${vis.length}</b> · lane names <b>${ln}/${fl.length}</b>`);
  }
  /* the selected row, opened: its exposures (weakest to strongest; ★ = recommended, red pixels = clipped) and
   * its boxes on the membrane — how many lanes each has, the figure columns they fill, and the lane tools */
  function rowDetail(row, ex, best) {
    const wrap = document.createElement('div'); wrap.className = 'expo-compare row-detail';
    const bestE = ex.find(e => e.id === best), vb = App.expoVerdict(bestE);
    const TAG = { sat: L('过曝', 'saturated'), weak: L('太弱', 'too weak'), faint: L('偏弱', 'weak'), ok: '' };
    const why = !ex.length ? '' : vb === 'ok' ? L('★ 推荐：条带清晰、没有过曝', '★ recommended: clear bands, not saturated')
      : vb === 'sat' ? L('★ 推荐：每张曝光里这条带都有过曝像素，★ 是过曝最少又清楚的一张；这一行不要拿来定量',
        '★ recommended: this band has saturated pixels in every exposure; ★ is the clear one with the fewest. Do not quantify this row')
      : L('★ 推荐：信号都偏弱，★ 是相对最清楚的一张；可以考虑补拍更长曝光', '★ recommended: the signal is weak in all of them; ★ is the clearest. Consider a longer exposure');
    const b = App.blot(row.blot), cur = App.curSeg(row), clash = App.rowClash(row).length > 0;
    // the pieces this row runs across side by side (one protein on a membrane cut through), and splitting them
    const segLine = App.bindingGroups(row).length > 1 ? `<div class="legacy-binding"><b>${L('旧版把这些独立区域合成了一行', 'These independent regions were combined by an older version')}</b><p>${L('所以它们共用曝光和亮度。解除后保留当前图像设置，再分别编辑。', 'They currently share exposure and levels. Detach to keep their current image settings and edit them separately.')}</p><button class="btn sm primary" data-act="split">${L('解除绑定，分别编辑', 'Detach and edit separately')}</button></div>` : '';
    const cutIds = [...new Set(row.segs.filter(s => s.cut).map(s => s.cut.id))];
    const cutInfo = cutIds.map(id => `<p class="hint">${L('这些是同一个原始框排除中间泳道后的片段，使用同一曝光。', 'These fragments come from one original crop with an internal lane omitted, so they use the same exposure.')} <button class="link" data-restore-cut="${id}">${L('包含中间泳道，恢复连续框', 'Include middle lanes; restore continuous box')}</button></p>`).join('');
    const boxes = row.segs.map(sg => {
      const pc = App.piece(b, sg.piece), n = App.nSample(sg), nm = sg.lanes.filter(l => l.r === 'm').length, nx = sg.lanes.filter(l => l.r === 'x').length;
      const cols = n > 1 ? `${sg.c0}–${App.segEnd(sg)}` : n ? String(sg.c0) : '—';
      return `<div class="bt-seg${sg === cur ? ' sel' : ''}${clash ? ' clash' : ''}" data-seg="${App.boxId(sg)}">
        <div class="bt-line"><span class="ptag" title="${L('膜条', 'Strip')} ${esc(pc ? pc.letter : '?')}">${esc(App.boxLabel(sg))}</span>
          <span class="bt-n"><b>${n}</b>${L(' 道', n === 1 ? ' lane' : ' lanes')}${nm ? ` <span class="tag-m">+${nm} M</span>` : ''}${nx ? ` <span class="tag-x">+${nx} ${L('不用', 'unused')}</span>` : ''}</span>
          <span class="bt-cols">${L(`成图第 <b>${cols}</b> 列`, `${n > 1 ? 'columns' : 'column'} <b>${cols}</b>`)}</span>
          <button class="pnav" data-shift="-1" title="${L('这个框的泳道在成图里往左挪一列（最左到第 1 列，不会推动其他行）', "Move this box's lanes one column left in the figure (down to column 1; other rows are not pushed)")}"${sg.c0 <= 1 ? ' disabled' : ''}>‹</button><button class="pnav" data-shift="1" title="${L('往右挪一列', 'One column right')}">›</button></div>
        <div class="bt-line"><span class="bt-even">${L('泳道数', 'Lanes')} <input type="number" class="num" min="1" max="60" value="${sg.lanes.length}"> </span>
          <button class="btn sm ghost" data-act="redetect" title="${L('只看框里的像素，重新找泳道', 'Find the lanes again from the pixels in the box only')}">${sg.laneCount||S().defaultLaneCount ? L(`按 ${sg.laneCount||S().defaultLaneCount} 道定位`,`Locate ${sg.laneCount||S().defaultLaneCount} lanes`) : L('框内重新识别','Detect in box')}</button></div>
        ${sg.countOrigin==='image'&&sg.expectedLaneCount&&sg.expectedLaneCount!==sg.lanes.length?`<p class="hint count-note">${L(`图像识别 ${sg.lanes.length} 道，本框识别时参考 ${sg.expectedLaneCount} 道；已保留图像结果，可在上方单独修改。`,`Image detected ${sg.lanes.length} lanes; the reference at detection was ${sg.expectedLaneCount}. Image-based count retained; edit this box above if needed.`)}</p>`:sg.countOrigin==='reference'?`<p class="hint count-note">${L(`信号不清，暂按参考 ${sg.lanes.length} 道，请核对首尾位置。`,`Unclear signal: using the ${sg.lanes.length}-lane reference; check both endpoints.`)}</p>`:''}
        <div class="bt-line"><span class="bt-rot">${L('倾斜', 'Tilt')} <button class="pnav" data-rot="-0.1" title="${L('逆时针 0.1°（选中框后按 [ ）', '0.1° anticlockwise ([ with the box selected)')}">−</button><b>${(sg.rot || 0).toFixed(1)}°</b><button class="pnav" data-rot="0.1" title="${L('顺时针 0.1°（选中框后按 ] ）', '0.1° clockwise (] with the box selected)')}">+</button></span>
          <button class="btn sm ghost" data-act="level" title="${L('按框里的条带把框摆正（条带和膜条不完全水平时）', "Level the box by its bands (when bands and strip aren't quite horizontal)")}">${L('按条带摆正', 'Level by bands')}</button>${sg.rot ? `<button class="link" data-act="rot0">${L('归零', 'Reset')}</button>` : ''}</div>
      </div>`;
    }).join('');
    wrap.innerHTML = `${segLine}${cutInfo}
      ${ex.length ? `<div class="rd-title">${L('曝光', 'Exposure')}<span>${why}</span>${row.img !== best ? `<button class="link" data-act="usebest">${L('改用推荐', 'Use recommended')}</button>` : ''}</div><div class="tiles"></div>` : ''}
      <div class="rd-title">${L('泳道', 'Lanes')}<button class="link" data-act="zoom" title="${L('中间的膜图放大到这一行的框', "Zoom the membrane view to this row's boxes")}">${L('在膜上放大', 'Zoom on membrane')}</button></div>
      <p class="hint">${L('改泳道数即生效；拖首尾两条竖线，中间自动均分。', 'Change the lane count, then drag the two end lines; the middle lines follow evenly.')}</p>
      <details class="adv"><summary>${L('更多编辑技巧', 'More editing tips')}</summary><p class="hint">${L('Alt 拖动只改一条；双击加一道，选中竖线后 Delete 删除。拖框边缘保留完整条带；点泳道数字切换用途。拖 ↻ 旋转；上方亮度只调所选行。', 'Alt-drag adjusts one lane; double-click adds one; Delete removes a selected line. Resize the box to include whole bands; click a lane number to change its role. Drag ↻ to rotate; levels above adjust the selected row.')}</p></details>${boxes}`;
    wrap.querySelector('[data-act="zoom"]').onclick = () => { App.viewBlot = row.blot; App.viewImg = row.img; App.emit('select'); G.View.fitRow(row); };
    wrap.querySelectorAll('[data-restore-cut]').forEach(btn => btn.onclick = done(() => {
      if (!App.restoreContinuous(row, btn.dataset.restoreCut)) toast(L('这些框的位置或角度已分开，请撤销移动后再恢复连续框。', 'These boxes have moved apart or rotated. Undo those changes before restoring a continuous box.'));
    }));
    const split = wrap.querySelector('[data-act="split"]');
    if (split) split.onclick = done(() => { App.splitRow(row); toast(L('已解除绑定：当前曝光、亮度和名称保留，之后各自编辑', 'Detached: exposure, levels and names kept; edit each region independently'), 3800); });
    const tiles = wrap.querySelector('.tiles');
    if (tiles) App.expoOrder(row).forEach(e => {
      const rec = App.images.get(e.id), th = App.rowThumb(row, e.id, 150), v = App.expoVerdict(e);
      const t = document.createElement('button');
      t.className = 'tile' + (e.id === row.img ? ' on' : '') + (e.id === best ? ' rec' : '') + ' v-' + v;
      const satP = (e.satFrac * 100).toFixed(1);
      t.title = L(`${rec.name}｜信噪比 ${e.snr.toFixed(0)}${e.satFrac > 0.002 ? `｜条带内过曝 ${satP}%` : ''}`,
        `${rec.name} | SNR ${e.snr.toFixed(0)}${e.satFrac > 0.002 ? ` | ${satP}% saturated in the band` : ''}`);
      t.innerHTML = `${th ? `<img src="${th.href}" alt="">` : ''}<span class="cap">${e.id === best ? '<b>★</b> ' : ''}${esc(App.expoLabel(rec))}${TAG[v] ? `<i>${TAG[v]}</i>` : ''}</span>`;
      t.onclick = done(() => { row.img = e.id; row.auto = e.id === best; App.viewBlot = row.blot; App.viewImg = row.img; });
      tiles.appendChild(t);
    });
    const ub = wrap.querySelector('[data-act="usebest"]');
    if (ub) ub.onclick = done(() => { row.img = best; row.auto = true; App.viewImg = best; });
    wrap.querySelectorAll('.bt-seg').forEach(div => {
      const sg = row.segs.find(s => s.id === div.dataset.seg);
      if (!sg) return;
      div.addEventListener('mousedown', () => { if (App.selSeg !== App.boxId(sg)) { App.selSeg = App.boxId(sg); App.selLane = null; G.View.draw(); wrap.querySelectorAll('.bt-seg').forEach(x => x.classList.toggle('sel', x === div)); } });
      div.querySelectorAll('[data-shift]').forEach(btn => btn.onclick = done(() => {
        if (!App.shiftCols(row, sg, +btn.dataset.shift)) toast(L('已经在第 1 列了：要让它比其他行更靠左，把其他行往右挪（›）', 'Already at column 1: to put it further left than the other rows, move those right (›)'));
      }));
      div.querySelector('[data-act="redetect"]').onclick = done(() => {
        const n = App.editLanes(row, sg, () => App.redetectBox(row, sg)); App.splitExcluded(row);
        App.findBand(row, sg); App.selLane = null;
        const nm = sg.lanes.filter(l => l.r === 'm').length;
        toast(sg.laneCount ? L(`已按 ${sg.laneCount} 道排布，可拖动首尾泳道线微调`, `Placed ${sg.laneCount} lanes; drag the two end lines to fine-tune`) : n ? L(`框内识别出 ${n} 道${nm ? `（另有 ${nm} 道 Marker）` : ''}`, `Found ${pl(n, 'lane')} in the box${nm ? ` (and ${pl(nm, 'marker lane')})` : ''}`)
          : L('框里没识别到泳道：拖框调整范围，或直接修改泳道数', 'No lanes found in the box: drag the box to adjust it, or change the lane count'), 3200);
      });
      const pcOf = () => App.pieceOf(row, sg);
      div.querySelectorAll('[data-rot]').forEach(btn => btn.onclick = done(() => { App.setSegRot(pcOf(), sg, (sg.rot || 0) + +btn.dataset.rot); App.findBand(row, sg); }));
      div.querySelector('[data-act="level"]').onclick = done(() => {
        const d = App.levelBox(row, sg);
        toast(d != null ? L(`已按条带把框摆正（转了 ${d.toFixed(2)}°）`, `Levelled the box by its bands (turned ${d.toFixed(2)}°)`)
          : L('框里的条带不够清楚（至少 3 道），没有改；可以用 − + 或拖框上方的 ↻ 手动转', 'The bands in the box are not clear enough (3 lanes at least): nothing changed. Turn it by hand with − + or the ↻ above the box'));
      });
      const r0 = div.querySelector('[data-act="rot0"]');
      if (r0) r0.onclick = done(() => { App.setSegRot(pcOf(), sg, 0); App.findBand(row, sg); });
      const inp = div.querySelector('.bt-even input');
      const even = done(() => {
        const n = App.editLanes(row, sg, () => App.evenEnds(row, sg, +inp.value)); sg.laneCount=n;sg.countOrigin='manual'; App.selLane = null;
        toast(L(`已按最左、最右两条泳道等间距排布 ${n} 道`, `${pl(n, 'lane')} spaced evenly between the outermost two`));
      });
      inp.addEventListener('change', even);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); even(); } });
    });
    return wrap;
  }
  function selectRow(id, showImage) {
    App.selectedBoxes.clear();
    if (id && App.row(id)) activateColumn(App.rowColumn(App.row(id)));
    if (App.selRow !== id) { App.selSeg = null; App.selLane = null; }
    App.selRow = id;
    const row = App.row(id);
    if (row && showImage) { App.viewBlot = row.blot; App.viewImg = row.img; }
    App.emit('select');
  }
  function fillDatalist(kda) {
    const sug = G.ProteinLadders.suggest(kda);
    const used = [...new Set(S().rows.map(r => r.name).filter(Boolean))];
    const base = ['GAPDH', 'β-actin', 'α-tubulin', 'Vinculin', 'HSP90', 'Lamin B1', 'Histone H3', 'p-ERK1/2', 'ERK1/2', 'p-AKT (S473)', 'AKT', 'Cleaved caspase-3', 'PARP', 'LC3B', 'p62'];
    $('protList').innerHTML = [...new Set(sug.concat(used, base))].map(n => `<option value="${esc(n)}">`).join('');
  }
  function deleteSelectedBoxes(){const n=App.deleteBoxes();if(n)toast(L(`已删除 ${n} 个蛋白框（Ctrl+Z 可撤销）`,`Deleted ${n} protein boxes (Ctrl+Z to undo)`));}
  $('deleteSelectedBoxes').onclick=deleteSelectedBoxes;
  $('btnAddRow').onclick = () => { if (!S()) return; App.setMode(App.mode === 'addrow' ? null : 'addrow'); };
  function rebuildGroup() {
    const b=App.blot(App.viewBlot);if(!b)return;
    const pieces=App.mode==='pieces'?G.View.piecesEnd(true):null;
    if(App.mode)App.setMode(null);
    runDetection([b.id],pieces?{[b.id]:pieces}:null);
  }
  $('btnRebuildGroup').onclick=rebuildGroup;
  function runDetection(ids,outlines) {
    App.busy(true,L('按当前设置重新识别…','Detecting with the current settings…'));
    setTimeout(()=>{
      try{
        const n=App.rebuildBoxes(ids,outlines);focusProtein();App.viewImg=null;App.commit();G.View.fitFull();goTo('secRows');
        toast(L(`已重新识别 ${n} 个蛋白区域（Ctrl+Z 恢复原来的框）`,`Detected ${n} protein regions again (Ctrl+Z restores the previous boxes)`),4500);
      }catch(e){App.emit('change');if(App.curStep===2)startPieces(App.blot(App.viewBlot));toast(L('重新识别失败，原来的框已保留：','Detection failed; previous boxes retained: ')+e.message,5500);}
      finally{App.busy(false);}
    },20);
  }
  $('btnRedetect').onclick = () => {
    if (!S() || !confirm(L('按膜条重新识别所有蛋白框？\n现在调过的框、行的顺序和名字都会丢掉（Ctrl+Z 可撤销）。',
      'Detect every protein box again from the strips?\nThe boxes as adjusted, the row order and the names are lost (Ctrl+Z to undo).'))) return;
    runDetection(S().blots.map(b=>b.id));
  };

  /* ---------- 3 lanes ---------- */
  function renderLanes() {
    const st = S(), n = st.lanes.length;
    const opts = sel => st.lanes.map((l, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}${l.name ? ' · ' + esc(l.name.replace(/\*/g, '')).slice(0, 10) : ''}</option>`).join('');
    $('rangeA').innerHTML = opts(st.range[0]); $('rangeB').innerHTML = opts(st.range[1]);
    $('laneList').innerHTML = st.lanes.map((l, i) => `<div class="item${i + 1 < st.range[0] || i + 1 > st.range[1] ? ' out' : ''}"><span class="idx">${i + 1}</span><span style="flex:1">${esc(l.name) || '<span class="muted">—</span>'}</span>
      <label class="switch"><input type="checkbox" data-j="${i + 1}" ${l.hidden ? '' : 'checked'}>${L('显示', 'Show')}</label></div>`).join('');
    $('laneList').querySelectorAll('[data-j]').forEach(c => c.addEventListener('change', done(e => { st.lanes[+c.dataset.j - 1].hidden = !e.target.checked; })));
  }
  const onRange = done(() => {
    let a = +$('rangeA').value, b = +$('rangeB').value; if (a > b) [a, b] = [b, a];
    S().range = [a, b];
  });
  $('rangeA').addEventListener('change', onRange); $('rangeB').addEventListener('change', onRange);
  $('btnRangeAuto').onclick = done(() => App.fitLanes(true, App.activeColumn));
  function applyBulk() {
    const raw = $('laneBulk').value.replace(/\r/g, '').trim(); if (!raw) return;
    let names = raw.includes('\t') ? raw.split(/\t|\n/) : raw.includes('\n') ? raw.split('\n') : raw.split(/[,，;；]/);
    names = names.map(s => s.trim());
    let fl = App.figLanes();
    if (names.length > fl.length) {
      const extra = names.length - fl.length; S().range[1] += extra; App.ensureLane(S().range[1]); fl = App.figLanes();
      toast(L(`名称多于泳道，范围向右扩展 ${extra} 条`, `More names than lanes: the range was extended by ${pl(extra, 'lane')} to the right`));
    }
    fl.forEach((j, k) => { if (k < names.length) S().lanes[j - 1].name = names[k]; });
    const nf = Math.min(names.length, fl.length);
    $('laneBulk').value = ''; App.commit(); toast(L(`已填入 ${nf} 个泳道名`, `Filled in ${pl(nf, 'lane name')}`));
  }
  $('laneBulk').addEventListener('change', applyBulk);

  const columnName = c => c.title || L(`第 ${App.layoutColumns().indexOf(c) + 1} 列`, `Column ${App.layoutColumns().indexOf(c) + 1}`);
  function activateColumn(id) {
    if (id === App.activeColumn) return;
    if (edit) closeEd(false); closePop(); App.activeColumn = id; App.refresh();
  }
  let renderedColumn = null;
  function renderColumns() {
    renderedColumn = App.activeColumn;
    const cs = App.layoutColumns(), active = cs.find(c => c.id === App.activeColumn) || cs[0];
    App.activeColumn = active.id;
    const box = $('columnControls'), wasOpen = !!box.querySelector('details')?.open;
    box.innerHTML = cs.length === 1 && !active.title ? `<button class="btn sm ghost" id="addLayoutColumn">${L('+ 多列排版', '+ Add a layout column')}</button>` : `
      <div class="column-tabs">${cs.map(c => `<button class="btn sm ${c === active ? 'primary' : ''}" data-column-pick="${c.id}">${esc(columnName(c))}</button>`).join('')}<button class="btn sm" id="addLayoutColumn">＋</button></div>
      <p class="hint">${L('当前列的名称与标注如下。拖区域到另一列可移动；上下拖动只排序。', 'Names and annotations below belong to this column. Drag a region across to move it; up/down only reorders.')}</p>
      <div class="field inline"><input id="columnTitle" value="${esc(active.title)}" placeholder="${L('列标题（可空）', 'Column title (optional)')}"><select id="columnTitleSide"><option value="top">${L('顶部', 'Top')}</option><option value="bottom">${L('底部', 'Bottom')}</option></select></div>
      <details class="adv"><summary>${L('列设置', 'Column settings')}</summary><div class="field inline"><label>${L('列间距', 'Column gap')} <input id="columnGap" type="number" min="2" max="30" step="0.5" class="num" value="${S().style.columnGapMm ?? 6}"> mm</label><label class="switch"><input type="checkbox" id="alignColumnRows" ${S().style.alignColumnRows ? 'checked' : ''}>${L('按行对齐', 'Align rows')}</label></div>
      <div class="field inline"><select id="copyColumn"><option value="">${L('复制另一列的标签…', 'Copy labels from…')}</option>${cs.filter(c => c !== active).map(c => `<option value="${c.id}">${esc(columnName(c))}</option>`).join('')}</select>${cs.length > 1 && !App.rowsInColumn(active.id).length ? `<button class="btn sm" id="removeColumn">${L('删除空列', 'Remove empty column')}</button>` : ''}</div></details>`;
    $('addLayoutColumn').onclick = done(() => { closeEd(false); closePop(); App.addColumn(); });
    box.querySelectorAll('[data-column-pick]').forEach(b => b.onclick = () => { activateColumn(b.dataset.columnPick); App.emit('change'); });
    if (!$('columnTitle')) return;
    box.querySelector('details').open = wasOpen;
    $('columnTitle').oninput = live(e => { active.title = e.target.value; }); $('columnTitle').onchange = done();
    $('columnTitleSide').value = active.titleSide || 'top'; $('columnTitleSide').onchange = done(e => { active.titleSide = e.target.value; });
    $('columnGap').onchange = done(e => { S().style.columnGapMm = clamp(+e.target.value || 6, 2, 30); });
    $('alignColumnRows').onchange = done(e => { S().style.alignColumnRows = e.target.checked; });
    $('copyColumn').onchange = done(e => { if (e.target.value) App.copyColumnLabels(e.target.value, active.id); });
    if ($('removeColumn')) $('removeColumn').onclick = done(() => App.removeColumn(active.id));
  }
  $('btnMarkerFit').onclick = done(() => { const f=G.BRender.build(false); S().style.markerPt=Math.max(4,Math.floor(Math.min(S().style.markerPt||S().style.fontPt,f.markerFit||4)*2)/2); toast(L('已统一适配字号；仍有重叠时可点数字隐藏次要刻度', 'Global font fitted; if labels still overlap, click a number to hide an unneeded tick')); });
  $('markerFontQuick').onchange = done(e => { S().style.markerPt = e.target.value === '' ? null : clamp(+e.target.value || 7, 4, 14); });
  function markerPopover(row, at) {
    if (!row) return;
    const marks = new Map(); row.segs.forEach(sg => App.pieceTicks(App.blot(row.blot), App.piece(App.blot(row.blot), sg.piece), sg).forEach(t => marks.set(t.id, t.k)));
    pop.innerHTML = `<h4>${esc(App.rowLabel(row))} · ${L('区域标注', 'Region labels')}</h4>
      ${App.layoutColumns().length > 1 ? `<div class="field"><label>${L('移到排版列', 'Move to column')} <select id="regionColumn">${App.layoutColumns().map(c => `<option value="${c.id}">${esc(columnName(c))}</option>`).join('')}</select></label></div>` : ''}
      <label>${L('全部 Marker 字号', 'Global marker font')} <input id="globalMarkerPt" type="number" min="4" max="14" step="0.5" class="num" value="${S().style.markerPt || ''}" placeholder="${S().style.markerPt || S().style.fontPt}"> pt</label>
      <p class="hint">${L('修改字号会应用到所有区域。取消勾选只隐藏数字，不删除校准点。', 'Font changes apply to every region. Unchecking hides a label; calibration is kept.')}</p>
      <div class="marker-visibility">${[...marks].map(([id,k]) => `<label><input type="checkbox" data-mark-toggle="${id}" ${!(row.hiddenMarkers || []).includes(id) ? 'checked' : ''}>${k} kDa</label>`).join('')}</div>
      <div class="actions"><button class="btn sm danger" id="deleteProteinBox">${L('删除此蛋白框', 'Delete this protein box')}</button><button class="btn sm primary" id="markerDisplayDone">${L('完成', 'Done')}</button></div>`;
    placePopNear(at);
    const dest = pop.querySelector('#regionColumn'); if (dest) { dest.value = App.rowColumn(row); dest.onchange = () => { App.moveToColumn(row, dest.value); closePop(); App.commit(); }; }
    pop.querySelector('#globalMarkerPt').onchange = done(e => { S().style.markerPt = e.target.value === '' ? null : clamp(+e.target.value || 7, 4, 14); });
    pop.querySelectorAll('[data-mark-toggle]').forEach(i => i.onchange = done(() => { row.hiddenMarkers = (row.hiddenMarkers || []).filter(id => id !== i.dataset.markToggle); if (!i.checked) row.hiddenMarkers.push(i.dataset.markToggle); }));
    pop.querySelector('#deleteProteinBox').onclick = () => { closePop(); App.deleteBox(row, App.curSeg(row)); };
    pop.querySelector('#markerDisplayDone').onclick = closePop;
  }
  function pasteConditions(replace) {
    const result = App.pasteConditions($('conditionBulk').value, App.activeColumn, replace);
    if (result.error) { toast(result.error); return; }
    $('conditionBulk').value = ''; App.commit(); toast(L(`已填入 ${result.count} 行条件`, `Added ${result.count} condition rows`));
  }
  $('condAppend').onclick = () => { if (S()) pasteConditions(false); };
  $('condReplace').onclick = () => { if (S()) pasteConditions(true); };
  function conditionPopover(r, j, at) {
    const c = S().conditions[r];
    pop.innerHTML = `<h4>${esc(c.name || L('条件值', 'Condition value'))}</h4><input id="conditionValue" type="text" value="${esc(c.values[j - 1] || '')}" placeholder="+, −, 24 h…"><div class="actions"><button class="btn sm primary" id="conditionDone">${L('完成', 'Done')}</button></div>`;
    placePopNear(at); const input = pop.querySelector('input');
    input.oninput = live(() => { c.values[j - 1] = input.value; }); input.onchange = done();
    input.onkeydown = e => { if (e.key === 'Enter' && !composing(e)) closePop(); }; pop.querySelector('button').onclick = closePop; input.focus(); input.select();
  }

  /* ---------- 4 annotations ---------- */
  $('btnAddCond').onclick = done(() => { S().conditions.push({ name: '', values: S().lanes.map(() => '') }); toast(L('点格子切换 + / − / 空；Shift+点击输入时间、剂量等。点条件名可编辑', 'Click cells for + / − / blank; Shift+click to type time, dose or other text. Click the condition name to edit it'), 3200); });
  $('btnAddGroup').onclick = () => { if (S()) App.setMode(App.mode === 'group' ? null : 'group'); };
  $('btnAddArrow').onclick = () => { if (S()) App.setMode(App.mode === 'arrow' ? null : 'arrow'); };
  $('btnAddBracket').onclick = () => { if (S()) App.setMode(App.mode === 'bracket' ? null : 'bracket'); };
  /* a side bracket: its label (↵ = a line break, as in the list), the side, its own font size */
  function bracketPopover(k, at) {
    const bk = (S().brackets || [])[k], rs = bk ? App.bracketRows(bk) : [];
    if (!rs.length) return;
    const part = bk.f0 > 0.02 || bk.f1 < 0.98;
    const what = rs.length > 1 ? L(`${rs.length} 行（${list(rs.map(r => App.rowLabel(r)))}）`, `${rs.length} rows (${list(rs.map(r => App.rowLabel(r)))})`)
      : L(`「${App.rowLabel(rs[0])}」${part ? '的一段' : '整行'}`, `"${App.rowLabel(rs[0])}", ${part ? 'part of the row' : 'the whole row'}`);
    pop.innerHTML = `<h4>${L('行旁括号', 'Side bracket')} · ${esc(what)}</h4>
      <div class="field"><input type="text" id="pbText" value="${esc((bk.text || '').replace(/\n/g, ' ↵ '))}" placeholder="${L('如 IP: Flag、Input、WCL、(Ub)n', 'e.g. IP: Flag, Input, WCL, (Ub)n')}" title="${L('↵ = 换行', '↵ = line break')}"></div>
      <div class="field inline"><label class="inline-label">${L('放在', 'Side')}</label><div class="seg"><button data-side="left" class="${bk.side !== 'right' ? 'on' : ''}">${L('左边', 'Left')}</button><button data-side="right" class="${bk.side === 'right' ? 'on' : ''}">${L('右边', 'Right')}</button></div></div>
      <div class="field inline"><label class="inline-label">${L('字号', 'Font size')}</label><input type="number" id="pbPt" min="4" max="14" step="0.5" class="num" placeholder="${S().style.fontPt}" value="${bk.pt || ''}"> pt
        <span class="hint" style="margin:0">${L('留空 = 跟随全局字号', 'Empty = the figure font size')}</span></div>
      <div class="field inline"><label><input type="checkbox" id="pbVertical" ${bk.vertical ? 'checked' : ''}>${L('竖排文字', 'Vertical text')}</label><label><input type="checkbox" id="pbLine" ${bk.line ? 'checked' : ''}>${L('直线样式', 'Straight line')}</label></div>
      <div class="field inline"><label>${L('颜色','Colour')} <select id="pbColor"><option value="">${L('默认','Default')}</option><option value="red">${L('红色','Red')}</option></select></label></div>
      <p class="hint">${L('在成图上拖动括号两端的小方块，可以直接修改覆盖范围。', 'Drag the small handles at the bracket ends on the figure to change its span.')}</p>
      <div class="actions"><button class="btn sm danger" id="pbDel">${L('删除', 'Delete')}</button><button class="btn sm primary" id="pbOk">${L('完成', 'Done')}</button></div>`;
    placePopNear(at);
    const q = id => pop.querySelector('#' + id);
    q('pbVertical').onchange = done(e => { bk.vertical = e.target.checked; }); q('pbLine').onchange = done(e => { bk.line = e.target.checked; });
    q('pbColor').value=bk.color||'';q('pbColor').onchange=done(e=>{bk.color=e.target.value;});
    q('pbText').addEventListener('input', live(e => { G.FigureText.edit(bk,'text',e.target.value.replace(/\s*↵\s*/g, '\n')); }));
    G.NoteUI?.formats(q('pbText'),bk,'text');
    q('pbText').addEventListener('change', done());
    q('pbText').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) closePop(); });
    q('pbPt').addEventListener('input', live(e => { const v = +e.target.value; if (e.target.value !== '' && v >= 4 && v <= 14) bk.pt = v; else if (e.target.value === '') delete bk.pt; }));
    q('pbPt').addEventListener('change', done());
    pop.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { bk.side = b.dataset.side; App.commit(); bracketPopover(S().brackets.indexOf(bk), at); });
    q('pbDel').onclick = () => { const i = S().brackets.indexOf(bk); if (i >= 0) S().brackets.splice(i, 1); dropPop(); App.commit(); toast(L('已删除这个括号（Ctrl+Z 可撤销）', 'Bracket deleted (Ctrl+Z to undo)')); };
    q('pbOk').onclick = () => closePop();
    setTimeout(() => q('pbText') && q('pbText').focus({ preventScroll: true }), 0);
  }
  /* a target-band arrow (as GelFigure's): its name, where its size comes from (the marks; ≈ beyond the marked
   * bands) or a size typed in, the mark (an arrowhead; * # † for other bands), the side, its own font size */
  function arrowPopover(k, at) {
    const a = S().arrows[k]; if (!a) return;
    const row = App.row(a.row), est = App.arrowSize(a);
    let estHtml = L('这条膜条还没标够 2 条 Marker 带：分子量无法估算（第 4 步标好后自动出现，或在下面填理论大小）',
      'Fewer than 2 marker bands are marked on this strip: the size cannot be estimated (it appears once step 4 is done; or type the expected size below)');
    if (est) {
      estHtml = L(`按这条膜条标的 Marker 估算：<b>${esc(est)}</b>`, `Estimated from the marker marked on this strip: <b>${esc(est)}</b>`);
      if (/≈/.test(est)) estHtml += `<br><span class="warn-t">${L('在标过的 Marker 带范围之外，是外推值，成图上标 ≈', 'Outside the marked marker bands: extrapolated, shown with ≈ on the figure')}</span>`;
    }
    pop.innerHTML = `<h4>${L('目标条带', 'Target band')} · ${esc(row ? App.rowLabel(row) : '')}</h4>
      <div class="field"><input type="text" id="paText" value="${esc(a.text)}" placeholder="${L('名称（可空），如 p-ERK1/2、剪切体', 'Name (optional), e.g. p-ERK1/2, cleaved form')}"></div>
      <div class="field inline"><label class="inline-label">${L('标记', 'Mark')}</label>
        <select id="paSym" style="width:auto"><option value="◀">◀ ${L('箭头', 'arrow')}</option><option value="*">* ${L('非特异条带', 'non-specific band')}</option><option value="#"># ${L('降解产物等', 'degradation product etc.')}</option><option value="†">† ${L('其他', 'other')}</option></select></div>
      <div class="est">${estHtml}</div>
      <div class="field inline"><label class="switch"><input type="checkbox" id="paAuto" ${a.auto ? 'checked' : ''}><span>${L('标注大小', 'Show size')}</span></label>
        <input type="text" id="paSize" style="flex:1" value="${esc(a.sizeText || '')}" placeholder="${esc(est || L('如 55 kDa', 'e.g. 55 kDa'))}" title="${L('留空 = 用估算值；也可以填理论大小', 'Empty = the estimate; or type the expected size')}"></div>
      <div class="field inline"><label class="inline-label">${L('放在', 'Side')}</label><div class="seg"><button data-side="left" class="${a.side === 'left' ? 'on' : ''}">${L('左边', 'Left')}</button><button data-side="right" class="${a.side !== 'left' ? 'on' : ''}">${L('右边', 'Right')}</button></div>
        <span class="hint" style="margin:0">${L('在成图上上下拖动箭头，可以移到这一行的另一条带', 'Drag the arrow up or down on the figure to move it to another band of this row')}</span></div>
      <div class="field inline"><label class="inline-label">${L('字号', 'Font size')}</label><input type="number" id="paPt" min="4" max="14" step="0.5" class="num" placeholder="${S().style.fontPt}" value="${a.pt || ''}"> pt
        <span class="hint" style="margin:0">${L('留空 = 跟随全局字号', 'Empty = the figure font size')}</span></div>
      <div class="field inline"><label>${L('颜色','Colour')} <select id="paColor"><option value="">${L('默认','Default')}</option><option value="red">${L('红色','Red')}</option></select></label></div>
      <div class="actions"><button class="btn sm danger" id="paDel">${L('删除', 'Delete')}</button><button class="btn sm primary" id="paOk">${L('完成', 'Done')}</button></div>`;
    pop.querySelector('#paSym').value = a.sym;
    placePopNear(at);
    const q = id => pop.querySelector('#' + id);
    q('paColor').value=a.color||'';q('paColor').onchange=done(e=>{a.color=e.target.value;});
    q('paText').addEventListener('input', live(e => { G.FigureText.edit(a,'text',e.target.value); }));
    G.NoteUI?.formats(q('paText'),a,'text');
    q('paText').addEventListener('change', done());
    q('paText').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) closePop(); });
    q('paSym').addEventListener('change', done(e => { a.sym = e.target.value; }));
    q('paAuto').addEventListener('change', done(e => { a.auto = e.target.checked; }));
    q('paSize').addEventListener('input', live(e => { a.sizeText = e.target.value.trim(); if (a.sizeText) { a.auto = true; q('paAuto').checked = true; } }));
    q('paSize').addEventListener('change', done());
    q('paPt').addEventListener('input', live(e => { const v = +e.target.value; if (e.target.value !== '' && v >= 4 && v <= 14) a.pt = v; else if (e.target.value === '') delete a.pt; }));
    q('paPt').addEventListener('change', done());
    pop.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { a.side = b.dataset.side; App.commit(); arrowPopover(S().arrows.indexOf(a), at); });
    // (by identity: other arrows may have been deleted while this was open)
    q('paDel').onclick = () => { const i = S().arrows.indexOf(a); if (i >= 0) S().arrows.splice(i, 1); dropPop(); App.commit(); toast(L('已删除这个箭头（Ctrl+Z 可撤销）', 'Arrow deleted (Ctrl+Z to undo)')); };
    q('paOk').onclick = () => closePop();
    setTimeout(() => q('paText') && q('paText').focus({ preventScroll: true }), 0);
  }
  function renderAnno() {
    const st = S(), rows = [];
    (st.brackets || []).forEach((bk, k) => {
      const ends = [App.row(bk.r0), App.row(bk.r1)].filter(Boolean);
      if (!ends.some(r => App.rowColumn(r) === App.activeColumn)) return;
      const rs = App.bracketRows(bk);
      if (!rs.length) {
        rows.push(`<div class="item"><span class="kind">${L('括号', 'Bracket')}</span><span class="hint">${esc(bk.text || '')} · ${L('两端已分列，移回可恢复，或删除后重画', 'Ends moved to different columns. Move back to restore, or delete and redraw.')}</span><button class="x" data-bdel="${k}">×</button></div>`); return;
      }
    });
    const box = $('annoList'); box.innerHTML = rows.join('');
    box.querySelectorAll('[data-a]').forEach(b => b.onclick = () => arrowPopover(+b.dataset.a, b.getBoundingClientRect()));
    box.querySelectorAll('[data-adel]').forEach(b => b.onclick = done(() => st.arrows.splice(+b.dataset.adel, 1)));
    box.querySelectorAll('[data-b]').forEach(b => b.onclick = () => bracketPopover(+b.dataset.b, b.getBoundingClientRect()));
    box.querySelectorAll('[data-bdel]').forEach(b => b.onclick = done(() => st.brackets.splice(+b.dataset.bdel, 1)));
    box.querySelectorAll('[data-g]').forEach(i => { const g = st.groups[+i.dataset.g]; i.addEventListener('input', live(e => { g.text = e.target.value.replace(/\s*↵\s*/g, '\n'); })); i.addEventListener('change', done()); });
    box.querySelectorAll('[data-c]').forEach(i => { const c = st.conditions[+i.dataset.c]; i.addEventListener('input', live(e => { c.name = e.target.value; })); i.addEventListener('change', done()); });
    box.querySelectorAll('[data-gdel]').forEach(b => b.onclick = done(() => st.groups.splice(+b.dataset.gdel, 1)));
    box.querySelectorAll('[data-cdel]').forEach(b => b.onclick = done(() => st.conditions.splice(+b.dataset.cdel, 1)));
  }

  /* ---------- 5 layout ---------- */
  const num = (id, key, lo, hi) => $(id).addEventListener('change', done(e => { S().style[key] = clamp(e.target.value === '' || !Number.isFinite(+e.target.value) ? S().style[key] : +e.target.value, lo, hi); }));
  num('mmPerLane', 'mmPerLane', 2, 15); num('fontPt', 'fontPt', 4, 14); num('rowGap', 'rowGapPt', 0, 10); num('lineW', 'lineWidthPt', 0.25, 2); num('minFontPt', 'minFontPt', 4, 10);
  // per-kind text sizes: empty = the figure font
  ['lanePt', 'namePt', 'markerPt'].forEach(id => $(id).addEventListener('change', done(e => { const v = +e.target.value; S().style[id] = e.target.value === '' || !(v > 0) ? null : clamp(v, 4, 14); })));
  $('labelAngle').addEventListener('change', done(e => { S().style.labelAngle = e.target.value; }));
  $('groupFit').addEventListener('change', done(e => { S().style.groupFit = e.target.value; }));
  ['invert', 'showMW', 'unitHeader', 'border', 'laneNumbers', 'groupTicks'].forEach(id => $(id).addEventListener('change', done(e => { S().style[id] = e.target.checked; })));
  $('panelLetter').addEventListener('change', done(e => { S().style.panelLetter = e.target.value.trim(); }));
  ['mwSide', 'nameSide'].forEach(id => $(id).addEventListener('change', done(e => { S().style[id] = e.target.value; })));
  // a journal column = the figure's total width, labels included: solved for the lane width (as GelFigure)
  $('widthPreset').addEventListener('change', e => {
    const target = +e.target.value; e.target.value = '';
    if (!S() || !target || !S().rows.length) return;
    const st = S().style, n = App.layoutColumns().reduce((n,c) => n + App.figLanes(c.id).length, 0);
    for (let k = 0; k < 4; k++) {          // (labels hardly depend on the lane width: a few rounds converge)
      const total = G.BRender.build(false).w / App.MM;
      st.mmPerLane = clamp(Math.round((st.mmPerLane + (target - total) / n) * 10) / 10, 2, 15);
    }
    App.commit();
    const got = G.BRender.build(false).w / App.MM;
    const wide = st.mmPerLane >= 15;
    toast(Math.abs(got - target) < 1.5 ? L(`成图总宽 ${got.toFixed(1)} mm（每道 ${st.mmPerLane} mm）`, `Figure width ${got.toFixed(1)} mm (${st.mmPerLane} mm per lane)`)
      : L(`每道已到${wide ? '最宽 15' : '最窄 2'} mm，成图总宽 ${got.toFixed(1)} mm（到不了 ${target} mm）`,
        `Lanes are at their ${wide ? 'widest, 15' : 'narrowest, 2'} mm; figure width ${got.toFixed(1)} mm (${target} mm is out of reach)`), 3600);
  });
  $('btnResetLayout').onclick = done(() => { App.resetLayout(); toast(L('版式已重置为默认（Ctrl+Z 可撤销）', 'Layout reset to the defaults (Ctrl+Z to undo)')); });
  // the bands' own resolution at this lane width, and the widest lane that keeps 300 dpi
  function updateDpiLine() {
    const eff = Math.round(App.effectiveDpi()), safe = App.maxSafeMmPerLane(300), mm = S().style.mmPerLane;
    if (!isFinite(eff)) { $('dpiLine').innerHTML = ''; return; }
    const head = L('条带有效分辨率', 'Effective resolution of the bands');
    $('dpiLine').innerHTML = eff >= 300 ? `${head} <span class="ok">${eff} dpi</span>`
      : `${head} <span class="bad">${eff} dpi</span>` + L(`（&lt; 300）：每道不超过 <b>${safe} mm</b> 才能保证 300 dpi`, ` (&lt; 300): lanes up to <b>${safe} mm</b> wide keep 300 dpi`)
        + (safe >= 2 && mm > safe ? ` <button class="btn sm" id="btnSafeW">${L(`改为 ${safe} mm`, `Set ${safe} mm`)}</button>` : '');
    const b = $('btnSafeW'); if (b) b.onclick = done(() => { S().style.mmPerLane = safe; });
  }

  /* ---------- middle header: image tabs + levels ---------- */
  const toSl = v => Math.round(Math.sqrt(clamp(v, 0, 1)) * 1000), fromSl = s => (s / 1000) ** 2;
  function renderStageHead() {
    const st = S(), sel = $('viewBlot');
    sel.classList.toggle('hidden', st.blots.length < 2);
    sel.innerHTML = st.blots.map(b => `<option value="${b.id}"${b.id === App.viewBlot ? ' selected' : ''}>${esc(App.blotName(b))}</option>`).join('');
    const b = App.blot(App.viewBlot), rec = G.View.curImage();
    $('fitSel').disabled = !App.selRow;
    if (!b) return;
    // tabs: the exposures, shortest first, and the white-light picture the marker is read from (another white-light
    // picture only while it is shown: one per capture is common, and they look alike)
    const imgs = App.chemiOf(b).concat(App.markersOf(b).filter(r => r.id === b.marker || (rec && r.id === rec.id)));
    $('imgTabs').innerHTML = imgs.map(r => `<button data-img="${r.id}" class="${rec && r.id === rec.id ? 'on' : ''}" title="${esc(r.name)}">${r.kind === 'marker' ? `${L('白光', 'White light')}<span class="tag-m">${r.id === b.marker ? 'Marker' : L('其他', 'other')}</span>` : esc(App.expoLabel(r))}</button>`).join('');
    $('imgTabs').querySelectorAll('button').forEach(btn => btn.onclick = () => { App.viewImg = btn.dataset.img; App.emit('select'); });
    // the picture shown: its tab scrolled into sight
    const on = $('imgTabs').querySelector('button.on');
    if (on) { const T = $('imgTabs'), a = on.getBoundingClientRect(), c = T.getBoundingClientRect(); if (a.left < c.left || a.right > c.right) T.scrollLeft += a.left - c.left - (c.width - a.width) / 2; }
    const isC = rec && rec.kind === 'chemi';
    const multi=App.boxSelection().length>1;
    $('levelBar').classList.toggle('hidden', !isC);
    if (isC) {
      // No implicit whole-image editing. Browsing another exposure must not change other protein regions.
      const row = lvRow(), sel = App.selRow && App.row(App.selRow), users = st.rows.filter(r => r.img === rec.id && !r.hidden);
      const lv = row ? App.rowLevels(row) : App.levelsOf(rec.id);
      const nu = users.length, rl = row && esc(App.rowLabel(row).replace(L(/ 行$/, / row$/), ''));
      $('levelName').innerHTML = row ? L(`调整 <b>${rl}</b>（只这一行）`, `Adjusting <b>${rl}</b> (this row only)`)
          + `<button class="link" id="lvToImg" title="${L('改这张曝光图的所有区域，已有单独设置的除外', 'Change all regions of this exposure except those with their own levels')}">${L('高级：整张曝光', 'Advanced: whole exposure')}</button>`
        : lvImage ? L(`调整整张曝光（${nu} 个区域用它）`, `Adjusting the whole exposure (${nu} regions use it)`) + `<button class="link" id="lvToRow">${L('返回单区调整', 'Back to region editing')}</button>`
        : sel ? L('正在查看另一张图，先返回所选区域的曝光', 'Viewing another picture; return to the selected region’s exposure') + `<button class="link" id="lvBackPic">${L('返回', 'Return')}</button>`
        : L('先点一个蛋白框，再调整它的亮度', 'Select a protein region to adjust its levels');
      if ($('lvToImg')) $('lvToImg').onclick = () => { lvImage = true; renderStageHead(); };
      if ($('lvToRow')) $('lvToRow').onclick = () => { lvImage = false; renderStageHead(); };
      if ($('lvBackPic')) $('lvBackPic').onclick = () => { App.viewImg = sel.img; App.viewBlot = sel.blot; App.emit('select'); };
      if(multi)$('levelName').textContent=L('已多选蛋白框：退格批量删除；单选后可调亮度','Multiple boxes selected: Backspace deletes them; select one to adjust levels');
      ['lvBlack', 'lvWhite', 'btnLvAuto'].forEach(id => { $(id).disabled = multi || (!row && !lvImage); });
      $('lvBlack').value = toSl(lv.black); $('lvWhite').value = toSl(lv.white);
    }
  }
  // the bar on the whole picture although a row is selected (until another row is)
  let lvImage = false, lvSel = null, lvPic = null;
  function lvRow() {
    const r = App.selRow && App.row(App.selRow), rec = G.View.curImage();
    if (App.selRow !== lvSel || (rec && rec.id) !== lvPic) { lvSel = App.selRow; lvPic = rec && rec.id; lvImage = false; }
    return !lvImage && r && rec && r.img === rec.id ? r : null;
  }
  $('viewBlot').addEventListener('change', e => { App.viewBlot = e.target.value; App.viewImg = null; App.emit('select'); G.View.fitFull(); });
  const lvSet = (key) => live(e => {
    const rec = G.View.curImage(); if (!rec) return;
    const row = lvRow(), lv = Object.assign({}, row ? App.rowLevels(row) : App.levelsOf(rec.id)), v = fromSl(+e.target.value);
    if (App.boxSelection().length>1 || (!row && !lvImage)) return;
    if (key === 'black') lv.black = Math.min(v, lv.white - 0.0005); else lv.white = Math.max(v, lv.black + 0.0005);
    if (row) row.lv = { black: lv.black, white: lv.white };
    else { lv.manual = true; S().levels[rec.id] = lv; G.View.draw(); }
  });
  $('lvBlack').addEventListener('input', lvSet('black')); $('lvWhite').addEventListener('input', lvSet('white'));
  $('lvBlack').addEventListener('change', done()); $('lvWhite').addEventListener('change', done());
  $('btnLvAuto').onclick = done(() => { const rec = G.View.curImage(), row = lvRow(); if (row) delete row.lv; else if (rec && lvImage) { delete S().levels[rec.id]; App.refreshChoices(); } });
  $('showSat').addEventListener('change', () => G.View.draw());
  $('fitFull').onclick = () => G.View.fitFull();
  $('fitSel').onclick = () => { const r = App.selRow && App.row(App.selRow); if (!r) return; if (App.viewBlot !== r.blot) { App.viewBlot = r.blot; App.viewImg = r.img; App.emit('select'); } G.View.fitRow(r); };

  /* ---------- preview + direct editing ---------- */
  const prev = $('preview'), fed = $('floatEd');
  $('previewBox').tabIndex = 0;
  let lastFig = null, edit = null;
  function updatePreview() {
    let f;
    try { f = G.BRender.build(true); } catch (e) { console.error(e); return; }
    lastFig = f;
    prev.innerHTML = f.svg;
    const svg = prev.querySelector('svg'), bx = $('previewBox').getBoundingClientRect();
    const k = Math.max(0.5, Math.min((bx.width - 88) / f.w, (bx.height - 48) / f.h, 4));
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = (f.w * k) + 'px'; svg.style.height = (f.h * k) + 'px';
    prevScale = k;
    drawRowTags(f);
    $('figSize').textContent = `${(f.w / App.MM).toFixed(1)} × ${(f.h / App.MM).toFixed(1)} mm`;
    if (!App.dragging) {
      const ck = App.checks();
      showWarnings(f.warnings.concat(ck.warn));
      $('legendHints').innerHTML = ck.legend.length ? `<b>${L('图注可参考', 'For the legend')}</b>` + ck.legend.map(esc).join('<br>') : '';
    }
    if (edit) { const el = editEl(edit); if (el) el.classList.add('active'); }
  }
  const edState = e => App.columnData(e.column || App.activeColumn);
  const getV = e => e.kind === 'lane' ? edState(e).lanes[e.id - 1].name : e.kind === 'rowname' ? (App.row(e.id) || {}).name : e.kind === 'group' ? edState(e).groups[e.id].text : edState(e).conditions[e.id].name;
  const textTarget=e=>e.kind==='lane'?edState(e).lanes[e.id-1]:e.kind==='rowname'?App.row(e.id):e.kind==='group'?edState(e).groups[e.id]:edState(e).conditions[e.id];
  const setV=(e,v)=>{const o=textTarget(e);if(o)G.FigureText.edit(o,e.kind==='group'?'text':'name',v);};
  const editEl = e => prev.querySelector((e.kind === 'lane' ? `g[data-edit="lane"][data-j="${e.id}"]` : e.kind === 'rowname' ? `g[data-edit="rowname"][data-row="${e.id}"]` : e.kind === 'group' ? `g[data-edit="group"][data-k="${e.id}"]` : `g[data-edit="condname"][data-r="${e.id}"]`) + `[data-column="${e.column || App.activeColumn}"]`);
  /* the text editor over the figure: one line (with the protein-name suggestions), or several for a group label
   * (Shift+Enter); under it a bar with the font size of what is edited (lane names and protein names share one
   * each, a group or a condition row has its own) and, for a group, a line break (as GelFigure) */
  const fta = $('floatTa'), bar = $('fedBar');
  const edBox = () => (edit && edit.kind === 'group' ? fta : fed);
  const sizeHost = () => (edit.kind === 'lane' ? (textTarget(edit).nameStyle?{o:textTarget(edit).nameStyle,k:'pt'}:{ o: S().style, k: 'lanePt' }) : edit.kind === 'rowname' ? { o: S().style, k: 'namePt' }
    : { o: textTarget(edit), k: 'pt' });
  const inheritedSize=()=>edit?.kind==='lane'&&textTarget(edit).nameStyle?(S().style.lanePt||S().style.fontPt):S().style.fontPt;
  const curSize = () => { const h = sizeHost(); return (h.o && h.o[h.k]) || inheritedSize(); };
  function setSize(v) {
    const h = sizeHost(); if (!h.o) return;
    if (v == null || v === inheritedSize()) { if (h.k === 'pt') delete h.o.pt; else h.o[h.k] = null; }
    else h.o[h.k] = clamp(Math.round(v * 2) / 2, 4, 14);
    syncBar(); App.refresh();
  }
  function syncBar() {
    if (!edit) return;
    const h = sizeHost(), own = h.o && h.o[h.k];
    $('fedSizeLbl').textContent = edit.kind === 'lane' ? L('泳道名字号', 'Lane name size') : edit.kind === 'rowname' ? L('蛋白名字号', 'Protein name size')
      : edit.kind === 'group' ? L('字号', 'Font size') : L('本行字号', 'Row font size');
    $('fedSize').textContent = curSize() + ' pt';
    $('fedReset').classList.toggle('hidden', !own);
    $('fedBr').classList.toggle('hidden', edit.kind !== 'group');
    $('fedDelete').classList.toggle('hidden', !['group','condname'].includes(edit.kind));
    $('fedHint').textContent = edit.kind === 'group' ? L('Shift+Enter 换行', 'Shift+Enter: new line') : '';
  }
  function placeBar() {
    const r = edBox().getBoundingClientRect();
    bar.classList.remove('hidden');
    const below = r.bottom + 4 + bar.offsetHeight < innerHeight;
    bar.style.left = clamp(r.left, 4, Math.max(4, innerWidth - bar.offsetWidth - 4)) + 'px';
    bar.style.top = clamp(below ? r.bottom+4 : r.top-bar.offsetHeight-4,4,Math.max(4,innerHeight-bar.offsetHeight-4)) + 'px';
  }
  // the multi-line editor grows with typed line breaks
  const autoRows = () => { fta.rows = Math.min(4, Math.max(1, fta.value.split('\n').length)); if (edit) placeBar(); };
  function openEd(kind, id) {
    if (edit) closeEd(false);          // (a previous editor whose blur has not been handled yet)
    closePop();
    const e = { kind, id, column: App.activeColumn }, el = editEl(e); if (!el) return;
    const r = el.getBoundingClientRect();
    edit = Object.assign(e, { orig: getV(e) || '' });
    const box = edBox();
    box.value = edit.orig;
    G.Formatting?.opened(edit,box);
    box.style.fontFamily=G.FigureText.fontStack(S().style.fontFamily);
    box.placeholder = kind === 'lane' ? L(`泳道 ${id} 名称`, `Lane ${id} name`) : kind === 'rowname' ? L('蛋白名（如 GAPDH）', 'Protein name (e.g. GAPDH)')
      : kind === 'group' ? L('分组文字', 'Group label') : L('条件名', 'Condition name');
    if (kind === 'rowname') { fed.setAttribute('list', 'protList'); fillDatalist(App.rowKda(App.row(id))); selectRow(id, true); } else fed.removeAttribute('list');
    const w = Math.max(130, Math.min(240, r.width + 60));
    box.style.width = w + 'px';
    box.style.left = clamp(kind === 'rowname' ? r.left - 6 : r.left + r.width / 2 - w / 2, 4, innerWidth - w - 4) + 'px';
    box.style.top = clamp(r.top + r.height / 2 - 15, 56, innerHeight - 40) + 'px';
    box.classList.remove('hidden');
    if (box === fta) { fta.rows = 1; autoRows(); }
    syncBar(); placeBar();
    box.focus(); box.select();
  }
  // only a group label keeps line breaks; spaces around them tidied
  const cleanText = (kind, v) => (kind === 'group' ? v.split('\n').map(s => s.trim()).join('\n').replace(/\n{2,}/g, '\n').trim() : v.replace(/\s*\n\s*/g, ' ').trim());
  function closeEd(revert) {
    if (!edit) return;
    const e = edit, box = edBox(); edit = null;
    setV(e, revert ? e.orig : cleanText(e.kind, box.value));
    G.Formatting?.closed(revert);
    fed.classList.add('hidden'); fta.classList.add('hidden'); bar.classList.add('hidden');
    App.commit();
  }
  let barPress = false;
  [fed, fta].forEach(box => {
    box.addEventListener('input', () => {
      if (!edit || edBox() !== box) return;
      if (edit.kind !== 'group' && box.value.includes('\n')) box.value = box.value.replace(/\n/g, ' ');     // (pasted text)
      setV(edit, box.value); App.saveDraftSoon(); if (box === fta) autoRows(); App.refresh();
    });
    box.addEventListener('keydown', e => {
      if (!edit || composing(e)) return;          // (the IME is choosing characters: Enter belongs to it)
      if (e.key === 'Escape') { e.preventDefault(); closeEd(true); return; }
      if (e.key === 'Enter' && edit.kind === 'group' && (e.shiftKey || e.altKey)) return;      // a line break (the textarea inserts it)
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault();
      const { kind, id } = edit; closeEd(false);
      const back = e.shiftKey;
      // the next one opens at once when it is on the figure already: keys typed right after Enter are not lost
      // (a frame later they were, in Safari)
      const next = (k, nid) => { if (editEl({ kind: k, id: nid })) openEd(k, nid); else requestAnimationFrame(() => openEd(k, nid)); };
      if (kind === 'lane') {
        const fl = App.figLanes(), k = fl.indexOf(id) + (back ? -1 : 1);
        if (k >= 0 && k < fl.length) next('lane', fl[k]); else toast(L('泳道名称填完了', 'All lane names filled in'));
      } else if (kind === 'rowname') {
        const vis = App.rowsInColumn(App.activeColumn).filter(r => !r.hidden), k = vis.findIndex(r => r.id === id) + (back ? -1 : 1);
        if (k >= 0 && k < vis.length) next('rowname', vis[k].id); else toast(L('蛋白名填完了', 'All protein names filled in'));
      }
    });
    // leaving the field finishes the edit — unless it went to the size / line-break bar
    box.addEventListener('blur', () => setTimeout(() => { if (edit && !barPress && document.activeElement !== edBox() && !bar.contains(document.activeElement)) closeEd(false); }, 120));
  });
  bar.addEventListener('pointerdown', e => { barPress = true; if(!e.target.matches('input,select'))e.preventDefault(); setTimeout(() => { barPress = false; }, 800); });
  bar.addEventListener('mousedown', e => {if(!e.target.matches('input,select'))e.preventDefault();});
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-fz]'); barPress = false;
    if (!b || !edit) return;
    const k = b.dataset.fz;
    if (k === 'delete' && ['group','condname'].includes(edit.kind)) { const old=edit; closeEd(false); (old.kind==='group'?App.columnData(old.column).groups:App.columnData(old.column).conditions).splice(old.id,1);App.commit();return; }
    if (k === '+' || k === '-') setSize(curSize() + (k === '+' ? 0.5 : -0.5));
    else if (k === 'reset') setSize(null);
    else if (k === 'br' && edit.kind === 'group') { fta.setRangeText('\n', fta.selectionStart, fta.selectionEnd, 'end'); fta.dispatchEvent(new Event('input')); }
    edBox().focus();
  });
  function editRowName(id) { requestAnimationFrame(() => requestAnimationFrame(() => openEd('rowname', id))); }
  // undo / redo / another project: open editors belong to the old state — dropped without writing back
  App.onSwap = () => {
    if (edit) { edit = null; fed.classList.add('hidden'); fta.classList.add('hidden'); bar.classList.add('hidden'); }
    dropPop();App.selectedBoxes.clear();
  };

  let press = null;
  const laneAt = (x, y) => { const el = document.elementFromPoint(x, y), g = el && el.closest && el.closest('g[data-edit="lane"]'); return g && g.dataset.column === App.activeColumn ? +g.dataset.j : null; };
  const hl = (a, b) => prev.querySelectorAll('g[data-edit="lane"]').forEach(g => { const j = +g.dataset.j; g.classList.toggle('active', g.dataset.column === App.activeColumn && a != null && j >= Math.min(a, b) && j <= Math.max(a, b)); });
  prev.addEventListener('mousedown', e => {
    if (App.mode === 'bracket') return;
    const g = e.target.closest('g[data-edit="lane"]');
    if (g) { activateColumn(g.dataset.column); press = { j: +g.dataset.j, end: +g.dataset.j, x: e.clientX, y: e.clientY, moved: false }; e.preventDefault(); }
  });
  window.addEventListener('mousemove', e => {
    if (!press) return;
    if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 6) press.moved = true;
    if (press.moved) { const l = laneAt(e.clientX, e.clientY); if (l != null) press.end = l; hl(press.j, press.end); }
  });
  window.addEventListener('mouseup', () => {
    if (!press) return;
    const p = press; press = null; hl(null);
    if ((p.moved && p.end !== p.j) || App.mode === 'group') {
      S().groups.push({ from: Math.min(p.j, p.end), to: Math.max(p.j, p.end), text: '' });
      App.setMode(null); App.commit();
      const k = S().groups.length - 1; requestAnimationFrame(() => openEd('group', k));
    } else if (!p.moved) openEd('lane', p.j);
  });
  // a target-band arrow dragged up / down the figure: onto another band of its row (snaps on release)
  let adrag = null;
  prev.addEventListener('mousedown', e => {
    const g = e.button === 0 && S() && App.mode !== 'bracket' && e.target.closest('g[data-edit="arrow"]'); if (!g) return;
    const a = S().arrows[+g.dataset.k], row = a && App.row(a.row), r = row && rowRects(lastFig).find(x => x.id === a.row);
    if (!r) return;
    const mid = App.arrowV(a) - a.db, sg = row.segs[0];
    adrag = { a, row, y0: e.clientY, db0: a.db, k: (row.above + row.below) / Math.max(1, r.bot - r.top), lo: sg.vc - row.above - mid, hi: sg.vc + row.below - mid, moved: false };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!adrag) return;
    const dy = e.clientY - adrag.y0;
    if (Math.abs(dy) > 3) adrag.moved = true;
    if (adrag.moved) { adrag.a.db = clamp(adrag.db0 + dy * adrag.k, adrag.lo, adrag.hi); App.refresh(); }
  });
  window.addEventListener('mouseup', () => {
    if (!adrag) return;
    const d = adrag; adrag = null;
    if (!d.moved) return;                 // (a click: its settings, by the click handler)
    const v = App.arrowV(d.a), mid = v - d.a.db;
    d.a.db = Math.round((App.snapBandV(d.row, v) - mid) * 10) / 10;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    App.commit();
  });
  /* a side bracket drawn on the figure (bracket tool): dragged along the rows, its ends snapping to a row's top or
   * bottom when near one (Alt: no snapping); a click covers that one row */
  let bdrag = null;
  function rowAtY(my, alt, columnId = App.activeColumn) {
    const rs = rowRects(lastFig).filter(r => r.columnId === columnId);
    let best = null;
    rs.forEach(r => { if (my >= r.top && my <= r.bot) best = { r, f: (my - r.top) / Math.max(1, r.bot - r.top) }; });
    // (between the rows, or past them: the nearest row edge)
    if (!best) rs.forEach(r => [[r.top, 0], [r.bot, 1]].forEach(([y, fr]) => { const d = Math.abs(my - y); if (!best || d < best.d) best = { r, f: fr, d }; }));
    if (best && !alt) best.f = best.f < 0.2 ? 0 : best.f > 0.8 ? 1 : best.f;
    return best;
  }
  function bracketGhost(d) {
    const ov = prev.querySelector('.prev-ov'), svg = prev.querySelector('svg'); if (!ov || !svg) return;
    const pr = prev.getBoundingClientRect(), sr = svg.getBoundingClientRect(), right = S().style.nameSide === 'left';
    const y = p => p.r.top + p.f * (p.r.bot - p.r.top), y1 = Math.min(y(d.a), y(d.b)), y2 = Math.max(y(d.a), y(d.b));
    let gh = ov.querySelector('.brk-ghost');
    if (!gh) { gh = document.createElement('div'); ov.appendChild(gh); }
    gh.className = 'brk-ghost ' + (right ? 'r' : 'l');
    Object.assign(gh.style, { left: (right ? columnScreenBounds(d.a.r.columnId).x1 + 2 : columnScreenBounds(d.a.r.columnId).x0 - 9) + 'px', top: y1 + 'px', height: Math.max(2, y2 - y1) + 'px' });
    const ids = new Set([d.a.r.id, d.b.r.id]), n = ids.size === 1 ? 1 : App.bracketRows({ r0: d.a.r.id, r1: d.b.r.id }).filter(r => !r.hidden).length;
    // (above the bracket: the rows below the pointer stay visible)
    tipAt(ov, (right ? sr.right - pr.left + 14 : sr.left - pr.left + 6), Math.max(2, y1 - 26), n > 1 ? L(`盖住 ${n} 行（如 IP / Input）`, `Covers ${n} rows (e.g. IP / Input)`)
      : d.a.f === 0 && d.b.f === 1 || d.a.f === 1 && d.b.f === 0 ? L('整行', 'The whole row') : L('一行里的一段（如 (Ub)n 拖尾）', 'Part of a row (e.g. an (Ub)n smear)'));
  }
  prev.addEventListener('mousedown', e => {
    if (e.button !== 0 || !S() || App.mode !== 'bracket' || !lastFig) return;
    const columnId = columnAtX(e.clientX); activateColumn(columnId);
    const a = rowAtY(e.clientY - prev.getBoundingClientRect().top, e.altKey, columnId); if (!a) return;
    bdrag = { a, b: a, y0: e.clientY, moved: false };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!bdrag) return;
    if (Math.abs(e.clientY - bdrag.y0) > 4) bdrag.moved = true;
    if (!bdrag.moved) return;
    bdrag.b = rowAtY(e.clientY - prev.getBoundingClientRect().top, e.altKey, bdrag.a.r.columnId) || bdrag.b;
    bracketGhost(bdrag);
  });
  window.addEventListener('mouseup', () => {
    if (!bdrag) return;
    const d = bdrag; bdrag = null;
    const ov = prev.querySelector('.prev-ov');
    if (ov) { ov.querySelectorAll('.brk-ghost').forEach(x => x.remove()); tipAt(ov, 0, 0, ''); }
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    let a = d.a, b = d.b;
    if (!d.moved) { a = { r: d.a.r, f: 0 }; b = { r: d.a.r, f: 1 }; }       // (a click: the whole row)
    else if (a.r.id === b.r.id && Math.abs(a.f - b.f) < 0.05) { toast(L('拖得太短：沿着行上下拖，或在一行上点一下盖住整行', 'Too short: drag up or down along the rows, or click a row to cover all of it')); return; }
    const bk = App.addBracket(a.r.id, a.f, b.r.id, b.f);
    App.setMode(null); App.commit();
    const k = S().brackets.indexOf(bk), g = prev.querySelector(`g[data-edit="bracket"][data-k="${k}"]`);
    if (g) bracketPopover(k, g.getBoundingClientRect());
  });
  prev.addEventListener('click', e => {
    if (!S() || swallowClick) return;
    const img = e.target.closest('image[data-row]');
    if (img && App.mode === 'arrow') { placeArrow(img.dataset.row, e.clientY); return; }
    if (img) {
      const id=img.dataset.row,show=()=>{if(App.mode)App.setMode(null);focusProtein();selectRow(id,true);$('previewBox').focus({preventScroll:true});};
      // A result remains clickable while reviewing strips/markers. Apply pending outline
      // edits before opening its protein controls, and leave the old editing mode cleanly.
      if(App.mode==='pieces')applyPieces(App.blot(App.viewBlot),G.View.piecesEnd(true),false,show);else show();
      return;
    }
    const g = e.target.closest('[data-edit]');
    if (!g) { if (App.mode === 'arrow') toast(L('请点在成图里某一行的条带上', 'Click on the bands of a row in the figure')); return; }
    activateColumn(g.dataset.column || App.activeColumn);
    const kind = g.dataset.edit;
    if (kind === 'marker') markerPopover(App.row(g.dataset.row), g.getBoundingClientRect());
    else if (kind === 'arrow') arrowPopover(+g.dataset.k, g.getBoundingClientRect());
    else if (kind === 'bracket') bracketPopover(+g.dataset.k, g.getBoundingClientRect());
    else if (kind === 'rowname') openEd('rowname', g.dataset.row);
    else if (kind === 'group') openEd('group', +g.dataset.k);
    else if (kind === 'condname') openEd('condname', +g.dataset.r);
    else if (kind === 'cond') {
      const c = S().conditions[+g.dataset.r], j = +g.dataset.j, cyc = { '': '+', '+': '−', '−': '' };
      if (e.shiftKey || !['', '+', '−'].includes(c.values[j - 1] || '')) { conditionPopover(+g.dataset.r, j, g.getBoundingClientRect()); return; }
      while (c.values.length < j) c.values.push('');
      c.values[j - 1] = cyc[c.values[j - 1] || ''] != null ? cyc[c.values[j - 1] || ''] : '';
      App.commit();
    }
  });

  /* ---------- arranging independent protein regions ----------
   * Vertical dragging only changes order, including when dropped over another region.
   * Horizontal dragging positions the selected crop. Neither gesture combines data or settings. */
  let prevScale = 1, pdrag = null, ldrag = null, swallowClick = false;
  // rows of the figure on screen, relative to #preview (top / bottom, left / right of the lanes)
  function rowRects(f) {
    const svg = prev.querySelector('svg'), m = svg && svg.getScreenCTM && svg.getScreenCTM();
    if (!m || !f || !f.rowBoxes) return [];
    const pr = prev.getBoundingClientRect(), p = svg.createSVGPoint();
    const at = (x, y) => { p.x = x; p.y = y; const q = p.matrixTransform(m); return { x: q.x - pr.left, y: q.y - pr.top }; };
    return f.rowBoxes.map(rb => { const a = at(rb.x0 ?? 0, rb.y), b = at(rb.x1 ?? f.figW, rb.y + rb.h); return { id: rb.id, columnId: rb.columnId || 'main', x0: a.x, x1: b.x, top: a.y, bot: b.y }; });
  }
  function columnScreenBounds(id) {
    const svg = prev.querySelector('svg'), m = svg?.getScreenCTM(), c = lastFig?.columnBoxes?.find(c => c.id === id), pr = prev.getBoundingClientRect();
    if (!m || !c) return { x0: 0, x1: 100 };
    return { x0: m.a * c.x0 + m.e - pr.left, x1: m.a * c.x1 + m.e - pr.left };
  }
  function columnAtX(clientX) {
    const x = clientX - prev.getBoundingClientRect().left;
    let best = App.activeColumn, dist = Infinity;
    (lastFig?.columnBoxes || []).forEach(c => { const b = columnScreenBounds(c.id), d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0; if (d < dist) { dist = d; best = c.id; } });
    return best;
  }
  function drawRowTags(f) {
    const svg = prev.querySelector('svg'); if (!svg) return;
    const ov = document.createElement('div'); ov.className = 'prev-ov'; prev.appendChild(ov);
    const left = svg.getBoundingClientRect().left - prev.getBoundingClientRect().left;
    rowRects(f).forEach(r => {
      const row = App.row(r.id); if (!row) return;
      const t = document.createElement('div');
      t.className = 'rowtag' + (row.id === App.selRow ? ' sel' : ''); t.dataset.row = r.id; t.textContent = shortLabel(row);
      t.title = L(`蛋白框 ${modLabel(row)}。上下拖动只调整顺序；左右拖动对齐泳道，设置各自独立`,
        `Boxes ${modLabel(row)}. Drag up or down to reorder only; drag bands left or right to line up lanes. Settings stay independent`);
      t.style.left = (columnScreenBounds(r.columnId).x0 - 5) + 'px'; t.style.top = ((r.top + r.bot) / 2) + 'px';
      ov.appendChild(t);
      const menu=document.createElement('button'); menu.className='row-menu';menu.dataset.row=r.id;menu.textContent='⋯';menu.title=L('区域设置与 Marker 显示','Region settings and marker visibility');menu.setAttribute('aria-label',menu.title);
      menu.style.left=(columnScreenBounds(r.columnId).x1+3)+'px';menu.style.top=((r.top+r.bot)/2)+'px';menu.onclick=e=>{e.stopPropagation();markerPopover(row,menu.getBoundingClientRect());};ov.appendChild(menu);
    });
    ov.insertAdjacentHTML('beforeend', '<div class="dropline hidden"></div><div class="dropbox hidden"></div><div class="droptip hidden"></div>');
  }
  // the dragged images follow the pointer (svg units)
  function ghost(sel, dx, dy) {
    prev.querySelectorAll('image[data-row], rect[data-row]').forEach(el => { el.removeAttribute('transform'); el.removeAttribute('opacity'); });
    if (sel) prev.querySelectorAll(sel).forEach(el => { if (el.tagName === 'image' || el.tagName === 'rect') { el.setAttribute('transform', `translate(${dx},${dy})`); el.setAttribute('opacity', '0.78'); } });
  }
  function tipAt(ov, x, y, text) {
    const tip = ov.querySelector('.droptip');
    tip.textContent = text; tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.toggle('hidden', !text);
  }
  // a target-band arrow where the figure row was clicked (screen y), at the band nearest it; its settings opened
  function placeArrow(id, cy) {
    const row = App.row(id), r = rowRects(lastFig).find(x => x.id === id); if (!row || !r) return;
    const frac = (cy - prev.getBoundingClientRect().top - r.top) / Math.max(1, r.bot - r.top);
    const a = App.addArrow(row, row.segs[0].vc - row.above + frac * (row.above + row.below));
    App.setMode(null); App.commit();
    const k = S().arrows.indexOf(a), g = prev.querySelector(`g[data-edit="arrow"][data-k="${k}"]`);
    if (g) arrowPopover(k, g.getBoundingClientRect());
    toast(App.arrowSize(a) ? L(`已标出 ${App.arrowSize(a)}：可以加名称、换成 * # †、放到另一边`, `Marked ${App.arrowSize(a)}: you can add a name, switch to * # † or move it to the other side`)
      : L('已加箭头：第 4 步标好 Marker 后自动显示分子量', 'Arrow added: its size shows once the marker is marked in step 4'), 3600);
  }
  prev.addEventListener('mousedown', e => {
    if (e.button !== 0 || !S() || App.mode === 'arrow' || App.mode === 'bracket') return;
    const tag = e.target.closest('.rowtag'), img = !tag && e.target.closest('image[data-row]');
    if (!tag && !img) return;
    pdrag = { id: (tag || img).dataset.row, piece: img ? img.dataset.piece : null, box: img ? img.dataset.box : null, x0: e.clientX, y0: e.clientY, mode: null, onlyOrder: !!tag, k: 0, drop: null, alt: false };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!pdrag || !lastFig) return;
    const dx = e.clientX - pdrag.x0, dy = e.clientY - pdrag.y0, ov = prev.querySelector('.prev-ov');
    if (!pdrag.mode) {
      if (Math.hypot(dx, dy) < 6) return;
      pdrag.mode = pdrag.onlyOrder || Math.abs(dy) >= Math.abs(dx) ? 'order' : 'align';
      prev.classList.add('arranging');
    }
    if (!ov) return;
    const pr = prev.getBoundingClientRect(), mx = e.clientX - pr.left, my = e.clientY - pr.top;
    const line = ov.querySelector('.dropline'), boxEl = ov.querySelector('.dropbox');
    const targetColumn = columnAtX(e.clientX), originColumn = App.rowColumn(App.row(pdrag.id));
    pdrag.targetColumn = targetColumn;
    if (pdrag.mode === 'order' || targetColumn !== originColumn) {
      ghost(`[data-row="${pdrag.id}"]`, targetColumn !== originColumn ? dx / prevScale : 0, dy / prevScale);
      const rs = rowRects(lastFig).filter(r => r.columnId === targetColumn && r.id !== pdrag.id);
      // Vertical dragging only reorders. Dropping over another row never combines its data/settings.
      let at = rs.findIndex(r => my < (r.top + r.bot) / 2);
      if (at < 0) at = rs.length;
      pdrag.drop = { at, before: rs[at]?.id || null, columnId: targetColumn };
      line.classList.remove('hidden'); boxEl.classList.add('hidden');
      const a = rs[at - 1], b = rs[at], yy = !rs.length ? 0 : !a ? b.top - 3 : !b ? a.bot + 3 : (a.bot + b.top) / 2;
      const ref = rs[0] || columnScreenBounds(targetColumn);
      Object.assign(line.style, { left: ref.x0 - 8 + 'px', top: yy + 'px', width: ref.x1 - ref.x0 + 16 + 'px' });
      tipAt(ov, mx + 14, my + 10, targetColumn === originColumn ? L('松开：调整上下顺序', 'Release to reorder') : L('松开：移到这一列，图像设置保留', 'Release: move to this column, keeping image settings'));

    } else {
      const k = Math.round(dx / prevScale / lastFig.laneW), row = App.row(pdrag.id), pc = row && App.findPiece(pdrag.piece);
      pdrag.k = k; pdrag.alt = e.altKey;
      ghost(`[data-box="${pdrag.box}"]`, k * lastFig.laneW, 0);
      const sg = row && row.segs.find(s => s.id === pdrag.box), who = sg ? App.boxLabel(sg) : '';
      tipAt(ov, mx + 14, my + 10, L(`只移动框 ${who}：${k > 0 ? '右' : '左'}移 ${Math.abs(k)} 列`, `Move box ${who} only: ${Math.abs(k)} columns ${k > 0 ? 'right' : 'left'}`));
    }
  });
  window.addEventListener('mouseup', () => {
    if (!pdrag) return;
    const d = pdrag; pdrag = null;
    prev.classList.remove('arranging');
    if (!d.mode) return;                // a click: selects the row (click handler)
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    const row = App.row(d.id);
    if (!row) { updatePreview(); return; }
    if (d.drop && (d.mode === 'order' || d.targetColumn !== App.rowColumn(row))) {
      App.moveToColumn(row, d.drop.columnId, d.drop.before); App.commit(); toast(L('已移动区域，图像设置保持独立', 'Region moved; image settings stay independent'));
    } else if (d.mode === 'align' && d.k) {
      const sg = row.segs.find(s => s.id === d.box);
      if (!sg) { updatePreview(); return; }
      const mv = App.shiftAlign(row, sg, d.k, d.alt);
      if (!mv.n) { updatePreview(); toast(L('已经在第 1 列了：要让它比其他行更靠左，把其他行往右拖', 'Already at column 1: to put it further left than the other rows, drag those right'), 3200); return; }
      App.commit();
      const one = true, letter = (App.findPiece(d.piece) || { pc: {} }).pc.letter, nd = Math.abs(mv.d);
      toast(L(`${one ? '这个框' : `膜条 ${letter} 上的 ${mv.n} 个框`}往${mv.d > 0 ? '右' : '左'}挪了 ${nd} 列${mv.d !== d.k ? '（最左到第 1 列）' : ''}`,
        `Moved ${one ? 'this box' : `the ${mv.n} boxes on strip ${letter}`} ${pl(nd, 'column')} ${mv.d > 0 ? 'right' : 'left'}${mv.d !== d.k ? ' (column 1 is the limit)' : ''}`));
    } else updatePreview();
  });
  // the list: drag rows by their grip
  $('rowList').addEventListener('mousedown', e => {
    const g = e.target.closest('.grip'); if (!g || e.button !== 0) return;
    ldrag = { id: g.closest('.row-item').dataset.id, y0: e.clientY, moved: false, to: null };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!ldrag) return;
    if (Math.abs(e.clientY - ldrag.y0) > 4) ldrag.moved = true;
    if (!ldrag.moved) return;
    const items = [...$('rowList').querySelectorAll('.row-item')];
    let t = items.findIndex(it => { const r = it.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (t < 0) t = items.length;
    ldrag.to = t;
    items.forEach((it, i) => { it.classList.toggle('drop-before', i === t); it.classList.toggle('drop-after', t === items.length && i === items.length - 1); it.classList.toggle('dragging', it.dataset.id === ldrag.id); });
  });
  window.addEventListener('mouseup', () => {
    if (!ldrag) return;
    const d = ldrag; ldrag = null;
    const items = [...$('rowList').querySelectorAll('.row-item')];
    items.forEach(it => it.classList.remove('drop-before', 'drop-after', 'dragging'));
    if (!d.moved || d.to == null) return;
    const to = d.to < items.length ? S().rows.findIndex(r => r.id === items[d.to].dataset.id) : S().rows.length;
    if (App.moveRow(d.id, to)) { App.commit(); toast(L('已调整行的顺序', 'Row order changed')); }
  });

  /* ---------- the steps: one after the other, each on what the one before established ----------
   * S.step: how far the user has come; App.curStep: the step open. The open step shows its body and (steps 2 and
   * 4) runs its mode on the membrane view; done steps fold to a line and open again on a click; later ones wait.
   * The top bar says what to do in the open step, and a click on it does it. */
  const STEP_SEC = { 1: 'secImages', 2: 'secPieces', 3: 'secRows', 4: 'secMarker', 5: 'secNames' };
  const toolNav=document.createElement('nav');toolNav.id='toolNav';toolNav.className='tool-nav';toolNav.setAttribute('aria-label',L('编辑工具','Editing tools'));
  const toolNames=()=>[L('分组','Groups'),L('膜区','Strips'),L('蛋白框','Boxes'),'Marker',L('成图','Figure')];
  toolNames().forEach((name,i)=>{const button=document.createElement('button');button.type='button';button.dataset.tool=String(i+1);button.textContent=name;button.onclick=()=>openStep(i+1);toolNav.appendChild(button);});
  $('sections').prepend(toolNav);

  // the pieces the figure uses that have fewer than 2 marks ({b, pc}), and them in words: "膜条 B、C" /
  // "膜 1 的膜条 B、C，膜 2 的膜条 A"
  const unmarked = () => S().blots.flatMap(b => App.usedPieces(b).filter(pc => App.markInfo(b, pc).state === 'none').map(pc => ({ b, pc })));
  const piecesText = list => {
    const by = new Map(); list.forEach(t => { if (!by.has(t.b)) by.set(t.b, []); by.get(t.b).push(t.pc.letter); });
    const many = S().blots.length > 1;
    return [...by].map(([b, ls]) => L((many ? `${App.blotName(b)} 的` : '') + '膜条 ' + ls.join('、'),
      (ls.length > 1 ? 'strips ' : 'strip ') + ls.join(', ') + (many ? ` of ${App.blotName(b)}` : ''))).join(L('，', '; '));
  };
  const goTo = id => { const el = $(id); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const flash = x => { const el = typeof x === 'string' ? $(x) : x; if (!el) return; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); };
  const openSteps = new Set();
  // Open the box controls without fitting/panning the image during a source-box gesture.
  function focusProtein() {
    if (!S() || S().step < 3) return;
    App.curStep=3; openSteps.clear(); openSteps.add(3); shownSel=null;
    renderSteps(); updateCoach();
  }
  function openStep(n) {
    const st = S(); if (!st) return;
    n = Math.max(1, Math.min(n, st.step));
    closePop();
    if(n===1 && App.curStep>1)App.reviewReturnStep=App.curStep;
    const was = App.curStep, b = App.blot(App.viewBlot) || st.blots[0];
    const go = () => {
      App.curStep = n; openSteps.clear(); openSteps.add(n);
      if (n === 2) startPieces(b);
      else if (n === 4) startMarks(b);
      else {
        if (App.mode) App.setMode(null);
        if (n === 1 && b && b.marker) App.viewImg = b.marker;
        if (n >= 3 && b && App.images.get(App.viewImg) && App.images.get(App.viewImg).kind === 'marker') App.viewImg = null;
        App.emit('change'); G.View.fitFull();
      }
      renderSteps(); updateCoach();
      goTo(STEP_SEC[n]);
    };
    // leaving step 2: the outlines edited there are applied first
    if (was === 2 && n !== 2 && App.mode === 'pieces') applyPieces(b, G.View.piecesEnd(true), false, go); else go();
  }
  /* "next" in step n: step 1 confirms the Marker pictures; 2 applies the pieces and makes the boxes (a membrane
   * that has boxes keeps them); 3 and 4 move on */
  async function nextStep(n) {
    const st = S(); if (!st) return;
    if (n === 1) {
      if (!st.blots.length) { toast(L('请先添加图片', 'Add pictures first')); return; }
      const none = st.blots.filter(b => !App.markerRec(b));
      if (none.length && !confirm(L(`${none.map(App.blotName).join('、')} 没有 Marker 图：膜条只能按曝光图的信号找，也不能标分子量。继续？`,
        `${none.map(App.blotName).join(', ')} ${none.length > 1 ? 'have' : 'has'} no marker picture: the strips can only be found from the exposures' signal, and no molecular weights can be marked. Continue?`))) return;
      st.step = Math.max(st.step, 2);
      try { await App.ensurePrepared(); } catch (e) { st.step = 1; toast(L('分析失败：', 'Analysis failed: ') + e.message); return; }
      pcSeen.clear(); App.viewBlot=st.blots[0].id;
    }
    if (n === 4 && st.style.showMW) {
      const todo = unmarked();
      if (todo.length && !confirm(L(`${piecesText(todo)} 还没有标 Marker。可以先继续，之后随时补标；只看得见 1 条也可以。继续？`,
        `No marker bands are marked on ${piecesText(todo)}. Continue and add them later? A single visible marker band is also enough to display a tick.`))) return;
    }
    if (n === 2) {
      const b = App.blot(App.viewBlot) || st.blots[0], pcs = App.mode === 'pieces' ? G.View.piecesEnd(true) : null;
      if(b.boxesReady){
        if(App.mode==='pieces')App.setMode(null);
        applyPieces(b,pcs,false,()=>{focusProtein();App.viewImg=null;App.commit();G.View.fitFull();goTo('secRows');});
        return;
      }
      // a membrane whose pieces were not looked at yet: that one first
      const more = pcUnseen();
      if (more) {
        applyPieces(b, pcs, false, () => {
          startPieces(more); renderPieces(); updateCoach();
          toast(L(`${App.blotName(b)} 的膜条好了，再看 ${App.blotName(more)} 的`, `The strips of ${App.blotName(b)} are done; now ${App.blotName(more)}`), 3200);
        });
        return;
      }
      if (App.mode === 'pieces') App.setMode(null);
      applyPieces(b, pcs, false, () => {
        App.busy(true, L('找每个蛋白的条带…', 'Finding the bands of each protein…'));
        setTimeout(() => {
          const had = st.rows.length;
          App.makeBoxes();
          App.busy(false);
          st.step = Math.max(st.step, 3); focusProtein();
          App.selRow = null; App.viewImg = null;
          if (!had) App.viewBlot = st.blots[0].id;          // (the boxes from the first membrane on)
          App.commit(); G.View.fitFull(); goTo('secRows');
          const n3 = st.rows.filter(r => !r.hidden).length;
          toast(had ? L('膜条已更新，框都留在原处', 'Strips updated; the boxes stayed where they were')
            : n3 ? L(`找到 ${n3} 个蛋白区域，右边就是成图。点框检查，好了点"下一步"`, `Found ${pl(n3, 'protein region')}; the figure is on the right. Click a box to check it, then click "Next"`)
            : L('没找到蛋白条带：点"+ 添加一个蛋白框"自己框', 'No protein bands found: click "+ Add a protein box" and draw one yourself'), 4200);
        }, 20);
      });
      return;
    }
    st.step = Math.max(st.step, n + 1);
    App.commit();
    openStep(n + 1);
  }
  [1, 2, 3, 4].forEach(n => { $('next' + n).onclick = () => nextStep(n); });
  // (a fix in the export check: on to the names, the first one missing focused)
  App.goNames = lanes => {
    S().step = Math.max(S().step, 5); openStep(5);
    setTimeout(() => {
      if (lanes) { const j = App.figLanes().find(x => !(S().lanes[x - 1] || {}).name); if (j) openEd('lane', j); return; }
      const r = S().rows.find(x => !x.hidden && !x.name); if (r) { activateColumn(App.rowColumn(r)); App.emit('change'); openEd('rowname', r.id); }
    }, 300);
  };
  $('skip4').onclick = () => {
    S().style.showMW = false;
    toast(L('这次不标分子量：成图不显示分子量刻度（第 5 步"版式"里可以再打开）', 'No molecular weights this time: the figure shows no MW ticks (turn them on again under "Layout" in step 5)'), 3600);
    nextStep(4);
  };
  // a done step's header opens it again
  Object.entries(STEP_SEC).forEach(([n,id])=>{
    const head=$(id).querySelector('.sec-head'), body=$(id).querySelector('.step-body'), button=document.createElement('button');
    body.id=id+'Body';button.className='step-toggle';button.type='button';button.setAttribute('aria-controls',body.id);head.appendChild(button);
    head.onclick=()=>{if(!S()||+n>S().step)return;if(openSteps.has(+n)&&App.curStep===+n){openSteps.delete(+n);renderSteps();}else openStep(+n);};
  });

  let coachAct = null;
  function updateCoach() {
    const st = S(), n = App.curStep || st.step, vis = st.rows.filter(r => !r.hidden), fl = App.figLanes();
    let msg, ok = false;
    coachAct = null;
    const bound = App.boundRows();
    if (n >= 3 && bound.length) {
      msg = L(`有 ${bound.length} 处<b>旧版绑定</b>：点这里解除后，分别选择曝光和亮度`, `${bound.length} <b>legacy combined rows</b>: click to detach and edit exposure and levels separately`);
      coachAct = () => { openStep(3); selectRow(bound[0].id, true); };
    } else if (n === 1) {
      msg = L('第 1 步：同一拍摄布局的图放一组，再选各组的 <b>Marker 参考图</b>（★），完成后点"确认分组"', 'Step 1: group pictures of the same capture layout, choose each <b>marker reference</b> (★), then confirm');
      coachAct = () => flash('next1');
    } else if (n === 2) {
      const bn = st.blots.length > 1 && esc(App.blotName(App.blot(App.viewBlot)));
      const many = bn ? L(`（${bn}${pcUnseen() ? '，看完再看下一组' : ''}）`, ` (${bn}${pcUnseen() ? ', then the next group' : ''})`) : '';
      msg = L(`第 2 步：确认前先填<b>预计泳道数（可选）</b>，再检查蓝框${many}；各框独立识别，不强制统一条数`,
        `Step 2: set <b>expected lanes (optional)</b> before confirming, then check the blue boxes${many}; each box keeps its own count`);
      coachAct = () => {flash('defaultLanesBefore');$('defaultLanesBefore').focus();};
    } else if (n === 3) {
      if (!vis.length) { msg = L('第 3 步：没找到蛋白条带，<b>点这里</b>再到膜上点一下放一个框', 'Step 3: no protein bands found. <b>Click here</b>, then click on the membrane to place a box'); coachAct = () => App.setMode('addrow'); }
      else {
        msg = L('第 3 步：检查每个<b>蛋白框</b>（点框选中，拖边角改大小，泳道线拖到泳道中心），好了点"下一步"',
          'Step 3: check each <b>protein box</b> (click to select, drag its edges to resize, drag lane lines to the lane centres), then click "Next"');
        coachAct = () => flash('next3');
      }
    } else if (n === 4) {
      const todo = unmarked();
      const noLad = st.blots.find(b => !b.ladderId);
      if (noLad) {
        msg = L('第 4 步：先在左边<b>选你用的 Marker 型号</b>（只需选一次）', 'Step 4: first <b>choose your ladder</b> on the left (only once)');
        coachAct = () => { const s = document.querySelector(`.mk-blot[data-blot="${noLad.id}"] .ladder-sel`); if (s) { s.focus(); flash(s); } };
      } else if (todo.length) {
        msg = L(`第 4 步：在 Marker 图上<b>点 Marker 条带</b>，选分子量（还未标记：${esc(piecesText(todo))}）`,
          `Step 4: <b>click the marker bands</b> on the marker picture and pick their sizes (not marked yet: ${esc(piecesText(todo))})`);
        coachAct = () => startMarks(todo[0].b, todo[0].pc);
      } else { msg = L('第 4 步：每条膜条都标好了，点"下一步"', 'Step 4: every strip is marked; click "Next"'); coachAct = () => flash('next4'); }
    } else {
      const unnamedRows = vis.filter(r => !r.name), unnamedLanes = fl.filter(j => !st.lanes[j - 1].name);
      const sat = vis.filter(r => { const e = App.rowExpo(r).find(x => x.id === r.img); return e && e.satFrac > 0.002; });
      if (unnamedRows.length) {
        msg = L(`第 5 步：<b>输入蛋白名</b>（还差 ${unnamedRows.length} 行，回车跳下一个）`, `Step 5: <b>type the protein names</b> (${unnamedRows.length} to go; Enter jumps to the next)`);
        coachAct = () => { activateColumn(App.rowColumn(unnamedRows[0])); App.emit('change'); openEd('rowname', unnamedRows[0].id); };
      } else if (unnamedLanes.length) {
        msg = L(`第 5 步：<b>输入泳道名</b>（成图上方灰色数字，还差 ${unnamedLanes.length} 条）`, `Step 5: <b>type the lane names</b> (the grey numbers above the figure; ${unnamedLanes.length} to go)`);
        coachAct = () => openEd('lane', unnamedLanes[0]);
      } else if (sat.length) {
        msg = L(`「${esc(sat[0].name)}」所选曝光有过曝：<b>点这里</b>换一张更短的曝光`, `The exposure chosen for "${esc(sat[0].name)}" is saturated: <b>click here</b> to pick a shorter one`);
        coachAct = () => { openStep(3); selectRow(sat[0].id, true); };
      } else {
        msg = L('可以导出了 —— 右上角<b>导出 PNG</b>；补充材料用"未裁切原图"', 'Ready to export: <b>Export PNG</b> at the top right; for the supplement, "Uncropped originals"');
        ok = true; coachAct = () => flash('btnPNG');
      }
    }
    if(n<st.step && n!==1 && n!==2) { msg=L('可直接展开其他步骤继续编辑，当前修改会保留。','Expand another tool to continue; your changes are kept.');coachAct=()=>openStep(st.step); }
    $('coachText').innerHTML = msg + (coachAct && !ok ? ' <span class="coach-go">→</span>' : '');
    $('coach').classList.toggle('done', ok); $('coach').classList.toggle('act', !!coachAct);
    $('imgCount').textContent = L(`${App.images.size} 张图 · 添加`, `${pl(App.images.size, 'picture')} · add`);
  }
  $('coach').addEventListener('click', () => { if (coachAct) coachAct(); });
  // the steps' look: open / done / waiting; the figure's placeholder until there are boxes
  function renderSteps() {
    const st = S(), cur = App.curStep || st.step;
    toolNav.querySelectorAll('button').forEach((b,i)=>{b.textContent=toolNames()[i];b.disabled=i+1>st.step;b.classList.toggle('on',i+1===cur);b.setAttribute('aria-current',i+1===cur?'step':'false');});
    Object.entries(STEP_SEC).forEach(([n, id]) => {
      n = +n;
      const el = $(id);
      if(!openSteps.size && !App.stepsStarted) {openSteps.add(cur); App.stepsStarted=true;}
      el.classList.toggle('open',openSteps.has(n)); el.classList.toggle('completed',n<st.step);
      const toggle=el.querySelector('.step-toggle'); if(toggle) {toggle.textContent=openSteps.has(n)?L('收起 ▴','Collapse ▴'):L('展开 ▾','Expand ▾');toggle.disabled=n>st.step;toggle.setAttribute('aria-expanded',String(openSteps.has(n)));}
      el.classList.toggle('cur', n === cur); el.classList.toggle('done', n < st.step); el.classList.toggle('reach', n === st.step && n !== cur); el.classList.toggle('locked', n > st.step);
    });
    // (a membrane added later goes through the steps again: the figure there is already stays)
    $('figEmpty').classList.toggle('hidden', !!st.rows.length);
    $('feSub').textContent = L('按左边的步骤走，第 3 步之后成图出现在这里', 'Follow the steps on the left; the figure appears here after step 3');
    $('feSteps').querySelectorAll('li').forEach(li => { const s = +li.dataset.s; li.classList.toggle('done', s < cur); li.classList.toggle('cur', s === cur); });
  }

  /* ---------- the first time: what the three columns are for ---------- */
  function showTour() {
    const t = $('tour');
    t.classList.remove('hidden');
    t.querySelectorAll('.tour-card').forEach(c => {
      const r = $(c.dataset.at).getBoundingClientRect();
      c.style.left = Math.max(12, r.left + r.width / 2 - 150) + 'px'; c.style.top = (r.top + 90) + 'px';
    });
  }
  $('tourOk').onclick = () => { $('tour').classList.add('hidden'); G.PrefStorage.setItem('blotfig.tour', '1'); };
  $('btnTourAgain').onclick = () => { $('helpDlg').classList.add('hidden'); if (S()) showTour(); };

  function syncLayout() {
    const y = S().style;
    $('markerFontQuick').value = y.markerPt || ''; $('markerFontQuick').placeholder = y.fontPt;
    $('mmPerLane').value = y.mmPerLane; $('fontPt').value = y.fontPt; $('rowGap').value = y.rowGapPt; $('labelAngle').value = String(y.labelAngle);
    $('lineW').value = y.lineWidthPt;
    ['lanePt', 'namePt', 'markerPt'].forEach(id => { $(id).value = y[id] || ''; $(id).placeholder = y.fontPt; });
    $('groupFit').value = y.groupFit || 'wrap'; $('minFontPt').value = y.minFontPt || 5;
    $('minFontRow').classList.toggle('hidden', (y.groupFit || 'wrap') !== 'shrink');
    $('invert').checked = y.invert; $('showMW').checked = y.showMW; $('unitHeader').checked = y.unitHeader; $('border').checked = !!y.border; $('panelLetter').value = y.panelLetter || '';
    $('laneNumbers').checked = !!y.laneNumbers; $('groupTicks').checked = !!y.groupTicks;
    $('mwSide').value = y.mwSide || 'left'; $('nameSide').value = y.nameSide || 'right';
    $('dpiTop').value = String(y.dpi);
    $('stLayout').textContent = L(`${y.mmPerLane} mm/泳道 · ${y.fontPt} pt`, `${y.mmPerLane} mm/lane · ${y.fontPt} pt`);
    $('btnUndo').disabled = App.hist.length < 2; $('btnRedo').disabled = !App.future.length;
    updateDpiLine();
  }

  /* the panel drawn again while a protein name is being typed in the list: that row's field gets the focus (and
   * the caret) back */
  function keepFocus(fn) {
    const a = document.activeElement, it = a && a.tagName === 'INPUT' && a.closest('.row-item'), id = it && it.dataset.id;
    const sel = it ? [a.selectionStart, a.selectionEnd] : null;
    fn();
    const n = id && $('rowList').querySelector(`.row-item[data-id="${id}"] input`);
    if (n && n !== a) { n.focus({ preventScroll: true }); try { n.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
  }
  // the selected row (picked on the membrane or in the figure) shown in the list, opened
  let shownSel = null;
  function showSelRow() {
    if (App.selRow === shownSel) return;
    shownSel = App.selRow;
    const it = $('rowList').querySelector('.row-item.sel'); if (!it) return;
    const d = it.nextElementSibling;
    if (d && d.classList.contains('row-detail')) d.scrollIntoView({ block: 'nearest' });
    it.scrollIntoView({ block: 'nearest' });
  }
  App.on(what => {
    if (what === 'storage') return;
    if (what === 'empty') { pcSeen.clear(); $('emptyState').classList.remove('hidden'); $('sections').classList.add('hidden'); $('preview').innerHTML=''; $('figEmpty').classList.remove('hidden'); $('levelBar').classList.add('hidden'); App.curStep=1; G.View.draw(); offerDraft();return; }
    if (!S()) return;
    if (what === 'loaded') {
      openSteps.clear(); openSteps.add(S().step); App.stepsStarted=true;
      $('emptyState').classList.add('hidden'); $('sections').classList.remove('hidden'); $('draftBox').classList.add('hidden');
      // the step to go on with (a membrane just added: its Marker picture first)
      App.curStep = S().step;
      if (App.curStep === 1) { const b = App.blot(App.viewBlot); if (b && b.marker) App.viewImg = b.marker; }
      G.View.fitFull();               // (the membrane view drew before the step was known)
      // (a project saved in step 2 or 4: back in that step's mode)
      if (App.curStep === 2 || App.curStep === 4) setTimeout(() => openStep(App.curStep), 0);
      const seen = !!G.PrefStorage.getItem('blotfig.tour');
      const dev = qs.get('demo') || qs.get('srcdir') || qs.get('demomove');     // (scripted runs: only with &tour=1)
      if (!seen && (!dev || qs.get('tour'))) setTimeout(showTour, 400);
    }
    if (what === 'refresh') { if (renderedColumn !== App.activeColumn) { renderNames(); renderColumns(); renderLanes(); renderAnno(); } updatePreview(); return; }
    if (what === 'select') { if (App.selRow) activateColumn(App.rowColumn(App.row(App.selRow))); if (renderedColumn !== App.activeColumn) { renderNames(); renderColumns(); renderLanes(); renderAnno(); } keepFocus(() => { renderBlots(); renderPieces(); renderMarker(); renderRows(); }); showSelRow(); renderStageHead(); renderSteps(); updatePreview(); G.View.draw(); return; }
    keepFocus(() => { renderBlots(); renderPieces(); renderMarker(); renderRows(); renderNames(); renderColumns(); renderLanes(); renderAnno(); });
    showSelRow(); renderStageHead(); syncLayout(); renderSteps(); updateCoach(); updatePreview();
  });
  window.addEventListener('resize', () => { if (S()) updatePreview(); });
  window.addEventListener('blotfigure-markers-changed',()=>{if(S())keepFocus(()=>renderMarker());});

  /* ---------- exports: uncropped originals, quantification ---------- */
  function exportRaw() {
    const st = S(), used = [...new Set(st.rows.filter(r => !r.hidden).map(r => r.img))];
    const blots = [...new Set(st.rows.filter(r => !r.hidden).map(r => r.blot))].map(App.blot);
    const pages = [];
    blots.forEach(b => {
      used.filter(id => b.images.includes(id)).forEach(id => pages.push({ b, rec: App.images.get(id) }));
      if (b.marker) pages.push({ b, rec: App.images.get(b.marker) });
    });
    const Wout = 1400, fs = 22;
    const heights = pages.map(p => Math.round(p.rec.img.h * Wout / p.rec.img.w) + fs * 3.4);
    const c = document.createElement('canvas'); c.width = Wout; c.height = heights.reduce((a, b) => a + b, 0) + fs * 2;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000'; ctx.font = `bold ${fs}px Arial`; ctx.fillText('Uncropped original images', 14, fs * 1.3);
    let y0 = fs * 2;
    // every picture as taken (not resampled onto the membrane's grid); boxes drawn where they lie in it
    pages.forEach((p, k) => {
      const sc = Wout / p.rec.img.w, h = p.rec.img.h * sc, top = y0 + fs * 2.2, toRaw = (pc, xy) => App.rawPoint(p.rec.id, pc.id, xy[0], xy[1]);
      ctx.fillStyle = '#000'; ctx.font = `bold ${fs * 0.8}px Arial`;
      ctx.fillText(`${App.blotNameEn(p.b)} — ${p.rec.kind === 'marker' ? 'white-light marker image' : 'exposure ' + App.expoLabel(p.rec)} — ${p.rec.name}`, 14, y0 + fs * 1.4);
      ctx.drawImage(G.View.dispCanvas(p.rec, true), 0, top, Wout, h);

      st.rows.filter(r => !r.hidden && r.blot === p.b.id && (p.rec.kind === 'marker' || r.img === p.rec.id)).forEach(r => {
        const vis = new Set(App.figLanes(App.rowColumn(r)));
        let last = null;
        r.segs.forEach(sg => {
          const pc = App.piece(p.b, sg.piece); if (!pc || !sg.lanes.length) return;
          const F = App.segFrame(pc, sg), vT = sg.vc - App.boxAbove(r, sg), vB = sg.vc + App.boxBelow(r, sg);   // (a tilted box drawn tilted)
          const pts = [[sg.x0, vT], [sg.x1, vT], [sg.x1, vB], [sg.x0, vB]].map(([u, v]) => toRaw(pc, WB.toImg(F, u, v)));
          ctx.strokeStyle = '#e03131'; ctx.lineWidth = 2; ctx.beginPath();
          pts.forEach(([x, y], i) => { if (i) ctx.lineTo(x * sc, top + y * sc); else ctx.moveTo(x * sc, top + y * sc); }); ctx.closePath(); ctx.stroke();
          if (!last || pts[1][0] > last[0]) last = pts[1];
          // figure column of every lane along the top of the box; lanes left out marked X, ladder M
          ctx.fillStyle = '#e03131'; ctx.font = `${fs * 0.55}px Arial`; ctx.textAlign = 'center';
          App.segCols(sg).forEach(s => {
            const [x, y] = toRaw(pc, WB.toImg(F, s.u, vT));
            ctx.fillText(s.r === 'm' ? 'M' : s.r === 's' && vis.has(s.col) ? String(s.col) : 'X', x * sc, top + y * sc - 4);
          });
          ctx.textAlign = 'left';
        });
        if (last) { ctx.fillStyle = '#e03131'; ctx.font = `bold ${fs * 0.7}px Arial`; ctx.fillText(`${r.name || '?'}${App.layoutColumns().length > 1 ? ' [' + columnName(App.layoutColumns().find(c => c.id === App.rowColumn(r))) + ']' : ''}`, last[0] * sc + 6, top + last[1] * sc + fs * 0.7); }
      });
      y0 += heights[k];
    });
    c.toBlob(bl => G.Export.download(bl, 'uncropped_originals.png'), 'image/png');
    toast(L(`已导出未裁切原图（${pages.length} 张）`, `Exported the uncropped originals (${pl(pages.length, 'picture')})`));
  }
  function exportQuant() {
    const lines = [];
    App.layoutColumns().forEach(column => {
    const st = App.columnData(column.id), C = App.columns(column.id), fl = C.vis;
    if (!C.rows.length) return;
    if (App.layoutColumns().length > 1) lines.push(['layout column', column.id, columnName(column)]);
    const data = C.rows.map((r, ri) => {
      const b = App.blot(r.blot), rec = App.images.get(r.img);
      // (in the box's own frame: a tilted box is read along its tilt, as in the figure)
      const lanes = C.src[ri].map(s => s && s.pc && { F: App.segFrame(s.pc, s.sg), uc: s.u, hw: App.segPitch(s.sg) * 0.33,
        vTop: s.sg.vc - App.boxAbove(r, s.sg), vBot: s.sg.vc + App.boxBelow(r, s.sg), b0: s.sg.vc + s.sg.b0, b1: s.sg.vc + s.sg.b1 });
      return { r, b, rec, d: WB.densitometry(rec.img, rec.cs, lanes) };
    });
    const head = ['protein', 'membrane', 'exposure'].concat(fl.map(j => st.lanes[j - 1].name || 'lane ' + j));
    lines.push(head);
    data.forEach(x => lines.push([x.r.name || '?', App.blotNameEn(x.b), App.expoLabel(x.rec)].concat(x.d.map(v => (v ? v.volume.toFixed(2) + (v.saturated ? ' (SAT)' : '') : '')))));
    // normalized to a same-membrane loading control, then to the first lane
    const ctrls = data.filter(x => App.isLoading(x.r));
    data.filter(x => !App.isLoading(x.r)).forEach(x => {
      const c = ctrls.find(c => c.b === x.b); if (!c) return;
      const ratio = x.d.map((v, i) => (v && c.d[i] ? v.volume / Math.max(1e-9, c.d[i].volume) : null)), r0 = ratio.find(v => v) || 1;
      lines.push([`${x.r.name}/${c.r.name} (rel. lane 1)`, App.blotNameEn(x.b), ''].concat(ratio.map(v => (v == null ? '' : (v / r0).toFixed(3)))));
    });
    lines.push([]); });
    lines.push(['Volumes = sum of (pixel - local background) over the band, on the exposure shown in the figure. SAT = saturated pixels: do not quantify.']);
    const csv = lines.map(l => l.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
    G.Export.download(new Blob(['﻿' + csv], { type: 'text/csv' }), 'blot_quantification.csv');
    toast(L('已导出定量 CSV（用于参考；正式定量请用 ≥3 次独立实验）', 'Exported the densitometry CSV (for reference; quantify from ≥3 independent experiments)'), 3600);
  }

  G.UI = { focusProtein, finishImages: async () => { if(App.reviewReturnStep>=3 && S().blots.every(b=>b.boxesReady)) {await App.ensurePrepared(); S().step=Math.max(S().step,App.reviewReturnStep);App.commit();openStep(App.reviewReturnStep);}else await nextStep(1);}, addFiles, markerPopover, flushPending: async () => { if(edit)closeEd(false);closePop(true);if(App.mode==='pieces'){const b=App.blot(App.viewBlot),pcs=G.View.piecesEnd(true);await new Promise(resolve=>applyPieces(b,pcs,false,resolve));if(App.curStep===2)G.View.piecesStart();}if(S())App.commit();}, toast, editRowName, openEd, markPicker, openStep, nextStep, lastFig: () => lastFig, preflight,
    textEditing:{target:textTarget,get current(){return edit;},get box(){return edBox();},close:closeEd,refresh(){syncBar();placeBar();}},
    piecesChanged: () => { $('stPieces').textContent = L('已修改：切换步骤时保存', 'Changed: saved when switching tools'); } };

  const qs = new URLSearchParams(location.search);
  const scripted = !!(qs.get('demo') === '1' || qs.get('srcdir') || qs.get('demomove'));

  /* ---------- the draft of last time (offered on the start screen, as GelFigure) ---------- */
  async function offerDraft() {
    if (scripted && !qs.get('draft')) return;
    const d = await App.peekDraft();
    if (!d || S()) return;
    const s = d.summary || {};
    const ni = s.images || '?', nb = s.membranes || '?', names = s.names && s.names.length ? s.names : null;
    $('draftName').textContent = L(`${ni} 张图 · ${nb} 个图片组${s.rows ? ` · ${s.rows} 个蛋白` : ''}${names ? '（' + names.join('、') + '）' : ''}`,
      `${pl(ni, 'picture')} · ${pl(nb, 'image group')}${s.rows ? ` · ${pl(s.rows, 'protein')}` : ''}${names ? ' (' + names.join(', ') + ')' : ''}`);
    $('draftTime').textContent = L('保存于 ', 'Saved ') + new Date(d.savedAt).toLocaleString(G.I18N && G.I18N.lang === 'en' ? 'en' : 'zh-CN');
    $('draftBox').classList.remove('hidden');
  }
  $('btnDraftRestore').onclick = async () => {
    try { await App.restoreDraft(); toast(L('已恢复上次的进度', 'Restored your last session')); } catch (e) { alert(L('恢复失败：', 'Could not restore: ') + e.message); }
  };
  $('btnDraftDrop').onclick = async () => { await App.dropDraft(); $('draftBox').classList.add('hidden'); };
  offerDraft();

  /* ---------- storage blocked or full (as GelFigure): editing goes on, a note says what is not kept ---------- */
  function storageNotice() {
    document.querySelectorAll('.storage-note').forEach(el => el.classList.toggle('hidden', G.PrefStorage.persistent));
  }
  window.addEventListener('blotfigure-storage-unavailable', storageNotice);
  G.PrefStorage.getItem('blotfig.lang');       // (a blocked storage shows on the first read)
  storageNotice();
  // opened as the downloaded file: the offline download is what is open already
  if (location.protocol === 'file:') $('offlineDownload').hidden = true;
  $('helpVersion').textContent = 'BlotFigure ' + App.VERSION;

  /* ---------- dev params ---------- */
  if (scripted) setTimeout(async () => {
    App.forceJsHash = true;                   // (WebCrypto runs off the virtual clock of headless test runs)
    App.noDraft = !qs.get('draft');           // (scripted runs leave no draft unless asked: &draft=1)
    if (qs.get('noalign') === '1') App.devNoAlign = true;
    if (qs.get('nochemi') === '1') App.devNoChemi = true;      // (strips and ladder lanes without the exposures' check)
    if (qs.get('dbg') === '1') App._dbg = [];
    // &move=a.tif:2.5,140,85;b.tif:…  the membrane as if moved before those pictures (degrees, px)
    if (qs.get('move')) {
      App.devMove = {};
      qs.get('move').split(';').forEach(s => { const [n, v] = s.split(':'), [a, tx, ty] = v.split(',').map(Number); App.devMove[n] = { a, tx, ty }; });
    }
    if (qs.get('demomove')) {
      // the cut demo membrane and a later capture of it (an exposure and its white-light photo): the membrane
      // moved as a whole, its middle strip on its own as well (&demomove=a,tx,ty,a2,tx2,ty2)
      const s = G.WBDemo.cutSession(), [a, tx, ty, a2, tx2, ty2] = qs.get('demomove').split(',').map(Number);
      const T = { a, tx, ty }, T2 = WB.regCompose({ a: a2, tx: tx2, ty: ty2 }, T), W = s.images[0].width, H = s.images[0].height;
      const st = { cx: 734, cy: 503, angle: -0.4, w: 1000, h: 250 }, inside = (F, x, y) => { const [u, v] = WB.toFrame(F, x, y); return Math.abs(u) <= st.w / 2 && Math.abs(v) <= st.h / 2; };
      // the strip leaves empty tray where it lay: cut out, the rest moved, the strip put at its new place
      const later = [2, 3].map(k => {
        const im = s.images[k], bg = WB.classify({ w: W, h: H, data: im.data }, { name: im.name }) === 'marker' ? 3 : 50;
        const fill = G.Engine.percentiles(im.data, [bg], 97)[0], F0 = WB.frame(st.cx, st.cy, st.angle), cut = Float32Array.from(im.data);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(F0, x, y)) cut[y * W + x] = fill;
        const out = WB.regWarp({ w: W, h: H, data: cut }, WB.regInverse(T), [], fill), piece = WB.regWarp({ w: W, h: H, data: im.data }, WB.regInverse(T2), [], fill);
        const g = WB.regFrame(T2, W, H, st), F1 = WB.frame(g.cx, g.cy, g.angle);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(F1, x, y)) out[y * W + x] = piece[y * W + x];
        return { width: W, height: H, data: out, name: im.name.replace('.tif', '_later.tif') };
      });
      await addFiles(G.WBDemo.files(s).concat(later.map(im => ({ name: im.name, buffer: G.WBDemo.encodeTiff16(im) }))));
    } else if (qs.get('srcdir')) {
      const list = qs.get('srcs').split(','), files = [];
      for (const n of list) files.push({ name: n, buffer: await (await fetch(qs.get('srcdir') + '/' + n)).arrayBuffer() });
      await addFiles(files);
    } else await loadDemo();
    let st = S();
    // scripted runs go through the steps at once — the Marker pictures and pieces as found, the boxes made —
    // and open the boxes' step (&step=1|2|3|4: stop at that step)
    const stopAt = Math.max(1, Math.min(5, +qs.get('step') || 5));
    if (stopAt >= 2) { st.step = 2; await App.ensurePrepared(); }
    if (stopAt >= 3) App.makeBoxes();
    st.step = stopAt; App.curStep = Math.min(stopAt, 3);
    if (stopAt === 1) { const b = st.blots[0]; if (b && b.marker) App.viewImg = b.marker; }
    App.commit(); App.hist = App.hist.slice(-1);          // (undo starts from here)
    if (stopAt === 2) openStep(2);
    if (qs.get('ladder')) { st.blots.forEach(b => { b.ladderId = qs.get('ladder'); }); App.commit(); }
    if (qs.get('sel')) { const vis = st.rows.filter(r => !r.hidden), r = vis[+qs.get('sel')]; if (r) { App.selRow = r.id; App.viewBlot = r.blot; App.viewImg = r.img; App.emit('select'); } }
    if (qs.get('border') === '1') { st.style.border = true; App.commit(); }
    // &selpiece=B: of the selected row, the box on piece B gets the lane tools
    if (qs.get('selpiece') && App.selRow) { const r = App.row(App.selRow), sg = r && r.segs.find(s => (App.findPiece(s.piece) || { pc: {} }).pc.letter === qs.get('selpiece')); if (sg) { App.selSeg = App.boxId(sg); App.emit('select'); } }
    if (qs.get('zoomsel') === '1' && App.selRow) G.View.fitRow(App.row(App.selRow));
    // &mode=marks (&markpiece=D: zoomed to piece D) / addrow
    if (qs.get('mode') === 'marks') { const b = App.blot(App.viewBlot) || st.blots[0]; startMarks(b, qs.get('markpiece') && (b.pieces || []).find(p => p.letter === qs.get('markpiece'))); }
    else if (qs.get('mode') === 'pieces') startPieces(App.blot(App.viewBlot) || st.blots[0]);
    else if (qs.get('mode')) App.setMode(qs.get('mode'));
    if (qs.get('scrollto') && $(qs.get('scrollto'))) $(qs.get('scrollto')).scrollIntoView({ block: 'center' });
    // &popimg=12: the ⋯ menu of the picture whose name starts so; &alignimg=12: aligning it by hand (&alignby=dx,dy,deg)
    const byStart = p => [...App.images.values()].find(r => r.name.startsWith(p));
    if (qs.get('popimg')) openStep(1);
    if (qs.get('popimg') && byStart(qs.get('popimg'))) {
      const rec = byStart(qs.get('popimg')), th = [...document.querySelectorAll('#blotList .thumb')].find(t => t.title.startsWith(rec.name));
      if (th) th.querySelector('.more').click();
    }
    if (qs.get('alignimg') && byStart(qs.get('alignimg'))) {
      const rec = byStart(qs.get('alignimg')), b = st.blots.find(x => x.images.includes(rec.id));
      App.viewBlot = b.id; App.viewImg = rec.id; App.alignImg = rec.id; App.emit('select'); G.View.fitFull();
      App.setMode('align'); G.View.alignStart(rec.id);
      if (qs.get('alignby')) {
        const [dx, dy, deg] = qs.get('alignby').split(',').map(Number), cv = $('editor'), R = cv.getBoundingClientRect();
        const ev = (type, x, y, opt) => (type === 'mousedown' ? cv : window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: R.left + x, clientY: R.top + y, bubbles: true }, opt)));
        const s = G.View.probeScale ? G.View.probeScale() : 1, x0 = R.width / 2, y0 = R.height / 2;
        ev('mousedown', x0, y0); ev('mousemove', x0 + dx * s / 2, y0 + dy * s / 2); ev('mousemove', x0 + dx * s, y0 + dy * s);
        if (!qs.get('alignhold')) ev('mouseup', x0 + dx * s, y0 + dy * s);
        if (deg) { $('editorBox').focus(); for (let k = 0; k < Math.abs(deg) * 10; k++) $('editorBox').dispatchEvent(new KeyboardEvent('keydown', { key: deg > 0 ? ']' : '[', bubbles: true })); }
      }
    }
    // scripted checks of the editing functions (tests): a log of every row's boxes (piece:first column:lane
    // roles), its figure columns and size after each step
    const scen = qs.get('scenario'), log = [];
    if (scen) window.confirm = () => true;      // (scripted: every question answered yes — a headless browser blocks on them)
    const letter = id => (App.findPiece(id) || { pc: {} }).pc.letter;
    const segStr = r => r.segs.map(s => `${letter(s.piece)}:${s.c0}:${s.lanes.map(l => l.r).join('')}`).join('+');
    const snap = tag => log.push(`${tag} | ` + S().rows.map(r => `${segStr(r)}[${App.figLanes().filter(j => App.colSource(r, j)).join(',')}]${r.hidden ? 'h' : ''}~${Math.round(App.rowKda(r) || 0)}`).join(' '));
    // mouse events on the figure preview
    const pv = $('preview'), vis = () => S().rows.filter(r => !r.hidden);
    const imgOf = (id, piece) => pv.querySelector(`image[data-row="${id}"]${piece ? `[data-piece="${piece}"]` : ''}`);
    const ctr = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const fire = (type, [x, y], target, opt) => (target || window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: x, clientY: y, bubbles: true }, opt)));
    const hold = (el, to, opt) => { const a = ctr(el); fire('mousedown', a, el, opt); fire('mousemove', [(a[0] + to[0]) / 2, (a[1] + to[1]) / 2], null, opt); fire('mousemove', to, null, opt); };
    const pull = (el, to, opt) => { hold(el, to, opt); fire('mouseup', to, null, opt); fire('click', to, el, opt); };
    const onPiece = l => vis().find(r => r.segs.some(s => letter(s.piece) === l));
    const laneW = () => lastFig.laneW * prevScale;
    if (scen === 'stitch') {
      snap('start');
      App.splitRow(S().rows[0]); App.commit(); snap('split');
      snap('join:' + App.mergeRows(S().rows[0], S().rows[1])); App.commit(); snap('joined');
      // never one row: the piece below on the same lanes (C), two bands of one piece (C + C)
      const onC = S().rows.filter(r => r.segs.some(s => letter(s.piece) === 'C'));
      snap('onto C:' + App.mergeRows(S().rows[0], onC[0]));
      snap('C+C:' + App.mergeRows(onC[0], onC[1])); App.commit(); snap('after refusals');
    }
    if (scen === 'arrange') {
      // the figure arranged by mouse: rows dragged up / down, onto each other, by their tags and the list grip;
      // a piece's lanes dragged left / right (with Alt one box), past column 1
      const said = () => { const t = $('toasts').lastElementChild; return t ? t.textContent.slice(0, 16) : ''; };
      const order = tag => log.push(`${tag} | ` + vis().map(r => `${segStr(r)}~${Math.round(App.rowKda(r) || 0)}`).join(' ') + ` | lanes=${S().lanes.length} range=${S().range.join('-')} | ${said()}`);
      order('start');
      const top = imgOf(vis()[0].id).getBoundingClientRect(), low = vis()[vis().length - 1];
      pull(imgOf(low.id), [ctr(imgOf(low.id))[0], top.top - 4]); order('last to top');
      // piece C a column right — both of its rows follow (one is hidden) — and back; with Alt only one box
      const cr = onPiece('C'), cp = cr.segs[0].piece;
      let el = imgOf(cr.id, cp), a = ctr(el); pull(el, [a[0] + 1.3 * laneW(), a[1]]); snap('C +1');
      el = imgOf(cr.id, cp); a = ctr(el); pull(el, [a[0] - 1.3 * laneW(), a[1]]); snap('C -1');
      el = imgOf(cr.id, cp); a = ctr(el); pull(el, [a[0] + 2.3 * laneW(), a[1]], { altKey: true }); snap('C box +2 (Alt)');
      App.undo(); snap('undo');
      // D two columns left: at column 1 already — nothing moves, no other row is pushed aside; C three columns
      // left: as far as column 1 (two)
      S().lanes[0].name = 'L1'; App.commit();
      const dr = onPiece('D'), dp = dr.segs[0].piece;
      el = imgOf(dr.id, dp); a = ctr(el); pull(el, [a[0] - 2.3 * laneW(), a[1]]); order('D -2'); log.push('names ' + S().lanes.map(l => l.name || '.').join(','));
      const c3 = onPiece('C'); el = imgOf(c3.id, c3.segs[0].piece); a = ctr(el); pull(el, [a[0] - 3.3 * laneW(), a[1]]); order('C -3');
      App.undo(); App.undo(); order('undo x2');
      // C's row dropped on D's: refused (stacked); the first row to the bottom by its tag
      el = imgOf(onPiece('C').id); const dRect = imgOf(onPiece('D').id).getBoundingClientRect();
      pull(el, [ctr(el)[0], dRect.top + dRect.height / 2]); order('C onto D');
      const tag = pv.querySelector(`.prev-ov .rowtag[data-row="${vis()[0].id}"]`), bot = imgOf(vis()[vis().length - 1].id).getBoundingClientRect();
      pull(tag, [ctr(tag)[0], bot.bottom + 8]); order('first to bottom by tag');
      // A+B split, then B's row dropped onto A's: side by side again
      App.splitRow(vis().find(r => r.segs.length > 1)); App.commit(); order('split A+B');
      const aRect = imgOf(onPiece('A').id).getBoundingClientRect();
      el = imgOf(onPiece('B').id); pull(el, [ctr(el)[0], aRect.top + aRect.height / 2]); order('B onto A');
      // the list grip: the second shown row to the top, the first to the end
      const shown = () => [...$('rowList').querySelectorAll('.row-item')].filter(it => !App.row(it.dataset.id).hidden);
      let it = shown(), grip = it[1].querySelector('.grip'), g = ctr(grip), y0 = it[0].getBoundingClientRect().top + 2;
      fire('mousedown', g, grip); fire('mousemove', [g[0], y0]); fire('mouseup', [g[0], y0]); order('list: 2nd to top');
      const all = [...$('rowList').querySelectorAll('.row-item')], yEnd = all[all.length - 1].getBoundingClientRect().bottom + 6;
      it = shown(); grip = it[0].querySelector('.grip'); g = ctr(grip);
      fire('mousedown', g, grip); fire('mousemove', [g[0], yEnd]); fire('mouseup', [g[0], yEnd]); order('list: 1st to end');
      // Alt+↑ / Alt+↓ on the selected row
      App.selRow = vis()[1].id; App.emit('select');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })); order('Alt+Up on 2nd');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })); order('Alt+Down x2');
    }
    if (scen === 'realign') {
      // aligning exposure 12 by hand: drag, turn with keys, finish; undo / redo resample it again; as taken; automatic
      const rec = byStart('12'), b = st.blots.find(x => x.images.includes(rec.id)), cv = $('editor');
      const al = tag => { const a = App.alignOf(rec.id); let s = 0; for (let i = 0; i < rec.cs.sig.length; i += 9973) s += rec.cs.sig[i];
        log.push(`${tag} | ${a ? `${a.how} ${a.a.toFixed(2)},${a.tx.toFixed(1)},${a.ty.toFixed(1)}` : 'none'} | raw ${rec.raw ? 'kept' : 'none'} sig ${s.toFixed(3)} | rows ${S().rows.length}`); };
      al('auto');
      App.viewBlot = b.id; App.viewImg = rec.id; App.alignImg = rec.id; App.emit('select'); G.View.fitFull();
      App.setMode('align'); G.View.alignStart(rec.id);
      const R = cv.getBoundingClientRect(), s = G.View.probeScale(), x0 = R.width / 2, y0 = R.height / 2;
      const ev = (type, x, y) => (type === 'mousedown' ? cv : window).dispatchEvent(new MouseEvent(type, { clientX: R.left + x, clientY: R.top + y, bubbles: true }));
      ev('mousedown', x0, y0); ev('mousemove', x0 + 30 * s, y0 + 15 * s); ev('mousemove', x0 + 60 * s, y0 + 30 * s); ev('mouseup', x0 + 60 * s, y0 + 30 * s);
      al('dragged +60,+30');
      $('editorBox').focus();
      for (let k = 0; k < 10; k++) $('editorBox').dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      $('editorBox').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
      App.setMode(null); al('turned +1°, left 10, done');
      App.undo(); al('undo'); App.undo(); al('undo x2'); App.redo(); al('redo');
      App.setMode('align'); G.View.alignStart(rec.id); $('vmNone').click(); App.setMode(null); al('as taken');
      App.autoAlign(rec.id); App.commit(); al('automatic again');
    }
    if (scen === 'kind') {
      // what the user arranged survives a fresh analysis: a picture's kind changed and back, an exposure moved
      // to a membrane of its own and back, the alignment run again (each step: every box, its lanes, columns)
      const sig = () => S().rows.map(r => `${segStr(r)}@${r.segs.map(s => `${letter(s.piece)}${Math.round(App.rowXY(r)[1])}:${Math.round(s.x0)}..${Math.round(s.x1)}`).join('+')}[${App.figLanes().filter(j => App.colSource(r, j)).join(',')}]${r.name ? '"' + r.name + '"' : ''}`).join(' ');
      const row = vis()[vis().length - 1], sg = row.segs[0];
      App.editLanes(row, sg, () => App.setBox(row, sg, sg.x0 + App.segPitch(sg), sg.x1)); row.name = 'edited'; App.commit();
      log.push('edited | ' + sig());
      const pcs = () => S().blots[0].pieces.map(p => `${p.letter}${Math.round(p.cx)},${Math.round(p.cy)}/${Math.round(p.w)}x${Math.round(p.h)}`).join(' ');
      const step = (tag, fn) => {
        if (qs.get('dbgpcs')) WB.findStrips.vetoLog = [];
        fn(); App.commit(); log.push(`${tag} | ${sig()}`);
        if (qs.get('dbgpcs')) { log.push(`  pieces ${pcs()}`); WB.findStrips.vetoLog.forEach(v => log.push('  line ' + JSON.stringify(v))); WB.findStrips.vetoLog = null; }
      };
      step('09 as white light', () => App.setKind(byStart('09').id, 'marker'));
      step('09 back', () => App.setKind(byStart('09').id, 'chemi'));
      step('01 as exposure', () => App.setKind(byStart('01').id, 'chemi'));
      step('01 back', () => App.setKind(byStart('01').id, 'marker'));
      step('14 to a new membrane', () => App.moveImage(byStart('14').id, 'new'));
      step('14 back', () => App.moveImage(byStart('14').id, S().blots[0].id));
      step('aligned again', () => App.autoAlign(byStart('12').id));
      step('removed 07', () => App.removeImage(byStart('07').id));
      log.push('blots ' + S().blots.map(b => b.images.length).join('/'));
    }
    if (scen === 'lanes') {
      // lane edits of one box (the lowest visible row): resize, re-detect, even spacing, add / switch / remove
      // a lane, move its columns, and in a stitched row the box to the right follows
      // (fetched again for every step: undo replaces the state objects)
      const vis = () => S().rows.filter(r => !r.hidden), R = () => vis()[vis().length - 1], Sg = () => R().segs[0];
      const p = App.segPitch(Sg()), x1 = Sg().x1;
      const base = sg => ({ lanes: JSON.parse(JSON.stringify(sg.lanes)), c0: sg.c0, p: sg.p });
      const ed = (tag, fn) => { const row = R(), sg = row.segs[0]; App.editLanes(row, sg, () => fn(row, sg)); App.commit(); snap(tag); };
      snap('start');
      ed('shrink 2', (row, sg) => App.setBox(row, sg, sg.x0, x1 - 2 * p, base(sg)));
      ed('grow 2', (row, sg) => App.setBox(row, sg, sg.x0, x1, base(sg)));
      ed('left -1', (row, sg) => App.setBox(row, sg, sg.x0 + p, sg.x1, base(sg)));
      ed('left +1', (row, sg) => App.setBox(row, sg, sg.x0 - p, sg.x1, base(sg)));
      ed('redetect', (row, sg) => App.redetectBox(row, sg));
      ed('even 4', (row, sg) => App.evenBox(row, sg, 4));
      App.undo(); snap('undo');
      ed('cycle 0', (row, sg) => App.cycleLane(sg, 0));
      ed('cycle 0 again', (row, sg) => App.cycleLane(sg, 0));
      ed('cycle 0 back', (row, sg) => App.cycleLane(sg, 0));
      ed('remove 1', (row, sg) => App.removeLane(row, sg, 1));
      ed('add at 1', (row, sg) => App.addLane(row, sg, (sg.lanes[0].u + sg.lanes[1].u) / 2));
      App.shiftCols(R(), Sg(), 1); App.commit(); snap('shift +1');
      App.shiftCols(R(), Sg(), -1); App.commit(); snap('shift -1');
      // the stitched row: its left box loses a lane, the right one moves up a column with it
      const st2 = vis().find(r => r.segs.length > 1);
      if (st2) {
        const a = st2.segs[0], ba = { lanes: JSON.parse(JSON.stringify(a.lanes)), c0: a.c0, p: a.p };
        App.editLanes(st2, a, () => App.setBox(st2, a, a.x0 + App.segPitch(a), a.x1, ba)); App.commit(); snap('stitched left -1');
        App.undo(); snap('undo');
      }
    }
    if (scen === 'detect') {
      // lanes read from each row's box alone, in every exposure: the box as it is, and a sloppy box over the
      // whole piece width (margins and neighbouring smears included)
      S().rows.forEach(r => r.segs.forEach(sg => {
        const pc = App.pieceOf(r, sg), out = [];
        App.chemiOf(App.blot(r.blot)).forEach(rec => {
          ['tight', 'loose'].forEach(kind => {
            const t = JSON.parse(JSON.stringify(sg));
            if (kind === 'loose') { t.x0 = -pc.w / 2; t.x1 = pc.w / 2; }
            const n = App.redetectBox(r, t, rec.id);
            out.push(`${kind[0]}${App.expoLabel(rec).slice(0, 2)}:${n ? t.lanes.map(l => l.r).join('') : '-'}`);
          });
        });
        log.push(`${letter(sg.piece)}~${Math.round(App.rowKda(r) || 0)} had ${sg.lanes.map(l => l.r).join('')} | ${out.join(' ')}`);
      }));
    }
    if (scen === 'drag') {
      // the gestures on the membrane view as mouse / key events: resize a box by its handles, drag a lane,
      // double-click a lane in, delete it, move the box, draw a new box
      const row = S().rows.filter(r => !r.hidden).slice(-1)[0], sg = row.segs[0];
      App.selRow = row.id; App.selSeg = App.boxId(sg); App.viewBlot = row.blot; App.viewImg = row.img; App.emit('select'); G.View.fitFull();
      const cv = $('editor'), R = cv.getBoundingClientRect();
      const ev = (type, [x, y], opt) => (type === 'mousedown' || type === 'dblclick' ? cv : window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: R.left + x, clientY: R.top + y, bubbles: true }, opt)));
      const pull = (a, b2, opt) => { ev('mousedown', a, opt); ev('mousemove', [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2], opt); ev('mousemove', b2, opt); ev('mouseup', b2, opt); };
      const geo = tag => snap(`${tag} box=${Math.round(sg.x0)}..${Math.round(sg.x1)} h=${Math.round(row.above)}+${Math.round(row.below)} vc=${Math.round(sg.vc)}`);
      geo('start');
      let pr = G.View.probe(row, sg); const lp = App.segPitch(sg) * pr.scale;
      pull(pr.handles.e, [pr.handles.e[0] - 2.2 * lp, pr.handles.e[1]]); geo('e -2 lanes');
      pr = G.View.probe(row, sg); pull(pr.handles.e, [pr.handles.e[0] + 2.2 * lp, pr.handles.e[1]]); geo('e +2 lanes');
      pr = G.View.probe(row, sg); pull(pr.handles.nw, [pr.handles.nw[0] + 1.2 * lp, pr.handles.nw[1] - 15]); geo('nw corner');
      pr = G.View.probe(row, sg); pull(pr.lanes[0], [pr.lanes[0][0] + 0.2 * lp, pr.lanes[0][1]]); geo('lane 0 dragged');
      pr = G.View.probe(row, sg); const mid = [(pr.lanes[0][0] + pr.lanes[1][0]) / 2, pr.lanes[0][1]];
      ev('mousedown', mid); ev('mouseup', mid); ev('dblclick', mid); geo('dblclick add');
      $('editorBox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); geo('Delete lane');
      // grab the box between two lanes and pull it down
      pr = G.View.probe(row, sg); const ctr = [(pr.lanes[1][0] + pr.lanes[2][0]) / 2, pr.lanes[1][1]];
      pull(ctr, [ctr[0], ctr[1] + 12]); geo('moved down');
      // a new row from a box drawn on the top piece
      const top = S().rows.filter(r => !r.hidden)[0], ts = top.segs[top.segs.length - 1];
      App.selRow = top.id; App.emit('select');
      pr = G.View.probe(top, ts);
      App.setMode('addrow');
      pull([pr.handles.sw[0] + 0.1 * lp, pr.handles.sw[1] + 25], [pr.handles.se[0] - 0.1 * lp, pr.handles.se[1] + 70]);
      geo('drawn box');
    }
    if (scen === 'marks') {
      // sizes from the user's marks alone: none at first, one mark is not enough, two give the rows on the piece
      // theirs; a size changed; the membrane's marks cleared
      const b2 = S().blots[S().blots.length - 1], pc = b2.pieces[0], r = S().rows.find(r => r.segs.some(s => s.piece === pc.id));
      snap('start');
      const sg = r.segs.find(s => s.piece === pc.id), marks = App.manualMarks(b2, pc), u = App.ladderU(pc);
      marks.push({ u, v: sg.vc - 30, kda: 100 }); App.commit(); snap(`one mark ${App.markInfo(b2, pc).state}`);
      marks.push({ u, v: sg.vc + 30, kda: 55 }); App.commit(); snap(`two marks ${App.markInfo(b2, pc).state}`);
      marks[0].kda = 130; App.commit(); snap('edit 100->130');
      App.clearMarks(b2); App.commit(); snap(`cleared ${App.markInfo(b2, pc).state}`);
    }
    if (scen === 'mark2') {
      // marking with the mouse and keys, nothing read from the picture beforehand: the ladder picked (and kept for
      // membranes loaded later); a piece's chip zooms to it; a click 3 px off a band puts a mark on the band, no
      // size suggested for the first; the second gets the ladder's next size; only then the other sizes show
      // where expected; a mark dragged snaps onto a band (Alt: not); "不加了"; a size typed in; a mark deleted
      // from its picker; ↓ / Shift+↓ / Delete; a predicted size clicked in; on to step 5; the marks cleared
      // (canvas px: the canvas moves when the levels bar comes and goes)
      const B = () => S().blots[0], cv = $('editor');
      const ev = (type, [x, y], opt) => { const R = cv.getBoundingClientRect(); (type === 'mousedown' ? cv : window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: R.left + x, clientY: R.top + y, bubbles: true }, opt))); };
      const pull = (a, dy, opt) => { ev('mousedown', a, opt); ev('mousemove', [a[0], a[1] + dy / 2], opt); ev('mousemove', [a[0], a[1] + dy], opt); ev('mouseup', [a[0], a[1] + dy], opt); };
      const key = (k, opt) => $('editorBox').dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, opt)));
      const states = () => B().pieces.map(pc => `${pc.letter}:${App.markInfo(B(), pc).state}`).join(' ');
      const pcId = (B().pieces.find(p => p.ladderUs && p.ladderUs.length) || B().pieces[0]).id, P = () => App.piece(B(), pcId);
      const mk = () => (P().marks && P().marks.length ? P().marks.map(m => `${m.kda}@${Math.round(m.v)}`).join(',') : 'none');
      const coach = () => $('coachText').textContent.replace(/\s+/g, ' ').slice(0, 30);
      const shown = () => { const ms = G.View.probeMarks(P()); return `${ms.filter(m => m.manual).length} set, predicted ${ms.filter(m => m.predicted).map(m => m.k).join('/') || '-'}`; };
      const sugg = () => { const o = pop.querySelector('.kda-grid button.on'); return o ? o.dataset.k : '-'; };
      openStep(4);
      log.push(`start | ${states()} | ${$('stMarker').textContent} | ${coach()}`);
      const lsel = $('markerPanel').querySelector('.ladder-sel');
      lsel.value = 'pr26619'; lsel.dispatchEvent(new Event('change', { bubbles: true }));
      const saved = G.PrefStorage.getItem('blotfig.ladder');
      log.push(`ladder | blot ${B().ladderId} pref ${App.prefLadder} saved ${saved} | ${coach()}`);
      $('markerPanel').querySelector(`.mk-chip[data-pc="${pcId}"]`).click();
      log.push(`chip ${P().letter} | mode ${App.mode} step ${App.curStep} focus ${App.markFocus === pcId} white ${App.viewImg === B().marker} zoom ${G.View.probeScale().toFixed(2)} | ${shown()}`);
      const u = App.ladderU(P()), at = v => { const s = G.View.scrOf(P(), u, v); return [s.x, s.y]; }, click = v => { ev('mousedown', at(v)); ev('mouseup', at(v)); };
      const peaks = App.ladderPeaks(B(), P(), u).filter(p => p.dark && p.prom > 0.3).map(p => p.v);
      log.push(`bands ${peaks.map(Math.round).join(',')}`);
      click(peaks[0] + 3);
      log.push(`click 1 | picker ${popOpen} suggested ${sugg()} | ${mk()}`);
      pop.querySelector('.kda-grid button[data-k="250"]').click();
      log.push(`picked 250 | ${App.markInfo(B(), P()).state} ${mk()} | ${shown()}`);
      click(peaks[1]);
      const s2 = sugg();
      pop.querySelector('#pKda').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      log.push(`click 2 suggested ${s2}, Enter | ${App.markInfo(B(), P()).state} ${mk()} | ${shown()}`);
      // dragged 9 px: back onto its band; Alt: where let go
      let m0 = G.View.probeMarks(P()).find(m => m.manual);
      pull(m0.pill, 9); log.push(`drag ${m0.k} +9px | ${mk()}`);
      m0 = G.View.probeMarks(P()).find(m => m.manual);
      pull(m0.pill, 7, { altKey: true }); log.push(`Alt drag +7px | ${mk()}`);
      App.undo(); log.push(`undo | ${mk()}`);
      // a click between the two, "不加了"; again with a size typed in, undone
      const ms = G.View.probeMarks(P()).filter(m => m.manual).sort((a, c) => a.v - c.v), mid = (ms[0].v + ms[1].v) / 2;
      click(mid);
      log.push(`click between | picker ${popOpen} suggested ${sugg()} ${pop.querySelector('#pNo') ? 'has 不加了' : ''}`);
      if (pop.querySelector('#pNo')) pop.querySelector('#pNo').click();
      log.push(`not added | ${mk()}`);
      click(mid);
      const inp = pop.querySelector('#pKda');
      inp.value = '180'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      log.push(`typed 180 | ${mk()} | picker ${popOpen}`);
      App.undo(); log.push(`undo | ${mk()}`);
      // the second mark deleted from its picker: one left, nothing predicted; undone
      const m1 = G.View.probeMarks(P()).filter(m => m.manual).sort((a, c) => a.v - c.v)[1];
      ev('mousedown', m1.pill); ev('mouseup', m1.pill);
      if (pop.querySelector('#pDelMark')) pop.querySelector('#pDelMark').click();
      log.push(`deleted ${m1.k} from the picker | ${App.markInfo(B(), P()).state} ${mk()} | ${shown()}`);
      App.undo(); log.push(`undo | ${mk()}`);
      // the top mark clicked (its size picker), closed; ↓ twice, Shift+↓; Delete; undone
      m0 = G.View.probeMarks(P()).filter(m => m.manual).sort((a, c) => a.v - c.v)[0];
      ev('mousedown', m0.pill); ev('mouseup', m0.pill);
      log.push(`clicked ${m0.k} | picker ${popOpen}`);
      closePop(); $('editorBox').focus();
      key('ArrowDown'); key('ArrowDown'); key('ArrowDown', { shiftKey: true });
      log.push(`down 1+1+5 | ${mk()}`);
      key('Delete'); log.push(`Delete | ${mk()} sel=${App.selMark ? 'yes' : 'none'}`);
      App.undo(); App.undo(); App.undo(); App.undo(); log.push(`undo x4 | ${mk()}`);
      // a predicted size clicked: added at the band nearest it
      const pr = G.View.probeMarks(P()).filter(m => m.predicted)[0];
      if (pr) { ev('mousedown', pr.pill); ev('mouseup', pr.pill); }
      log.push(`predicted ${pr ? pr.k + ' clicked' : 'none shown'} | ${mk()} | ${$('stMarker').textContent} | ${coach()}`);
      $('vmMkNext').click();
      log.push(`next | step ${S().step} open ${App.curStep} mode ${App.mode} | ${coach()}`);
      openStep(4);
      const cl = $('markerPanel').querySelector('.mk-clear');
      if (cl) cl.click();
      log.push(`cleared | ${states()} | ${$('stMarker').textContent}`);
    }
    if (scen === 'edit2') {
      // boxes free of the pieces, lanes by their ends, pieces by hand (mouse events on the membrane view)
      const cv = $('editor');
      const ev = (type, [x, y], opt) => { const R = cv.getBoundingClientRect(); (type === 'mousedown' ? cv : window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: R.left + x, clientY: R.top + y, bubbles: true }, opt))); };
      const pull = (a, b2, opt) => { ev('mousedown', a, opt); ev('mousemove', [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2], opt); ev('mousemove', b2, opt); ev('mouseup', b2, opt); };
      const B = () => S().blots[0], pcL = id => (App.piece(B(), id) || {}).letter;
      const segS = sg => `${pcL(sg.piece)} box ${Math.round(sg.x0)}..${Math.round(sg.x1)} lanes ${sg.lanes.map(l => Math.round(l.u)).join(',')}`;
      const img = (row, sg) => { const r = App.runRaster(row, sg, App.piece(B(), sg.piece), 0, sg.lanes.length - 1, 2); return `${r.w}x${r.h}`; };
      App.viewBlot = B().id; App.emit('select'); G.View.fitFull();
      // 1. a box drawn over the gap between pieces C and D (half on each): the figure shows the box as drawn
      const C = B().pieces.find(p => p.letter === 'C'), D = B().pieces.find(p => p.letter === 'D');
      const xs = [-200, 200].map(u => WB.toImg(WB.frame(C.cx, C.cy, C.angle), u, C.h / 2)), s0 = G.View.toScr(xs[0][0], xs[0][1] - 60), s1 = G.View.toScr(xs[1][0], xs[1][1] + 60);
      App.setMode('addrow'); pull([s0.x, s0.y], [s1.x, s1.y]);
      let row = App.row(App.selRow), sg = row.segs[0];
      log.push(`drawn over C|D gap | ${segS(sg)} | ${App.nSample(sg)} lanes, figure ${img(row, sg)} | drawn u ${Math.round(sg.x1 - sg.x0)} wide`);
      // 2. moved down onto D: the box belongs to D now, its pixels still shown
      App.selRow = row.id; App.selSeg = App.boxId(sg); App.emit('select');
      let pr = G.View.probe(row, sg); const mid = [(pr.lanes[0][0] + pr.lanes[1][0]) / 2, pr.lanes[0][1]];
      pull(mid, [mid[0], mid[1] + 120 * pr.scale]);
      row = App.row(App.selRow); sg = row.segs[0];
      log.push(`moved down | ${segS(sg)} | on D: ${sg.piece === D.id} figure ${img(row, sg)}`);
      // 3. the last lane dragged right by 40 px: the lanes between spread evenly; Alt: that lane alone
      pr = G.View.probe(row, sg); let lastLn = pr.lanes[pr.lanes.length - 1];
      pull(lastLn, [lastLn[0] + 40 * pr.scale, lastLn[1]]);
      row = App.row(App.selRow); sg = row.segs[0];
      log.push(`last lane +40 | ${segS(sg)}`);
      pr = G.View.probe(row, sg); lastLn = pr.lanes[pr.lanes.length - 1];
      pull(lastLn, [lastLn[0] + 40 * pr.scale, lastLn[1]], { altKey: true });
      row = App.row(App.selRow); sg = row.segs[0];
      log.push(`last lane +40 Alt | ${segS(sg)}`);
      App.evenEnds(row, sg, sg.lanes.length + 1); App.snapBox(sg); App.commit(); sg = App.row(App.selRow).segs[0];
      log.push(`evenEnds n+1 | ${segS(sg)}`);
      // 4. pieces by hand: C moved 30 px right, D's bottom edge up 20 px, a new piece drawn, E taken away, applied
      const geo = () => B().pieces.map(p => `${p.letter}${Math.round(p.cx)},${Math.round(p.cy)}/${Math.round(p.w)}x${Math.round(p.h)}@${p.angle}`).join(' ');
      const rowsAt = () => S().rows.filter(r => !r.hidden).map(r => r.segs.map(s => { const q = App.piece(B(), s.piece); return `${pcL(s.piece)}@${WB.toImg(WB.frame(q.cx, q.cy, q.angle), (s.x0 + s.x1) / 2, s.vc).map(Math.round).join(',')}`; }).join('+')).join(' ');
      log.push(`pieces before | ${geo()} | rows ${rowsAt()}`);
      App.selRow = null; App.emit('select');
      startPieces(B());
      const P = () => G.View.probePieces(), byL = l => P().find(p => p.letter === l);
      let c = byL('C').c; ev('mousedown', [c.x, c.y]); ev('mouseup', [c.x, c.y]);
      c = byL('C').c; pull([c.x, c.y], [c.x + 30 * G.View.probeScale(), c.y]);
      ev('mousedown', [byL('D').c.x, byL('D').c.y]); ev('mouseup', [byL('D').c.x, byL('D').c.y]);
      const hs = byL('D').handles.s; pull(hs, [hs[0], hs[1] - 20 * G.View.probeScale()]);
      const rt = byL('D').handles.rot; pull(rt, [rt[0] + 40, rt[1]]);
      log.push(`D turned to ${G.View.piecesSel().angle}°`);
      const E = byL('E'); ev('mousedown', [E.c.x, E.c.y]); ev('mouseup', [E.c.x, E.c.y]);
      $('editorBox').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      const R0 = cv.getBoundingClientRect(); pull([20, R0.height - 60], [120, R0.height - 20]);
      log.push(`editing | ${P().map(p => `${p.letter}${Math.round(p.w)}x${Math.round(p.h)}@${p.angle}`).join(' ')}`);
      $('vmPcNext').click();
      await new Promise(r => setTimeout(r, 400));
      log.push(`applied | mode ${App.mode} | ${geo()} | userStrips ${B().userStrips.length} | rows ${rowsAt()}`);
      App.undo(); log.push(`undo | ${geo()} | userStrips ${B().userStrips ? B().userStrips.length : 'none'}`);
      App.redo(); log.push(`redo | ${geo()}`);
    }
    if (scen === 'proj') {
      // a project saved and opened again: every row (boxes, lanes, columns, name, size, exposure), the marks,
      // the pieces by hand, the levels come back as they were
      const r0 = vis()[0], pc0 = S().blots[0].pieces[0]; r0.name = 'GAPDH'; App.manualMarks(S().blots[0], pc0).push({ u: 0, v: -50, kda: 100 }, { u: 0, v: 40, kda: 50 });
      Object.assign(App.addArrow(r0, r0.segs[0].vc), { sym: '*', side: 'left' }); App.commit();
      const sig = () => JSON.stringify({ rows: S().rows.map(r => [r.name, r.img && App.images.get(r.img).name, Math.round(App.rowKda(r) || 0), r.segs.map(s => [(App.findPiece(s.piece) || { pc: {} }).pc.letter, Math.round(s.vc), Math.round(s.x0), Math.round(s.x1), s.c0, s.lanes.map(l => Math.round(l.u) + l.r).join('')])]),
        marks: S().blots[0].pieces.map(p => p.letter + ':' + (p.marks || []).map(m => m.kda + '@' + Math.round(m.v)).join(',')), levels: S().levels, range: S().range,
        arrows: S().arrows.map(a => [App.row(a.row) && App.row(a.row).name, a.db, a.sym, a.side]) });
      const before = sig(), t0 = performance.now();
      await G.UI.flushPending(); const blob = await App.saveProject();
      log.push(`saved ${(blob.size / 1048576).toFixed(1)} MB`);
      await App.openProject(blob);
      const after = sig();
      log.push(`opened | same: ${before === after}${before === after ? '' : '\n  before ' + before + '\n  after  ' + after}`);
    }
    if (scen === 'perf') {
      // what a drag costs: a box's right edge pulled across 20 mouse moves (membrane view, figure, checks)
      const row = vis()[0], sg = row.segs[0];
      App.selRow = row.id; App.selSeg = App.boxId(sg); App.viewBlot = row.blot; App.viewImg = row.img; App.emit('select'); G.View.fitFull();
      const cv = $('editor'), R = cv.getBoundingClientRect();
      const ev = (type, [x, y]) => (type === 'mousedown' ? cv : window).dispatchEvent(new MouseEvent(type, { clientX: R.left + x, clientY: R.top + y, bubbles: true }));
      // (window.__perfRun: run again from outside, e.g. under a profiler)
      const run = () => {
        const pr = G.View.probe(row, sg), a = pr.handles.e, T = () => performance.now(), t = {};
        const time = (k, fn) => { const t0 = T(); fn(); t[k] = (t[k] || 0) + T() - t0; };
        ev('mousedown', a);
        for (let k = 1; k <= 20; k++) {
          time('move', () => ev('mousemove', [a[0] - k * 3, a[1]]));
          time('preview', () => updatePreview());
        }
        ev('mouseup', [a[0] - 60, a[1]]);
        App.undo();
        return 'ms per move: ' + Object.entries(t).map(([k, v]) => `${k} ${(v / 20).toFixed(1)}`).join(' · ');
      };
      window.__perfRun = run;
      log.push(run());
    }
    if (scen === 'focus') {
      // typing a protein name in the list: the field keeps the focus while the row gets selected
      const inp = $('rowList').querySelectorAll('.row-item input')[1], id = inp.closest('.row-item').dataset.id;
      inp.focus();
      const a = document.activeElement, still = a && a.tagName === 'INPUT' && a.closest('.row-item') && a.closest('.row-item').dataset.id === id;
      log.push(`focused: ${still ? 'kept' : 'lost (' + (a ? a.tagName : '-') + ')'} sel=${App.selRow === id}`);
      if (still) { a.value = 'TestName'; a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true })); }
      const where = () => { const f = document.activeElement, it = f && f.tagName === 'INPUT' && f.closest('.row-item'); return it ? 'row ' + S().rows.findIndex(r => r.id === it.dataset.id) : 'lost (' + (f ? f.tagName : '-') + ')'; };
      log.push(`name: ${(App.row(id) || {}).name || '-'} | focus ${where()}`);
      // Enter: on to the next row's field
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      log.push(`after Enter: focus ${where()} sel=${S().rows.findIndex(r => r.id === App.selRow)}`);
    }
    if (scen === 'picker') {
      // the size picker for a new mark (screenshot)
      const b = S().blots[0], pc = b.pieces[1] || b.pieces[0];
      if (b.marker) App.viewImg = b.marker;
      App.viewBlot = b.id; App.setMode('marks');
      const mk = { u: App.ladderU(pc), v: pc.h / 4, kda: 0 };
      App.manualMarks(b, pc).push(mk); App.emit('select');
      markPicker(b, pc, mk, 640, 420, true);
      snap('picker open');
    }
    // &pose=merge|align|order: a drag on the figure held half-way (screenshots)
    const pose = qs.get('pose');
    if (pose === 'merge') {
      App.splitRow(vis().find(r => r.segs.length > 1)); App.commit();
      const a = imgOf(onPiece('A').id).getBoundingClientRect(), el = imgOf(onPiece('B').id);
      hold(el, [ctr(el)[0], a.top + a.height / 2]);
    } else if (pose === 'align') {
      const r = onPiece('C'), el = imgOf(r.id, r.segs[0].piece), a = ctr(el);
      hold(el, [a[0] + 1.3 * laneW(), a[1]]);
    } else if (pose === 'order') {
      const el = imgOf(vis()[vis().length - 1].id), r1 = imgOf(vis()[1].id).getBoundingClientRect();
      hold(el, [ctr(el)[0], r1.top - 3]);
    }
    if (log.length) window.__scen = log;
    st = S();                         // undo in a scenario replaces the state object
    if (qs.get('annot') === '1') {
      const names = { 110: 'mTOR', 50: 'p-ERK1/2', 30: 'GAPDH', 75: 'Target-X', 28: 'β-actin' };
      const noKda = ['Target-X', 'β-actin'];     // the scatter demo membrane cannot be sized: name its rows top-down
      st.rows.forEach(r => { const k = App.rowKda(r); if (!k) { r.name = noKda.shift() || ''; return; } const key = Object.keys(names).map(Number).sort((a, b) => Math.abs(Math.log(k / a)) - Math.abs(Math.log(k / b)))[0]; r.name = names[key]; });
      const ln = ['Ctrl', 'EGF 5′', 'EGF 15′', 'Ctrl', 'Inh', 'EGF 5′', 'EGF 15′', 'Ctrl', 'Inh'];
      App.figLanes().forEach((j, k) => { st.lanes[j - 1].name = ln[k] || ''; });
      st.groups = [{ from: 1, to: 3, text: 'siNC' }, { from: 4, to: 7, text: 'siTarget' }];
      App.commit();
    }
    if (qs.get('png')) {
      const f = G.BRender.build(false), c = await G.Export.svgToCanvas(f.svg, f.w, f.h, +qs.get('png'));
      const pre = document.createElement('pre'); pre.id = 'figpng'; pre.style.display = 'none'; pre.textContent = c.toDataURL('image/png'); document.body.appendChild(pre);
    }
    if (qs.get('exports') === '1') {
      const got = [], orig = G.Export.download;
      G.Export.download = (blob, name) => {
        got.push(name + ':' + blob.size);
        if (/\.png$/.test(name)) { const fr = new FileReader(); fr.onload = () => { const pre = document.createElement('pre'); pre.id = 'rawpng'; pre.style.display = 'none'; pre.textContent = fr.result; document.body.appendChild(pre); }; fr.readAsDataURL(blob); }
      };
      exportRaw(); exportQuant();
      await new Promise(r => setTimeout(r, 1500));
      G.Export.download = orig;
      window.__exports = got;
    }
    const nm = id => (App.images.get(id) || { name: '?' }).name.slice(0, 2);
    document.title = 'READY ' + JSON.stringify({
      exports: window.__exports, scen: window.__scen, dbg: App._dbg,
      align: st.blots.map(b => `grid ${b.frame ? nm(b.frame) : '-'} marker ${b.marker ? nm(b.marker) : '-'}: ` + b.images.filter(id => st.align && st.align[id]).map(id => { const a = st.align[id]; return `${nm(id)}=${a.a.toFixed(2)},${a.tx.toFixed(1)},${a.ty.toFixed(1)}${a.pieces ? '+' + Object.keys(a.pieces).map(p => (App.piece(b, p) || {}).letter).join('') : ''}/${a.by}`; }).join(' ')),
      blots: st.blots.map(b => { const A = App.analysis[b.id]; return { n: b.images.length, kinds: b.images.map(id => App.images.get(id).name.slice(0, 2) + App.images.get(id).kind[0]).join(' '), ladder: b.ladderId,
        strips: A && A.strips.map(s => `${Math.round(s.cx)},${Math.round(s.cy)} ${s.angle}° ${Math.round(s.w)}x${Math.round(s.h)}`), pitch: A && Math.round(A.pitch),
        pieces: (b.pieces || []).map(p => `${p.letter} col0=${p.col0} p=${p.pitch.toFixed(1)} ${(p.roles || []).map(x => x[0]).join('')} lad=${(p.ladderUs || []).map(Math.round).join('/')}${p.marks ? ' marks=' + p.marks.map(m => m.kda).join('/') : ''}`),
        ladderBands: A && A.ladderStrips.map(l => l && l.bands.length + '@' + Math.round(l.uStrip || 0)), rank: A && A.ladderRank.slice(0, 3).map(r => r.id + ':' + r.q.toFixed(2)), notes: A && A.notes }; }), range: st.range,
      rowsGeo: st.rows.map(r => { const b = App.blot(r.blot); return { segs: r.segs.map(s => `${(App.piece(b, s.piece) || {}).letter}:${Math.round(s.vc)}:${s.c0}:${s.lanes.map(l => l.r).join('')}`).join('+'), box: r.segs.map(s => `${Math.round(s.x0)}..${Math.round(s.x1)}`).join('+'), oy: Math.round(App.rowXY(r)[1]), h: Math.round(r.above + r.below), cols: App.figLanes().filter(j => App.colSource(r, j)).join(',') }; }),
      rows: st.rows.map(r => ({ b: st.blots.indexOf(App.blot(r.blot)), kda: Math.round(App.rowKda(r) || 0), expo: App.expoLabel(App.images.get(r.img)), best: App.images.get(App.bestExpo(r)) && App.expoLabel(App.images.get(App.bestExpo(r))), verdict: App.expoVerdict(App.rowExpo(r).find(e => e.id === r.img)), hidden: r.hidden, name: r.name })),
      levels: Object.fromEntries(Object.entries(st.levels).filter(([id]) => App.images.get(id)).map(([id, l]) => [App.images.get(id).name.slice(0, 2), `${l.black.toFixed(3)}-${l.white.toFixed(3)}${l.manual ? 'M' : ''}`])),
      expo: st.rows.map(r => { const e = App.rowExpo(r).find(x => x.id === r.img); return e ? `pk${e.peak.toFixed(3)} bg${e.bgMed.toFixed(3)} sig${e.bgSig.toFixed(4)} nz${(e.noise || 0).toFixed(4)} sat${(e.satFrac * 100).toFixed(1)}` : ''; }),
      coach: $('coachText').textContent, warn: App.checks().warn
    });
  }, 60);
})(window);
