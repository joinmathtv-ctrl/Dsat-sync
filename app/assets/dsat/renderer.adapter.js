<script type="module">
// app/assets/dsat/renderer.adapter.js
// 목적: 서버에서 가져온 세트 JSON을 기존 엔진에 연결하고,
//       이미지 자산 URL/수식 재조Typeset/시도 저장 콜백을 표준화합니다.

/**
 * 엔진 진입점 자동 탐색:
 * - window.startPractice(json, opts)
 * - window.startPracticeEngine(json, opts)
 */
function findEntry() {
  if (typeof window.startPractice === 'function') return window.startPractice;
  if (typeof window.startPracticeEngine === 'function') return window.startPracticeEngine;
  return null;
}

/**
 * MathJax 3 재타입셋: 엔진이 DOM을 갱신할 때 호출해 주세요.
 */
async function typeset() {
  try {
    if (window.MathJax && window.MathJax.typesetPromise) {
      await window.MathJax.typesetPromise();
    }
  } catch {}
}

/**
 * attachAndRun
 * @param {object} setJson - /api/{tier}-set/:key 응답(JSON)
 * @param {object} ctx - { tier, key, http, user, attempts }
 *    - ctx.tier: 'trial' | 'paid' | 'internal'
 *    - ctx.key:  세트 파일명 (.json)
 *    - ctx.http.get/post: 인증 포함 fetch 유틸
 *    - ctx.user: { sub, email, role, entitlements }
 *    - ctx.attempts: { saveBulk(attempts[]), list(sinceMs) }
 */
export async function attachAndRun(setJson, ctx) {
  const entry = findEntry();
  if (!entry) {
    const el = document.getElementById('app');
    if (el) el.textContent = 'Renderer entry not found (expose window.startPractice(...)).';
    console.warn('Expose window.startPractice(json, options) in your engine.');
    return;
  }

  // tier별 자산 URL
  const assetPrefix =
    ctx.tier === 'paid'    ? '/api/paid-asset/' :
    ctx.tier === 'internal'? '/api/internal-asset/' :
                             '/api/trial-asset/';

  const options = {
    // 이미지/표/첨부 등 상대경로 → API 경로
    assetURL: (relPath) => assetPrefix + encodeURIComponent(relPath),

    // 엔진이 DOM 갱신 후 수식 재타입셋을 원할 때 호출 가능
    onRendered: async () => { await typeset(); },

    // 엔진에서 시도(Attempt) 저장을 요청할 때 사용
    // attempt 스키마(권장): { id, baseId, kind, sections, ts, updatedAt?, score? ... }
    saveAttempt: async (attempt) => {
      try {
        await ctx.attempts.saveBulk([attempt]);
      } catch (e) {
        console.warn('saveAttempt failed:', e);
      }
    },

    // 여러 건을 한 번에
    saveAttemptsBulk: async (attempts) => {
      try { await ctx.attempts.saveBulk(attempts); }
      catch (e) { console.warn('saveAttemptsBulk failed:', e); }
    },

    // 과거 시도 불러오기
    listAttempts: async (sinceMs=null) => {
      try { return await ctx.attempts.list(sinceMs); }
      catch (e) { console.warn('listAttempts failed:', e); return []; }
    },

    // 현재 사용자 정보(엔진에서 UI 노출용)
    user: ctx.user || null,
  };

  // 엔진 실행
  await entry(setJson, options);

  // 첫 렌더 수식 처리
  await typeset();
}
</script>
