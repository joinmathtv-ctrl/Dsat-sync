/* sync.js — Browser UMD (no ESM) */
/* DSAT Dashboard <-> Sync Server (Express/Firebase) */

(function (global) {
  'use strict';

  // ---- Local Storage Keys ----
  const ATTEMPT_KEY = 'dsat_attempts_v1';
  const CFG_KEY = 'dsat_sync_config_v1';

  // ---- Helpers: attempts store ----
  function loadAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveAttempts(arr) {
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(arr)); } catch (_) {}
  }

  // ---- Helpers: config ----
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (_) { return {}; }
  }
  function setConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch (_) {}
  }

  // ---- Fetch wrapper ----
  async function call(method, path, body) {
    const cfg = getConfig();
    if (!cfg.baseUrl) throw new Error('Sync baseUrl이 설정되지 않았습니다. (dsat_sync_config_v1)');

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;

    const res = await fetch(trimSlash(cfg.baseUrl) + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
    }
    // 204 No Content 대응
    if (res.status === 204) return null;
    return await res.json().catch(() => ({}));
  }

  function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

  // ---- Mark dirty for new/unsynced records ----
  function ensureDirtyFlags(list) {
    let changed = false;
    for (const a of list) {
      if (a._dirty === undefined) { a._dirty = false; changed = true; }
      // 새 attempt인데 push 이력도 remoteId도 없으면 dirty로 잡는다
      if (!a._remoteId && !a._lastPushedAt && a._dirty === false) {
        a._dirty = true; changed = true;
      }
    }
    if (changed) saveAttempts(list);
    return list;
  }

  // ---- Merge policy ----
  // 기준키: remoteId가 있으면 그것으로, 없으면 (userId+ts+baseId+kind) 조합으로 식별
  function localKeyOf(a, userId) {
    if (a._remoteId) return 'rid:' + a._remoteId;
    const u = a.userId || userId || '';
    const base = a.baseId || '';
    const kind = a.kind || '';
    const ts = a.ts || 0;
    return `u:${u}|b:${base}|k:${kind}|ts:${ts}`;
  }

  // remote 배열을 local에 머지. 서버 것에 updatedAt이 있으면 비교, 없으면 remote 우선/덮어쓰기 옵션 사용
  function mergeRemoteIntoLocal(remoteList, { userId, preferRemote = true }) {
    const local = loadAttempts();
    const index = new Map();
    for (const a of local) {
      index.set(localKeyOf(a, userId), a);
    }

    let added = 0, replaced = 0;
    for (const r of remoteList) {
      const key = localKeyOf(r, userId);
      const found = index.get(key);
      if (!found) {
        // 새로 추가
        const copy = { ...r, _dirty: false, _remoteId: r._remoteId || r.id || undefined, _lastPushedAt: Date.now() };
        local.push(copy);
        index.set(key, copy);
        added++;
      } else {
        // 충돌 해결: updatedAt을 우선, 없으면 preferRemote 플래그
        const lu = found.updatedAt || 0;
        const ru = r.updatedAt || 0;
        const shouldReplace = ru > lu || (ru === lu && preferRemote);
        if (shouldReplace) {
          const keepMeta = {
            _remoteId: found._remoteId || r._remoteId || r.id,
            _dirty: false,
            _lastPushedAt: Date.now(),
          };
          Object.assign(found, { ...r }, keepMeta);
          replaced++;
        }
      }
    }
    if (added || replaced) saveAttempts(local);
    return { added, replaced, total: local.length };
  }

  // ---- Public ops ----

  async function testConnection() {
    // 서버가 /health 혹은 /ping을 제공한다면 우선 호출하고, 없으면 /attempts GET을 빠르게 호출
    try {
      // health 우선
      try {
        const res = await call('GET', '/api/health');
        return { ok: true, endpoint: 'health', res };
      } catch {
        const res = await call('GET', '/api/attempts');
        return { ok: true, endpoint: 'attempts', count: Array.isArray(res) ? res.length : 0 };
      }
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  // Dirty만 서버로 업로드
  async function pushAttempts() {
    const cfg = getConfig();
    if (!cfg.userId) throw new Error('Sync userId가 설정되지 않았습니다.');

    const all = ensureDirtyFlags(loadAttempts());
    const dirty = all.filter(a => a._dirty);
    if (!dirty.length) return { pushed: 0, skipped: 0 };

    let pushed = 0, skipped = 0;

    for (const a of dirty) {
      const payload = { ...a, userId: cfg.userId };
      // 메타 필드 제거(서버 저장 최소화)
      delete payload._dirty;
      delete payload._lastPushedAt;

      let res;
      if (a._remoteId) {
        // UPDATE
        res = await call('PUT', `/api/attempts/${encodeURIComponent(a._remoteId)}`, payload);
      } else {
        // CREATE
        res = await call('POST', '/api/attempts', payload);
      }

      // 응답 id/updatedAt 반영하고 dirty 해제
      a._remoteId = a._remoteId || res?.id;
      a.updatedAt = res?.updatedAt || a.updatedAt || Date.now();
      a._dirty = false;
      a._lastPushedAt = Date.now();
      pushed++;
    }

    saveAttempts(all);
    return { pushed, skipped };
  }

  // 서버의 모든(혹은 delta) attempts를 받아 머지
  async function pullAttempts({ since } = {}) {
    const cfg = getConfig();
    if (!cfg.userId) throw new Error('Sync userId가 설정되지 않았습니다.');

    // 쿼리 파라미터 지원 시 적용
    const q = (since ? `?since=${encodeURIComponent(String(since))}` : '');
    const list = await call('GET', `/api/attempts${q}`);

    const normalized = (Array.isArray(list) ? list : []).map(r => ({
      ...r,
      // 서버가 id를 루트에 두면 _remoteId로 복사
      _remoteId: r._remoteId || r.id,
      _dirty: false,
    }));

    const result = mergeRemoteIntoLocal(normalized, { userId: cfg.userId, preferRemote: true });
    return result;
  }

  // 두 동작을 순차 실행
  async function syncNow() {
    const up = await pushAttempts();
    const down = await pullAttempts();
    return { push: up, pull: down };
  }

  // 버튼 바인딩 도우미 (선택)
  function attachButtons({ pushId, pullId, syncId, toast } = {}) {
    const byId = (id) => document.getElementById(id);
    if (pushId && byId(pushId)) {
      byId(pushId).addEventListener('click', async () => {
        try {
          const r = await pushAttempts();
          msg(`Pushed: ${r.pushed}, Skipped: ${r.skipped}`);
        } catch (e) { err(e); }
      });
    }
    if (pullId && byId(pullId)) {
      byId(pullId).addEventListener('click', async () => {
        try {
          const r = await pullAttempts();
          msg(`Pulled — added: ${r.added}, replaced: ${r.replaced}`);
        } catch (e) { err(e); }
      });
    }
    if (syncId && byId(syncId)) {
      byId(syncId).addEventListener('click', async () => {
        try {
          const r = await syncNow();
          msg(`Sync done — pushed:${r.push.pushed} / pulled(+${r.pull.added},~${r.pull.replaced})`);
        } catch (e) { err(e); }
      });
    }

    function msg(t){ if (toast) toast(t); else console.log('[SYNC]', t); }
    function err(e){ const t = (e && e.message) ? e.message : String(e); if (toast) toast(t); else console.error('[SYNC]', t); }
  }

  // ---- public API ----
  const API = {
    getConfig, setConfig,
    testConnection,
    pushAttempts, pullAttempts, syncNow,
    attachButtons,

    // utilities (원하면 직접 사용)
    loadAttempts, saveAttempts,
  };

  // UMD export
  global.DSAT_SYNC = API;

})(typeof window !== 'undefined' ? window : this);
