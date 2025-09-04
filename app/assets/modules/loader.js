// Loading, run-mode, persistence, and boot sequence

function resolveInitialRunMode(){
  const qs = new URLSearchParams(location.search);
  const onlyParam = (qs.get('only') || '').toLowerCase();
  if (onlyParam==='rw' || onlyParam==='math' || onlyParam==='full') return onlyParam;
  try{
    const saved = (localStorage.getItem('dsat_landing_only') || '').toLowerCase();
    if (saved==='rw' || saved==='math' || saved==='full') return saved;
  }catch(_){ }
  return 'full';
}

function updateModeUIBadges(){
  const modeText = runModeLabel();
  const badge = document.getElementById('modeBadge'); if (badge) badge.textContent = `Mode: ${modeText}`;
  const crumb = document.getElementById('crumb');
  if (crumb){
    let chip = document.getElementById('modeChipTop');
    if (!chip){ chip = document.createElement('span'); chip.id = 'modeChipTop'; chip.style.marginLeft = '8px'; chip.style.fontSize = '12px'; chip.style.padding = '2px 8px'; chip.style.borderRadius = '999px'; chip.style.border = '1px solid #c7d2fe'; chip.style.background = '#eef2ff'; chip.style.color = '#334155'; chip.style.verticalAlign = 'middle'; crumb.appendChild(chip); }
    chip.textContent = modeText;
  }
}
window.updateModeUIBadges = updateModeUIBadges;

function storageKey(){
  const id = (SET?.metadata?.id || SET?.id || SET?.metadata?.title || 'default').toString();
  return `dsat_autosave:${id}:${getRunMode()}`;
}
function saveState(){ try{ const payload = { modIdx, qIdx, answers, timers: { [String(modIdx)]: timerSec }, mode:getRunMode() }; localStorage.setItem(storageKey(), JSON.stringify(payload)); }catch(_e){} }
function tryRestore(){ try{ const raw = localStorage.getItem(storageKey()); if(!raw) return null; return JSON.parse(raw); }catch(_e){ return null; } }
function clearState(){ try{ localStorage.removeItem(storageKey()); }catch(_e){} }
window.saveState = saveState; window.tryRestore = tryRestore; window.clearState = clearState;

function rememberLastSet(meta){ try{ localStorage.setItem(LAST_SET_KEY, JSON.stringify(meta)); }catch(_e){} }
function tryLoadLastSetMeta(){ try{ const raw = localStorage.getItem(LAST_SET_KEY); return raw ? JSON.parse(raw) : null; }catch(_e){ return null; } }

function applyRunModeFilter(){
  const only = getRunMode();
  SET.__runMode = only;
  if (!SET.__allModules) SET.__allModules = (SET.modules||[]).slice();
  if (only==='rw' || only==='math'){
    SET.modules = (SET.__allModules||SET.modules||[]).filter(m => (m.section||'').toLowerCase() === only);
  } else {
    SET.modules = (SET.__allModules||SET.modules||[]).slice();
  }
  if (!SET.modules.length) {
    const msg = (only==='rw') ? 'This set has no RW modules. Switch to Full mode?' : 'This set has no Math modules. Switch to Full mode?';
    if (confirm(msg)) { RUN_MODE = 'full'; SET.modules = (SET.__allModules||[]).slice(); SET.__runMode = 'full'; }
    else { alert('Returning to the landing page...'); location.href = './landing.html'; return false; }
  }
  return true;
}
window.applyRunModeFilter = applyRunModeFilter;

async function loadSet(path){
  try{ const res = await fetch(path, {cache:'no-store'}); SET = await res.json(); $('#loadError').style.display='none'; rememberLastSet({ type:'url', value:path }); }
  catch(e){ $('#loadError').textContent = `Failed to load: ${e.message}`; $('#loadError').style.display='block'; return; }
  applyRunModeFilter(); if (!SET.modules.length) return; afterSetLoaded();
}

function bootFromBlob(){
  const key = 'dsat_launch_blob'; const text = localStorage.getItem(key);
  if(!text){ $('#loadError').textContent = 'No pending set. Please start from the landing page.'; $('#loadError').style.display = 'block'; return; }
  try{ SET = JSON.parse(text); localStorage.removeItem(key); $('#loadError').style.display='none'; rememberLastSet({ type:'blob', value:text }); applyRunModeFilter(); if (!SET.modules.length) return; afterSetLoaded(); }
  catch(e){ $('#loadError').textContent = 'Failed to parse set from landing page: ' + e.message; $('#loadError').style.display='block'; }
}
window.bootFromBlob = bootFromBlob; window.loadSet = loadSet;

function startModule(idx){
  modIdx = idx; qIdx = 0; const m=SET.modules[modIdx]; const secTxt = sectionLabel(m.section);
  $('#crumb').textContent = `${SET.metadata?.title || 'DSAT Practice'} · ${secTxt} · Module ${m.module||1}`; updateModeUIBadges(); clearInterval(tickId);
  let minutes = (function(){ const md = SET.metadata?.durationMinutesPerModule; if(Array.isArray(md)) return md[modIdx] ?? 35; if(md && typeof md==='object'){ const key=(m.section||'').toLowerCase(); const arr=md[key]; const mi=(m.module? m.module-1 : 0); if(Array.isArray(arr)) return arr[mi] ?? 35; } return 35; })();
  if (SET.__isReviewSession && window.REVIEW_TIMER_PREF){ const pref = window.REVIEW_TIMER_PREF; if (pref.mode === 'infinite') minutes = null; else if (pref.mode === 'custom' && pref.minutes && pref.minutes > 0) minutes = pref.minutes; }
  if (minutes === null){ timerSec = null; $('#timer').textContent = '—'; tickId = setInterval(()=>{ const now=Date.now(); const last = window.__lastSaveTs || 0; if (now - last > 5000) { saveState(); window.__lastSaveTs = now; } }, 1000); }
  else { timerSec = minutes * 60; $('#timer').textContent = fmtTime(timerSec); tickId = setInterval(()=>{ timerSec = Math.max(0, timerSec - 1); $('#timer').textContent = fmtTime(timerSec); if (timerSec % 5 === 0) saveState(); if (timerSec === 0) { clearInterval(tickId); openSubmitConfirm(); } }, 1000); }
  $('#card').style.display='block'; $('#ribbon').style.display='flex'; bindPrevNext(); renderQuestion(); renderNavButton(); hideNavPopup(); $('#scoreBox').innerHTML=''; setTimeout(()=>{ if (typeof window.__openDirectionsFromStart === 'function') window.__openDirectionsFromStart(); }, 0);
}
window.startModule = startModule;

function gotoNextModule(){ const last = SET.modules.length - 1; if (modIdx < last){ startModule(modIdx + 1); } else { showFinalReport(); } }
window.gotoNextModule = gotoNextModule;

function afterSetLoaded(){
  flags.clear(); answers={}; $('#scoreBox').innerHTML='';
  const dirPanel = $('#dirPanel'); if (dirPanel) dirPanel.innerHTML = fmt(SET.metadata?.directions || '');
  buildQIndex(); RESTORE_CACHE = tryRestore();
  if(RESTORE_CACHE){
    answers = RESTORE_CACHE.answers || {}; const restoreMod = Math.min(RESTORE_CACHE.modIdx ?? 0, SET.modules.length-1); startModule(restoreMod);
    const savedSec = RESTORE_CACHE.timers?.[String(restoreMod)]; if(typeof savedSec === 'number' && !Number.isNaN(savedSec)){ timerSec = Math.max(0, savedSec|0); $('#timer').textContent = fmtTime(timerSec); }
    qIdx = Math.min(RESTORE_CACHE.qIdx ?? 0, totalQ(modIdx)-1); renderQuestion(); renderNavButton();
  } else { startModule(0); }
  document.getElementById('loaderRow')?.style && (document.getElementById('loaderRow').style.display='none');
}
window.afterSetLoaded = afterSetLoaded;

function maybeStartReviewFromQuery(){ const qs = new URLSearchParams(location.search); const mode = qs.get('review'); const value = qs.get('value'); if(!mode) return; setTimeout(()=>{ if(mode==='skill' && value){ startReviewSession({ mode:'skill', skill:value }); }else if(mode==='wrong'){ startReviewSession({ mode:'wrong' }); }else if(mode==='flagged'){ startReviewSession({ mode:'flagged' }); } }, 50); }
window.maybeStartReviewFromQuery = maybeStartReviewFromQuery;

window.addEventListener('DOMContentLoaded', ()=>{
  RUN_MODE = resolveInitialRunMode(); updateModeUIBadges(); migrateLocalAttemptsOnce(); bindRenderUI();
  const url = qp('set'); const src = qp('source');
  if (url){ $('#path').value = url; document.getElementById('loaderRow').style.display='none'; loadSet(url); }
  else if (src === 'blob'){ document.getElementById('loaderRow').style.display='none'; bootFromBlob(); }
  else { const last = tryLoadLastSetMeta(); if (last){ document.getElementById('loaderRow').style.display='none'; if (last.type === 'url' && last.value) loadSet(last.value); else if (last.type === 'blob' && last.value){ try{ SET = JSON.parse(last.value); applyRunModeFilter(); if (!SET.modules.length) return; afterSetLoaded(); }catch(_e){ document.getElementById('loaderRow').style.display=''; } } else { document.getElementById('loaderRow').style.display=''; } } }
  // buttons
  const loadBtn = document.getElementById('loadBtn'); if (loadBtn) loadBtn.onclick=()=>loadSet($('#path').value);
  const hideBtn = document.getElementById('hideBtn'); if (hideBtn) hideBtn.onclick=()=>{ const w=$('.wrap'); w.style.display = w.style.display==='none'?'block':'none'; };
  const file = document.getElementById('file'); if (file){ file.addEventListener('change', (e)=>{ const f = e.target.files && e.target.files[0]; if(f){ (async ()=>{ try{ const text = await f.text(); SET = JSON.parse(text); $('#loadError').style.display='none'; rememberLastSet({ type:'blob', value:text }); applyRunModeFilter(); if (!SET.modules.length) return; afterSetLoaded(); }catch(e){ $('#loadError').textContent = `Failed to load file: ${e.message}`; $('#loadError').style.display='block'; } })(); } }); }
  // query-based review
  maybeStartReviewFromQuery();
});

