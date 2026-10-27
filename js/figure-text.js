/* Shared, dependency-free publication typography. Formatting never touches image data. */
(function(G){
  'use strict';
  const NT=G.NameText,ctx=document.createElement('canvas').getContext('2d');
  const fonts=Object.freeze({Arial:'Arial, Helvetica, sans-serif','Times New Roman':"'Times New Roman', Times, serif",Helvetica:'Helvetica, Arial, sans-serif',Calibri:'Calibri, Arial, sans-serif',Cambria:"Cambria, 'Times New Roman', serif"});
  const fontName=v=>Object.hasOwn(fonts,v)?v:'Arial',fontStack=v=>fonts[fontName(v)];
  const color=(v,fallback='#000')=>v==='red'?'#d32f2f':fallback;
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const f=v=>String(Math.round(v*100)/100);
  const plain=t=>typeof t==='object'&&t?String(t.name||''):String(t??'');
  const label=(obj,key='name')=>obj&&Array.isArray(obj[key+'Runs'])?{name:String(obj[key]||''),nameRuns:obj[key+'Runs']}:String(obj?.[key]||'');
  function slice(t,a,b){if(typeof t!=='object')return plain(t).slice(a,b);return {name:plain(t).slice(a,b),nameRuns:NT.slice(NT.runs(t),a,b)};}
  function lines(t,strings){let pos=0;return strings.map(s=>{const start=plain(t).indexOf(s,pos);if(start<0)return s;pos=start+s.length;return slice(t,start,pos);});}
  function metrics(t,pt,family,italic=false){
    italic=!!(italic||t?.italicDefault);
    const source=typeof t==='object'?t:{name:plain(t)};let width=0,ascent=0,descent=0,left=0,right=0;
    const runs=NT.runs(source).map(r=>{const size=r.script?pt*.72:pt,shift=r.script==='sup'?-pt*.4:r.script==='sub'?pt*.22:0,it=r.italic??italic;
      ctx.font=`${it?'italic ':''}${size*4}px ${fontStack(family)}`;const m=ctx.measureText(r.text),w=m.width/4;
      left=Math.min(left,width-(m.actualBoundingBoxLeft||0)/4);right=Math.max(right,width+(m.actualBoundingBoxRight||m.width)/4);
      ascent=Math.max(ascent,(m.actualBoundingBoxAscent||size*3.4)/4-shift);descent=Math.max(descent,(m.actualBoundingBoxDescent||0)/4+shift);width+=w;
      return {...r,pt:size,shift,italic:it};});return{runs,width,ascent,descent,left,right:Math.max(right,width)};
  }
  function svg(m,x,y,pt,anchor,extra=''){
    let prev=0;return `<text data-lane-name="1" x="${f(x)}" y="${f(y)}" font-size="${f(pt)}" text-anchor="${anchor}"${extra}>`+m.runs.map(r=>{const dy=r.shift-prev;prev=r.shift;return `<tspan font-size="${f(r.pt)}" font-style="${r.italic?'italic':'normal'}"${r.color==='red'?` fill="${color(r.color)}"`:''} dy="${f(dy)}" data-name-baseline="${f(-r.shift)}">${esc(r.text)}</tspan>`;}).join('')+'</text>';
  }
  const angle=v=>v==null||v==='auto'||String(v).trim()===''||!Number.isFinite(+v)?'auto':String(Math.round(Math.max(0,Math.min(90,+v))));
  function edit(obj,key,value){const next={name:obj[key]||'',nameRuns:obj[key+'Runs']};NT.write(next,NT.edit(NT.runs(next),value));obj[key]=next.name;if(next.nameRuns)obj[key+'Runs']=next.nameRuns;else delete obj[key+'Runs'];}
  G.FigureText={fonts,fontName,fontStack,color,esc,plain,label,slice,lines,metrics,svg,angle,edit};
})(window);
