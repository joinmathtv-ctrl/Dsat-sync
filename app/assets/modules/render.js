// Rendering and navigation

function totalQ(mod){ return SET.modules[mod].questions.length; }
function currentQ(){ return SET.modules[modIdx].questions[qIdx]; }

function getPassageHTML(q){
  const base = q.passageHtml || q.passage || q.passageText || "";
  const imgOne = q.passageImage ? `[[IMAGE: ${q.passageImage}]]` : "";
  const imgMany = Array.isArray(q.passageImages)
    ? q.passageImages.map(fn=>`[[IMAGE: ${fn}]]`).join("<br>")
    : "";
  const all = base + (imgOne || imgMany ? `<div>${imgOne}${imgMany}</div>` : "");
  return injectImages(fmt(all));
}

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
window.isCorrect = window.isCorrect || isCorrect;

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
    if(hasPassage){ left.innerHTML = getPassageHTML(q); }
    else if(hasGridGuide){
      left.innerHTML = q.gridGuideHtml
        ? injectImages(fmt(q.gridGuideHtml))
        : injectImages(`[[IMAGE: ${q.gridGuideImage}|grid guide]]`);
    }else{ left.innerHTML = `<div style="color:var(--muted)">No passage</div>`; }

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
      inp.oninput=e=>{ answers[q.id]=e.target.value.trim(); saveState(); renderNavButton(); };
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
        row.addEventListener('click',()=>{ answers[q.id]=i; saveState(); renderQuestion(); renderNavButton(); });
        area.appendChild(row);
      });
    }else{
      const inp=document.createElement('input'); inp.className='gridin';
      inp.placeholder='Enter your answer'; inp.value=answers[q.id]??'';
      inp.oninput=e=>{ answers[q.id]=e.target.value.trim(); saveState(); renderNavButton(); };
      area.appendChild(inp);
    }
    qc.appendChild(area);
  }

  typeset();
  renderNavButton();
}

function renderNavButton(){
  const total = totalQ(modIdx);
  $('#navOpen').textContent = `${qIdx+1} / ${total}`;
  const m=SET.modules[modIdx];
  $('#navSection').textContent = sectionLabel(m.section);
  $('#navMod').textContent = (m.module || 1);
}

let navPopup = null;
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
function hideNavPopup(){ if (navPopup) navPopup.style.display='none'; }
window.hideNavPopup = hideNavPopup;

function openSubmitConfirm(){
  const m=SET.modules[modIdx];
  $('#confirmModLabel').textContent = `${sectionLabel(m.section)} · Module ${m.module||1}`;
  $('#confirmBack').style.display='block';
}

function bindPrevNext(){
  const prev = $('#prevBtn'); const next = $('#nextBtn'); if(!prev || !next) return;
  const prevClone = prev.cloneNode(true); const nextClone = next.cloneNode(true);
  prev.parentNode.replaceChild(prevClone, prev); next.parentNode.replaceChild(nextClone, next);
  prevClone.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); if(qIdx > 0){ qIdx--; saveState(); renderQuestion(); } hideNavPopup(); });
  nextClone.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); const n = totalQ(modIdx); if(qIdx < n-1){ qIdx++; saveState(); renderQuestion(); hideNavPopup(); } else { openSubmitConfirm(); } });
}
window.bindPrevNext = bindPrevNext;

function bindRenderUI(){
  navPopup = $('#navPopup');
  const navOpen = $('#navOpen');
  if (navOpen){ navOpen.onclick = ()=>{ if(navPopup.style.display==='block') hideNavPopup(); else showNavPopup(); }; }
  const cancel = $('#confirmCancel'); const ok = $('#confirmOk');
  if (cancel) cancel.onclick = ()=> $('#confirmBack').style.display='none';
  if (ok) ok.onclick = ()=>{ $('#confirmBack').style.display='none'; saveState(); gotoNextModule(); };
  document.addEventListener('click', (e)=>{
    const pop=$('#navPopup'); const openBtn=$('#navOpen'); if(pop && openBtn && !pop.contains(e.target) && e.target!==openBtn) hideNavPopup();
  });
}
window.bindRenderUI = bindRenderUI;

