/* ===== 저장/공통 ===== */
const ATTEMPT_KEY='dsat_attempts_v1';
function loadAttempts(){ try{ return JSON.parse(localStorage.getItem(ATTEMPT_KEY)||'[]'); }catch(_e){ return []; } }
function saveAttempts(a){ try{ localStorage.setItem(ATTEMPT_KEY, JSON.stringify(a)); }catch(_e){} }

/* 세트별 기본 프리셋(보기용) 로컬 저장 */
const PRESET_DEFAULT_KEY = 'dsat_preset_defaults';
function loadPresetDefaults(){ try{ return JSON.parse(localStorage.getItem(PRESET_DEFAULT_KEY)||'{}'); }catch(_e){ return {}; } }
function savePresetDefaults(obj){ try{ localStorage.setItem(PRESET_DEFAULT_KEY, JSON.stringify(obj)); }catch(_e){} }

/* ===== Filter Persistence (1-B) ===== */
const FILTER_KEY = 'dsat_dashboard_filters_v1';
let FILTERS_READY = false;

function loadFilters() {
  try { return JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'); } catch { return {}; }
}
function saveFilters(filters) {
  if (!FILTERS_READY) return;
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch {}
}
function snapshotFiltersFromUI() {
  const from = document.getElementById('fromDate').value || '';
  const to   = document.getElementById('toDate').value || '';
  // PATCH: mode 선택값도 함께 저장(있을 때만)
  const modeSel = document.getElementById('modeSelect');
  const mode = modeSel ? (modeSel.value || 'all') : (window.DASH_MODE || 'all');
  return {
    baseId: document.getElementById('baseSelect').value || '',
    kind:   document.getElementById('kindSelect').value || '',
    preset: document.getElementById('presetSelect').value || '',
    mode,
    from, to
  };
}
function applySavedFiltersToUI() {
  const f = loadFilters();
  const byId = (id)=>document.getElementById(id);

  if (f.baseId && byId('baseSelect').querySelector(`option[value="${CSS.escape(f.baseId)}"]`)) {
    byId('baseSelect').value = f.baseId;
  }
  if (f.kind && byId('kindSelect').querySelector(`option[value="${CSS.escape(f.kind)}"]`)) {
    byId('kindSelect').value = f.kind;
  }
  if (f.preset && byId('presetSelect').querySelector(`option[value="${CSS.escape(f.preset)}"]`)) {
    byId('presetSelect').value = f.preset;
  }
  if (f.from) byId('fromDate').value = f.from;
  if (f.to)   byId('toDate').value   = f.to;

  // PATCH: 저장된 모드 복원(있다면)
  const modeSel = byId('modeSelect');
  if (modeSel && f.mode) modeSel.value = f.mode;
  if (f.mode) setDashMode(f.mode); // 버튼 세그먼트와 동기
}

/* ===== Chart.js 공통 옵션 ===== */
const chartCommonOptions = {
  responsive: true,
  interaction: { mode: 'nearest', intersect: false },
  plugins: {
    tooltip: {
      callbacks: {
        title: (items) => {
          const it = items[0];
          const att = it.raw && it.raw.__att;
          if (!att) return it.label || 'Attempt';
          const d = new Date(att.ts ?? att.date ?? 0);
          const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          return `Set ${att.title || att.baseId || '-'} · ${ds}`;
        },
        label: (item) => `Value: ${item.formattedValue}`,
        afterLabel: (item) => {
          const att = item.raw && item.raw.__att;
          if (!att) return '';
          const rw = att.sections?.rw?.correct ?? att.scores?.rw?.raw ?? '-';
          const m  = att.sections?.math?.correct ?? att.scores?.math?.raw ?? '-';
          return `RW raw: ${rw}\nMath raw: ${m}`;
        }
      }
    },
    legend: { display: true }
  },
  scales: {
    x: {
      type: 'linear',
      ticks: { autoSkip: true, maxRotation: 0, callback: (val) => formatDateTick(val) },
      grid: { display: false }
    }
  },
  parsing: false
};

function formatDateTick(ms){
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

/* ===== 곡선 계산 ===== */
function interp(points,x){
  const pts=[...points].sort((a,b)=>a[0]-b[0]); if(!pts.length) return 0;
  if(x<=pts[0][0]) return Math.round(pts[0][1]);
  if(x>=pts[pts.length-1][0]) return Math.round(pts[pts.length-1][1]);
  for(let i=1;i<pts.length;i++){ const [x0,y0]=pts[i-1],[x1,y1]=pts[i]; if(x<=x1){ const t=(x-x0)/(x1-x0); return Math.round(y0+t*(y1-y0)); } }
  return Math.round(pts[pts.length-1][1]);
}
function scaledFromCurve(points, correct, total){
  if (!total || total <= 0) return null; // PATCH: 원점수 없으면 스케일드는 null
  const maxX=Math.max(...points.map(p=>p[0]));
  const x=(maxX<=100)?(correct/total*100):correct;
  return interp(points,x);
}
function chooseCurves(presetName, attempt){
  const PRESETS=(window.CURVE_PRESETS||{});
  if(presetName && PRESETS[presetName]) return PRESETS[presetName];
  if(attempt?.curvePreset && PRESETS[attempt.curvePreset]) return PRESETS[attempt.curvePreset];
  return PRESETS.default || { rw:[[0,200],[100,800]], math:[[0,200],[100,800]] };
}
function ensureScaled(attempt, viewPreset){
  const curves = chooseCurves(viewPreset, attempt);
  // 원본 보존 + 계산
  const rwRaw   = attempt.sections?.rw ? { correct: attempt.sections.rw.correct ?? 0, total: attempt.sections.rw.total ?? 0 } : { correct:0, total:0 };
  const mathRaw = attempt.sections?.math ? { correct: attempt.sections.math.correct ?? 0, total: attempt.sections.math.total ?? 0 } : { correct:0, total:0 };

  const rwScaled   = scaledFromCurve(curves.rw,   rwRaw.correct,   rwRaw.total);
  const mathScaled = scaledFromCurve(curves.math, mathRaw.correct, mathRaw.total);

  const sections = {
    rw:   { correct: rwRaw.correct,   total: rwRaw.total,   scaled: rwScaled },
    math: { correct: mathRaw.correct, total: mathRaw.total, scaled: mathScaled }
  };

  // PATCH: 시도 모드에 맞춰 총점 산출
  const mode = attempt.mode || 'full';
  let sat_total = null;
  if (mode === 'full') {
    if (typeof rwScaled === 'number' && typeof mathScaled === 'number') sat_total = rwScaled + mathScaled;
  } else if (mode === 'rw') {
    if (typeof rwScaled === 'number') sat_total = rwScaled;
  } else if (mode === 'math') {
    if (typeof mathScaled === 'number') sat_total = mathScaled;
  }

  return { ...attempt, sections, sat_total };
}

/* ===== Attempt 스키마 마이그레이션 ===== */
function uuid4(){
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function migrateLocalAttemptsOnce(){
  const arr = loadAttempts();
  let changed = false;
  for(const a of arr){
    if(!a.id){ a.id = uuid4(); changed = true; }
    if(!a.updatedAt){ a.updatedAt = a.ts || Date.now(); changed = true; }
    if(a._dirty === undefined){ a._dirty = false; changed = true; }
    if(!a.version){ a.version = 1; changed = true; }
    if(!a.sections){
      a.sections = { rw:{correct:0,total:0}, math:{correct:0,total:0} };
      changed = true;
    }
  }
  if(changed) saveAttempts(arr);
}

/* ===== 모드 필터 (대시보드 전용) ===== */
let DASH_MODE = 'all'; // 'all' | 'full' | 'rw' | 'math'
function setDashMode(m){
  DASH_MODE = (m==='full'||m==='rw'||m==='math'||m==='all') ? m : 'all';
  const sel = document.getElementById('modeSelect');
  if (sel) sel.value = DASH_MODE;
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.mode === DASH_MODE);
  });
  saveFilters({ ...loadFilters(), mode: DASH_MODE });
  renderAll();
}

/* ===== UI 요소 ===== */
const $base   = document.getElementById('baseSelect');
const $kind   = document.getElementById('kindSelect');
const $preset = document.getElementById('presetSelect');
const $count  = document.getElementById('countInfo');
const $tbody  = document.querySelector('#attemptTable tbody');
const $cmpA   = document.getElementById('cmpA');
const $cmpB   = document.getElementById('cmpB');
const $cmpOut = document.getElementById('cmpOut');
const $skillSel = document.getElementById('skillSelect');
const $from  = document.getElementById('fromDate');
const $to    = document.getElementById('toDate');
const $agg   = document.getElementById('aggMode');
const $aggCard = document.getElementById('aggCard');
const $aggOut  = document.getElementById('aggOut');
const $aggCaption = document.getElementById('aggCaption');
let LINE=null, BAR=null, SKILL_LINE=null;

/* ===== 옵션 구성 ===== */
function groupBaseOptions(list){
  const map=new Map();
  list.forEach(a=>{
    if(!map.has(a.baseId)) map.set(a.baseId,{ baseId:a.baseId, titleSet:new Set(), lastTs:0 });
    const rec=map.get(a.baseId);
    if(a.title) rec.titleSet.add(a.title);
    rec.lastTs = Math.max(rec.lastTs, a.ts || 0);
  });
  return [...map.values()].sort((a,b)=> b.lastTs-a.lastTs).map(rec=>{
    const label = rec.titleSet.size? [...rec.titleSet].pop() : rec.baseId;
    return { value: rec.baseId, label };
  });
}
function fillBase(list){
  $base.innerHTML='';
  groupBaseOptions(list).forEach(opt=>{
    const o=document.createElement('option'); o.value=opt.value; o.textContent=opt.label; $base.appendChild(o);
  });
  const saved = loadFilters();
  if (saved.baseId && $base.querySelector(`option[value="${CSS.escape(saved.baseId)}"]`)) {
    $base.value = saved.baseId;
  }
  const def=loadPresetDefaults(); const baseId=$base.value;
  if(def[baseId] && ($preset.querySelector(`option[value="${def[baseId]}"]`))){
    if (!saved.preset) $preset.value=def[baseId];
  }
}
function fillPreset(){
  const PRESETS = window.CURVE_PRESETS||{};
  $preset.innerHTML='';
  Object.keys(PRESETS).forEach(name=>{
    const o=document.createElement('option'); o.value=name; o.textContent=name; $preset.appendChild(o);
  });
  if(PRESETS.default) $preset.value='default';
  const saved = loadFilters();
  if (saved.preset && $preset.querySelector(`option[value="${CSS.escape(saved.preset)}"]`)) {
    $preset.value = saved.preset;
  }
}
function fmtDate(ts){
  const d=new Date(ts), z=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/* ===== 날짜/필터 ===== */
function parseDateInput(v){
  if(!v) return null;
  const t = Date.parse(v + 'T00:00:00');
  return Number.isFinite(t) ? t : null;
}
function endOfDay(ts){ return ts + 24*60*60*1000 - 1; }

/* ─────────────────────────────────────────────────────────
   [PATCH-BEGIN] 서버 연동 (DSAT_SYNC → REST → localStorage 폴백)
   - normalizeServerAttempt: 서버 레코드를 대시보드 스키마로 정규화
   - fetchAttemptsViaDSATSYNC / fetchAttemptsViaREST
   - refreshAttempts(): 서버에서 가져와 캐시에 저장
   - allAttempts(): 캐시 있으면 캐시, 없으면 로컬
   ───────────────────────────────────────────────────────── */
let ATTEMPTS_CACHE = [];

async function getAuthToken(){ 
  try{ const u=firebase?.auth?.().currentUser; if(!u) return null; return await u.getIdToken(); }catch{ return null; } 
}
function normalizeServerAttempt(x){
  const ts = x.finishedAt?.seconds ? x.finishedAt.seconds*1000
           : x.createdAt?.seconds  ? x.createdAt.seconds*1000
           : (typeof x.ts==='number'? x.ts : Date.now());
  const rwRaw = x.rawScore?.rw || x.raw?.rw || {};
  const mRaw  = x.rawScore?.math || x.raw?.math || {};
  return {
    id: x.id || x.attemptId || String(ts),
    ts,
    baseId: x.setId || x.baseId || x.set || '-',
    title: x.title || x.setTitle || x.baseTitle || x.setId || '-',
    kind: x.kind || 'base',
    mode: x.runMode || x.mode || 'full',
    curvePreset: x.curvePreset || null,
    sections: {
      rw:   { correct: Number(rwRaw.correct||0), total: Number(rwRaw.total||0) },
      math: { correct: Number(mRaw.correct||0),  total: Number(mRaw.total||0) }
    },
    skills: x.skills || {},
    _from: 'server'
  };
}
async function fetchAttemptsViaDSATSYNC(){
  try{
    if(!window.DSAT_SYNC || !DSAT_SYNC.listAttempts) return null;
    const out = await DSAT_SYNC.listAttempts();
    if(!out || !Array.isArray(out.attempts)) return null;
    return out.attempts.map(normalizeServerAttempt);
  }catch{ return null; }
}
async function fetchAttemptsViaREST(){
  try{
    const token = await getAuthToken();
    const base  = window.SYNC_API_BASE || (window.DSAT_SYNC && DSAT_SYNC.API_BASE) || '';
    const url   = (base? base.replace(/\/$/,'') : '') + '/api/attempts';
    const res   = await fetch(url, { headers: token? { 'Authorization': 'Bearer '+token } : {} });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json  = await res.json();
    if(!json || !Array.isArray(json.attempts)) throw new Error('Invalid payload');
    return json.attempts.map(normalizeServerAttempt);
  }catch{ return null; }
}
async function refreshAttempts(){
  let server = await fetchAttemptsViaDSATSYNC();
  if(!server) server = await fetchAttemptsViaREST();
  if(!server) server = loadAttempts(); // 마지막 폴백: 로컬
  ATTEMPTS_CACHE = (server||[]).sort((a,b)=> (b.ts||0)-(a.ts||0));
}
function allAttempts(){
  return (ATTEMPTS_CACHE && ATTEMPTS_CACHE.length)? ATTEMPTS_CACHE : loadAttempts();
}
/* ─────────────────────────────────────────────────────────
   [PATCH-END] 서버 연동
   ───────────────────────────────────────────────────────── */

/* ===== 데이터 현재 뷰 ===== */
function currentRows(){
  // PATCH: 서버 캐시 우선 사용
  const all = allAttempts().sort((a,b)=> (b.ts||0)-(a.ts||0));

  if(!$base.options.length) fillBase(all);
  if(!$preset.options.length) fillPreset();

  const baseId = $base.value || (all[0]?.baseId ?? '');
  const kind = $kind.value;

  const fromTs = parseDateInput($from.value);
  const toTsRaw = parseDateInput($to.value);
  const toTs = toTsRaw!==null ? endOfDay(toTsRaw) : null;

  const def=loadPresetDefaults(); const basePreset = def[baseId];
  const presetName = ($preset.value || basePreset || null);

  const filtered0 = all.filter(a=>{
    if(a.baseId!==baseId) return false;
    if(kind && a.kind!==kind) return false;
    if(fromTs!==null && (a.ts||0) < fromTs) return false;
    if(toTs!==null && (a.ts||0) > toTs) return false;
    return true;
  });

  // PATCH: 모드 필터링
  const fm = (DASH_MODE==='all') ? filtered0 : filtered0.filter(a => (a.mode || 'full') === DASH_MODE);

  // 스케일드/총점 계산 반영
  const rowsEnsured = fm.map(a=> ensureScaled(a, presetName));

  $count.textContent = `${rowsEnsured.length} attempts`;
  return { rows: rowsEnsured, presetName, baseId, fromTs, toTs };
}

/* ===== 표/차트 ===== */
function renderTable(rows){
  const numOrDash = (v)=> (typeof v==='number' && isFinite(v)) ? v : '—';
  $tbody.innerHTML='';
  rows.forEach(a=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`
      <td>${fmtDate(a.ts)}</td>
      <td>${a.title||a.baseId||''}</td>
      <td>${a.kind}${a.mode? ` · <span class="badge" style="background:#eef">${a.mode.toUpperCase()}</span>`:''}</td>
      <td class="right">${a.sections.rw.correct}/${a.sections.rw.total} · <b>${numOrDash(a.sections.rw.scaled)}</b></td>
      <td class="right">${a.sections.math.correct}/${a.sections.math.total} · <b>${numOrDash(a.sections.math.scaled)}</b></td>
      <td class="right"><b>${numOrDash(a.sat_total)}</b></td>
      <td class="right">${a.curvePreset||'—'}</td>`;
    tr.style.cursor='pointer';
    tr.addEventListener('click', ()=> openAttemptDetail(a));
    $tbody.appendChild(tr);
  });
}

function renderCharts(rows){
  // PATCH: null-safe 포인트 생성
  const toPoint = (a, v) => (typeof v==='number' && isFinite(v)) ? { x:a.ts, y:v, __att:a } : { x:a.ts, y:null, __att:a };
  const chronological = [...rows].sort((a,b)=> (a.ts||0)-(b.ts||0));

  const pointsTotal = chronological.map(a => toPoint(a, a.sat_total));
  const pointsRW    = chronological.map(a => toPoint(a, a.sections.rw.scaled));
  const pointsMath  = chronological.map(a => toPoint(a, a.sections.math.scaled));

  const c1=document.getElementById('satLine'); if(LINE) LINE.destroy();
  LINE = new Chart(c1, {
    type:'line',
    data:{ datasets:[{ label:'Total SAT (by mode)', data:pointsTotal, tension:.25, pointRadius:3, spanGaps:true }]},
    options:{
      ...chartCommonOptions,
      plugins:{ ...chartCommonOptions.plugins, tooltip:{ ...chartCommonOptions.plugins.tooltip, callbacks:{ ...chartCommonOptions.plugins.tooltip.callbacks, label:(i)=> `Total: ${i.parsed.y ?? '—'}` } } },
      scales:{ ...chartCommonOptions.scales, y:{ suggestedMin:400, suggestedMax:1600, grid:{ color:'#eee' } } }
    }
  });

  const c2=document.getElementById('sectionBar'); if(BAR) BAR.destroy();
  BAR = new Chart(c2, {
    type:'bar',
    data:{ datasets:[
      { label:'RW',   data:pointsRW,   stack:'sat' },
      { label:'Math', data:pointsMath, stack:'sat' }
    ]},
    options:{
      ...chartCommonOptions,
      plugins:{ ...chartCommonOptions.plugins, tooltip:{ ...chartCommonOptions.plugins.tooltip, callbacks:{ ...chartCommonOptions.plugins.tooltip.callbacks, label:(i)=> `${i.dataset.label}: ${i.parsed.y ?? '—'}` } } },
      scales:{ ...chartCommonOptions.scales, y:{ suggestedMin:200, suggestedMax:1600, stacked:true, grid:{ color:'#eee' } }, x:{ ...chartCommonOptions.scales.x, stacked:true } }
    }
  });
}

/* ===== 스킬 ===== */
function allSkillNames(rows){
  const s=new Set();
  rows.forEach(a=> Object.keys(a.skills||{}).forEach(k=> s.add(k)));
  return [...s].sort();
}
function fillSkillSelect(rows){
  const skills = allSkillNames(rows);
  const sel = document.getElementById('skillSelect');
  if(!sel) return;
  sel.innerHTML='';
  skills.forEach(k=>{ const o=document.createElement('option'); o.value=k; o.textContent=k; sel.appendChild(o); });
}
function classForPct(p){ if(p>=95) return 'c-95'; if(p>=85) return 'c-85'; if(p>=70) return 'c-70'; if(p>=50) return 'c-50'; return 'c-0'; }
function renderHeatmap(rows){
  const heatHdr=document.getElementById('heatHdr');
  const heatBody=document.getElementById('heatBody');
  if(!heatHdr || !heatBody) return;
  heatHdr.innerHTML=''; heatBody.innerHTML='';

  const skills = allSkillNames(rows);
  const hdrRow=document.createElement('div'); hdrRow.className='heat-row';
  const left=document.createElement('div'); left.className='skill-name'; left.style.fontWeight='700'; left.textContent='Skill';
  hdrRow.appendChild(left);
  rows.forEach((a,i)=>{
    const d=document.createElement('div'); d.className='cell'; d.style.fontWeight='700';
    d.title=fmtDate(a.ts); d.textContent=String(i+1);
    hdrRow.appendChild(d);
  });
  heatHdr.appendChild(hdrRow);

  skills.forEach(sk=>{
    const row=document.createElement('div'); row.className='heat-row';
    const name=document.createElement('div'); name.className='skill-name'; name.textContent=sk;
    row.appendChild(name);
    rows.forEach(a=>{
      const s=a.skills?.[sk];
      const acc = s && s.total ? Math.round((s.correct/s.total)*100) : null;
      const cell=document.createElement('div'); cell.className='cell ' + (acc===null?'':classForPct(acc));
      cell.textContent = acc===null ? '—' : String(acc);
      cell.title = acc===null ? `${sk}: no data` : `${sk}: ${s.correct}/${s.total} (${acc}%)`;
      row.appendChild(cell);
    });
    heatBody.appendChild(row);
  });
}
function renderSkillTrend(rows){
  const key=$skillSel.value;
  const chronological = [...rows].sort((a,b)=> (a.ts||0)-(b.ts||0));
  const points = chronological.map(a=>{
    const s=a.skills?.[key];
    const val = (s && s.total)? Math.round((s.correct/s.total)*100) : null;
    return val===null ? { x:a.ts, y:null, __att:a } : { x:a.ts, y:val, __att:a };
  });

  const c=document.getElementById('skillLine'); if(!c) return;
  if(SKILL_LINE) SKILL_LINE.destroy();
  SKILL_LINE = new Chart(c, {
    type: 'line',
    data: { datasets: [{ label: key || 'Skill', data: points, spanGaps: true, tension: 0.2 }] },
    options: {
      ...chartCommonOptions,
      plugins: {
        ...chartCommonOptions.plugins,
        tooltip: { ...chartCommonOptions.plugins.tooltip, callbacks: { ...chartCommonOptions.plugins.tooltip.callbacks, label: (item) => `Acc: ${item.formattedValue ?? '—'}%` } }
      },
      scales: { ...chartCommonOptions.scales, y: { suggestedMin: 0, suggestedMax: 100, grid: { color: '#eee' } } }
    }
  });
}

/* ===== 비교/상세/집계 ===== */
function fillCompare(rows){
  const opts = rows.map((a,i)=>({ key:String(a.ts), label:`#${i+1} • ${fmtDate(a.ts)} • ${a.kind} • ${a.sat_total ?? '—'}` }));
  [$cmpA,$cmpB].forEach(sel=>{
    if(!sel) return;
    sel.innerHTML=''; opts.forEach(o=>{ const op=document.createElement('option'); op.value=o.key; op.textContent=o.label; sel.appendChild(op); });
  });
  if(opts.length>=2){ if($cmpA) $cmpA.selectedIndex=0; if($cmpB) $cmpB.selectedIndex=1; }
}
function renderCompare(rows){
  if(!$cmpOut) return;
  $cmpOut.innerHTML = '';
  const keyA = $cmpA?.value, keyB = $cmpB?.value;
  const A = rows.find(a => String(a.ts) === keyA);
  const B = rows.find(a => String(a.ts) === keyB);
  if (!A || !B) { $cmpOut.innerHTML = '<div class="muted">Select two attempts to compare.</div>'; return; }

  const asNumOrNull = v => (typeof v==='number' && isFinite(v)) ? v : null;
  function card(title, aVal, bVal, fmt = (v)=> (v==null ? '—' : v), extraClass=''){
    const aN = asNumOrNull(aVal), bN = asNumOrNull(bVal);
    const delta = (aN!=null && bN!=null) ? (bN - aN) : null;
    const sign = delta == null ? '' : (delta > 0 ? '+' : '');
    const color = delta == null ? '' : (delta >= 0 ? 'ok' : 'bad');
    return `
      <div class="card ${extraClass}">
        <div class="head"><div class="title">${title}</div></div>
        <div style="display:flex; justify-content:space-between; gap:8px">
          <div><div class="muted">A</div><div><b>${fmt(aN)}</b></div></div>
          <div><div class="muted">B</div><div><b>${fmt(bN)}</b></div></div>
          <div><div class="muted">Δ</div><div><span class="badge ${color}">${delta===null?'—': (sign + delta)}</span></div></div>
        </div>
      </div>`;
  }
  const row1 = card('Total (by mode)', A.sat_total, B.sat_total, v=>v, 'cmp-span-all');
  const row2 = [ card('RW (Scaled)', A.sections.rw.scaled, B.sections.rw.scaled), card('Math (Scaled)', A.sections.math.scaled, B.sections.math.scaled) ].join('');
  const row3 = [ card('RW Raw', A.sections.rw.correct, B.sections.rw.correct), card('Math Raw', A.sections.math.correct, B.sections.math.correct) ].join('');
  $cmpOut.innerHTML = row1 + row2 + row3;
}
function renderAggregations(rows){
  if(!$agg) return;
  const mode = $agg.value;
  if(!mode){ if($aggCard) $aggCard.style.display='none'; if($aggOut) $aggOut.innerHTML=''; return; }
  const keyFn = (a)=> mode==='byPreset' ? (a.curvePreset || '—') : a.baseId;
  const groups = new Map();
  rows.forEach(a=>{ const k = keyFn(a); if(!groups.has(k)) groups.set(k, []); groups.get(k).push(a); });

  const stats = [...groups.entries()].map(([k,arr])=>{
    const nAll = arr.length;

    const numAvg = (list, pick)=>{
      const vals = list.map(pick).filter(v=> typeof v==='number' && isFinite(v));
      const n = vals.length || 1;
      return Math.round(vals.reduce((s,x)=>s+x,0)/n);
    };

    const rwScaledAvg   = numAvg(arr, x=> x.sections.rw.scaled);
    const mathScaledAvg   = numAvg(arr, x=> x.sections.math.scaled);
    const satAvg        = numAvg(arr, x=> x.sat_total);

    const rwRawAvgPct = (()=> {
      const vals = arr.map(x=> (x.sections.rw.total? (x.sections.rw.correct/x.sections.rw.total*100) : null)).filter(v=> v!=null);
      const n = vals.length || 1;
      return Math.round(vals.reduce((s,x)=>s+x,0)/n);
    })();
    const mathRawAvgPct = (()=> {
      const vals = arr.map(x=> (x.sections.math.total? (x.sections.math.correct/x.sections.math.total*100) : null)).filter(v=> v!=null);
      const n = vals.length || 1;
      return Math.round(vals.reduce((s,x)=>s+x,0)/n);
    })();

    const latestTs = Math.max(...arr.map(x=> x.ts||0));
    return { key:k, n:nAll, satAvg, rwScaledAvg, mathScaledAvg, rwRawAvg: rwRawAvgPct, mathRawAvg: mathRawAvgPct, latestTs };
  });

  stats.sort((a,b)=> (b.n-a.n) || (b.satAvg-a.satAvg) || String(a.key).localeCompare(String(b.key)));
  const thMode = (mode==='byPreset') ? 'Preset' : 'Set';
  const rowsHTML = stats.map(s=>`
    <tr>
      <td>${s.key}</td>
      <td class="right">${s.n}</td>
      <td class="right"><b>${s.satAvg}</b></td>
      <td class="right">${s.rwScaledAvg}</td>
      <td class="right">${s.mathScaledAvg}</td>
      <td class="right">${s.rwRawAvg}%</td>
      <td class="right">${s.mathRawAvg}%</td>
      <td>${new Date(s.latestTs).toLocaleDateString()}</td>
    </tr>
  `).join('');
  if($aggOut) {
    $aggOut.innerHTML = `
      <div class="muted" style="font-size:13px; margin-bottom:6px">Averages are computed after current filters (set/view/date/preset/mode).</div>
      <table style="width:100%; border-collapse:collapse; font-size:14px">
        <thead>
          <tr>
            <th style="text-align:left">${thMode}</th>
            <th class="right">#Attempts</th>
            <th class="right">Total Avg</th>
            <th class="right">RW Scaled Avg</th>
            <th class="right">Math Scaled Avg</th>
            <th class="right">RW Accuracy</th>
            <th class="right">Math Accuracy</th>
            <th style="text-align:left">Latest</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>`;
  }
  if($aggCaption) $aggCaption.textContent = (mode==='byPreset') ? 'Aggregate by Preset' : 'Aggregate by Set';
  if($aggCard) $aggCard.style.display = 'block';
}

/* ===== 상세 모달 ===== */
const detailBack=document.getElementById('detailBack');
const detailBody=document.getElementById('detailBody');
document.getElementById('detailClose').onclick=()=>{ detailBack.style.display='none'; detailBody.innerHTML=''; };
function openAttemptDetail(a){
  const numOrDash = (v)=> (typeof v==='number' && isFinite(v)) ? v : '—';
  const skills = Object.entries(a.skills||{}).map(([k,v])=>({ k, correct:v.correct, total:v.total, acc: v.total? Math.round((v.correct/v.total)*100) : 0 })).sort((x,y)=> y.acc - x.acc);
  const top = skills.slice(0,5), bottom = skills.slice(-5);
  detailBody.innerHTML = `
    <div class="head"><div class="title">Attempt Detail — ${fmtDate(a.ts)}</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr; gap:12px">
      <div class="card">
        <div class="head"><div class="title">Summary</div></div>
        <div>Set: <b>${a.title||a.baseId||''}</b></div>
        <div>Type: <b>${a.kind}</b> ${a.mode? ` · <span class="badge" style="background:#eef">${a.mode.toUpperCase()}</span>`:''}</div>
        <div style="margin-top:6px">RW: <b>${a.sections.rw.correct}/${a.sections.rw.total}</b> → <b>${numOrDash(a.sections.rw.scaled)}</b></div>
        <div>Math: <b>${a.sections.math.correct}/${a.sections.math.total}</b> → <b>${numOrDash(a.sections.math.scaled)}</b></div>
        <div style="margin-top:6px">Total: <b>${numOrDash(a.sat_total)}</b></div>
        <div class="muted" style="margin-top:6px">Preset (recorded): ${a.curvePreset||'—'}</div>
      </div>
      <div class="card">
        <div class="head"><div class="title">Skills — Top / Bottom</div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr; gap:10px">
          <div>
            <div class="muted" style="margin-bottom:6px">Top 5</div>
            ${top.map(s=>`<div>${s.k} — <b>${s.acc}%</b> <span class="muted">(${s.correct}/${s.total})</span></div>`).join('') || '<div class="muted">No data</div>'}
          </div>
          <div>
            <div class="muted" style="margin-bottom:6px">Bottom 5</div>
            ${bottom.map(s=>`<div>${s.k} — <b>${s.acc}%</b> <span class="muted">(${s.correct}/${s.total})</span></div>`).join('') || '<div class="muted">No data</div>'}
          </div>
        </div>
      </div>
    </div>`;
  detailBack.style.display='block';
}

/* ===== 커브 에디터 ===== */
const curveBack=document.getElementById('curveBack');
const curveClose=document.getElementById('curveClose');
const editPreset=document.getElementById('editPreset');
const newPresetName=document.getElementById('newPresetName');
const rwPoints=document.getElementById('rwPoints');
const mathPoints=document.getElementById('mathPoints');
curveClose.onclick=()=>{ curveBack.style.display='none'; };
function openCurveEditor(){
  const PRESETS = window.CURVE_PRESETS||{};
  editPreset.innerHTML='';
  Object.keys(PRESETS).forEach(name=>{ const o=document.createElement('option'); o.value=name; o.textContent=name; editPreset.appendChild(o); });
  editPreset.value = $preset.value || 'default';
  loadPresetToForm(editPreset.value);
  curveBack.style.display='block';
}
function loadPresetToForm(name){
  const PRESETS = window.CURVE_PRESETS||{};
  const p = PRESETS[name] || PRESETS.default;
  rwPoints.value = JSON.stringify(p.rw||[], null, 2);
  mathPoints.value = JSON.stringify(p.math||[], null, 2);
}
document.getElementById('openCurveEditor').onclick=openCurveEditor;
editPreset.addEventListener('change', ()=> loadPresetToForm(editPreset.value));
document.getElementById('dupBtn').onclick=()=>{
  const name = (newPresetName.value||'').trim();
  if(!name){ alert('새 프리셋 이름을 입력하세요.'); return; } // 관리자/개발자: 한글 허용
  const PRESETS=window.CURVE_PRESETS||{};
  try{
    PRESETS[name] = { rw: JSON.parse(rwPoints.value||'[]'), math: JSON.parse(mathPoints.value||'[]') };
    alert(`프리셋 "${name}" 추가됨`); // 관리자/개발자: 한글 허용
    fillPreset(); $preset.value=name; openCurveEditor();
  }catch(e){ alert('JSON 파싱 실패: '+e.message); } // 관리자/개발자: 한글 허용
};
document.getElementById('delBtn').onclick=()=>{
  const name = editPreset.value;
  if(!name || name==='default'){ alert('default는 삭제할 수 없습니다.'); return; } // 관리자/개발자: 한글 허용
  if(confirm(`프리셋 "${name}"을(를) 삭제할까요?`)){ // 관리자/개발자: 한글 허용
    delete window.CURVE_PRESETS[name];
    fillPreset(); openCurveEditor();
  }
};
document.getElementById('saveCurveBtn').onclick=()=>{
  const name = editPreset.value;
  try{
    const rw=JSON.parse(rwPoints.value||'[]');
    const mh=JSON.parse(mathPoints.value||'[]');
    window.CURVE_PRESETS[name] = { rw, math: mh };
    alert(`"${name}" 저장됨`); // 관리자/개발자: 한글 허용
    fillPreset();
  }catch(e){ alert('JSON 파싱 실패: '+e.message); } // 관리자/개발자: 한글 허용
};

/* ===== Export/Import/Print (3-1) ===== */
document.getElementById('exportBtn').onclick = ()=>{
  // PATCH: 서버 캐시 포함해 내보내기
  const all = allAttempts().sort((a,b)=> (b.ts||0)-(a.ts||0));
  const payload = { format:'dsat_attempts', version:'1.0.0', app:'dsat-dashboard', createdAt:new Date().toISOString(), attempts: all };
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8;'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`dsat_attempts_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};
document.getElementById('importBtn').onclick=()=>{
  const inp=document.createElement('input'); inp.type='file'; inp.accept='application/json';
  inp.onchange=async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    try{
      const text=await f.text(); const parsed=JSON.parse(text);
      let attempts = null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.format !== 'dsat_attempts') throw new Error('알 수 없는 파일 형식입니다 (format 필드 불일치).'); // 관리자/개발자: 한글 허용
        if (!Array.isArray(parsed.attempts)) throw new Error('파일에 attempts 배열이 없습니다.'); // 관리자/개발자: 한글 허용
        attempts = parsed.attempts;
      } else if (Array.isArray(parsed)) {
        attempts = parsed;
      } else {
        throw new Error('지원하지 않는 JSON 구조입니다.'); // 관리자/개발자: 한글 허용
      }
      const ok = attempts.every(a => typeof a.ts === 'number' && a.baseId && a.kind && a.sections);
      if (!ok) throw new Error('시도 레코드 스키마가 올바르지 않습니다.'); // 관리자/개발자: 한글 허용
      saveAttempts(attempts);
      migrateLocalAttemptsOnce();
      // PATCH: 가져온 뒤 서버 캐시도 갱신
      await refreshAttempts();
      renderAll();
      alert('가져오기 완료'); // 관리자/개발자: 한글 허용
    }catch(err){ alert('가져오기 실패: '+(err?.message||err)); } // 관리자/개발자: 한글 허용
  };
  inp.click();
};
document.getElementById('printBtn').onclick=()=> window.print();

/* ===== 연습 페이지로 딥링크 ===== */
function goPractice(url){ location.href = url; }
document.getElementById('startSkillReviewBtn')?.addEventListener('click', ()=>{
  const key = document.getElementById('skillSelect').value;
  if(!key){ alert('스킬을 먼저 선택하세요.'); return; } // 설명/가이드: 한글 허용
  goPractice(`./index.html?review=skill&value=${encodeURIComponent(key)}`);
});
document.getElementById('startWrongReviewBtn')?.addEventListener('click', ()=>{ goPractice('./index.html?review=wrong'); });
document.getElementById('startFlaggedReviewBtn')?.addEventListener('click', ()=>{ goPractice('./index.html?review=flagged'); });

/* ===== 렌더 & 이벤트 ===== */
function renderAll(){
  const { rows } = currentRows();
  renderTable(rows);
  renderCharts(rows);
  renderHeatmap(rows);
  fillCompare(rows);
  renderCompare(rows);
  fillSkillSelect(rows);
  renderSkillTrend(rows);
  renderAggregations(rows);
  renderSyncBadge(); // ← 동기화 배지 갱신
}

/* — 필터 변경 — */
function onFilterChanged() {
  const baseId = $base.value || '';
  const preset = $preset.value || '';
  if (baseId && preset) {
    const def = loadPresetDefaults();
    if (def[baseId] !== preset) { def[baseId] = preset; savePresetDefaults(def); }
  }
  saveFilters(snapshotFiltersFromUI());
  renderAll();
}
$base.addEventListener('change', onFilterChanged);
$kind.addEventListener('change', onFilterChanged);
$preset.addEventListener('change', onFilterChanged);
document.getElementById('fromDate').addEventListener('change', onFilterChanged);
document.getElementById('toDate').addEventListener('change', onFilterChanged);

// PATCH: 모드 UI 자동 연결 (select 또는 세그 버튼)
(function wireModeUI(){
  const sel = document.getElementById('modeSelect');
  if (sel) sel.addEventListener('change', ()=> setDashMode(sel.value));
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn=>{
    btn.addEventListener('click', ()=> setDashMode(btn.dataset.mode));
  });
})();

document.getElementById('cmpBtn').addEventListener('click', ()=> renderAll());
document.getElementById('openDetailA').addEventListener('click', ()=>{ const { rows } = currentRows(); const A=rows.find(r=> String(r.ts)===$cmpA.value); if(A) openAttemptDetail(A); });
document.getElementById('openDetailB').addEventListener('click', ()=>{ const { rows } = currentRows(); const B=rows.find(r=> String(r.ts)===$cmpB.value); if(B) openAttemptDetail(B); });
$skillSel.addEventListener('change', ()=>{ const { rows } = currentRows(); renderSkillTrend(rows); });
document.getElementById('aggMode').addEventListener('change', ()=> renderAll());
document.getElementById('clearBtn').addEventListener('click', ()=>{ if(confirm('Delete all local attempt logs?')){ saveAttempts([]); /* 서버는 보존, 로컬만 초기화 */ renderAll(); }});
document.getElementById('skillAllBtn').onclick=()=>{
  const { rows } = currentRows();
  const last = rows.slice(0,5).reverse();
  const accs = {};
  last.forEach(a=>{
    Object.entries(a.skills||{}).forEach(([k,v])=>{ if(!accs[k]) accs[k]=[]; accs[k].push(v.total? (v.correct/v.total*100) : null); });
  });
  const varList = Object.entries(accs).map(([k,arr])=>{
    const vals = arr.filter(x=> x!==null);
    if(vals.length<2) return [k,-1];
    const avg = vals.reduce((s,x)=>s+x,0)/vals.length;
    const v = vals.reduce((s,x)=>s+(x-avg)**2,0)/vals.length;
    return [k,v];
  }).filter(([,v])=> v>=0).sort((a,b)=> b[1]-a[1]);
  if(!varList.length){ alert('변동을 계산할 데이터가 부족합니다.'); return; } // 설명: 한글 허용
  $skillSel.value = varList[0][0];
  renderSkillTrend(rows);
};

/* ===== (Sync) — DSAT_SYNC에 일원화 ===== */
/* 필요 HTML id:
   - 버튼: #btnPush, #btnPull, #btnSyncNow
   - 배지: #syncBadge (선택)
   - 상태: #syncStatus (선택)
   - 토스트: #toast (선택; .toast, .toast.ok, .toast.err 클래스) */

function showToast(msg, kind='info'){
  const el = document.getElementById('toast');
  if(!el){ console[kind==='error'?'error':'log']('[TOAST]', msg); return; }
  el.textContent = msg;
  el.className = 'toast ' + (kind==='error'?'err':(kind==='ok'?'ok':'')); 
  setTimeout(()=> el.className='toast', 1600);
}
function renderSyncBadge(){
  const el = document.getElementById('syncBadge');
  if(!el) return;
  const n = (loadAttempts().filter(a=>a._dirty)).length;
  el.textContent = n>0 ? String(n) : '';
  el.style.display = n>0 ? 'inline-flex' : 'none';
}

(function wireSync(){
  if (!window.DSAT_SYNC) {
    console.warn('[SYNC] DSAT_SYNC not found. Load sync.js before dashboard.js.');
    return;
  }

  // 버튼 바인딩
  DSAT_SYNC.attachButtons({
    pushId: 'btnPush',
    pullId: 'btnPull',
    syncId: 'btnSyncNow',
    toast: (m)=> showToast(m,'ok')
  });

  // 연결 체크
  DSAT_SYNC.testConnection()
    .then(r => {
      const ok = r && r.ok;
      const el = document.getElementById('syncStatus');
      if (el) el.textContent = ok ? 'Connected' : ('Error: '+(r?.error||'')); 
      showToast(ok ? 'Connected' : 'Auth required', ok ? 'ok' : 'error');
    })
    .catch(e => {
      const el = document.getElementById('syncStatus');
      if (el) el.textContent = 'Error: ' + (e.message||e);
      showToast('Connection error', 'error');
    });

  // 자동/수동 동기화 시 서버 데이터 반영
  const run = async ()=>{
    try{
      const r = await DSAT_SYNC.syncNow();
      await refreshAttempts();           // [PATCH] pull 결과 반영
      renderAll();
      showToast(`Sync ✔ push ${r.push.pushed}, pull +${r.pull.added}/~${r.pull.replaced}`, 'ok');
    }catch(e){
      console.warn('[SYNC] auto fail', e?.message||e);
      showToast('Auto sync failed', 'error');
    }finally{
      renderSyncBadge();
    }
  };
  window.addEventListener('DOMContentLoaded', run);
  setInterval(run, 180000);

  // 수동 버튼도 동일 동작 보장
  document.getElementById('btnSyncNow')?.addEventListener('click', run);
})();

/* ===== Bootstrap ===== */
(async function bootstrapDashboard(){
  migrateLocalAttemptsOnce();

  // [PATCH] 최초 진입 시 서버 → 캐시 로드 (실패 시 로컬 폴백)
  try { await refreshAttempts(); } catch(e){ console.warn('refreshAttempts fail', e); }

  const all = allAttempts().sort((a,b)=> (b.ts||0)-(a.ts||0));
  if(!$base.options.length) fillBase(all);
  if(!$preset.options.length) fillPreset();

  // PATCH: 모드 UI 프리셋 초기화(저장값 복원)
  const saved = loadFilters();
  DASH_MODE = saved.mode || 'all';
  const modeSel = document.getElementById('modeSelect');
  if (modeSel) modeSel.value = DASH_MODE;
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.mode === DASH_MODE);
  });

  applySavedFiltersToUI();
  FILTERS_READY = true;
  renderAll();
})();

/* 모달 외부 클릭 닫기 */
[document.getElementById('detailBack'), document.getElementById('curveBack')].forEach(back=>{
  if(!back) return;
  back.addEventListener('click', (e)=>{ if(e.target===back) back.style.display='none'; });
});

// 버튼 클릭 시 모드 변경 (UI 시각 표시 보조)
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.mode-btn');
  let currentMode = DASH_MODE || 'all';
  const updateSel = ()=> buttons.forEach(btn=> btn.classList.toggle('selected', btn.getAttribute('data-mode')===currentMode));
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      currentMode = button.getAttribute('data-mode');
      updateSel();
      handleModeChange(currentMode);
    });
  });
  updateSel();
  handleModeChange(currentMode);
});

// 모드 변경 시 동작할 함수 (기본 처리 예시)
function handleModeChange(mode) {
  switch (mode) {
    case 'all':  console.log("All mode selected"); break;
    case 'full': console.log("Full mode selected"); break;
    case 'rw':   console.log("RW mode selected"); break;
    case 'math': console.log("Math mode selected"); break;
    default:     console.log("Unknown mode");
  }
}
