# warm-host · 设计文档

> 宠物寄养 / 遛狗匹配 MVP · Cloudflare Pages + Functions + D1 + R2
> 立项日期：2026-09-20
> 状态：设计已定稿，待实施

---

## 0. 项目定位

**痛点**：节假日宠物寄养难找，个人愿意接单，但缺少信任和记录。

**MVP 定位**：同城小范围、社群冷启动、纯信息撮合（无支付），核心解决"信任 + 记录"。

**不做**（明确排除）：
- 支付集成（微信/支付宝/担保金托管）→ v2
- 自动算法匹配（时间+距离推荐）→ v2
- 短信/邮件/推送通知 → v2
- 遛狗（按次/按天）→ v2
- 手机号验证码、找回密码 → v2
- 完整 OCR 身份证识别 → v2（MVP 只上传不校验）

---

## 1. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | 纯 HTML + CSS + 原生 JS，零构建 | 延续 shop-booking 模式 |
| 后端 | Cloudflare Pages Functions | 按资源分路由 |
| 数据库 | Cloudflare D1 (SQLite) | 12 张表 |
| 对象存储 | Cloudflare R2 | 头像、宠物照片、身份证、评价图 |
| 鉴权 | 手机号 + 密码 + Session（HMAC-SHA256 + salt） | 复用 shop-booking `_shared/crypto.js` |
| UI 风格 | "暖木家"（见 §8） | 全新设计，不套 shop-booking 视觉 |

---

## 2. 项目结构

```
F:\LLM\warm-host\
├── wrangler.toml            # Cloudflare Pages 配置
├── schema.sql               # D1 全量快照
├── migrations/              # D1 增量迁移
│   ├── 0000_init.sql
│   └── ...
├── README.md                # 部署文档
├── docs/
│   └── design.md            # 本文档
├── tests/
│   └── probe.js             # Node22 原生 WebSocket + CDP 页面探针
├── functions/
│   ├── _middleware.js       # CORS + 首访自动建表 + Session 注入
│   ├── _shared/
│   │   ├── crypto.js        # HMAC-SHA256 密码 hash、token 生成
│   │   └── helpers.js       # JSON 响应、时间工具
│   ├── _lib/
│   │   └── email.js         # Resend 邮件（可插拔，未配置则跳过）
│   └── api/
│       ├── auth/
│       │   ├── register.js
│       │   ├── login.js
│       │   ├── logout.js
│       │   └── me.js
│       ├── users/
│       │   ├── [id].js               # GET 公开信息
│       │   ├── me.js                 # PUT 更新资料
│       │   └── me/
│       │       ├── photo.js          # POST 上传头像
│       │       └── verify-id.js      # POST 上传身份证
│       ├── hosts/
│       │   ├── search.js
│       │   ├── [id].js
│       │   ├── [id]/reviews.js
│       │   ├── [id]/availability.js
│       │   ├── me.js
│       │   └── me/availability.js
│       ├── pets/
│       │   ├── my.js
│       │   ├── [id].js
│       │   └── [id]/photos.js
│       ├── needs/
│       │   ├── index.js
│       │   ├── my.js
│       │   └── [id].js
│       ├── orders/
│       │   ├── my.js
│       │   ├── [id].js
│       │   ├── [id]/status.js
│       │   └── [id]/review.js
│       ├── sponsors/
│       │   ├── invite.js
│       │   └── accept.js
│       ├── blacklist/
│       │   ├── index.js
│       │   ├── my.js
│       │   └── [id].js
│       ├── notifications/
│       │   └── index.js
│       └── admin/
│           ├── hosts.js
│           ├── hosts/[id].js
│           ├── users.js
│           ├── users/[id].js
│           ├── blacklist/[id].js
│           └── invite-codes.js
└── public/
    ├── index.html           # 首页（Hero + 搜索 + 推荐）
    ├── hosts.html           # 寄养人列表
    ├── host-detail.html     # 寄养人详情
    ├── my.html              # 我的（宠物/需求/订单/寄养 4 Tab）
    ├── auth.html            # 登录 / 注册
    ├── admin.html           # 平台管理
    ├── css/style.css        # 全新样式（"暖木家"风格）
    └── js/
        ├── api.js           # API client + 全局工具
        ├── app.js           # 路由守卫、Session 检查、Tab 切换
        └── pages/           # 每页专属逻辑
            ├── home.js
            ├── hosts.js
            ├── host-detail.js
            ├── my.js
            ├── auth.js
            └── admin.js
```

**与 shop-booking 的复用点**：`_middleware.js`（自动建表 + Session 注入模式）、`_shared/crypto.js`、`_shared/helpers.js`、`_lib/email.js`、`tests/probe.js`、README 结构、部署流程。

**清理项**：移除 `shop_code` 相关字段；重命名领域概念（shops→hosts、services→pets、bookings→orders）。

---

## 3. 数据模型（12 表）

### 3.1 users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar_key TEXT,
  is_owner INTEGER DEFAULT 1,           -- 是否为宠物主人
  is_host INTEGER DEFAULT 0,            -- 是否为寄养人（需审核）
  host_status TEXT DEFAULT 'pending',   -- pending/active/suspended/rejected
  real_name TEXT,
  id_card_key TEXT,
  id_card_verified INTEGER DEFAULT 0,
  emergency_contact TEXT,
  bio TEXT,
  city TEXT DEFAULT '同城',
  invited_by TEXT,                      -- 用谁的邀请码注册的（users.id）
  role TEXT DEFAULT 'user',             -- user / admin
  banned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
```

### 3.2 host_profiles

```sql
CREATE TABLE host_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  bio TEXT,
  capacity_count INTEGER DEFAULT 1,
  capacity_species TEXT,                -- JSON: ["猫","狗"]
  capacity_size TEXT,                   -- JSON: ["小型","中型"]
  capacity_gender TEXT,                 -- JSON: ["公","母"]
  address_fuzzy TEXT,
  district TEXT,
  experience TEXT,
  special_services TEXT,                -- JSON: ["可上门接送","宠物医院合作"]
  daily_rate_cents INTEGER,
  is_verified INTEGER DEFAULT 0,
  is_sponsored INTEGER DEFAULT 0,
  sponsored_by TEXT,
  total_reviews INTEGER DEFAULT 0,
  avg_rating REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
```

### 3.3 host_availability

```sql
CREATE TABLE host_availability (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  start_date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  end_date TEXT NOT NULL,
  note TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
```

### 3.4 pets

```sql
CREATE TABLE pets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL,                -- 猫/狗/兔/其他
  breed TEXT,
  gender TEXT,                          -- 公/母/未知
  age TEXT,
  weight TEXT,
  personality TEXT,                     -- JSON: ["友善","粘人"]
  health_notes TEXT,
  daily_habits TEXT,
  special_needs TEXT,
  cover_key TEXT,
  photos TEXT,                          -- JSON: [R2 keys]
  created_at TEXT NOT NULL,
  updated_at TEXT
);
```

### 3.5 needs（寄养需求）

```sql
CREATE TABLE needs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  pet_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  expected_area TEXT,
  expected_price_cents INTEGER,
  description TEXT,
  status TEXT DEFAULT 'open',           -- open/matched/filled/cancelled/expired
  created_at TEXT NOT NULL,
  updated_at TEXT
);
```

### 3.6 orders（撮合后的订单）

```sql
CREATE TABLE orders (
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
  status TEXT DEFAULT 'pending',        -- pending/accepted/in_progress/completed/cancelled/disputed
  notes TEXT,
  accepted_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
```

### 3.7 reviews

```sql
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewee_id TEXT NOT NULL,
  rating INTEGER NOT NULL,              -- 1-5
  content TEXT,
  tags TEXT,                            -- JSON: ["宠物友好","沟通顺畅"]
  photos TEXT,                          -- JSON: [R2 keys]
  created_at TEXT NOT NULL
);
```

### 3.8 blacklist

```sql
CREATE TABLE blacklist (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  reason TEXT,
  evidence TEXT,
  status TEXT DEFAULT 'active',         -- active/removed
  created_at TEXT NOT NULL
);
```

### 3.9 sponsors

```sql
CREATE TABLE sponsors (
  id TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL,
  sponsored_host_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### 3.10 notifications

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,                   -- order_accepted/review/sponsor_invite/host_approved/banned 等
  title TEXT,
  body TEXT,
  link TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
```

### 3.11 invite_codes

```sql
CREATE TABLE invite_codes (
  code TEXT PRIMARY KEY,                -- 6 位大写字母+数字，不含易混淆字符
  owner_id TEXT,                        -- 生成者（NULL 为 admin 初始码）
  used_by TEXT,                         -- 使用者
  created_at TEXT NOT NULL,
  used_at TEXT
);
```

### 3.12 sessions

```sql
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

**索引**：
- `users(phone)` 已 UNIQUE
- `host_profiles(user_id)` UNIQUE
- `host_availability(host_id, start_date, end_date)` 用于时间匹配查询
- `needs(status, start_date)`, `needs(owner_id)`
- `orders(owner_id)`, `orders(host_id)`, `orders(status)`
- `reviews(reviewee_id, created_at)`, `reviews(order_id)` UNIQUE
- `notifications(user_id, read)`
- `invite_codes(owner_id)`, `invite_codes(used_by)`

---

## 4. 鉴权与权限

### 4.1 注册流程

1. 用户填手机号 + 密码 + 昵称 + **邀请码**（必填，冷启动期强制）
2. 后端生成 3 个新邀请码分配给新用户
3. 默认 `is_owner=1`，`is_host=0`（想成为寄养人需另走申请）

### 4.2 登录

- 手机号 + 密码，HMAC-SHA256(password, salt) 校验
- 内存 rate-limit：同 IP 15 分钟最多 20 次（429）
- Session：32 字节 hex token（`crypto.getRandomValues`），存 D1，24 小时过期

### 4.3 权限矩阵

| 能力 | is_owner | is_host (active) | role=admin |
|---|---|---|---|
| 建宠物档案 | ✅ | — | — |
| 发寄养需求 | ✅ | — | — |
| 建寄养人档案 | — | ✅ | — |
| 接单 | — | ✅ | — |
| 审核寄养人 | — | — | ✅ |
| 处理黑名单 | — | — | ✅ |
| Ban 用户 | — | — | ✅ |

### 4.4 寄养人认证流程

用户填寄养人档案 → `host_status = pending` → admin 审核 → `active` / `rejected`。
首单前需担保人（见 §6）。

### 4.5 Session 中间件

`_middleware.js` 每个 `/api/*` 请求：
1. 解析 `Authorization: Bearer <token>`
2. 查 `sessions` 表，未找到或过期 → 401
3. 注入 `request.user` 到上下文
4. 端点自行检查 `user.role` / `user.is_host` / `user.host_status`

### 4.6 首次部署初始化（admin 账号 + 初始邀请码）

`_middleware.js` 首访自动建表后，检测 `users` 表是否为空：
1. 若为空，播种一个默认 admin 账号：手机号 `admin` / 密码 `admin123`（首次登录后在后台修改）
2. 同时生成 **10 个初始邀请码**（存 `users` 表 `invite_code` 列的预留位，或额外建 `invite_codes` 表）
3. 邀请码格式：6 位大写字母 + 数字（不含易混淆字符 O/0/I/1），如 `A7K9M2`
4. 每用户注册成功自动生成 3 个新邀请码
5. 初始邀请码用完后，通过 admin 后台手动补充

> 与 shop-booking 的默认 `admin/admin123` 模式一致，首次登录后务必修改密码。

---

## 5. API 清单（46 端点）

### Auth（公开）
- `POST /api/auth/register` — 注册，body: `{phone, password, nickname, inviteCode}`
- `POST /api/auth/login` — 登录，返回 token
- `POST /api/auth/logout` — 退出（需 token）
- `GET  /api/auth/me` — 当前用户信息

### My Invite Codes（需登录）
- `GET  /api/auth/invite-codes` — 我的邀请码列表（含已用/未用状态）
- `POST /api/auth/invite-codes/regenerate` — 已用完时申请补充（有配额限制）

### Users（需登录）
- `PUT  /api/users/me` — 更新资料
- `POST /api/users/me/photo` — 上传头像（multipart, 5MB, jpg/png/webp）
- `POST /api/users/me/verify-id` — 上传身份证照片（multipart）
- `GET  /api/users/[id]` — 用户公开信息（昵称/头像/评分聚合）

### Hosts（公开搜索）
- `GET  /api/hosts/search?from=&to=&district=&species=&size=&sort=` — 按日期/区域/品种/容量筛选
- `GET  /api/hosts/[id]` — 寄养人详情（含档案）
- `GET  /api/hosts/[id]/reviews` — 评价列表
- `GET  /api/hosts/[id]/availability?from=&to=` — 该区间可接单日期

### Host Profiles（需登录 + is_host + host_status=active）
- `POST /api/hosts/me` — 创建/更新寄养档案
- `PUT  /api/hosts/me/availability` — 批量更新可接单日期

### Pets（需登录）
- `POST   /api/pets` — 创建
- `GET    /api/pets/my` — 我的宠物列表
- `GET    /api/pets/[id]` — 宠物详情
- `PUT    /api/pets/[id]` — 更新
- `DELETE /api/pets/[id]` — 删除
- `POST   /api/pets/[id]/photos` — 添加照片

### Needs（需登录 + is_owner）
- `POST   /api/needs` — 发布需求
- `GET    /api/needs/my` — 我的需求
- `GET    /api/needs` — 公开需求列表（供寄养人浏览）
- `GET    /api/needs/[id]` — 详情
- `PUT    /api/needs/[id]` — 更新（仅 open 状态）
- `DELETE /api/needs/[id]` — 取消

### Orders（需登录）
- `POST /api/hosts/[id]/book` — 基于 need 或直连创建订单（寄养人接单）
- `GET  /api/orders/my` — 我的订单（role: owner / host 切换）
- `GET  /api/orders/[id]` — 订单详情
- `POST /api/orders/[id]/status` — 状态变更，body: `{action}`
- `POST /api/orders/[id]/review` — 提交评价

### Sponsors（需登录）
- `POST /api/sponsors/invite` — 寄养人邀请担保人，body: `{sponsorUserId}`
- `POST /api/sponsors/accept` — 担保人接受邀请

### Blacklist（需登录）
- `POST /api/blacklist` — 举报
- `GET  /api/blacklist/my` — 我的举报
- `GET  /api/blacklist` — 公开黑名单（用户可查是否被拉黑）

### Notifications（需登录）
- `GET  /api/notifications` — 通知列表
- `POST /api/notifications/read` — 标记已读

### Admin（需 role=admin）
- `GET  /api/admin/hosts` — 寄养人审核列表（默认 pending）
- `POST /api/admin/hosts/[id]/verify` — 通过认证
- `POST /api/admin/hosts/[id]/reject` — 拒绝
- `GET  /api/admin/users` — 用户管理
- `POST /api/admin/users/[id]/ban` — Ban 用户
- `POST /api/admin/blacklist/[id]/remove` — 移除黑名单
- `GET  /api/admin/invite-codes` — 邀请码池状态
- `POST /api/admin/invite-codes/generate` — 批量生成邀请码，body: `{count}`

---

## 6. 状态机

### 6.1 Needs 状态机

```
open → matched      （寄养人接单）
open → cancelled    （主人主动取消）
open → expired      （超过 30 天未匹配，运行时惰性检查）
matched → filled    （主人确认成交，创建 order）
matched → cancelled （主人改需求或取消）
```

### 6.2 Orders 状态机

```
pending      → accepted       （主人确认）
pending      → cancelled      （任一方取消）
accepted     → in_progress    （交接完成，开始寄养）
accepted     → cancelled      （任一方取消）
in_progress  → completed      （寄养结束）
in_progress  → disputed       （一方申请争议，标记后人工处理）
completed    → (终态)         （触发双向评价邀请）
cancelled    → (终态)
disputed     → (终态)         （v1 只做标记，v2 做仲裁流程）
```

时间戳字段：`accepted_at` / `started_at` / `completed_at` / `cancelled_at`。

### 6.3 寄养人认证

```
提交档案 → pending → active (admin 通过) / rejected (admin 拒绝)
active → suspended (被 Ban 或严重违规)
```

---

## 7. 信任机制（MVP 四件套）

| 机制 | 说明 |
|---|---|
| **实名认证** | 寄养人可选填 `real_name` + 上传身份证照片（存 R2）。MVP **不做 OCR 校验**，只作为"愿意公开身份"的信号。v2 接入腾讯云/阿里云 OCR。 |
| **首单担保** | 新寄养人首单前需 1 名担保人。担保人资格：≥3 单且评分≥4.5。担保关系存 `sponsors` 表。 |
| **双向评价** | 订单 `completed` 后强制双向评价（5 星 + 文字 + 可选图片 + 标签）。评分聚合到 `host_profiles.avg_rating`。 |
| **黑名单** | 举报 → admin 审核 → 生效。举报理由 + 证据文本/R2 keys。 |

**冷启动**：邀请码制度（每用户 3 个）+ 微信群入口（首页 CTA 显示二维码占位图）。

---

## 8. UI 设计 · "暖木家"

### 8.1 设计原则

- **隐喻**：寄养 = 把生命托付给另一个"温暖的家"
- **气质**：温暖、可信赖、家庭感、不幼稚、不冰冷
- **移动优先**：底部 Tab 导航，卡片流，触控友好

### 8.2 色彩系统

| 用途 | 色值 | 说明 |
|---|---|---|
| 主色 | `#8B5E3C` | 深木棕（品牌主色、标题、图标） |
| 主色深 | `#6B4426` | 悬停、按下态 |
| 辅色底 | `#F5E6D3` | 奶油底，用于二级区域 |
| 页面底 | 渐变 `#FBF5EE → #F5EBDD` | 微妙渐变，避免纯白刺眼 |
| 卡片 | `#FFFFFF` | 白底 + 1px 边框 `rgba(139,94,60,0.12)` |
| CTA 主 | `#E8845C` | 珊瑚橘，主按钮 |
| CTA 深 | `#D66E46` | 悬停、按下态 |
| 信任色 | `#6B8E5A` | 森林绿，徽章/评分/已认证 |
| 文字主 | `#3D2817` | 深棕，正文 |
| 文字次 | `#7A6452` | 灰棕，辅助文字 |
| 文字弱 | `#B5A48F` | 占位符、禁用态 |
| 错误 | `#C94C4C` | 红，错误提示 |
| 警告 | `#E8A838` | 琥珀，警告/待审核 |

### 8.3 字体

- 标题：`Noto Serif SC`（思源宋体，温暖、有质感）
- 正文：`Noto Sans SC`（思源黑体，可读性好）
- 数字：`JetBrains Mono` 或系统等宽（评分、价格）
- 字重：400 / 500 / 700
- 字号：正文 15px，标题 18-24px，Hero 28-32px（移动端）

**CDN 加载**：`https://cdn.jsdelivr.net/npm/cn-fontsource` 或 Google Fonts（国内访问需兜底 `sans-serif`）。

### 8.4 间距与圆角

- 基础间距单位：8px（4/8/16/24/32/48）
- 卡片圆角：16px（比 shop-booking 的 12px 更圆润）
- 按钮圆角：12px
- 输入框圆角：10px
- 头像：圆形
- 卡片阴影：`0 4px 12px rgba(139, 94, 60, 0.08)`

### 8.5 图标

- 线性图标：Lucide（`https://unpkg.com/lucide-static`）
- 宠物表情：emoji（🐕 🐈 🐾）作为点缀，不滥用
- 图标尺寸：24px 主图标、16px 内联图标

### 8.6 移动端布局

- **底部 Tab 导航**（固定）：首页 / 寄养人 / 需求 / 我的
- **顶部标题栏**（48px 高）：页面标题 + 返回按钮（详情页）+ 头像/通知入口
- **卡片流**：单列，间距 16px
- **搜索栏**：首页顶部，日期区间 + 品种 + 区域 三个 chip 输入
- **详情页**：图片轮播 + 信息卡 + 评价 + CTA 底部悬浮
- **底部悬浮 CTA**：详情页 "寄养 TA" 按钮，高度 56px + 8px 上下间距

### 8.7 关键组件

- **寄养人卡片**：圆形头像 + 认证徽章（🟢 已认证）+ 昵称 + 星级评分 + 可容纳宠物属性 chip + 参考日费 + "寄养"按钮
- **日历组件**：日视图，绿格=可接、红格=不可接、灰格=不可选，长按选择区间
- **评价卡**：星级 + 内容 + 标签 chip + 图片缩略图 + 评价者头像
- **宠物档案卡**：主图 + 名字 + 品种 + 年龄 + 性别 + 性格标签
- **空状态**：emoji + 引导文案 + 主 CTA

### 8.8 动画

- 卡片入场：淡入 + 上移 8px（0.2s ease-out）
- 按钮按下：缩放 0.98 + 变色
- Tab 切换：内容淡入（0.15s）
- 列表加载更多：骨架屏（1s 后淡出）
- 评分星级：点击时有弹跳

---

## 9. 测试策略

### 9.1 页面探针（复用 shop-booking 模式）

`tests/probe.js`：Node22 原生 WebSocket + CDP，启动 `wrangler pages dev`，模拟真实浏览器流程：

关键路径：
1. 访问 `auth.html` → 注册（含邀请码）→ 登录
2. 建宠物档案 → 上传头像 + 宠物照片
3. 建寄养人档案（走 admin 审核）
4. 发寄养需求 → 浏览寄养人列表（时间筛选）→ 接单
5. 确认订单 → 开始 → 完成 → 双向评价
6. 管理员流程：审核寄养人、Ban 用户、处理黑名单

### 9.2 API 单测（关键路径）

- 状态机转换合法性（非法转换返回 400）
- 权限矩阵校验（越权返回 403）
- 时间匹配查询正确性（`host_availability` 区间覆盖判断）
- 邀请码消耗与生成
- Session 过期与刷新
- 图片上传类型/大小校验

### 9.3 手工验证清单

- [ ] 移动端（iPhone SE 320x568）+ 桌面端（1920x1080）均无布局错乱
- [ ] 首屏加载 < 2s（4G 网络）
- [ ] 图片懒加载
- [ ] 触控友好（按钮 ≥ 44px 高）
- [ ] 表单校验（手机号格式、密码强度、必填项）
- [ ] 错误提示友好（404/401/403/429/500 均有中文文案）

---

## 10. 部署与本地开发

**完全复用 shop-booking 的部署流程**，README 会包含：

1. `npm install -g --allow-scripts=esbuild,workerd wrangler`
2. 创建 D1 数据库 + R2 bucket
3. 修改 `wrangler.toml` 的 `database_id` 和 `bucket_name`
4. 本地：`wrangler pages dev --port 8787 --persist-to ./.wrangler-dev`
5. `_middleware.js` 首次访问自动建表 + seed（admin 账号 + 演示寄养人 + 演示宠物）
6. 生产：`wrangler d1 execute warm-host-db --remote --file=schema.sql`
7. 部署：`wrangler pages deploy . --project-name=warm-host`

**已知坑**（README 会写）：
- Windows 文件锁：用 `--persist-to ./.wrangler-dev` 避免
- `wrangler d1 execute --local` 的 SQLITE_AUTH bug：用 `_middleware.js` 自动建表绕过
- 部署后 D1 空：必须手动 `--remote` 执行 schema.sql

---

## 11. 后续迭代（v2 候选）

按优先级：
1. 支付集成（微信/支付宝，担保金模式）
2. 短信/邮件通知（预约开始提醒、评价邀请、审核结果）
3. 手机号验证码 + 找回密码
4. 完整 OCR 身份证识别 + 活体检测
5. 遛狗（按次匹配，独立数据模型）
6. 多城市部署（city 字段已预留）
7. 算法匹配（时间+距离+评分推荐）
8. 聊天/消息系统（订单双方沟通）
9. 保险（寄养意外险）
10. PWA 安装 + 推送

---

## 12. 里程碑（预计 5 天）

| 阶段 | 内容 | 预计 |
|---|---|---|
| M1 | 骨架 + 鉴权 + 用户表 | 0.5 天 |
| M2 | 宠物档案 + R2 图片 | 0.5 天 |
| M3 | 寄养人档案 + 可接单日期 + admin 审核 | 1 天 |
| M4 | 需求 + 匹配搜索 + 下单 | 1 天 |
| M5 | 订单状态机 + 评价 | 1 天 |
| M6 | 担保 + 黑名单 + 通知 | 0.5 天 |
| M7 | UI 打磨 + 测试 + README + 部署 | 0.5 天 |

---

## 附录 A · 关键 SQL 示例

### 时间匹配查询

```sql
-- 查找在 [from, to] 期间可接单的寄养人
SELECT h.*
FROM host_profiles h
WHERE h.user_id IN (
  SELECT DISTINCT u.id FROM users u
  WHERE u.host_status = 'active'
    AND u.banned = 0
)
AND EXISTS (
  SELECT 1 FROM host_availability a
  WHERE a.host_id = h.id
    AND a.active = 1
    AND a.start_date <= ?  -- from
    AND a.end_date >= ?    -- to
)
ORDER BY h.avg_rating DESC, h.total_reviews DESC;
```

### 评价聚合更新

```sql
UPDATE host_profiles
SET avg_rating = (
  SELECT ROUND(AVG(rating) * 1.0, 1)
  FROM reviews WHERE reviewee_id = ?
),
total_reviews = (
  SELECT COUNT(*) FROM reviews WHERE reviewee_id = ?
)
WHERE user_id = ?;
```
