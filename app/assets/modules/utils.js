// URL/query helpers
var qp = window.qp || function(k){ return new URLSearchParams(location.search).get(k); };
window.qp = qp;

// DOM/util helpers
var $ = window.$ || (s=>document.querySelector(s));
var bubbleABC = window.bubbleABC || (idx => "ABCD".charAt(idx));
var fmt = window.fmt || (s => (s??"").replaceAll("\n","<br>"));
var fmtTime = window.fmtTime || (s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`);
var typeset = window.typeset || (()=> window.MathJax && MathJax.typesetPromise());
var injectImages = window.injectImages || (html =>
  (html||"").replace(/\[\[IMAGE:\s*([^|\]]+)(?:\|([^\]]+))?\]\]/g,
    (_m,src,alt)=>`<img src="./img/${src.trim()}" alt="${(alt||'problem image').trim()}" style="max-width:100%">`));
window.$ = $; window.bubbleABC = bubbleABC; window.fmt = fmt; window.fmtTime = fmtTime; window.typeset = typeset; window.injectImages = injectImages;

// Display helpers
var sectionLabel = window.sectionLabel || function(key){
  const k=(key||'').toLowerCase();
  if(k==='rw'||k==='readingwriting'||k==='reading & writing') return 'Reading & Writing';
  if(k==='math') return 'Math';
  return key || 'Section';
};
window.sectionLabel = sectionLabel;
