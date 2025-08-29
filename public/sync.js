/* sync.js — Browser UMD (no ESM)
 * DSAT Dashboard <-> Sync Server (Express/Firebase)
 */
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
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(arr || [])); } catch (_) {}
  }

  // ---- Helpers: config ----
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (_) { return {}; }
  }
  function setConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch (_) {}
  }

  function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

  // ---- HTTP wrapper (서버 규약: /api/*) ----
  async function call(method, path, body) {
    const cfg = getConfig();
    if (!cfg.baseUrl) throw new Error('Sync baseUrl이 설정되지 않았습니다. (dsat_sync_config_v1)');

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;

    const res = await fetch(trimSlash(cfg.baseUrl) + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
    }
    if (res.status === 204) return null;
    return await res.json().catch(() => ({}));
  }

  // ---- Dirty 플래그 자동 보정 ----
  function ensureDirtyFlags(list) {
    let changed = false;
    for (const a of list) {
      if (a._dirty === undefined) { a._dirty = false; changed = true; }
      // 과도한 false를 방지: 원격 id/푸시 기록 없으면 초회는 dirty로 간주 가능
      if (!a._remoteId && !a._lastPushedAt && a._dirty === false) { a._dirty = true; changed = true; }
    }
    if (changed) saveAttempts(list);
    return list;
  }

  // ---- 유틸: id 보장 (서버는 attempt.id 필수) ----
  function ensureAttemptId(a, userId) {
    if (a.id) return a.id;
    const uid = userId || a.userId || 'u';
    a.id = `loc_${uid}_${(a.baseId||'base').replace(/[^\w-]+/g,'_')}_${a.kind||'base'}_${a.ts||Date.now()}`;
    return a.id;
  }

  // ---- 로컬 병합 키 ----
  function localKeyOf(a, userId) {
    if (a._remoteId) return 'rid:' + a._remoteId; // 원격 id 우선
    const u = a.userId || userId || '';
    const base = a.baseId || '';
    const kind = a.kind || '';
    const ts = a.ts || 0;
    return `u:${u}|b:${base}|k:${kind}|ts:${ts}`;
  }

  function mergeRemoteIntoLocal(remoteList, { userId, preferRemote = true }) {
    const local = loadAttempts();
    const index = new Map(local.map(a => [localKeyOf(a, userId), a]));

    let added = 0, replaced = 0;
    for (const r of remoteList) {
      const key = localKeyOf(r, userId);
      const found = index.get(key);
      if (!found) {
        const copy = { ...r, _dirty: false, _remoteId: r._remoteId || r.id || undefined, _lastPushedAt: Date.now() };
        local.push(copy);
        index.set(key, copy);
        added++;
      } else {
        const lu = found.updatedAt || found.ts || 0;
        const ru = r.updatedAt || r.ts || 0;
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

  // ---- 최신 updatedAt 계산 (증분 동기화용 since) ----
  function getLocalMaxUpdatedAt() {
    const arr = loadAttempts();
    let max = 0;
    for (const a of arr) {
      const t = a.updatedAt || a.ts || 0;
      if (t > max) max = t;
    }
    return max || null;
  }

  // ---- Public ops ----
  async function testConnection() {
    try {
      const res = await call('GET', '/api/health');
      return { ok: true, endpoint: 'api/health', res };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async function pushAttempts() {
    const cfg = getConfig();
    if (!cfg.userId) throw new Error('Sync userId가 설정되지 않았습니다.');

    const all = ensureDirtyFlags(loadAttempts());
    const dirty = all.filter(a => a && a._dirty);
    if (!dirty.length) return { pushed: 0, skipped: 0 };

    const payloadAttempts = dirty.map(a => {
      const copy = { ...a };
      ensureAttemptId(copy, cfg.userId);
      // 서버 저장용으로 메타 제거
      delete copy._dirty;
      delete copy._lastPushedAt;
      return copy;
    });

    const res = await call('POST', '/api/attempts/bulk', {
      userId: cfg.userId,
      attempts: payloadAttempts
    });

    // 저장 완료 처리
    const savedIds = Array.isArray(res?.savedIds) ? res.savedIds : [];
    let pushed = 0;
    for (const a of all) {
      if (dirty.includes(a)) {
        a._dirty = false;
        a._lastPushedAt = Date.now();
        if (!a._remoteId && a.id) a._remoteId = a.id; // 서버가 동일 id 사용
        pushed++;
      }
    }
    saveAttempts(all);
    return { pushed, skipped: 0, savedIds };
  }

  // 서버에서 내려받기 (증분 동기화 기본: since=로컬 최대 updatedAt)
  async function pullAttempts({ since } = {}) {
    const cfg = getConfig();
    if (!cfg.userId) throw new Error('Sync userId가 설정되지 않았습니다.');

    const sinceVal = (since === undefined) ? getLocalMaxUpdatedAt() : since;
    const q =
      `?userId=${encodeURIComponent(cfg.userId)}` +
      (sinceVal ? `&since=${encodeURIComponent(String(sinceVal))}` : '');

    const res = await call('GET', `/api/attempts${q}`);
    const list = Array.isArray(res?.attempts) ? res.attempts : [];

    const normalized = list.map(r => ({
      ...r,
      _remoteId: r._remoteId || r.id,
      _dirty: false,
    }));

    const result = mergeRemoteIntoLocal(normalized, { userId: cfg.userId, preferRemote: true });
    return result;
  }

  async function syncNow() {
    const up = await pushAttempts();
    const down = await pullAttempts();
    return { push: up, pull: down };
  }

  // 버튼 연결 도우미(선택)
  function attachButtons({ pushId, pullId, syncId, toast } = {}) {
    const byId = (id) => document.getElementById(id);
    function msg(t){ if (toast) toast(t); else console.log('[SYNC]', t); }
    function err(e){ const t = (e && e.message) ? e.message : String(e); if (toast) toast(t); else console.error('[SYNC]', t); }

    if (pushId && byId(pushId)) {
      byId(pushId).addEventListener('click', async () => {
        try { const r = await pushAttempts(); msg(`Pushed: ${r.pushed}`); }
        catch (e) { err(e); }
      });
    }
    if (pullId && byId(pullId)) {
      byId(pullId).addEventListener('click', async () => {
        try {
          const r = await pullAttempts();
          msg(`Pulled: +${r.added}, ~${r.replaced}`);
          if (typeof global.renderAll === 'function') { try { global.renderAll(); } catch(_){} }
        } catch (e) { err(e); }
      });
    }
    if (syncId && byId(syncId)) {
      byId(syncId).addEventListener('click', async () => {
        try {
          const r = await syncNow();
          msg(`Sync ✔ push ${r.push.pushed}, pull +${r.pull.added}/~${r.pull.replaced}`);
          if (typeof global.renderAll === 'function') { try { global.renderAll(); } catch(_){} }
        } catch (e) { err(e); }
      });
    }
  }

  const API = {
    getConfig, setConfig,
    testConnection,
    pushAttempts, pullAttempts, syncNow,
    attachButtons,
    loadAttempts, saveAttempts,
  };

  global.DSAT_SYNC = API; // UMD export
})(typeof window !== 'undefined' ? window : this);
