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
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    $('toasts').appendChild(el);
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
    App.mode = m;
    // the figure's banner for figure modes, the membrane view's banner for clicks on the membrane
    const onView = m === 'addrow' || m === 'marks' || m === 'align';
    $('modeBanner').classList.toggle('hidden', !m || onView);
    $('viewBanner').classList.toggle('hidden', !onView);
    $('modeText').textContent = m === 'group' ? '在成图上从第一个泳道名拖到最后一个' : '';
    $('viewModeText').textContent = m === 'addrow' ? '拖出一个框（只按框里的条带识别泳道），或点蛋白所在的高度'
      : m === 'marks' ? '点 Marker 带添加刻度；拖动微调，点数字修改或删除'
      : m === 'align' ? '拖动图片让条带落进框里 · Shift+拖动或 [ ] 旋转 · 方向键微调' : '';
    $('viewModeExtra').innerHTML = m === 'align' ? '<button id="vmAuto" title="按白光图和条带自动对齐（整张膜的图都重新对齐）">自动对齐</button><button id="vmNone" title="按原样使用这张图，不移动">不对齐</button>' : '';
    if (m === 'align') {
      const id = App.alignImg;
      $('vmAuto').onclick = () => { G.View.alignEnd(); App.mode = null; App.busy(true, '自动对齐…'); setTimeout(() => { App.autoAlign(id); App.busy(false); App.commit(); App.setMode('align'); G.View.alignStart(id); toast('已重新自动对齐这张膜的图'); }, 20); };
      $('vmNone').onclick = () => { G.View.alignEnd(); App.setAlign(id, null); App.commit(); G.View.alignStart(id); toast('这张图按原样使用（不移动）'); };
    }
    $('viewModeCancel').textContent = m === 'marks' || m === 'align' ? '完成' : '取消 (Esc)';
    $('btnAddRow').classList.toggle('primary', m === 'addrow');
    $('btnAddGroup').classList.toggle('on', m === 'group');
    $('btnMarks').classList.toggle('on', m === 'marks');
    G.View.draw();
  };
  $('modeCancel').onclick = () => App.setMode(null);
  $('viewModeCancel').onclick = () => App.setMode(null);
  $('btnMarks').onclick = () => {
    if (!S()) return;
    if (App.mode === 'marks') { App.setMode(null); return; }
    // the white-light picture shows the ladder best
    const b = App.blot(App.viewBlot);
    if (b && b.marker) { App.viewImg = b.marker; App.emit('select'); }
    App.setMode('marks');
  };

  /* ---------- loading ---------- */
  async function addFiles(files) {
    const n = await App.addFiles(files);
    if (!n) return;
    const st = S(), named = st.rows.length, moved = st.blots.reduce((s, b) => s + nMoved(b), 0);
    toast(`已载入 ${n} 张图片：${st.blots.length} 张膜，识别出 ${named} 行条带` + (moved ? `；有 ${moved} 张拍摄时膜的位置不同，已自动对齐（标"已对齐"，在图片的 ⋯ 里可手动调整）` : ''), moved ? 6000 : 3400);
  }
  ['fileInput', 'fileInput2'].forEach(id => $(id).addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; }));
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
  $('btnExportMenu').onclick = e => { e.stopPropagation(); $('exportMenu').classList.toggle('hidden'); };
  document.addEventListener('click', () => $('exportMenu').classList.add('hidden'));
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); }
    if (e.key === 'Escape') { $('helpDlg').classList.add('hidden'); closePop(); if (App.mode) App.setMode(null); }
    // Alt+↑↓: the selected row one place up / down in the figure
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && S() && App.selRow) {
      e.preventDefault();
      if (App.moveRowBy(App.selRow, e.key === 'ArrowUp' ? -1 : 1)) App.commit();
    }
  });
  $('dpiTop').addEventListener('change', done(e => { S().style.dpi = +e.target.value; }));
  const baseName = () => 'blot_figure';
  $('btnPNG').onclick = async () => {
    if (!S() || !S().rows.length) { toast('还没有可导出的行'); return; }
    App.busy(true, '导出中…');
    try { const f = G.BRender.build(false); await G.Export.exportPNG(f.svg, f.w, f.h, S().style.dpi, `${baseName()}_${S().style.dpi}dpi.png`); toast(`已导出 ${S().style.dpi} dpi PNG`); }
    catch (e) { alert(e.message); } finally { App.busy(false); }
  };
  $('btnSVG').onclick = () => { if (!S()) return; G.Export.exportSVG(G.BRender.build(false).svg, baseName() + '.svg'); toast('已导出 SVG'); };
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
  function renderBlots() {
    const st = S(), box = $('blotList'); box.innerHTML = '';
    st.blots.forEach(b => {
      const A = App.analysis[b.id], card = document.createElement('div');
      card.className = 'blot-card' + (b.id === App.viewBlot ? ' view' : '');
      const nCh = App.chemiOf(b).length, nM = App.markersOf(b).length;
      const lads = G.ProteinLadders.all();
      const auto = A && A.ladderId ? G.ProteinLadders.get(A.ladderId) : null;
      card.innerHTML = `<div class="blot-head"><input type="text" value="${esc(b.name)}" placeholder="${esc(App.blotName(b))}"></div>
        <div class="blot-sub">${nCh} 张曝光${nM ? ' + Marker 图' : '，<b style="color:var(--warn)">没有 Marker 图</b>'} · ${st.rows.filter(r => r.blot === b.id).length} 行${(b.pieces || []).length > 1 ? ` · ${b.pieces.length} 条膜条` : ''}${nMoved(b) ? ` · <span title="拍摄之间膜的位置变过：这些图已对齐到同一位置">${nMoved(b)} 张已对齐</span>` : ''}</div>
        <div class="thumbs"></div>
        ${nM ? `<select class="ladder-sel"><option value="">Ladder：自动${auto ? '（' + esc(auto.name.replace(/\s*\(.*\)/, '')) + '）' : ''}</option>${lads.map(l => `<option value="${l.id}"${!b.ladderAuto && b.ladderId === l.id ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}`;
      const th = card.querySelector('.thumbs');
      b.images.map(id => App.images.get(id)).filter(Boolean).sort((x, y) => (x.kind === 'marker') - (y.kind === 'marker') || (x.exposure || 0) - (y.exposure || 0)).forEach(rec => {
        const t = document.createElement('div');
        t.className = 'thumb' + (rec.id === App.viewImg && b.id === App.viewBlot ? ' on' : '');
        t.title = rec.name + (rec.resampled ? '（已缩放到与曝光图相同尺寸）' : '');
        t.appendChild(thumbCanvas(rec));
        // which figure rows take their bands from this exposure (row colours)
        const users = rec.kind === 'chemi' ? st.rows.filter(r => !r.hidden && r.img === rec.id) : [];
        const usesHtml = users.length ? `<span class="uses" title="成图中用这张曝光的行：${esc(users.map(r => r.name || (App.rowKda(r) ? '≈' + Math.round(App.rowKda(r)) + ' kDa' : '未命名')).join('、'))}">${users.map(r => `<i style="background:${App.rowColor(r)}"></i>`).join('')}</span>` : '';
        // the membrane lay elsewhere in this picture: aligned onto the others (the grid's own picture: 基准)
        const al = App.alignOf(rec.id), alHtml = App.isMoved(rec.id) ? `<span class="aligned" title="${esc(alignWords(rec, b))}；在 ⋯ 里可手动调整">${al.how === 'manual' ? '手动' : '已对齐'}</span>`
          : b.frame === rec.id && b.images.some(id => App.isMoved(id)) ? '<span class="aligned base" title="基准：这张膜的其他图都对齐到这张">基准</span>' : '';
        t.insertAdjacentHTML('beforeend', `${rec.kind === 'marker' ? '<span class="kind">Marker</span>' : ''}${usesHtml}${alHtml}<div class="cap">${rec.kind === 'marker' ? '白光' : `<b>${esc(App.expoLabel(rec))}</b>`}</div><button class="more" title="更多">⋯</button>`);
        t.onclick = e => { if (e.target.classList.contains('more')) return; App.viewBlot = b.id; App.viewImg = rec.id; App.emit('select'); G.View.fitFull(); };
        t.querySelector('.more').onclick = e => { e.stopPropagation(); imagePopover(rec, b, t); };
        th.appendChild(t);
      });
      card.querySelector('.blot-head input').addEventListener('change', done(e => { b.name = e.target.value.trim(); }));
      const ls = card.querySelector('.ladder-sel');
      if (ls) ls.addEventListener('change', done(e => {
        b.ladderAuto = !e.target.value; b.ladderId = e.target.value || (A && A.ladderId);
        if (!b.ladderAuto) { App.prefLadder = b.ladderId; try { localStorage.setItem('blotfig.ladder', b.ladderId); } catch (x) { /* */ } }
      }));
      box.appendChild(card);
    });
    $('stBlots').textContent = `${st.blots.length} 张膜 · ${App.images.size} 张图`;
  }

  /* ---------- popover ---------- */
  const pop = $('popover');
  let popOpen = false, popCancel = null;
  // closing without a choice runs the pending cancel action (e.g. drops a new mark that got no size)
  function closePop() { if (popOpen) { popOpen = false; pop.classList.add('hidden'); const c = popCancel; popCancel = null; if (c) c(); } }
  function placePop(anchor) {
    const r = anchor.getBoundingClientRect();
    placePopAt(r.right + 8, r.top - 10);
  }
  function placePopAt(x, y) {
    pop.classList.remove('hidden'); popOpen = true;
    const pw = pop.offsetWidth || 260, ph = pop.offsetHeight;
    pop.style.left = clamp(x, 6, innerWidth - pw - 6) + 'px';
    pop.style.top = clamp(y, 58, innerHeight - ph - 8) + 'px';
  }
  document.addEventListener('mousedown', e => { if (popOpen && !pop.contains(e.target) && !e.target.classList.contains('more') && e.target !== $('editor')) closePop(); });
  /* size of a marker band set by hand: the ladder's sizes (the predicted one highlighted) or any value */
  function markPicker(b, pc, mark, cx, cy, isNew) {
    if (popOpen) closePop();
    const lad = G.ProteinLadders.get(b.ladderId);
    const sizes = lad ? lad.sizes : [250, 180, 150, 130, 100, 75, 70, 55, 50, 40, 37, 35, 25, 20, 15, 10];
    const sug = mark.kda > 0 ? mark.kda : App.suggestKda(b, pc, mark.v);
    pop.innerHTML = `<h4>${esc(App.pieceName(b, pc))}：这条 Marker 带是多少 kDa？</h4>
      <div class="kda-grid">${sizes.map(k => `<button data-k="${k}" class="${k === sug ? 'on' : ''}">${k}</button>`).join('')}</div>
      <div class="field inline"><label class="inline-label">其他</label><input type="number" id="pKda" class="num" step="any" min="0" value="${mark.kda > 0 ? mark.kda : ''}" placeholder="kDa"> kDa</div>
      <p class="hint">${lad ? `按 ${esc(lad.name.replace(/\s*\(.*\)/, ''))} 的条带列出；` : '还没选 Ladder 型号，列出的是常见分子量；'}标了 2 条以上就能估算各行分子量，成图左侧只画手动标出的刻度。</p>
      <div class="actions">${isNew ? '' : '<button class="btn sm danger" id="pDelMark">删除这条刻度</button>'}<button class="btn sm ghost" id="pAutoMarks" title="丢掉这条膜条上手动标的刻度">恢复自动</button><button class="btn sm primary" id="pOk">确定</button></div>`;
    placePopAt(cx + 12, cy - 30);
    const done1 = k => { if (!(k > 0)) { toast('先选一个分子量'); return; } mark.kda = k; popCancel = null; closePop(); App.commit(); };
    popCancel = () => { if (!(mark.kda > 0) && pc.marks) pc.marks = pc.marks.filter(m => m !== mark); App.commit(); };
    pop.querySelectorAll('[data-k]').forEach(btn => btn.onclick = () => done1(+btn.dataset.k));
    const inp = pop.querySelector('#pKda');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) done1(+inp.value); });
    pop.querySelector('#pOk').onclick = () => done1(+inp.value || sug);
    const del = pop.querySelector('#pDelMark');
    if (del) del.onclick = () => { pc.marks = pc.marks.filter(m => m !== mark); popCancel = null; closePop(); App.commit(); };
    pop.querySelector('#pAutoMarks').onclick = () => { pc.marks = null; popCancel = null; closePop(); App.commit(); toast(`${App.pieceName(b, pc)}已恢复自动识别的 Marker`); };
    if (!sug) setTimeout(() => inp.focus(), 0);
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
      inp.addEventListener('focus', () => { selectRow(row.id, false); fillDatalist(kda); });
      inp.addEventListener('input', live(e => { row.name = e.target.value; }));
      inp.addEventListener('change', done());
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || composing(e)) return;
        e.preventDefault(); inp.blur();
        const nx = box.querySelectorAll('.row-item input')[[...box.querySelectorAll('.row-item input')].indexOf(inp) + 1];
        if (nx) nx.focus();
      });
      el.querySelector('[data-act="expo"]').onclick = () => selectRow(sel ? null : row.id, !sel);
      el.querySelector('[data-act="hide"]').onclick = done(() => { row.hidden = !row.hidden; });
      el.querySelector('[data-act="del"]').onclick = done(() => { st.rows = st.rows.filter(r => r !== row); if (App.selRow === row.id) App.selRow = null; toast('已删除该行（Ctrl+Z 可撤销）'); });
      el.onclick = e => { if (e.target === el || e.target.classList.contains('kda') || e.target.classList.contains('grip')) selectRow(row.id, true); };
      box.appendChild(el);
      if (sel && ex.length) box.appendChild(expoCompare(row, ex, best));
    });
    if (!st.rows.length) box.innerHTML = '<p class="hint">没有识别出条带。用下面的按钮按分子量添加，或在膜图上框选添加。</p>';
    const named = st.rows.filter(r => r.name && !r.hidden).length, vis = st.rows.filter(r => !r.hidden).length;
    $('stRows').textContent = `${named}/${vis} 已命名`;
  }
  /* the selected row in every exposure, weakest to strongest; ★ = recommended, red pixels = clipped */
  function expoCompare(row, ex, best) {
    const wrap = document.createElement('div'); wrap.className = 'expo-compare';
    const bestE = ex.find(e => e.id === best), vb = App.expoVerdict(bestE);
    const TAG = { sat: '过曝', weak: '太弱', faint: '偏弱', ok: '' };
    const why = vb === 'ok' ? '★ 推荐：条带清晰、没有过曝，背景干净'
      : vb === 'sat' ? '★ 推荐：每张曝光里这条带都有过曝像素，★ 是过曝最少又清楚的一张；这一行不要拿来定量'
      : '★ 推荐：信号都偏弱，★ 是相对最清楚的一张；可以考虑补拍更长曝光';
    const b = App.blot(row.blot);
    // the pieces this row runs across side by side (one protein on a membrane cut through), and splitting them
    const segLine = row.segs.length > 1 ? `<div class="seg-line">并排来自膜条 <b>${esc(modLabel(row))}</b>（膜在这里竖着剪开过）<button class="link" data-act="split" title="每条膜条各成一行">拆开</button></div>` : '';
    wrap.innerHTML = `${(b.pieces || []).length > 1 ? segLine : ''}<div class="why">${why}${row.img !== best ? ' <button class="link" data-act="usebest">改用推荐</button>' : ''}</div><div class="tiles"></div>`;
    const split = wrap.querySelector('[data-act="split"]');
    if (split) split.onclick = done(() => { App.splitRow(row); toast('已拆开：每条膜条各成一行'); });
    const tiles = wrap.querySelector('.tiles');
    App.expoOrder(row).forEach(e => {
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
  function addKda() {
    const k = +$('addKda').value; if (!(k > 0)) { toast('先填分子量（kDa）'); return; }
    const row = App.addRowAtKda(k, App.viewBlot);
    if (!row) { toast('没有哪张膜带 Marker 能覆盖这个分子量；可以用"在膜图上框选添加"'); return; }
    // a newly added, possibly invisible protein: prefer the longest exposure
    const ch = App.chemiOf(App.blot(row.blot)); row.img = ch[ch.length - 1].id; row.auto = false;
    App.selRow = row.id; App.viewBlot = row.blot; App.viewImg = row.img;
    $('addKda').value = '';
    App.commit();
    toast(`已在 ${k} kDa 处添加一行（用最长曝光），点"蛋白名"输入名称`);
    editRowName(row.id);
  }
  $('btnAddKda').onclick = addKda;
  $('addKda').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) addKda(); });

  /* ---------- 3 lanes ---------- */
  function renderLanes() {
    const st = S(), n = st.lanes.length;
    const opts = sel => st.lanes.map((l, i) => `<option value="${i + 1}"${i + 1 === sel ? ' selected' : ''}>${i + 1}${l.name ? ' · ' + esc(l.name.replace(/\*/g, '')).slice(0, 10) : ''}</option>`).join('');
    $('rangeA').innerHTML = opts(st.range[0]); $('rangeB').innerHTML = opts(st.range[1]);
    $('laneList').innerHTML = st.lanes.map((l, i) => `<div class="item${i + 1 < st.range[0] || i + 1 > st.range[1] ? ' out' : ''}"><span class="idx">${i + 1}</span><span style="flex:1">${esc(l.name) || '<span class="muted">—</span>'}</span>
      <label class="switch"><input type="checkbox" data-j="${i + 1}" ${l.hidden ? '' : 'checked'}>显示</label></div>`).join('');
    $('laneList').querySelectorAll('[data-j]').forEach(c => c.addEventListener('change', done(e => { st.lanes[+c.dataset.j - 1].hidden = !e.target.checked; })));
    const fl = App.figLanes(), named = fl.filter(j => st.lanes[j - 1].name).length;
    $('stLanes').textContent = `${fl.length} 条 · ${named}/${fl.length} 已命名`;
    renderBoxTools();
  }
  /* the selected row's boxes: how many lanes each has and where they go in the figure; re-detect them from
   * the box's pixels, or space a given number evenly across it */
  function renderBoxTools() {
    const el = $('boxTools'), row = App.selRow && App.row(App.selRow);
    if (!row) { el.innerHTML = '<p class="hint" style="margin:2px 0 0">在中间膜图上点一个框（或在上面"图中的行"里选一行）。框里的竖线就是这一行的泳道，框上方的数字是这一道在成图里的列。</p>'; return; }
    const b = App.blot(row.blot), cur = App.curSeg(row), clash = App.rowClash(row).length > 0;
    el.innerHTML = `<div class="bt-head"><span class="swatch" style="background:${App.rowColor(row)}"></span><b>${esc(App.rowLabel(row))}</b>${row.segs.length > 1 ? `<span class="muted">跨 ${row.segs.length} 条膜条</span>` : ''}</div>` +
      row.segs.map(sg => {
        const pc = App.piece(b, sg.piece), n = App.nSample(sg), nm = sg.lanes.filter(l => l.r === 'm').length, nx = sg.lanes.filter(l => l.r === 'x').length;
        const cols = n > 1 ? `${sg.c0}–${App.segEnd(sg)}` : n ? String(sg.c0) : '—';
        return `<div class="bt-seg${sg === cur ? ' sel' : ''}${clash ? ' clash' : ''}" data-seg="${sg.piece}">
          <div class="bt-line"><span class="ptag" title="膜条 ${esc(pc ? pc.letter : '?')}">${esc(pc ? pc.letter : '?')}</span>
            <span class="bt-n"><b>${n}</b> 道${nm ? ` <span class="tag-m">+${nm} M</span>` : ''}${nx ? ` <span class="tag-x">+${nx} 不用</span>` : ''}</span>
            <span class="bt-cols">成图第 <b>${cols}</b> 列</span>
            <button class="pnav" data-shift="-1" title="这个框的泳道在成图里往前挪一列">‹</button><button class="pnav" data-shift="1" title="往后挪一列">›</button></div>
          <div class="bt-line"><button class="btn sm" data-act="redetect" title="只看框里的像素，重新找泳道">框内重新识别</button>
            <span class="bt-even">均分 <input type="number" class="num" min="1" max="60" value="${sg.lanes.length}"> 道 <button class="btn sm ghost" data-act="even" title="按填的道数在框里等间距排布">排布</button></span></div>
        </div>`;
      }).join('') +
      '<p class="hint">拖框的边或角改范围（泳道跟着增减）；拖竖线微调一道，双击框内加一道，点竖线后按 Delete 删掉；点框上方的数字在 样品 / 不用 / Marker 之间切换；选中框后 ←→ 平移这一框的泳道，Alt+←→ 调间距。</p>';
    el.querySelectorAll('.bt-seg').forEach(div => {
      const sg = row.segs.find(s => s.piece === div.dataset.seg);
      if (!sg) return;
      div.addEventListener('mousedown', () => { if (App.selSeg !== sg.piece) { App.selSeg = sg.piece; App.selLane = null; G.View.draw(); div.parentNode.querySelectorAll('.bt-seg').forEach(x => x.classList.toggle('sel', x === div)); } });
      div.querySelectorAll('[data-shift]').forEach(btn => btn.onclick = done(() => { if (!App.shiftCols(row, sg, +btn.dataset.shift)) toast('已经从第 1 列开始了'); }));
      div.querySelector('[data-act="redetect"]').onclick = done(() => {
        const n = App.editLanes(row, sg, () => App.redetectBox(row, sg));
        App.findBand(row, sg); App.selLane = null;
        const nm = sg.lanes.filter(l => l.r === 'm').length;
        toast(n ? `框内识别出 ${n} 道${nm ? `（另有 ${nm} 道 Marker）` : ''}` : '框里没识别到泳道：拖框调整范围，或填道数后点"排布"', 3200);
      });
      const inp = div.querySelector('.bt-even input');
      const even = done(() => { const n = App.editLanes(row, sg, () => App.evenBox(row, sg, +inp.value), true); App.selLane = null; toast(`框内已等间距排布 ${n} 道`); });
      div.querySelector('[data-act="even"]').onclick = even;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); even(); } });
    });
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
  function renderAnno() {
    const st = S(), rows = [];
    st.groups.forEach((g, k) => rows.push(`<div class="item"><span class="kind">分组</span><span class="idx" style="width:auto">${g.from}–${g.to}</span><input type="text" data-g="${k}" value="${esc(g.text)}" placeholder="分组文字"><button class="x" data-gdel="${k}">×</button></div>`));
    st.conditions.forEach((c, r) => rows.push(`<div class="item"><span class="kind">条件</span><input type="text" data-c="${r}" value="${esc(c.name)}" placeholder="条件名，如 Dox"><button class="x" data-cdel="${r}">×</button></div>`));
    const L = $('annoList'); L.innerHTML = rows.join('');
    L.querySelectorAll('[data-g]').forEach(i => { const g = st.groups[+i.dataset.g]; i.addEventListener('input', live(e => { g.text = e.target.value; })); i.addEventListener('change', done()); });
    L.querySelectorAll('[data-c]').forEach(i => { const c = st.conditions[+i.dataset.c]; i.addEventListener('input', live(e => { c.name = e.target.value; })); i.addEventListener('change', done()); });
    L.querySelectorAll('[data-gdel]').forEach(b => b.onclick = done(() => st.groups.splice(+b.dataset.gdel, 1)));
    L.querySelectorAll('[data-cdel]').forEach(b => b.onclick = done(() => st.conditions.splice(+b.dataset.cdel, 1)));
  }

  /* ---------- 5 layout ---------- */
  const num = (id, key, lo, hi) => $(id).addEventListener('change', done(e => { S().style[key] = clamp(+e.target.value || S().style[key], lo, hi); }));
  num('mmPerLane', 'mmPerLane', 2, 15); num('fontPt', 'fontPt', 4, 14); num('rowGap', 'rowGapPt', 0, 10);
  $('labelAngle').addEventListener('change', done(e => { S().style.labelAngle = e.target.value; }));
  ['invert', 'showMW', 'unitHeader', 'border'].forEach(id => $(id).addEventListener('change', done(e => { S().style[id] = e.target.checked; })));
  $('panelLetter').addEventListener('change', done(e => { S().style.panelLetter = e.target.value.trim(); }));

  /* ---------- middle header: image tabs + levels ---------- */
  const toSl = v => Math.round(Math.sqrt(clamp(v, 0, 1)) * 1000), fromSl = s => (s / 1000) ** 2;
  function renderStageHead() {
    const st = S(), sel = $('viewBlot');
    sel.classList.toggle('hidden', st.blots.length < 2);
    sel.innerHTML = st.blots.map(b => `<option value="${b.id}"${b.id === App.viewBlot ? ' selected' : ''}>${esc(App.blotName(b))}</option>`).join('');
    const b = App.blot(App.viewBlot), rec = G.View.curImage();
    if (!b) return;
    const imgs = b.images.map(id => App.images.get(id)).filter(Boolean).sort((x, y) => (x.kind === 'marker') - (y.kind === 'marker') || (x.exposure || 0) - (y.exposure || 0));
    $('imgTabs').innerHTML = imgs.map(r => `<button data-img="${r.id}" class="${rec && r.id === rec.id ? 'on' : ''}">${r.kind === 'marker' ? '白光<span class="tag-m">Marker</span>' : esc(App.expoLabel(r))}</button>`).join('');
    $('imgTabs').querySelectorAll('button').forEach(btn => btn.onclick = () => { App.viewImg = btn.dataset.img; App.emit('select'); });
    const isC = rec && rec.kind === 'chemi';
    $('levelBar').classList.toggle('hidden', !isC);
    if (isC) {
      const lv = App.levelsOf(rec.id), users = st.rows.filter(r => r.img === rec.id && !r.hidden);
      $('levelName').textContent = users.length ? `用于：${users.map(r => r.name || '未命名').join('、')}` : '这张图未被使用';
      $('lvBlack').value = toSl(lv.black); $('lvWhite').value = toSl(lv.white);
    }
  }
  $('viewBlot').addEventListener('change', e => { App.viewBlot = e.target.value; App.viewImg = null; App.emit('select'); G.View.fitFull(); });
  const lvSet = (key) => live(e => {
    const rec = G.View.curImage(); if (!rec) return;
    const lv = Object.assign({}, App.levelsOf(rec.id)), v = fromSl(+e.target.value);
    if (key === 'black') lv.black = Math.min(v, lv.white - 0.0005); else lv.white = Math.max(v, lv.black + 0.0005);
    lv.manual = true; S().levels[rec.id] = lv;
    G.View.draw();
  });
  $('lvBlack').addEventListener('input', lvSet('black')); $('lvWhite').addEventListener('input', lvSet('white'));
  $('lvBlack').addEventListener('change', done()); $('lvWhite').addEventListener('change', done());
  $('btnLvAuto').onclick = done(() => { const rec = G.View.curImage(); if (rec) { delete S().levels[rec.id]; App.refreshChoices(); } });
  $('showSat').addEventListener('change', () => G.View.draw());
  $('fitFull').onclick = () => G.View.fitFull();

  /* ---------- preview + direct editing ---------- */
  const prev = $('preview'), fed = $('floatEd');
  let lastFig = null, edit = null;
  function updatePreview() {
    let f;
    try { f = G.BRender.build(true); } catch (e) { console.error(e); return; }
    lastFig = f;
    prev.innerHTML = f.svg;
    const svg = prev.querySelector('svg'), bx = $('previewBox').getBoundingClientRect();
    const k = Math.max(0.5, Math.min((bx.width - 48) / f.w, (bx.height - 48) / f.h, 4));
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = (f.w * k) + 'px'; svg.style.height = (f.h * k) + 'px';
    prevScale = k;
    drawRowTags(f);
    $('figSize').textContent = `${(f.w / App.MM).toFixed(1)} × ${(f.h / App.MM).toFixed(1)} mm`;
    const ck = App.checks();
    showWarnings(f.warnings.concat(ck.warn));
    $('legendHints').innerHTML = ck.legend.length ? '<b>图注可参考</b>' + ck.legend.map(esc).join('<br>') : '';
    if (edit) { const el = editEl(edit); if (el) el.classList.add('active'); }
  }
  const getV = e => e.kind === 'lane' ? S().lanes[e.id - 1].name : e.kind === 'rowname' ? (App.row(e.id) || {}).name : e.kind === 'group' ? S().groups[e.id].text : S().conditions[e.id].name;
  const setV = (e, v) => { if (e.kind === 'lane') S().lanes[e.id - 1].name = v; else if (e.kind === 'rowname') { const r = App.row(e.id); if (r) r.name = v; } else if (e.kind === 'group') S().groups[e.id].text = v; else S().conditions[e.id].name = v; };
  const editEl = e => prev.querySelector(e.kind === 'lane' ? `g[data-edit="lane"][data-j="${e.id}"]` : e.kind === 'rowname' ? `g[data-edit="rowname"][data-row="${e.id}"]` : e.kind === 'group' ? `g[data-edit="group"][data-k="${e.id}"]` : `g[data-edit="condname"][data-r="${e.id}"]`);
  function openEd(kind, id) {
    closePop();
    const e = { kind, id }, el = editEl(e); if (!el) return;
    const r = el.getBoundingClientRect();
    edit = Object.assign(e, { orig: getV(e) || '' });
    fed.value = edit.orig;
    fed.placeholder = kind === 'lane' ? `泳道 ${id} 名称` : kind === 'rowname' ? '蛋白名（如 GAPDH）' : kind === 'group' ? '分组文字' : '条件名';
    if (kind === 'rowname') { fed.setAttribute('list', 'protList'); fillDatalist(App.rowKda(App.row(id))); selectRow(id, true); } else fed.removeAttribute('list');
    const w = Math.max(130, Math.min(240, r.width + 60));
    fed.style.width = w + 'px';
    fed.style.left = clamp(kind === 'rowname' ? r.left - 6 : r.left + r.width / 2 - w / 2, 4, innerWidth - w - 4) + 'px';
    fed.style.top = clamp(r.top + r.height / 2 - 15, 56, innerHeight - 40) + 'px';
    fed.classList.remove('hidden'); fed.focus(); fed.select();
  }
  function closeEd(revert) {
    if (!edit) return;
    const e = edit; edit = null;
    setV(e, revert ? e.orig : fed.value.trim());
    fed.classList.add('hidden');
    App.commit();
  }
  fed.addEventListener('input', () => { if (edit) { setV(edit, fed.value); App.refresh(); } });
  fed.addEventListener('keydown', e => {
    if (!edit || composing(e)) return;
    if (e.key === 'Escape') { e.preventDefault(); closeEd(true); return; }
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
  fed.addEventListener('blur', () => setTimeout(() => { if (edit && document.activeElement !== fed) closeEd(false); }, 120));
  function editRowName(id) { requestAnimationFrame(() => requestAnimationFrame(() => openEd('rowname', id))); }

  let press = null;
  const laneAt = (x, y) => { const el = document.elementFromPoint(x, y), g = el && el.closest && el.closest('g[data-edit="lane"]'); return g ? +g.dataset.j : null; };
  const hl = (a, b) => prev.querySelectorAll('g[data-edit="lane"]').forEach(g => { const j = +g.dataset.j; g.classList.toggle('active', a != null && j >= Math.min(a, b) && j <= Math.max(a, b)); });
  prev.addEventListener('mousedown', e => {
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
  prev.addEventListener('click', e => {
    if (!S() || swallowClick) return;
    const img = e.target.closest('image[data-row]');
    if (img) { selectRow(img.dataset.row, true); return; }
    const g = e.target.closest('[data-edit]'); if (!g) return;
    const kind = g.dataset.edit;
    if (kind === 'rowname') openEd('rowname', g.dataset.row);
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
  prev.addEventListener('mousedown', e => {
    if (e.button !== 0 || !S()) return;
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
      const n = App.shiftAlign(row, sg, d.k, d.alt);
      App.commit();
      toast(`${d.alt || n < 2 ? '这个框' : `膜条 ${(App.findPiece(d.piece) || { pc: {} }).pc.letter} 上的 ${n} 个框`}往${d.k > 0 ? '右' : '左'}挪了 ${Math.abs(d.k)} 列`);
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

  /* ---------- coach ---------- */
  function updateCoach() {
    const st = S(), vis = st.rows.filter(r => !r.hidden), fl = App.figLanes();
    const unnamedRows = vis.filter(r => !r.name).length, unnamedLanes = fl.filter(j => !st.lanes[j - 1].name).length;
    const sat = vis.filter(r => { const e = App.rowExpo(r).find(x => x.id === r.img); return e && e.satFrac > 0.002; });
    const noMW = st.style.showMW ? st.blots.filter(b => vis.some(r => r.blot === b.id) && !vis.some(r => r.blot === b.id && App.rowPieces(r).some(pc => App.pieceCal(b, pc)))) : [];
    let msg, ok = false;
    if (!vis.length) msg = '没有识别出条带行：用左侧"按分子量添加"或"在膜图上框选添加"';
    else if (unnamedRows) msg = `下一步：在成图右侧<b>点灰色的"蛋白名"</b>输入，回车跳下一行（还差 ${unnamedRows} 行）`;
    else if (unnamedLanes) msg = `下一步：在成图上<b>点灰色泳道号</b>输入样品名，回车跳下一条（还差 ${unnamedLanes} 条）`;
    else if (sat.length) msg = `「${sat[0].name}」所选曝光有过曝：在左侧该行<b>点更短的曝光</b>`;
    else if (noMW.length) msg = `${App.blotName(noMW[0])}没有标出分子量：点膜图上方的<b>标 Marker</b>，在图上点出几条 Marker 带`;
    else { msg = '已可导出 —— 右上角<b>导出 PNG</b>；补充材料用"未裁切原图"'; ok = true; }
    $('coachText').innerHTML = msg; $('coach').classList.toggle('done', ok);
    $('imgCount').textContent = `${App.images.size} 张图 · 添加`;
  }

  function syncLayout() {
    const y = S().style;
    $('mmPerLane').value = y.mmPerLane; $('fontPt').value = y.fontPt; $('rowGap').value = y.rowGapPt; $('labelAngle').value = String(y.labelAngle);
    $('invert').checked = y.invert; $('showMW').checked = y.showMW; $('unitHeader').checked = y.unitHeader; $('border').checked = !!y.border; $('panelLetter').value = y.panelLetter || '';
    $('dpiTop').value = String(y.dpi);
    $('stLayout').textContent = `${y.mmPerLane} mm/泳道 · ${y.fontPt} pt`;
    $('btnUndo').disabled = App.hist.length < 2; $('btnRedo').disabled = !App.future.length;
  }

  App.on(what => {
    if (!S()) return;
    if (what === 'loaded') { $('emptyState').classList.add('hidden'); $('sections').classList.remove('hidden'); }
    if (what === 'refresh') { updatePreview(); return; }
    if (what === 'select') { renderBlots(); renderRows(); renderBoxTools(); renderStageHead(); updatePreview(); G.View.draw(); return; }
    renderBlots(); renderRows(); renderLanes(); renderAnno(); renderStageHead(); syncLayout(); updateCoach(); updatePreview();
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
      ctx.fillText(`${App.blotName(p.b)} — ${p.rec.kind === 'marker' ? 'white-light marker image' : 'exposure ' + App.expoLabel(p.rec)} — ${p.rec.name}`, 14, y0 + fs * 1.4);
      ctx.drawImage(G.View.dispCanvas(p.rec, true), 0, top, Wout, h);
      const vis = new Set(App.figLanes());
      st.rows.filter(r => !r.hidden && r.blot === p.b.id && (p.rec.kind === 'marker' || r.img === p.rec.id)).forEach(r => {
        let last = null;
        r.segs.forEach(sg => {
          const pc = App.piece(p.b, sg.piece); if (!pc || !sg.lanes.length) return;
          const F = WB.frame(pc.cx, pc.cy, pc.angle), vT = sg.vc - r.above, vB = sg.vc + r.below;
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
      const lanes = C.src[ri].map(s => s && s.pc && { F: WB.frame(s.pc.cx, s.pc.cy, s.pc.angle), uc: s.u, hw: App.segPitch(s.sg) * 0.33,
        vTop: s.sg.vc - r.above, vBot: s.sg.vc + r.below, b0: s.sg.vc + s.sg.b0, b1: s.sg.vc + s.sg.b1 });
      return { r, b, rec, d: WB.densitometry(rec.img, rec.cs, lanes) };
    });
    const head = ['protein', 'membrane', 'exposure'].concat(fl.map(j => st.lanes[j - 1].name || 'lane ' + j));
    const lines = [head];
    data.forEach(x => lines.push([x.r.name || '?', App.blotName(x.b), App.expoLabel(x.rec)].concat(x.d.map(v => (v ? v.volume.toFixed(2) + (v.saturated ? ' (SAT)' : '') : '')))));
    // normalized to a same-membrane loading control, then to the first lane
    const ctrls = data.filter(x => App.isLoading(x.r));
    data.filter(x => !App.isLoading(x.r)).forEach(x => {
      const c = ctrls.find(c => c.b === x.b); if (!c) return;
      const ratio = x.d.map((v, i) => (v && c.d[i] ? v.volume / Math.max(1e-9, c.d[i].volume) : null)), r0 = ratio.find(v => v) || 1;
      lines.push([`${x.r.name}/${c.r.name} (rel. lane 1)`, App.blotName(x.b), ''].concat(ratio.map(v => (v == null ? '' : (v / r0).toFixed(3)))));
    });
    lines.push([]); lines.push(['Volumes = sum of (pixel - local background) over the band, on the exposure shown in the figure. SAT = saturated pixels: do not quantify.']);
    const csv = lines.map(l => l.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
    G.Export.download(new Blob(['﻿' + csv], { type: 'text/csv' }), 'blot_quantification.csv');
    toast('已导出定量 CSV（用于参考；正式定量请用 ≥3 次独立实验）', 3600);
  }

  G.UI = { toast, editRowName, openEd, markPicker, lastFig: () => lastFig };

  /* ---------- dev params ---------- */
  const qs = new URLSearchParams(location.search);
  if (qs.get('demo') === '1' || qs.get('srcdir') || qs.get('demomove')) setTimeout(async () => {
    if (qs.get('noalign') === '1') App.devNoAlign = true;
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
    if (qs.get('ladder')) { st.blots.forEach(b => { b.ladderId = qs.get('ladder'); b.ladderAuto = false; }); App.commit(); }
    if (qs.get('sel')) { const vis = st.rows.filter(r => !r.hidden), r = vis[+qs.get('sel')]; if (r) { App.selRow = r.id; App.viewBlot = r.blot; App.viewImg = r.img; App.emit('select'); } }
    if (qs.get('border') === '1') { st.style.border = true; App.commit(); }
    // &selpiece=B: of the selected row, the box on piece B gets the lane tools
    if (qs.get('selpiece') && App.selRow) { const r = App.row(App.selRow), sg = r && r.segs.find(s => (App.findPiece(s.piece) || { pc: {} }).pc.letter === qs.get('selpiece')); if (sg) { App.selSeg = sg.piece; App.emit('select'); } }
    if (qs.get('zoomsel') === '1' && App.selRow) G.View.fitRow(App.row(App.selRow));
    if (qs.get('mode') === 'marks') $('btnMarks').click(); else if (qs.get('mode')) App.setMode(qs.get('mode'));
    if (qs.get('scrollto') && $(qs.get('scrollto'))) $(qs.get('scrollto')).scrollIntoView({ block: 'center' });
    // &popimg=12: the ⋯ menu of the picture whose name starts so; &alignimg=12: aligning it by hand (&alignby=dx,dy,deg)
    const byStart = p => [...App.images.values()].find(r => r.name.startsWith(p));
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
      // D two columns past column 1: room is made on the left, lane names move along
      S().lanes[0].name = 'L1'; App.commit();
      const dr = onPiece('D'), dp = dr.segs[0].piece;
      el = imgOf(dr.id, dp); a = ctr(el); pull(el, [a[0] - 2.3 * L(), a[1]]); order('D -2'); log.push('names ' + S().lanes.map(l => l.name || '.').join(','));
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
      const b2 = S().blots[S().blots.length - 1], pc = b2.pieces[0], r = S().rows.find(r => r.segs.some(s => s.piece === pc.id));
      snap('start');
      const sg = r.segs.find(s => s.piece === pc.id), marks = App.manualMarks(b2, pc), u = App.ladderU(pc);
      marks.push({ u, v: sg.vc - 30, kda: 100 }, { u, v: sg.vc + 30, kda: 55 });
      App.commit(); snap('two marks');
      marks[0].kda = 130; App.commit(); snap('edit 100->130');
      // the first blot's piece A: auto marks become editable, one is dragged
      const b1 = S().blots[0], a = b1.pieces[0], m1 = App.manualMarks(b1, a);
      snap(`materialized ${m1.map(m => m.kda).join('/')}`);
      if (m1[0]) m1[0].v += 20; App.commit(); snap('dragged');
      a.marks = null; App.commit(); snap('auto again');
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
