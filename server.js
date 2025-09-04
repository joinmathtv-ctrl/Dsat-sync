// server.js — DSAT Sync Server (+ Firebase Auth/Claims + Trial/Paid/Internal Guards + Catalog + Static)
// - Firebase ID 토큰 검증(1순위) + (옵션) 로컬 JWT 하위호환
// - 권한은 Firebase Custom Claims(role, entitlements)에서 읽음
// - /api/sets (카탈로그; 로그인 필수, 권한 기반 노출)
// - /api/trial-set/:key (로그인 필요) + /api/trial-asset/*
// - /api/paid-set/:key (권한: PAID_SETS) + /api/paid-asset/*
// - /api/internal-set/:key (권한: INTERNAL_SETS) + /api/internal-asset/*
// - Attempts API, STATIC_DIR 정적앱 서빙(+캐시 헤더)
// 필요 .env:
//   PORT, STATIC_DIR, REQUIRE_AUTH=1
//   GOOGLE_APPLICATION_CREDENTIALS (또는 다른 Admin 자격)
//   (선택) ALLOW_ORIGINS, ALLOW_INDEX=1
//   (하위호환) JWT_SECRET, INVITE_CODE, BOOTSTRAP_TOKEN

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const admin = require('firebase-admin');
try {
  if (!admin.apps.length) admin.initializeApp(); // GOOGLE_APPLICATION_CREDENTIALS 또는 런타임 SA
} catch { /* noop */ }

// (선택) rate limit
let rateLimit = null;
try { rateLimit = require('express-rate-limit'); } catch { /* optional */ }

// (하위호환) 로컬 JWT
const jwt = require('jsonwebtoken');
const users = new Map(); // email -> {email, passHash, role, entitlements:[]}

const app = express();
app.set('trust proxy', 1);

// 간단 로그
app.use((req, res, next) => {
  try { console.log(new Date().toISOString(), req.method, req.url); } catch {}
  next();
});

// CORS
const allowed = (process.env.ALLOW_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowed.length ? allowed : true, credentials: false }));

// JSON body
app.use(express.json({ limit: '2mb' }));

// 레이트리밋
if (rateLimit) {
  app.use('/api/', rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }));
}

// ===== Firestore 사용 여부 =====
const USE_FIRESTORE =
  !!process.env.FIREBASE_PROJECT_ID || !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

let db = null;
if (USE_FIRESTORE) {
  db = admin.firestore();
  console.log('[sync] Firestore enabled');
} else {
  console.log('[sync] In-memory store enabled');
}

// ===== 인증 미들웨어: Firebase ID 토큰 → (fallback) 로컬 JWT =====
async function requireAuth(req, res, next) {
  const need = process.env.REQUIRE_AUTH === '1';
  if (!need) return next();

  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)/i);
  if (!m) return res.status(401).json({ error: 'missing/invalid Authorization' });
  const token = m[1];

  // 1) Firebase ID token 검증
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const custom = decoded.customClaims || {};
    req.user = {
      sub: decoded.uid,
      email: decoded.email || null,
      role: (decoded.role ?? custom.role) || 'student',
      entitlements: decoded.entitlements ?? custom.entitlements ?? []
    };
    return next();
  } catch {
    // Firebase 실패 → 하위호환 로컬 JWT 시도
  }

  // 2) (옵션) 로컬 JWT
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(401).json({ error: 'invalid token' });
  try {
    const payload = jwt.verify(token, secret);
    req.user = {
      sub: payload.sub,
      email: payload.email || null,
      role: payload.role || 'student',
      entitlements: payload.entitlements || []
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// 권한 체크
function needEntitlement(key) {
  return (req, res, next) => {
    const ents = (req.user && req.user.entitlements) || [];
    if (ents.includes(key)) return next();
    return res.status(403).json({ error: 'forbidden: missing entitlement ' + key });
  };
}

// ===== 저장소 추상화 =====
const mem = new Map(); // userId -> Map(attemptId -> attempt)

async function getAttempts(userId, sinceMs) {
  if (USE_FIRESTORE) {
    let q = db.collection('users').doc(userId).collection('attempts');
    if (sinceMs) q = q.where('updatedAt', '>', Number(sinceMs));
    const snap = await q.get();
    const list = [];
    snap.forEach(d => list.push(d.data()));
    return list.sort((a, b) => (b.updatedAt || b.ts || 0) - (a.updatedAt || a.ts || 0));
  } else {
    const bucket = mem.get(userId) || new Map();
    const all = [...bucket.values()];
    const filtered = sinceMs ? all.filter(a => (a.updatedAt || a.ts || 0) > Number(sinceMs)) : all;
    return filtered.sort((a, b) => (b.updatedAt || b.ts || 0) - (a.updatedAt || a.ts || 0));
  }
}

async function upsertAttempts(userId, attempts) {
  const now = Date.now();
  const savedIds = [];
  if (USE_FIRESTORE) {
    const batch = db.batch();
    attempts.forEach(a => {
      const id = String(a.id);
      const ref = db.collection('users').doc(userId).collection('attempts').doc(id);
      const doc = { ...a, _dirty: false, updatedAt: now, userId };
      batch.set(ref, doc, { merge: true });
      savedIds.push(id);
    });
    await batch.commit();
  } else {
    const bucket = mem.get(userId) || new Map();
    attempts.forEach(a => {
      const prev = bucket.get(a.id);
      if (prev && (prev.updatedAt || prev.ts || 0) > (a.updatedAt || a.ts || 0)) return;
      bucket.set(a.id, { ...a, _dirty: false, updatedAt: now, userId });
      savedIds.push(a.id);
    });
    mem.set(userId, bucket);
  }
  return savedIds;
}

// === utils: path & json ===
function safeJoin(base, rel){
  const p = path.join(base, rel);
  if (!p.startsWith(base)) throw new Error('invalid path');
  return p;
}
function readJsonSafe(file){
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

// 질문 개수 계산(표준 DSAT 포맷 가정)
function countQuestions(json){
  try{
    if (Array.isArray(json?.modules)) {
      return json.modules.reduce((sum,m)=>sum + (Array.isArray(m.questions)?m.questions.length: Number(m.total||0)), 0);
    }
    if (Array.isArray(json?.questions)) return json.questions.length;
  }catch{}
  return 0;
}
function inferSubject(tags=[], title=''){
  const s = (tags.join(' ') + ' ' + title).toLowerCase();
  if (s.includes('math')) return 'math';
  if (s.includes('rw') || s.includes('reading') || s.includes('writing')) return 'rw';
  return '';
}

// === metadata collector (extended) ===
function collectSets(dir, tier){
  const base = path.join(__dirname, dir);
  let list = [];
  try{
    const files = fs.readdirSync(base).filter(n=>n.endsWith('.json'));
    list = files.map(fn=>{
      const full = safeJoin(base, fn);
      const json = readJsonSafe(full) || {};
      const meta = json.metadata || {};

      const title = String(meta.title || path.basename(fn, '.json'));
      const tags  = Array.isArray(meta.tags) ? meta.tags : [];
      const count = Number(meta.count || countQuestions(json) || 0);
      const topics = Array.isArray(meta.topics) ? meta.topics : [];
      const level = (meta.level || '').toString();
      const duration = Number(meta.duration || 0);
      const subject = (meta.subject || inferSubject(tags, title));

      // thumb → 절대 API 경로 (있을 때만)
      let thumb = null;
      if (meta.thumb && typeof meta.thumb === 'string') {
        const assetBase =
          tier === 'trial'   ? '/api/trial-asset/' :
          tier === 'paid'    ? '/api/paid-asset/' :
          tier === 'internal'? '/api/internal-asset/' : '';
        thumb = assetBase ? (assetBase + encodeURIComponent(meta.thumb)) : null;
      }

      return {
        type: tier,
        key: fn,
        metadata: { title, tags, count, thumb, topics, level, duration, subject }
      };
    });
  }catch{}
  return list;
}

// ===== Routes =====

// 공개 헬스
app.get('/healthz', (req, res) => {
  res.json({ ok: true, firestore: USE_FIRESTORE });
});

// 보호 헬스
app.get('/api/health', requireAuth, (req, res) => {
  res.json({ ok: true, firestore: USE_FIRESTORE, user: req.user || null });
});

// === (하위호환) 로컬 Auth / Users ===
app.post('/api/admin/bootstrap', (req, res) => {
  const { token, email, password } = req.body || {};
  if (token !== process.env.BOOTSTRAP_TOKEN) {
    return res.status(403).json({ error: 'invalid bootstrap token' });
  }
  const u = users.get(email) || { email, entitlements: [] };
  u.passHash = password;
  u.role = 'admin';
  users.set(email, u);
  return res.json({ ok: true, role: u.role });
});

app.post('/api/signup', (req, res) => {
  const { email, password, invite } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email/password required' });
  if (invite !== process.env.INVITE_CODE) return res.status(403).json({ error: 'invalid invite code' });
  if (users.has(email)) return res.status(409).json({ error: 'already exists' });
  const user = { email, passHash: password, role: 'student', entitlements: [] };
  users.set(email, user);
  return res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = users.get(email);
  if (!u || u.passHash !== password) return res.status(401).json({ error: 'invalid credentials' });
  const payload = { sub: email, email, role: u.role || 'student', entitlements: u.entitlements || [] };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, role: payload.role, entitlements: payload.entitlements });
});

// === 관리자: 권한 부여 (Firebase Custom Claims 반영; 확장 버전) ===
app.post('/api/admin/grant', requireAuth, async (req, res) => {
  if ((req.user?.role) !== 'admin') return res.status(403).json({ error: 'admin only' });

  const { email, claims, entitlement, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    if (!admin) return res.status(500).json({ error: 'firebase admin not configured' });
    const user = await admin.auth().getUserByEmail(email);
    const current = user.customClaims || {};

    const curEnts = Array.isArray(current.entitlements) ? current.entitlements : [];
    let nextClaims = { ...current };

    // 1) claims 객체가 온 경우(권장)
    if (claims && typeof claims === 'object') {
      ['PAID_SETS', 'INTERNAL_SETS', 'ADMIN'].forEach(k => {
        if (k in claims) {
          const v = !!claims[k];
          if (v) nextClaims[k] = true; else delete nextClaims[k];
        }
      });
      if ('role' in claims) {
        if (claims.role) nextClaims.role = String(claims.role);
        else delete nextClaims.role;
      }
      // 불린 → entitlements 동기화
      const entSet = new Set(curEnts);
      if (nextClaims.PAID_SETS) entSet.add('PAID_SETS'); else entSet.delete('PAID_SETS');
      if (nextClaims.INTERNAL_SETS) entSet.add('INTERNAL_SETS'); else entSet.delete('INTERNAL_SETS');
      nextClaims.entitlements = Array.from(entSet);
    }

    // 2) 구버전 파라미터(entitlement/role) 병행 지원
    if (entitlement) {
      const ent = String(entitlement);
      const entSet = new Set(Array.isArray(nextClaims.entitlements) ? nextClaims.entitlements : curEnts);
      entSet.add(ent);
      nextClaims.entitlements = Array.from(entSet);
      if (ent === 'PAID_SETS') nextClaims.PAID_SETS = true;
      if (ent === 'INTERNAL_SETS') nextClaims.INTERNAL_SETS = true;
    }
    if (role) {
      nextClaims.role = String(role);
    }

    await admin.auth().setCustomUserClaims(user.uid, nextClaims);
    res.json({
      ok: true,
      uid: user.uid,
      claims: nextClaims,
      entitlements: nextClaims.entitlements || [],
      role: nextClaims.role || 'student'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// === 구매 데모: 본인 계정에 PAID_SETS 부여 ===
app.post('/api/purchase/paid', requireAuth, async (req, res) => {
  try {
    if (!admin) return res.status(500).json({ error: 'firebase admin not configured' });

    // 이메일 우선, 없으면 UID로
    const userById = await admin.auth().getUserByEmail(req.user.email).catch(async () => {
      return await admin.auth().getUser(req.user.sub);
    });

    const cur = userById.customClaims || {};
    const entSet = new Set(Array.isArray(cur.entitlements) ? cur.entitlements : []);
    entSet.add('PAID_SETS');

    const next = {
      ...cur,
      PAID_SETS: true,
      entitlements: Array.from(entSet)
    };

    await admin.auth().setCustomUserClaims(userById.uid, next);
    res.json({ ok: true, claims: next });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// === Attempts ===
app.get('/api/attempts', requireAuth, async (req, res) => {
  try {
    const userId = String(req.query.userId || '').trim();
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const since = req.query.since ? Number(req.query.since) : null;
    const attempts = await getAttempts(userId, since);
    res.json({ attempts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/attempts/bulk', requireAuth, async (req, res) => {
  try {
    const { userId, attempts } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!Array.isArray(attempts)) return res.status(400).json({ error: 'attempts[] required' });
    const ok = attempts.every(a => a && a.id && a.baseId && a.kind && a.sections && a.ts);
    if (!ok) return res.status(400).json({ error: 'invalid attempt schema' });
    const savedIds = await upsertAttempts(String(userId), attempts);
    res.json({ savedIds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// === 현재 사용자/클레임 확인 ===
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const out = {
      sub: req.user?.sub || null,
      email: req.user?.email || null,
      role: req.user?.role || 'student',
      entitlements: req.user?.entitlements || []
    };
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// === Catalog (로그인 필수, 권한 기반 노출) ===
app.get('/api/sets', requireAuth, (req, res) => {
  const ents = (req.user?.entitlements) || [];
  const has = e => ents.includes(e);

  const trial    = collectSets('trial_sets', 'trial');
  const paid     = has('PAID_SETS')     ? collectSets('paid_sets', 'paid') : [];
  const internal = has('INTERNAL_SETS') ? collectSets('protected/internal_sets', 'internal') : [];

  res.json({ trial, paid, internal });
});

// === Trial/Paid/Internal Sets & Assets ===
app.get('/api/trial-set/:key', requireAuth, (req, res) => {
  const fileKey = req.params.key;
  const base = path.join(__dirname, 'trial_sets');
  const p = path.join(base, fileKey);
  if (!p.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  fs.createReadStream(p).pipe(res);
});

app.get('/api/trial-asset/*', requireAuth, (req, res) => {
  const rel = req.params[0];
  const base = path.join(__dirname, 'trial_assets');
  const p = path.join(base, rel);
  if (!p.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  fs.createReadStream(p).pipe(res);
});

app.get('/api/paid-set/:key', requireAuth, needEntitlement('PAID_SETS'), (req, res) => {
  const fileKey = req.params.key;
  const base = path.join(__dirname, 'paid_sets');
  const p = path.join(base, fileKey);
  if (!p.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  fs.createReadStream(p).pipe(res);
});

app.get('/api/paid-asset/*', requireAuth, needEntitlement('PAID_SETS'), (req, res) => {
  const rel = req.params[0];
  const base = path.join(__dirname, 'paid_assets');
  const p = path.join(base, rel);
  if (!p.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  fs.createReadStream(p).pipe(res);
});

app.get('/api/internal-set/:key', requireAuth, needEntitlement('INTERNAL_SETS'), (req, res) => {
  const fileKey = req.params.key;
  const base = path.join(__dirname, 'protected', 'internal_sets');
  const p = path.join(base, fileKey);
  if (!p.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  fs.createReadStream(p).pipe(res);
});

app.get('/api/internal-asset/*', requireAuth, needEntitlement('INTERNAL_SETS'), (req, res) => {
  const rel = req.params[0];
  const base = path.join(__dirname, 'protected', 'internal_assets');
  const p = path.join(base, rel);
  if (!p.startsWith(base)) return res.status(400).end();
  if (!fs.existsSync(p)) return res.status(404).end();
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
  fs.createReadStream(p).pipe(res);
});

// === Static ===

// 루트는 연습 홈으로 고정
app.get('/', (req, res) => {
  const staticDir = process.env.STATIC_DIR || 'app';
  return res.sendFile(path.join(__dirname, staticDir, 'index.html'));
});

// 정적 서빙(에셋 캐시, HTML no-store)
if (process.env.STATIC_DIR) {
  const STATIC_DIR = process.env.STATIC_DIR;
  // 에셋: /assets/* 는 캐시 허용
  app.use('/assets', express.static(path.join(__dirname, STATIC_DIR, 'assets'), {
    setHeaders(res){ res.setHeader('Cache-Control','public, max-age=604800, immutable'); }
  }));
  // 그 외 정적
  app.use(express.static(STATIC_DIR, {
    setHeaders(res, p){
      if (p.endsWith('.html')) {
        res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, private');
      }
    }
  }));
}

// robots.txt (기본 차단; ALLOW_INDEX=1 이면 제한적 허용)
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  if (process.env.ALLOW_INDEX === '1') {
    return res.send(
      'User-agent: *\n' +
      'Allow: /\n' +
      'Disallow: /api/\n'
    );
  }
  return res.send('User-agent: *\nDisallow: /\n');
});

// 하위호환 안내
app.get('/health', (req, res) => res.status(404).send('Use /healthz instead.'));
app.get('/attempts', (req, res) =>
  res.status(404).send('Use /api/attempts (GET) or /api/attempts/bulk (POST).')
);

// ===== 서버 시작 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ DSAT Sync Server running on http://localhost:${PORT}`);
});
