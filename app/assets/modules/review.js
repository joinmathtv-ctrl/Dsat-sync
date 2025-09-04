// Review, final report, and explanations

const explainBack = document.getElementById('explainBack');
const explainBody = document.getElementById('explainBody');
if (document.getElementById('explainClose')){
  document.getElementById('explainClose').onclick = ()=>{ if(explainBack&&explainBody){ explainBack.style.display='none'; explainBody.innerHTML=''; } };
}

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
  if (!explainBody || !explainBack) return;
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
      </div>` : `<div class="similar-wrap" style="color:var(--muted); font-size:13px">No recommendations yet.</div>`;
    explainBody.insertAdjacentHTML('beforeend', simGrid);
    explainBody.querySelectorAll('.similar-card').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const qid = btn.getAttribute('data-qid');
        openExplainById(qid);
      });
    });
  }
  explainBack.style.display='block'; typeset();
}

function openExplainById(qid){
  const loc = QINDEX[qid]; if(!loc) return;
  const { mi, qi, section, module } = loc;
  const modRec = SET.modules[mi]; const q = modRec.questions[qi];
  const ok = isCorrect(q);
  openExplain(sectionLabel(section), module, qi+1, q, ok);
}
window.openExplainById = openExplainById;

function buildSkillSummaryCard(minCount){
  const stats = collectSkillStats();
  const entries = Object.entries(stats).map(([code, v])=>({ code, correct: v.correct, total: v.total, acc: v.total ? v.correct / v.total : 0 }));
  const eligible = entries.filter(e=> e.total >= minCount).sort((a,b)=> b.acc - a.acc);
  const wrap = document.createElement('div'); wrap.className = 'qcard';
  const headNote = `<span style="color:var(--muted); font-size:13px">· min ${minCount} questions</span>`;
  if(eligible.length === 0){
    wrap.innerHTML = `
      <div class="result-title"><div><b>Skill Summary</b> ${headNote}</div></div>
      <div style="margin-top:6px; color:var(--muted); font-size:14px">
        No skill tags detected. Add tags in your JSON like <code>"skills": ["FUNC_LINEAR","RATIO"]</code> to enable this summary.
      </div>`; return wrap;
  }
  const strengths = eligible.slice(0,3); const weaknesses = eligible.slice(-3).reverse();
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
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">${strengths.map(li).join('')}</ul>
      </div>
      <div>
        <div style="font-weight:700; color:#991b1b; margin-bottom:6px">Needs work</div>
        <ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">${weaknesses.map(li).join('')}</ul>
      </div>
    </div>`; return wrap;
}

function buildProgressCard(baseId, maxSkills=5){
  const { lastBase, lastReview } = getLatestPair(baseId);
  const wrap = document.createElement('div'); wrap.className = 'qcard';
  if(!lastBase && !lastReview){ wrap.innerHTML = `<div class="result-title"><div><b>Progress</b></div></div><div style="margin-top:6px; color:var(--muted)">No attempts recorded.</div>`; return wrap; }
  const baseAcc = lastBase?.overall?.acc ?? null; const revAcc  = lastReview?.overall?.acc ?? null;
  let headerHTML = `<div class="result-title"><div><b>Progress</b></div></div>`;
  if(baseAcc!==null || revAcc!==null){
    const fmtPct = v=> (v===null? '—' : `${Math.round(v*100)}%`);
    const delta = (baseAcc!==null && revAcc!==null) ? Math.round((revAcc-baseAcc)*100) : null;
    const deltaTxt = (delta===null? '' : ` <span style="font-weight:700; color:${delta>=0?'#065f46':'#991b1b'}">(${delta>=0?'+':''}${delta} pp)</span>`);
    headerHTML = `<div class="result-title"><div><b>Progress</b></div><div style="font-variant-numeric:tabular-nums">Base: ${fmtPct(baseAcc)} · Review: ${fmtPct(revAcc)}${deltaTxt}</div></div>`;
  }
  const baseSkills = lastBase?.skills || {}; const revSkills  = lastReview?.skills || {};
  const union = new Set([...Object.keys(baseSkills), ...Object.keys(revSkills)]);
  const changes = [];
  union.forEach(code=>{ const b = baseSkills[code]?.acc ?? null; const r = revSkills[code]?.acc ?? null; if(b===null && r===null) return; const d = (b!==null && r!==null) ? (r-b) : null; changes.push({ code, base:b, review:r, delta:d }); });
  const improved = changes.filter(x=> x.delta!==null).sort((a,b)=> (b.delta - a.delta)).slice(0, maxSkills);
  const weakNow = changes.filter(x=> x.review!==null).sort((a,b)=> (a.review - b.review)).slice(0, maxSkills);
  const row = (e)=>`
    <li style="display:flex; justify-content:space-between; gap:10px; border:1px solid var(--line); border-radius:10px; padding:8px 10px; background:#fff">
      <span>${e.code}</span>
      <span style="font-variant-numeric:tabular-nums">${e.base===null?'—':Math.round(e.base*100)+'%'} · ${e.review===null?'—':Math.round(e.review*100)+'%'}${e.delta===null?'':` <b style="color:${e.delta>=0?'#065f46':'#991b1b'}">(${e.delta>=0?'+':''}${Math.round(e.delta*100)/100})</b>`}</span>
    </li>`;
  wrap.innerHTML = `${headerHTML}<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:10px"><div><div style="font-weight:700; color:#065f46; margin-bottom:6px">Most improved</div><ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">${improved.length? improved.map(row).join('') : '<li style="color:var(--muted)">No data</li>'}</ul></div><div><div style="font-weight:700; color:#991b1b; margin-bottom:6px">Still weak</div><ul style="list-style:none; margin:0; padding:0; display:grid; gap:6px">${weakNow.length? weakNow.map(row).join('') : '<li style="color:var(--muted)">No data</li>'}</ul></div></div>`; return wrap;
}

function pickReviewQuestions({ mode, skill }){
  const picked = [];
  (SET.modules||[]).forEach((m)=>{ (m.questions||[]).forEach((q)=>{
    if(mode==='wrong'   && !isCorrect(q)) picked.push({ section:m.section, module:m.module||1, q });
    if(mode==='flagged' && flags.has(q.id)) picked.push({ section:m.section, module:m.module||1, q });
    if(mode==='skill'   && getSkillCodes(q).includes(skill)) picked.push({ section:m.section, module:m.module||1, q });
  }); }); return picked;
}

function buildAdHocSet(items, titleNote){
  const bySec = {}; items.forEach(it=>{ const key = (it.section||'misc').toLowerCase(); if(!bySec[key]) bySec[key] = []; bySec[key].push(it.q); });
  const modules = []; Object.entries(bySec).forEach(([sec, arr])=>{ modules.push({ section: sec, module: 1, questions: arr.map((q) => ({ ...q, id: `review:${q.id}` })) }); });
  return { metadata: { id: `review-${Date.now()}`, parentId: (SET?.metadata?.id || SET?.metadata?.title || 'base'), title: `${SET.metadata?.title || 'DSAT Practice'} · Review ${titleNote}`, directions: 'Review selected items.', durationMinutesPerModule: SET.metadata?.durationMinutesPerModule || { rw:[32,32], math:[35,35] }, curvePreset: SET?.metadata?.curvePreset || null, curves: SET?.metadata?.curves || undefined }, modules };
}

function startReviewSession({ mode, skill }){
  const items = pickReviewQuestions({ mode, skill }); if(items.length===0){ alert('No items match the selected condition.'); return; }
  const titleNote = (mode==='skill') ? `(Skill: ${skill})` : `(${mode})`;
  const newSet = buildAdHocSet(items, titleNote);
  SET = newSet; SET.__isReviewSession = true; SET.__runMode = 'full';
  flags = new Set(); answers = {}; buildQIndex(); startModule(0); window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.startReviewSession = startReviewSession;

function showFinalReport(){
  clearInterval(tickId); buildQIndex(); recordAttempt(); clearState();
  $('#card').style.display='none'; $('#ribbon').style.display='none'; hideNavPopup();
  const box = $('#scoreBox'); box.innerHTML='';
  const tool = document.createElement('div'); tool.className = 'qcard'; tool.innerHTML = `
  <div class="result-title">
    <div><b>${SET.metadata?.title || 'DSAT Practice'} · Combined Report</b></div>
    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
      <select id="reviewTimerMode" class="btn">
        <option value="default">Timer: Default</option>
        <option value="infinite">Timer: ∞ (No limit)</option>
        <option value="custom">Timer: Custom</option>
      </select>
      <input id="reviewTimerMin" type="number" min="1" max="180" placeholder="min" class="btn" style="width:90px; display:none"/>
      <select id="skillFilter" class="btn"><option value="">Skill</option></select>
      <button class="btn" id="reviewSkillBtn">Review Skill</button>
      <button class="btn" id="reviewWrongBtn">Review Wrong</button>
      <button class="btn" id="reviewFlagBtn">Review Flagged</button>
      <button class="btn" id="csvBtn">Download CSV</button>
    </div>
  </div>`; box.appendChild(tool);

  // SAT score card
  (function renderSATCard(){
    const totals = accumulateSectionTotals(); const curves = getCurves(); const mode = SET.__runMode || getRunMode();
    const rwScaled   = totals.rw.total   ? scaledFromCurve(curves.rw,   totals.rw.correct,   totals.rw.total)   : null;
    const mathScaled = totals.math.total ? scaledFromCurve(curves.math, totals.math.correct, totals.math.total) : null;
    let totalSAT = '—'; if (mode === 'full' && rwScaled!==null && mathScaled!==null) { totalSAT = (rwScaled + mathScaled); }
    const usedPreset = SET?.metadata?.curvePreset ?? '—';
    const sat = document.createElement('div'); sat.className = 'qcard';
    const rwBlock = `<div style="border:1px solid var(--line); border-radius:10px; padding:8px 10px; background:#fff"><div style="font-weight:700; margin-bottom:4px">Reading & Writing</div><div style="font-variant-numeric:tabular-nums">Raw: ${totals.rw.correct} / ${totals.rw.total}<span style="color:var(--muted)"> · </span>Scaled: <b>${rwScaled===null?'—':rwScaled}</b></div></div>`;
    const mathBlock = `<div style="border:1px solid var(--line); border-radius:10px; padding:8px 10px; background:#fff"><div style="font-weight:700; margin-bottom:4px">Math</div><div style="font-variant-numeric:tabular-nums">Raw: ${totals.math.correct} / ${totals.math.total}<span style="color:var(--muted)"> · </span>Scaled: <b>${mathScaled===null?'—':mathScaled}</b></div></div>`;
    let gridHTML = '';
    if (mode === 'rw') gridHTML = `<div style="display:grid; grid-template-columns:1fr; gap:12px; margin-top:8px">${rwBlock}</div>`;
    else if (mode === 'math') gridHTML = `<div style="display:grid; grid-template-columns:1fr; gap:12px; margin-top:8px">${mathBlock}</div>`;
    else gridHTML = `<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:8px">${rwBlock}${mathBlock}</div>`;
    sat.innerHTML = `<div class="result-title"><div><b>SAT Converted Score</b> <span class="muted" style="font-weight:400">preset: ${usedPreset}</span></div><div style="font-variant-numeric:tabular-nums; font-weight:700; font-size:18px">${totalSAT}</div></div>${gridHTML}<div style="margin-top:8px; color:var(--muted); font-size:12px">* Display depends on mode (${mode}). Total is computed only in Full mode.</div>`;
    box.appendChild(sat);
  })();

  const baseIdForCompare = SET.__isReviewSession ? (SET.metadata?.parentId || 'base') : (SET.metadata?.id || SET.metadata?.title || 'base');
  box.appendChild( buildProgressCard(baseIdForCompare, 5) );
  box.appendChild( buildSkillSummaryCard(2) );

  document.getElementById('csvBtn').onclick = downloadCSV;

  const allSkills = new Set(); (SET.modules||[]).forEach(m => (m.questions||[]).forEach(q => getSkillCodes(q).forEach(s => allSkills.add(s))));
  const $skill = document.getElementById('skillFilter'); [...allSkills].sort().forEach(s=>{ const opt = document.createElement('option'); opt.value = s; opt.textContent = s; $skill.appendChild(opt); });

  const $mode = document.getElementById('reviewTimerMode'); const $min  = document.getElementById('reviewTimerMin');
  if (window.REVIEW_TIMER_PREF) { $mode.value = window.REVIEW_TIMER_PREF.mode || 'default'; if (window.REVIEW_TIMER_PREF.mode === 'custom') { $min.style.display = ''; if (window.REVIEW_TIMER_PREF.minutes) $min.value = window.REVIEW_TIMER_PREF.minutes; } }
  $mode.addEventListener('change', ()=>{ if ($mode.value === 'custom') $min.style.display = ''; else $min.style.display = 'none'; window.REVIEW_TIMER_PREF = { mode: $mode.value, minutes: Number($min.value)||null }; });
  $min.addEventListener('input', ()=>{ window.REVIEW_TIMER_PREF = { mode: $mode.value, minutes: Number($min.value)||null }; });
  document.getElementById('reviewWrongBtn').onclick = ()=> startReviewSession({ mode:'wrong' });
  document.getElementById('reviewFlagBtn').onclick  = ()=> startReviewSession({ mode:'flagged' });
  document.getElementById('reviewSkillBtn').onclick = ()=>{ const code = $skill.value; if(code) startReviewSession({ mode:'skill', skill:code }); };
}
window.showFinalReport = showFinalReport;

