<script>
// app/assets/review.enhance.js
(function(){
  function safeNum(n){ n = Number(n); return Number.isFinite(n)?n:0; }
  function countModule(m){
    // 우선순위: 모듈 합계 필드 → 질문 배열 스캔
    const total = safeNum(m.total ?? (Array.isArray(m.questions)? m.questions.length: 0));
    let correct = safeNum(m.correct ?? 0);
    if (!m.correct && Array.isArray(m.questions)){
      correct = m.questions.reduce((acc,q)=>{
        if (q==null) return acc;
        // 다양한 스키마 방어
        if (q.correct===true || q.isCorrect===true || q.ok===true) return acc+1;
        if (q.userAnswer!=null && q.answer!=null && String(q.userAnswer)===String(q.answer)) return acc+1;
        if (q.score===1) return acc+1;
        return acc;
      },0);
    }
    return {correct,total};
  }
  function summarizeBySectionModule(attempt){
    const out = {
      RW: { M1:{correct:0,total:0}, M2:{correct:0,total:0} },
      Math:{ M1:{correct:0,total:0}, M2:{correct:0,total:0} }
    };
    try{
      (attempt.sections||[]).forEach(sec=>{
        const secName = (sec.name||sec.section||'').toLowerCase();
        const secKey = secName.includes('math') ? 'Math' : 'RW';
        const modules = sec.modules||[];
        modules.forEach((m,idx)=>{
          const mk = (m.module||m.mod||idx+1)==2 ? 'M2' : 'M1';
          const {correct,total} = countModule(m);
          out[secKey][mk].correct += correct;
          out[secKey][mk].total   += total;
        });
      });
    }catch{}
    return out;
  }
  function renderBreakdown(attempt, mountId){
    const box = document.getElementById(mountId||'scoreBox') || document.body;
    const sum = summarizeBySectionModule(attempt);
    const cell = (c,t)=> `${c}/${t} (${t?Math.round(c*100/t):0}%)`;
    const html = `
      <div class="card" style="margin-top:12px;border:1px solid #e5e7eb;border-radius:12px;padding:12px">
        <div style="font-weight:700;margin-bottom:8px">Section / Module Breakdown</div>
        <table style="width:100%;border-collapse:collapse">
          <thead style="background:#f9fafb">
            <tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb">Section</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb">Module 1</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb">Module 2</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">Reading &amp; Writing</td>
              <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${cell(sum.RW.M1.correct,sum.RW.M1.total)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">${cell(sum.RW.M2.correct,sum.RW.M2.total)}</td>
            </tr>
            <tr>
              <td style="padding:6px 8px">Math</td>
              <td style="padding:6px 8px">${cell(sum.Math.M1.correct,sum.Math.M1.total)}</td>
              <td style="padding:6px 8px">${cell(sum.Math.M2.correct,sum.Math.M2.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>`;
    // 중복 렌더 방지
    const markerId = 'sm-breakdown-card';
    let old = document.getElementById(markerId);
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = markerId;
    wrap.innerHTML = html;
    box.appendChild(wrap);
  }

  // 전역 노출(수동 호출 가능)
  window.renderSectionModuleBreakdown = renderBreakdown;

  // 기존 최종 리포트 함수를 감싸 자동 추가(있을 때만)
  const knownNames = ['showFinalReport','renderFinalReview','renderCombinedReport'];
  for (const name of knownNames){
    const fn = window[name];
    if (typeof fn === 'function'){
      window[name] = function(attempt, ...rest){
        const ret = fn.apply(this, [attempt, ...rest]);
        try{ renderBreakdown(attempt, 'scoreBox'); }catch(e){ console.warn('SM breakdown render failed:', e); }
        return ret;
      };
      break;
    }
  }
})();
</script>
