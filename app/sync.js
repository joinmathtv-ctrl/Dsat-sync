/* sync.js — Browser UMD (no ESM)
 * DSAT Dashboard <-> Sync Server (Express/Firebase mock-friendly)
 * - window.SYNC_API_BASE 있으면 baseUrl 자동 설정, userId 기본 'u-demo'
 * - /api/attempts/bulk 없으면 /api/attempts 로 폴백
 * - testConnection은 /api/attempts 조회로 대체
 * - 서버 포맷을 대시보드 표준 스키마(baseId/ts/sections..)로 정규화
 */
(function (global) {
  'use strict';

  // ---- Local Storage Keys ----
  const ATTEMPT_KEY = 'dsat_attempts_v1';
  const CFG_KEY     = 'dsat_sync_config_v1';

  // ---- Attempts store ----
  function loadAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPT_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveAttempts(arr) {
    try { localStorage.setItem(ATTEMPT_KEY, JSON.stringify(arr || [])); } catch (_) {}
  }

  // ---- Config store ----
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (_) { return {}; }
  }
  function setConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch (_) {}
  }

  // auto init from window.SYNC_API_BASE
  (function autoInitCfg(){
    try {
      const cfg = getConfig();
      if (!cfg.baseUrl && global.SYNC_API_BASE) cfg.baseUrl = String(global.SYNC_API_BASE);
      if (!cfg.userId) cfg.userId = 'u-demo';
      setConfig(cfg);
    } catch(_) {}
  })();

  function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

  // ---- HTTP wrapper (/api/*) ----
  async function call(method, path, body) {
    const cfg = getConfig();
    if (!cfg.baseUrl) throw new Error('Sync baseUrl이 설정되지 않았습니다. (dsat_sync_config_v1)');
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.token) headers['Authorization'] = 'Bearer ' + cfg.token;

    const res = await fetch(trimSlash(cfg.baseUrl) + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${text}`);
    }
    if (res.status === 204) return null;
    return await res.json().catch(() => ({}));
  }

  // ---- Normalize (server -> client schema) ----
  function normalizeServerAttempt(r){
    const ts = r.ts || (r.finishedAt?.seconds ? r.finishedAt.seconds * 1000 : Date.now());
    const baseId = r.baseId || r.setId || r.set_id || 'UNKNOWN_SET';
    const title  = r.title || r.setTitle || baseId;
    const mode   = r.mode || r.runMode || 'full';
    const kind   = r.kind || 'base';
    const sections = r.sections || {
      rw:   r.rawScore?.rw   || { correct: 0, total: 0 },
      math: r.rawScore?.math || { correct: 0, total: 0 }
    };
    return {
      id: r.id || `${baseId}_${kind}_${ts}`,
      ts, baseId, title, kind, mode,
      curvePreset: r.curvePreset || 'default',
      sections,
      skills: r.skills || {},
      updatedAt: r.updatedAt || ts,
      _remoteId: r._remoteId || r.id,
      _dirty: false
    };
  }

  // ---- Dirty flags ----
  function ensureDirtyFlags(list) {
    let changed = false;
    for (const a of list) {
      if (a._dirty === undefined) { a._dirty = false; changed = true; }
      if (!a._remoteId && !a._lastPushedAt && a._dirty === false) { a._dirty = true; changed = true; }
    }
    if (changed) saveAttempts(list);
    return list;
  }

  // ---- Id & merge helpers ----
  function ensureAttemptId(a, userId) {
    if (a.id) return a.id;
    const uid = userId || a.userId || 'u';
    a.id = `loc_${uid}_${(a.baseId||'base').replace(/[^\w-]+/g,'_')}_${a.kind||'base'}_${a.ts||Date.now()}`;
    return a.id;
  }
  function localKeyOf(a, userId) {
    if (a._remoteId) return 'rid:' + a._remoteId;
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
        local.push(copy); index.set(key, copy); added++;
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

  // ---- Max updatedAt (for since=) ----
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
      const res = await call('GET', '/api/attempts'); // mock-server엔 health 없음
      return { ok: true, endpoint: 'api/attempts', count: Array.isArray(res?.attempts) ? res.attempts.length : 0 };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
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
      delete copy._dirty; delete copy._lastPushedAt;
      return copy;
    });

    // bulk 우선 → 단일로 폴백
    let res;
    try {
      res = await call('POST', '/api/attempts/bulk', { userId: cfg.userId, attempts: payloadAttempts });
    } catch (_) {
      res = await call('POST', '/api/attempts', { attempts: payloadAttempts });
    }

    let pushed = 0;
    for (const a of all) {
      if (dirty.includes(a)) {
        a._dirty = false;
        a._lastPushedAt = Date.now();
        if (!a._remoteId && a.id) a._remoteId = a.id;
        pushed++;
      }
    }
    saveAttempts(all);
    return { pushed, skipped: 0, savedIds: Array.isArray(res?.savedIds) ? res.savedIds : undefined };
  }

  async function pullAttempts({ since } = {}) {
    const cfg = getConfig();
    if (!cfg.userId) throw new Error('Sync userId가 설정되지 않았습니다.');

    const sinceVal = (since === undefined) ? getLocalMaxUpdatedAt() : since;
    const q = `?userId=${encodeURIComponent(cfg.userId)}` + (sinceVal ? `&since=${encodeURIComponent(String(sinceVal))}` : '');

    const res = await call('GET', `/api/attempts${q}`);
    const list = Array.isArray(res?.attempts) ? res.attempts : [];
    const normalized = list.map(normalizeServerAttempt);

    const result = mergeRemoteIntoLocal(normalized, { userId: cfg.userId, preferRemote: true });
    return result;
  }

  async function syncNow() {
    const up = await pushAttempts();
    const down = await pullAttempts();
    return { push: up, pull: down };
  }

  // ---- Button binder ----
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
        try { const r = await pullAttempts(); msg(`Pulled: +${r.added}, ~${r.replaced}`); global.renderAll?.(); }
        catch (e) { err(e); }
      });
    }
    if (syncId && byId(syncId)) {
      byId(syncId).addEventListener('click', async () => {
        try { const r = await syncNow(); msg(`Sync ✔ push ${r.push.pushed}, pull +${r.pull.added}/~${r.pull.replaced}`); global.renderAll?.(); }
        catch (e) { err(e); }
      });
    }
  }

  // ---- Simple list helper ----
  async function listAttempts(){
    try { const res = await call('GET', '/api/attempts'); return { attempts: Array.isArray(res?.attempts) ? res.attempts : [] }; }
    catch (e) { return { attempts: [], error: String(e.message || e) }; }
  }

  // ---- Export ----
  global.DSAT_SYNC = {
    getConfig, setConfig,
    testConnection,
    pushAttempts, pullAttempts, syncNow,
    attachButtons,
    listAttempts,
    loadAttempts, saveAttempts,
  };
})(typeof window !== 'undefined' ? window : this);
