/* Desktop figure typography. Reuses the existing inline editors and does not create a second form. */
(function(G){
  'use strict';
  const App=G.BApp,FT=G.FigureText,NT=G.NameText,L=G.L,$=id=>document.getElementById(id),api=G.UI.textEditing;
  const toolbar=document.createElement('div');toolbar.id='figureToolbar';toolbar.className='figure-toolbar';
  toolbar.innerHTML=`<label><span data-en="Typeface">字体</span><select id="figureFont">${Object.keys(FT.fonts).map(f=>`<option>${f}</option>`).join('')}</select></label><label><span data-en="Lane angle">泳道名角度</span><select id="angleMode"><option value="auto" data-en="Auto">自动</option><option value="manual" data-en="Custom">自定义</option></select><input id="angleSlider" type="range" min="0" max="90" step="1" aria-label="Lane name angle"><input id="angleNumber" class="num" type="number" min="0" max="90" step="1" aria-label="Lane name angle">°</label>`;
  $('figCol').insertBefore(toolbar,$('previewBox'));
  const degree=$('angleNumber').nextSibling;if(degree?.nodeType===3)degree.textContent='';const angleUnit=document.createElement('span');angleUnit.textContent='°';$('angleNumber').after(angleUnit);
  for(const id of ['fontPt','lanePt','namePt']){const label=$(id).closest('label');if(label)toolbar.append(label);}
  const fontMenu=document.createElement('div');fontMenu.id='figureFontMenu';fontMenu.className='font-menu hidden';document.body.append(fontMenu);
  for(const id of ['figureFont','fontPt','lanePt','namePt'])fontMenu.append($(id).closest('label'));
  const italicLabel=document.createElement('label');italicLabel.innerHTML='<span data-en="Italic lane names">泳道名统一斜体</span><input type="checkbox" id="laneItalic">';fontMenu.append(italicLabel);
  $('laneItalic').onchange=e=>{if(App.S){App.S.style.laneItalic=e.target.checked;App.commit();}};
  const fontButton=document.createElement('button');fontButton.id='figureFontButton';fontButton.className='btn sm ghost';fontButton.dataset.en='Font / sizes ▾';fontButton.textContent=L('字体与字号 ▾','Font / sizes ▾');toolbar.prepend(fontButton);
  function placeFonts(){const r=fontButton.getBoundingClientRect();fontMenu.style.left=Math.max(6,Math.min(r.left,innerWidth-fontMenu.offsetWidth-6))+'px';fontMenu.style.top=Math.max(6,Math.min(r.bottom+5,innerHeight-fontMenu.offsetHeight-6))+'px';}
  fontButton.onclick=async()=>{await G.UI.flushPending();fontMenu.classList.toggle('hidden');if(!fontMenu.classList.contains('hidden'))placeFonts();};
  document.addEventListener('mousedown',e=>{if(!fontMenu.contains(e.target)&&!fontButton.contains(e.target))fontMenu.classList.add('hidden');});
  window.addEventListener('resize',()=>{if(!fontMenu.classList.contains('hidden'))placeFonts();});fontMenu.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing){fontMenu.classList.add('hidden');fontButton.focus();e.stopPropagation();}});
  // Keep the established control ID for state synchronisation and previous project values.
  const old=$('labelAngle'),hidden=document.createElement('input');hidden.type='hidden';hidden.id='labelAngle';old.replaceWith(hidden);
  const leftover=hidden.parentElement.querySelector('label[data-en="Lane name angle"]');if(leftover)leftover.remove();
  const layout=$('stLayout').closest('details');if(layout){const section=document.createElement('div');section.className='layout-settings';const summary=layout.querySelector('summary'),heading=document.createElement('h4');heading.innerHTML=summary.innerHTML;const title=heading.querySelector('[data-en]');if(title){title.dataset.en='Lines and spacing';title.textContent=L('线条与间距','Lines and spacing');}summary.replaceWith(heading);while(layout.firstChild)section.append(layout.firstChild);layout.replaceWith(section);}
  const oldHelp=$('markerPt').closest('.field').nextElementSibling;if(oldHelp?.classList.contains('hint')){oldHelp.dataset.en='Text settings are above the figure; Marker size is also available in step 4.';oldHelp.textContent=L('文字设置在成图上方；Marker 字号也可在第 4 步调整。',oldHelp.dataset.en);}
  function angle(v,commit){if(!App.S)return;App.S.style.labelAngle=FT.angle(v);hidden.value=App.S.style.labelAngle;commit?App.commit():App.refresh();sync();}
  $('figureFont').onchange=e=>{if(App.S){App.S.style.fontFamily=FT.fontName(e.target.value);App.commit();}};
  $('angleMode').onchange=e=>angle(e.target.value==='auto'?'auto':$('angleNumber').value||45,true);
  $('angleSlider').oninput=e=>angle(e.target.value,false);$('angleSlider').onchange=e=>angle(e.target.value,true);
  $('angleNumber').onchange=e=>angle(e.target.value,true);
  const controls=document.createElement('div');controls.className='text-formats';controls.innerHTML=`<div class="format-buttons">${[['normal','正体','Upright'],['italic','斜体','Italic'],['sup','上标','Superscript'],['sub','下标','Subscript'],['red','标红','Red'],['autoColor','默认色','Default colour'],['clear','清除格式','Clear format']].map(([v,zh,en])=>`<button type="button" data-format="${v}" data-en="${en}">${zh}</button>`).join('')}</div><label id="nameOverrideLabel"><input type="checkbox" id="nameOverride"><span data-en="Only this lane name">仅此泳道名设置</span></label><label id="nameOwnAngleLabel"><span data-en="Angle">角度</span><input id="nameOwnAngle" class="num" type="number" min="0" max="90" step="1">° <button type="button" id="resetOwnAngle" data-en="Auto">自动</button></label>`;
  $('fedBar').append(controls);
  $('fedBar').addEventListener('focusout',()=>setTimeout(()=>{if(state&&document.activeElement!==state.box&&!$('fedBar').contains(document.activeElement))api.close(false);},0));
  $('fedBar').addEventListener('keydown',e=>{if(state&&e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();api.close(true);}});
  let state=null;
  const fields=s=>[s.key,s.key+'Runs','nameStyle','color','nameColor'];
  const snapshot=s=>JSON.stringify({values:Object.fromEntries(fields(s).map(k=>[k,s.obj[k]])),lanePt:App.S.style.lanePt,namePt:App.S.style.namePt});
  function restore(s,json){const d=JSON.parse(json);for(const k of fields(s)){if(k in d.values)s.obj[k]=d.values[k];else delete s.obj[k];}App.S.style.lanePt=d.lanePt;App.S.style.namePt=d.namePt;s.box.value=s.obj[s.key]||'';}
  function record(){if(!state)return;const value=snapshot(state);if(value!==state.undo.at(-1)){state.undo.push(value);state.redo=[];}}
  function refresh(){App.refresh();api.refresh();syncOwn();}
  function syncOwn(){if(!state)return;const lane=state.edit.kind==='lane',own=state.obj.nameStyle;$('nameOverrideLabel').classList.toggle('hidden',!lane);$('nameOwnAngleLabel').classList.toggle('hidden',!lane||!own);$('nameOverride').checked=!!own;$('nameOwnAngle').value=own?.angle==='auto'?'':own?.angle??'';}
  function opened(edit,box){const obj=api.target(edit),key=edit.kind==='group'?'text':'name';state={edit,obj,key,box,original:null,undo:[],redo:[]};state.original=snapshot(state);
    const normalized={name:obj[key]||'',nameRuns:obj[key+'Runs']};NT.write(normalized,NT.runs(normalized));obj[key]=normalized.name;if(normalized.nameRuns)obj[key+'Runs']=normalized.nameRuns;else delete obj[key+'Runs'];box.value=obj[key];record();syncOwn();}
  function closed(revert){if(!state)return;if(revert)restore(state,state.original);state=null;}
  controls.addEventListener('click',e=>{const b=e.target.closest('[data-format]');if(!b||!state||state.composing)return;
    const s=state,a=s.box.selectionStart,z=s.box.selectionEnd,n={name:s.obj[s.key]||'',nameRuns:s.obj[s.key+'Runs']};
    NT.write(n,NT.format(NT.runs(n),a,z,b.dataset.format));s.obj[s.key]=n.name;if(n.nameRuns)s.obj[s.key+'Runs']=n.nameRuns;else delete s.obj[s.key+'Runs'];
    if((a===z||a===0&&z===n.name.length)&&['group','condname'].includes(s.edit.kind)&&['red','autoColor'].includes(b.dataset.format)){if(b.dataset.format==='red')s.obj.color='red';else delete s.obj.color;}
    record();refresh();s.box.focus();s.box.setSelectionRange(a,z);
  });
  $('nameOverride').onchange=e=>{if(!state)return;if(e.target.checked)state.obj.nameStyle={pt:App.S.style.lanePt||App.S.style.fontPt,angle:FT.angle(App.S.style.labelAngle)};else delete state.obj.nameStyle;record();refresh();};
  $('nameOwnAngle').onchange=e=>{if(state?.obj.nameStyle){state.obj.nameStyle.angle=FT.angle(e.target.value);record();refresh();}};
  $('resetOwnAngle').onclick=()=>{if(state?.obj.nameStyle){state.obj.nameStyle.angle='auto';record();refresh();}};
  for(const box of [$('floatEd'),$('floatTa')].filter(Boolean)){
    box.addEventListener('compositionstart',()=>{if(state)state.composing=true;});box.addEventListener('compositionend',()=>{if(state){state.composing=false;record();}});
    box.addEventListener('input',()=>{if(state&&!state.composing)record();});
    box.addEventListener('keydown',e=>{if(!state||e.isComposing||state.composing||!(e.ctrlKey||e.metaKey)||!['z','y'].includes(e.key.toLowerCase()))return;
      e.preventDefault();e.stopImmediatePropagation();record();const redo=e.shiftKey||e.key.toLowerCase()==='y';
      if(redo&&state.redo.length){const next=state.redo.pop();state.undo.push(next);restore(state,next);}else if(!redo&&state.undo.length>1){state.redo.push(state.undo.pop());restore(state,state.undo.at(-1));}refresh();
    },true);
  }
  function sync(){if(state&&api.current!==state.edit)state=null;const S=App.S;toolbar.querySelectorAll('input,select,button').forEach(e=>e.disabled=!S);if(!S)return;$('figureFont').value=FT.fontName(S.style.fontFamily);const a=FT.angle(S.style.labelAngle),auto=a==='auto';$('angleMode').value=auto?'auto':'manual';$('angleSlider').disabled=auto;$('angleNumber').disabled=auto;$('angleSlider').classList.toggle('hidden',auto);$('angleNumber').classList.toggle('hidden',auto);$('angleSlider').value=auto?45:a;$('angleNumber').value=auto?45:a;}
  App.on(()=>{sync();$('laneItalic').checked=!!App.S?.style.laneItalic;angleUnit.classList.toggle('hidden',!App.S||FT.angle(App.S.style.labelAngle)==='auto');});G.I18N?.apply(toolbar);G.I18N?.apply(fontMenu);G.I18N?.apply(controls);G.I18N?.onChange(()=>{sync();});G.Formatting={opened,closed,sync};sync();angleUnit.classList.add('hidden');
})(window);
