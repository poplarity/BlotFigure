(function(G){
 'use strict';
 const App=G.BApp,FT=G.FigureText,N=G.WBNotes,f=v=>String(Math.round(v*100)/100);
 function build(o){
  const {S,column,preview:P,forPPT,regions,rowBoxes,W,H,pt,measure,text,grow}=o,els=[],slices=[],hits=[],byId=new Map(rowBoxes.map(r=>[r.id,r]));let right=o.right,left=o.left,bottom=H,insetY=0;
  const notes=(S.notes||[]).filter(a=>a.row?byId.has(a.row):a.column===column.id);
  // Tall side labels may extend above their protein row. Reserve the actual condition-name
  // column too, so a vertical antibody label cannot collide with the condition table.
  if(notes.some(a=>a.kind==='label'&&a.pos==='left'))left=Math.max(left,...(S.conditions||[]).filter(c=>c.name).map(c=>S.style.labelGapPt*2+measure(FT.label(c),c.pt||pt)));
  const wrap=(a,g)=>P?`<g data-edit="note" data-note="${a.id}" class="ed">${g}</g>`:g;
  for(const a of notes.filter(a=>a.kind==='label')){
   const row=byId.get(a.row),size=a.pt||pt,label=FT.label(a,'text'),m=FT.metrics(typeof label==='object'?label:{name:label},size,S.style.fontFamily),vertical=a.pos!=='below'&&a.vertical;
   const tw=m.width,th=Math.max(size,m.ascent+m.descent);let x,y,anchor='middle',box;
   if(a.pos==='below'){x=W/2+(a.dx||0);y=bottom+size*1.6+(a.dy||0);box={x:x-tw/2,y:y-m.ascent,w:tw,h:th};bottom=Math.max(bottom,y+th*.4);}
   else{const isRight=a.pos==='right',extent=isRight?right:left,ym=row?row.y+row.h/2:H/2;x=(isRight?W+extent+size*.7:-extent-size*.7)+(a.dx||0);y=ym+(a.dy||0);box=vertical?{x:x-th/2,y:y-tw/2,w:th,h:tw}:{x:isRight?x:x-tw,y:y-th/2,w:tw,h:th};if(!vertical)anchor=isRight?'start':'end';if(isRight)right=Math.max(right,box.x+box.w-W);else left=Math.max(left,-box.x);}
   let g=vertical?`<g transform="translate(${f(x)},${f(y)}) rotate(-90)">${text(label,0,size*.35,size,'middle',` fill="${FT.color(a.color)}"`)}</g>`:text(label,x,a.pos==='below'?y:y+size*.35,size,anchor,` fill="${FT.color(a.color)}"`);
   if(P)g=`<rect x="${f(box.x-2)}" y="${f(box.y-2)}" width="${f(Math.max(8,box.w+4))}" height="${f(Math.max(8,box.h+4))}" fill="transparent"/>`+g;
   els.push(wrap(a,g));grow(box.x,box.y,box.x+box.w,box.y+box.h);hits.push({id:a.id,kind:'label',...box});
  }
  const insetX=W+right+10;
  for(const a of notes.filter(a=>a.kind==='box')){
   const row=App.row(a.row),sg=row.segs.find(s=>App.boxId(s)===a.box),pc=App.pieceOf(row,sg),bounds=N.bounds(a,row,sg);if(!bounds)continue;
   const clipped=regions.filter(r=>r.row===a.row&&r.box===a.box).map(r=>{const u0=Math.max(bounds.u0,r.u0),u1=Math.min(bounds.u1,r.u1),v0=Math.max(bounds.v0,r.v0),v1=Math.min(bounds.v1,r.v1);if(u1<=u0||v1<=v0)return null;return{r,b:{u0,u1,v0,v1},x:r.x+(u0-r.u0)/(r.u1-r.u0)*r.w,y:r.y+(v0-r.v0)/(r.v1-r.v0)*r.h,w:(u1-u0)/(r.u1-r.u0)*r.w,h:(v1-v0)/(r.v1-r.v0)*r.h};}).filter(Boolean);
   if(!clipped.length)continue;const size=a.pt||pt,col=FT.color(a.color,S.style.invert?'#000':'#fff'),label=FT.label(a,'text'),zoom=[2,3,4].includes(+a.zoom)?+a.zoom:0;
   let g='';for(const [i,q]of clipped.entries()){
    g+=`<rect x="${f(q.x)}" y="${f(q.y)}" width="${f(q.w)}" height="${f(q.h)}" fill="none" stroke="${col}" stroke-width="${f(S.style.lineWidthPt)}"${a.dash!==false?' stroke-dasharray="2 1.5"':''}/>`;
    // GelFigure's edge-caption rule, applied to each independent WB row rather than the whole gel.
    const inside=q.y-size*1.3<byId.get(a.row).y,ly=inside?q.y+size*1.05:q.y-size*.3,lx=inside?q.x+size*.3:q.x;
    if(P)g+=`<rect x="${f(q.x)}" y="${f(q.y)}" width="${f(q.w)}" height="${f(q.h)}" fill="none" stroke="transparent" stroke-width="${f(size*.9)}" pointer-events="stroke"/>`;
    if(i===0&&a.text)g+=text(label,lx,ly,size,'start',` fill="${col}"`);
    if(P)g+=`<rect data-note-handle="${a.id}" x="${f(q.x+q.w-2)}" y="${f(q.y+q.h-2)}" width="4" height="4" fill="#fff" stroke="#2f6feb" stroke-width=".6"/>`;
    grow(q.x,a.text?Math.min(q.y,ly-size):q.y,Math.max(q.x+q.w,a.text?lx+measure(label,size):q.x),Math.max(q.y+q.h,a.text?ly+size*.3:q.y));hits.push({id:a.id,kind:'box',region:q.r,...q});
   }els.push(wrap(a,g));
   if(zoom){let xx=insetX,maxH=0;const yy=Math.max(insetY,byId.get(a.row).y),caption=a.text?`${a.text} (×${zoom})`:`×${zoom}`;
    for(const [i,q]of clipped.entries()){const w=q.w*zoom,h=q.h*zoom,id=`note_${a.id}_${i}`,href=forPPT?'':N.raster(row,sg,q.b,Math.max(.35,App.segPitch(sg)/(60*zoom)));
     if(forPPT)slices.push({id,row,sg,pc,...q.b});els.push(`<rect x="${f(xx)}" y="${f(yy)}" width="${f(w)}" height="${f(h)}" fill="#fff"/>`);
     els.push(`<image ${forPPT?`data-pptx-image="${id}" `:''}x="${f(xx)}" y="${f(yy)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none" href="${href}" xlink:href="${href}"/>`);
     els.push(`<rect x="${f(xx)}" y="${f(yy)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="${FT.color(a.color)}" stroke-width="${f(S.style.lineWidthPt)}"/>`);xx+=w+2;maxH=Math.max(maxH,h);
    }
    els.push(wrap(a,text(caption,insetX,yy+maxH+size*1.3,size,'start',` fill="${FT.color(a.color)}"`)));grow(insetX,yy,Math.max(xx-2,insetX+measure(caption,size)),yy+maxH+size*1.6);insetY=yy+maxH+size*2.3;
   }
  }
  return {content:els.join(''),slices,hits};
 }
 G.WBNoteRender={build};
})(window);
