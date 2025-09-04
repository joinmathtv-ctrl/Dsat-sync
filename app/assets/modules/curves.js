// Default curves and helpers for SAT scaling
var DEFAULT_CURVES = window.DEFAULT_CURVES || {
  rw:   [[0,200],[20,300],[40,400],[60,550],[80,700],[100,800]],
  math: [[0,200],[20,300],[40,450],[60,600],[80,720],[100,800]]
};
window.DEFAULT_CURVES = DEFAULT_CURVES;

var getCurves = window.getCurves || function(){
  const PRESETS = window.CURVE_PRESETS || {};
  const meta = (typeof SET!=='undefined' && SET?.metadata) ? SET.metadata : {};
  if (meta.curves && (Array.isArray(meta.curves.rw) || Array.isArray(meta.curves.math))) {
    return {
      rw:   Array.isArray(meta.curves.rw)   ? meta.curves.rw   : (PRESETS.default?.rw || DEFAULT_CURVES.rw),
      math: Array.isArray(meta.curves.math) ? meta.curves.math : (PRESETS.default?.math || DEFAULT_CURVES.math)
    };
  }
  const presetName = meta.curvePreset || 'default';
  const p = PRESETS[presetName] || PRESETS.default || {};
  return {
    rw:   Array.isArray(p.rw)   ? p.rw   : DEFAULT_CURVES.rw,
    math: Array.isArray(p.math) ? p.math : DEFAULT_CURVES.math
  };
};
window.getCurves = getCurves;

var interp = window.interp || function(points, x){
  if(!Array.isArray(points) || points.length===0) return 0;
  const arr = points.slice().sort((a,b)=> a[0]-b[0]);
  if(x<=arr[0][0]) return arr[0][1];
  if(x>=arr[arr.length-1][0]) return arr[arr.length-1][1];
  for(let i=1;i<arr.length;i++){
    const [x1,y1]=arr[i-1], [x2,y2]=arr[i];
    if(x<=x2){
      const t=(x-x1)/(x2-x1);
      return Math.round(y1 + t*(y2-y1));
    }
  }
  return arr[arr.length-1][1];
};
window.interp = interp;

var scaledFromCurve = window.scaledFromCurve || function(points, rawCorrect, rawTotal){
  const maxX = Math.max(...points.map(p=>p[0]));
  const x = (maxX <= 100)
    ? (rawTotal ? (rawCorrect/rawTotal*100) : 0)
    : rawCorrect;
  return interp(points, x);
};
window.scaledFromCurve = scaledFromCurve;

var accumulateSectionTotals = window.accumulateSectionTotals || function(){
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
};
window.accumulateSectionTotals = accumulateSectionTotals;
