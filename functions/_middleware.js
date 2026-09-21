// warm-host 全局中间件
// 功能：CORS、首访自动建表 + seed、Session 注入
// 参考：shop-booking/functions/_middleware.js 模式
//
// Pages Functions 的 onRequest(context) 在每个请求前执行。
// context = { request, env, next, params, waitUntil, passThroughOnException, cf }

import { hashPassword, genSalt, generateInviteCode } from "./_shared/crypto.js";

// 初始化状态标记（模块级，冷启动后只执行一次）
let dbReady = false;
let initializing = false;

// ============ Schema SQL（内联，Pages Functions 运行时无法读文件）============
// 来源：schema.sql（12 表 + 索引）
const SCHEMA_STATEMENTS = [
  // --- users ---
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    nickname TEXT NOT NULL,
    avatar_key TEXT,
    is_owner INTEGER DEFAULT 1,
    is_host INTEGER DEFAULT 0,
    host_status TEXT DEFAULT 'pending',
    real_name TEXT,
    id_card_key TEXT,
    id_card_verified INTEGER DEFAULT 0,
    emergency_contact TEXT,
    bio TEXT,
    city TEXT DEFAULT '同城',
    invited_by TEXT,
    role TEXT DEFAULT 'user',
    banned INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  // --- host_profiles ---
  `CREATE TABLE IF NOT EXISTS host_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    bio TEXT,
    capacity_count INTEGER DEFAULT 1,
    capacity_species TEXT,
    capacity_size TEXT,
    capacity_gender TEXT,
    address_fuzzy TEXT,
    district TEXT,
    experience TEXT,
    special_services TEXT,
    daily_rate_cents INTEGER,
    is_verified INTEGER DEFAULT 0,
    is_sponsored INTEGER DEFAULT 0,
    sponsored_by TEXT,
    total_reviews INTEGER DEFAULT 0,
    avg_rating REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  // --- host_availability ---
  `CREATE TABLE IF NOT EXISTS host_availability (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    note TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  // --- pets ---
  `CREATE TABLE IF NOT EXISTS pets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    species TEXT NOT NULL,
    breed TEXT,
    gender TEXT,
    age TEXT,
    weight TEXT,
    personality TEXT,
    health_notes TEXT,
    daily_habits TEXT,
    special_needs TEXT,
    cover_key TEXT,
    photos TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  // --- needs ---
  `CREATE TABLE IF NOT EXISTS needs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    pet_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    expected_area TEXT,
    expected_price_cents INTEGER,
    description TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  // --- orders ---
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    need_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    pet_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    duration_days INTEGER NOT NULL,
    total_price_cents INTEGER,
    address TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    accepted_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,
  // --- reviews ---
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    order_id TEXT UNIQUE NOT NULL,
    reviewer_id TEXT NOT NULL,
    reviewee_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    content TEXT,
    tags TEXT,
    photos TEXT,
    created_at TEXT NOT NULL
  )`,
  // --- blacklist ---
  `CREATE TABLE IF NOT EXISTS blacklist (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    category TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    handled_at TEXT,
    handled_by TEXT
  )`,
  // --- sponsors ---
  `CREATE TABLE IF NOT EXISTS sponsors (
    id TEXT PRIMARY KEY,
    sponsor_id TEXT NOT NULL,
    sponsored_host_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  // --- notifications ---
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    body TEXT,
    link TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  // --- invite_codes ---
  `CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    owner_id TEXT,
    used_by TEXT,
    created_at TEXT NOT NULL,
    used_at TEXT
  )`,
  // --- sessions ---
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  // --- Indexes ---
  `CREATE INDEX IF NOT EXISTS idx_host_availability_host_date ON host_availability(host_id, start_date, end_date)`,
  `CREATE INDEX IF NOT EXISTS idx_needs_status_date ON needs(status, start_date)`,
  `CREATE INDEX IF NOT EXISTS idx_needs_owner ON needs(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_host ON orders(host_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_created ON reviews(reviewee_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read)`,
  `CREATE INDEX IF NOT EXISTS idx_blacklist_status ON blacklist(status)`,
  `CREATE INDEX IF NOT EXISTS idx_blacklist_reporter ON blacklist(reporter_id)`,
  `CREATE INDEX IF NOT EXISTS idx_blacklist_target ON blacklist(target_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_blacklist_reporter_target_status ON blacklist(reporter_id, target_user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invite_codes_owner ON invite_codes(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by)`,
];

// ============ 自动建表 ============
async function ensureDatabase(env) {
  if (dbReady || initializing) return;
  try {
    // 检测 users 表是否存在（sqlite_master 查询，本地 D1 也支持）
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).first();
    if (result) {
      // 用户表已存在（可能是老 schema）→ 运行 blacklist 迁移
      await migrateBlacklistSchema(env.DB);
      dbReady = true;
      return;
    }

    initializing = true;
    console.log("[middleware] 首次访问，初始化数据库 schema…");

    // 逐条执行 schema（D1 不支持事务，逐条执行即可）
    for (const sql of SCHEMA_STATEMENTS) {
      await env.DB.prepare(sql).run();
    }

    // 播种 admin 账号
    await seedAdmin(env.DB);
    // 播种 10 个初始邀请码
    await seedInviteCodes(env.DB, 10);

    console.log("[middleware] 数据库初始化完成（admin + 10 邀请码）");
    dbReady = true;
  } catch (err) {
    console.error("[middleware] 数据库初始化失败:", err);
  } finally {
    initializing = false;
  }
}

// ============ Blacklist 表迁移（Task 13）============
// 检测 blacklist 表是否为老 schema（reported_id/reason/evidence/status='active'）
// 若是，DROP 并用新 schema 重建（老表无数据，安全）
// 新 schema: id, reporter_id, target_user_id, target_type, category, details,
//            status('pending'/'confirmed'/'dismissed'), created_at, handled_at, handled_by
async function migrateBlacklistSchema(db) {
  try {
    const cols = await db.prepare("PRAGMA table_info(blacklist)").all();
    const names = (cols.results || []).map(r => r.name);
    const isOldSchema = names.includes("reported_id") || names.includes("evidence");
    if (!isOldSchema) return;
    console.log("[middleware] 检测到 blacklist 老 schema，迁移中…");
    await db.prepare("DROP TABLE IF EXISTS blacklist").run();
    await db.prepare(
      `CREATE TABLE blacklist (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        category TEXT NOT NULL,
        details TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        handled_at TEXT,
        handled_by TEXT
      )`
    ).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_blacklist_status ON blacklist(status)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_blacklist_reporter ON blacklist(reporter_id)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_blacklist_target ON blacklist(target_user_id)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_blacklist_reporter_target_status ON blacklist(reporter_id, target_user_id, status)").run();
    console.log("[middleware] blacklist 表迁移完成");
  } catch (e) {
    console.error("[middleware] blacklist 迁移失败:", e);
  }
}

// ============ Seed: admin 账号 ============
async function seedAdmin(db) {
  const salt = genSalt(16);
  const hash = await hashPassword("admin123", salt);
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO users (id, phone, password_hash, password_salt, nickname, role, created_at, updated_at)
     VALUES (?, 'admin', ?, ?, '管理员', 'admin', ?, ?)`
  ).bind(crypto.randomUUID(), hash, salt, now, now).run();
  console.log("[middleware] 已播种 admin 账号 (admin / admin123)");
}

// ============ Seed: 初始邀请码 ============
async function seedInviteCodes(db, count) {
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    const code = generateInviteCode();
    await db.prepare(
      "INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?, ?, ?)"
    ).bind(code, null, now).run();
  }
  console.log(`[middleware] 已播种 ${count} 个初始邀请码`);
}

// ============ Session 解析 ============
async function resolveUser(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  const session = await env.DB.prepare(
    `SELECT s.token, s.user_id, s.expires_at, u.*
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = ?`
  ).bind(token).first();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}

// ============ /api/stats 内联 handler（Task 15）============
// wrangler pages dev 的文件监视器不检测新建目录，
// 故在此内联实现；生产部署后由 functions/api/stats/index.js 接管。
async function handleStats(request, env) {
  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "database unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  async function count(sql) {
    try {
      const row = await db.prepare(sql).first();
      if (!row) return 0;
      const v = row.value;
      return Number.isFinite(v) ? v : 0;
    } catch (err) {
      return 0;
    }
  }

  const [hosts, pets, needs, orders, reviews, todayOrders] = await Promise.all([
    count("SELECT COUNT(*) AS value FROM host_profiles WHERE is_verified = 1"),
    count("SELECT COUNT(*) AS value FROM pets"),
    count("SELECT COUNT(*) AS value FROM needs WHERE status = 'open' OR status = 'matched'"),
    count("SELECT COUNT(*) AS value FROM orders WHERE status != 'cancelled'"),
    count("SELECT COUNT(*) AS value FROM reviews"),
    count("SELECT COUNT(*) AS value FROM orders WHERE date(created_at) = date('now','localtime')"),
  ]);

  return new Response(JSON.stringify({
    hosts, pets, needs, orders, reviews, todayOrders,
    today: todayOrders, // 别名：首页看板「今日新单」历史字段名
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ============ 主入口 ============
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get("origin") || "*";

  // 1. CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // 2. 首访自动建表（仅 /api/* 路径）
  if (url.pathname.startsWith("/api/")) {
    await ensureDatabase(env);
  }

  // 3. Session 注入（仅 /api/* 路径）
  // 注：Pages Functions 的 context.next() 不跨层级共享 request/user 属性，
  //     handler 需自行调用 requireUser() 检查 session
  //     此处注入仅供日志和调试参考，不依赖
  if (url.pathname.startsWith("/api/")) {
    try {
      const user = await resolveUser(request, env);
      if (user) request.user = user;
    } catch (err) {
      console.error("[middleware] Session 解析失败:", err);
    }
  }

  // 4. 内联 /api/stats handler（wrangler pages dev 不检测新目录，
  //    故在 middleware 内联处理；生产部署后此分支可移除，由
  //    functions/api/stats/index.js 接管）
  if (url.pathname === "/api/stats" && request.method === "GET") {
    return handleStats(request, env);
  }

  // 5. 调用 next handler
  const response = await context.next();

  // 5.1 未知 /api/* 路径兜底：Pages 静态层会把未命中路由回退成 index.html(200)，
  //     这里统一转成 JSON 404，避免 API 客户端误收 HTML
  if (url.pathname.startsWith("/api/")) {
    const ct = response.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      const json404 = new Response(JSON.stringify({ error: "接口不存在" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
      json404.headers.set("Access-Control-Allow-Origin", origin);
      json404.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      json404.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return json404;
    }
  }

  // 6. CORS headers
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.headers.set("Access-Control-Max-Age", "86400");

  return response;
}
