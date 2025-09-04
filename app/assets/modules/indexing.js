// Question indexing and similarity
var QINDEX = window.QINDEX || {};
var getSkillCodes = window.getSkillCodes || function(q){
  const raw = q.skills || q.tags || q.topics || [];
  if (!Array.isArray(raw)) return [];
  return raw.map(s=>String(s).trim()).filter(Boolean);
}; window.getSkillCodes = getSkillCodes; window.QINDEX = QINDEX;
var buildQIndex = window.buildQIndex || function(){
  QINDEX = {};
  (SET.modules||[]).forEach((m,mi)=>{
    (m.questions||[]).forEach((q,qi)=>{
      QINDEX[q.id] = { mi, qi, section: (m.section||'').toLowerCase(), module: m.module||1 };
    });
  });
}; window.buildQIndex = buildQIndex;
var findSimilarQuestions = window.findSimilarQuestions || function(currentQ, limit=6){
  const target = new Set(getSkillCodes(currentQ));
  if(target.size===0) return [];
  const all = [];
  (SET.modules||[]).forEach((m,mi)=>{
    (m.questions||[]).forEach((q,qi)=>{
      if(q===currentQ) return;
      const skills = new Set(getSkillCodes(q));
      if(skills.size===0) return;
      let overlap=0; skills.forEach(s=>{ if(target.has(s)) overlap++; });
      if(overlap>0){ all.push({ q, mi, qi, section:(m.section||'').toLowerCase(), module:m.module||1, overlap }); }
    });
  });
  all.sort((a,b)=> b.overlap - a.overlap);
  return all.slice(0, limit);
}; window.findSimilarQuestions = findSimilarQuestions;
