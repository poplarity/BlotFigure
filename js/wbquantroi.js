(function (global) {
  'use strict';
  const App = global.BApp, translate = (chinese, english) => global.L(chinese, english);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  let active = null;
  const vertices = (spec, bounds) => [[bounds.u0, bounds.v0], [bounds.u1, bounds.v0], [bounds.u1, bounds.v1], [bounds.u0, bounds.v1]].map(point => global.WB.toImg(spec.F, point[0], point[1]));
  const field = (identifier, title, value, minimum, maximum, step) => `<label>${title}<input id="${identifier}" type="number" value="${value}" min="${minimum}" max="${maximum}" step="${step || 1}"></label>`;
  function canvasPoint(state, point) {
    const canvas = state.get('qRoiCanvas'), box = canvas.getBoundingClientRect();
    return [(point[0] - state.view.left) * state.view.scale * box.width / canvas.width, (point[1] - state.view.top) * state.view.scale * box.height / canvas.height];
  }
  function handles(state) {
    const spec = state.specs?.[state.selected];
    if (!spec || spec.mode !== 'fixed') return {};
    const halfWidth = state.draft.width / 2, halfHeight = state.draft.height / 2;
    return Object.fromEntries(Object.entries({ nw: [-halfWidth, -halfHeight], n: [0, -halfHeight], ne: [halfWidth, -halfHeight], e: [halfWidth, 0],
      se: [halfWidth, halfHeight], s: [0, halfHeight], sw: [-halfWidth, halfHeight], w: [-halfWidth, 0] }).map(([name, point]) => [name, canvasPoint(state, global.WB.toImg(spec.F, ...point))]));
  }
  function open(rowId, changed, trigger) {
    const row = App.row(rowId), rec = row && App.images.get(row.img);
    if (!rec || !rec.cs) return;
    if (active) active.dialog.close();
    const geometry = App.columns(App.rowColumn(row)), rowIndex = geometry.rows.findIndex(candidate => candidate.id === rowId);
    if (rowIndex < 0) return;
    const dialog = document.createElement('dialog'); dialog.id = 'qRoiDialog'; dialog.className = 'qroi-dialog';
    const draft = JSON.parse(JSON.stringify(App.quantRoiConfig(row)));
    dialog.setAttribute('aria-labelledby', 'qRoiTitle');
    dialog.innerHTML = `<div class="qroi-head"><div><h2 id="qRoiTitle">${translate('调整定量框', 'Adjust quantification ROIs')} · ${escape(row.name || translate('未命名', 'Unnamed protein'))}</h2><p class="hint">${escape(rec.name)} · ${escape(App.expoLabel(rec))} · ${translate('不改变成图', 'Figure stays unchanged')}</p></div><button type="button" id="qRoiClose" class="btn sm ghost" aria-label="${translate('取消并关闭', 'Cancel and close')}">×</button></div>`
      + `<div class="qroi-main"><div class="qroi-size-fields qroi-fields">`
      + field('qRoiWidth', translate('统一宽 / px', 'Shared width / px'), draft.width, 2, 2048)
      + field('qRoiHeight', translate('统一高 / px', 'Shared height / px'), draft.height, 2, 2048)
      + `<output id="qRoiSize" class="qroi-size"></output></div>`
      + `<div class="qroi-tools"><div class="seg" id="qRoiToolSeg" role="group" aria-label="${translate('编辑方式', 'Editing tool')}"><button type="button" data-roi-tool="lane">${translate('单道', 'One lane')}</button><button type="button" data-roi-tool="row">${translate('整排', 'All lanes')}</button><button type="button" data-roi-tool="draw">${translate('画框', 'Draw')}</button></div>`
      + `<button type="button" id="qRoiFit" class="btn sm">${translate('整排', 'Fit row')}</button><button type="button" id="qRoiFocus" class="btn sm">${translate('放大', 'Zoom to lane')}</button></div>`
      + `<div class="qroi-canvas-wrap"><canvas id="qRoiCanvas" tabindex="0" aria-label="${translate('定量源图：拖动框移动，拖动控制点统一缩放；方向键微移，Shift 加方向键移动整排', 'Source image: drag a box to move, drag handles to resize all ROIs; arrows nudge, Shift plus arrows moves all lanes')}"></canvas></div>`
      + `<div class="qroi-navigation"><button class="btn sm" type="button" id="qRoiPrev" aria-label="${translate('上一道', 'Previous lane')}">‹</button><label for="qRoiLane">${translate('泳道', 'Lane')}</label><select id="qRoiLane">${geometry.vis.map((lane, index) => `<option value="${index}">${lane}</option>`).join('')}</select><button class="btn sm" type="button" id="qRoiNext" aria-label="${translate('下一道', 'Next lane')}">›</button><span class="hint">${translate('拖框移动 · 拖控制点统一缩放', 'Drag boxes to move · handles resize all')}</span></div>`
      + `<p class="hint qroi-legend">${translate('蓝：积分框 · 橙虚线：背景 · 灰：成图源区域。请核对完整条带和干净背景；红框表示该道无法计算。', 'Blue: signal · orange dashed: background · grey: figure crop. Review full bands and clean background; red means excluded.')}</p></div>`
      + `<aside class="qroi-side"><details class="adv" id="qRoiAdvanced"${draft.mode === 'adaptive' ? ' open' : ''}><summary>${translate('背景与高级设置', 'Background & advanced')}</summary><div class="qroi-fields">`
      + `<label>${translate('局部背景', 'Local background')}<select id="qRoiBackgroundDirection"><option value="sides">${translate('左右两侧', 'Left and right')}</option><option value="above-below">${translate('上方和下方', 'Above and below')}</option></select></label>`
      + field('qRoiGap', translate('背景间隔 / px', 'Background gap / px'), draft.gap, 0, 2048)
      + field('qRoiBackgroundWidth', translate('背景条宽 / px', 'Background strip / px'), draft.backgroundWidth, 1, 2048)
      + field('qRoiPitch', translate('等距 / px（0 跟随原位置）', 'Pitch / px (0 = original centres)'), draft.pitch, 0, 4096, 0.1)
      + field('qRoiAngle', translate('相对角度 / °', 'Relative angle / °'), draft.angle, -45, 45, 0.1)
      + `<label>${translate('积分方式', 'Integration')}<select id="qRoiMode"><option value="fixed">${translate('固定尺寸（默认）', 'Fixed dimensions (default)')}</option><option value="adaptive">${translate('高级：自适应峰宽', 'Advanced: adaptive peak width')}</option></select></label></div><p id="qRoiHint" class="hint"></p><button type="button" id="qRoiReset" class="btn sm ghost">${translate('恢复建议', 'Reset suggestion')}</button></details>`
      + `<div class="qroi-results-head"><b>${translate('逐道实时结果', 'Live lane results')}</b><span class="hint" id="qRoiCount"></span></div><div id="qRoiValues" class="qroi-values"></div></aside>`
      + `<div class="qroi-footer"><span class="hint" id="qRoiValidation">${translate('同一蛋白全部泳道共用宽高；应用前仅为草稿。', 'One shared size per protein. Changes stay a draft until Apply.')}</span><button id="qRoiCancel" type="button" class="btn">${translate('取消', 'Cancel')}</button><button id="qRoiApply" type="button" class="btn primary">${translate('应用到本蛋白', 'Apply to this protein')}</button></div>`;
    document.body.appendChild(dialog);
    const state = { dialog, row, rec, geometry, sources: geometry.src[rowIndex], draft, selected: Math.max(0, geometry.src[rowIndex].findIndex(Boolean)), changed, view: null, pointer: null, tool: 'lane' };
    active = state;
    const get = identifier => dialog.querySelector('#' + identifier);
    state.get = get;
    const thumbnail = global.Engine.downsample({ w: rec.img.w, h: rec.img.h, data: rec.cs.sig }, 1600), texture = document.createElement('canvas');
    texture.width = thumbnail.w; texture.height = thumbnail.h;
    const pixels = texture.getContext('2d').createImageData(thumbnail.w, thumbnail.h);
    const display = App.mapper(rec.id, App.rowLevels(row));
    thumbnail.data.forEach((value, index) => {
      const shade = display(value);
      pixels.data[index * 4] = shade; pixels.data[index * 4 + 1] = shade; pixels.data[index * 4 + 2] = shade; pixels.data[index * 4 + 3] = 255;
    });
    texture.getContext('2d').putImageData(pixels, 0, 0); state.texture = texture; state.thumbnailFactor = thumbnail.f;
    get('qRoiMode').value = draft.mode; get('qRoiBackgroundDirection').value = draft.backgroundDirection; get('qRoiLane').value = state.selected;
    const fields = { qRoiWidth: 'width', qRoiHeight: 'height', qRoiPitch: 'pitch', qRoiAngle: 'angle', qRoiGap: 'gap', qRoiBackgroundWidth: 'backgroundWidth' };
    const validate = () => {
      const invalid = Object.keys(fields).some(identifier => !get(identifier).disabled && (!get(identifier).checkValidity() || get(identifier).value === ''));
      get('qRoiApply').disabled = invalid;
      get('qRoiValidation').textContent = invalid ? translate('请输入有效尺寸；预览保留上一次有效数值。', 'Enter valid dimensions; the preview keeps the last valid values.') : translate('同一蛋白全部泳道共用宽高；应用前仅为草稿。', 'One shared size per protein. Changes stay a draft until Apply.');
      return !invalid;
    };
    state.validate = validate;
    const update = () => {
      if (!validate()) return;
      Object.entries(fields).forEach(([identifier, name]) => state.draft[name] = Number(get(identifier).value));
      state.draft.mode = get('qRoiMode').value; state.draft.backgroundDirection = get('qRoiBackgroundDirection').value;
      state.draft = App.quantRoiConfig(row, state.draft); render(state);
    };
    Object.keys(fields).forEach(identifier => get(identifier).oninput = update);
    get('qRoiMode').onchange = update; get('qRoiBackgroundDirection').onchange = update;
    const selectLane = index => {
      state.selected = Math.max(0, Math.min(state.sources.length - 1, index)); get('qRoiLane').value = state.selected;
      if (state.focus) state.view = null;
      render(state);
    };
    get('qRoiLane').onchange = () => selectLane(Number(get('qRoiLane').value));
    get('qRoiPrev').onclick = () => selectLane(state.selected - 1);
    get('qRoiNext').onclick = () => selectLane(state.selected + 1);
    get('qRoiToolSeg').onclick = event => { const button = event.target.closest('[data-roi-tool]'); if (button) { state.tool = button.dataset.roiTool; render(state); } };
    get('qRoiValues').onclick = event => { const item = event.target.closest('[data-lane-index]'); if (item) selectLane(Number(item.dataset.laneIndex)); };
    get('qRoiValues').onkeydown = event => { if (['Enter', ' '].includes(event.key) && event.target.dataset.laneIndex) { event.preventDefault(); selectLane(Number(event.target.dataset.laneIndex)); } };
    get('qRoiFit').onclick = () => { state.view = null; state.focus = false; render(state); };
    get('qRoiFocus').onclick = () => { state.view = null; state.focus = true; render(state); };
    get('qRoiReset').onclick = () => {
      state.draft = App.quantRoiConfig(row, {});
      Object.entries(fields).forEach(([identifier, name]) => get(identifier).value = state.draft[name]);
      get('qRoiMode').value = 'fixed'; get('qRoiBackgroundDirection').value = 'sides'; state.view = null; render(state);
    };
    const close = () => dialog.close();
    get('qRoiCancel').onclick = close; get('qRoiClose').onclick = close;
    get('qRoiApply').onclick = () => {
      if (Object.keys(fields).some(identifier => !get(identifier).checkValidity() || get(identifier).value === '')) return;
      App.setQuantRoi(rowId, state.draft); dialog.close(); changed();
    };
    const opener = trigger || document.activeElement;
    dialog.addEventListener('close', () => {
      if (active === state) active = null; state.observer?.disconnect(); if (state.resizeFrame) cancelAnimationFrame(state.resizeFrame); dialog.remove();
      const restore = opener?.isConnected && opener !== document.body ? opener : document.getElementById(opener?.id) || document.getElementById('qRoiToolbar'); restore?.focus();
    });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    const canvas = get('qRoiCanvas');
    const world = event => {
      const rectangle = canvas.getBoundingClientRect();
      return [state.view.left + (event.clientX - rectangle.left) * canvas.width / rectangle.width / state.view.scale,
        state.view.top + (event.clientY - rectangle.top) * canvas.height / rectangle.height / state.view.scale];
    };
    const handleAt = event => {
      if (state.tool !== 'lane') return null;
      const box = canvas.getBoundingClientRect();
      return Object.entries(handles(state)).find(([, point]) => Math.hypot(point[0] - event.clientX + box.left, point[1] - event.clientY + box.top) <= 7)?.[0] || null;
    };
    canvas.onpointerdown = event => {
      if (event.button !== 0 || state.draft.mode !== 'fixed' || !state.view) return;
      const point = world(event), tool = state.tool, handle = handleAt(event);
      if (tool !== 'draw' && !handle) {
        const hit = state.specs.findIndex((spec, index) => {
          if (!spec || !state.measurements[index]?.bounds) return false;
          const local = global.WB.toFrame(spec.F, point[0], point[1]), bounds = state.measurements[index].bounds;
          return local[0] >= bounds.u0 && local[0] <= bounds.u1 && local[1] >= bounds.v0 && local[1] <= bounds.v1;
        });
        if (hit < 0) return;
        state.selected = hit;
      }
      const source = state.sources[state.selected]; if (!source) return;
      state.pointer = { start: point, draft: JSON.parse(JSON.stringify(state.draft)), source, spec: state.specs[state.selected], base: App.quantSourceLaneSpec(row, source, rec).F, tool, handle };
      get('qRoiLane').value = state.selected; canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); event.preventDefault(); render(state);
    };
    canvas.onpointermove = event => {
      if (!state.pointer) {
        const handle = handleAt(event);
        canvas.style.cursor = handle ? ({ n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[handle]) : state.tool === 'draw' ? 'crosshair' : 'grab';
        return;
      }
      const gesture = state.pointer, point = world(event), start = global.WB.toFrame(gesture.base, ...gesture.start), end = global.WB.toFrame(gesture.base, ...point);
      state.draft = JSON.parse(JSON.stringify(gesture.draft));
      const key = App.quantRoiKey(gesture.source), offset = state.draft.lanes[key] || { u: 0, v: 0 };
      if (gesture.handle) {
        const local = global.WB.toFrame(gesture.spec.F, ...point), horizontal = /[ew]/.test(gesture.handle), vertical = /[ns]/.test(gesture.handle);
        const directionU = gesture.handle.includes('e') ? 1 : -1, directionV = gesture.handle.includes('s') ? 1 : -1;
        const anchorU = -directionU * gesture.draft.width / 2, anchorV = -directionV * gesture.draft.height / 2;
        if (horizontal) state.draft.width = Math.max(2, Math.min(2048, Math.round(directionU * (local[0] - anchorU))));
        if (vertical) state.draft.height = Math.max(2, Math.min(2048, Math.round(directionV * (local[1] - anchorV))));
        const centre = global.WB.toImg(gesture.spec.F, horizontal ? anchorU + directionU * state.draft.width / 2 : 0, vertical ? anchorV + directionV * state.draft.height / 2 : 0);
        const moved = global.WB.toFrame(gesture.base, ...centre), previous = global.WB.toFrame(gesture.base, gesture.spec.F.ox, gesture.spec.F.oy);
        state.draft.lanes[key] = { u: (offset.u || 0) + moved[0] - previous[0], v: (offset.v || 0) + moved[1] - previous[1] };
        get('qRoiWidth').value = state.draft.width; get('qRoiHeight').value = state.draft.height;
      } else if (gesture.tool === 'row') { state.draft.offsetU += end[0] - start[0]; state.draft.offsetV += end[1] - start[1]; }
      else if (gesture.tool === 'draw') {
        const first = global.WB.toFrame(gesture.spec.F, ...gesture.start), last = global.WB.toFrame(gesture.spec.F, ...point);
        state.draft.width = Math.max(2, Math.min(2048, Math.round(Math.abs(last[0] - first[0]))));
        state.draft.height = Math.max(2, Math.min(2048, Math.round(Math.abs(last[1] - first[1]))));
        const centre = global.WB.toImg(gesture.spec.F, (first[0] + last[0]) / 2, (first[1] + last[1]) / 2);
        const moved = global.WB.toFrame(gesture.base, ...centre), previous = global.WB.toFrame(gesture.base, gesture.spec.F.ox, gesture.spec.F.oy);
        state.draft.lanes[key] = { u: (offset.u || 0) + moved[0] - previous[0], v: (offset.v || 0) + moved[1] - previous[1] };
        get('qRoiWidth').value = state.draft.width; get('qRoiHeight').value = state.draft.height;
      } else state.draft.lanes[key] = { u: (offset.u || 0) + end[0] - start[0], v: (offset.v || 0) + end[1] - start[1] };
      render(state);
    };
    canvas.onpointerup = canvas.onpointercancel = () => { state.pointer = null; };
    canvas.onkeydown = event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      const source = state.sources[state.selected]; if (!delta || !source || state.draft.mode !== 'fixed') return;
      event.preventDefault();
      if (event.shiftKey) { state.draft.offsetU += delta[0]; state.draft.offsetV += delta[1]; }
      else {
        const key = App.quantRoiKey(source), offset = state.draft.lanes[key] || { u: 0, v: 0 };
        state.draft.lanes[key] = { u: (offset.u || 0) + delta[0], v: (offset.v || 0) + delta[1] };
      }
      render(state);
    };
    dialog.showModal(); render(state); get('qRoiWidth').focus({ preventScroll: true });
    state.observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width > 0 && width !== state.containerWidth) {
        state.containerWidth = width;
        if (!state.resizeFrame) state.resizeFrame = requestAnimationFrame(() => { state.resizeFrame = 0; if (dialog.open) { state.view = null; render(state); } });
      }
    });
    state.observer.observe(canvas.parentElement);
  }
  function render(state) {
    const { get, rec, draft } = state, canvas = get('qRoiCanvas');
    const specs = state.sources.map(source => App.quantLaneSpec(state.row, source, rec, draft));
    const measurements = global.WB.quantify(rec.img, rec.cs, specs);
    state.specs = specs; state.measurements = measurements;
    if (!state.view) {
      const focusAvailable = state.focus && !!specs[state.selected] && !!measurements[state.selected]?.bounds;
      const points = specs.flatMap((spec, index) => {
        if (!spec || !measurements[index]?.bounds || focusAvailable && index !== state.selected) return [];
        const context = [measurements[index].bounds, ...(measurements[index].backgroundBounds || [])].flatMap(bounds => vertices(spec, bounds));
        if (!state.focus && spec.sourceCrop) context.push(...vertices({ F: spec.sourceCrop.F }, spec.sourceCrop.bounds));
        return context;
      });
      if (!points.length) points.push([0, 0], [rec.img.w, rec.img.h]);
      const left = Math.min(...points.map(point => point[0])) - 25, right = Math.max(...points.map(point => point[0])) + 25;
      const top = Math.min(...points.map(point => point[1])) - 25, bottom = Math.max(...points.map(point => point[1])) + 25;
      canvas.width = Math.max(300, Math.min(1100, canvas.parentElement.clientWidth));
      canvas.height = Math.min(400, Math.max(250, Math.round(canvas.width * (bottom - top) / (right - left))));
      const scale = Math.min(canvas.width / (right - left), canvas.height / (bottom - top));
      state.view = { left: (left + right - canvas.width / scale) / 2, top: (top + bottom - canvas.height / scale) / 2, scale };
    }
    const context = canvas.getContext('2d'), view = state.view;
    context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#edf0f4'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(state.texture, -view.left * view.scale, -view.top * view.scale, state.texture.width * state.thumbnailFactor * view.scale, state.texture.height * state.thumbnailFactor * view.scale);
    const polygon = (points, colour, dashed, selected) => {
      context.beginPath(); points.forEach((point, index) => context[index ? 'lineTo' : 'moveTo']((point[0] - view.left) * view.scale, (point[1] - view.top) * view.scale)); context.closePath();
      context.strokeStyle = colour; context.lineWidth = selected ? 2.5 : 1.2; context.setLineDash(dashed ? [5, 3] : []); context.stroke();
    };
    const shown = new Set();
    specs.forEach((spec, index) => {
      if (!spec || shown.has(state.sources[index].sg)) return;
      shown.add(state.sources[index].sg);
      const source = state.sources[index], original = App.quantSourceLaneSpec(state.row, source, rec);
      polygon(vertices(original, { u0: source.sg.x0, u1: source.sg.x1, v0: original.vTop, v1: original.vBot }), '#758294', true, false);
    });
    specs.forEach((spec, index) => {
      const measurement = measurements[index]; if (!spec || !measurement?.bounds) return;
      (measurement.backgroundBounds || []).forEach(bounds => polygon(vertices(spec, bounds), '#b7640c', true, false));
      const points = vertices(spec, measurement.bounds);
      polygon(points, measurement.reason ? '#c62f36' : '#2366cb', false, index === state.selected);
      context.setLineDash([]); context.font = 'bold 12px system-ui'; context.fillStyle = '#fff';
      const horizontal = (points[0][0] - view.left) * view.scale, vertical = (points[0][1] - view.top) * view.scale - 4;
      context.fillRect(horizontal - 2, vertical - 13, 25, 17); context.fillStyle = '#152332'; context.fillText(String(state.geometry.vis[index]), horizontal, vertical);
    });
    if (draft.mode === 'fixed' && state.tool === 'lane') {
      context.setLineDash([]);
      Object.values(handles(state)).forEach(point => {
        const horizontal = point[0] * canvas.width / canvas.getBoundingClientRect().width, vertical = point[1] * canvas.height / canvas.getBoundingClientRect().height;
        context.fillStyle = '#fff'; context.strokeStyle = '#2366cb'; context.lineWidth = 1.5;
        context.fillRect(horizontal - 4, vertical - 4, 8, 8); context.strokeRect(horizontal - 4, vertical - 4, 8, 8);
      });
    }
    get('qRoiSize').textContent = draft.mode === 'fixed' ? `${draft.width} × ${draft.height} px · ${draft.width * draft.height} px²` : translate('自适应峰宽 · 各道面积可能不同', 'Adaptive width · areas may differ');
    get('qRoiCount').textContent = `${measurements.filter(value => value?.quantifiable).length}/${measurements.length} ${translate('可计算', 'measured')}`;
    get('qRoiPrev').disabled = state.selected === 0; get('qRoiNext').disabled = state.selected === state.sources.length - 1;
    get('qRoiLane').value = state.selected;
    get('qRoiToolSeg').querySelectorAll('button').forEach(button => { button.classList.toggle('on', button.dataset.roiTool === state.tool); button.setAttribute('aria-pressed', button.dataset.roiTool === state.tool ? 'true' : 'false'); button.disabled = draft.mode !== 'fixed'; });
    get('qRoiHint').textContent = draft.mode === 'adaptive'
      ? translate('高级自适应模式：每道按 35% 峰宽估算边界，不保证等面积；固定框、位移和背景模板不用于此模式。', 'Advanced adaptive mode: each lane follows its 35% peak width, without equal-area ROIs. Fixed dimensions, offsets and background templates do not apply.')
      : translate('固定尺寸，逐道扣除同规则局部背景。初始位置和尺寸仅是建议，请核对完整条带、背景与泳道对应后应用。', 'Fixed dimensions with the same local-background rule per lane. Initial centres and dimensions are suggestions: inspect full bands, background and sample correspondence before applying.');
    ['qRoiWidth', 'qRoiHeight', 'qRoiPitch', 'qRoiAngle', 'qRoiGap', 'qRoiBackgroundWidth', 'qRoiBackgroundDirection'].forEach(identifier => get(identifier).disabled = draft.mode === 'adaptive');
    get('qRoiValues').innerHTML = `<table class="qtable"><thead><tr><th>${translate('泳道', 'Lane')}</th><th>${translate('扣背景信号', 'Background-subtracted signal')}</th><th>${translate('面积 / px²', 'Area / px²')}</th><th>${translate('局部背景', 'Local background')}</th><th>${translate('状态', 'Status')}</th></tr></thead><tbody>`
      + measurements.map((measurement, index) => `<tr data-lane-index="${index}" tabindex="0" aria-label="${translate('选择泳道 ', 'Select lane ')}${state.geometry.vis[index]}"${index === state.selected ? ' class="sel"' : ''}><td>${state.geometry.vis[index]}</td><td data-volume="${measurement?.volume ?? ''}">${measurement?.quantifiable ? Number(measurement.volume.toPrecision(5)) : '—'}</td><td>${measurement?.areaPx ?? '—'}</td><td>${measurement?.background == null ? '—' : Number(measurement.background.toPrecision(4))}</td><td>${escape(measurement?.reason ? reason(measurement.reason) : measurement ? translate('可计算 · 请核对条带', 'Measured · review band') : translate('无来源', 'No source'))}</td></tr>`).join('') + '</tbody></table>';
    state.validate();
  }
  function reason(value) {
    const labels = { 'ROI overlap': ['积分框重叠', 'Integration ROIs overlap'], 'background overlaps another ROI': ['背景区覆盖其他积分框', 'Background overlaps another ROI'],
      'ROI outside source image': ['积分框超出源图', 'ROI outside source image'], 'background outside source image': ['背景区超出源图', 'Background outside source image'],
      'ROI outside figure crop': ['积分框超出成图源区域', 'ROI outside figure crop'],
      'background saturated': ['背景区饱和', 'Background saturated'], saturated: ['信号饱和', 'Signal saturated'], 'invalid ROI dimensions': ['定量框尺寸无效', 'Invalid ROI dimensions'] };
    return labels[value] ? translate(...labels[value]) : value;
  }
  global.WBQuantROI = { open, reason, probe: () => active ? { width: active.draft.width, height: active.draft.height, handles: handles(active), selected: active.selected,
    centres: active.specs.map(spec => spec ? canvasPoint(active, spec.mode === 'fixed' ? [spec.F.ox, spec.F.oy] : global.WB.toImg(spec.F, spec.uc, (spec.b0 + spec.b1) / 2)) : null),
    measurements: active.measurements } : null, selectedCanvasPoint: () => {
    if (!active) return null;
    const spec = active.specs[active.selected], canvas = active.get('qRoiCanvas'), box = canvas.getBoundingClientRect();
    const centre = spec.mode === 'fixed' ? [spec.F.ox, spec.F.oy] : global.WB.toImg(spec.F, spec.uc, (spec.b0 + spec.b1) / 2);
    return [(centre[0] - active.view.left) * active.view.scale * box.width / canvas.width, (centre[1] - active.view.top) * active.view.scale * box.height / canvas.height];
  } };
})(window);
