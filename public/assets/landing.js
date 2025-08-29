/** ============ 카탈로그(원하는 만큼 수정하세요) ============ */
const CATALOG = [
  {
    id: 'default',
    title: 'Sample DSAT Set',
    subtitle: 'RW + Math · 4 Modules',
    url: './questions.json',
    thumb: './img/thumb_default.jpg',
    tags: ['sample','rw','math']
  },
  {
    id: 'step3',
    title: 'Practice Set (Step3 Demo)',
    subtitle: '오토세이브/허용오차/추가문항 데모',
    url: './questions_step3.json',
    thumb: './img/thumb_step3.jpg',
    tags: ['practice','math','rw','demo']
  }
];

/** ============ 모드 상태(추가) ============ */
const ONLY_KEY = 'dsat_landing_only';
function getOnly(){ return localStorage.getItem(ONLY_KEY) || ''; }          // '' | 'rw' | 'math'
function setOnly(v){ localStorage.setItem(ONLY_KEY, v || ''); syncModeUI(); }
function syncModeUI(){
  const only = getOnly();
  document.querySelectorAll('#modeSeg .seg-btn').forEach(btn=>{
    btn.classList.toggle('active', (btn.dataset.only===only));
  });
}
function onlyQuery(){
  const v = getOnly();
  return v ? `&only=${encodeURIComponent(v)}` : '';
}

/** ============ 공통 유틸 ============ */
const $ = s => document.querySelector(s);
function h(tag, attrs={}, html=''){
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k==='class') el.className=v;
    else if(k==='dataset'){ Object.entries(v).forEach(([kk,vv])=> el.dataset[kk]=vv); }
    else if(k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  });
  if(html) el.innerHTML = html;
  return el;
}
function startFromURL(url, title){
  try{
    addRecent({type:'url', value:url, title, mode:getOnly()});
  }catch(_e){}
  location.href = `./index.html?set=${encodeURIComponent(url)}${onlyQuery()}`;
}
async function startFromFile(file, title='Local JSON'){
  const text = await file.text();
  localStorage.setItem('dsat_launch_blob', text);
  try{
    addRecent({type:'file', value:title || file.name, title:(title||file.name), mode:getOnly()});
  }catch(_e){}
  location.href = `./index.html?source=blob${onlyQuery()}`;
}
function addRecent(rec){
  const key='dsat_recents';
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  const filtered = arr.filter(x=> !(x.type===rec.type && x.value===rec.value && (x.mode||'')===(rec.mode||'')));
  filtered.unshift({...rec, ts: Date.now()});
  localStorage.setItem(key, JSON.stringify(filtered.slice(0,8)));
}
function renderRecents(){
  const box = $('#recents');
  box.innerHTML='';
  const arr = JSON.parse(localStorage.getItem('dsat_recents') || '[]');
  if(!arr.length){ box.innerHTML = '<span class="note">아직 없음</span>'; return; }
  arr.forEach(r=>{
    const pill = h('button',{class:'pill'});
    const modeTxt = r.mode ? (r.mode==='rw' ? ' [RW]' : ' [Math]') : ' [Full]';
    pill.textContent = (r.title || r.value) + modeTxt;
    pill.title = r.type==='url' ? (r.value + modeTxt) : 'Local file' + modeTxt;
    pill.onclick = ()=>{
      // 저장된 모드로 실행
      const savedOnly = r.mode || '';
      setOnly(savedOnly);
      if(r.type==='url'){
        location.href = `./index.html?set=${encodeURIComponent(r.value)}${onlyQuery()}`;
      }else{
        alert('로컬 파일은 보안상 자동 재시작이 어려워요. 아래 “로컬 파일”에서 다시 선택해 주세요.');
      }
    };
    box.appendChild(pill);
  });
}

/** ============ 카드 렌더 ============ */
const grid = $('#grid');
function card(item){
  const outer = h('div',{class:'card item', dataset:{id:item.id}});
  const th = h('div',{class:'thumb'});
  const img = new Image();
  img.alt = item.title;
  img.src = item.thumb || '';
  img.onload = ()=> th.appendChild(img);
  img.onerror = ()=> th.innerHTML = '<div class="fallback">📝</div>';
  outer.appendChild(th);

  const body = h('div',{class:'body'});
  body.appendChild(h('div',{class:'title'}, item.title));
  body.appendChild(h('div',{class:'sub'}, item.subtitle || ''));
  const tags = h('div',{class:'tags'});
  (item.tags||[]).forEach(t=> tags.appendChild(h('span',{class:'tag'}, t)));
  body.appendChild(tags);

  const meta = h('div',{class:'meta'});
  meta.innerHTML = `<div>형식: <b>JSON</b></div><div>시작: <b>즉시</b></div>`;
  body.appendChild(meta);
  outer.appendChild(body);

  const foot = h('div',{class:'foot'});
  const openUrl = h('button',{class:'btn', onclick:()=> window.open(item.url,'_blank')}, 'JSON 보기');
  const btn = h('button',{
    class:'btn primary',
    onclick:()=> startFromURL(item.url, item.title)
  }, '시험 시작');
  foot.appendChild(openUrl);
  foot.appendChild(btn);
  outer.appendChild(foot);

  return outer;
}
function render(list){
  grid.innerHTML='';
  list.forEach(item=> grid.appendChild(card(item)));
}

/** ============ 검색/보기 전환 ============ */
function applyFilter(){
  const q = ($('#q').value || '').trim().toLowerCase();
  if(!q) return render(CATALOG);
  const terms = q.split(/\s+/).filter(Boolean);
  const results = CATALOG.filter(it=>{
    const hay = [it.title, it.subtitle, ...(it.tags||[])].join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
  render(results);
}
$('#q').addEventListener('input', applyFilter);
$('#clearQ').onclick = ()=>{ $('#q').value=''; applyFilter(); };

$('#toGrid').onclick = ()=> grid.classList.remove('list');
$('#toList').onclick = ()=> grid.classList.add('list');

/** ============ 직접 불러오기 섹션 ============ */
$('#resetBtn').onclick = ()=>{ $('#jsonUrl').value=''; $('#jsonFile').value=''; };
$('#startBtn').onclick = async ()=>{
  const url = $('#jsonUrl').value.trim();
  const file = $('#jsonFile').files[0];
  if(url){ startFromURL(url, 'Custom URL'); return; }
  if(file){
    try{ await startFromFile(file, file.name); }
    catch(e){ alert('파일 읽기 실패: ' + e.message); }
    return;
  }
  alert('JSON URL을 입력하거나 로컬 JSON 파일을 선택하세요.');
};

/** ============ 모드 UI 이벤트(추가) ============ */
document.querySelectorAll('#modeSeg .seg-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    setOnly(btn.dataset.only || '');
  });
});

/** ============ 초기화 ============ */
render(CATALOG);
applyFilter();
renderRecents();
syncModeUI(); // 모드 버튼 상태 반영
