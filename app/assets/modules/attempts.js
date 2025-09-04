// Local attempt storage and summaries
const ATTEMPT_KEY = 'dsat_attempts_v1';

var loadAttempts = window.loadAttempts || function(){ try{ return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '[]'); }catch(_e){ return []; } };
var saveAttempts = window.saveAttempts || function(arr){ try{ localStorage.setItem(ATTEMPT_KEY, JSON.stringify(arr)); }catch(_e){} };
window.loadAttempts = loadAttempts; window.saveAttempts = saveAttempts;

var uuid4 = window.uuid4 || function(){
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}; window.uuid4 = uuid4;

var migrateLocalAttemptsOnce = window.migrateLocalAttemptsOnce || function(){
  const arr = loadAttempts();
  let changed = false;
  for(const a of arr){
    if(!a.id){ a.id = (typeof uuid4==='function'?uuid4():null) || (Date.now()+"-"+Math.random()); changed = true; }
    if(!a.updatedAt){ a.updatedAt = a.ts || Date.now(); changed = true; }
    if(a._dirty === undefined){ a._dirty = false; changed = true; }
    if(!a.version){ a.version = 1; changed = true; }
  }
  if(changed) saveAttempts(arr);
}; window.migrateLocalAttemptsOnce = migrateLocalAttemptsOnce;

var overallTotals = window.overallTotals || function(){
  let total=0, correct=0;
  (SET.modules||[]).forEach(m=>{
    (m.questions||[]).forEach(q=>{
      total += 1; if(isCorrect(q)) correct += 1;
    });
  });
  return { total, correct, acc: total? correct/total : 0 };
}; window.overallTotals = overallTotals;
var getSkillCodes = window.getSkillCodes || function(q){
  const raw = q.skills || q.tags || q.topics || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(s=>String(s).trim()).filter(Boolean);
}; window.getSkillCodes = getSkillCodes;
var collectSkillStats = window.collectSkillStats || function(){
  const stats = {};
  (SET.modules || []).forEach(m=>{
    (m.questions || []).forEach(q=>{
      const codes = getSkillCodes(q);
      if(!codes.length) return;
      const ok = isCorrect(q);
      codes.forEach(code=>{
        if(!stats[code]) stats[code] = {correct:0,total:0};
        stats[code].total += 1; if(ok) stats[code].correct += 1;
      });
    });
  });
  return stats;
}; window.collectSkillStats = collectSkillStats;
var summarizeSkills = window.summarizeSkills || function(){
  const stats = collectSkillStats();
  const bySkill = {};
  Object.entries(stats).forEach(([code, v])=>{
    bySkill[code] = { correct:v.correct, total:v.total, acc: v.total? v.correct/v.total : 0 };
  });
  return bySkill;
}; window.summarizeSkills = summarizeSkills;

var recordAttempt = window.recordAttempt || function(){
  const isReview = !!SET.__isReviewSession;
  const baseId = isReview
    ? (SET.metadata?.parentId || 'base')
    : (SET.metadata?.id || SET.metadata?.title || 'base');

  const totals = accumulateSectionTotals();
  const usedPreset = SET?.metadata?.curvePreset ?? null;
  let userId = null; try { const cfg = JSON.parse(localStorage.getItem('dsat_sync_config_v1') || '{}'); userId = cfg.userId || null; } catch(_) {}
  const now = Date.now();
  const attemptId = `loc_${userId||'u'}_${(baseId||'base').replace(/[^\w-]+/g,'_')}_${isReview?'review':'base'}_${now}`;

  const attempt = {
    id: attemptId,
    ts: now,
    updatedAt: now,
    userId: userId || undefined,
    baseId,
    kind: isReview ? 'review' : 'base',
    title: SET.metadata?.title || '',
    mode: SET.__runMode || (typeof getRunMode==='function'?getRunMode():'full'),
    sections: {
      rw:   { correct: totals.rw.correct,   total: totals.rw.total   },
      math: { correct: totals.math.correct, total: totals.math.total }
    },
    skills: summarizeSkills(),
    curvePreset: usedPreset,
    _dirty: true,
    _remoteId: null,
    _lastPushedAt: null
  };
  const list = loadAttempts(); list.push(attempt); saveAttempts(list);
  return attempt;
}; window.recordAttempt = recordAttempt;

var getLatestPair = window.getLatestPair || function(baseId){
  const list = loadAttempts().filter(a=> a.baseId===baseId);
  let lastBase=null, lastReview=null;
  list.sort((a,b)=> b.ts - a.ts).forEach(a=>{
    if(a.kind==='base'   && !lastBase)   lastBase = a;
    if(a.kind==='review' && !lastReview) lastReview = a;
  });
  return { lastBase, lastReview };
}; window.getLatestPair = getLatestPair;

var saveAttemptToLocal = window.saveAttemptToLocal || function(attempt){
  const a = {
    id: attempt.id || undefined,
    userId: DSAT_SYNC?.getConfig?.().userId || 'u-demo',
    baseId: attempt.baseId,
    title: attempt.title,
    kind: attempt.kind || 'base',
    mode: attempt.mode || (qp('only')||'full'),
    ts: attempt.ts || Date.now(),
    updatedAt: Date.now(),
    sections: {
      rw:   { correct: attempt.rwCorrect,   total: attempt.rwTotal },
      math: { correct: attempt.mathCorrect, total: attempt.mathTotal },
    },
    curvePreset: attempt.curvePreset || (window.SET?.metadata?.curvePreset) || 'default',
    skills: attempt.skills || {},
    _dirty: true
  };
  const arr = (()=>{ try{ return JSON.parse(localStorage.getItem(ATTEMPT_KEY)||'[]'); }catch(_){ return []; }})();
  arr.push(a); try{ localStorage.setItem(ATTEMPT_KEY, JSON.stringify(arr)); }catch(_){ }
}; window.saveAttemptToLocal = saveAttemptToLocal;
