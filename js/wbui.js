/* BlotFigure UI: panel, top bar, coach line, preview with direct editing, exports. */
(function (G) {
  'use strict';
  const App = G.BApp, WB = G.WB, $ = id => document.getElementById(id);
  const S = () => App.S;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const composing = e => e.isComposing || e.keyCode === 229;
  const live = fn => e => { if (!S()) return; fn(e); App.refresh(); };
  const done = fn => e => { if (!S()) return; if (fn) fn(e); App.commit(); };
  // the pieces (modules) a row comes from: "B", "A+B"; with several membranes "2·B"
  const modLabel = row => {
    const L = App.rowPieces(row).map(pc => pc.letter || '?').join('+') || '—';
    return S().blots.length > 1 ? `${S().blots.indexOf(App.blot(row.blot)) + 1}·${L}` : L;
  };

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
      const x = document.createElement('button'); x.textContent = '×'; x.title = '不再提示'; x.onclick = () => { dismissed.add(w); d.remove(); };
      d.appendChild(x); box.appendChild(d);
    });
  }

  /* ---------- modes ---------- */
  App.setMode = function (m) {
    if (App.mode === 'marks' && m !== 'marks') closePop();
    if (App.mode === 'align' && m !== 'align') G.View.alignEnd();
    if (App.mode === 'pieces' && m !== 'pieces') G.View.piecesEnd(false);
    App.mode = m;
    // the figure's banner for figure modes, the membrane view's banner for clicks on the membrane
    const onView = m === 'addrow' || m === 'marks' || m === 'align' || m === 'pieces';
    $('modeBanner').classList.toggle('hidden', !m || onView);
    $('viewBanner').classList.toggle('hidden', !onView);
    $('modeText').textContent = m === 'group' ? '在成图上从第一个泳道名拖到最后一个' : m === 'arrow' ? '在成图上点目标条带：箭头吸附到条带，按 Marker 标分子量'
      : m === 'bracket' ? '在成图上沿着行上下拖出括号 · 点一行 = 整行 · Alt 不吸附行边' : '';
    $('viewModeText').textContent = m === 'addrow' ? '移到蛋白条带上点一下放下框（或按住拖出任意大小）· Esc 取消'
      : m === 'marks' ? '第 4 步：点一条 Marker 带，选它的分子量 · 拖动对准（自动吸附，Alt 不吸附）· 点数字改'
      : m === 'align' ? '拖动图片让条带落进框里 · Shift+拖动或 [ ] 旋转 · 方向键微调'
      : m === 'pieces' ? '第 2 步：拖动蓝框移动 · 拖边角改大小 · 拖 ↻ 旋转 · 空白处拖出新膜条 · Delete 删除' : '';
    const vb = App.S && App.blot(App.viewBlot);
    // (the modes of steps 2 and 4 end with the step: their banners lead on to the next one)
    $('viewModeExtra').innerHTML = m === 'align' ? '<button id="vmAuto" title="按白光图和条带自动对齐（整张膜的图都重新对齐）">自动对齐</button><button id="vmNone" title="按原样使用这张图，不移动">不对齐</button>'
      : m === 'pieces' ? `${vb && vb.userStrips ? '<button id="vmPcAuto" title="丢掉手动调整，按 Marker 图重新自动找膜条">恢复自动</button>' : ''}<button id="vmPcNext" class="go">${pcUnseen() ? '这张对了，看下一张膜 →' : '下一步 →'}</button>`
      : m === 'marks' ? '<button id="vmMkNext" class="go">下一步 →</button>' : '';
    if (m === 'align') {
      const id = App.alignImg;
      $('vmAuto').onclick = () => { G.View.alignEnd(); App.mode = null; App.busy(true, '自动对齐…'); setTimeout(() => { App.autoAlign(id); App.busy(false); App.commit(); App.setMode('align'); G.View.alignStart(id); toast('已重新自动对齐这张膜的图'); }, 20); };
      $('vmNone').onclick = () => { G.View.alignEnd(); App.setAlign(id, null); App.commit(); G.View.alignStart(id); toast('这张图按原样使用（不移动）'); };
    }
    if (m === 'pieces') {
      $('vmPcNext').onclick = () => nextStep(2);
      if ($('vmPcAuto')) $('vmPcAuto').onclick = () => { G.View.piecesEnd(false); applyPieces(vb, null, true); };
    }
    if (m === 'marks') $('vmMkNext').onclick = () => nextStep(4);
    $('viewModeCancel').classList.toggle('hidden', m === 'pieces' || m === 'marks');
    $('viewModeCancel').textContent = m === 'align' ? '完成' : '取消 (Esc)';
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
    if (!mk) toast('这张膜没有 Marker 图：在曝光图上标 Marker 带也可以（看得见 Marker 的话）', 4200);
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
    App.busy(true, '按膜条重新分析…');
    setTimeout(() => {
      App.setPieces(b, toAuto ? null : pcs);
      App.busy(false); App.commit();
      if (toAuto) { toast('膜条已恢复自动识别'); if (App.curStep === 2) startPieces(b); }
      if (then) then();
    }, 20);
  }

  /* ---------- loading ---------- */
  async function addFiles(files) {
    const n = await App.addFiles(files);
    if (!n) return;
    const st = S(), moved = st.blots.reduce((s, b) => s + nMoved(b), 0);
    toast(`已载入 ${n} 张图片（${st.blots.length} 张膜）` + (moved ? `，${moved} 张拍摄时膜的位置不同，已自动对齐` : '') + '。第 1 步：确认每张膜的 Marker 图', moved ? 5200 : 4000);
    // (8-bit pictures: said once, not once per file)
    const lw = App.loadWarnings || [];
    if (lw.length) toast(lw.length > 1 ? `有 ${lw.length} 张不是 16 位 TIFF，按 8 位处理：动态范围低，过曝像素不好判断；有成像仪导出的 16 位 TIFF 的话建议用它` : lw[0], 6000);
  }
  ['fileInput', 'fileInput2', 'fileInput3'].forEach(id => $(id).addEventListener('change', e => { $('fileMenu').classList.add('hidden'); addFiles(e.target.files); e.target.value = ''; }));
  async function loadDemo() {
    App.busy(true, '生成示例膜图…');
    await new Promise(r => setTimeout(r, 30));
    const files = G.WBDemo.files(G.WBDemo.cutSession()).concat(G.WBDemo.files(G.WBDemo.scatterSession()));
    await addFiles(files);
  }
  $('btnDemo').onclick = loadDemo;
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if ([...(e.dataTransfer || {}).types || []].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

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
  /* ---------- projects ---------- */
  async function saveProject() {
    $('fileMenu').classList.add('hidden');
    if (!S()) { toast('还没有内容可保存'); return; }
    App.busy(true, '保存项目…');
    try {
      const blob = await App.saveProject();
      G.Export.download(blob, 'blot_project.blotfig');
      App.saved = App.hist[App.hist.length - 1];
      toast(`已保存项目（${(blob.size / 1048576).toFixed(1)} MB）：下次"文件 → 打开项目"接着做`, 3600);
    } catch (e) { alert('保存失败：' + e.message); } finally { App.busy(false); }
  }
  $('btnSaveProj').onclick = saveProject;
  $('projInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; $('fileMenu').classList.add('hidden');
    if (!f) return;
    if (S() && App.hist[App.hist.length - 1] !== App.saved && !confirm('打开项目会替换现在的内容（没保存的改动会丢掉）。继续？')) return;
    try { const n = await App.openProject(f); toast(`已打开项目：${n} 张图片`); } catch (err) { alert('打开失败：' + err.message); }
  });
  window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); } });
  // leaving with work not saved as a project: the browser asks first (the draft keeps it too, if it can)
  window.addEventListener('beforeunload', e => { if (!App.leaving && S() && S().rows.length && App.hist.length > 1 && App.hist[App.hist.length - 1] !== App.saved) { e.preventDefault(); e.returnValue = ''; } });
  /* ---------- style files, resets (as GelFigure's file menu) ---------- */
  $('btnSaveTpl').onclick = () => {
    $('fileMenu').classList.add('hidden');
    if (!S() || !S().rows.length) { toast('先做出一张图，再保存它的样式'); return; }
    G.Export.download(new Blob([JSON.stringify(App.template(), null, 2)], { type: 'application/json' }), 'blot_style.json');
    toast('已保存样式：下一张同类的图"文件 → 载入样式"一键套用', 3600);
  };
  $('tplInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; $('fileMenu').classList.add('hidden');
    if (!f) return;
    if (!S() || !S().rows.length) { toast('先做到第 3 步（有了蛋白框），再套用样式'); return; }
    try {
      const t = JSON.parse(await f.text());
      if (!t || !t.blotfigTemplate) throw new Error('不是 BlotFigure 样式文件');
      const fl = App.figLanes().length, vis = S().rows.filter(r => !r.hidden).length;
      if ((t.lanes || []).length !== fl || (t.proteins || []).length !== vis) {
        if (!confirm(`样式里有 ${(t.lanes || []).length} 条泳道、${(t.proteins || []).length} 个蛋白，这张图是 ${fl} 条泳道、${vis} 个蛋白。\n会从第一条泳道、第一行起按顺序对应，多出来的忽略。继续？`)) return;
      }
      App.applyTemplate(t); App.commit();
      toast('样式已套用（Ctrl+Z 可撤销）');
    } catch (err) { alert('样式载入失败：' + err.message); }
  });
  $('btnResetAll').onclick = () => {
    $('fileMenu').classList.add('hidden');
    if (!S()) return;
    if (App.hist[App.hist.length - 1] === App.initial) { toast(App.initialAsOpened ? '现在就是打开项目时的样子' : '现在就是刚导入时的样子，没有要撤回的改动'); return; }
    const when = App.initialAsOpened ? '打开这个项目时（它保存时还没有记录导入时的状态）' : '刚导入图片时';
    if (!confirm(`回到${when}的样子：膜条、蛋白框、名字、Marker 刻度和标注都会回到那时的状态。\n这一步可以用 Ctrl+Z 撤销。继续？`)) return;
    if (App.resetAll()) { App.curStep = S().step; App.commit(); openStep(App.curStep); toast('已回到刚导入时（Ctrl+Z 可撤销）'); }
  };
  $('btnNew').onclick = async () => {
    $('fileMenu').classList.add('hidden');
    if (S() && App.hist[App.hist.length - 1] !== App.saved && !confirm('新建会清空现在的图片和所有调整（没保存成项目的话就找不回来了）。继续？')) return;
    await App.dropDraft();
    App.leaving = true; location.reload();
  };
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); }
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
  const needFigure = () => { if (S() && S().rows.some(r => !r.hidden)) return false; toast('还没有可导出的行'); return true; };
  /* ---------- export, with a check first (as GelFigure) ---------- */
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem('blotfig.' + k); localStorage.setItem('blotfig.' + k, v); } catch (e) { /* storage off */ } return null; };
  $('preflightOn').checked = pref('preflight') !== '0';
  $('preflightOn').addEventListener('change', e => pref('preflight', e.target.checked ? '1' : '0'));
  // true = go ahead, false = the user went back to fix something
  function preflight() {
    return new Promise(resolve => {
      if (pref('preflight') === '0') return resolve(true);
      const items = App.preflight(), serious = items.filter(i => i.level === 'block' || i.level === 'warn');
      if (!serious.length) return resolve(true);
      const lab = { block: '需处理', warn: '注意', info: '提示' };
      $('pfList').innerHTML = items.map((it, k) => `<div class="pf-item"><span class="lv ${it.level}">${lab[it.level]}</span><span class="tx">${esc(it.text)}</span>${it.fix ? `<button class="btn sm" data-fix="${k}">${esc(it.fix.label)}</button>` : ''}</div>`).join('');
      const close = ok => { $('preflightDlg').classList.add('hidden'); if ($('pfOff').checked) { pref('preflight', '0'); $('preflightOn').checked = false; } resolve(ok); };
      $('pfList').querySelectorAll('[data-fix]').forEach(b => b.onclick = () => {
        const fx = items[+b.dataset.fix].fix;
        if (fx.leave) { close(false); fx.run(); return; }
        fx.run(); App.commit(); b.disabled = true; b.textContent = '已修正';
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
    App.busy(true, '导出中…');
    try {
      const f = G.BRender.build(false), dpi = S().style.dpi, eff = Math.round(App.effectiveDpi());
      if (kind === 'tiff') await G.Export.exportTIFF(f.svg, f.w, f.h, dpi, `${baseName()}_${dpi}dpi.tif`, exportTexts());
      else await G.Export.exportPNG(f.svg, f.w, f.h, dpi, `${baseName()}_${dpi}dpi.png`, exportTexts());
      toast(`已导出 ${dpi} dpi ${kind === 'tiff' ? 'TIFF' : 'PNG'}` + (eff < dpi ? `（条带本身 ${eff} dpi）` : ''));
    } catch (e) { alert(e.message); } finally { App.busy(false); }
  }
  $('btnPNG').onclick = () => exportRaster('png');
  $('btnTIFF').onclick = () => exportRaster('tiff');
  $('btnSVG').onclick = async () => { if (needFigure() || !(await preflight())) return; G.Export.exportSVG(G.BRender.build(false).svg, baseName() + '.svg'); toast('已导出 SVG'); };
  $('btnLog').onclick = () => {
    if (needFigure()) return;
    G.Export.download(new Blob([JSON.stringify(App.processingLog(), null, 2)], { type: 'application/json' }), baseName() + '_processing_log.json');
    toast('已导出处理日志（含每张原图的 SHA-256）');
  };
  $('btnLegend').onclick = async () => {
    if (!S()) return;
    const t = App.checks().legend.join(' ');
    try { await navigator.clipboard.writeText(t); toast('图注文字已复制'); } catch (e) { prompt('复制下面的图注文字：', t); }
  };
  $('btnRaw').onclick = () => { if (S()) exportRaw(); };
  $('btnQuant').onclick = () => { if (S()) exportQuant(); };

  /* ---------- 1 membranes & pictures ---------- */
  function thumbCanvas(rec) {
    const c = document.createElement('canvas'), t = rec.thumb;
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
    return c;
  }
  const nMoved = b => b.images.filter(id => App.isMoved(id)).length;
  const wlOpen = new Set();          // membranes whose white-light pictures are all shown
  /* step 1: every membrane with its pictures — the Marker picture (★: the one its pieces are found in and its
   * marker is marked on) marked, any other set as it in one click; a picture's kind, exposure time, alignment
   * and membrane in its ⋯ */
  function renderBlots() {
    const st = S(), box = $('blotList'); box.innerHTML = '';
    st.blots.forEach(b => {
      const card = document.createElement('div');
      card.className = 'blot-card' + (b.id === App.viewBlot ? ' view' : '');
      const nCh = App.chemiOf(b).length, nM = App.markersOf(b).length, mk = App.markerRec(b);
      card.innerHTML = `<div class="blot-head"><input type="text" value="${esc(b.name)}" placeholder="${esc(App.blotName(b))}" title="膜的名字（几张膜时用来区分）"></div>
        <div class="blot-sub">${nCh} 张曝光 · ${nM} 张白光 / 复合图${nMoved(b) ? ` · <span title="拍摄之间膜的位置变过：这些图已对齐到同一位置">${nMoved(b)} 张已对齐</span>` : ''}</div>
        ${mk ? '' : '<p class="hint warn-t">没认出 Marker 图：点看得见 Marker 的那张下面的"设为 Marker 图"。确实没有的话也可以继续，只是不能标分子量。</p>'}
        <div class="th-label">白光 / 复合图 <span>${nM}</span></div><div class="thumbs" data-kind="marker"></div>
        <div class="th-label">曝光图 <span>${nCh}</span></div><div class="thumbs" data-kind="chemi"></div>`;
      // white-light pictures (often one per capture, all alike): the Marker picture and the grid's, the rest
      // behind "+N" unless opened or shown
      const wl = App.markersOf(b), keep = r => wlOpen.has(b.id) || wl.length <= 3 || r.id === b.marker || r.id === b.frame || (r.id === App.viewImg && b.id === App.viewBlot);
      b.images.map(id => App.images.get(id)).filter(Boolean).filter(r => r.kind !== 'marker' || keep(r)).sort((x, y) => (y.id === b.marker) - (x.id === b.marker) || (x.exposure || 0) - (y.exposure || 0)).forEach(rec => {
        const th = card.querySelector(`.thumbs[data-kind="${rec.kind}"]`);
        const t = document.createElement('div');
        t.className = 'thumb' + (rec.id === App.viewImg && b.id === App.viewBlot ? ' on' : '') + (rec.id === b.marker ? ' mk' : '');
        t.title = rec.name + (rec.resampled ? '（已缩放到与曝光图相同尺寸）' : '');
        t.appendChild(thumbCanvas(rec));
        // which figure rows take their bands from this exposure (row colours)
        const users = rec.kind === 'chemi' ? st.rows.filter(r => !r.hidden && r.img === rec.id) : [];
        const usesHtml = users.length ? `<span class="uses" title="成图中用这张曝光的行：${esc(users.map(r => r.name || (App.rowKda(r) ? '≈' + Math.round(App.rowKda(r)) + ' kDa' : '未命名')).join('、'))}">${users.map(r => `<i style="background:${App.rowColor(r)}"></i>`).join('')}</span>` : '';
        // the membrane lay elsewhere in this picture: aligned onto the others (the grid's own picture: 基准)
        const al = App.alignOf(rec.id), alHtml = App.isMoved(rec.id) ? `<span class="aligned" title="${esc(alignWords(rec, b))}；在 ⋯ 里可手动调整">${al.how === 'manual' ? '手动' : '已对齐'}</span>`
          : b.frame === rec.id && b.images.some(id => App.isMoved(id)) ? '<span class="aligned base" title="基准：这张膜的其他图都对齐到这张">基准</span>' : '';
        // the Marker picture (★), else its label and "set as the Marker picture"
        const cap = rec.id === b.marker ? '<span class="isx" title="膜条从这张图找，Marker 在这张图上标">★ Marker 图</span>'
          : `${rec.kind === 'marker' ? '白光' : `<b>${esc(App.expoLabel(rec))}</b>`}<br><button class="setmk" title="膜条从这张图找，Marker 在这张图上标">设为 Marker 图</button>`;
        t.insertAdjacentHTML('beforeend', `${usesHtml}${alHtml}<div class="cap">${cap}</div><button class="more" title="类型、曝光时间、对齐、移到别的膜、移除">⋯</button>`);
        t.onclick = e => { if (e.target.classList.contains('more') || e.target.classList.contains('setmk')) return; App.viewBlot = b.id; App.viewImg = rec.id; App.emit('select'); G.View.fitFull(); };
        t.querySelector('.more').onclick = e => { e.stopPropagation(); imagePopover(rec, b, t); };
        const sm = t.querySelector('.setmk');
        if (sm) sm.onclick = e => {
          e.stopPropagation();
          App.busy(true, '按这张图重新找膜条…');
          setTimeout(() => { App.setMarkerImage(b, rec.id); App.viewBlot = b.id; App.viewImg = rec.id; App.busy(false); App.commit(); G.View.fitFull(); toast(`${App.blotName(b)} 的 Marker 图改成了 ${rec.name}`); }, 20);
        };
        th.appendChild(t);
      });
      const hidden = wl.filter(r => !keep(r)).length;
      if (hidden || (wlOpen.has(b.id) && wl.length > 3)) {
        const more = document.createElement('button');
        more.className = 'thumb-more'; more.textContent = hidden ? `+${hidden} 张` : '收起';
        more.title = hidden ? '其余的白光图（每次拍摄一张，通常看起来一样）' : '';
        more.onclick = () => { if (wlOpen.has(b.id)) wlOpen.delete(b.id); else wlOpen.add(b.id); renderBlots(); };
        card.querySelector('.thumbs[data-kind="marker"]').appendChild(more);
      }
      card.querySelector('.blot-head input').addEventListener('change', done(e => { b.name = e.target.value.trim(); }));
      box.appendChild(card);
    });
    $('stBlots').textContent = `${st.blots.length} 张膜 · ${App.images.size} 张图`;
    $('sum1').innerHTML = st.blots.map(b => { const mk = App.markerRec(b); return `${esc(App.blotName(b))}：Marker 图 <b>${mk ? esc(mk.name) : '没有'}</b>，${App.chemiOf(b).length} 张曝光`; }).join('<br>');
  }
  /* step 2: the pieces of each membrane (outlines edited on the picture); several membranes: one at a time */
  function renderPieces() {
    const st = S(), box = $('pieceList');
    box.innerHTML = st.blots.map(b => `<div class="pc-blot${b.id === App.viewBlot ? ' view' : ''}" data-blot="${b.id}">${st.blots.length > 1 ? `<b>${esc(App.blotName(b))}</b>` : ''}
      <span>${(b.pieces || []).length} 条膜条（${(b.pieces || []).map(p => p.letter).sort().join(' ')}）${b.userStrips ? '<span class="tag-hand">手动调整过</span>' : ''}</span>
      ${st.blots.length > 1 && b.id !== App.viewBlot ? '<button class="link" data-act="show">看这张膜</button>' : ''}</div>`).join('');
    box.querySelectorAll('[data-act="show"]').forEach(btn => btn.onclick = () => {
      const to = App.blot(btn.closest('.pc-blot').dataset.blot), from = App.blot(App.viewBlot);
      // (the outlines edited on the membrane shown are applied first)
      applyPieces(from, App.curStep === 2 ? G.View.piecesEnd(true) : null, false, () => startPieces(to));
    });
    $('stPieces').textContent = `${st.blots.reduce((s, b) => s + (b.pieces || []).length, 0)} 条膜条`;
    $('next2').textContent = App.curStep === 2 && pcUnseen() ? '这张膜对了，看下一张 →' : st.rows.length ? '膜条对了，回到蛋白框 →' : '膜条对了，下一步：生成蛋白框 →';
    $('sum2').innerHTML = st.blots.map(b => `${st.blots.length > 1 ? esc(App.blotName(b)) + '：' : ''}<b>${(b.pieces || []).length}</b> 条膜条${b.userStrips ? '（手动调整过）' : ''}`).join('<br>');
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
    pop.style.top = clamp(r.top - 10, 58, innerHeight - ph - 8) + 'px';
  }
  function placePopAt(x, y) {
    pop.classList.remove('hidden'); popOpen = true;
    const pw = pop.offsetWidth || 260, ph = pop.offsetHeight;
    pop.style.left = clamp(x, 6, innerWidth - pw - 6) + 'px';
    pop.style.top = clamp(y, 58, innerHeight - ph - 8) + 'px';
  }
  // the popover dropped without its pending actions (the state it belongs to is being replaced)
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
    pop.innerHTML = `<h4>膜条 ${esc(pc.letter)}：这条 Marker 带是多少 kDa？</h4>
      <div class="kda-grid">${sizes.map(k => `<button data-k="${k}" class="${k === sug ? 'on' : ''}${lad && (lad.ref || []).includes(k) ? ' ref' : ''}"${lad && (lad.ref || []).includes(k) ? ' title="参考带（彩色 / 加粗）"' : ''}>${k}</button>`).join('')}</div>
      <div class="field inline"><label class="inline-label">其他</label><input type="number" id="pKda" class="num" step="any" min="0" placeholder="${sug || 'kDa'}"> kDa${sug ? `<span class="hint" style="margin:0 0 0 auto">回车 = ${sug}</span>` : ''}</div>
      <p class="hint">${lad ? `按 ${esc(shortName(lad.name))} 列出（橙色 = 参考带）` : '还没选 Marker 型号（左侧第 4 步最上面），列出的是常见分子量'}</p>
      <div class="actions">${isNew ? '<button class="btn sm" id="pNo">不加了</button>' : '<button class="btn sm danger" id="pDelMark">删除这条</button>'}<button class="btn sm primary" id="pOk">确定</button></div>`;
    placePopAt(cx + 14, cy - 30);
    const back = () => $('editorBox').focus({ preventScroll: true });
    const drop = () => { if (pc.marks) pc.marks = pc.marks.filter(m => m !== mark); App.selMark = null; };
    const done1 = k => { if (!(k > 0)) { toast('先选一个分子量'); return; } mark.kda = k; popCancel = popAccept = null; closePop(); App.commit(); back(); };
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
    if (del) del.onclick = () => { drop(); popCancel = popAccept = null; closePop(); App.commit(); back(); toast('已删除这条刻度（Ctrl+Z 可撤销）'); };
    setTimeout(() => inp.focus({ preventScroll: true }), 0);
  }

  /* ---------- 4 marker ---------- */
  // the ladder of each membrane and the marks of every piece (set by hand: nothing is read automatically).
  // Clicking a piece's chip marks that piece, zoomed in.
  const MARK_STATE = { manual: '可算分子量', few: '再标 1 条', none: '未标' };
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
    card.innerHTML = `<div class="lc-head"><b>Marker 参考</b><button id="lcHide" title="收起（左侧第 4 步里可再打开）">×</button></div>
      <div class="lc-name" title="${esc(lad.name)}">${esc(shortName(lad.name))}</div>
      <svg width="116" height="${H + 2 * top}" viewBox="0 0 116 ${H + 2 * top}"><rect x="6" y="2" width="44" height="${H + 2 * top - 4}" rx="4" fill="#f1f4fa"/>${bands}</svg>
      <p class="lc-note">按 log 分子量等距的示意，实际间距随胶浓度而变；<b>橙色</b> = 彩色 / 加粗的参考带${pc ? `；✓ = 膜条 ${esc(pc.letter)} 已标` : ''}</p>`;
    card.classList.remove('hidden');
    $('lcHide').onclick = () => { cardHidden = true; card.classList.add('hidden'); renderMarker(); };
  }
  /* step 4: the ladder of each membrane (its sizes as the maker lists them, the reference bands in orange) and
   * the marks of each piece — the pieces the figure uses first */
  function renderMarker() {
    const st = S(), box = $('markerPanel');
    let html = `<p class="lead">在中间的 Marker 图上<b>点一条 Marker 带</b>，选它的分子量（会吸附到条带上，按住 Alt 不吸附）。每条膜条标 <b>2 条以上</b>就能算出各行的分子量，之后其余大小的位置用虚线提示，点一下就加上。</p>`;
    let todo = 0;
    st.blots.forEach(b => {
      const hasM = !!App.markerRec(b), lad = G.ProteinLadders.get(b.ladderId);
      const used = new Set(App.usedPieces(b).map(pc => pc.id));
      const pcs = (b.pieces || []).slice().sort((p, q) => (used.has(q.id) - used.has(p.id)) || (p.letter || '').localeCompare(q.letter || ''));
      html += `<div class="mk-blot" data-blot="${b.id}">${st.blots.length > 1 ? `<div class="mk-title">${esc(App.blotName(b))}</div>` : ''}
        <label class="mk-label">Marker 型号${b.ladderId && b.ladderId === App.prefLadder ? '<span class="mk-note">上次用的</span>' : ''}</label>
        <select class="ladder-sel${lad ? '' : ' todo'}"><option value=""${lad ? '' : ' selected'}>— 选你用的 Marker —</option>${ladderOptions(lad ? b.ladderId : null)}</select>
        ${lad ? `<div class="mk-sizes" title="这个型号的条带（官方列表），橙色是彩色 / 加粗的参考带">${lad.sizes.map(k => `<span class="${(lad.ref || []).includes(k) ? 'ref' : ''}">${k}</span>`).join('')}</div>` : ''}
        ${hasM ? '' : '<p class="hint warn-t">这张膜没有 Marker 图（第 1 步）：在曝光图上看得见 Marker 的话也可以标。</p>'}
        <div class="mk-chips">${pcs.map(pc => {
          const mi = App.markInfo(b, pc);
          if (mi.state !== 'manual' && used.has(pc.id)) todo++;
          return `<button class="mk-chip ${mi.state}${used.has(pc.id) ? '' : ' unused'}" data-pc="${pc.id}" title="膜条 ${esc(pc.letter)}：${MARK_STATE[mi.state]}${mi.ks.length ? '，' + mi.ks.join(' / ') + ' kDa' : ''}${used.has(pc.id) ? '' : '（成图没有用到这条膜条）'}。点一下放大到它"><b>${esc(pc.letter)}</b><span>${mi.ks.length ? mi.ks.slice(0, 4).map(k => +k.toPrecision(3)).join('·') + (mi.ks.length > 4 ? '…' : '') : '—'}</span><i>${MARK_STATE[mi.state]}</i></button>`;
        }).join('')}</div>
        ${pcs.some(pc => pc.marks && pc.marks.length) ? '<div class="mk-links"><button class="link mk-clear" title="这张膜上标的所有刻度都去掉（Ctrl+Z 可撤销）">清除这张膜的刻度</button></div>' : ''}</div>`;
    });
    if (cardHidden && App.mode === 'marks') html += '<p><button class="link mk-card-on">显示 Marker 参考图</button></p>';
    box.innerHTML = html;
    box.querySelectorAll('.mk-blot').forEach(div => {
      const b = App.blot(div.dataset.blot);
      div.querySelector('.ladder-sel').addEventListener('change', done(e => {
        const id = e.target.value;
        App.setLadder(b, id);
        // (the other membranes without one yet: most likely the same ladder)
        const more = id ? S().blots.filter(o => o !== b && !o.ladderId) : [];
        more.forEach(o => App.setLadder(o, id));
        if (id) toast(`已选 ${shortName(G.ProteinLadders.get(id).name)}${more.length ? '，其他膜也用它（不同就在那张膜下面改）' : ''}；以后新载入的膜默认用它`, 3600);
      }));
      div.querySelectorAll('.mk-chip').forEach(c => c.onclick = () => { if (App.curStep !== 4) openStep(4); startMarks(b, App.piece(b, c.dataset.pc)); });
      const cl = div.querySelector('.mk-clear');
      if (cl) cl.onclick = done(() => { App.clearMarks(b); toast('已清除这张膜的刻度（Ctrl+Z 可撤销）'); });
    });
    const con = box.querySelector('.mk-card-on');
    if (con) con.onclick = () => { cardHidden = false; renderMarker(); };
    $('stMarker').textContent = todo ? `${todo} 条膜条没标完` : '';
    $('stMarker').classList.toggle('warn', !!todo);
    $('sum4').innerHTML = st.style.showMW ? st.blots.map(b => `${st.blots.length > 1 ? esc(App.blotName(b)) + '：' : ''}${(b.pieces || []).map(pc => `${esc(pc.letter)} ${App.markInfo(b, pc).ks.length} 条`).join(' · ')}`).join('<br>') : '这次不标分子量';
    // the ladder's own pattern beside the picture while marking
    ladderCard(App.blot(App.viewBlot));
  }
  // where a picture lies on its membrane's grid, in words
  function alignWords(rec, b) {
    const al = App.alignOf(rec.id), anyMoved = b.images.some(id => App.isMoved(id));
    if (App.isMoved(rec.id)) return `${al.how === 'manual' ? '手动对齐' : '拍这张时膜的位置不同，已自动对齐'}（${App.alignText(rec.id)}）`;
    if (al && al.how === 'manual') return '按原样使用（不移动）';
    return b.frame === rec.id && anyMoved ? '基准：这张膜的其他图都对齐到这张' : '与其他图位置一致';
  }
  function imagePopover(rec, b) {
    const others = S().blots.filter(x => x !== b), al = App.alignOf(rec.id);
    pop.innerHTML = `<h4>${esc(rec.name)}</h4>
      <div class="field inline"><label class="inline-label">类型</label>
        <div class="seg"><button data-k="chemi" class="${rec.kind === 'chemi' ? 'on' : ''}">曝光图</button><button data-k="marker" class="${rec.kind === 'marker' ? 'on' : ''}">Marker 白光</button></div></div>
      ${rec.kind === 'chemi' ? `<div class="field inline"><label class="inline-label">曝光时间</label><input type="number" id="pExpo" class="num" step="any" value="${rec.exposure != null ? rec.exposure : ''}" placeholder="秒"> s</div>` : ''}
      <div class="field inline"><label class="inline-label">移到</label><select id="pMove" style="flex:1"><option value="">—</option>${others.map(o => `<option value="${o.id}">${esc(App.blotName(o))}</option>`).join('')}<option value="new">新的一张膜</option></select></div>
      <div class="field inline align-row"><label class="inline-label">位置</label><span class="align-info">${esc(alignWords(rec, b))}</span></div>
      <div class="actions left"><button class="btn sm" id="pAlign" title="在膜图上拖动这张图，让条带落进框里">手动对齐…</button>${al && al.how === 'manual' ? '<button class="btn sm" id="pAutoAlign">恢复自动对齐</button>' : ''}</div>
      <div class="actions"><button class="btn sm danger" id="pDel">移除这张图</button><button class="btn sm primary" id="pOk">完成</button></div>`;
    placePop(event.target);
    pop.querySelector('#pAlign').onclick = () => {
      closePop();
      if (App.mode) App.setMode(null);
      App.viewBlot = b.id; App.viewImg = rec.id; App.alignImg = rec.id;
      App.emit('select'); G.View.fitFull();
      App.setMode('align'); G.View.alignStart(rec.id);
      $('editorBox').focus({ preventScroll: true });
    };
    const aa = pop.querySelector('#pAutoAlign');
    if (aa) aa.onclick = () => { App.busy(true, '自动对齐…'); setTimeout(() => { App.autoAlign(rec.id); App.busy(false); App.commit(); closePop(); toast('已恢复自动对齐'); }, 20); };
    pop.querySelectorAll('[data-k]').forEach(btn => btn.onclick = () => { App.busy(true, '重新分析…'); setTimeout(() => { App.setKind(rec.id, btn.dataset.k); App.busy(false); App.commit(); closePop(); }, 20); });
    const ex = pop.querySelector('#pExpo');
    if (ex) ex.addEventListener('change', done(e => { App.setExposure(rec.id, +e.target.value); }));
    pop.querySelector('#pMove').addEventListener('change', e => {
      if (!e.target.value) return;
      App.busy(true, '重新分析…');
      setTimeout(() => { App.moveImage(rec.id, e.target.value); App.busy(false); App.commit(); closePop(); toast('已移动并重新分析'); }, 20);
    });
    pop.querySelector('#pDel').onclick = () => { App.removeImage(rec.id); closePop(); App.commit(); };
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
      el.innerHTML = `<span class="grip" style="--c:${App.rowColor(row)}" title="来自膜条 ${esc(modLabel(row))}。上下拖动调整这一行在成图里的位置（或选中后 Alt+↑↓）">${esc(modLabel(row))}</span>
        <input type="text" value="${esc(row.name)}" placeholder="${esc(sugg[0] ? sugg[0] + '？' : '蛋白名')}" list="protList">
        <span class="kda">${kda ? '≈' + Math.round(kda) + ' kDa' : ''}</span>
        <button class="expo-chip${isBest ? ' best' : ' other'}${App.expoVerdict(curE) === 'sat' ? ' sat' : ''}" data-act="expo" title="${cur ? esc(App.expoLabel(cur)) + '：' : ''}${isBest ? '正在用推荐的曝光' : '正在用的不是推荐曝光'}｜点开对比全部曝光">${isBest ? '★ ' : ''}${cur ? esc(App.expoLabel(cur)) : '—'}</button>
        <button class="x" data-act="hide" title="${row.hidden ? '显示' : '隐藏'}这一行">${row.hidden ? '◌' : '●'}</button>
        <button class="x" data-act="del" title="删除这一行">×</button>`;
      const inp = el.querySelector('input');
      // (selecting the row draws the list again: the field is focused again there, see keepFocus)
      inp.addEventListener('focus', () => { fillDatalist(kda); if (App.selRow !== row.id) selectRow(row.id, false); });
      inp.addEventListener('input', live(e => { row.name = e.target.value; }));
      inp.addEventListener('change', done());
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || composing(e)) return;
        e.preventDefault();
        const ids = [...box.querySelectorAll('.row-item')].map(it => it.dataset.id), next = ids[ids.indexOf(row.id) + 1];
        inp.blur();
        const nx = next && $('rowList').querySelector(`.row-item[data-id="${next}"] input`);
        if (nx) nx.focus(); else toast('蛋白名填完了');
      });
      el.querySelector('[data-act="expo"]').onclick = () => selectRow(sel ? null : row.id, !sel);
      el.querySelector('[data-act="hide"]').onclick = done(() => { row.hidden = !row.hidden; });
      el.querySelector('[data-act="del"]').onclick = done(() => { st.rows = st.rows.filter(r => r !== row); if (App.selRow === row.id) App.selRow = null; toast('已删除该行（Ctrl+Z 可撤销）'); });
      el.onclick = e => { if (e.target === el || e.target.classList.contains('kda') || e.target.classList.contains('grip')) selectRow(row.id, true); };
      box.appendChild(el);
      if (sel) box.appendChild(rowDetail(row, ex, best));
    });
    if (!st.rows.length) box.innerHTML = '<p class="hint">没有找到蛋白条带：点下面的"+ 添加一个蛋白框"，再到膜上点一下放下。</p>';
    const vis = st.rows.filter(r => !r.hidden).length, hid = st.rows.length - vis;
    $('stRows').textContent = st.rows.length ? `${vis} 行${hid ? ` · ${hid} 行隐藏` : ''}` : '';
    $('sum3').innerHTML = `<b>${vis}</b> 个蛋白框${hid ? `（另有 ${hid} 个很弱的隐藏了）` : ''}`;
  }
  /* step 5: the proteins' names in figure order (Enter: the next one) */
  function renderNames() {
    const st = S(), box = $('nameList'), vis = st.rows.filter(r => !r.hidden);
    box.innerHTML = vis.map(r => { const k = App.rowKda(r), sg = G.ProteinLadders.suggest(k);
      return `<div class="name-item" data-id="${r.id}"><span class="grip" style="--c:${App.rowColor(r)}">${esc(modLabel(r))}</span><input type="text" value="${esc(r.name)}" placeholder="${esc(sg[0] ? sg[0] + '？' : '蛋白名')}" list="protList"><span class="kda">${k ? '≈' + Math.round(k) + ' kDa' : ''}</span></div>`; }).join('');
    box.querySelectorAll('.name-item').forEach(it => {
      const row = App.row(it.dataset.id), inp = it.querySelector('input');
      inp.addEventListener('focus', () => { fillDatalist(App.rowKda(row)); });
      inp.addEventListener('input', live(e => { row.name = e.target.value; }));
      inp.addEventListener('change', done());
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || composing(e)) return;
        e.preventDefault();
        const nx = it.nextElementSibling && it.nextElementSibling.querySelector('input');
        inp.blur();
        const again = nx && $('nameList').querySelector(`.name-item[data-id="${nx.closest('.name-item').dataset.id}"] input`);
        if (again) again.focus(); else toast('蛋白名填完了');
      });
    });
    const named = vis.filter(r => r.name).length, fl = App.figLanes(), ln = fl.filter(j => st.lanes[j - 1].name).length;
    $('stLanes').textContent = `蛋白名 ${named}/${vis.length} · 泳道名 ${ln}/${fl.length}`;
    $('sum5').innerHTML = `蛋白名 <b>${named}/${vis.length}</b> · 泳道名 <b>${ln}/${fl.length}</b>`;
  }
  /* the selected row, opened: its exposures (weakest to strongest; ★ = recommended, red pixels = clipped) and
   * its boxes on the membrane — how many lanes each has, the figure columns they fill, and the lane tools */
  function rowDetail(row, ex, best) {
    const wrap = document.createElement('div'); wrap.className = 'expo-compare row-detail';
    const bestE = ex.find(e => e.id === best), vb = App.expoVerdict(bestE);
    const TAG = { sat: '过曝', weak: '太弱', faint: '偏弱', ok: '' };
    const why = !ex.length ? '' : vb === 'ok' ? '★ 推荐：条带清晰、没有过曝'
      : vb === 'sat' ? '★ 推荐：每张曝光里这条带都有过曝像素，★ 是过曝最少又清楚的一张；这一行不要拿来定量'
      : '★ 推荐：信号都偏弱，★ 是相对最清楚的一张；可以考虑补拍更长曝光';
    const b = App.blot(row.blot), cur = App.curSeg(row), clash = App.rowClash(row).length > 0;
    // the pieces this row runs across side by side (one protein on a membrane cut through), and splitting them
    const segLine = row.segs.length > 1 ? `<div class="seg-line">并排来自膜条 <b>${esc(modLabel(row))}</b>（膜在这里竖着剪开过）<button class="link" data-act="split" title="每条膜条各成一行">拆开</button></div>` : '';
    const boxes = row.segs.map(sg => {
      const pc = App.piece(b, sg.piece), n = App.nSample(sg), nm = sg.lanes.filter(l => l.r === 'm').length, nx = sg.lanes.filter(l => l.r === 'x').length;
      const cols = n > 1 ? `${sg.c0}–${App.segEnd(sg)}` : n ? String(sg.c0) : '—';
      return `<div class="bt-seg${sg === cur ? ' sel' : ''}${clash ? ' clash' : ''}" data-seg="${sg.piece}">
        <div class="bt-line"><span class="ptag" title="膜条 ${esc(pc ? pc.letter : '?')}">${esc(pc ? pc.letter : '?')}</span>
          <span class="bt-n"><b>${n}</b> 道${nm ? ` <span class="tag-m">+${nm} M</span>` : ''}${nx ? ` <span class="tag-x">+${nx} 不用</span>` : ''}</span>
          <span class="bt-cols">成图第 <b>${cols}</b> 列</span>
          <button class="pnav" data-shift="-1" title="这个框的泳道在成图里往左挪一列（最左到第 1 列，不会推动其他行）"${sg.c0 <= 1 ? ' disabled' : ''}>‹</button><button class="pnav" data-shift="1" title="往右挪一列">›</button></div>
        <div class="bt-line"><span class="bt-even">泳道数 <input type="number" class="num" min="1" max="60" value="${sg.lanes.length}"> <button class="btn sm primary" data-act="even" title="最左、最右两条泳道线不动，中间按泳道数均匀排开">首尾对齐</button></span>
          <button class="btn sm ghost" data-act="redetect" title="只看框里的像素，重新找泳道">框内重新识别</button></div>
        <div class="bt-line"><span class="bt-rot">倾斜 <button class="pnav" data-rot="-0.1" title="逆时针 0.1°（选中框后按 [ ）">−</button><b>${(sg.rot || 0).toFixed(1)}°</b><button class="pnav" data-rot="0.1" title="顺时针 0.1°（选中框后按 ] ）">+</button></span>
          <button class="btn sm ghost" data-act="level" title="按框里的条带把框摆正（条带和膜条不完全水平时）">按条带摆正</button>${sg.rot ? '<button class="link" data-act="rot0">归零</button>' : ''}</div>
      </div>`;
    }).join('');
    wrap.innerHTML = `${(b.pieces || []).length > 1 ? segLine : ''}
      ${ex.length ? `<div class="rd-title">曝光<span>${why}</span>${row.img !== best ? '<button class="link" data-act="usebest">改用推荐</button>' : ''}</div><div class="tiles"></div>` : ''}
      <div class="rd-title">泳道<button class="link" data-act="zoom" title="中间的膜图放大到这一行的框">在膜上放大</button></div>
      <ul class="lane-help"><li><b>泳道线没对准</b>：把框里最左、最右两条拖到泳道中心，中间的自动均分（Alt 只动一条）</li>
        <li><b>条数不对</b>：改下面的泳道数再点"首尾对齐"；或双击框内加一道，点竖线后 Delete 删掉</li>
        <li><b>边上的条带被切</b>：把框的左边或右边往外拖</li>
        <li><b>某道不用 / 是 Marker</b>：点框上方的数字切换</li>
        <li><b>歪了</b>：拖框上方的 ↻，或用下面的"倾斜"微调</li>
        <li><b>太亮 / 太暗</b>：膜图上方的"暗部 / 亮部"只调这一行</li></ul>${boxes}`;
    wrap.querySelector('[data-act="zoom"]').onclick = () => { App.viewBlot = row.blot; App.viewImg = row.img; App.emit('select'); G.View.fitRow(row); };
    const split = wrap.querySelector('[data-act="split"]');
    if (split) split.onclick = done(() => { App.splitRow(row); toast('已拆开：每条膜条各成一行'); });
    const tiles = wrap.querySelector('.tiles');
    if (tiles) App.expoOrder(row).forEach(e => {
      const rec = App.images.get(e.id), th = App.rowThumb(row, e.id, 150), v = App.expoVerdict(e);
      const t = document.createElement('button');
      t.className = 'tile' + (e.id === row.img ? ' on' : '') + (e.id === best ? ' rec' : '') + ' v-' + v;
      t.title = `${rec.name}｜信噪比 ${e.snr.toFixed(0)}${e.satFrac > 0.002 ? `｜条带内过曝 ${(e.satFrac * 100).toFixed(1)}%` : ''}`;
      t.innerHTML = `${th ? `<img src="${th.href}" alt="">` : ''}<span class="cap">${e.id === best ? '<b>★</b> ' : ''}${esc(App.expoLabel(rec))}${TAG[v] ? `<i>${TAG[v]}</i>` : ''}</span>`;
      t.onclick = done(() => { row.img = e.id; row.auto = e.id === best; App.viewBlot = row.blot; App.viewImg = row.img; });
      tiles.appendChild(t);
    });
    const ub = wrap.querySelector('[data-act="usebest"]');
    if (ub) ub.onclick = done(() => { row.img = best; row.auto = true; App.viewImg = best; });
    wrap.querySelectorAll('.bt-seg').forEach(div => {
      const sg = row.segs.find(s => s.piece === div.dataset.seg);
      if (!sg) return;
      div.addEventListener('mousedown', () => { if (App.selSeg !== sg.piece) { App.selSeg = sg.piece; App.selLane = null; G.View.draw(); wrap.querySelectorAll('.bt-seg').forEach(x => x.classList.toggle('sel', x === div)); } });
      div.querySelectorAll('[data-shift]').forEach(btn => btn.onclick = done(() => { if (!App.shiftCols(row, sg, +btn.dataset.shift)) toast('已经在第 1 列了：要让它比其他行更靠左，把其他行往右挪（›）'); }));
      div.querySelector('[data-act="redetect"]').onclick = done(() => {
        const n = App.editLanes(row, sg, () => App.redetectBox(row, sg));
        App.findBand(row, sg); App.selLane = null;
        const nm = sg.lanes.filter(l => l.r === 'm').length;
        toast(n ? `框内识别出 ${n} 道${nm ? `（另有 ${nm} 道 Marker）` : ''}` : '框里没识别到泳道：拖框调整范围，或填道数后点"排布"', 3200);
      });
      const pcOf = () => App.pieceOf(row, sg);
      div.querySelectorAll('[data-rot]').forEach(btn => btn.onclick = done(() => { App.setSegRot(pcOf(), sg, (sg.rot || 0) + +btn.dataset.rot); App.findBand(row, sg); }));
      div.querySelector('[data-act="level"]').onclick = done(() => { const d = App.levelBox(row, sg); toast(d != null ? `已按条带把框摆正（转了 ${d.toFixed(2)}°）` : '框里的条带不够清楚（至少 3 道），没有改；可以用 − + 或拖框上方的 ↻ 手动转'); });
      const r0 = div.querySelector('[data-act="rot0"]');
      if (r0) r0.onclick = done(() => { App.setSegRot(pcOf(), sg, 0); App.findBand(row, sg); });
      const inp = div.querySelector('.bt-even input');
      const even = done(() => { const n = App.editLanes(row, sg, () => App.evenEnds(row, sg, +inp.value)); App.selLane = null; toast(`已按最左、最右两条泳道等间距排布 ${n} 道`); });
      div.querySelector('[data-act="even"]').onclick = even;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); even(); } });
    });
    return wrap;
  }
  function selectRow(id, showImage) {
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
  $('btnAddRow').onclick = () => { if (!S()) return; App.setMode(App.mode === 'addrow' ? null : 'addrow'); };
  $('btnRedetect').onclick = () => {
    if (!S() || !confirm('按膜条重新识别所有蛋白框？\n现在调过的框、行的顺序和名字都会丢掉（Ctrl+Z 可撤销）。')) return;
    App.busy(true, '重新识别…');
    setTimeout(() => {
      S().blots.forEach(b => { App.reanalyze(b, { fresh: true }); S().rows.filter(r => r.blot === b.id).forEach(r => r.segs.forEach(sg => App.levelBox(r, sg))); });
      App.busy(false); App.commit(); toast('已重新识别所有蛋白框（Ctrl+Z 可撤销）');
    }, 20);
  };

  /* ---------- 3 lanes ---------- */
  function renderLanes() {
    const st = S(), n = st.lanes.length;
    const opts = sel => st.lanes.map((l, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}${l.name ? ' · ' + esc(l.name.replace(/\*/g, '')).slice(0, 10) : ''}</option>`).join('');
    $('rangeA').innerHTML = opts(st.range[0]); $('rangeB').innerHTML = opts(st.range[1]);
    $('laneList').innerHTML = st.lanes.map((l, i) => `<div class="item${i + 1 < st.range[0] || i + 1 > st.range[1] ? ' out' : ''}"><span class="idx">${i + 1}</span><span style="flex:1">${esc(l.name) || '<span class="muted">—</span>'}</span>
      <label class="switch"><input type="checkbox" data-j="${i + 1}" ${l.hidden ? '' : 'checked'}>显示</label></div>`).join('');
    $('laneList').querySelectorAll('[data-j]').forEach(c => c.addEventListener('change', done(e => { st.lanes[+c.dataset.j - 1].hidden = !e.target.checked; })));
  }
  const onRange = done(() => {
    let a = +$('rangeA').value, b = +$('rangeB').value; if (a > b) [a, b] = [b, a];
    S().range = [a, b];
  });
  $('rangeA').addEventListener('change', onRange); $('rangeB').addEventListener('change', onRange);
  $('btnRangeAuto').onclick = done(() => App.fitLanes(true));
  function applyBulk() {
    const raw = $('laneBulk').value.replace(/\r/g, '').trim(); if (!raw) return;
    let names = raw.includes('\t') ? raw.split(/\t|\n/) : raw.includes('\n') ? raw.split('\n') : raw.split(/[,，;；]/);
    names = names.map(s => s.trim());
    let fl = App.figLanes();
    if (names.length > fl.length) { const extra = names.length - fl.length; S().range[1] += extra; App.ensureLane(S().range[1]); fl = App.figLanes(); toast(`名称多于泳道，范围向右扩展 ${extra} 条`); }
    fl.forEach((j, k) => { if (k < names.length) S().lanes[j - 1].name = names[k]; });
    $('laneBulk').value = ''; App.commit(); toast(`已填入 ${Math.min(names.length, fl.length)} 个泳道名`);
  }
  $('laneBulk').addEventListener('change', applyBulk);

  /* ---------- 4 annotations ---------- */
  $('btnAddCond').onclick = done(() => { S().conditions.push({ name: '', values: S().lanes.map(() => '') }); toast('在成图上点每个格子切换 + / − / 空；点"条件"输入名称', 3200); });
  $('btnAddGroup').onclick = () => { if (S()) App.setMode(App.mode === 'group' ? null : 'group'); };
  $('btnAddArrow').onclick = () => { if (S()) App.setMode(App.mode === 'arrow' ? null : 'arrow'); };
  $('btnAddBracket').onclick = () => { if (S()) App.setMode(App.mode === 'bracket' ? null : 'bracket'); };
  /* a side bracket: its label (↵ = a line break, as in the list), the side, its own font size */
  function bracketPopover(k, at) {
    const bk = (S().brackets || [])[k], rs = bk ? App.bracketRows(bk) : [];
    if (!rs.length) return;
    const what = rs.length > 1 ? `${rs.length} 行（${rs.map(r => App.rowLabel(r)).join('、')}）` : `「${App.rowLabel(rs[0])}」${bk.f0 > 0.02 || bk.f1 < 0.98 ? '的一段' : '整行'}`;
    pop.innerHTML = `<h4>行旁括号 · ${esc(what)}</h4>
      <div class="field"><input type="text" id="pbText" value="${esc((bk.text || '').replace(/\n/g, ' ↵ '))}" placeholder="如 IP: Flag、Input、WCL、(Ub)n" title="↵ = 换行"></div>
      <div class="field inline"><label class="inline-label">放在</label><div class="seg"><button data-side="left" class="${bk.side !== 'right' ? 'on' : ''}">左边</button><button data-side="right" class="${bk.side === 'right' ? 'on' : ''}">右边</button></div></div>
      <div class="field inline"><label class="inline-label">字号</label><input type="number" id="pbPt" min="4" max="14" step="0.5" class="num" placeholder="${S().style.fontPt}" value="${bk.pt || ''}"> pt
        <span class="hint" style="margin:0">留空 = 跟随全局字号</span></div>
      <p class="hint">盖住的范围不对：删掉，再用"行旁括号"重新拖一个。</p>
      <div class="actions"><button class="btn sm danger" id="pbDel">删除</button><button class="btn sm primary" id="pbOk">完成</button></div>`;
    placePopNear(at);
    const q = id => pop.querySelector('#' + id);
    q('pbText').addEventListener('input', live(e => { bk.text = e.target.value.replace(/\s*↵\s*/g, '\n'); }));
    q('pbText').addEventListener('change', done());
    q('pbText').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) closePop(); });
    q('pbPt').addEventListener('input', live(e => { const v = +e.target.value; if (e.target.value !== '' && v >= 4 && v <= 14) bk.pt = v; else if (e.target.value === '') delete bk.pt; }));
    q('pbPt').addEventListener('change', done());
    pop.querySelectorAll('[data-side]').forEach(b => b.onclick = () => { bk.side = b.dataset.side; App.commit(); bracketPopover(S().brackets.indexOf(bk), at); });
    q('pbDel').onclick = () => { const i = S().brackets.indexOf(bk); if (i >= 0) S().brackets.splice(i, 1); dropPop(); App.commit(); toast('已删除这个括号（Ctrl+Z 可撤销）'); };
    q('pbOk').onclick = () => closePop();
    setTimeout(() => q('pbText') && q('pbText').focus({ preventScroll: true }), 0);
  }
  /* a target-band arrow (as GelFigure's): its name, where its size comes from (the marks; ≈ beyond the marked
   * bands) or a size typed in, the mark (an arrowhead; * # † for other bands), the side, its own font size */
  function arrowPopover(k, at) {
    const a = S().arrows[k]; if (!a) return;
    const row = App.row(a.row), est = App.arrowSize(a);
    let estHtml = '这条膜条还没标够 2 条 Marker 带：分子量无法估算（第 4 步标好后自动出现，或在下面填理论大小）';
    if (est) {
      estHtml = `按这条膜条标的 Marker 估算：<b>${esc(est)}</b>`;
      if (/≈/.test(est)) estHtml += '<br><span class="warn-t">在标过的 Marker 带范围之外，是外推值，成图上标 ≈</span>';
    }
    pop.innerHTML = `<h4>目标条带 · ${esc(row ? App.rowLabel(row) : '')}</h4>
      <div class="field"><input type="text" id="paText" value="${esc(a.text)}" placeholder="名称（可空），如 p-ERK1/2、剪切体"></div>
      <div class="field inline"><label class="inline-label">标记</label>
        <select id="paSym" style="width:auto"><option value="◀">◀ 箭头</option><option value="*">* 非特异条带</option><option value="#"># 降解产物等</option><option value="†">† 其他</option></select></div>
      <div class="est">${estHtml}</div>
      <div class="field inline"><label class="switch"><input type="checkbox" id="paAuto" ${a.auto ? 'checked' : ''}><span>标注大小</span></label>
        <input type="text" id="paSize" style="flex:1" value="${esc(a.sizeText || '')}" placeholder="${esc(est || '如 55 kDa')}" title="留空 = 用估算值；也可以填理论大小"></div>
      <div class="field inline"><label class="inline-label">放在</label><div class="seg"><button data-side="left" class="${a.side === 'left' ? 'on' : ''}">左边</button><button data-side="right" class="${a.side !== 'left' ? 'on' : ''}">右边</button></div>
        <span class="hint" style="margin:0">在成图上上下拖动箭头，可以移到这一行的另一条带</span></div>
      <div class="field inline"><label class="inline-label">字号</label><input type="number" id="paPt" min="4" max="14" step="0.5" class="num" placeholder="${S().style.fontPt}" value="${a.pt || ''}"> pt
        <span class="hint" style="margin:0">留空 = 跟随全局字号</span></div>
      <div class="actions"><button class="btn sm danger" id="paDel">删除</button><button class="btn sm primary" id="paOk">完成</button></div>`;
    pop.querySelector('#paSym').value = a.sym;
    placePopNear(at);
    const q = id => pop.querySelector('#' + id);
    q('paText').addEventListener('input', live(e => { a.text = e.target.value; }));
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
    q('paDel').onclick = () => { const i = S().arrows.indexOf(a); if (i >= 0) S().arrows.splice(i, 1); dropPop(); App.commit(); toast('已删除这个箭头（Ctrl+Z 可撤销）'); };
    q('paOk').onclick = () => closePop();
    setTimeout(() => q('paText') && q('paText').focus({ preventScroll: true }), 0);
  }
  function renderAnno() {
    const st = S(), rows = [];
    // (a one-line field: a group label's line breaks show as ↵ and come back as breaks)
    st.groups.forEach((g, k) => rows.push(`<div class="item"><span class="kind">分组</span><span class="idx" style="width:auto">${g.from}–${g.to}</span><input type="text" data-g="${k}" value="${esc((g.text || '').replace(/\n/g, ' ↵ '))}" placeholder="分组文字" title="↵ = 换行"><button class="x" data-gdel="${k}" aria-label="删除">×</button></div>`));
    st.conditions.forEach((c, r) => rows.push(`<div class="item"><span class="kind">条件</span><input type="text" data-c="${r}" value="${esc(c.name)}" placeholder="条件名，如 Dox"><button class="x" data-cdel="${r}">×</button></div>`));
    (st.arrows || []).forEach((a, k) => {
      const row = App.row(a.row); if (!row) return;
      const what = a.sym === '◀' ? App.arrowLabel(a) || '未标分子量' : a.sym + (a.text ? ' ' + a.text : '');
      rows.push(`<div class="item"><span class="kind">箭头</span><button class="link anno-arrow" data-a="${k}" title="点开修改">${esc(App.rowLabel(row))} · ${esc(what)}</button><button class="x" data-adel="${k}">×</button></div>`);
    });
    (st.brackets || []).forEach((bk, k) => {
      const rs = App.bracketRows(bk); if (!rs.length) return;
      const span = rs.length > 1 ? `${App.rowLabel(rs[0])} – ${App.rowLabel(rs[rs.length - 1])}` : App.rowLabel(rs[0]);
      rows.push(`<div class="item"><span class="kind">括号</span><button class="link anno-arrow" data-b="${k}" title="点开修改">${esc(span)} · ${esc((bk.text || '').replace(/\n/g, ' ') || '（没写文字）')}</button><button class="x" data-bdel="${k}">×</button></div>`);
    });
    const L = $('annoList'); L.innerHTML = rows.join('');
    L.querySelectorAll('[data-a]').forEach(b => b.onclick = () => arrowPopover(+b.dataset.a, b.getBoundingClientRect()));
    L.querySelectorAll('[data-adel]').forEach(b => b.onclick = done(() => st.arrows.splice(+b.dataset.adel, 1)));
    L.querySelectorAll('[data-b]').forEach(b => b.onclick = () => bracketPopover(+b.dataset.b, b.getBoundingClientRect()));
    L.querySelectorAll('[data-bdel]').forEach(b => b.onclick = done(() => st.brackets.splice(+b.dataset.bdel, 1)));
    L.querySelectorAll('[data-g]').forEach(i => { const g = st.groups[+i.dataset.g]; i.addEventListener('input', live(e => { g.text = e.target.value.replace(/\s*↵\s*/g, '\n'); })); i.addEventListener('change', done()); });
    L.querySelectorAll('[data-c]').forEach(i => { const c = st.conditions[+i.dataset.c]; i.addEventListener('input', live(e => { c.name = e.target.value; })); i.addEventListener('change', done()); });
    L.querySelectorAll('[data-gdel]').forEach(b => b.onclick = done(() => st.groups.splice(+b.dataset.gdel, 1)));
    L.querySelectorAll('[data-cdel]').forEach(b => b.onclick = done(() => st.conditions.splice(+b.dataset.cdel, 1)));
  }

  /* ---------- 5 layout ---------- */
  const num = (id, key, lo, hi) => $(id).addEventListener('change', done(e => { S().style[key] = clamp(+e.target.value || S().style[key], lo, hi); }));
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
    if (!S() || !target || !App.figLanes().length) return;
    const st = S().style, n = App.figLanes().length;
    for (let k = 0; k < 4; k++) {          // (labels hardly depend on the lane width: a few rounds converge)
      const total = G.BRender.build(false).w / App.MM;
      st.mmPerLane = clamp(Math.round((st.mmPerLane + (target - total) / n) * 10) / 10, 2, 15);
    }
    App.commit();
    const got = G.BRender.build(false).w / App.MM;
    toast(Math.abs(got - target) < 1.5 ? `成图总宽 ${got.toFixed(1)} mm（每道 ${st.mmPerLane} mm）`
      : `每道已到${st.mmPerLane >= 15 ? '最宽 15' : '最窄 2'} mm，成图总宽 ${got.toFixed(1)} mm（到不了 ${target} mm）`, 3600);
  });
  $('btnResetLayout').onclick = done(() => { App.resetLayout(); toast('版式已重置为默认（Ctrl+Z 可撤销）'); });
  // the bands' own resolution at this lane width, and the widest lane that keeps 300 dpi
  function updateDpiLine() {
    const eff = Math.round(App.effectiveDpi()), safe = App.maxSafeMmPerLane(300), mm = S().style.mmPerLane;
    if (!isFinite(eff)) { $('dpiLine').innerHTML = ''; return; }
    $('dpiLine').innerHTML = eff >= 300 ? `条带有效分辨率 <span class="ok">${eff} dpi</span>`
      : `条带有效分辨率 <span class="bad">${eff} dpi</span>（&lt; 300）：每道不超过 <b>${safe} mm</b> 才能保证 300 dpi` + (safe >= 2 && mm > safe ? ` <button class="btn sm" id="btnSafeW">改为 ${safe} mm</button>` : '');
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
    $('imgTabs').innerHTML = imgs.map(r => `<button data-img="${r.id}" class="${rec && r.id === rec.id ? 'on' : ''}" title="${esc(r.name)}">${r.kind === 'marker' ? `白光<span class="tag-m">${r.id === b.marker ? 'Marker' : '其他'}</span>` : esc(App.expoLabel(r))}</button>`).join('');
    $('imgTabs').querySelectorAll('button').forEach(btn => btn.onclick = () => { App.viewImg = btn.dataset.img; App.emit('select'); });
    // the picture shown: its tab scrolled into sight
    const on = $('imgTabs').querySelector('button.on');
    if (on) { const T = $('imgTabs'), a = on.getBoundingClientRect(), c = T.getBoundingClientRect(); if (a.left < c.left || a.right > c.right) T.scrollLeft += a.left - c.left - (c.width - a.width) / 2; }
    const isC = rec && rec.kind === 'chemi';
    $('levelBar').classList.toggle('hidden', !isC);
    if (isC) {
      // the selected row shown in its own picture: the bar adjusts that row alone (else the whole picture)
      const row = lvRow(), sel = App.selRow && App.row(App.selRow), users = st.rows.filter(r => r.img === rec.id && !r.hidden);
      const lv = row ? App.rowLevels(row) : App.levelsOf(rec.id);
      $('levelName').innerHTML = row ? `调整 <b>${esc(App.rowLabel(row).replace(/ 行$/, ''))}</b>（只这一行）<button class="link" id="lvToImg" title="改这张图的所有行">改整张图</button>`
        : `${users.length ? `调整整张图（${users.length} 行用它）` : '这张图未被使用'}${sel && sel.img === rec.id ? '<button class="link" id="lvToRow">只调选中的行</button>' : ''}`;
      if ($('lvToImg')) $('lvToImg').onclick = () => { lvImage = true; renderStageHead(); };
      if ($('lvToRow')) $('lvToRow').onclick = () => { lvImage = false; renderStageHead(); };
      $('lvBlack').value = toSl(lv.black); $('lvWhite').value = toSl(lv.white);
    }
  }
  // the bar on the whole picture although a row is selected (until another row is)
  let lvImage = false, lvSel = null;
  function lvRow() {
    if (App.selRow !== lvSel) { lvSel = App.selRow; lvImage = false; }
    const r = App.selRow && App.row(App.selRow), rec = G.View.curImage();
    return !lvImage && r && rec && r.img === rec.id ? r : null;
  }
  $('viewBlot').addEventListener('change', e => { App.viewBlot = e.target.value; App.viewImg = null; App.emit('select'); G.View.fitFull(); });
  const lvSet = (key) => live(e => {
    const rec = G.View.curImage(); if (!rec) return;
    const row = lvRow(), lv = Object.assign({}, row ? App.rowLevels(row) : App.levelsOf(rec.id)), v = fromSl(+e.target.value);
    if (key === 'black') lv.black = Math.min(v, lv.white - 0.0005); else lv.white = Math.max(v, lv.black + 0.0005);
    if (row) row.lv = { black: lv.black, white: lv.white };
    else { lv.manual = true; S().levels[rec.id] = lv; G.View.draw(); }
  });
  $('lvBlack').addEventListener('input', lvSet('black')); $('lvWhite').addEventListener('input', lvSet('white'));
  $('lvBlack').addEventListener('change', done()); $('lvWhite').addEventListener('change', done());
  $('btnLvAuto').onclick = done(() => { const rec = G.View.curImage(), row = lvRow(); if (row) delete row.lv; else if (rec) { delete S().levels[rec.id]; App.refreshChoices(); } });
  $('showSat').addEventListener('change', () => G.View.draw());
  $('fitFull').onclick = () => G.View.fitFull();
  $('fitSel').onclick = () => { const r = App.selRow && App.row(App.selRow); if (!r) return; if (App.viewBlot !== r.blot) { App.viewBlot = r.blot; App.viewImg = r.img; App.emit('select'); } G.View.fitRow(r); };

  /* ---------- preview + direct editing ---------- */
  const prev = $('preview'), fed = $('floatEd');
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
      $('legendHints').innerHTML = ck.legend.length ? '<b>图注可参考</b>' + ck.legend.map(esc).join('<br>') : '';
    }
    if (edit) { const el = editEl(edit); if (el) el.classList.add('active'); }
  }
  const getV = e => e.kind === 'lane' ? S().lanes[e.id - 1].name : e.kind === 'rowname' ? (App.row(e.id) || {}).name : e.kind === 'group' ? S().groups[e.id].text : S().conditions[e.id].name;
  const setV = (e, v) => { if (e.kind === 'lane') S().lanes[e.id - 1].name = v; else if (e.kind === 'rowname') { const r = App.row(e.id); if (r) r.name = v; } else if (e.kind === 'group') S().groups[e.id].text = v; else S().conditions[e.id].name = v; };
  const editEl = e => prev.querySelector(e.kind === 'lane' ? `g[data-edit="lane"][data-j="${e.id}"]` : e.kind === 'rowname' ? `g[data-edit="rowname"][data-row="${e.id}"]` : e.kind === 'group' ? `g[data-edit="group"][data-k="${e.id}"]` : `g[data-edit="condname"][data-r="${e.id}"]`);
  /* the text editor over the figure: one line (with the protein-name suggestions), or several for a group label
   * (Shift+Enter); under it a bar with the font size of what is edited (lane names and protein names share one
   * each, a group or a condition row has its own) and, for a group, a line break (as GelFigure) */
  const fta = $('floatTa'), bar = $('fedBar');
  const edBox = () => (edit && edit.kind === 'group' ? fta : fed);
  const sizeHost = () => (edit.kind === 'lane' ? { o: S().style, k: 'lanePt' } : edit.kind === 'rowname' ? { o: S().style, k: 'namePt' }
    : { o: edit.kind === 'group' ? S().groups[edit.id] : S().conditions[edit.id], k: 'pt' });
  const curSize = () => { const h = sizeHost(); return (h.o && h.o[h.k]) || S().style.fontPt; };
  function setSize(v) {
    const h = sizeHost(); if (!h.o) return;
    if (v == null || v === S().style.fontPt) { if (h.k === 'pt') delete h.o.pt; else h.o[h.k] = null; }
    else h.o[h.k] = clamp(Math.round(v * 2) / 2, 4, 14);
    syncBar(); App.refresh();
  }
  function syncBar() {
    if (!edit) return;
    const h = sizeHost(), own = h.o && h.o[h.k];
    $('fedSizeLbl').textContent = edit.kind === 'lane' ? '泳道名字号' : edit.kind === 'rowname' ? '蛋白名字号' : edit.kind === 'group' ? '字号' : '本行字号';
    $('fedSize').textContent = curSize() + ' pt';
    $('fedReset').classList.toggle('hidden', !own);
    $('fedBr').classList.toggle('hidden', edit.kind !== 'group');
    $('fedHint').textContent = edit.kind === 'group' ? 'Shift+Enter 换行' : '';
  }
  function placeBar() {
    const r = edBox().getBoundingClientRect();
    bar.classList.remove('hidden');
    const below = r.bottom + 4 + bar.offsetHeight < innerHeight;
    bar.style.left = clamp(r.left, 4, Math.max(4, innerWidth - bar.offsetWidth - 4)) + 'px';
    bar.style.top = (below ? r.bottom + 4 : r.top - bar.offsetHeight - 4) + 'px';
  }
  // the multi-line editor grows with typed line breaks
  const autoRows = () => { fta.rows = Math.min(4, Math.max(1, fta.value.split('\n').length)); if (edit) placeBar(); };
  function openEd(kind, id) {
    if (edit) closeEd(false);          // (a previous editor whose blur has not been handled yet)
    closePop();
    const e = { kind, id }, el = editEl(e); if (!el) return;
    const r = el.getBoundingClientRect();
    edit = Object.assign(e, { orig: getV(e) || '' });
    const box = edBox();
    box.value = edit.orig;
    box.placeholder = kind === 'lane' ? `泳道 ${id} 名称` : kind === 'rowname' ? '蛋白名（如 GAPDH）' : kind === 'group' ? '分组文字' : '条件名';
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
    fed.classList.add('hidden'); fta.classList.add('hidden'); bar.classList.add('hidden');
    App.commit();
  }
  let barPress = false;
  [fed, fta].forEach(box => {
    box.addEventListener('input', () => {
      if (!edit || edBox() !== box) return;
      if (edit.kind !== 'group' && box.value.includes('\n')) box.value = box.value.replace(/\n/g, ' ');     // (pasted text)
      setV(edit, box.value); if (box === fta) autoRows(); App.refresh();
    });
    box.addEventListener('keydown', e => {
      if (!edit || composing(e)) return;          // (the IME is choosing characters: Enter belongs to it)
      if (e.key === 'Escape') { e.preventDefault(); closeEd(true); return; }
      if (e.key === 'Enter' && edit.kind === 'group' && (e.shiftKey || e.altKey)) return;      // a line break (the textarea inserts it)
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault();
      const { kind, id } = edit; closeEd(false);
      const back = e.shiftKey;
      if (kind === 'lane') {
        const fl = App.figLanes(), k = fl.indexOf(id) + (back ? -1 : 1);
        if (k >= 0 && k < fl.length) requestAnimationFrame(() => openEd('lane', fl[k])); else toast('泳道名称填完了');
      } else if (kind === 'rowname') {
        const vis = S().rows.filter(r => !r.hidden), k = vis.findIndex(r => r.id === id) + (back ? -1 : 1);
        if (k >= 0 && k < vis.length) requestAnimationFrame(() => openEd('rowname', vis[k].id)); else toast('蛋白名填完了');
      }
    });
    // leaving the field finishes the edit — unless it went to the size / line-break bar
    box.addEventListener('blur', () => setTimeout(() => { if (edit && !barPress && document.activeElement !== edBox()) closeEd(false); }, 120));
  });
  bar.addEventListener('pointerdown', e => { barPress = true; e.preventDefault(); setTimeout(() => { barPress = false; }, 800); });
  bar.addEventListener('mousedown', e => e.preventDefault());       // (the focus stays in the text field)
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-fz]'); barPress = false;
    if (!b || !edit) return;
    const k = b.dataset.fz;
    if (k === '+' || k === '-') setSize(curSize() + (k === '+' ? 0.5 : -0.5));
    else if (k === 'reset') setSize(null);
    else if (k === 'br' && edit.kind === 'group') { fta.setRangeText('\n', fta.selectionStart, fta.selectionEnd, 'end'); fta.dispatchEvent(new Event('input')); }
    edBox().focus();
  });
  function editRowName(id) { requestAnimationFrame(() => requestAnimationFrame(() => openEd('rowname', id))); }
  // undo / redo / another project: open editors belong to the old state — dropped without writing back
  App.onSwap = () => {
    if (edit) { edit = null; fed.classList.add('hidden'); fta.classList.add('hidden'); bar.classList.add('hidden'); }
    dropPop();
  };

  let press = null;
  const laneAt = (x, y) => { const el = document.elementFromPoint(x, y), g = el && el.closest && el.closest('g[data-edit="lane"]'); return g ? +g.dataset.j : null; };
  const hl = (a, b) => prev.querySelectorAll('g[data-edit="lane"]').forEach(g => { const j = +g.dataset.j; g.classList.toggle('active', a != null && j >= Math.min(a, b) && j <= Math.max(a, b)); });
  prev.addEventListener('mousedown', e => {
    if (App.mode === 'bracket') return;
    const g = e.target.closest('g[data-edit="lane"]');
    if (g) { press = { j: +g.dataset.j, end: +g.dataset.j, x: e.clientX, y: e.clientY, moved: false }; e.preventDefault(); }
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
  function rowAtY(my, alt) {
    const rs = rowRects(lastFig);
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
    Object.assign(gh.style, { left: (right ? sr.right - pr.left + 2 : sr.left - pr.left - 9) + 'px', top: y1 + 'px', height: Math.max(2, y2 - y1) + 'px' });
    const ids = new Set([d.a.r.id, d.b.r.id]), n = ids.size === 1 ? 1 : App.bracketRows({ r0: d.a.r.id, r1: d.b.r.id }).filter(r => !r.hidden).length;
    // (above the bracket: the rows below the pointer stay visible)
    tipAt(ov, (right ? sr.right - pr.left + 14 : sr.left - pr.left + 6), Math.max(2, y1 - 26), n > 1 ? `盖住 ${n} 行（如 IP / Input）` : d.a.f === 0 && d.b.f === 1 || d.a.f === 1 && d.b.f === 0 ? '整行' : '一行里的一段（如 (Ub)n 拖尾）');
  }
  prev.addEventListener('mousedown', e => {
    if (e.button !== 0 || !S() || App.mode !== 'bracket' || !lastFig) return;
    const a = rowAtY(e.clientY - prev.getBoundingClientRect().top, e.altKey); if (!a) return;
    bdrag = { a, b: a, y0: e.clientY, moved: false };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!bdrag) return;
    if (Math.abs(e.clientY - bdrag.y0) > 4) bdrag.moved = true;
    if (!bdrag.moved) return;
    bdrag.b = rowAtY(e.clientY - prev.getBoundingClientRect().top, e.altKey) || bdrag.b;
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
    else if (a.r.id === b.r.id && Math.abs(a.f - b.f) < 0.05) { toast('拖得太短：沿着行上下拖，或在一行上点一下盖住整行'); return; }
    const bk = App.addBracket(a.r.id, a.f, b.r.id, b.f);
    App.setMode(null); App.commit();
    const k = S().brackets.indexOf(bk), g = prev.querySelector(`g[data-edit="bracket"][data-k="${k}"]`);
    if (g) bracketPopover(k, g.getBoundingClientRect());
  });
  prev.addEventListener('click', e => {
    if (!S() || swallowClick) return;
    const img = e.target.closest('image[data-row]');
    if (img && App.mode === 'arrow') { placeArrow(img.dataset.row, e.clientY); return; }
    if (img) { selectRow(img.dataset.row, true); return; }
    const g = e.target.closest('[data-edit]');
    if (!g) { if (App.mode === 'arrow') toast('请点在成图里某一行的条带上'); return; }
    const kind = g.dataset.edit;
    if (kind === 'arrow') arrowPopover(+g.dataset.k, g.getBoundingClientRect());
    else if (kind === 'bracket') bracketPopover(+g.dataset.k, g.getBoundingClientRect());
    else if (kind === 'rowname') openEd('rowname', g.dataset.row);
    else if (kind === 'group') openEd('group', +g.dataset.k);
    else if (kind === 'condname') openEd('condname', +g.dataset.r);
    else if (kind === 'cond') {
      const c = S().conditions[+g.dataset.r], j = +g.dataset.j, cyc = { '': '+', '+': '−', '−': '' };
      while (c.values.length < j) c.values.push('');
      c.values[j - 1] = cyc[c.values[j - 1] || ''] != null ? cyc[c.values[j - 1] || ''] : '';
      App.commit();
    }
  });

  /* ---------- arranging the figure ----------
   * Every row comes from one or more pieces of membrane (modules: own angle, lanes, marker). In the figure a
   * row is dragged up / down to its place, onto another row to stand side by side with it (one protein on a
   * membrane cut through), or left / right to line its piece's lanes up with the other rows — every row on
   * that piece moves along (they share its lanes); Alt: only that box. Tags left of the rows name the pieces
   * and drag rows too; in the list, the ⋮⋮ grip drags rows. */
  let prevScale = 1, pdrag = null, ldrag = null, swallowClick = false;
  // rows of the figure on screen, relative to #preview (top / bottom, left / right of the lanes)
  function rowRects(f) {
    const svg = prev.querySelector('svg'), m = svg && svg.getScreenCTM && svg.getScreenCTM();
    if (!m || !f || !f.rowBoxes) return [];
    const pr = prev.getBoundingClientRect(), p = svg.createSVGPoint();
    const at = (x, y) => { p.x = x; p.y = y; const q = p.matrixTransform(m); return { x: q.x - pr.left, y: q.y - pr.top }; };
    return f.rowBoxes.map(rb => { const a = at(0, rb.y), b = at(f.figW, rb.y + rb.h); return { id: rb.id, x0: a.x, x1: b.x, top: a.y, bot: b.y }; });
  }
  function drawRowTags(f) {
    const svg = prev.querySelector('svg'); if (!svg) return;
    const ov = document.createElement('div'); ov.className = 'prev-ov'; prev.appendChild(ov);
    const left = svg.getBoundingClientRect().left - prev.getBoundingClientRect().left;
    rowRects(f).forEach(r => {
      const row = App.row(r.id); if (!row) return;
      const t = document.createElement('div');
      t.className = 'rowtag' + (row.id === App.selRow ? ' sel' : ''); t.dataset.row = r.id; t.textContent = modLabel(row);
      t.title = `来自膜条 ${modLabel(row)}。上下拖动调整顺序，拖到另一行上并排成一行；在成图上左右拖动条带对齐泳道`;
      t.style.left = (left - 5) + 'px'; t.style.top = ((r.top + r.bot) / 2) + 'px';
      ov.appendChild(t);
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
    toast(App.arrowSize(a) ? `已标出 ${App.arrowSize(a)}：可以加名称、换成 * # †、放到另一边` : '已加箭头：第 4 步标好 Marker 后自动显示分子量', 3600);
  }
  prev.addEventListener('mousedown', e => {
    if (e.button !== 0 || !S() || App.mode === 'arrow' || App.mode === 'bracket') return;
    const tag = e.target.closest('.rowtag'), img = !tag && e.target.closest('image[data-row]');
    if (!tag && !img) return;
    pdrag = { id: (tag || img).dataset.row, piece: img ? img.dataset.piece : null, x0: e.clientX, y0: e.clientY, mode: null, onlyOrder: !!tag, k: 0, drop: null, alt: false };
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
    if (pdrag.mode === 'order') {
      ghost(`[data-row="${pdrag.id}"]`, 0, dy / prevScale);
      const rs = rowRects(lastFig), me = rs.findIndex(r => r.id === pdrag.id);
      // on the middle of another row: side by side with it; else between the rows nearest the pointer
      let drop = null;
      for (let i = 0; i < rs.length && !drop; i++) {
        const r = rs[i], hh = r.bot - r.top;
        if (i !== me && my > r.top + hh * 0.3 && my < r.bot - hh * 0.3) drop = { onto: r.id, r };
        else if (my < (r.top + r.bot) / 2) drop = { at: i };
      }
      if (!drop) drop = { at: rs.length };
      pdrag.drop = drop;
      line.classList.toggle('hidden', !!drop.onto); boxEl.classList.toggle('hidden', !drop.onto);
      if (drop.onto) {
        Object.assign(boxEl.style, { left: drop.r.x0 - 3 + 'px', top: drop.r.top - 3 + 'px', width: drop.r.x1 - drop.r.x0 + 6 + 'px', height: drop.r.bot - drop.r.top + 6 + 'px' });
        tipAt(ov, mx + 14, my + 10, '松开：并排成一行（同一个蛋白，膜竖着剪开过）');
      } else {
        const a = rs[drop.at - 1], b = rs[drop.at], y = !rs.length ? 0 : !a ? b.top - 3 : !b ? a.bot + 3 : (a.bot + b.top) / 2, ref = rs[0] || { x0: 0, x1: 100 };
        Object.assign(line.style, { left: ref.x0 - 8 + 'px', top: y + 'px', width: ref.x1 - ref.x0 + 16 + 'px' });
        tipAt(ov, mx + 14, my + 10, '');
      }
    } else {
      const k = Math.round(dx / prevScale / lastFig.laneW), row = App.row(pdrag.id), pc = row && App.findPiece(pdrag.piece);
      pdrag.k = k; pdrag.alt = e.altKey;
      ghost(e.altKey ? `[data-row="${pdrag.id}"][data-piece="${pdrag.piece}"]` : `[data-piece="${pdrag.piece}"]`, k * lastFig.laneW, 0);
      const who = pc ? `膜条 ${pc.pc.letter}` : '这一行';
      tipAt(ov, mx + 14, my + 10, k ? `${who}${e.altKey ? '（只这个框）' : '（这条膜条上的行一起）'}往${k > 0 ? '右' : '左'}挪 ${Math.abs(k)} 列` : '左右拖：对齐泳道（按住 Alt 只挪这个框）');
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
    if (d.mode === 'order' && d.drop && d.drop.onto) {
      const res = App.mergeRows(App.row(d.drop.onto), row);
      if (res === 'joined') { App.selRow = d.drop.onto; App.commit(); toast('已并排成一行：两个框按左右接成连续的列；"拆开"可撤回'); return; }
      toast(res === 'blot' ? '这两行来自不同的膜（不同的图片），不能并成一行' : res === 'same' ? '这两行在同一条膜条上，是两个不同的蛋白，不能并成一行'
        : res === 'stacked' ? '这两条膜条上下叠放、泳道相同，是不同的蛋白，不能并成一行' : '没有改动', 3400);
      updatePreview();
    } else if (d.mode === 'order' && d.drop) {
      const rs = (lastFig.rowBoxes || []).map(b => b.id), rows = S().rows;
      const to = d.drop.at < rs.length ? rows.findIndex(r => r.id === rs[d.drop.at]) : rows.findIndex(r => r.id === rs[rs.length - 1]) + 1;
      if (App.moveRow(d.id, to)) { App.commit(); toast('已调整行的上下顺序'); } else updatePreview();
    } else if (d.mode === 'align' && d.k) {
      const sg = row.segs.find(s => s.piece === d.piece);
      if (!sg) { updatePreview(); return; }
      const mv = App.shiftAlign(row, sg, d.k, d.alt);
      if (!mv.n) { updatePreview(); toast('已经在第 1 列了：要让它比其他行更靠左，把其他行往右拖', 3200); return; }
      App.commit();
      toast(`${d.alt || mv.n < 2 ? '这个框' : `膜条 ${(App.findPiece(d.piece) || { pc: {} }).pc.letter} 上的 ${mv.n} 个框`}往${mv.d > 0 ? '右' : '左'}挪了 ${Math.abs(mv.d)} 列${mv.d !== d.k ? '（最左到第 1 列）' : ''}`);
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
    if (App.moveRow(d.id, to)) { App.commit(); toast('已调整行的顺序'); }
  });

  /* ---------- the steps: one after the other, each on what the one before established ----------
   * S.step: how far the user has come; App.curStep: the step open. The open step shows its body and (steps 2 and
   * 4) runs its mode on the membrane view; done steps fold to a line and open again on a click; later ones wait.
   * The top bar says what to do in the open step, and a click on it does it. */
  const STEP_SEC = { 1: 'secImages', 2: 'secPieces', 3: 'secRows', 4: 'secMarker', 5: 'secNames' };
  // the pieces the figure uses that have fewer than 2 marks ({b, pc}), and them in words: "膜条 B、C" /
  // "膜 1 的膜条 B、C，膜 2 的膜条 A"
  const unmarked = () => S().blots.flatMap(b => App.usedPieces(b).filter(pc => App.markInfo(b, pc).state !== 'manual').map(pc => ({ b, pc })));
  const piecesText = list => {
    const by = new Map(); list.forEach(t => { if (!by.has(t.b)) by.set(t.b, []); by.get(t.b).push(t.pc.letter); });
    return [...by].map(([b, ls]) => (S().blots.length > 1 ? `${App.blotName(b)} 的` : '') + '膜条 ' + ls.join('、')).join('，');
  };
  const goTo = id => { const el = $(id); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const flash = x => { const el = typeof x === 'string' ? $(x) : x; if (!el) return; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); };
  function openStep(n) {
    const st = S(); if (!st) return;
    n = Math.max(1, Math.min(n, st.step));
    closePop();
    const was = App.curStep, b = App.blot(App.viewBlot) || st.blots[0];
    const go = () => {
      App.curStep = n;
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
  function nextStep(n) {
    const st = S(); if (!st) return;
    if (n === 1) {
      const none = st.blots.filter(b => !App.markerRec(b));
      if (none.length && !confirm(`${none.map(App.blotName).join('、')} 没有 Marker 图：膜条只能按曝光图的信号找，也不能标分子量。继续？`)) return;
    }
    if (n === 4 && st.style.showMW) {
      const todo = unmarked();
      if (todo.length && !confirm(`${piecesText(todo)} 还没标够 2 条 Marker 带：成图里这些膜条上的行没有分子量刻度。\n仍然继续？（以后可以回到第 4 步补标）`)) return;
    }
    if (n === 2) {
      const b = App.blot(App.viewBlot) || st.blots[0], pcs = App.mode === 'pieces' ? G.View.piecesEnd(true) : null;
      // a membrane whose pieces were not looked at yet: that one first
      const more = pcUnseen();
      if (more) { applyPieces(b, pcs, false, () => { startPieces(more); renderPieces(); updateCoach(); toast(`${App.blotName(b)} 的膜条好了，再看 ${App.blotName(more)} 的`, 3200); }); return; }
      if (App.mode === 'pieces') App.setMode(null);
      applyPieces(b, pcs, false, () => {
        App.busy(true, '找每个蛋白的条带…');
        setTimeout(() => {
          const had = st.rows.length;
          App.makeBoxes();
          App.busy(false);
          st.step = Math.max(st.step, 3); App.curStep = 3;
          App.selRow = null; App.viewImg = null;
          if (!had) App.viewBlot = st.blots[0].id;          // (the boxes from the first membrane on)
          App.commit(); G.View.fitFull(); goTo('secRows');
          const n3 = st.rows.filter(r => !r.hidden).length;
          toast(had ? '膜条已更新，框都留在原处' : n3 ? `找到 ${n3} 个蛋白，右边就是成图。点框检查，好了点"下一步"` : '没找到蛋白条带：点"+ 添加一个蛋白框"自己框', 4200);
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
      const r = S().rows.find(x => !x.hidden && !x.name), i = r && $('nameList').querySelector(`.name-item[data-id="${r.id}"] input`);
      if (i) i.focus();
    }, 300);
  };
  $('skip4').onclick = () => { S().style.showMW = false; toast('这次不标分子量：成图不显示分子量刻度（第 5 步"更多版式"里可以再打开）', 3600); nextStep(4); };
  // a done step's header opens it again
  Object.entries(STEP_SEC).forEach(([n, id]) => $(id).querySelector('.sec-head').addEventListener('click', () => { if (S() && +n <= S().step && +n !== App.curStep) openStep(+n); }));

  let coachAct = null;
  function updateCoach() {
    const st = S(), n = App.curStep || st.step, vis = st.rows.filter(r => !r.hidden), fl = App.figLanes();
    let msg, ok = false;
    coachAct = null;
    if (n === 1) { msg = `第 1 步：确认每张膜的 <b>Marker 图</b>（左边标 ★ 的那张），对了就点"下一步"`; coachAct = () => flash('next1'); }
    else if (n === 2) {
      const many = st.blots.length > 1 ? `（${esc(App.blotName(App.blot(App.viewBlot)))}${pcUnseen() ? '，看完再看下一张膜' : ''}）` : '';
      msg = `第 2 步：看<b>蓝框</b>是不是刚好框住每条膜${many}，不对就在图上拖动修改；对了点"下一步"`; coachAct = () => flash('next2');
    }
    else if (n === 3) {
      if (!vis.length) { msg = '第 3 步：没找到蛋白条带，<b>点这里</b>再到膜上点一下放一个框'; coachAct = () => App.setMode('addrow'); }
      else { msg = `第 3 步：检查每个<b>蛋白框</b>（点框选中，拖边角改大小，泳道线拖到泳道中心），好了点"下一步"`; coachAct = () => flash('next3'); }
    } else if (n === 4) {
      const todo = unmarked();
      const noLad = st.blots.find(b => !b.ladderId);
      if (noLad) { msg = '第 4 步：先在左边<b>选你用的 Marker 型号</b>（只需选一次）'; coachAct = () => { const s = document.querySelector(`.mk-blot[data-blot="${noLad.id}"] .ladder-sel`); if (s) { s.focus(); flash(s); } }; }
      else if (todo.length) { msg = `第 4 步：在 Marker 图上<b>点 Marker 条带</b>，选分子量（还没标够 2 条：${esc(piecesText(todo))}）`; coachAct = () => startMarks(todo[0].b, todo[0].pc); }
      else { msg = '第 4 步：每条膜条都标好了，点"下一步"'; coachAct = () => flash('next4'); }
    } else {
      const unnamedRows = vis.filter(r => !r.name), unnamedLanes = fl.filter(j => !st.lanes[j - 1].name);
      const sat = vis.filter(r => { const e = App.rowExpo(r).find(x => x.id === r.img); return e && e.satFrac > 0.002; });
      if (unnamedRows.length) { msg = `第 5 步：<b>输入蛋白名</b>（还差 ${unnamedRows.length} 行，回车跳下一个）`; coachAct = () => { const i = $('nameList').querySelector(`.name-item[data-id="${unnamedRows[0].id}"] input`); if (i) i.focus(); else openEd('rowname', unnamedRows[0].id); }; }
      else if (unnamedLanes.length) { msg = `第 5 步：<b>输入泳道名</b>（成图上方灰色数字，还差 ${unnamedLanes.length} 条）`; coachAct = () => openEd('lane', unnamedLanes[0]); }
      else if (sat.length) { msg = `「${esc(sat[0].name)}」所选曝光有过曝：<b>点这里</b>换一张更短的曝光`; coachAct = () => { openStep(3); selectRow(sat[0].id, true); }; }
      else { msg = '可以导出了 —— 右上角<b>导出 PNG</b>；补充材料用"未裁切原图"'; ok = true; coachAct = () => flash('btnPNG'); }
    }
    $('coachText').innerHTML = msg + (coachAct && !ok ? ' <span class="coach-go">→</span>' : '');
    $('coach').classList.toggle('done', ok); $('coach').classList.toggle('act', !!coachAct);
    $('imgCount').textContent = `${App.images.size} 张图 · 添加`;
  }
  $('coach').addEventListener('click', () => { if (coachAct) coachAct(); });
  // the steps' look: open / done / waiting; the figure's placeholder until there are boxes
  function renderSteps() {
    const st = S(), cur = App.curStep || st.step;
    Object.entries(STEP_SEC).forEach(([n, id]) => {
      n = +n;
      const el = $(id);
      el.classList.toggle('cur', n === cur); el.classList.toggle('done', n < st.step); el.classList.toggle('reach', n === st.step && n !== cur); el.classList.toggle('locked', n > st.step);
    });
    // (a membrane added later goes through the steps again: the figure there is already stays)
    $('figEmpty').classList.toggle('hidden', !!st.rows.length);
    $('feSub').textContent = '按左边的步骤走，第 3 步之后成图出现在这里';
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
  $('tourOk').onclick = () => { $('tour').classList.add('hidden'); try { localStorage.setItem('blotfig.tour', '1'); } catch (e) { /* storage off */ } };
  $('btnTourAgain').onclick = () => { $('helpDlg').classList.add('hidden'); if (S()) showTour(); };

  function syncLayout() {
    const y = S().style;
    $('mmPerLane').value = y.mmPerLane; $('fontPt').value = y.fontPt; $('rowGap').value = y.rowGapPt; $('labelAngle').value = String(y.labelAngle);
    $('lineW').value = y.lineWidthPt;
    ['lanePt', 'namePt', 'markerPt'].forEach(id => { $(id).value = y[id] || ''; $(id).placeholder = y.fontPt; });
    $('groupFit').value = y.groupFit || 'wrap'; $('minFontPt').value = y.minFontPt || 5;
    $('minFontRow').classList.toggle('hidden', (y.groupFit || 'wrap') !== 'shrink');
    $('invert').checked = y.invert; $('showMW').checked = y.showMW; $('unitHeader').checked = y.unitHeader; $('border').checked = !!y.border; $('panelLetter').value = y.panelLetter || '';
    $('laneNumbers').checked = !!y.laneNumbers; $('groupTicks').checked = !!y.groupTicks;
    $('mwSide').value = y.mwSide || 'left'; $('nameSide').value = y.nameSide || 'right';
    $('dpiTop').value = String(y.dpi);
    $('stLayout').textContent = `${y.mmPerLane} mm/泳道 · ${y.fontPt} pt`;
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
    if (!S()) return;
    if (what === 'loaded') {
      $('emptyState').classList.add('hidden'); $('sections').classList.remove('hidden'); $('draftBox').classList.add('hidden');
      // the step to go on with (a membrane just added: its Marker picture first)
      App.curStep = S().step;
      if (App.curStep === 1) { const b = App.blot(App.viewBlot); if (b && b.marker) App.viewImg = b.marker; }
      G.View.fitFull();               // (the membrane view drew before the step was known)
      // (a project saved in step 2 or 4: back in that step's mode)
      if (App.curStep === 2 || App.curStep === 4) setTimeout(() => openStep(App.curStep), 0);
      let seen = true; try { seen = !!localStorage.getItem('blotfig.tour'); } catch (e) { /* storage off */ }
      const dev = qs.get('demo') || qs.get('srcdir') || qs.get('demomove');     // (scripted runs: only with &tour=1)
      if (!seen && (!dev || qs.get('tour'))) setTimeout(showTour, 400);
    }
    if (what === 'refresh') { updatePreview(); return; }
    if (what === 'select') { keepFocus(() => { renderBlots(); renderPieces(); renderMarker(); renderRows(); }); showSelRow(); renderStageHead(); renderSteps(); updatePreview(); G.View.draw(); return; }
    keepFocus(() => { renderBlots(); renderPieces(); renderMarker(); renderRows(); renderNames(); renderLanes(); renderAnno(); });
    showSelRow(); renderStageHead(); syncLayout(); renderSteps(); updateCoach(); updatePreview();
  });
  window.addEventListener('resize', () => { if (S()) updatePreview(); });

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
      const vis = new Set(App.figLanes());
      st.rows.filter(r => !r.hidden && r.blot === p.b.id && (p.rec.kind === 'marker' || r.img === p.rec.id)).forEach(r => {
        let last = null;
        r.segs.forEach(sg => {
          const pc = App.piece(p.b, sg.piece); if (!pc || !sg.lanes.length) return;
          const F = App.segFrame(pc, sg), vT = sg.vc - r.above, vB = sg.vc + r.below;   // (a tilted box drawn tilted)
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
        if (last) { ctx.fillStyle = '#e03131'; ctx.font = `bold ${fs * 0.7}px Arial`; ctx.fillText(`${r.name || '?'}`, last[0] * sc + 6, top + last[1] * sc + fs * 0.7); }
      });
      y0 += heights[k];
    });
    c.toBlob(bl => G.Export.download(bl, 'uncropped_originals.png'), 'image/png');
    toast(`已导出未裁切原图（${pages.length} 张）`);
  }
  function exportQuant() {
    const st = S(), C = App.columns(), fl = C.vis;
    const data = C.rows.map((r, ri) => {
      const b = App.blot(r.blot), rec = App.images.get(r.img);
      // (in the box's own frame: a tilted box is read along its tilt, as in the figure)
      const lanes = C.src[ri].map(s => s && s.pc && { F: App.segFrame(s.pc, s.sg), uc: s.u, hw: App.segPitch(s.sg) * 0.33,
        vTop: s.sg.vc - r.above, vBot: s.sg.vc + r.below, b0: s.sg.vc + s.sg.b0, b1: s.sg.vc + s.sg.b1 });
      return { r, b, rec, d: WB.densitometry(rec.img, rec.cs, lanes) };
    });
    const head = ['protein', 'membrane', 'exposure'].concat(fl.map(j => st.lanes[j - 1].name || 'lane ' + j));
    const lines = [head];
    data.forEach(x => lines.push([x.r.name || '?', App.blotNameEn(x.b), App.expoLabel(x.rec)].concat(x.d.map(v => (v ? v.volume.toFixed(2) + (v.saturated ? ' (SAT)' : '') : '')))));
    // normalized to a same-membrane loading control, then to the first lane
    const ctrls = data.filter(x => App.isLoading(x.r));
    data.filter(x => !App.isLoading(x.r)).forEach(x => {
      const c = ctrls.find(c => c.b === x.b); if (!c) return;
      const ratio = x.d.map((v, i) => (v && c.d[i] ? v.volume / Math.max(1e-9, c.d[i].volume) : null)), r0 = ratio.find(v => v) || 1;
      lines.push([`${x.r.name}/${c.r.name} (rel. lane 1)`, App.blotNameEn(x.b), ''].concat(ratio.map(v => (v == null ? '' : (v / r0).toFixed(3)))));
    });
    lines.push([]); lines.push(['Volumes = sum of (pixel - local background) over the band, on the exposure shown in the figure. SAT = saturated pixels: do not quantify.']);
    const csv = lines.map(l => l.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
    G.Export.download(new Blob(['﻿' + csv], { type: 'text/csv' }), 'blot_quantification.csv');
    toast('已导出定量 CSV（用于参考；正式定量请用 ≥3 次独立实验）', 3600);
  }

  G.UI = { toast, editRowName, openEd, markPicker, openStep, nextStep, lastFig: () => lastFig, preflight,
    piecesChanged: () => { $('stPieces').textContent = '改过了：点"下一步"生效'; } };

  const qs = new URLSearchParams(location.search);
  const scripted = !!(qs.get('demo') === '1' || qs.get('srcdir') || qs.get('demomove'));

  /* ---------- the draft of last time (offered on the start screen, as GelFigure) ---------- */
  async function offerDraft() {
    if (scripted && !qs.get('draft')) return;
    const d = await App.peekDraft();
    if (!d || S()) return;
    const s = d.summary || {};
    $('draftName').textContent = `${s.images || '?'} 张图 · ${s.membranes || '?'} 张膜${s.rows ? ` · ${s.rows} 个蛋白` : ''}${s.names && s.names.length ? '（' + s.names.join('、') + '）' : ''}`;
    $('draftTime').textContent = '保存于 ' + new Date(d.savedAt).toLocaleString('zh-CN');
    $('draftBox').classList.remove('hidden');
  }
  $('btnDraftRestore').onclick = async () => {
    try { await App.restoreDraft(); toast('已恢复上次的进度'); } catch (e) { alert('恢复失败：' + e.message); }
  };
  $('btnDraftDrop').onclick = async () => { await App.dropDraft(); $('draftBox').classList.add('hidden'); };
  offerDraft();

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
    if (stopAt >= 3) App.makeBoxes();
    st.step = stopAt; App.curStep = Math.min(stopAt, 3);
    if (stopAt === 1) { const b = st.blots[0]; if (b && b.marker) App.viewImg = b.marker; }
    App.commit(); App.hist = App.hist.slice(-1);          // (undo starts from here)
    if (stopAt === 2) openStep(2);
    if (qs.get('ladder')) { st.blots.forEach(b => { b.ladderId = qs.get('ladder'); }); App.commit(); }
    if (qs.get('sel')) { const vis = st.rows.filter(r => !r.hidden), r = vis[+qs.get('sel')]; if (r) { App.selRow = r.id; App.viewBlot = r.blot; App.viewImg = r.img; App.emit('select'); } }
    if (qs.get('border') === '1') { st.style.border = true; App.commit(); }
    // &selpiece=B: of the selected row, the box on piece B gets the lane tools
    if (qs.get('selpiece') && App.selRow) { const r = App.row(App.selRow), sg = r && r.segs.find(s => (App.findPiece(s.piece) || { pc: {} }).pc.letter === qs.get('selpiece')); if (sg) { App.selSeg = sg.piece; App.emit('select'); } }
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
    const L = () => lastFig.laneW * prevScale;
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
      let el = imgOf(cr.id, cp), a = ctr(el); pull(el, [a[0] + 1.3 * L(), a[1]]); snap('C +1');
      el = imgOf(cr.id, cp); a = ctr(el); pull(el, [a[0] - 1.3 * L(), a[1]]); snap('C -1');
      el = imgOf(cr.id, cp); a = ctr(el); pull(el, [a[0] + 2.3 * L(), a[1]], { altKey: true }); snap('C box +2 (Alt)');
      App.undo(); snap('undo');
      // D two columns left: at column 1 already — nothing moves, no other row is pushed aside; C three columns
      // left: as far as column 1 (two)
      S().lanes[0].name = 'L1'; App.commit();
      const dr = onPiece('D'), dp = dr.segs[0].piece;
      el = imgOf(dr.id, dp); a = ctr(el); pull(el, [a[0] - 2.3 * L(), a[1]]); order('D -2'); log.push('names ' + S().lanes.map(l => l.name || '.').join(','));
      const c3 = onPiece('C'); el = imgOf(c3.id, c3.segs[0].piece); a = ctr(el); pull(el, [a[0] - 3.3 * L(), a[1]]); order('C -3');
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
      App.selRow = row.id; App.selSeg = sg.piece; App.viewBlot = row.blot; App.viewImg = row.img; App.emit('select'); G.View.fitFull();
      const cv = $('editor'), R = cv.getBoundingClientRect();
      const ev = (type, [x, y], opt) => (type === 'mousedown' || type === 'dblclick' ? cv : window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: R.left + x, clientY: R.top + y, bubbles: true }, opt)));
      const pull = (a, b2, opt) => { ev('mousedown', a, opt); ev('mousemove', [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2], opt); ev('mousemove', b2, opt); ev('mouseup', b2, opt); };
      const geo = tag => snap(`${tag} box=${Math.round(sg.x0)}..${Math.round(sg.x1)} h=${Math.round(row.above)}+${Math.round(row.below)} vc=${Math.round(sg.vc)}`);
      geo('start');
      let pr = G.View.probe(row, sg); const L = App.segPitch(sg) * pr.scale;
      pull(pr.handles.e, [pr.handles.e[0] - 2.2 * L, pr.handles.e[1]]); geo('e -2 lanes');
      pr = G.View.probe(row, sg); pull(pr.handles.e, [pr.handles.e[0] + 2.2 * L, pr.handles.e[1]]); geo('e +2 lanes');
      pr = G.View.probe(row, sg); pull(pr.handles.nw, [pr.handles.nw[0] + 1.2 * L, pr.handles.nw[1] - 15]); geo('nw corner');
      pr = G.View.probe(row, sg); pull(pr.lanes[0], [pr.lanes[0][0] + 0.2 * L, pr.lanes[0][1]]); geo('lane 0 dragged');
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
      pull([pr.handles.sw[0] + 0.1 * L, pr.handles.sw[1] + 25], [pr.handles.se[0] - 0.1 * L, pr.handles.se[1] + 70]);
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
      let saved = null; try { saved = localStorage.getItem('blotfig.ladder'); } catch (e) { /* storage off */ }
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
      App.selRow = row.id; App.selSeg = sg.piece; App.emit('select');
      let pr = G.View.probe(row, sg); const mid = [(pr.lanes[0][0] + pr.lanes[1][0]) / 2, pr.lanes[0][1]];
      pull(mid, [mid[0], mid[1] + 120 * pr.scale]);
      row = App.row(App.selRow); sg = row.segs[0];
      log.push(`moved down | ${segS(sg)} | on D: ${sg.piece === D.id} figure ${img(row, sg)}`);
      // 3. the last lane dragged right by 40 px: the lanes between spread evenly; Alt: that lane alone
      pr = G.View.probe(row, sg); let L = pr.lanes[pr.lanes.length - 1];
      pull(L, [L[0] + 40 * pr.scale, L[1]]);
      row = App.row(App.selRow); sg = row.segs[0];
      log.push(`last lane +40 | ${segS(sg)}`);
      pr = G.View.probe(row, sg); L = pr.lanes[pr.lanes.length - 1];
      pull(L, [L[0] + 40 * pr.scale, L[1]], { altKey: true });
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
      const blob = await App.saveProject();
      log.push(`saved ${(blob.size / 1048576).toFixed(1)} MB`);
      await App.openProject(blob);
      const after = sig();
      log.push(`opened | same: ${before === after}${before === after ? '' : '\n  before ' + before + '\n  after  ' + after}`);
    }
    if (scen === 'perf') {
      // what a drag costs: a box's right edge pulled across 20 mouse moves (membrane view, figure, checks)
      const row = vis()[0], sg = row.segs[0];
      App.selRow = row.id; App.selSeg = sg.piece; App.viewBlot = row.blot; App.viewImg = row.img; App.emit('select'); G.View.fitFull();
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
      hold(el, [a[0] + 1.3 * L(), a[1]]);
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
