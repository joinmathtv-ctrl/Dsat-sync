<!-- [PATCH-BEGIN] i18n util (mini) -->
<script>
  (function(){
    const STORE = 'dsat_lang';
    function detect(){ const x = localStorage.getItem(STORE); if(x) return x;
      const nav = (navigator.language||'en').toLowerCase().startsWith('ko')?'ko':'en';
      localStorage.setItem(STORE, nav); return nav;
    }
    const dict = {
      en:{
        ui:{ sync:'Sync', syncNow:'Sync Now', pushOnly:'Push Only', pullOnly:'Pull Only' },
        charts:{ totalByMode:'Total SAT (by mode)', sectionScores:'Section Scaled Scores', skillTrend:'Skill Trend (Accuracy %)', skillHeat:'Skill Heatmap (Accuracy %)' },
        labels:{ rw:'RW', math:'Math', skill:'Skill' },
        compare:{ selectTwo:'Select two attempts to compare.', total:'Total (by mode)', rwScaled:'RW (Scaled)', mathScaled:'Math (Scaled)', rwRaw:'RW Raw', mathRaw:'Math Raw' },
        detail:{ title:'Attempt Detail', summary:'Summary', set:'Set', type:'Type', total:'Total', presetRec:'Preset (recorded)', top5:'Top 5', bottom5:'Bottom 5', noData:'No data' },
        confirm:{ deleteAll:'Delete all local attempt logs?' },
        toast:{ connected:'Connected', auth:'Sign in required', connErr:'Connection error', syncOk:'Sync completed', syncFail:'Auto sync failed' }
      },
      ko:{
        ui:{ sync:'동기화', syncNow:'지금 동기화', pushOnly:'서버로 올리기', pullOnly:'서버에서 받기' },
        charts:{ totalByMode:'총점 추이 (모드 반영)', sectionScores:'섹션 스케일 점수', skillTrend:'스킬 추이 (정확도 %)', skillHeat:'스킬 히트맵 (정확도 %)' },
        labels:{ rw:'읽기·쓰기', math:'수학', skill:'스킬' },
        compare:{ selectTwo:'비교할 두 시도를 선택하세요.', total:'총점(모드 반영)', rwScaled:'RW (스케일)', mathScaled:'Math (스케일)', rwRaw:'RW 원점수', mathRaw:'Math 원점수' },
        detail:{ title:'시도 상세', summary:'요약', set:'세트', type:'종류', total:'총점', presetRec:'프리셋(기록된 값)', top5:'상위 5', bottom5:'하위 5', noData:'데이터 없음' },
        confirm:{ deleteAll:'로컬 시도 기록을 전부 삭제할까요?' },
        toast:{ connected:'연결됨', auth:'로그인이 필요합니다', connErr:'연결 오류', syncOk:'동기화 완료', syncFail:'자동 동기화 실패' }
      }
    };
    const I18N = {
      lang: detect(),
      t(k){ const parts=k.split('.'); let cur=dict[this.lang]||dict.en; for(const p of parts){ cur=(cur||{})[p]; }
        return (cur==null? k : cur);
      },
      set(l){ this.lang=(l==='ko'?'ko':'en'); localStorage.setItem(STORE,this.lang); this.applyDom(); },
      applyDom(){
        document.querySelectorAll('[data-i18n]').forEach(el=>{
          const key=el.getAttribute('data-i18n'); const val=this.t(key);
          if(el.tagName==='INPUT' && el.placeholder){ el.placeholder=val; } else { el.textContent=val; }
        });
      }
    };
    window.I18N = I18N;
    document.addEventListener('DOMContentLoaded', ()=>{
      // 토글 버튼
      document.getElementById('langEn')?.addEventListener('click', ()=> I18N.set('en'));
      document.getElementById('langKo')?.addEventListener('click', ()=> I18N.set('ko'));
      I18N.applyDom();
    });
  })();
</script>
<!-- [PATCH-END] -->
