(function(G){
 'use strict';
 const App=G.BApp,FT=G.FigureText,N=G.WBNotes,L=G.L||(zh=>zh),f=v=>String(Math.round(v*100)/100),LEAD=1.18;
 function alongSpan(at,len,span){
  const want=at!=null&&at!==''&&Number.isFinite(+at)?Math.min(1,Math.max(0,+at)):0.5;
  const half=span>0?Math.min(0.5,len/span/2):0;
  return half>=0.5?0.5:half+want*(1-2*half);
 }
 function build(o){
  const {S,column,preview:P,forPPT,regions,rowBoxes,W,H,pt,measure,vertical,text,textLines,grow}=o,els=[],slices=[],hits=[],byId=new Map(rowBoxes.map(r=>[r.id,r]));
  let right=o.right,left=o.left,bottom=H,insetY=0;
  const notes=(S.notes||[]).filter(a=>a.row?byId.has(a.row):a.column===column.id);
  // Tall side labels may extend above their protein row. Reserve the actual condition-name
  // column too, so a vertical antibody label cannot collide with the condition table.
  if(notes.some(a=>a.kind==='label'&&a.pos==='left'))left=Math.max(left,...(S.conditions||[]).filter(c=>c.name).map(c=>S.style.labelGapPt*2+measure(FT.label(c),c.pt||pt,c.weight)));
  const wrap=(a,g)=>P?`<g data-edit="note" data-note="${a.id}" class="ed">${g}</g>`:g;
  for(const a of notes.filter(a=>a.kind==='label')){
   const row=byId.get(a.row),size=a.pt||pt,wt=FT.weightOf(a.weight),label=FT.label(a,'text');
   const m=FT.metrics(typeof label==='object'?label:{name:label},size,S.style.fontFamily,false,wt);
   const hasAngle=a.angle!=null&&a.angle!==''&&Number.isFinite(+a.angle);
   const ang=hasAngle?Math.max(-180,Math.min(180,+a.angle)):(a.pos!=='below'&&a.vertical?-90:0);
   const rad=ang*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad),tw=m.width,th=Math.max(size,m.ascent+m.descent),vh=Math.max(m.ascent,m.descent);
   const hw=tw/2*Math.abs(cs)+vh*Math.abs(sn),hh=tw/2*Math.abs(sn)+vh*Math.abs(cs);
   const hasAt=a.at!=null&&a.at!==''&&Number.isFinite(+a.at);
   let x,y,anchor='middle',box;
   if(a.pos==='below'){
    x=(hasAt?W*alongSpan(a.at,hw*2,W):W/2)+(a.dx||0);
    y=bottom+size*0.6+hh+(a.dy||0);
    box={x:x-hw,y:y-hh,w:hw*2,h:hh*2};
    bottom=Math.max(bottom,y+hh);
   }else{
    const isRight=a.pos==='right',extent=isRight?right:left,spanTop=row?row.y:0,spanH=row?row.h:H;
    if(hasAt||hasAngle){
     x=(isRight?W+extent+size*0.45+hw:-extent-size*0.45-hw)+(a.dx||0);
     y=(hasAt?spanTop+spanH*alongSpan(a.at,hh*2,spanH):spanTop+spanH/2)+(a.dy||0);
     box={x:x-hw,y:y-hh,w:hw*2,h:hh*2};
    }else{
     const vertical=!!a.vertical,ym=spanTop+spanH/2;
     x=(isRight?W+extent+size*.7:-extent-size*.7)+(a.dx||0);y=ym+(a.dy||0);
     box=vertical?{x:x-th/2,y:y-tw/2,w:th,h:tw}:{x:isRight?x:x-tw,y:y-th/2,w:tw,h:th};
     if(!vertical)anchor=isRight?'start':'end';
    }
    if(isRight)right=Math.max(right,box.x+box.w-W);else left=Math.max(left,-box.x);
   }
   let g=ang||hasAt||a.pos==='below'
    ?(Math.abs(ang)<0.01&&!hasAt&&a.pos==='below'
      ?text(label,x,y+(m.ascent-m.descent)/2,size,'middle',` fill="${FT.color(a.color)}"`,wt)
      :`<g transform="translate(${f(x)},${f(y)}) rotate(${f(ang)})">${text(label,0,size*.35,size,'middle',` fill="${FT.color(a.color)}"`,wt)}</g>`)
    :text(label,x,y+size*.35,size,anchor,` fill="${FT.color(a.color)}"`,wt);
   if(P)g=`<rect x="${f(box.x-2)}" y="${f(box.y-2)}" width="${f(Math.max(8,box.w+4))}" height="${f(Math.max(8,box.h+4))}" fill="transparent"/>`+g;
   els.push(wrap(a,g));
   if(ang||hasAt||a.pos==='below'){
    for(const [lx,ly] of [[-tw/2,-m.ascent],[tw/2,-m.ascent],[tw/2,m.descent],[-tw/2,m.descent]]){
     const gx=x+lx*cs-ly*sn,gy=y+lx*sn+ly*cs;grow(gx,gy,gx,gy);
    }
   }else grow(box.x,box.y,box.x+box.w,box.y+box.h);
   hits.push({id:a.id,kind:'label',...box,spanW:W,spanH:row?row.h:H,spanY:row?row.y:0});
  }
  const insetX=W+right+10;
  for(const a of notes.filter(a=>a.kind==='box')){
   const row=App.row(a.row),sg=row.segs.find(s=>App.boxId(s)===a.box),pc=App.pieceOf(row,sg),bounds=N.bounds(a,row,sg);if(!bounds)continue;
   const clipped=regions.filter(r=>r.row===a.row&&r.box===a.box).map(r=>{const u0=Math.max(bounds.u0,r.u0),u1=Math.min(bounds.u1,r.u1),v0=Math.max(bounds.v0,r.v0),v1=Math.min(bounds.v1,r.v1);if(u1<=u0||v1<=v0)return null;return{r,b:{u0,u1,v0,v1},x:r.x+(u0-r.u0)/(r.u1-r.u0)*r.w,y:r.y+(v0-r.v0)/(r.v1-r.v0)*r.h,w:(u1-u0)/(r.u1-r.u0)*r.w,h:(v1-v0)/(r.v1-r.v0)*r.h};}).filter(Boolean);
   if(!clipped.length)continue;const size=a.pt||pt,wt=FT.weightOf(a.weight),col=FT.color(a.color,S.style.invert?'#000':'#fff'),label=FT.label(a,'text'),zoom=[2,3,4].includes(+a.zoom)?+a.zoom:0;
   let g='';for(const [i,q]of clipped.entries()){
    g+=`<rect x="${f(q.x)}" y="${f(q.y)}" width="${f(q.w)}" height="${f(q.h)}" fill="none" stroke="${col}" stroke-width="${f(S.style.lineWidthPt)}"${a.dash!==false?' stroke-dasharray="2 1.5"':''}/>`;
    const inside=q.y-size*1.3<byId.get(a.row).y,ly=inside?q.y+size*1.05:q.y-size*.3,lx=inside?q.x+size*.3:q.x;
    if(P)g+=`<rect x="${f(q.x)}" y="${f(q.y)}" width="${f(q.w)}" height="${f(q.h)}" fill="none" stroke="transparent" stroke-width="${f(size*.9)}" pointer-events="stroke"/>`;
    if(i===0&&a.text)g+=text(label,lx,ly,size,'start',` fill="${col}"`,wt);
    if(P)g+=`<rect data-note-handle="${a.id}" x="${f(q.x+q.w-2)}" y="${f(q.y+q.h-2)}" width="4" height="4" fill="#fff" stroke="#2f6feb" stroke-width=".6"/>`;
    grow(q.x,a.text?Math.min(q.y,ly-size):q.y,Math.max(q.x+q.w,a.text?lx+measure(label,size,wt):q.x),Math.max(q.y+q.h,a.text?ly+size*.3:q.y));hits.push({id:a.id,kind:'box',region:q.r,...q});
   }els.push(wrap(a,g));
   if(zoom){let xx=insetX,maxH=0;const yy=Math.max(insetY,byId.get(a.row).y),caption=a.text?`${a.text} (×${zoom})`:`×${zoom}`;
    for(const [i,q]of clipped.entries()){const w=q.w*zoom,h=q.h*zoom,id=`note_${a.id}_${i}`,href=forPPT?'':N.raster(row,sg,q.b,Math.max(.35,App.segPitch(sg)/(60*zoom)));
     if(forPPT)slices.push({id,row,sg,pc,...q.b});els.push(`<rect x="${f(xx)}" y="${f(yy)}" width="${f(w)}" height="${f(h)}" fill="#fff"/>`);
     els.push(`<image ${forPPT?`data-pptx-image="${id}" `:''}x="${f(xx)}" y="${f(yy)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none" href="${href}" xlink:href="${href}"/>`);
     els.push(`<rect x="${f(xx)}" y="${f(yy)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${FT.color(a.color)}" stroke-width="${f(S.style.lineWidthPt)}"/>`);xx+=w+2;maxH=Math.max(maxH,h);
    }
    els.push(wrap(a,text(caption,insetX,yy+maxH+size*1.3,size,'start',` fill="${FT.color(a.color)}"`,wt)));grow(insetX,yy,Math.max(xx-2,insetX+measure(caption,size,wt)),yy+maxH+size*1.6);insetY=yy+maxH+size*2.3;
   }
  }
  for(const a of notes.filter(a=>a.kind==='text')){
   const rb=a.row?byId.get(a.row):null;
   if(a.row&&!rb)continue;
   const boxY=rb?rb.y:0,boxH=rb?rb.h:H;
   const x=(a.fx??0.5)*W,y=boxY+(a.fy??0.5)*boxH;
   const np=a.pt||pt,wt=FT.weightOf(a.weight),ang=Number.isFinite(+a.angle)?+a.angle:0,rad=ang*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad);
   const raw=String(a.text||''),display=raw||(P?L('点击输入','Click to type'):'');
   const lineStrings=display?display.split('\n'):[];
   const labelLines=raw?FT.lines(FT.label(a,'text'),raw.split('\n')):lineStrings;
   const v=vertical?vertical(lineStrings[0]||'Mg',np,wt):{ascent:np*0.85,descent:np*0.2};
   const lh=np*LEAD,tw=Math.max(0,...labelLines.map(t=>measure(t,np,wt)));
   const th=labelLines.length?v.ascent+v.descent+(labelLines.length-1)*lh:0;
   const pad=(a.bg&&a.bg!=='none')||a.border?np*0.35:0,bw=tw+pad*2,bh=th+pad*2;
   const align=a.align==='left'?'left':a.align==='right'?'right':'center',anchor=align==='center'?'middle':align==='left'?'start':'end';
   const tx=align==='center'?0:align==='left'?-bw/2+pad:bw/2-pad;
   const defaultCol=a.bg==='white'?'#000':(S.style.invert?'#000':'#fff');
   const col=FT.color(a.color,defaultCol),phCol='#aab3be',lw=Math.max(S.style.lineWidthPt,0.4);
   let g='';
   if(a.arrow){
    const aa=Number.isFinite(+a.arrowAngle)?+a.arrowAngle:-90,ar=aa*Math.PI/180,acs=Math.cos(ar),asn=Math.sin(ar);
    const len=Math.max(np*1.5,Math.abs(+a.arrowLen||0.18)*W);
    const hx=x+acs*len,hy=y+asn*len;
    const edgeX=Math.abs(acs)>1e-6&&bw?(bw/2)/Math.abs(acs):Infinity,edgeY=Math.abs(asn)>1e-6&&bh?(bh/2)/Math.abs(asn):Infinity;
    const td=Math.min(edgeX,edgeY,len),tailX=x+acs*td,tailY=y+asn*td;
    const hs=Math.max(1.4,np*0.42),bxk=hx-acs*hs*1.5,byk=hy-asn*hs*1.5;
    const w1x=bxk+asn*hs,w1y=byk-acs*hs,w2x=bxk-asn*hs,w2y=byk+acs*hs;
    const acol=FT.color(a.color,S.style.invert?'#000':'#fff');
    g+=`<line x1="${f(tailX)}" y1="${f(tailY)}" x2="${f(bxk)}" y2="${f(byk)}" stroke="${acol}" stroke-width="${f(lw)}"/>`+
       `<path d="M${f(hx)},${f(hy)} L${f(w1x)},${f(w1y)} L${f(w2x)},${f(w2y)} Z" fill="${acol}"/>`;
    grow(tailX,tailY,tailX,tailY);grow(hx,hy,hx,hy);
   }
   if(labelLines.length){
    const extra=raw?` fill="${col}"`:` fill="${phCol}"`;
    let inner='';
    if((a.bg&&a.bg!=='none')||a.border){
     inner+=`<rect x="${f(-bw/2)}" y="${f(-bh/2)}" width="${f(bw)}" height="${f(bh)}" rx="${f(np*0.15)}" fill="${a.bg==='white'?'#fff':'none'}"${a.border?` stroke="${col}" stroke-width="${f(lw)}"`:''}/>`;
    }
    if(P)inner+=`<rect x="${f(-Math.max(bw/2,8)-2)}" y="${f(-Math.max(bh/2,6)-2)}" width="${f(Math.max(bw,16)+4)}" height="${f(Math.max(bh,12)+4)}" fill="transparent"/>`;
    const baseY=-th/2+v.ascent+(labelLines.length-1)*lh;
    inner+=textLines?textLines(labelLines,tx,baseY,np,anchor,extra,lh,wt):text(labelLines[0],tx,baseY,np,anchor,extra,wt);
    g+=`<g transform="translate(${f(x)},${f(y)}) rotate(${f(ang)})">${inner}</g>`;
    for(const [lx,ly] of [[-bw/2,-bh/2],[bw/2,-bh/2],[bw/2,bh/2],[-bw/2,bh/2]]){
     const gx=x+lx*cs-ly*sn,gy=y+lx*sn+ly*cs;grow(gx,gy,gx,gy);
    }
   }else if(P){
    g+=`<rect x="${f(x-8)}" y="${f(y-8)}" width="16" height="16" fill="transparent"/>`;
   }
   if(g){els.push(wrap(a,g));hits.push({id:a.id,kind:'text',x:x-Math.max(bw/2,10),y:y-Math.max(bh/2,8),w:Math.max(bw,20),h:Math.max(bh,16),boxW:W,boxH,boxY});}
  }
  return {content:els.join(''),slices,hits};
 }
 G.WBNoteRender={build};
})(window);