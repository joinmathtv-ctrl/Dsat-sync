// server.js — DSAT Sync Server (Express + CORS + dotenv + optional Firestore safe-fallback)
// Node 18+
// 실행: npm run dev  (dotenv 적용) / npm start
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ===== CORS — 허용 도메인만 열기 (ALLOW_ORIGINS로 제어) =====
const allowed = (process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowed.length ? allowed : true, // 빈값이면 개발 편의상 전체 허용
  credentials: false
}));

// ===== 공통 미들웨어 =====
app.use(express.json({ limit: '2mb' }));

// 간단 요청 로깅 (배포시 유지 권장)
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// API 레이트 리밋 (선택·권장)
app.use('/api/', rateLimit({
  windowMs: 60_000,        // 1분
  max: 120,                // 분당 120 요청
  standardHeaders: true,   // RateLimit-* 헤더
  legacyHeaders: false
}));

// ===== Firestore 안전 초기화 (옵션 C) =====
const CRED_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
const HAS_CRED_FILE = CRED_PATH && fs.existsSync(CRED_PATH);
const HAS_PROJECT = !!process.env.FIREBASE_PROJECT_ID;

// 두 조건 모두 만족할 때에만 Firestore 사용
const USE_FIRESTORE = HAS_PROJECT && HAS_CRED_FILE;

let db = null;
if (USE_FIRESTORE) {
  const admin = require('firebase-admin');
  const serviceAccount = require(path.resolve(CRED_PATH));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  db = admin.firestore();
  console.log('[sync] Firestore enabled');
} else {
  if (HAS_PROJECT && !HAS_CRED_FILE) {
    console.warn(`[sync] Firestore disabled: credentials file not found at ${CRED_PATH}. Falling back to in-memory store.`);
  } else {
    console.log('[sync] In-memory store enabled');
  }
}

// ===== 인증 (개발 스텁) =====
// REQUIRE_AUTH=1 이면 Authorization: Bearer <token> 형식만 검사
function requireAuth(req, res, next) {
  const needAuth = process.env.REQUIRE_AUTH === '1';
  const auth = req.headers.authorization || '';
  const ok = !needAuth || /^Bearer\s+\S+/.test(auth);
  if (!ok) return res.status(401).json({ error: 'missing/invalid Authorization' });
  next();
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
    const filtered = sinceMs
      ? all.filter(a => (a.updatedAt || a.ts || 0) > Number(sinceMs))
      : all;
    return filtered.sort((a, b) => (b.updatedAt || b.ts || 0) - (a.updatedAt || a.ts || 0));
  }
}

async function upsertAttempts(userId, attempts) {
  const now = Date.now();
  const savedIds = [];
  if (USE_FIRESTORE) {
    const batch = db.batch();
    attempts.forEach((a) => {
      const id = String(a.id);
      const ref = db.collection('users').doc(userId).collection('attempts').doc(id);
      const doc = { ...a, _dirty: false, updatedAt: now, userId };
      batch.set(ref, doc, { merge: true });
      savedIds.push(id);
    });
    await batch.commit();
  } else {
    const bucket = mem.get(userId) || new Map();
    attempts.forEach((a) => {
      const id = String(a.id);
      const existing = bucket.get(id);
      // 서버가 더 최신이면 덮어쓰지 않음 (server-wins)
      if (existing && (existing.updatedAt || existing.ts || 0) > (a.updatedAt || a.ts || 0)) {
        return;
      }
      bucket.set(id, { ...a, _dirty: false, updatedAt: now, userId });
      savedIds.push(id);
    });
    mem.set(userId, bucket);
  }
  return savedIds;
}

// ===== Routes =====

// 공개 헬스(인프라/ALB 용)
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, firestore: USE_FIRESTORE });
});

// 보호 헬스(대시보드 점검용) — REQUIRE_AUTH=1이면 토큰 없을 때 401
app.get('/api/health', requireAuth, (_req, res) => {
  res.json({ ok: true, firestore: USE_FIRESTORE });
});

// 시도 가져오기: GET /api/attempts?userId=...&since=...
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

// 벌크 업서트: POST /api/attempts/bulk  { userId, attempts:[...] }
app.post('/api/attempts/bulk', requireAuth, async (req, res) => {
  try {
    const { userId, attempts } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!Array.isArray(attempts)) return res.status(400).json({ error: 'attempts[] required' });

    // 최소 스키마 검증
    const ok = attempts.every(a => a && a.id && a.baseId && a.kind && a.sections);
    if (!ok) return res.status(400).json({ error: 'invalid attempt schema' });

    const savedIds = await upsertAttempts(String(userId), attempts);
    res.json({ savedIds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// (옵션) 단건 생성/수정 — sync.js가 단건 호출을 쓸 때 호환용
app.post('/api/attempts', requireAuth, async (req, res) => {
  try {
    const a = req.body || {};
    if (!a.userId || !a.id) return res.status(400).json({ error: 'userId,id required' });
    await upsertAttempts(String(a.userId), [a]);
    return res.json({ id: String(a.id), updatedAt: Date.now() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.put('/api/attempts/:id', requireAuth, async (req, res) => {
  try {
    const a = { ...req.body, id: req.params.id };
    if (!a.userId || !a.id) return res.status(400).json({ error: 'userId,id required' });
    await upsertAttempts(String(a.userId), [a]);
    return res.json({ id: String(a.id), updatedAt: Date.now() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// (옵션) 정적파일 서빙 — STATIC_DIR 지정 시 사용
if (process.env.STATIC_DIR) {
  app.use(express.static(process.env.STATIC_DIR));
}

// (하위호환/안내)
app.get('/health', (_req, res) => {
  res.status(404).send('Use /api/health instead (this path is deprecated).');
});
app.get('/attempts', (_req, res) => {
  res.status(404).send('Use /api/attempts (GET) or /api/attempts/bulk (POST).');
});

// ===== 서버 시작 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ DSAT Sync Server running on http://localhost:${PORT}`);
});
