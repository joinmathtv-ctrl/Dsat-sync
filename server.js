// server.js — DSAT Sync Server (Express + CORS + dotenv + optional Firestore)
// Trust proxy + (optional) rate limit 적용 버전

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ── Nginx 뒤에 있을 때: 클라이언트 IP를 X-Forwarded-* 로 신뢰하도록 설정
app.set('trust proxy', 1); // 또는 true

// ── 간단 요청 로그(운영시에 유용)
app.use((req, _res, next) => {
  try {
    const ts = new Date().toISOString();
    console.log(`${ts} ${req.method} ${req.url}`);
  } catch {}
  next();
});

// ── CORS (배포 시엔 허용 도메인만)
const allowed = (process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowed.length ? allowed : true,
    credentials: false,
  })
);

// ── JSON 바디
app.use(express.json({ limit: '2mb' }));

// ── (선택) 레이트리밋: /api/* 에만 적용
try {
  const rateLimit = require('express-rate-limit');
  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000, // 1분
      max: 120,         // 분당 120요청
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
} catch {
  // express-rate-limit 미설치 시 자동 무시
  // npm i express-rate-limit 로 나중에 활성화 가능
}

// ===== Firestore 사용 여부 판정 =====
const USE_FIRESTORE =
  !!process.env.FIREBASE_PROJECT_ID || !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

let db = null;
if (USE_FIRESTORE) {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp(); // GOOGLE_APPLICATION_CREDENTIALS 사용
  db = admin.firestore();
  console.log('[sync] Firestore enabled');
} else {
  console.log('[sync] In-memory store enabled');
}

// ===== 인증 (개발 스텁) =====
function requireAuth(req, res, next) {
  const need = process.env.REQUIRE_AUTH === '1';
  const auth = req.headers.authorization || '';
  const ok = !need || /^Bearer\s+\S+/.test(auth);
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
    // 최신순 정렬
    return list.sort(
      (a, b) => (b.updatedAt || b.ts || 0) - (a.updatedAt || a.ts || 0)
    );
  } else {
    const bucket = mem.get(userId) || new Map();
    const all = [...bucket.values()];
    const filtered = sinceMs
      ? all.filter(a => (a.updatedAt || a.ts || 0) > Number(sinceMs))
      : all;
    return filtered.sort(
      (a, b) => (b.updatedAt || b.ts || 0) - (a.updatedAt || a.ts || 0)
    );
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
      if (prev && (prev.updatedAt || prev.ts || 0) > (a.updatedAt || a.ts || 0)) {
        // 서버 최신 우선
        return;
      }
      bucket.set(a.id, { ...a, _dirty: false, updatedAt: now, userId });
      savedIds.push(a.id);
    });
    mem.set(userId, bucket);
  }
  return savedIds;
}

// ===== 공개 헬스(모니터링용) =====
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, firestore: USE_FIRESTORE });
});

// ===== 보호 헬스(대시보드/운영점검용) =====
app.get('/api/health', requireAuth, (_req, res) => {
  res.json({ ok: true, firestore: USE_FIRESTORE });
});

// ===== 시도 가져오기: GET /api/attempts?userId=...&since=... =====
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

// ===== 벌크 업서트: POST /api/attempts/bulk { userId, attempts[] } =====
app.post('/api/attempts/bulk', requireAuth, async (req, res) => {
  try {
    const { userId, attempts } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!Array.isArray(attempts))
      return res.status(400).json({ error: 'attempts[] required' });

    // 최소 스키마 검증
    const ok = attempts.every(a => a && a.id && a.baseId && a.kind && a.sections && a.ts);
    if (!ok) return res.status(400).json({ error: 'invalid attempt schema' });

    const savedIds = await upsertAttempts(String(userId), attempts);
    res.json({ savedIds });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// (옵션) 단건 API 유지하고 싶다면 주석 해제
// app.post('/api/attempts', requireAuth, async (req,res)=>{ ... });
// app.put('/api/attempts/:id', requireAuth, async (req,res)=>{ ... });

// (옵션) 정적파일 서빙: .env에 STATIC_DIR=public 등 지정 시
if (process.env.STATIC_DIR) {
  app.use(express.static(process.env.STATIC_DIR));
}

// (하위호환 경로 안내)
app.get('/health', (_req, res) => res.status(404).send('Use /healthz instead.'));
app.get('/attempts', (_req, res) =>
  res.status(404).send('Use /api/attempts (GET) or /api/attempts/bulk (POST).')
);

// ===== 서버 시작 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ DSAT Sync Server running on http://localhost:${PORT}`);
});
