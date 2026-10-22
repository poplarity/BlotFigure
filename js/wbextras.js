/* Optional local library, parameter presets and a small paste/import form for custom markers. */
(function(G){
  'use strict';
  const App=G.BApp, $=id=>document.getElementById(id), L=G.L||(zh=>zh), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dlg=document.createElement('div');dlg.id='libraryDlg';dlg.className='dlg extra-dialog hidden';document.body.appendChild(dlg);
  function close(){dlg.classList.add('hidden');}
  function show(title,body){$('fileMenu').classList.add('hidden');dlg.innerHTML=`<div class="dlg-body" role="dialog" aria-modal="true" aria-label="${esc(title)}"><button class="dlg-x" aria-label="${L('关闭','Close')}">×</button><h3>${esc(title)}</h3>${body}</div>`;dlg.classList.remove('hidden');dlg.querySelector('.dlg-x').onclick=close;}
  dlg.onkeydown=e=>{if(e.key==='Escape'&&!e.isComposing){e.stopPropagation();close();}};
  const say=message=>G.UI.toast(message,4000);
  function updateStatus(){const b=$('cacheStatus');b.classList.toggle('error',App.cacheStatus==='error');b.textContent=!App.S||App.noDraft?L('历史项目','Recent projects'):App.cacheStatus==='error'?L('缓存失败 · 保存文件','Cache failed · save file'):App.cacheStatus==='pending'?L('正在缓存…','Saving locally…'):L('已缓存 · 历史项目','Saved · recent projects');b.title=App.cacheStatus==='error'?L('浏览器存储不可用或空间不足；请用文件菜单保存项目。','Storage unavailable or full; save a project file from the File menu.'):L('打开本浏览器保存的历史项目','Open projects saved in this browser');}
  App.on(what=>{if(['storage','loaded','empty'].includes(what))updateStatus();});updateStatus();
  async function archiveCurrent(){
    if(!App.S)return true;await G.UI.flushPending();
    if(await App.saveDraft())return true;
    return confirm(L('本浏览器暂时不能缓存当前项目。请先用「文件 → 保存项目」留一份。仍要切换并放弃未保存的更改吗？','This browser cannot cache the current project. Save a project file first. Switch anyway and discard unsaved changes?'));
  }
  async function newProject(){if(!(await archiveCurrent()))return false;App.resetSession();close();return true;}
  async function importFiles(files,append=false){
    if(!files.length)return;
    if(!App.S||append){await G.UI.addFiles(files);return;}
    show(L('导入这批图片','Import these pictures'),`<p>${L('同一次实验可继续添加；新实验另建项目，当前进度会保留在历史项目中。','Append pictures from the same experiment, or start another project. Your current work stays in Recent projects.')}</p><div class="actions"><button class="btn primary" id="importNew">${L('另建项目并导入','Start a new project')}</button><button class="btn" id="importAppend">${L('添加到当前项目','Append to current project')}</button></div>`);
    $('importNew').onclick=async()=>{if(await newProject())await G.UI.addFiles(files);};$('importAppend').onclick=async()=>{close();await G.UI.addFiles(files);};
  }
  async function history(){
    show(L('历史项目','Recent projects'),`<p class="hint">${L('图片和调整自动保存在当前浏览器。换电脑请使用「保存项目」文件；清理浏览器数据也会清理这里。','Pictures and adjustments are saved in this browser. Use a saved project file on another computer; clearing browser data also clears this library.')}</p><div id="projectLibrary">${L('读取中…','Loading…')}</div>`);
    try{
      if(App.S){await G.UI.flushPending();await App.saveDraft();}
      const list=await App.listHistory(), host=$('projectLibrary');if(!host)return;
      host.innerHTML=list.length?list.map(p=>`<div class="library-card" data-project="${esc(p.projectId)}"><div class="project-info"><button class="link open-project">${esc(p.projectName||p.summary?.names?.join(', ')||L('未命名项目','Untitled project'))}</button><small>${esc(new Date(p.savedAt).toLocaleString())} · ${p.summary?.images||0} ${L('张图','pictures')} · ${p.summary?.rows||0} ${L('个区域','regions')}${p.projectId===App.projectId?' · '+L('当前','current'):''}</small></div><button class="btn sm rename-project">${L('改名','Rename')}</button><button class="x delete-project" aria-label="${L('删除缓存项目','Delete cached project')}">×</button></div>`).join(''):`<p>${L('还没有历史项目。导入图片后会自动缓存。','No projects yet. Imported pictures are cached automatically.')}</p>`;
      host.querySelectorAll('[data-project]').forEach(card=>{
        const id=card.dataset.project;
        if(id===App.projectId){const del=card.querySelector('.delete-project');del.disabled=true;del.title=L('当前项目正在自动缓存；切换项目后可删除','This project is being autosaved; switch projects before deleting it');}
        card.querySelector('.open-project').onclick=async()=>{if(id===App.projectId){close();return;}if(!(await archiveCurrent()))return;try{await App.restoreHistory(id);close();say(L('已恢复全部图片和调整','Restored all pictures and adjustments'));}catch(e){say(e.message);}};
        card.querySelector('.rename-project').onclick=async()=>{const input=document.createElement('input'),name=card.querySelector('.open-project');input.value=name.textContent;name.replaceWith(input);input.focus();input.select();let saved=false;const done=async()=>{if(saved)return;saved=true;await App.renameHistory(id,input.value);await history();};input.onblur=done;input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();done();}};};
        card.querySelector('.delete-project').onclick=async()=>{if(!confirm(L('删除这个本地缓存项目？已下载的项目文件不会删除。','Delete this locally cached project? Downloaded project files are kept.')))return;try{await App.deleteHistory(id);if(id===App.projectId)updateStatus();await history();}catch(e){say(e.message);}};
      });
    }catch(e){if($('projectLibrary'))$('projectLibrary').textContent=L('浏览器缓存不可用。仍可用「保存项目 / 打开项目」接着编辑。','Browser storage is unavailable. Save/open project files to continue later.');}
  }
  function presets(){
    const list=App.presets();
    show(L('参数预设','Parameter presets'),`<p class="hint">${L('保存字号、排版、导出参数和 Marker 型号。应用后可撤销。','Save fonts, layout, export settings and the marker model. Applying a preset can be undone.')}</p><div class="field inline"><input id="presetName" placeholder="${L('预设名称，例如：单栏 85 mm','Preset name, e.g. single column 85 mm')}"><button id="savePreset" class="btn primary" ${!App.S?'disabled':''}>${L('保存当前参数','Save current settings')}</button></div><div id="presetList">${list.map(p=>`<div class="library-card" data-preset="${esc(p.id)}"><div class="project-info"><b>${esc(p.name)}</b><small>${p.style?.fontPt} pt · ${p.style?.mmPerLane} mm/${L('泳道','lane')} · ${p.style?.dpi} dpi</small></div><button class="btn sm apply-preset" ${!App.S?'disabled':''}>${L('应用','Apply')}</button><button class="btn sm export-preset">${L('导出','Export')}</button><button class="x delete-preset">×</button></div>`).join('')}</div><label class="btn sm">${L('导入预设文件','Import preset file')}<input id="presetImport" type="file" accept=".json" hidden></label>`);
    $('savePreset').onclick=()=>{App.savePreset($('presetName').value);presets();};
    dlg.querySelectorAll('[data-preset]').forEach(card=>{const p=list.find(p=>p.id===card.dataset.preset);card.querySelector('.apply-preset').onclick=()=>{App.applyPreset(p);close();say(L('已应用预设（Ctrl+Z 撤销）','Preset applied (Ctrl+Z to undo)'));};card.querySelector('.delete-preset').onclick=()=>{App.deletePreset(p.id);presets();};card.querySelector('.export-preset').onclick=()=>G.Export.download(new Blob([JSON.stringify({...p,blotfigPreset:1},null,2)],{type:'application/json'}),'blot_parameter_preset.json');});
    $('presetImport').onchange=async e=>{try{const p=JSON.parse(await e.target.files[0].text());if(p.blotfigPreset!==1||!p.style||!p.name)throw new Error(L('请选择 BlotFigure 参数预设文件','Choose a BlotFigure parameter preset file'));const all=App.presets();p.id='preset_'+Date.now();all.push(p);G.PrefStorage.setItem('blotfig.parameterPresets',JSON.stringify(all));presets();}catch(err){say(err.message);}};
  }
  function customMarker(){
    if(!App.S)return;const b=App.blot(App.viewBlot)||App.S.blots[0];
    show(L('自定义 Marker','Custom marker'),`<p>${L('复制包装或说明书上的条带大小，粘贴在这里即可。','Copy the band sizes from the package or datasheet and paste them here.')}</p><div class="field"><label>${L('名称（可不填）','Name (optional)')}</label><input id="customMarkerName" placeholder="${L('我的 Marker','My marker')}"></div><div class="field"><label>${L('条带大小 · kDa','Band sizes · kDa')}</label><textarea id="customMarkerSizes" rows="3" placeholder="250, 150, 100, 75, 50, 37, 25, 20, 15, 10"></textarea><span class="hint">${L('空格、逗号、换行均可；顺序不限，也可以只有一条。','Spaces, commas or new lines; any order. A single band is also accepted.')}</span></div><div class="marker-import-preview" id="customMarkerPreview"></div><p class="hint" id="customMarkerError"></p><div class="actions"><label class="btn sm">${L('从文件导入','Import a file')}<input id="customMarkerFile" type="file" accept=".txt,.csv,.json" hidden></label><button class="btn sm" id="markerTemplate">${L('下载填写示例','Download example')}</button><button class="btn primary" id="saveCustomMarker" disabled>${L('保存并使用','Save and use')}</button></div>`);
    let definitions=null;
    const preview=()=>{definitions=null;try{const sizes=G.ProteinLadders.parseSizes($('customMarkerSizes').value);$('customMarkerPreview').innerHTML=sizes.map(k=>`<span>${k} kDa</span>`).join('');$('customMarkerError').textContent=L(`将按从大到小保存 ${sizes.length} 条，应用到${App.blotName(b)}。`,`Save ${sizes.length} bands in descending order for ${App.blotName(b)}.`);$('saveCustomMarker').disabled=false;}catch(e){$('customMarkerPreview').innerHTML='';$('customMarkerError').textContent=$('customMarkerSizes').value.trim()?e.message:'';$('saveCustomMarker').disabled=true;}};
    $('customMarkerSizes').oninput=preview;
    $('customMarkerFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const ds=G.ProteinLadders.parseImport(await f.text(),f.name);$('customMarkerName').value=ds[0].name||'';$('customMarkerSizes').value=ds[0].sizes.join(', ');preview();definitions=ds;if(ds.length>1)$('customMarkerError').textContent=L(`将导入 ${ds.length} 个型号，先使用第一个。`,`Import ${ds.length} models and use the first.`);}catch(err){$('customMarkerError').textContent=err.message;}};
    $('markerTemplate').onclick=()=>G.Export.download(new Blob(['kDa\n250\n150\n100\n75\n50\n37\n25\n20\n15\n10\n'],{type:'text/csv'}),'marker_example.csv');
    $('saveCustomMarker').onclick=()=>{try{const ds=definitions||[{name:$('customMarkerName').value,sizes:G.ProteinLadders.parseSizes($('customMarkerSizes').value)}];ds[0].name=$('customMarkerName').value;const ladders=ds.map(d=>G.ProteinLadders.saveCustom(d.name,d.sizes,{ref:d.ref}));App.setLadder(b,ladders[0].id);App.commit();close();say(L('已保存，之后可直接从 Marker 列表选择','Saved; choose it from the marker list next time'));}catch(e){$('customMarkerError').textContent=e.message;}};
  }
  // The existing thumbnail/group controls live in the central workspace in step 1.
  const gallery=document.createElement('div');gallery.id='imageGallery';gallery.className='image-gallery';
  gallery.innerHTML=`<div class="gallery-top"><b>${L('整理这一批图片','Organise these pictures')}</b><button class="btn primary sm" id="galleryDone">${L('确认分组，继续 →','Confirm groups and continue →')}</button></div><p class="hint">${L('点图片在右侧放大查看；拖到另一组即可移动。勾选后可批量整理。','Click a picture to inspect it on the right. Drag between groups, or select several to organise together.')}</p>`;
  $('rawCol').appendChild(gallery);gallery.appendChild($('blotList'));
  const inspect=document.createElement('div');inspect.id='galleryInspect';inspect.className='gallery-inspect';$('figCol').appendChild(inspect);
  const launcher=document.createElement('button');launcher.className='btn sm';launcher.textContent=L('打开图片浏览','Browse pictures');launcher.onclick=()=>G.UI.openStep(1);$('secImages').querySelector('.step-body').prepend(launcher);
  $('galleryDone').onclick=()=>G.UI.finishImages();
  let shownCanvas=null, zoom=1;
  function updateGallery(){
    const active=!!App.S&&App.curStep===1;document.body.classList.toggle('gallery-mode',active);if(!active){inspect.innerHTML='';shownCanvas=null;return;}
    const b=App.blot(App.viewBlot)||App.S.blots[0];if(!b){inspect.innerHTML='';return;}
    const rec=App.images.get(App.viewImg)||App.images.get(b.marker)||App.images.get(b.images[0]);if(!rec)return;
    const host=App.S.blots.find(b=>b.images.includes(rec.id))||b;App.viewImg=rec.id;App.viewBlot=host.id;
    const src=G.View.dispCanvas(rec,true);if(shownCanvas!==src){zoom=1;shownCanvas=src;}
    inspect.innerHTML=`<div class="gallery-caption"><b title="${esc(rec.name)}">${esc(rec.name)}</b><span>${esc(App.blotName(host))} · ${rec.kind==='marker'?L('白光 / 复合图','White light / merged'):L('曝光图','Exposure')}${host.marker===rec.id?' · ★ Marker':''}</span></div><div class="gallery-actions"><button class="btn sm ${host.marker===rec.id?'primary':''}" id="galleryUseMarker">${host.marker===rec.id?L('★ 当前 Marker 图','★ Current marker picture'):L('设为 Marker 图','Use as marker picture')}</button><button class="btn sm" id="galleryUseExposure" ${rec.kind==='chemi'?'disabled':''}>${L('设为曝光图','Use as exposure')}</button><span class="flex"></span><button class="btn sm" id="galleryZoomOut">−</button><button class="btn sm" id="galleryZoomReset">${L('适合窗口','Fit')}</button><button class="btn sm" id="galleryZoomIn">+</button></div><div class="gallery-image-scroll" tabindex="0"><canvas id="galleryCanvas"></canvas></div>`;
    const canvas=$('galleryCanvas');canvas.width=src.width;canvas.height=src.height;canvas.getContext('2d').drawImage(src,0,0);
    const size=()=>{canvas.style.width=(zoom*100)+'%';};size();
    $('galleryZoomIn').onclick=()=>{zoom=Math.min(4,zoom+.5);size();};$('galleryZoomOut').onclick=()=>{zoom=Math.max(1,zoom-.5);size();};$('galleryZoomReset').onclick=()=>{zoom=1;size();};
    $('galleryUseMarker').onclick=()=>{if(host.marker===rec.id)return;App.setMarkerImage(host,rec.id);App.viewImg=rec.id;App.viewBlot=host.id;App.commit();};
    $('galleryUseExposure').onclick=()=>{App.setKind(rec.id,'chemi');App.viewImg=rec.id;App.commit();};
    $('galleryDone').textContent=App.reviewReturnStep>=3&&App.S.blots.every(b=>b.boxesReady)?L('完成整理，返回编辑 →','Done, return to editing →'):L('确认分组，继续 →','Confirm groups and continue →');
  }
  App.on(what=>{if(['loaded','change','select','empty'].includes(what))updateGallery();});updateGallery();
  ['btnHistory','btnHistoryStart','cacheStatus'].forEach(id=>$(id).onclick=history);
  $('btnPresets').onclick=presets;$('btnCustomMarker').onclick=customMarker;
  G.I18N?.onChange(()=>{updateStatus();updateGallery();launcher.textContent=L('打开图片浏览','Browse pictures');gallery.querySelector('.gallery-top b').textContent=L('整理这一批图片','Organise these pictures');gallery.querySelector(':scope > .hint').textContent=L('点图片在右侧放大查看；拖到另一组即可移动。勾选后可批量整理。','Click a picture to inspect it on the right. Drag between groups, or select several to organise together.');});
  G.Extras={newProject,importFiles,archiveCurrent,history,presets,customMarker};
})(window);
