/* Local project library. Metadata and content-addressed original bytes share one atomic IDB transaction.
 * Projects never replace other projects; the legacy single draft is migrated without deleting its images. */
(function (G) {
  'use strict';
  const App = G.BApp, L = G.L || (zh => zh), STORE = 'drafts';
  let dbPromise, queue = Promise.resolve();
  const sources = new WeakMap(), range = () => IDBKeyRange.bound('project:', 'project:\uffff');
  const clone = x => JSON.parse(JSON.stringify(x));
  const id = () => 'project_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), 3000);
      let rq; try { rq = indexedDB.open('blotfigure', 1); } catch(e) { clearTimeout(timer); reject(e); return; }
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => { clearTimeout(timer); rq.result.onversionchange = () => { rq.result.close(); dbPromise = null; }; resolve(rq.result); };
      rq.onerror = rq.onblocked = () => { clearTimeout(timer); reject(rq.error || new Error('IndexedDB blocked')); };
    });
    dbPromise.catch(() => { dbPromise = null; }); return dbPromise;
  }
  async function transaction(mode, fn) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode); let rq;
      try { rq = fn(tx.objectStore(STORE)); } catch(e) { tx.abort(); reject(e); return; }
      tx.oncomplete = () => resolve(rq?.result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
    });
  }
  const enqueue = fn => { const next = queue.catch(() => {}).then(fn); queue = next; return next; };
  const legacyId = m => m.projectId || 'legacy_' + m.savedAt;
  function migrate(st) {
    const rq = st.get('meta'); rq.onsuccess = () => { const m = rq.result; if (m && !m.projectId) st.put({ ...m, projectId: legacyId(m), projectName: m.summary?.names?.join(', ') || m.images?.[0]?.name || 'Untitled' }, 'project:' + legacyId(m)); };
  }
  function storage(status, error, projectId) {
    if (projectId && projectId !== App.projectId) return;
    App.cacheStatus = status; App.cacheError = error?.message || ''; App.emit('storage');
  }
  function bytes(rec) {
    if (!sources.has(rec)) sources.set(rec, Promise.resolve(rec.src?.buffer || rec.src.arrayBuffer()));
    return sources.get(rec);
  }
  App.saveDraftSoon = () => {
    if (App.noDraft) return;
    clearTimeout(App.draftTimer); storage('pending'); App.draftTimer = setTimeout(() => App.saveDraft(), 800);
  };
  App.saveDraft = async () => {
    clearTimeout(App.draftTimer);
    if (!App.S || App.noDraft) return true;
    App.projectId ||= id();
    // Capture before awaiting: a queued save must not accidentally save the next project's state or files.
    const recs = [...App.images.values()], state = JSON.stringify(App.S), projectId = App.projectId;
    const meta = { projectId, projectName: App.projectName || recs[0]?.name || L('未命名项目', 'Untitled project'),
      app: 'BlotFigure ' + App.VERSION, savedAt: Date.now(), S: state, initial: App.initial, viewBlot: App.viewBlot, ladders: clone(App.customLadders()),
      images: recs.map(r => ({id:r.id,name:r.name,kind:r.kind,exposure:r.exposure,sha256:r.sha256})),
      summary: {membranes:App.S.blots.length,images:recs.length,rows:App.S.rows.length,step:App.S.step,names:App.S.rows.filter(r=>r.name&&!r.hidden).map(r=>r.name).slice(0,6)} };
    storage('pending', null, projectId);
    try {
      await enqueue(async () => {
        const buffers = await Promise.all(recs.map(bytes));
        await transaction('readwrite', st => {
          migrate(st);
          recs.forEach((r,i) => { const key='img:'+r.sha256, rq=st.getKey(key); rq.onsuccess=()=>{if(rq.result===undefined)st.put(buffers[i],key);}; });
          st.put(meta, 'project:'+projectId); st.put(meta,'meta');
        });
      });
      if(projectId===App.projectId)App.cachedSnapshot=state;
      storage(App.S && projectId===App.projectId && JSON.stringify(App.S)!==state?'pending':'saved', null, projectId); return true;
    } catch(e) { storage('error', e, projectId); return false; }
  };
  App.peekDraft = async () => { try { await queue.catch(()=>{}); return await transaction('readonly',st=>st.get('meta')); } catch(e) { return null; } };
  App.listHistory = async () => {
    await queue.catch(()=>{});
    const list = await transaction('readonly',st=>st.getAll(range()));
    const old = await transaction('readonly',st=>st.get('meta'));
    if(old && !list.some(p=>p.projectId===legacyId(old)))list.push({...old,projectId:legacyId(old)});
    return list.sort((a,b)=>b.savedAt-a.savedAt).map(({S,initial,images,ladders,...summary})=>({...summary,bytes:0}));
  };
  App.restoreHistory = async projectId => {
    await queue.catch(()=>{});
    let meta = await transaction('readonly',st=>st.get('project:'+projectId));
    if(!meta) { const old=await App.peekDraft(); if(old&&legacyId(old)===projectId)meta={...old,projectId}; }
    if(!meta)throw new Error(L('找不到这个历史项目', 'Project not found in local history'));
    App.busy(true,L('打开历史项目…','Opening local project…'));
    try {
      const buffers=[];
      for(const im of meta.images) { const b=await transaction('readonly',st=>st.get('img:'+im.sha256));if(!b)throw new Error(L('缓存图片缺失，请打开保存的项目文件','A cached picture is missing; open the saved project file'));buffers.push(b); }
      await App.restoreSnapshot({...meta,S:JSON.parse(meta.S)},buffers,L('恢复项目','Restoring project'));
      App.cachedSnapshot=JSON.stringify(App.S); storage('saved');
    } finally {App.busy(false);}
  };
  App.restoreDraft = async () => {const m=await App.peekDraft();if(!m)throw new Error(L('没有可恢复的项目','No project to restore'));return App.restoreHistory(legacyId(m));};
  App.deleteHistory = projectId => enqueue(async()=>{ await transaction('readwrite',migrate); return transaction('readwrite',st=>{
    const all=st.getAll(range());all.onsuccess=()=>{
      const keep=all.result.filter(m=>m.projectId!==projectId), refs=new Set(keep.flatMap(m=>m.images.map(i=>'img:'+i.sha256)));
      st.delete('project:'+projectId);
      const current=st.get('meta');current.onsuccess=()=>{if(current.result&&legacyId(current.result)===projectId){const last=keep.sort((a,b)=>b.savedAt-a.savedAt)[0];if(last)st.put(last,'meta');else st.delete('meta');}};
      const cursor=st.openCursor(IDBKeyRange.bound('img:','img:\uffff'));cursor.onsuccess=()=>{const c=cursor.result;if(c){if(!refs.has(c.key))c.delete();c.continue();}};
    };
  }); });
  App.renameHistory = (projectId,name) => enqueue(()=>transaction('readwrite',st=>{
    const rq=st.get('project:'+projectId);rq.onsuccess=()=>{if(rq.result){const m={...rq.result,projectName:name.trim()||rq.result.projectName};st.put(m,'project:'+projectId);const latest=st.get('meta');latest.onsuccess=()=>{if(latest.result?.projectId===projectId)st.put(m,'meta');};}};
    if(App.projectId===projectId)App.projectName=name.trim()||App.projectName;
  }));
  App.dropDraft = async () => {clearTimeout(App.draftTimer);const m=await App.peekDraft();if(m)await App.deleteHistory(legacyId(m));};
  const PRESETS='blotfig.parameterPresets';
  App.presets=()=>{try{return JSON.parse(G.PrefStorage.getItem(PRESETS)||'[]');}catch(e){return[];}};
  App.savePreset=name=>{
    if(!App.S)return null;
    const preset={id:id(),name:name.trim()||L('我的预设','My preset'),style:clone(App.S.style),ladderId:App.S.blots.find(b=>b.ladderId)?.ladderId||null,ladders:clone(App.customLadders())};
    G.PrefStorage.setItem(PRESETS,JSON.stringify([...App.presets(),preset]));return preset;
  };
  App.applyPreset=p=>{if(!App.S)return;G.ProteinLadders.importDefinitions(p.ladders||[]);App.S.style={...App.defaultStyle(),...clone(p.style)};if(p.ladderId&&G.ProteinLadders.get(p.ladderId))App.S.blots.forEach(b=>App.setLadder(b,p.ladderId));App.commit();};
  App.deletePreset=id=>G.PrefStorage.setItem(PRESETS,JSON.stringify(App.presets().filter(p=>p.id!==id)));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&App.S)App.saveDraft();});
})(window);
