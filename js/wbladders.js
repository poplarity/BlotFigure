/* Prestained protein ladders (kDa, largest -> smallest) as visible on the membrane, with the same sizes and
 * reference bands as GelFigure's list (verified against manufacturer datasheets, 2026-10); unstained ladders
 * are left out (they do not show on a membrane). ref = the coloured / brighter indicator bands.
 * Sizes are the Tris-glycine (Laemmli) values unless the name says otherwise.
 * chemi: true = the ladder shows up in the chemiluminescence image (antibody-detected), not the marker photo.
 * vendor: groups the list.
 */
(function (G) {
  'use strict';
  const BR = [250, 150, 100, 75, 50, 37, 25, 20, 15, 10];
  const L = [
    // Bio-Rad (the ids kept from earlier versions first: equal size lists rank in this order)
    { id: 'br_pp', vendor: 'Bio-Rad', name: 'Bio-Rad Precision Plus Dual Color (1610374)', sizes: BR, ref: [75, 25] },
    { id: 'br_allblue', vendor: 'Bio-Rad', name: 'Bio-Rad Precision Plus All Blue (1610373)', sizes: BR, ref: [75, 50, 25] },
    { id: 'br_kaleido', vendor: 'Bio-Rad', name: 'Bio-Rad Precision Plus Kaleidoscope (1610375)', sizes: BR, ref: [150, 75, 37, 25, 10] },
    { id: 'br_ppx', vendor: 'Bio-Rad', name: 'Bio-Rad Precision Plus Dual Xtra (1610377)', sizes: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10, 5, 2], ref: [75, 25, 2] },
    // Thermo / Invitrogen
    { id: 'pr26616', vendor: 'Thermo / Invitrogen', name: 'Thermo PageRuler Prestained 10–180 kDa (26616)', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 25, 10] },
    { id: 'pr26619', vendor: 'Thermo / Invitrogen', name: 'Thermo PageRuler Plus Prestained 10–250 kDa (26619)', sizes: [250, 130, 100, 70, 55, 35, 25, 15, 10], ref: [70, 25, 10] },
    { id: 'sp26634', vendor: 'Thermo / Invitrogen', name: 'Thermo Spectra Multicolor Broad Range (26634)', sizes: [260, 140, 100, 70, 50, 40, 35, 25, 15, 10], ref: [260, 70, 50, 40, 10] },
    { id: 'sp26625', vendor: 'Thermo / Invitrogen', name: 'Thermo Spectra Multicolor High Range (26625)', sizes: [300, 250, 180, 130, 100, 70, 50, 40], ref: [300, 70, 50] },
    { id: 'sp26628', vendor: 'Thermo / Invitrogen', name: 'Thermo Spectra Multicolor Low Range (26628, Tricine)', sizes: [40, 25, 15, 10, 4.6, 1.7], ref: [40, 10] },
    { id: 'nx_lc5800', vendor: 'Thermo / Invitrogen', name: 'Invitrogen Novex Sharp Pre-stained (LC5800)', sizes: [260, 160, 110, 80, 60, 50, 40, 30, 20, 15, 10, 3.5], ref: [] },
    { id: 'sb_lc5925', vendor: 'Thermo / Invitrogen', name: 'Invitrogen SeeBlue Plus2 (LC5925, Tris-glycine)', sizes: [250, 148, 98, 64, 50, 36, 22, 16, 6, 4], ref: [] },
    { id: 'mmxp', vendor: 'Thermo / Invitrogen', name: 'Thermo MagicMark XP (LC5602, antibody-detected)', zh: 'Thermo MagicMark XP (LC5602，抗体显色)', sizes: [220, 120, 100, 80, 60, 50, 40, 30, 20], ref: [], chemi: true },
    // others
    { id: 'neb7719', vendor: 'NEB / Abcam / GenScript / Cytiva / LI-COR', name: 'NEB Color Prestained Broad Range (P7719)', sizes: [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10], ref: [72, 26] },
    { id: 'ab116028', vendor: 'NEB / Abcam / GenScript / Cytiva / LI-COR', name: 'Abcam Prestained Broad Range (ab116028, Tris-glycine)', sizes: [245, 180, 135, 100, 75, 63, 48, 35, 25, 20, 17, 11], ref: [75, 25] },
    { id: 'gs_m00624', vendor: 'NEB / Abcam / GenScript / Cytiva / LI-COR', name: 'GenScript Broad Multi Color (M00624)', sizes: [270, 175, 130, 95, 65, 50, 35, 30, 15, 10], ref: [270, 50, 30] },
    { id: 'rpn800e', vendor: 'NEB / Abcam / GenScript / Cytiva / LI-COR', name: 'Amersham ECL Rainbow Full-Range (RPN800E)', sizes: [225, 150, 102, 76, 52, 38, 31, 24, 17, 12], ref: [] },
    { id: 'rpn756e', vendor: 'NEB / Abcam / GenScript / Cytiva / LI-COR', name: 'Amersham ECL Rainbow High-Range (RPN756E)', sizes: [225, 76, 52, 38, 31, 24, 17, 12], ref: [] },
    { id: 'odyssey1', vendor: 'NEB / Abcam / GenScript / Cytiva / LI-COR', name: 'LI-COR Odyssey One-Color', sizes: BR, ref: [75, 50, 25] },
    // Chinese vendors
    { id: 'tgmp211', vendor: 'Chinese vendors', name: 'Tiangen Three-color Prestained (MP211)', zh: 'Tiangen 天根三色预染 (MP211)', sizes: [180, 130, 100, 72, 50, 40, 30, 25, 20, 15, 10], ref: [72, 25] },
    { id: 'vazmp102', vendor: 'Chinese vendors', name: 'Vazyme 180 kDa Prestained (MP102)', zh: 'Vazyme 诺唯赞 180 kDa Prestained (MP102)', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 10] },
    { id: 'ys_p180', vendor: 'Chinese vendors', name: 'Yeasen GoldBand Plus 3-color 10–180 kDa (26616ES)', zh: 'Yeasen 翌圣 GoldBand Plus 3-color 10–180 kDa (26616ES)', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 25, 10] },
    { id: 'ep_wj101', vendor: 'Chinese vendors', name: 'Epizyme 15–150 kDa (WJ101)', zh: 'Epizyme 雅酶 15–150 kDa (WJ101)', sizes: [150, 100, 70, 50, 40, 35, 25, 20, 15], ref: [70, 25] },
    { id: 'ep_wj102', vendor: 'Chinese vendors', name: 'Epizyme Two-color 10–250 kDa (WJ102)', zh: 'Epizyme 雅酶 Two-color 10–250 kDa (WJ102)', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
    { id: 'ep_wj103', vendor: 'Chinese vendors', name: 'Epizyme Three-color 10–250 kDa (WJ103)', zh: 'Epizyme 雅酶 Three-color 10–250 kDa (WJ103)', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
    { id: 'ep_wj106', vendor: 'Chinese vendors', name: 'Epizyme NIR 10–250 kDa (WJ106)', zh: 'Epizyme 雅酶 NIR 10–250 kDa (WJ106)', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] },
    { id: 'ep_wj107', vendor: 'Chinese vendors', name: 'Epizyme Three-color 10–180 kDa (WJ107)', zh: 'Epizyme 雅酶 Three-color 10–180 kDa (WJ107)', sizes: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10], ref: [70, 10] },
    { id: 'by_p0068', vendor: 'Chinese vendors', name: 'Beyotime Prestained 10–180 kDa (P0068/P0069)', zh: 'Beyotime 碧云天 Prestained 10–180 kDa (P0068/P0069)', sizes: [180, 130, 95, 72, 55, 43, 34, 26, 17, 10], ref: [72, 10] },
    { id: 'by_p0071', vendor: 'Chinese vendors', name: 'Beyotime BeyoColor 6.5–270 kDa (P0071/P0072)', zh: 'Beyotime 碧云天 BeyoColor 6.5–270 kDa (P0071/P0072)', sizes: [270, 175, 130, 95, 66, 52, 37, 30, 16, 6.5], ref: [270, 52, 30] },
    { id: 'by_p0075', vendor: 'Chinese vendors', name: 'Beyotime BeyoColor 10–170 kDa (P0075/P0076/P0077)', zh: 'Beyotime 碧云天 BeyoColor 10–170 kDa (P0075/P0076/P0077)', sizes: [170, 130, 100, 70, 55, 45, 35, 25, 15, 10], ref: [70, 15] },
    { id: 'by_p0776', vendor: 'Chinese vendors', name: 'Beyotime BeyoColor 10–250 kDa (P0776)', zh: 'Beyotime 碧云天 BeyoColor 10–250 kDa (P0776)', sizes: [250, 130, 100, 70, 50, 40, 30, 25, 20, 15, 10], ref: [70, 25] },
    { id: 'by_p0773', vendor: 'Chinese vendors', name: 'Beyotime BeyoColor 8–180 kDa (P0773)', zh: 'Beyotime 碧云天 BeyoColor 8–180 kDa (P0773)', sizes: [180, 130, 100, 70, 55, 43, 33, 25, 17, 8], ref: [70, 8] },
    { id: 'by_p0779', vendor: 'Chinese vendors', name: 'Beyotime BeyoColor 25–300 kDa (P0779)', zh: 'Beyotime 碧云天 BeyoColor 25–300 kDa (P0779)', sizes: [300, 250, 200, 160, 130, 100, 70, 45, 25], ref: [70, 25] },
    { id: 'by_p0771', vendor: 'Chinese vendors', name: 'Beyotime BeyoColor 2.7–40 kDa (P0771, Tricine)', zh: 'Beyotime 碧云天 BeyoColor 2.7–40 kDa (P0771, Tricine)', sizes: [40, 30, 25, 20, 15, 10, 6.5, 4.2, 2.7], ref: [40, 10] },
    { id: 'tr_dm111', vendor: 'Chinese vendors', name: 'TransGen Blue Plus II (DM111)', zh: 'TransGen 全式金 Blue Plus II (DM111)', sizes: [120, 100, 70, 50, 40, 30, 25, 14], ref: [120, 50, 14] },
    { id: 'tr_dm141', vendor: 'Chinese vendors', name: 'TransGen Blue Plus V (DM141)', zh: 'TransGen 全式金 Blue Plus V (DM141)', sizes: [190, 140, 95, 70, 55, 43, 33, 26, 20, 15, 10], ref: [70, 20] },
    { id: 'tr_dm151', vendor: 'Chinese vendors', name: 'TransGen Blue Plus VI (DM151)', zh: 'TransGen 全式金 Blue Plus VI (DM151)', sizes: [250, 130, 100, 72, 50, 40, 30, 25, 20, 15, 10], ref: [72, 25] },
    { id: 'sl_pr1910', vendor: 'Chinese vendors', name: 'Solarbio Rainbow 180 (PR1910)', zh: 'Solarbio 索莱宝 Rainbow 180 (PR1910)', sizes: [180, 135, 100, 75, 63, 48, 35, 25, 17, 11], ref: [75, 25] },
    { id: 'sl_pr1920', vendor: 'Chinese vendors', name: 'Solarbio Rainbow 245 (PR1920)', zh: 'Solarbio 索莱宝 Rainbow 245 (PR1920)', sizes: [245, 180, 135, 100, 75, 63, 48, 35, 25, 20, 17, 11], ref: [75, 25] },
    { id: 'sg_c610110', vendor: 'Chinese vendors', name: 'Sangon RealBand Marker II (C610110)', zh: 'Sangon 生工 RealBand Marker II (C610110)', sizes: [180, 130, 95, 72, 52, 41, 31, 25, 17, 10], ref: [72, 10] },
    { id: 'sg_c610210', vendor: 'Chinese vendors', name: 'Sangon RealBand Two-color 10–250 kDa (C610210)', zh: 'Sangon 生工 RealBand Two-color 10–250 kDa (C610210)', sizes: [250, 150, 100, 70, 50, 40, 35, 25, 20, 15, 10], ref: [70, 25] }
  ];
  const KEY = 'blotfig.customLadders';
  function loadCustom() { try { return JSON.parse(G.PrefStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function parseSizes(raw) {
    const tokens=String(raw).replace(/kda/ig,'').trim().split(/[\s,，;；、]+/).filter(Boolean);
    if(!tokens.length || tokens.some(t=>!/^\d+(?:\.\d+)?$/.test(t) || +t<=0 || +t>2000)) throw new Error((G.L|| (zh=>zh))('请输入 0–2000 之间的分子量数字，以空格、逗号或换行分隔。','Enter molecular weights between 0 and 2000, separated by spaces, commas or new lines.'));
    const sizes=[...new Set(tokens.map(Number))].sort((a,b)=>b-a);
    if(sizes.length>100)throw new Error((G.L|| (zh=>zh))('最多支持 100 条刻度','Up to 100 bands are supported'));
    return sizes;
  }
  function saveCustom(name, sizes, options={}) {
    sizes=parseSizes(sizes.join(' ')); name=String(name||'').trim() || (G.L|| (zh=>zh))('我的 Marker','My marker');
    const list=loadCustom(), old=list.find(l=>l.name===name && l.sizes.join(',')===sizes.join(',') && (l.ref||[]).join(',')===(options.ref||[]).join(',')), lad={id:options.id||old?.id||'c_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),name,sizes,ref:(options.ref||[]).filter(k=>sizes.includes(k)),custom:true,vendor:'Custom'};
    G.PrefStorage.setItem(KEY,JSON.stringify([...list.filter(l=>l.id!==lad.id),lad]));return lad;
  }
  function importDefinitions(definitions) {
    for(const l of definitions) { if(l?.custom && l.id && Array.isArray(l.sizes)) saveCustom(l.name,l.sizes,{id:l.id,ref:l.ref}); }
  }
  function parseImport(raw, filename='') {
    const txt=String(raw).trim();
    if(txt.startsWith('{')||txt.startsWith('[')) {
      const data=JSON.parse(txt), items=Array.isArray(data)?data:(data.ladders||[data]);
      return items.map(l=>({name:l.name||filename.replace(/\.[^.]+$/,''),sizes:parseSizes((l.sizes||[]).join(' ')),ref:l.ref||[]}));
    }
    const lines=txt.split(/\r?\n/), header=lines[0].split(/[,;\t]/), sizeCol=header.findIndex(x=>/^(kda|size|sizes|分子量)$/i.test(x.trim()));
    const numbers=sizeCol>=0 ? lines.slice(1).filter(x=>x.trim()).map(x=>x.split(/[,;\t]/)[sizeCol]||'').join(' ') : txt;
    return [{name:filename.replace(/\.[^.]+$/,''),sizes:parseSizes(numbers),ref:[]}];
  }
  const all = () => L.concat(loadCustom());
  const get = id => all().find(l => l.id === id);
  // the vendors in list order, each with its ladders (for grouped menus), in the interface language (custom
  // ladders saved by earlier versions say 自定义)
  const VENDOR_ZH = { 'Chinese vendors': '国内厂家', Custom: '自定义', '自定义': '自定义', Other: '其他' };
  const vendorLabel = v => { const L = G.L || (zh => zh), en = v === '自定义' ? 'Custom' : v; return VENDOR_ZH[v] ? L(VENDOR_ZH[v], en) : v; };
  const groups = () => { const out = []; all().forEach(l => { const v = vendorLabel(l.vendor || 'Other'); let g = out.find(x => x.vendor === v); if (!g) out.push(g = { vendor: v, ladders: [] }); g.ladders.push(l); }); return out; };
  // a ladder's name on screen: Chinese vendors' with their Chinese brand in the Chinese interface; figures,
  // legends and logs always use the English .name
  const label = l => (l ? ((G.L || (zh => zh))(l.zh || l.name, l.name)) : '');

  // common loading controls / reference proteins (apparent kDa) for name suggestions
  const REF_PROTEINS = [
    ['GAPDH', 37], ['β-actin', 42], ['α-tubulin', 50], ['β-tubulin', 55], ['Vinculin', 124], ['HSP90', 90],
    ['Lamin B1', 68], ['Histone H3', 15], ['Total ERK1/2', 43], ['β-catenin', 92], ['PCNA', 36], ['Cofilin', 19]
  ];
  function suggest(kda) {
    if (!kda) return [];
    return REF_PROTEINS.map(([n, k]) => ({ n, d: Math.abs(Math.log(kda / k)) })).filter(o => o.d < 0.16).sort((a, b) => a.d - b.d).slice(0, 3).map(o => o.n);
  }
  const LOADING_RE = /gapdh|actin|tubulin|vinculin|lamin|histone|h3\b|hsp90|pcna|cofilin|total protein|ponceau|内参/i;

  G.ProteinLadders = { all, get, groups, label, saveCustom, parseSizes, parseImport, importDefinitions, suggest, LOADING_RE };
})(window);
