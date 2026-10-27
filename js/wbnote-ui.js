/* Desktop annotations on the composed figure. Protein-box editing remains in wbview/wbui. */
(function(G){
 'use strict';const A=G.BApp,N=G.WBNotes,FT=G.FigureText,NT=G.NameText,L=G.L,$=id=>document.getElementById(id),prev=$('preview');
 const button=(id,zh,en)=>{const b=document.createElement('button');b.id=id;b.className='tool';b.dataset.en=en;b.textContent=L(zh,en);$('btnAddBracket').parentElement.append(b);return b;};
 const boxButton=button('btnNoteBox','区域注释框 / 放大','Region annotation / inset'),labelButton=button('btnSideText','侧边文字','Side text');
 const hint=document.createElement('p');hint.id='noteHint';hint.className='hint hidden';hint.textContent=L('在右侧成图的一条蛋白区域内拖出注释框；它不会修改蛋白裁切。Esc 取消。','Drag an annotation inside one protein region on the figure. It does not change the protein crop. Esc cancels.');boxButton.parentElement.after(hint);
 const pop=document.createElement('div');pop.id='notePopover';pop.className='popover note-popover hidden';document.body.append(pop);
 let tool=null,drag=null,selected=null,ignoreClick=false;
 const note=id=>(A.S?.notes||[]).find(n=>n.id===id),fig=()=>G.UI.lastFig(),cl=(v,a,b)=>Math.max(a,Math.min(b,v));
 const point=e=>{const svg=prev.querySelector('svg');return svg?new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()):null;};
 function mode(v){tool=v;boxButton.classList.toggle('on',v==='box');hint.classList.toggle('hidden',!v);prev.classList.toggle('note-draw',!!v);}
 function close(){pop.classList.add('hidden');}
 function place(x,y){pop.classList.remove('hidden');pop.style.left=cl(x,8,Math.max(8,innerWidth-pop.offsetWidth-8))+'px';pop.style.top=cl(y,8,Math.max(8,innerHeight-pop.offsetHeight-8))+'px';}
 function formats(input,obj,key){
  const bar=document.createElement('div');bar.className='note-format-buttons';bar.innerHTML=[['italic','斜体','Italic'],['normal','正体','Upright'],['sup','上标','Sup'],['sub','下标','Sub'],['red','标红','Red'],['clear','清除格式','Clear']].map(([k,zh,en])=>`<button type="button" data-note-format="${k}">${L(zh,en)}</button>`).join('');input.after(bar);
  let composing=false;input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
  bar.onmousedown=e=>e.preventDefault();bar.onclick=e=>{const b=e.target.closest('[data-note-format]');if(!b||composing)return;const start=input.selectionStart,end=input.selectionEnd,n={name:obj[key]||'',nameRuns:obj[key+'Runs']};NT.write(n,NT.format(NT.runs(n),start,end,b.dataset.noteFormat));obj[key]=n.name;if(n.nameRuns)obj[key+'Runs']=n.nameRuns;else delete obj[key+'Runs'];input.value=n.name;A.commit();input.focus();input.setSelectionRange(start,end);};
 }
 function open(id,x,y){const a=note(id);if(!a)return;selected=id;const isBox=a.kind==='box';
  pop.innerHTML=`<h4>${L(isBox?'区域注释框':'侧边文字',isBox?'Region annotation':'Side text')}</h4><div class="field"><label>${L('文字','Text')}</label><input id="noteText" type="text" value="${FT.esc(a.text||'')}" placeholder="${L(isBox?'如 a、Doublet':'如 IB: anti-HA、IP: Flag',isBox?'e.g. a, Doublet':'e.g. IB: anti-HA, IP: Flag')}"></div>${isBox?`<div class="field inline"><label><input id="noteDash" type="checkbox" ${a.dash!==false?'checked':''}>${L('虚线','Dashed')}</label><label>${L('放大','Enlarge')} <select id="noteZoom">${[0,2,3,4].map(n=>`<option value="${n}">${n?'×'+n:L('不放大','None')}</option>`).join('')}</select></label></div><p class="hint">${L('拖框移动，拖右下角缩放。放大图沿用该蛋白的曝光和亮度。','Drag to move; drag the lower-right handle to resize. Insets use the same exposure and levels as the protein.')}</p>`:`<div class="field inline"><label>${L('位置','Position')} <select id="notePos"><option value="left">${L('左侧','Left')}</option><option value="right">${L('右侧','Right')}</option><option value="below">${L('成图下方','Below figure')}</option></select></label><label><input id="noteVertical" type="checkbox" ${a.vertical?'checked':''}>${L('竖排','Vertical')}</label></div><p class="hint">${L('在成图上拖动文字可微调位置。','Drag the text on the figure to adjust its position.')}</p>`}<div class="field inline"><label>${L('字号','Size')} <input id="notePt" class="num" type="number" min="4" max="14" step=".5" value="${a.pt||''}" placeholder="${A.S.style.fontPt}"> pt</label><label>${L('颜色','Colour')} <select id="noteColor"><option value="">${L('默认','Default')}</option><option value="red">${L('红色','Red')}</option></select></label></div><div class="actions"><button class="btn sm danger" id="noteDelete">${L('删除','Delete')}</button><button class="btn sm primary" id="noteDone">${L('完成','Done')}</button></div>`;
  const q=id=>pop.querySelector('#'+id);q('noteColor').value=a.color||'';q('noteColor').onchange=e=>{a.color=e.target.value;A.commit();};q('notePt').oninput=e=>{if(e.target.value)a.pt=cl(+e.target.value||7,4,14);else delete a.pt;A.refresh();};q('notePt').onchange=()=>A.commit();q('noteText').oninput=e=>{FT.edit(a,'text',e.target.value);A.refresh();};q('noteText').onchange=()=>A.commit();formats(q('noteText'),a,'text');
  if(isBox){q('noteZoom').value=a.zoom||0;q('noteZoom').onchange=e=>{a.zoom=+e.target.value;A.commit();};q('noteDash').onchange=e=>{a.dash=e.target.checked;A.commit();};}
  else{q('notePos').value=a.pos;q('notePos').onchange=e=>{a.pos=e.target.value;a.dx=a.dy=0;A.commit();};q('noteVertical').onchange=e=>{a.vertical=e.target.checked;A.commit();};}
  q('noteDone').onclick=()=>{A.commit();close();};q('noteDelete').onclick=()=>remove();place(x,y);q('noteText').focus();q('noteText').select();
 }
 function remove(){if(!selected||!A.S)return;A.S.notes=N.list().filter(a=>a.id!==selected);selected=null;close();A.commit();}
 boxButton.onclick=async()=>{if(!A.S)return;await G.UI.flushPending();A.setMode(null);mode(tool?'': 'box');};
 labelButton.onclick=async()=>{if(!A.S)return;await G.UI.flushPending();const row=A.row(A.selRow);if(!A.rowsInColumn(A.activeColumn).some(r=>!r.hidden)){G.UI.toast(L('先添加蛋白框','Add a protein box first'));return;}const a=N.addLabel(row&&A.rowColumn(row)===A.activeColumn?row.id:null,A.activeColumn);a.text='IB: ';A.commit();open(a.id,innerWidth-340,180);};
 const rect=(r,p,q)=>{const x=cl(Math.min(p.x,q.x),r.x,r.x+r.w),y=cl(Math.min(p.y,q.y),r.y,r.y+r.h);return{x,y,w:Math.max(.2,cl(Math.max(p.x,q.x),r.x,r.x+r.w)-x),h:Math.max(.2,cl(Math.max(p.y,q.y),r.y,r.y+r.h)-y)};};
 document.addEventListener('mousedown',e=>{
  if(e.button!==0||!A.S||pop.contains(e.target))return;if(!prev.contains(e.target)){close();selected=null;return;}
  const p=point(e);if(!p)return;const end=e.target.closest('[data-bracket-end]'),ng=e.target.closest('[data-note]');
  if(end){const bk=A.S.brackets[+end.dataset.bracket];if(!bk)return;drag={kind:'bracket',bk,end:+end.dataset.bracketEnd,initial:JSON.stringify(bk),state:A.S,column:A.rowColumn(A.row(bk.r0)),p};}
  else if(tool==='box'){const r=(fig().sourceRegions||[]).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);if(!r)return;drag={kind:'draw',region:r,p,state:A.S};}
  else if(ng){const a=note(ng.dataset.note),hit=(fig().noteHits||[]).find(h=>h.id===a?.id);if(!a||!hit)return;selected=a.id;drag={kind:a.kind==='label'?'label':e.target.closest('[data-note-handle]')?'resize':'move',a,hit,p,initial:JSON.stringify(a),state:A.S};}
  else{selected=null;close();return;}
  close();e.preventDefault();e.stopImmediatePropagation();
 },true);
 window.addEventListener('mousemove',e=>{if(!drag||drag.state!==A.S)return;const p=point(e);if(!p)return;const d=drag,dx=p.x-d.p.x,dy=p.y-d.p.y;if(Math.abs(dx)+Math.abs(dy)>.4)d.moved=true;if(!d.moved)return;A.dragging=true;
  if(d.kind==='draw'){d.rect=rect(d.region,d.p,p);let g=prev.querySelector('#noteGhost');if(!g){g=document.createElementNS('http://www.w3.org/2000/svg','rect');g.id='noteGhost';g.setAttribute('fill','#3478ff15');g.setAttribute('stroke','#3478ff');g.setAttribute('stroke-width','.8');g.style.pointerEvents='none';prev.querySelector('svg').append(g);}Object.entries(d.rect).forEach(([k,v])=>g.setAttribute(k==='w'?'width':k==='h'?'height':k,v));}
  else if(d.kind==='bracket'){let best=null;for(const r of fig().rowBoxes.filter(r=>r.columnId===d.column)){const y=cl(p.y,r.y,r.y+r.h),distance=Math.abs(y-p.y);if(!best||distance<best.distance)best={r,frac:(y-r.y)/r.h,distance};}if(best){let v=best.frac;if(!e.altKey)v=v<.2?0:v>.8?1:v;d.bk['r'+d.end]=best.r.id;d.bk['f'+d.end]=v;}A.refresh();}
  else if(d.kind==='label'){const old=JSON.parse(d.initial);d.a.dx=(old.dx||0)+dx;d.a.dy=(old.dy||0)+dy;A.refresh();}
  else{const h=d.hit,r=h.region;let b;if(d.kind==='resize')b=rect(r,{x:h.x,y:h.y},{x:h.x+h.w+dx,y:h.y+h.h+dy});else{const x=cl(h.x+dx,r.x,r.x+r.w-h.w),y=cl(h.y+dy,r.y,r.y+r.h-h.h);b={x,y,w:h.w,h:h.h};}N.setRect(d.a,r,b);A.refresh();}
 },true);
 window.addEventListener('mouseup',e=>{if(!drag)return;const d=drag;drag=null;A.dragging=false;prev.querySelector('#noteGhost')?.remove();if(d.state!==A.S)return;ignoreClick=true;setTimeout(()=>ignoreClick=false,0);
  if(d.kind==='draw'){mode(null);if(d.moved&&d.rect.w>1&&d.rect.h>1){const a=N.addBox(d.region,d.rect);A.commit();open(a.id,e.clientX,e.clientY);}}
  else if(d.moved)A.commit();else if(d.a)open(d.a.id,e.clientX,e.clientY);
  e.preventDefault();e.stopImmediatePropagation();
 },true);
 prev.addEventListener('click',e=>{if(ignoreClick||e.target.closest('[data-note],[data-bracket-end]')){e.preventDefault();e.stopImmediatePropagation();}},true);
 function cancel(){if(drag&&drag.state===A.S&&drag.initial){const target=drag.a||drag.bk;Object.keys(target).forEach(k=>delete target[k]);Object.assign(target,JSON.parse(drag.initial));}drag=null;A.dragging=false;prev.querySelector('#noteGhost')?.remove();mode(null);A.refresh();}
 document.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'&&(drag||tool||!pop.classList.contains('hidden'))){cancel();close();e.stopImmediatePropagation();e.preventDefault();}else if(['Backspace','Delete'].includes(e.key)&&selected&&!e.target.closest('input,textarea,select,[contenteditable=true]')){remove();e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('blur',()=>{if(drag)cancel();});window.addEventListener('resize',()=>{if(!pop.classList.contains('hidden'))place(pop.offsetLeft,pop.offsetTop);});
 const swap=A.onSwap;A.onSwap=()=>{drag=null;selected=null;mode(null);close();swap?.();};
 G.I18N.onChange(()=>{close();boxButton.textContent=L('区域注释框 / 放大','Region annotation / inset');labelButton.textContent=L('侧边文字','Side text');hint.textContent=L('在右侧成图的一条蛋白区域内拖出注释框；它不会修改蛋白裁切。Esc 取消。','Drag an annotation inside one protein region on the figure. It does not change the protein crop. Esc cancels.');});
 G.NoteUI={open,formats,cancel};
})(window);
