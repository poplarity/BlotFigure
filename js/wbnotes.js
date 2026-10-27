/* Annotation geometry is separate from protein crops. Anchors use image-group coordinates. */
(function(G){
 'use strict';const App=G.BApp,WB=G.WB,cache=new Map();
 const list=()=>App.S.notes||(App.S.notes=[]);
 const id=()=>`note_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
 function source(region,x,y){return[region.u0+(x-region.x)/region.w*(region.u1-region.u0),region.v0+(y-region.y)/region.h*(region.v1-region.v0)];}
 function setRect(a,region,rect){const row=App.row(region.row),sg=row.segs.find(s=>App.boxId(s)===region.box),F=App.segFrame(App.pieceOf(row,sg),sg);a.corners=[[rect.x,rect.y],[rect.x+rect.w,rect.y],[rect.x+rect.w,rect.y+rect.h],[rect.x,rect.y+rect.h]].map(([x,y])=>WB.toImg(F,...source(region,x,y)));}
 function addBox(region,rect){const a={id:id(),kind:'box',row:region.row,box:region.box,text:'',dash:true,zoom:0};setRect(a,region,rect);list().push(a);return a;}
 function addLabel(row,column){const a={id:id(),kind:'label',row:row||null,column:column||App.activeColumn,text:'',pos:'left',vertical:true};list().push(a);return a;}
 function bounds(a,row,sg){if(!Array.isArray(a.corners)||a.corners.length!==4)return null;const F=App.segFrame(App.pieceOf(row,sg),sg),points=a.corners.map(p=>WB.toFrame(F,...p));return{u0:Math.min(...points.map(p=>p[0])),u1:Math.max(...points.map(p=>p[0])),v0:Math.min(...points.map(p=>p[1])),v1:Math.max(...points.map(p=>p[1]))};}
 function raster(row,sg,bounds,step){const pc=App.pieceOf(row,sg),rec=App.images.get(row.img),F=App.segFrame(pc,sg),lv=App.rowLevels(row),key=JSON.stringify([row.img,F,lv,App.S.style.invert,bounds,step]);if(cache.has(key))return cache.get(key);
  const w=WB.sampleWindow({w:rec.img.w,h:rec.img.h,data:rec.cs.sig},F,bounds.u0,bounds.u1,bounds.v0,bounds.v1,step),cv=document.createElement('canvas');cv.width=w.w;cv.height=w.h;const ctx=cv.getContext('2d'),data=ctx.createImageData(w.w,w.h),map=App.rowMapper(row);
  for(let k=0;k<w.data.length;k++){const v=map(w.data[k]);data.data[k*4]=data.data[k*4+1]=data.data[k*4+2]=v;data.data[k*4+3]=255;}ctx.putImageData(data,0,0);const out=cv.toDataURL('image/png');if(cache.size>120)cache.clear();cache.set(key,out);return out;
 }
 function clean(){if(!App.S)return;App.S.notes=(App.S.notes||[]).filter(a=>a&&['box','label'].includes(a.kind)&&(a.row?!!App.row(a.row):App.layoutColumns().some(c=>c.id===a.column))&&(a.kind!=='box'||App.row(a.row).segs.some(s=>App.boxId(s)===a.box)&&Array.isArray(a.corners)&&a.corners.length===4&&a.corners.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))));
  for(const a of App.S.notes){if(typeof a.id!=='string'||!/^[\w-]+$/.test(a.id))a.id=id();a.text=String(a.text||'');a.dx=Number.isFinite(+a.dx)?+a.dx:0;a.dy=Number.isFinite(+a.dy)?+a.dy:0;a.zoom=[2,3,4].includes(+a.zoom)?+a.zoom:0;if(a.pt!=null)a.pt=Math.max(4,Math.min(14,+a.pt||7));if(a.kind==='label'&&!['left','right','below'].includes(a.pos))a.pos='left';}
 }
 function template(){const rows=App.S.rows.filter(r=>!r.hidden);return list().flatMap(a=>{const ri=rows.findIndex(r=>r.id===a.row);if(a.row&&ri<0)return[];const out={...JSON.parse(JSON.stringify(a)),rowIndex:ri};delete out.id;delete out.row;delete out.box;delete out.corners;
   if(a.kind==='box'){const row=rows[ri],si=row.segs.findIndex(s=>App.boxId(s)===a.box),sg=row.segs[si],b=bounds(a,row,sg),h=App.boxAbove(row,sg)+App.boxBelow(row,sg),top=sg.vc-App.boxAbove(row,sg);out.boxIndex=si;out.relative=[(b.u0-sg.x0)/(sg.x1-sg.x0),(b.v0-top)/h,(b.u1-b.u0)/(sg.x1-sg.x0),(b.v1-b.v0)/h];}return[out];});}
 function applyTemplate(items){if(!Array.isArray(items))return;const rows=App.S.rows.filter(r=>!r.hidden);App.S.notes=items.flatMap(item=>{const a={...JSON.parse(JSON.stringify(item)),id:id()},row=rows[a.rowIndex];delete a.rowIndex;
   if(item.rowIndex>=0){if(!row)return[];a.row=row.id;}else a.row=null;
   if(a.kind==='box'){const sg=row?.segs[a.boxIndex],b=a.relative;if(!sg||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite))return[];a.box=App.boxId(sg);const h=App.boxAbove(row,sg)+App.boxBelow(row,sg),top=sg.vc-App.boxAbove(row,sg),u0=sg.x0+b[0]*(sg.x1-sg.x0),v0=top+b[1]*h,u1=u0+b[2]*(sg.x1-sg.x0),v1=v0+b[3]*h,F=App.segFrame(App.pieceOf(row,sg),sg);a.corners=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(p=>WB.toImg(F,...p));delete a.relative;delete a.boxIndex;}return[a];});clean();}
 function insetPitches(){return list().flatMap(a=>{const row=App.row(a.row);if(a.kind!=='box'||!a.zoom||!row||row.hidden)return[];const sg=row.segs.find(s=>App.boxId(s)===a.box);if(!sg)return[];const b=bounds(a,row,sg);return App.rowParts(row).some(p=>p.sg===sg&&b.u0<p.u1&&b.u1>p.u0&&b.v0<p.vBot&&b.v1>p.vTop)?[App.segPitch(sg)/a.zoom]:[];});}
 G.WBNotes={list,source,setRect,addBox,addLabel,bounds,raster,clean,template,applyTemplate,insetPitches};
})(window);
