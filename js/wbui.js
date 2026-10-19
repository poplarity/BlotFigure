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
    App.mode = m;
    $('modeBanner').classList.toggle('hidden', !m);
    $('modeText').textContent = m === 'addrow' ? '在中间的膜图上点击蛋白所在的高度，添加一行' : m === 'group' ? '在成图上从第一个泳道名拖到最后一个' : '';
    $('btnAddRow').classList.toggle('primary', m === 'addrow');
    $('btnAddGroup').classList.toggle('on', m === 'group');
    G.View.draw();
  };
  $('modeCancel').onclick = () => App.setMode(null);

  /* ---------- loading ---------- */
  async function addFiles(files) {
    const n = await App.addFiles(files);
    if (!n) return;
    const st = S(), named = st.rows.length;
    toast(`已载入 ${n} 张图片：${st.blots.length} 张膜，识别出 ${named} 行条带`, 3400);
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
  function renderBlots() {
    const st = S(), box = $('blotList'); box.innerHTML = '';
    st.blots.forEach(b => {
      const A = App.analysis[b.id], card = document.createElement('div');
      card.className = 'blot-card' + (b.id === App.viewBlot ? ' view' : '');
      const nCh = App.chemiOf(b).length, nM = App.markersOf(b).length;
      const lads = G.ProteinLadders.all();
      const auto = A && A.ladderId ? G.ProteinLadders.get(A.ladderId) : null;
      card.innerHTML = `<div class="blot-head"><input type="text" value="${esc(b.name)}" placeholder="${esc(App.blotName(b))}"></div>
        <div class="blot-sub">${nCh} 张曝光${nM ? ' + Marker 图' : '，<b style="color:var(--warn)">没有 Marker 图</b>'} · ${st.rows.filter(r => r.blot === b.id).length} 行${A && A.strips.length > 1 ? ` · ${A.strips.length} 条膜条` : ''}</div>
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
        t.insertAdjacentHTML('beforeend', `${rec.kind === 'marker' ? '<span class="kind">Marker</span>' : ''}${usesHtml}<div class="cap">${rec.kind === 'marker' ? '白光' : `<b>${esc(App.expoLabel(rec))}</b>`}</div><button class="more" title="更多">⋯</button>`);
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
  let popOpen = false;
  function closePop() { if (popOpen) { popOpen = false; pop.classList.add('hidden'); } }
  function placePop(anchor) {
    const r = anchor.getBoundingClientRect(); pop.classList.remove('hidden'); popOpen = true;
    const pw = 260, ph = pop.offsetHeight;
    pop.style.left = clamp(r.right + 8, 6, innerWidth - pw - 6) + 'px';
    pop.style.top = clamp(r.top - 10, 58, innerHeight - ph - 8) + 'px';
  }
  document.addEventListener('mousedown', e => { if (popOpen && !pop.contains(e.target) && !e.target.classList.contains('more')) closePop(); });
  function imagePopover(rec, b) {
    const others = S().blots.filter(x => x !== b);
    pop.innerHTML = `<h4>${esc(rec.name)}</h4>
      <div class="field inline"><label class="inline-label">类型</label>
        <div class="seg"><button data-k="chemi" class="${rec.kind === 'chemi' ? 'on' : ''}">曝光图</button><button data-k="marker" class="${rec.kind === 'marker' ? 'on' : ''}">Marker 白光</button></div></div>
      ${rec.kind === 'chemi' ? `<div class="field inline"><label class="inline-label">曝光时间</label><input type="number" id="pExpo" class="num" step="any" value="${rec.exposure != null ? rec.exposure : ''}" placeholder="秒"> s</div>` : ''}
      <div class="field inline"><label class="inline-label">移到</label><select id="pMove" style="flex:1"><option value="">—</option>${others.map(o => `<option value="${o.id}">${esc(App.blotName(o))}</option>`).join('')}<option value="new">新的一张膜</option></select></div>
      <div class="actions"><button class="btn sm danger" id="pDel">移除这张图</button><button class="btn sm primary" id="pOk">完成</button></div>`;
    placePop(event.target);
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
      const sugg = G.ProteinLadders.suggest(kda);
      // compact chip: the exposure in use, starred when it is the recommended one
      el.innerHTML = `<span class="swatch" style="background:${App.rowColor(row)}"></span>
        <input type="text" value="${esc(row.name)}" placeholder="${esc(sugg[0] ? sugg[0] + '？' : '蛋白名')}" list="protList">
        <span class="kda">${kda ? '≈' + Math.round(kda) + ' kDa' : ''}</span>
        <button class="expo-chip${isBest ? ' best' : ' other'}${App.expoVerdict(curE) === 'sat' ? ' sat' : ''}" data-act="expo" title="${isBest ? '正在用推荐的曝光' : '正在用的不是推荐曝光'}｜点开对比全部曝光">${isBest ? '★ ' : ''}${cur ? esc(App.expoLabel(cur)) : '—'}</button>
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
      el.onclick = e => { if (e.target === el || e.target.classList.contains('kda') || e.target.classList.contains('swatch')) selectRow(row.id, true); };
      box.appendChild(el);
      if (sel && ex.length) box.appendChild(expoCompare(row, ex, best));
    });
    if (!st.rows.length) box.innerHTML = '<p class="hint">没有识别出条带。用下面的按钮按分子量或在膜图上点选添加。</p>';
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
    wrap.innerHTML = `<div class="why">${why}${row.img !== best ? ' <button class="link" data-act="usebest">改用推荐</button>' : ''}</div><div class="tiles"></div>`;
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
    if (!row) { toast('没有哪张膜带 Marker 能覆盖这个分子量；可以用"在膜图上点选添加"'); return; }
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
    // lane offsets between membranes
    const used = [...new Set(st.rows.map(r => r.blot))];
    $('shiftBox').innerHTML = used.length > 1 ? '<p class="hint" style="margin-top:10px">各膜泳道对齐：若某张膜的样品整体错开一个孔（如 Ladder 位置不同），在这里调整。</p>' +
      used.map(bid => { const b = App.blot(bid); return `<div class="shift-row">${esc(App.blotName(b))} <span class="flex"></span><button data-b="${bid}" data-d="-1">‹</button><b>${b.shift > 0 ? '+' : ''}${b.shift}</b><button data-b="${bid}" data-d="1">›</button></div>`; }).join('') : '';
    $('shiftBox').querySelectorAll('button').forEach(btn => btn.onclick = done(() => { App.blot(btn.dataset.b).shift += +btn.dataset.d; }));
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
  ['invert', 'showMW', 'unitHeader'].forEach(id => $(id).addEventListener('change', done(e => { S().style[id] = e.target.checked; })));
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
    if (!S()) return;
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

  /* ---------- coach ---------- */
  function updateCoach() {
    const st = S(), vis = st.rows.filter(r => !r.hidden), fl = App.figLanes();
    const unnamedRows = vis.filter(r => !r.name).length, unnamedLanes = fl.filter(j => !st.lanes[j - 1].name).length;
    const sat = vis.filter(r => { const e = App.rowExpo(r).find(x => x.id === r.img); return e && e.satFrac > 0.002; });
    const noMk = st.blots.filter(b => !App.markersOf(b).length && vis.some(r => r.blot === b.id));
    let msg, ok = false;
    if (!vis.length) msg = '没有识别出条带行：用左侧"按分子量添加"或"在膜图上点选添加"';
    else if (unnamedRows) msg = `下一步：在成图右侧<b>点灰色的"蛋白名"</b>输入，回车跳下一行（还差 ${unnamedRows} 行）`;
    else if (unnamedLanes) msg = `下一步：在成图上<b>点灰色泳道号</b>输入样品名，回车跳下一条（还差 ${unnamedLanes} 条）`;
    else if (sat.length) msg = `「${sat[0].name}」所选曝光有过曝：在左侧该行<b>点更短的曝光</b>`;
    else if (noMk.length) msg = `${App.blotName(noMk[0])}没有 Marker 白光图，分子量无法标注：可把它拖进来`;
    else { msg = '已可导出 —— 右上角<b>导出 PNG</b>；补充材料用"未裁切原图"'; ok = true; }
    $('coachText').innerHTML = msg; $('coach').classList.toggle('done', ok);
    $('imgCount').textContent = `${App.images.size} 张图 · 添加`;
  }

  function syncLayout() {
    const y = S().style;
    $('mmPerLane').value = y.mmPerLane; $('fontPt').value = y.fontPt; $('rowGap').value = y.rowGapPt; $('labelAngle').value = String(y.labelAngle);
    $('invert').checked = y.invert; $('showMW').checked = y.showMW; $('unitHeader').checked = y.unitHeader; $('panelLetter').value = y.panelLetter || '';
    $('dpiTop').value = String(y.dpi);
    $('stLayout').textContent = `${y.mmPerLane} mm/泳道 · ${y.fontPt} pt`;
    $('btnUndo').disabled = App.hist.length < 2; $('btnRedo').disabled = !App.future.length;
  }

  App.on(what => {
    if (!S()) return;
    if (what === 'loaded') { $('emptyState').classList.add('hidden'); $('sections').classList.remove('hidden'); }
    if (what === 'refresh') { updatePreview(); return; }
    if (what === 'select') { renderBlots(); renderRows(); renderStageHead(); updatePreview(); G.View.draw(); return; }
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
    pages.forEach((p, k) => {
      const sc = Wout / p.rec.img.w, h = p.rec.img.h * sc, top = y0 + fs * 2.2;
      ctx.fillStyle = '#000'; ctx.font = `bold ${fs * 0.8}px Arial`;
      ctx.fillText(`${App.blotName(p.b)} — ${p.rec.kind === 'marker' ? 'white-light marker image' : 'exposure ' + App.expoLabel(p.rec)} — ${p.rec.name}`, 14, y0 + fs * 1.4);
      ctx.drawImage(G.View.dispCanvas(p.rec), 0, top, Wout, h);
      st.rows.filter(r => !r.hidden && r.blot === p.b.id && (p.rec.kind === 'marker' || r.img === p.rec.id)).forEach(r => {
        const g = r.geo, F = WB.frame(g.ox, g.oy, g.angle), [j0, j1] = st.range;
        const u0 = g.uOrigin + (j0 + p.b.shift - 0.5) * g.pitch, u1 = g.uOrigin + (j1 + p.b.shift + 0.5) * g.pitch;
        const pts = [[u0, g.vTop], [u1, g.vTop], [u1, g.vBot], [u0, g.vBot]].map(([u, v]) => WB.toImg(F, u, v));
        ctx.strokeStyle = '#e03131'; ctx.lineWidth = 2; ctx.beginPath();
        pts.forEach(([x, y], i) => { if (i) ctx.lineTo(x * sc, top + y * sc); else ctx.moveTo(x * sc, top + y * sc); }); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = '#e03131'; ctx.font = `bold ${fs * 0.7}px Arial`;
        ctx.fillText(`${r.name || '?'}`, pts[1][0] * sc + 6, top + pts[1][1] * sc + fs * 0.7);
        // lane numbers along the top of the box; omitted lanes marked X
        ctx.font = `${fs * 0.55}px Arial`; ctx.textAlign = 'center';
        for (let j = j0; j <= j1; j++) {
          const [x, y] = WB.toImg(F, g.uOrigin + (j + p.b.shift) * g.pitch, g.vTop);
          ctx.fillText(st.lanes[j - 1].hidden ? 'X' : String(j), x * sc, top + y * sc - 4);
        }
        ctx.textAlign = 'left';
      });
      y0 += heights[k];
    });
    c.toBlob(bl => G.Export.download(bl, 'uncropped_originals.png'), 'image/png');
    toast(`已导出未裁切原图（${pages.length} 张）`);
  }
  function exportQuant() {
    const st = S(), fl = App.figLanes(), rows = st.rows.filter(r => !r.hidden);
    const data = rows.map(r => {
      const b = App.blot(r.blot), rec = App.images.get(r.img), gf = App.rowGeoFull(r);
      const us = fl.map(j => gf.uOrigin + (j + b.shift) * gf.pitch);
      return { r, b, rec, d: WB.densitometry(rec.img, rec.cs, gf, us) };
    });
    const head = ['protein', 'membrane', 'exposure'].concat(fl.map(j => st.lanes[j - 1].name || 'lane ' + j));
    const lines = [head];
    data.forEach(x => lines.push([x.r.name || '?', App.blotName(x.b), App.expoLabel(x.rec)].concat(x.d.map(v => v.volume.toFixed(2) + (v.saturated ? ' (SAT)' : '')))));
    // normalized to a same-membrane loading control, then to the first lane
    const ctrls = data.filter(x => App.isLoading(x.r));
    data.filter(x => !App.isLoading(x.r)).forEach(x => {
      const c = ctrls.find(c => c.b === x.b); if (!c) return;
      const ratio = x.d.map((v, i) => v.volume / Math.max(1e-9, c.d[i].volume)), r0 = ratio[0] || 1;
      lines.push([`${x.r.name}/${c.r.name} (rel. lane 1)`, App.blotName(x.b), ''].concat(ratio.map(v => (v / r0).toFixed(3))));
    });
    lines.push([]); lines.push(['Volumes = sum of (pixel - local background) over the band, on the exposure shown in the figure. SAT = saturated pixels: do not quantify.']);
    const csv = lines.map(l => l.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\r\n');
    G.Export.download(new Blob(['﻿' + csv], { type: 'text/csv' }), 'blot_quantification.csv');
    toast('已导出定量 CSV（用于参考；正式定量请用 ≥3 次独立实验）', 3600);
  }

  G.UI = { toast, editRowName, openEd, lastFig: () => lastFig };

  /* ---------- dev params ---------- */
  const qs = new URLSearchParams(location.search);
  if (qs.get('demo') === '1' || qs.get('srcdir')) setTimeout(async () => {
    if (qs.get('srcdir')) {
      const list = qs.get('srcs').split(','), files = [];
      for (const n of list) files.push({ name: n, buffer: await (await fetch(qs.get('srcdir') + '/' + n)).arrayBuffer() });
      await addFiles(files);
    } else await loadDemo();
    const st = S();
    if (qs.get('ladder')) { st.blots.forEach(b => { b.ladderId = qs.get('ladder'); b.ladderAuto = false; }); App.commit(); }
    if (qs.get('sel')) { const vis = st.rows.filter(r => !r.hidden), r = vis[+qs.get('sel')]; if (r) { App.selRow = r.id; App.viewBlot = r.blot; App.viewImg = r.img; App.emit('select'); } }
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
      G.Export.download = (blob, name) => got.push(name + ':' + blob.size);
      exportRaw(); exportQuant();
      await new Promise(r => setTimeout(r, 1500));
      G.Export.download = orig;
      window.__exports = got;
    }
    document.title = 'READY ' + JSON.stringify({
      exports: window.__exports,
      blots: st.blots.map(b => { const A = App.analysis[b.id]; return { n: b.images.length, kinds: b.images.map(id => App.images.get(id).name.slice(0, 2) + App.images.get(id).kind[0]).join(' '), ladder: b.ladderId, shift: b.shift,
        strips: A && A.strips.map(s => `${Math.round(s.cx)},${Math.round(s.cy)} ${s.angle}° ${Math.round(s.w)}x${Math.round(s.h)}`), pitch: A && Math.round(A.pitch),
        ladderBands: A && A.ladderStrips.map(l => l && l.bands.length + '@' + Math.round(l.uStrip || 0)), rank: A && A.ladderRank.slice(0, 3).map(r => r.id + ':' + r.q.toFixed(2)), notes: A && A.notes }; }), range: st.range,
      rowsGeo: st.rows.map(r => ({ ks: r.geo.ks.join(','), oy: Math.round(r.geo.oy), strip: r.geo.strip, h: Math.round(r.geo.vBot - r.geo.vTop) })),
      rows: st.rows.map(r => ({ b: st.blots.indexOf(App.blot(r.blot)), kda: Math.round(App.rowKda(r) || 0), expo: App.expoLabel(App.images.get(r.img)), best: App.images.get(App.bestExpo(r)) && App.expoLabel(App.images.get(App.bestExpo(r))), verdict: App.expoVerdict(App.rowExpo(r).find(e => e.id === r.img)), hidden: r.hidden, name: r.name })),
      coach: $('coachText').textContent, warn: App.checks().warn
    });
  }, 60);
})(window);
