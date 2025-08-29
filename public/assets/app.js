/* ===== 기본 커브(안전 장치) ===== */
const DEFAULT_CURVES = {
  rw:   [[0,200],[20,300],[40,400],[60,550],[80,700],[100,800]],
  math: [[0,200],[20,300],[40,450],[60,600],[80,720],[100,800]]
};

/* ===== 상태 ===== */
let SET=null, modIdx=0, qIdx=0;
let flags=new Set(), answers={};
let timerSec=0, tickId=null;

// 리뷰 세션에서 사용할 타이머 선호 설정
window.REVIEW_TIMER_PREF = window.REVIEW_TIMER_PREF || { mode: 'default', minutes: null };

/* ===== Auto-Save (localStorage) ===== */
let RESTORE_CACHE = null;

const FEATURE_SIMILAR = false;

/* 마지막으로 연 세트 정보(대시보드 왕복 복원용) */
const LAST_SET_KEY = 'dsat_last_set'; // {type:'url'|'blob', value:string}

/* ===== 유틸 ===== */
const $ = s=>document.querySelector(s);
const bubbleABC = idx => "ABCD".charAt(idx);
const fmt = s => (s??"").replaceAll("\\n","<br>");
const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const typeset = ()=> window.MathJax && MathJax.typesetPromise();
const injectImages = html =>
  (html||"").replace(/\[\[IMAGE:\s*([^|\]]+)(?:\|([^\]]+))?\]\]/g,
    (_m,src,alt)=>`<img src="./img/${src.trim()}" alt="${(alt||'problem image').trim()}" style="max-width:100%">`);

/* ===== 저장소 키 ===== */
function storageKey(){
  const id = (SET?.metadata?.id || SET?.id || SET?.metadata?.title || 'default').toString();
  return `dsat_autosave:${id}`;
}
function saveState(){
  try{
    const payload = { modIdx, qIdx, answers, timers: { [String(modIdx)]: timerSec } };
    localStorage.setItem(storageKey(), JSON.stringify(payload));
  }catch(e){}
}
function tryRestore(){
  try{
    const raw = localStorage.getItem(storageKey());
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(_e){ return null; }
}
function clearState(){
  try{ localStorage.removeItem(storageKey()); }catch(_e){}
}

/* ===== SAT Score Curves & Helpers =====
   우선순위: metadata.curves > metadata.curvePreset(프리셋 이름) > PRESETS.default > DEFAULT_CURVES */
function getCurves(){
  const PRESETS = window.CURVE_PRESETS || {};
  const meta = SET?.metadata || {};

  // 1) 세트에 곡선 직접 내장
  if (meta.curves && (Array.isArray(meta.curves.rw) || Array.isArray(meta.curves.math))) {
    return {
      rw:   Array.isArray(meta.curves.rw)   ? meta.curves.rw   : (PRESETS.default?.rw || DEFAULT_CURVES.rw),
      math: Array.isArray(meta.curves.math) ? meta.curves.math : (PRESETS.default?.math || DEFAULT_CURVES.math)
    };
  }
  // 2) 프리셋 이름 지정
  if (meta.curvePreset && PRESETS[meta.curvePreset]) return PRESETS[meta.curvePreset];
  // 3) 프리셋 default
  if (PRESETS.default) return PRESETS.default;
  // 4) 안전 기본값
  return { rw: DEFAULT_CURVES.rw, math: DEFAULT_CURVES.math };
}

function interp(points, x){
  const pts = [...points].sort((a,b)=>a[0]-b[0]);
  if (!pts.length) return 0;
  if (x <= pts[0][0]) return Math.round(pts[0][1]);
  if (x >= pts[pts.length-1][0]) return Math.round(pts[pts.length-1][1]);
  for (let i=1;i<pts.length;i++){
    const [x0,y0]=pts[i-1], [x1,y1]=pts[i];
    if (x <= x1){
      const t = (x-x0)/(x1-x0);
      return Math.round(y0 + t*(y1-y0));
    }
  }
  return Math.round(pts[pts.length-1][1]);
}

function scaledFromCurve(points, rawCorrect, rawTotal){
  const maxX = Math.max(...points.map(p=>p[0]));
  const x = (maxX <= 100)
    ? (rawTotal ? (rawCorrect/rawTotal*100) : 0) // % 도메인
    : rawCorrect;                                // 원점수 도메인
  return interp(points, x);
}

function accumulateSectionTotals(){
  const t = { rw:{correct:0,total:0}, math:{correct:0,total:0} };
  (SET.modules||[]).forEach((m)=>{
    const key = (m.section||'').toLowerCase();
    (m.questions||[]).forEach((q)=>{
      const ok = isCorrect(q);
      if (key==='rw'){ t.rw.total++; if(ok) t.rw.correct++; }
      else if (key==='math'){ t.math.total++; if(ok) t.math.correct++; }
    });
  });
  return t;
}

/* ===== Attempt Log ===== */
const ATTEMPT_KEY = 'dsat_attempts_v1';
function loadAttempts(){ try{ return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '[]'); }catch(_e){ return []; } }
function saveAttempts(arr){ try{ localStorage.setItem(ATTEMPT_KEY, JSON.stringify(arr)); }catch(_e){} }

/* === Attempt 마이그레이션 & ID 유틸 === */
function uuid4(){
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
/** 기존 기록을 Attempt 스펙(id/updatedAt/_dirty/version)으로 보정 — 여러 번 호출해도 안전 */
function migrateLocalAttemptsOnce(){
  const arr = loadAttempts();
  let changed = false;
  for(const a of arr){
    if(!a.id){ a.id = uuid4(); changed = true; }
    if(!a.updatedAt){ a.updatedAt = a.ts || Date.now(); changed = true; }
    if(a._dirty === undefined){ a._dirty = false; changed = true; }
    if(!a.version){ a.version = 1; changed = true; }
  }
  if(changed) saveAttempts(arr);
}

function overallTotals(){
  let total=0, correct=0;
  (SET.modules||[]).forEach(m=>{
    (m.questions||[]).forEach(q=>{
      total += 1;
      if(isCorrect(q)) correct += 1;
    });
  });
  return { total, correct, acc: total? correct/total : 0 };
}
function collectSkillStats(){
  const stats = {};
  (SET.modules || []).forEach(m=>{
    (m.questions || []).forEach(q=>{
      const codes = getSkillCodes(q);
      if(!codes.length) return;
      const ok = isCorrect(q);
      codes.forEach(code=>{
        if(!stats[code]) stats[code] = {correct:0,total:0};
        stats[code].total += 1;
        if(ok) stats[code].correct += 1;
      });
    });
  });
  return stats;
}
function summarizeSkills(){
  const stats = collectSkillStats();
  const bySkill = {};
  Object.entries(stats).forEach(([code, v])=>{
    bySkill[code] = { correct:v.correct, total:v.total, acc: v.total? v.correct/v.total : 0 };
  });
  return bySkill;
}
/* 기록 포맷(대시보드 호환): 섹션 원점수/프리셋명 포함 */
/* 기록 포맷(대시보드/싱크 호환): 섹션 원점수/프리셋 포함 + 싱크 메타 */
function recordAttempt(){
  const isReview = !!SET.__isReviewSession;
  const baseId = isReview
    ? (SET.metadata?.parentId || 'base')
    : (SET.metadata?.id || SET.metadata?.title || 'base');

  const totals = accumulateSectionTotals();
  const usedPreset = SET?.metadata?.curvePreset ?? null;

  // sync config에서 userId 가져오기(선택)
  let userId = null;
  try {
    const cfg = JSON.parse(localStorage.getItem('dsat_sync_config_v1') || '{}');
    userId = cfg.userId || null;
  } catch(_) {}

  const now = Date.now();
  // 서버가 요구하는 id를 로컬에서 안정적으로 생성(없으면)
  const attemptId = `loc_${userId||'u'}_${(baseId||'base').replace(/[^\w-]+/g,'_')}_${isReview?'review':'base'}_${now}`;

  const attempt = {
    id: attemptId,        // ★ 반드시 존재하도록
    ts: now,
    updatedAt: now,       // ★ 싱크 비교용
    userId: userId || undefined,
    baseId,
    kind: isReview ? 'review' : 'base',
    title: SET.metadata?.title || '',
    sections: {
      rw:   { correct: totals.rw.correct,   total: totals.rw.total   },
      math: { correct: totals.math.correct, total: totals.math.total }
    },
    skills: summarizeSkills(),
    curvePreset: usedPreset,

    // ▼ 싱크 메타
    _dirty: true,         // ★ 새 시도는 더티
    _remoteId: null,
    _lastPushedAt: null
  };

  const list = loadAttempts();
  list.push(attempt);
  saveAttempts(list);
  return attempt;
}

function getLatestPair(baseId){
  const list = loadAttempts().filter(a=> a.baseId===baseId);
  let lastBase=null, lastReview=null;
  list.sort((a,b)=> b.ts - a.ts).forEach(a=>{
    if(a.kind==='base'   && !lastBase)   lastBase = a;
    if(a.kind==='review' && !lastReview) lastReview = a;
  });
  return { lastBase, lastReview };
}

/* ===== RW 지문 ===== */
function getPassageHTML(q){
  const base = q.passageHtml || q.passage || q.passageText || "";
  const imgOne = q.passageImage ? `[[IMAGE: ${q.passageImage}]]` : "";
  const imgMany = Array.isArray(q.passageImages)
    ? q.passageImages.map(fn=>`[[IMAGE: ${fn}]]`).join("<br>")
    : "";
  const all = base + (imgOne || imgMany ? `<div>${imgOne}${imgMany}</div>` : "");
  return injectImages(fmt(all));
}

/* ===== 섹션/타이머 ===== */
function sectionLabel(key){
  const k=(key||'').toLowerCase();
  if(k==='rw'||k==='readingwriting'||k==='reading & writing') return 'Reading & Writing';
  if(k==='math') return 'Math';
  return key || 'Section';
}
function getDurationFor(idx){
  const m = SET.modules[idx] || {};
  const md = SET.metadata?.durationMinutesPerModule;
  if(Array.isArray(md)) return md[idx] ?? 35;
  if(md && typeof md==='object'){
    const key=(m.section||'').toLowerCase();
    const arr=md[key];
    const mi=(m.module? m.module-1 : 0);
    if(Array.isArray(arr)) return arr[mi] ?? 35;
  }
  return 35;
}
function totalQ(mod){ return SET.modules[mod].questions.length; }
function currentQ(){ return SET.modules[modIdx].questions[qIdx]; }

/* ===== Directions (Popover 연동) ===== */
const dirBtn = $('#dirToggle');
const dirPanel = $('#dirPanel'); // 레거시 콘텐츠 주입용(표시는 안 함)

/** Directions 팝오버 열기(버튼 아래). index.html 스크립트의 글로벌 훅 사용 */
function openDirectionsPopoverFromStart(){
  if (typeof window.__openDirectionsFromStart === 'function' && dirBtn) {
    window.__openDirectionsFromStart();
  }
}

/* ===== 마지막 세트 저장(대시보드 복귀시 자동복원) ===== */
function rememberLastSet(meta){
  try{
    localStorage.setItem(LAST_SET_KEY, JSON.stringify(meta));
  }catch(_e){}
}
function tryLoadLastSetMeta(){
  try{
    const raw = localStorage.getItem(LAST_SET_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(_e){ return null; }
}

/* ===== 로드 ===== */
async function loadSet(path){
  try{
    const res = await fetch(path, {cache:'no-store'});
    SET = await res.json();
    $('#loadError').style.display='none';
    rememberLastSet({ type:'url', value:path });
  }catch(e){
    $('#loadError').textContent = `로드 실패: ${e.message}`;
    $('#loadError').style.display='block';
    return;
  }

  afterSetLoaded();
}

function bootFromBlob(){
  const key = 'dsat_launch_blob';
  const text = localStorage.getItem(key);
  if(!text){
    $('#loadError').textContent = 'No pending set. Please start from the landing page.';
    $('#loadError').style.display = 'block';
    return;
  }
  try{
    SET = JSON.parse(text);
    localStorage.removeItem(key);
    $('#loadError').style.display='none';
    rememberLastSet({ type:'blob', value:text });
    afterSetLoaded();
  }catch(e){
    $('#loadError').textContent = 'Failed to parse set from landing page: ' + e.message;
    $('#loadError').style.display='block';
  }
}

function afterSetLoaded(){
  flags.clear(); answers={}; $('#scoreBox').innerHTML='';
  // 레거시처럼 directions HTML은 여기로 넣어둠(표시는 index.html의 팝오버가 담당)
  dirPanel.innerHTML = fmt(SET.metadata?.directions || '');
  buildQIndex();

  RESTORE_CACHE = tryRestore();
  if(RESTORE_CACHE){
    answers = RESTORE_CACHE.answers || {};
    const restoreMod = Math.min(RESTORE_CACHE.modIdx ?? 0, SET.modules.length-1);
    startModule(restoreMod);
    const savedSec = RESTORE_CACHE.timers?.[String(restoreMod)];
    if(typeof savedSec === 'number' && !Number.isNaN(savedSec)){
      timerSec = Math.max(0, savedSec|0);
      $('#timer').textContent = fmtTime(timerSec);
    }
    qIdx = Math.min(RESTORE_CACHE.qIdx ?? 0, totalQ(modIdx)-1);
    renderQuestion(); renderNavButton();
  } else {
    startModule(0);
  }

  // 로더 숨김 (자동 복원 시에도 깔끔하게)
  document.getElementById('loaderRow')?.style && (document.getElementById('loaderRow').style.display='none');
}

/* ===== 모듈/타이머 ===== */
function startModule(idx){
  modIdx = idx; qIdx = 0;
  const m=SET.modules[modIdx];
  const secTxt = sectionLabel(m.section);
  $('#crumb').textContent = `${SET.metadata?.title || 'DSAT Practice'} — ${secTxt} · Module ${m.module||1}`;

  clearInterval(tickId);

  let minutes = getDurationFor(modIdx);
  if (SET.__isReviewSession && window.REVIEW_TIMER_PREF) {
    const pref = window.REVIEW_TIMER_PREF;
    if (pref.mode === 'infinite') minutes = null;
    else if (pref.mode === 'custom' && pref.minutes && pref.minutes > 0) minutes = pref.minutes;
  }

  if (minutes === null) {
    timerSec = null;
    $('#timer').textContent = '∞';
    tickId = setInterval(()=>{
      const now = Date.now();
      const last = window.__lastSaveTs || 0;
      if (now - last > 5000) { saveState(); window.__lastSaveTs = now; }
    }, 1000);
  } else {
    timerSec = minutes * 60;
    $('#timer').textContent = fmtTime(timerSec);
    tickId = setInterval(()=>{
      timerSec = Math.max(0, timerSec - 1);
      $('#timer').textContent = fmtTime(timerSec);
      if (timerSec % 5 === 0) saveState();
      if (timerSec === 0) { clearInterval(tickId); openSubmitConfirm(); }
    }, 1000);
  }

  $('#card').style.display='block';
  $('#ribbon').style.display='flex';
  bindPrevNext();   // 안전 재바인딩
  renderQuestion();
  renderNavButton();
  hideNavPopup();
  $('#scoreBox').innerHTML='';

  // ▶ 모듈 시작 시 Directions 팝오버 자동 오픈
  // (세트 directions가 없더라도 기본 안내가 표시됨)
  setTimeout(openDirectionsPopoverFromStart, 0);
}

function gotoNextModule(){
  const last = SET.modules.length - 1;
  if (modIdx < last){
    startModule(modIdx + 1);
  } else {
    showFinalReport();
  }
}

/* ===== 문제 표시 ===== */
function renderQuestion(){
  const q = currentQ();
  $('#qnum').textContent = qIdx+1;

  const fb=$('#flagBtn');
  const flagged=flags.has(q.id);
  fb.className = 'flag-btn' + (flagged?' flagged':'');
  fb.textContent = flagged ? 'Marked for Review' : 'Mark for Review';
  fb.onclick = ()=>{ flagged?flags.delete(q.id):flags.add(q.id); renderQuestion(); };

  $('#qtitle').innerHTML = q.title || '';

  const qc = $('#qcontainer');
  qc.innerHTML = '';

  const hasPassage = !!(q.passageHtml || q.passage || q.passageText || q.passageImage || (q.passageImages && q.passageImages.length));
  const hasGridGuide = (q.type==='gridin') && !!(q.gridGuideHtml || q.gridGuideImage);
  const needSplit = (q.layout === 'split') || hasPassage || hasGridGuide;

  if(needSplit){
    const wrap = document.createElement('div');
    wrap.className='gridwrap';

    const left = document.createElement('div'); left.className='spr-left';
    if(hasPassage){
      left.innerHTML = getPassageHTML(q);
    }else if(hasGridGuide){
      left.innerHTML = q.gridGuideHtml
        ? injectImages(fmt(q.gridGuideHtml))
        : injectImages(`[[IMAGE: ${q.gridGuideImage}|grid guide]]`);
    }else{
      left.innerHTML = `<div style="color:var(--muted)">No passage</div>`;
    }

    const right = document.createElement('div'); right.className='spr-right';
    const stem = document.createElement('div'); stem.className='qstem';
    stem.innerHTML = injectImages(fmt(q.prompt));
    right.appendChild(stem);

    const area = document.createElement('div'); area.className='choices';
    if(q.type==='mcq'){
      (q.choices||[]).forEach((c,i)=>{
        const row=document.createElement('label'); row.className='choice';
        row.innerHTML = `
          <input type="radio" name="ans" value="${i}" ${String(answers[q.id])===String(i)?'checked':''}/>
          <div class="bubble">${bubbleABC(i)}</div>
          <div class="txt">${c}</div>`;
        if(String(answers[q.id])===String(i)) row.classList.add('selected');
        row.addEventListener('click',()=>{
          answers[q.id]=i; saveState(); renderQuestion(); renderNavButton();
        });
        area.appendChild(row);
      });
    }else{
      const inp=document.createElement('input'); inp.className='gridin';
      inp.placeholder='Enter your answer'; inp.value=answers[q.id]??'';
      inp.oninput=e=>{
        answers[q.id]=e.target.value.trim(); saveState(); renderNavButton();
      };
      area.appendChild(inp);
    }
    right.appendChild(area);

    wrap.appendChild(left); wrap.appendChild(right);
    qc.appendChild(wrap);
  }else{
    const stem = document.createElement('div'); stem.className='qstem';
    stem.innerHTML = injectImages(fmt(q.prompt));
    qc.appendChild(stem);

    const area = document.createElement('div'); area.className='choices';
    if(q.type==='mcq'){
      (q.choices||[]).forEach((c,i)=>{
        const row=document.createElement('label'); row.className='choice';
        row.innerHTML = `
          <input type="radio" name="ans" value="${i}" ${String(answers[q.id])===String(i)?'checked':''}/>
          <div class="bubble">${bubbleABC(i)}</div>
          <div class="txt">${c}</div>`;
        if(String(answers[q.id])===String(i)) row.classList.add('selected');
        row.addEventListener('click',()=>{
          answers[q.id]=i; saveState(); renderQuestion(); renderNavButton();
        });
        area.appendChild(row);
      });
    }else{
      const inp=document.createElement('input'); inp.className='gridin';
      inp.placeholder='Enter your answer'; inp.value=answers[q.id]??'';
      inp.oninput=e=>{
        answers[q.id]=e.target.value.trim(); saveState(); renderNavButton();
      };
      area.appendChild(inp);
    }
    qc.appendChild(area);
  }

  typeset();
  renderNavButton();
}

/* ===== 네비 리본 & 팝업 ===== */
function renderNavButton(){
  const total = totalQ(modIdx);
  $('#navOpen').textContent = `${qIdx+1} / ${total} ▾`;
  const m=SET.modules[modIdx];
  $('#navSection').textContent = sectionLabel(m.section);
  $('#navMod').textContent = (m.module || 1);
}
const navPopup = $('#navPopup');
$('#navOpen').onclick = ()=>{
  if(navPopup.style.display==='block') hideNavPopup();
  else showNavPopup();
};
function showNavPopup(){
  const grid = $('#navGrid'); grid.innerHTML='';
  const list = SET.modules[modIdx].questions;
  list.forEach((q,i)=>{
    const b=document.createElement('button');
    b.className='dot';
    if(i===qIdx) b.classList.add('active');
    if(flags.has(q.id)) b.classList.add('flag');
    if(answers[q.id]!==undefined && answers[q.id]!=='' ) b.classList.add('answered');
    b.textContent=i+1;
    b.onclick=()=>{ qIdx=i; renderQuestion(); showNavPopup(); };
    grid.appendChild(b);
  });
  navPopup.style.display='block';
}
function hideNavPopup(){ navPopup.style.display='none'; }

/* ===== 제출(모듈 경계) ===== */
const confirmBack = $('#confirmBack');
function openSubmitConfirm(){
  const m=SET.modules[modIdx];
  $('#confirmModLabel').textContent = `${sectionLabel(m.section)} — Module ${m.module||1}`;
  confirmBack.style.display='block';
}
$('#confirmCancel').onclick = ()=> confirmBack.style.display='none';
$('#confirmOk').onclick = ()=>{
  confirmBack.style.display='none';
  saveState();
  gotoNextModule();
};

/* ===== Prev/Next 안전 재바인딩 ===== */
function bindPrevNext(){
  const prev = $('#prevBtn');
  const next = $('#nextBtn');
  if(!prev || !next) return;

  const prevClone = prev.cloneNode(true);
  const nextClone = next.cloneNode(true);
  prev.parentNode.replaceChild(prevClone, prev);
  next.parentNode.replaceChild(nextClone, next);

  prevClone.addEventListener('click', (e)=>{
    e.preventDefault(); e.stopPropagation();
    if(qIdx > 0){
      qIdx--; saveState(); renderQuestion();
    }
    hideNavPopup();
  });

  nextClone.addEventListener('click', (e)=>{
    e.preventDefault(); e.stopPropagation();
    const n = totalQ(modIdx);
    if(qIdx < n-1){
      qIdx++; saveState(); renderQuestion(); hideNavPopup();
    }else{
      openSubmitConfirm();
    }
  });
}

/* ===== 채점 ===== */
function gridinEqual(user,q){
  if(user===undefined || user==='') return false;
  if(q.answerNumeric!==undefined){
    const num = Number(user); if(!isNaN(num)){
      const tol = Number(q.tolerance||0);
      if(Math.abs(num-Number(q.answerNumeric))<=tol) return true;
    }
  }
  if(Array.isArray(q.altNumeric)){
    const s=String(user).replace(/\s/g,'');
    return q.altNumeric.some(v=> String(v).replace(/\s/g,'')===s );
  }
  return false;
}
function isCorrect(q){
  if(q.type==='mcq') return Number(answers[q.id])===Number(q.answer);
  return gridinEqual(answers[q.id], q);
}

/* ===== 스킬/인덱스 유틸 ===== */
function getSkillCodes(q){
  const raw = q.skills || q.tags || q.topics || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(s=>String(s).trim()).filter(Boolean);
}
let QINDEX = {};
function buildQIndex(){
  QINDEX = {};
  (SET.modules||[]).forEach((m,mi)=>{
    (m.questions||[]).forEach((q,qi)=>{
      QINDEX[q.id] = { mi, qi, section: (m.section||'').toLowerCase(), module: m.module||1 };
    });
  });
}
function findSimilarQuestions(currentQ, limit=6){
  const target = new Set(getSkillCodes(currentQ));
  if(target.size===0) return [];
  const all = [];
  (SET.modules||[]).forEach((m,mi)=>{
    (m.questions||[]).forEach((q,qi)=>{
      if(q===currentQ) return;
      const skills = new Set(getSkillCodes(q));
      if(skills.size===0) return;
      let overlap=0;
      skills.forEach(s=>{ if(target.has(s)) overlap++; });
      if(overlap>0){
        all.push({ q, mi, qi, module:m.module||1, section:(m.section||'').toLowerCase(), overlap });
      }
    });
  });
  all.sort((a,b)=>{
    if(b.overlap!==a.overlap) return b.overlap-a.overlap;
    if(a.section!==b.section) return a.section.localeCompare(b.section);
    if(a.module!==b.module) return a.module-b.module;
    return a.qi-b.qi;
  });
  return all.slice(0, limit);
}
function openExplainById(qid){
  const loc = QINDEX[qid];
  if(!loc) return;
  const { mi, qi, section, module } = loc;
  const modRec = SET.modules[mi];
  const q = modRec.questions[qi];
  const ok = isCorrect(q);
  openExplain(sectionLabel(section), module, qi+1, q, ok);
}

/* ===== 스킬 요약 카드 ===== */
function buildSkillSummaryCard(minCount){
  const stats = collectSkillStats();
  const entries = Object.entries(stats).map(([code, v])=>({
    code, correct: v.correct, total: v.total, acc: v.total ? v.correct / v.total : 0
  }));
  const eligible = entries.filter(e=> e.total >= minCount).sort((a,b)=> b.acc - a.acc);

  const wrap = document.createElement('div');
  wrap.className = 'qcard';
  const headNote = `<span style="color:var(--muted); font-size:13px">· 최소 ${minCount}문항 기준</span>`;

  if(eligible.length === 0){
    wrap.innerHTML = `
      <div class="result-title"><div><b>Skill Summary</b> ${headNote}</div></div>
      <div style="margin-top:6px; color:var(--muted); font-size:14px">
        스킬 태그가 감지되지 않았습니다. 문항 JSON에 <code>"skills": ["FUNC_LINEAR","RATIO"]</code> 형태로 태그를 추가하면 요약이 표시됩니다.
      </div>`;
    return wrap;
  }

  const strengths = eligible.slice(0,3);
  const weaknesses = eligible.slice(-3).reverse();

  const li = (e)=> `
    <li style="display:flex; justify-content:space-between; gap:10px; border:1px solid var(--line);
               border-radius:10px; padding:8px 10px; background:#fff">
      <span>${e.code}</span>
      <span style="font-variant-numeric:tabular-nums">${Math.round(e.acc*100)}% <span style="color:var(--muted)">(${e.correct}/${e.total})</span></span>
    </li>`;

  wrap.innerHTML = `
    <div class="result-title"><div><b>Skill Summary</b> ${headNote}</div></div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px">
      <div>
        <div style="font-weight:700; color:#065f46; margin-bottom:6px">Top strengths</div>
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">
          ${strengths.map(li).join('')}
        </ul>
      </div>
      <div>
        <div style="font-weight:700; color:#991b1b; margin-bottom:6px">Needs work</div>
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">
          ${weaknesses.map(li).join('')}
        </ul>
      </div>
    </div>`;
  return wrap;
}

/* ===== Progress Card ===== */
function buildProgressCard(baseId, maxSkills=5){
  const { lastBase, lastReview } = getLatestPair(baseId);
  const wrap = document.createElement('div');
  wrap.className = 'qcard';

  if(!lastBase && !lastReview){
    wrap.innerHTML = `
      <div class="result-title"><div><b>Progress</b></div></div>
      <div style="margin-top:6px; color:var(--muted)">기록된 시도가 없습니다.</div>`;
    return wrap;
  }

  const baseAcc = lastBase?.overall?.acc ?? null;
  const revAcc  = lastReview?.overall?.acc ?? null;
  let headerHTML = `<div class="result-title"><div><b>Progress</b></div></div>`;
  if(baseAcc!==null || revAcc!==null){
    const fmtPct = v=> (v===null? '—' : `${Math.round(v*100)}%`);
    const delta = (baseAcc!==null && revAcc!==null) ? Math.round((revAcc-baseAcc)*100) : null;
    const deltaTxt = (delta===null? '' : ` <span style="font-weight:700; color:${delta>=0?'#065f46':'#991b1b'}">(${delta>=0?'+':''}${delta} pp)</span>`);
    headerHTML = `
      <div class="result-title">
        <div><b>Progress</b></div>
        <div style="font-variant-numeric:tabular-nums">
          Base: ${fmtPct(baseAcc)} → Review: ${fmtPct(revAcc)}${deltaTxt}
        </div>
      </div>`;
  }

  const baseSkills = lastBase?.skills || {};
  const revSkills  = lastReview?.skills || {};
  const union = new Set([...Object.keys(baseSkills), ...Object.keys(revSkills)]);
  const changes = [];
  union.forEach(code=>{
    const b = baseSkills[code]?.acc ?? null;
    const r = revSkills[code]?.acc ?? null;
    if(b===null && r===null) return;
    const d = (b!==null && r!==null) ? (r-b) : null;
    changes.push({ code, base:b, review:r, delta:d });
  });

  const improved = changes.filter(x=> x.delta!==null).sort((a,b)=> (b.delta - a.delta)).slice(0, maxSkills);
  const weakNow = changes.filter(x=> x.review!==null).sort((a,b)=> (a.review - b.review)).slice(0, maxSkills);

  const row = (e)=>`
    <li style="display:flex; justify-content:space-between; gap:10px; border:1px solid var(--line); border-radius:10px; padding:8px 10px; background:#fff">
      <span>${e.code}</span>
      <span style="font-variant-numeric:tabular-nums">
        ${e.base===null?'—':Math.round(e.base*100)+'%'}
        →
        ${e.review===null?'—':Math.round(e.review*100)+'%'}
        ${e.delta===null?'':` <b style="color:${e.delta>=0?'#065f46':'#991b1b'}">(${e.delta>=0?'+':''}${Math.round(e.delta*100)/100})</b>`}
      </span>
    </li>`;

  wrap.innerHTML = `
    ${headerHTML}
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px">
      <div>
        <div style="font-weight:700; color:#065f46; margin-bottom:6px">Most improved</div>
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">
          ${improved.length? improved.map(row).join('') : '<li style="color:var(--muted)">데이터 없음</li>'}
        </ul>
      </div>
      <div>
        <div style="font-weight:700; color:#991b1b; margin-bottom:6px">Still weak</div>
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">
          ${weakNow.length? weakNow.map(row).join('') : '<li style="color:var(--muted)">데이터 없음</li>'}
        </ul>
      </div>
    </div>`;
  return wrap;
}

/* ===== Review Session ===== */
function pickReviewQuestions({ mode, skill }){
  const picked = [];
  (SET.modules||[]).forEach((m)=>{
    (m.questions||[]).forEach((q)=>{
      if(mode==='wrong'   && !isCorrect(q)) picked.push({ section:m.section, module:m.module||1, q });
      if(mode==='flagged' && flags.has(q.id)) picked.push({ section:m.section, module:m.module||1, q });
      if(mode==='skill'   && getSkillCodes(q).includes(skill)) picked.push({ section:m.section, module:m.module||1, q });
    });
  });
  return picked;
}
function buildAdHocSet(items, titleNote){
  const bySec = {};
  items.forEach(it=>{
    const key = (it.section||'misc').toLowerCase();
    if(!bySec[key]) bySec[key] = [];
    bySec[key].push(it.q);
  });

  const modules = [];
  Object.entries(bySec).forEach(([sec, arr])=>{
    modules.push({
      section: sec,
      module: 1,
      questions: arr.map((q) => ({ ...q, id: `review:${q.id}` }))
    });
  });

  return {
    metadata: {
      id: `review-${Date.now()}`,
      parentId: (SET?.metadata?.id || SET?.metadata?.title || 'base'),
      title: `${SET.metadata?.title || 'DSAT Practice'} — Review ${titleNote}`,
      directions: 'Review selected items.',
      durationMinutesPerModule: SET.metadata?.durationMinutesPerModule || { rw:[32,32], math:[35,35] },
      curvePreset: SET?.metadata?.curvePreset || null, // 리뷰도 동일 프리셋 사용
      curves: SET?.metadata?.curves || undefined
    },
    modules
  };
}
function startReviewSession({ mode, skill }){
  const items = pickReviewQuestions({ mode, skill });
  if(items.length===0){
    alert('선택 조건에 맞는 문항이 없습니다.');
    return;
  }
  const titleNote = (mode==='skill') ? `(Skill: ${skill})` : `(${mode})`;
  const newSet = buildAdHocSet(items, titleNote);

  SET = newSet;
  SET.__isReviewSession = true;

  flags = new Set();
  answers = {};
  buildQIndex();
  startModule(0);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===== 최종 결과표 & 해설 팝업 ===== */
function showFinalReport(){
  clearInterval(tickId);
  buildQIndex();

  recordAttempt();

  clearState();
  $('#card').style.display='none';
  $('#ribbon').style.display='none';
  hideNavPopup();

  const box = $('#scoreBox'); box.innerHTML='';
  const tool = document.createElement('div');
  tool.className = 'qcard';
  tool.innerHTML = `
  <div class="result-title">
    <div><b>${SET.metadata?.title || 'DSAT Practice'} — Combined Report</b></div>
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
      <select id="reviewTimerMode" class="btn">
        <option value="default">Timer: Default</option>
        <option value="infinite">Timer: ∞ (No limit)</option>
        <option value="custom">Timer: Custom…</option>
      </select>
      <input id="reviewTimerMin" type="number" min="1" max="180" placeholder="min"
             class="btn" style="width:90px; display:none"/>
      <select id="skillFilter" class="btn">
        <option value="">Skill…</option>
      </select>
      <button class="btn" id="reviewSkillBtn">Review Skill</button>
      <button class="btn" id="reviewWrongBtn">Review Wrong</button>
      <button class="btn" id="reviewFlagBtn">Review Flagged</button>
      <button class="btn" id="csvBtn">Download CSV</button>
    </div>
  </div>`;
  box.appendChild(tool);

  // === SAT 환산 점수 카드 ===
  (function renderSATCard(){
    const totals = accumulateSectionTotals();
    const curves = getCurves();

    const rwScaled   = scaledFromCurve(curves.rw,   totals.rw.correct,   totals.rw.total);
    const mathScaled = scaledFromCurve(curves.math, totals.math.correct, totals.math.total);
    const totalSAT   = (isFinite(rwScaled)?rwScaled:0) + (isFinite(mathScaled)?mathScaled:0);

    const usedPreset = SET?.metadata?.curvePreset ?? '—';

    const sat = document.createElement('div');
    sat.className = 'qcard';
    sat.innerHTML = `
      <div class="result-title">
        <div><b>SAT Converted Score</b> <span class="muted" style="font-weight:400">preset: ${usedPreset}</span></div>
        <div style="font-variant-numeric:tabular-nums; font-weight:700; font-size:18px">${totalSAT}</div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px">
        <div style="border:1px solid var(--line); border-radius:10px; padding:8px 10px; background:#fff">
          <div style="font-weight:700; margin-bottom:4px">Reading & Writing</div>
          <div style="font-variant-numeric:tabular-nums">
            Raw: ${totals.rw.correct} / ${totals.rw.total}
            <span style="color:var(--muted)"> · </span>
            Scaled: <b>${rwScaled}</b>
          </div>
        </div>
        <div style="border:1px solid var(--line); border-radius:10px; padding:8px 10px; background:#fff">
          <div style="font-weight:700; margin-bottom:4px">Math</div>
          <div style="font-variant-numeric:tabular-nums">
            Raw: ${totals.math.correct} / ${totals.math.total}
            <span style="color:var(--muted)"> · </span>
            Scaled: <b>${mathScaled}</b>
          </div>
        </div>
      </div>
      <div style="margin-top:8px; color:var(--muted); font-size:12px">
        * 커브는 세트의 <code>metadata.curves</code> 또는 <code>metadata.curvePreset</code>로 제어됩니다.
      </div>
    `;
    box.appendChild(sat);
  })();

  // 진행도 카드
  const baseIdForCompare = SET.__isReviewSession
    ? (SET.metadata?.parentId || 'base')
    : (SET.metadata?.id || SET.metadata?.title || 'base');
  box.appendChild( buildProgressCard(baseIdForCompare, 5) );

  // 스킬 요약
  box.appendChild( buildSkillSummaryCard(2) );

  // CSV
  $('#csvBtn').onclick = downloadCSV;

  // 스킬 드롭다운
  const allSkills = new Set();
  (SET.modules||[]).forEach(m => (m.questions||[]).forEach(q => getSkillCodes(q).forEach(s => allSkills.add(s))));
  const $skill = document.getElementById('skillFilter');
  [...allSkills].sort().forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    $skill.appendChild(opt);
  });

  // 리뷰 타이머 UI
  const $mode = document.getElementById('reviewTimerMode');
  const $min  = document.getElementById('reviewTimerMin');
  if (window.REVIEW_TIMER_PREF) {
    $mode.value = window.REVIEW_TIMER_PREF.mode || 'default';
    if (window.REVIEW_TIMER_PREF.mode === 'custom') {
      $min.style.display = '';
      if (window.REVIEW_TIMER_PREF.minutes) $min.value = window.REVIEW_TIMER_PREF.minutes;
    }
  }
  $mode.addEventListener('change', ()=>{
    if ($mode.value === 'custom') $min.style.display = '';
    else $min.style.display = 'none';
    window.REVIEW_TIMER_PREF = { mode: $mode.value, minutes: Number($min.value)||null };
  });
  $min.addEventListener('input', ()=>{
    window.REVIEW_TIMER_PREF = { mode: $mode.value, minutes: Number($min.value)||null };
  });

  // 리뷰 버튼
  document.getElementById('reviewWrongBtn').onclick = ()=> startReviewSession({ mode:'wrong' });
  document.getElementById('reviewFlagBtn').onclick  = ()=> startReviewSession({ mode:'flagged' });
  document.getElementById('reviewSkillBtn').onclick = ()=>{
    const code = $skill.value;
    if(code) startReviewSession({ mode:'skill', skill:code });
  };

  // 섹션별 정오표
  const groups = {};
  SET.modules.forEach((m,mi)=>{
    const key=(m.section||'misc').toLowerCase();
    if(!groups[key]) groups[key]=[];
    groups[key].push({mi, module:m.module||1, questions:m.questions});
  });
  const order = Object.keys(groups).sort((a,b)=>{
    const rank = k => (k==='rw'?1 : k==='math'?2 : 9);
    return rank(a)-rank(b);
  });

  order.forEach(secKey=>{
    const secName = sectionLabel(secKey);
    const mods = groups[secKey].sort((a,b)=>a.module-b.module);
    let secTotal=0, secCorrect=0;
    const perModule=[];
    mods.forEach(m=>{
      const detail = m.questions.map((q,qi)=>({
        id:q.id, number:qi+1, ok:isCorrect(q), q
      }));
      const corr = detail.filter(d=>d.ok).length;
      perModule.push({module:m.module, total:m.questions.length, correct:corr, detail});
      secTotal += m.questions.length; secCorrect += corr;
    });

    const header = document.createElement('div');
    header.className='qcard';
    header.style.marginTop='10px';
    header.innerHTML = `
      <div class="result-title">
        <div><b>${secName} — Total:</b> ${secCorrect} / ${secTotal}</div>
        <div><span class="badge ok">Correct</span> <span class="badge bad" style="margin-left:8px">Wrong</span></div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px">
        ${perModule.map(pm=>`
          <div class="qcard" style="flex:1; min-width:180px">
            <div><b>Module ${pm.module}</b></div>
            <div style="margin-top:6px">${pm.correct} / ${pm.total}</div>
          </div>`).join('')}
      </div>`;
    box.appendChild(header);

    perModule.forEach(pm=>{
      const wrap=document.createElement('div'); wrap.className='qcard result-section';
      const cells = pm.detail.map(d=>{
        const cls = d.ok ? 'ok' : 'bad';
        const flag = flags.has(d.id) ? ' flag' : '';
        return `<button class="result-dot ${cls}${flag}" data-section="${secKey}" data-module="${pm.module}" data-num="${d.number}" title="${secName} · Module ${pm.module} · Q${d.number}">${d.number}</button>`;
      }).join('');
      wrap.innerHTML = `
        <b>${secName} — Module ${pm.module} · 정오표</b>
        <div class="result-grid" style="margin-top:10px">${cells}</div>`;
      box.appendChild(wrap);
    });
  });

  document.querySelectorAll('.result-dot').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const secKey=btn.getAttribute('data-section');
      const modNo=Number(btn.getAttribute('data-module'));
      const num=Number(btn.getAttribute('data-num'));
      const modRec = SET.modules.find(m => (m.section||'').toLowerCase()===secKey && Number(m.module||1)===modNo);
      if(!modRec) return;
      const mi = SET.modules.indexOf(modRec);
      const q = SET.modules[mi].questions[num-1];
      openExplain(sectionLabel(secKey), modNo, num, q, isCorrect(q));
    });
  });
}

const explainBack = $('#explainBack');
const explainBody = $('#explainBody');
$('#explainClose').onclick = ()=>{ explainBack.style.display='none'; explainBody.innerHTML=''; };

function openExplain(secName, modNo, idx, q, ok){
  const your = answers[q.id];
  const yourDisp = (q.type==='mcq' && your!==undefined) ? q.choices[Number(your)] : (your ?? '');
  const correctDisp = (q.type==='mcq') ? (Array.isArray(q.choices)? q.choices[q.answer] : q.answer) : (q.answerNumeric ?? q.altNumeric?.[0] ?? '');
  const badge = ok?'<span class="badge ok">Correct</span>':'<span class="badge bad">Wrong</span>';

  const passageBlock = (q.passageHtml || q.passage || q.passageText || q.passageImage || (q.passageImages&&q.passageImages.length)) ? `
    <div class="qcard" style="margin-bottom:10px">
      <div style="font-weight:700; margin-bottom:6px">Passage</div>
      <div class="qstem">${getPassageHTML(q)}</div>
    </div>` : '';

  const choicesBlock = (q.type==='mcq')
    ? `<div class="choices" style="margin-top:8px">${q.choices.map((c,i)=>`
        <div class="choice" style="pointer-events:none; ${i===q.answer?'border-color:#b7f4be;background:#e9fbe7':''}">
          <div class="bubble">${bubbleABC(i)}</div><div class="txt">${c}</div>
        </div>`).join('')}</div>`
    : '';

  explainBody.innerHTML = `
    <div style="margin-bottom:8px; font-weight:800">${secName} · Module ${modNo} · Question ${idx} ${badge}</div>
    <div style="margin-bottom:10px; color:var(--muted); font-size:13px">${q.type==='mcq'?'Multiple Choice':'Student-Produced Response'}</div>
    ${passageBlock}
    <div class="qcard" style="margin-bottom:10px">
      <div class="qstem">${injectImages(fmt(q.prompt))}</div>
      ${choicesBlock}
    </div>
    <div class="qcard" style="margin-bottom:10px">
      <div><b>Correct Answer:</b> ${correctDisp}</div>
      <div style="margin-top:6px"><b>Your Answer:</b> ${yourDisp===''||yourDisp===undefined?'<i>(blank)</i>':yourDisp}</div>
    </div>
    ${q.rationale ? `<div class="qcard"><b>Explanation</b><div style="margin-top:6px">${fmt(q.rationale)}</div></div>`:''}
  `;

  const skills = getSkillCodes(q);
  const skillBadges = skills.length
    ? `<div class="skill-badges">${skills.map(s=>`<span class="skill-badge">${s}</span>`).join('')}</div>`
    : `<div class="skill-badges"><span class="skill-badge" style="opacity:.7">NO_SKILLS_TAGGED</span></div>`;
  explainBody.insertAdjacentHTML('afterbegin', skillBadges);

  if (FEATURE_SIMILAR && skills.length){
    const sims = findSimilarQuestions(q, 6);
    const simGrid = sims.length ? `
      <div class="similar-wrap">
        <div style="font-weight:700; margin-bottom:6px">Similar questions by skill overlap</div>
        <div class="similar-grid">
          ${sims.map(({q:qq, mi, qi, section, module})=>{
            const ok2 = isCorrect(qq);
            const cls = ok2 ? 'similar-ok' : 'similar-bad';
            const label = `${sectionLabel(section)} · M${module} · Q${qi+1}`;
            const skillsTxt = getSkillCodes(qq).join(', ');
            return `
              <button class="similar-card ${cls}" data-qid="${qq.id}" title="${label}">
                <div style="font-weight:700; margin-bottom:4px">${label}</div>
                <div class="similar-meta">${skillsTxt || 'NO_SKILLS'}</div>
              </button>`;
          }).join('')}
        </div>
      </div>` : `<div class="similar-wrap" style="color:var(--muted); font-size:13px">추천 문항이 아직 없습니다.</div>`;
    explainBody.insertAdjacentHTML('beforeend', simGrid);
    explainBody.querySelectorAll('.similar-card').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const qid = btn.getAttribute('data-qid');
        openExplainById(qid);
      });
    });
  }

  explainBack.style.display='block';
  typeset();
}

/* ===== 수동 로드/파일 로드 ===== */
$('#loadBtn').onclick=()=>loadSet($('#path').value);
$('#hideBtn').onclick=()=>{ const w=$('.wrap'); w.style.display = w.style.display==='none'?'block':'none'; };

async function loadSetFromFile(file){
  try{
    const text = await file.text();
    SET = JSON.parse(text);
    $('#loadError').style.display='none';
    rememberLastSet({ type:'blob', value:text });

    afterSetLoaded();
  }catch(e){
    $('#loadError').textContent = `파일 로드 실패: ${e.message}`;
    $('#loadError').style.display='block';
  }
}
$('#file').addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  if(f) loadSetFromFile(f);
});

/* ===== CSV ===== */
function csvEscape(v){
  const s = (v===undefined || v===null) ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}
function userAnswerDisplay(q){
  const your = answers[q.id];
  if(q.type==='mcq'){
    if(your===undefined || your==='') return '';
    const idx = Number(your);
    const txt = Array.isArray(q.choices) ? q.choices[idx] : '';
    return `${"ABCD".charAt(idx)}. ${txt??''}`;
  }
  return your ?? '';
}
function correctAnswerDisplay(q){
  if(q.type==='mcq'){
    const txt = Array.isArray(q.choices) ? q.choices[q.answer] : q.answer;
    return `${"ABCD".charAt(Number(q.answer))}. ${txt??''}`;
  }
  return (q.answerNumeric ?? (Array.isArray(q.altNumeric)? q.altNumeric[0] : '')) ?? '';
}
function buildCSV(){
  const header = ['Section','Module','Number','QuestionID','Type','Correct','YourAnswer','CorrectAnswer','Flagged'];
  const rows = [header];

  const groups = {};
  SET.modules.forEach((m,mi)=>{
    const key=(m.section||'misc').toLowerCase();
    if(!groups[key]) groups[key]=[];
    groups[key].push({mi, module:m.module||1, questions:m.questions});
  });
  const order = Object.keys(groups).sort((a,b)=>{
    const rank = k => (k==='rw'?1 : k==='math'?2 : 9);
    return rank(a)-rank(b);
  });

  order.forEach(secKey=>{
    const secName = sectionLabel(secKey);
    const mods = groups[secKey].sort((a,b)=>a.module-b.module);
    mods.forEach(m=>{
      m.questions.forEach((q,qi)=>{
        rows.push([
          secName,
          m.module,
          qi+1,
          q.id,
          q.type,
          isCorrect(q) ? 'Y' : 'N',
          userAnswerDisplay(q),
          correctAnswerDisplay(q),
          flags.has(q.id) ? 'Y' : 'N'
        ]);
      });
    });
  });

  return rows.map(r=> r.map(csvEscape).join(',')).join('\r\n');
}
function downloadCSV(){
  const csv = buildCSV();
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const base = (SET.metadata?.title || 'dsat_set').replace(/[^\w\-]+/g,'_');
  a.download = `${base}_results.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===== 팝업 외부 클릭 닫기 ===== */
document.addEventListener('click', (e)=>{
  if(!$('#navPopup').contains(e.target) && e.target!==$('#navOpen')) hideNavPopup();
});

/* 쿼리로 리뷰 자동 시작 */
function maybeStartReviewFromQuery(){
  const qs = new URLSearchParams(location.search);
  const mode = qs.get('review');             // 'skill' | 'wrong' | 'flagged'
  const value = qs.get('value');             // mode==='skill'일 때 스킬 코드
  if(!mode) return;
  setTimeout(()=>{
    if(mode==='skill' && value){
      startReviewSession({ mode:'skill', skill:value });
    }else if(mode==='wrong'){
      startReviewSession({ mode:'wrong' });
    }else if(mode==='flagged'){
      startReviewSession({ mode:'flagged' });
    }
  }, 50);
}

/* ===== 부트스트랩 ===== */
window.addEventListener('DOMContentLoaded', ()=>{
  // ✅ 로컬 Attempt 레코드 스펙 보정
  migrateLocalAttemptsOnce();

  const qs = new URLSearchParams(location.search);
  const url = qs.get('set');
  const src = qs.get('source');

  if (url) {
    $('#path').value = url;
    document.getElementById('loaderRow').style.display='none';
    loadSet(url);
  } else if (src === 'blob') {
    document.getElementById('loaderRow').style.display='none';
    bootFromBlob();
  } else {
    // 대시보드에서 돌아왔을 때 자동 복원
    const last = tryLoadLastSetMeta();
    if (last) {
      document.getElementById('loaderRow').style.display='none';
      if (last.type === 'url' && last.value) {
        loadSet(last.value);
      } else if (last.type === 'blob' && last.value) {
        // landing 없이 직접 파싱
        try{
          SET = JSON.parse(last.value);
          afterSetLoaded();
        }catch(_e){
          // 실패 시 로더 노출
          document.getElementById('loaderRow').style.display='';
        }
      } else {
        // 포맷 불명 → 로더 노출
        document.getElementById('loaderRow').style.display='';
      }
    }
  }

  // Prev/Next 초기 바인딩
  bindPrevNext();

  // 쿼리 기반 리뷰 자동 시작
  maybeStartReviewFromQuery();
});
