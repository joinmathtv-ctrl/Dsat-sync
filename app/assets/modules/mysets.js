// MYSETS-lite: cached owned sets (fetches /api/mySets)
(function(){
  if (window.MYSETS) return;
  const KEY='dsat_mysets_v1';
  let cache=null; const CACHE_MS=5*60*1000;
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'null'); }catch{ return null; } }
  function save(v){ try{ localStorage.setItem(KEY, JSON.stringify(v)); }catch{}
  }
  async function refresh(force=false){
    const now=Date.now();
    if(!force && cache && (now-(cache.ts||0) < CACHE_MS)) return cache.sets||[];
    const base = (window.DSAT_SYNC?.getConfig?.().baseUrl || window.SYNC_API_BASE || '').replace(/\/$/,'');
    let sets=[]; try{
      const r=await fetch(base+'/api/mySets'); const j=await r.json();
      sets = Array.isArray(j?.sets) ? j.sets : [];
    }catch(_){/* offline ok */}
    cache = { ts: Date.now(), sets }; save(cache); return sets;
  }
  function list(){ const loc=load(); return cache?.sets || loc?.sets || []; }
  function has(id){ return !!list().find(s=> s.id===id); }
  window.MYSETS = { refresh, list, has };
})();

