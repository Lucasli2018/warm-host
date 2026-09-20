-- warm-host migrations/0000_init.sql
-- D1 全量初始化迁移（首次部署）
-- 内容同 schema.sql（全量快照）
-- 生成日期：2026-09-20

-- ============================================================
-- 3.1 users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
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
);

-- ============================================================
-- 3.2 host_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS host_profiles (
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
);

-- ============================================================
-- 3.3 host_availability
-- ============================================================
CREATE TABLE IF NOT EXISTS host_availability (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  note TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ============================================================
-- 3.4 pets
-- ============================================================
CREATE TABLE IF NOT EXISTS pets (
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
);

-- ============================================================
-- 3.5 needs（寄养需求）
-- ============================================================
CREATE TABLE IF NOT EXISTS needs (
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
);

-- ============================================================
-- 3.6 orders（撮合后的订单）
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
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
);

-- ============================================================
-- 3.7 reviews
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewee_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  content TEXT,
  tags TEXT,
  photos TEXT,
  created_at TEXT NOT NULL
);

-- ============================================================
-- 3.8 blacklist
-- ============================================================
CREATE TABLE IF NOT EXISTS blacklist (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  reason TEXT,
  evidence TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

-- ============================================================
-- 3.9 sponsors
-- ============================================================
CREATE TABLE IF NOT EXISTS sponsors (
  id TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,
  sponsored_host_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ============================================================
-- 3.10 notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  link TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- ============================================================
-- 3.11 invite_codes
-- ============================================================
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  owner_id TEXT,
  used_by TEXT,
  created_at TEXT NOT NULL,
  used_at TEXT
);

-- ============================================================
-- 3.12 sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_host_availability_host_date
  ON host_availability(host_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_needs_status_date
  ON needs(status, start_date);
CREATE INDEX IF NOT EXISTS idx_needs_owner
  ON needs(owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_owner
  ON orders(owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_host
  ON orders(host_id);
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_created
  ON reviews(reviewee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_invite_codes_owner
  ON invite_codes(owner_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by
  ON invite_codes(used_by);
