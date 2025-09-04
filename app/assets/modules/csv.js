// CSV export helpers

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
  SET.modules.forEach((m,mi)=>{ const key=(m.section||'misc').toLowerCase(); if(!groups[key]) groups[key]=[]; groups[key].push({mi, module:m.module||1, questions:m.questions}); });
  const order = Object.keys(groups).sort((a,b)=>{ const rank = k => (k==='rw'?1 : k==='math'?2 : 9); return rank(a)-rank(b); });
  order.forEach(secKey=>{ const secName = sectionLabel(secKey); const mods = groups[secKey].sort((a,b)=>a.module-b.module);
    mods.forEach(m=>{ m.questions.forEach((q,qi)=>{ rows.push([ secName, m.module, qi+1, q.id, q.type, isCorrect(q) ? 'Y' : 'N', userAnswerDisplay(q), correctAnswerDisplay(q), flags.has(q.id) ? 'Y' : 'N' ]); }); });
  });
  return rows.map(r=> r.map(csvEscape).join(',')).join('\r\n');
}
function downloadCSV(){
  const csv = buildCSV();
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  const base = (SET.metadata?.title || 'dsat_set').replace(/[^\w\-]+/g,'_'); a.download = `${base}_results.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
window.downloadCSV = downloadCSV;

