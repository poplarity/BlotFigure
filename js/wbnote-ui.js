/* Desktop annotations on the composed figure. Protein-box editing remains in wbview/wbui. */
(function(G){
 'use strict';const A=G.BApp,N=G.WBNotes,FT=G.FigureText,NT=G.NameText,L=G.L,$=id=>document.getElementById(id),prev=$('preview');
 const button=(id,zh,en)=>{const b=document.createElement('button');b.id=id;b.className='tool';b.dataset.en=en;b.textContent=L(zh,en);$('btnAddBracket').parentElement.append(b);return b;};
 const boxButton=button('btnNoteBox','区域注释框 / 放大','Region annotation / inset'),textButton=button('btnNoteText','自由文本框','Free text box'),labelButton=button('btnSideText','侧边文字','Side text');
 const hint=document.createElement('p');hint.id='noteHint';hint.className='hint hidden';boxButton.parentElement.after(hint);
 const pop=document.createElement('div');pop.id='notePopover';pop.className='popover note-popover hidden';document.body.append(pop);
 let tool=null,drag=null,selected=null,ignoreClick=false;
 const note=id=>(A.S?.notes||[]).find(n=>n.id===id),fig=()=>G.UI.lastFig(),cl=(v,a,b)=>Math.max(a,Math.min(b,v));
 const point=e=>{const svg=prev.querySelector('svg');return svg?new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()):null;};
 function hintText(){return tool==='text'?L('在右侧成图上点击要放文字的位置，再输入内容。Esc 取消。','Click where the free text box should go on the figure, then type. Esc cancels.'):L('在右侧成图的一条蛋白区域内拖出注释框；它不会修改蛋白裁切。Esc 取消。','Drag an annotation inside one protein region on the figure. It does not change the protein crop. Esc cancels.');}
 function mode(v){tool=v;boxButton.classList.toggle('on',v==='box');textButton.classList.toggle('on',v==='text');hint.textContent=hintText();hint.classList.toggle('hidden',!v);prev.classList.toggle('note-draw',!!v);}
 function close(){pop.classList.add('hidden');}
 function place(x,y){pop.classList.remove('hidden');pop.style.left=cl(x,8,Math.max(8,innerWidth-pop.offsetWidth-8))+'px';pop.style.top=cl(y,8,Math.max(8,innerHeight-pop.offsetHeight-8))+'px';}
 function formats(input,obj,key){
  const bar=document.createElement('div');bar.className='note-format-buttons';bar.innerHTML=[['italic','斜体','Italic'],['normal','正体','Upright'],['sup','上标','Sup'],['sub','下标','Sub'],['red','标红','Red'],['clear','清除格式','Clear']].map(([k,zh,en])=>`<button type="button" data-note-format="${k}">${L(zh,en)}</button>`).join('');input.after(bar);
  let composing=false;input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
  bar.onmousedown=e=>e.preventDefault();bar.onclick=e=>{const b=e.target.closest('[data-note-format]');if(!b||composing)return;const start=input.selectionStart,end=input.selectionEnd,n={name:obj[key]||'',nameRuns:obj[key+'Runs']};NT.write(n,NT.format(NT.runs(n),start,end,b.dataset.noteFormat));obj[key]=n.name;if(n.nameRuns)obj[key+'Runs']=n.nameRuns;else delete obj[key+'Runs'];input.value=n.name;A.commit();input.focus();input.setSelectionRange(start,end);};
 }
 function columnPoint(p){
  const f=fig(),cols=f?.columnBoxes||[],col=cols.find(c=>p.x>=c.x0&&p.x<=c.x1)||cols.find(c=>c.id===A.activeColumn)||cols[0];
  const rbs=(f?.rowBoxes||[]).filter(r=>!col||r.columnId===col.id);
  const rb=rbs.find(r=>p.y>=r.y&&p.y<=r.y+r.h);
  const cid=col?.id||A.activeColumn||'main',w=Math.max(1,f?.figW||100),x0=col?0:0;
  const fx=cl((p.x-(col?col.x0:0))/Math.max(1,(col?col.x1-col.x0:w)),0,1);
  if(rb)return{row:rb.id,column:cid,fx,fy:cl((p.y-rb.y)/Math.max(1,rb.h),0,1)};
  const minY=rbs.length?Math.min(...rbs.map(r=>r.y)):0,maxY=rbs.length?Math.max(...rbs.map(r=>r.y+r.h)):Math.max(1,f?.h||40);
  return{row:null,column:cid,fx,fy:cl((p.y-minY)/Math.max(1,maxY-minY),0,1)};
 }
 function open(id,x,y){if(document.body.classList.contains('quant-mode'))return;const a=note(id);if(!a)return;selected=id;const isBox=a.kind==='box',isText=a.kind==='text';
  let body='';
  if(isBox){
   body=`<div class="field"><label>${L('文字','Text')}</label><input id="noteText" type="text" value="${FT.esc(a.text||'')}" placeholder="${L('如 a、Doublet','e.g. a, Doublet')}"></div>
    <div class="field inline"><label><input id="noteDash" type="checkbox" ${a.dash!==false?'checked':''}>${L('虚线','Dashed')}</label><label>${L('放大','Enlarge')} <select id="noteZoom">${[0,2,3,4].map(n=>`<option value="${n}">${n?'×'+n:L('不放大','None')}</option>`).join('')}</select></label></div>
    <p class="hint">${L('拖框移动，拖右下角缩放。放大图沿用该蛋白的曝光和亮度。','Drag to move; drag the lower-right handle to resize. Insets use the same exposure and levels as the protein.')}</p>`;
  }else if(isText){
   const ang=Number.isFinite(+a.angle)?Math.round(+a.angle):0,aa=Number.isFinite(+a.arrowAngle)?Math.round(+a.arrowAngle):-90,al=Math.round((+a.arrowLen||0.18)*100);
   body=`<div class="field"><label>${L('文字','Text')}</label><textarea id="noteText" rows="2" placeholder="${L('写在膜图上的文字，可换行；如 5% input、IgG HC','Text on the blot; line breaks allowed, e.g. 5% input, IgG HC')}">${FT.esc(a.text||'')}</textarea></div>
    <div class="field inline">
      <label class="inline-label">${L('旋转','Rotate')} <input id="noteAngle" class="num" type="number" min="-180" max="180" step="5" value="${ang}">°</label>
      <label class="inline-label">${L('对齐','Align')} <select id="noteAlign" style="width:auto"><option value="center"${(a.align||'center')==='center'?' selected':''}>${L('居中','Centre')}</option><option value="left"${a.align==='left'?' selected':''}>${L('左','Left')}</option><option value="right"${a.align==='right'?' selected':''}>${L('右','Right')}</option></select></label>
      <label class="inline-label">${L('背景','Background')} <select id="noteBg" style="width:auto"><option value="none"${(a.bg||'none')==='none'?' selected':''}>${L('透明','Transparent')}</option><option value="white"${a.bg==='white'?' selected':''}>${L('白底','White')}</option></select></label>
      <label class="switch"><input id="noteBorder" type="checkbox" ${a.border?'checked':''}><span>${L('边框','Border')}</span></label>
    </div>
    <div class="field inline">
      <label class="switch"><input id="noteArrow" type="checkbox" ${a.arrow?'checked':''}><span>${L('加指向箭头','Add arrow')}</span></label>
      <span id="noteArrowFields" class="${a.arrow?'':'hidden'}">
        <label class="inline-label">${L('箭头角度','Arrow angle')} <input id="noteArrowAngle" class="num" type="number" min="-180" max="180" step="5" value="${aa}">°</label>
        <label class="inline-label">${L('长度','Length')} <input id="noteArrowLen" type="range" min="4" max="70" step="1" value="${al}"><output id="noteArrowLenOut">${al}%</output></label>
      </span>
    </div>
    <p class="hint">${L('文本框可在成图上自由拖动；箭头角度 0° 向右、90° 向下。文字留空时只显示箭头。','Drag the text box freely on the figure; 0° points right, 90° down. Empty text shows only the arrow.')}</p>`;
  }else{
   const av=a.at!=null&&a.at!==''&&Number.isFinite(+a.at)?Math.max(0,Math.min(1,+a.at)):0.5,at=Math.round(av*100);
   const ang=a.angle!=null&&a.angle!==''&&Number.isFinite(+a.angle)?Math.round(+a.angle):(a.pos!=='below'&&a.vertical?-90:0);
   body=`<div class="field"><label>${L('文字','Text')}</label><input id="noteText" type="text" value="${FT.esc(a.text||'')}" placeholder="${L('如 IB: anti-HA、IP: Flag','e.g. IB: anti-HA, IP: Flag')}"></div>
    <div class="field inline"><label>${L('位置','Position')} <select id="notePos"><option value="left">${L('左侧','Left')}</option><option value="right">${L('右侧','Right')}</option><option value="below">${L('成图下方','Below figure')}</option></select></label><label class="inline-label">${L('旋转','Rotate')} <input id="noteAngle" class="num" type="number" min="-180" max="180" step="5" value="${ang}">°</label></div>
    <div class="field inline"><label class="inline-label">${a.pos==='below'?L('左右位置','Across figure'):L('沿边位置','Along edge')}</label><input id="noteAt" type="range" min="0" max="100" step="1" value="${at}"><output id="noteAtOut">${at}%</output></div>
    <p class="hint">${L('拖滑杆或直接在成图上拖动可调整沿边位置；角度可自由旋转。','Drag the slider or text on the figure to move along the edge; any angle is supported.')}</p>`;
  }
  pop.innerHTML=`<h4>${L(isBox?'区域注释框':isText?'自由文本框':'侧边文字',isBox?'Region annotation':isText?'Free text box':'Side text')}</h4>${body}<div class="field inline"><label>${L('字号','Size')} <input id="notePt" class="num" type="number" min="4" max="14" step=".5" value="${a.pt||''}" placeholder="${A.S.style.fontPt}"> pt</label>${FT.weightField('noteWeight',a.weight)}<label>${L('颜色','Colour')} <select id="noteColor"><option value="">${L('默认','Default')}</option><option value="red">${L('红色','Red')}</option></select></label></div><div class="actions"><button class="btn sm danger" id="noteDelete">${L('删除','Delete')}</button><button class="btn sm primary" id="noteDone">${L('完成','Done')}</button></div>`;
  const q=id=>pop.querySelector('#'+id);q('noteColor').value=a.color||'';q('noteColor').onchange=e=>{a.color=e.target.value;A.commit();};q('noteWeight').onchange=e=>{const w=+e.target.value;if(w===400)delete a.weight;else a.weight=w;A.commit();};q('notePt').oninput=e=>{if(e.target.value)a.pt=cl(+e.target.value||7,4,14);else delete a.pt;A.refresh();};q('notePt').onchange=()=>A.commit();q('noteText').oninput=e=>{FT.edit(a,'text',e.target.value);A.refresh();};q('noteText').onchange=()=>A.commit();formats(q('noteText'),a,'text');
  if(isBox){q('noteZoom').value=a.zoom||0;q('noteZoom').onchange=e=>{a.zoom=+e.target.value;A.commit();};q('noteDash').onchange=e=>{a.dash=e.target.checked;A.commit();};}
  else if(isText){
   q('noteAngle').oninput=e=>{if(e.target.value.trim()!==''&&Number.isFinite(+e.target.value)){a.angle=cl(Math.round(+e.target.value),-180,180);A.refresh();}};q('noteAngle').onchange=()=>A.commit();
   q('noteAlign').onchange=e=>{a.align=e.target.value;A.commit();};
   q('noteBg').onchange=e=>{a.bg=e.target.value;A.commit();};
   q('noteBorder').onchange=e=>{a.border=e.target.checked;A.commit();};
   q('noteArrow').onchange=e=>{a.arrow=e.target.checked;q('noteArrowFields').classList.toggle('hidden',!a.arrow);place(pop.offsetLeft,pop.offsetTop);A.commit();};
   q('noteArrowAngle').oninput=e=>{if(e.target.value.trim()!==''&&Number.isFinite(+e.target.value)){a.arrowAngle=cl(Math.round(+e.target.value),-180,180);A.refresh();}};q('noteArrowAngle').onchange=()=>A.commit();
   q('noteArrowLen').oninput=e=>{a.arrowLen=+e.target.value/100;q('noteArrowLenOut').textContent=e.target.value+'%';A.refresh();};q('noteArrowLen').onchange=()=>A.commit();
   q('noteText').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){A.commit();close();}});
  }else{
   q('notePos').value=a.pos;q('notePos').onchange=e=>{a.pos=e.target.value;a.dx=a.dy=0;delete a.at;delete a.angle;a.vertical=a.pos!=='below';A.commit();open(id,x,y);};
   q('noteAngle').oninput=e=>{if(e.target.value.trim()===''){delete a.angle;A.refresh();return;}if(Number.isFinite(+e.target.value)){a.angle=cl(Math.round(+e.target.value),-180,180);a.vertical=Math.abs(a.angle)>45;A.refresh();}};q('noteAngle').onchange=()=>A.commit();
   q('noteAt').oninput=e=>{a.at=+e.target.value/100;a.dx=a.dy=0;q('noteAtOut').textContent=e.target.value+'%';A.refresh();};q('noteAt').onchange=()=>A.commit();
  }
  q('noteDone').onclick=()=>{A.commit();close();};q('noteDelete').onclick=()=>remove();place(x,y);q('noteText').focus();q('noteText').select();
 }
 function remove(){if(!selected||!A.S)return;A.S.notes=N.list().filter(a=>a.id!==selected);selected=null;close();A.commit();}
 boxButton.onclick=async()=>{if(!A.S)return;await G.UI.flushPending();A.setMode(null);mode(tool==='box'?'':'box');};
 textButton.onclick=async()=>{if(!A.S)return;await G.UI.flushPending();A.setMode(null);mode(tool==='text'?'':'text');};
 labelButton.onclick=async()=>{if(!A.S)return;await G.UI.flushPending();const row=A.row(A.selRow);if(!A.rowsInColumn(A.activeColumn).some(r=>!r.hidden)){G.UI.toast(L('先添加蛋白框','Add a protein box first'));return;}const a=N.addLabel(row&&A.rowColumn(row)===A.activeColumn?row.id:null,A.activeColumn);a.text='IB: ';A.commit();open(a.id,innerWidth-340,180);};
 const rect=(r,p,q)=>{const x=cl(Math.min(p.x,q.x),r.x,r.x+r.w),y=cl(Math.min(p.y,q.y),r.y,r.y+r.h);return{x,y,w:Math.max(.2,cl(Math.max(p.x,q.x),r.x,r.x+r.w)-x),h:Math.max(.2,cl(Math.max(p.y,q.y),r.y,r.y+r.h)-y)};};
 document.addEventListener('mousedown',e=>{
  if(document.body.classList.contains('quant-mode'))return;
  if(e.button!==0||!A.S||pop.contains(e.target))return;if(!prev.contains(e.target)){close();selected=null;return;}
  const p=point(e);if(!p)return;const end=e.target.closest('[data-bracket-end]'),ng=e.target.closest('[data-note]');
  if(end){const bk=A.S.brackets[+end.dataset.bracket];if(!bk)return;drag={kind:'bracket',bk,end:+end.dataset.bracketEnd,initial:JSON.stringify(bk),state:A.S,column:A.rowColumn(A.row(bk.r0)),p};}
  else if(tool==='box'){const r=(fig().sourceRegions||[]).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);if(!r)return;drag={kind:'draw',region:r,p,state:A.S};}
  else if(tool==='text'){const cp=columnPoint(p);const a=N.addText(cp.row,cp.column,cp.fx,cp.fy);mode(null);A.commit();open(a.id,e.clientX,e.clientY);e.preventDefault();e.stopImmediatePropagation();return;}
  else if(ng){const a=note(ng.dataset.note),hit=(fig().noteHits||[]).find(h=>h.id===a?.id);if(!a||!hit)return;selected=a.id;drag={kind:a.kind==='label'?'label':a.kind==='text'?'text':e.target.closest('[data-note-handle]')?'resize':'move',a,hit,p,initial:JSON.stringify(a),state:A.S};}
  else{selected=null;close();return;}
  close();e.preventDefault();e.stopImmediatePropagation();
 },true);
 window.addEventListener('mousemove',e=>{if(!drag||drag.state!==A.S)return;const p=point(e);if(!p)return;const d=drag,dx=p.x-d.p.x,dy=p.y-d.p.y;if(Math.abs(dx)+Math.abs(dy)>.4)d.moved=true;if(!d.moved)return;A.dragging=true;
  if(d.kind==='draw'){d.rect=rect(d.region,d.p,p);let g=prev.querySelector('#noteGhost');if(!g){g=document.createElementNS('http://www.w3.org/2000/svg','rect');g.id='noteGhost';g.setAttribute('fill','#3478ff15');g.setAttribute('stroke','#3478ff');g.setAttribute('stroke-width','.8');g.style.pointerEvents='none';prev.querySelector('svg').append(g);}Object.entries(d.rect).forEach(([k,v])=>g.setAttribute(k==='w'?'width':k==='h'?'height':k,v));}
  else if(d.kind==='bracket'){let best=null;for(const r of fig().rowBoxes.filter(r=>r.columnId===d.column)){const y=cl(p.y,r.y,r.y+r.h),distance=Math.abs(y-p.y);if(!best||distance<best.distance)best={r,frac:(y-r.y)/r.h,distance};}if(best){let v=best.frac;if(!e.altKey)v=v<.2?0:v>.8?1:v;d.bk['r'+d.end]=best.r.id;d.bk['f'+d.end]=v;}A.refresh();}
  else if(d.kind==='label'){const old=JSON.parse(d.initial);if(d.a.pos==='below'){const span=Math.max(1,d.hit.spanW||100);d.a.at=cl((old.at??0.5)+dx/span,0,1);d.a.dx=0;d.a.dy=(old.dy||0)+dy;}else{const span=Math.max(1,d.hit.spanH||40);d.a.at=cl((old.at??0.5)+dy/span,0,1);d.a.dx=(old.dx||0)+dx;d.a.dy=0;}A.refresh();}
  else if(d.kind==='text'){const old=JSON.parse(d.initial),bw=Math.max(1,d.hit.boxW||fig().figW||100),bh=Math.max(1,d.hit.boxH||fig().h||40);d.a.fx=cl((old.fx??0.5)+dx/bw,0,1);d.a.fy=cl((old.fy??0.5)+dy/bh,0,1);A.refresh();}
  else{const h=d.hit,r=h.region;let b;if(d.kind==='resize')b=rect(r,{x:h.x,y:h.y},{x:h.x+h.w+dx,y:h.y+h.h+dy});else{const x=cl(h.x+dx,r.x,r.x+r.w-h.w),y=cl(h.y+dy,r.y,r.y+r.h-h.h);b={x,y,w:h.w,h:h.h};}N.setRect(d.a,r,b);A.refresh();}
 },true);
 window.addEventListener('mouseup',e=>{if(!drag)return;const d=drag;drag=null;A.dragging=false;prev.querySelector('#noteGhost')?.remove();if(d.state!==A.S)return;ignoreClick=true;setTimeout(()=>ignoreClick=false,0);
  if(d.kind==='draw'){mode(null);if(d.moved&&d.rect.w>1&&d.rect.h>1){const a=N.addBox(d.region,d.rect);A.commit();open(a.id,e.clientX,e.clientY);}}
  else if(d.moved)A.commit();else if(d.a)open(d.a.id,e.clientX,e.clientY);
  e.preventDefault();e.stopImmediatePropagation();
 },true);
 prev.addEventListener('click',e=>{if(ignoreClick||e.target.closest('[data-note],[data-bracket-end]')){e.preventDefault();e.stopImmediatePropagation();}},true);
 function cancel(){if(drag&&drag.state===A.S&&drag.initial){const target=drag.a||drag.bk;Object.keys(target).forEach(k=>delete target[k]);Object.assign(target,JSON.parse(drag.initial));}drag=null;A.dragging=false;prev.querySelector('#noteGhost')?.remove();mode(null);A.refresh();}
 document.addEventListener('keydown',e=>{if(e.isComposing||document.body.classList.contains('quant-mode'))return;if(e.key==='Escape'&&(drag||tool||!pop.classList.contains('hidden'))){cancel();close();e.stopImmediatePropagation();e.preventDefault();}else if(['Backspace','Delete'].includes(e.key)&&selected&&!e.target.closest('input,textarea,select,[contenteditable=true]')){remove();e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('blur',()=>{if(drag)cancel();});window.addEventListener('resize',()=>{if(!pop.classList.contains('hidden'))place(pop.offsetLeft,pop.offsetTop);});
 const swap=A.onSwap;A.onSwap=()=>{drag=null;selected=null;mode(null);close();swap?.();};
 G.I18N.onChange(()=>{close();boxButton.textContent=L('区域注释框 / 放大','Region annotation / inset');textButton.textContent=L('自由文本框','Free text box');labelButton.textContent=L('侧边文字','Side text');hint.textContent=hintText();});
 G.NoteUI={open,formats,cancel,suspend:()=>{cancel();selected=null;close();}};
})(window);