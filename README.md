# 暖木家 warm-host

> 让每一次寄养都有温度 —— 宠物寄养匹配 MVP

线上：https://warm-host.pages.dev ｜ 管理后台：https://warm-host.pages.dev/admin.html

节假日宠物寄养难找：个人愿意接单，但双方缺信任、缺记录。暖木家用「实名审核 + 首单担保 + 真实评价 + 黑名单公示」四件套解决信任问题。

## 功能

| 角色 | 能力 |
|---|---|
| 宠物主人 | 注册登录（邀请码）、宠物档案、发布寄养需求、搜索寄养人、确认/取消订单、申诉、评价、举报 |
| 寄养人 | 申请寄养（实名+经验）、管理员审核、设置可接单日期、接单（首单需担保人）、开始/完成寄养、担保新人 |
| 管理员 | 寄养人审核、黑名单处理（确认/驳回/封号）、邀请码管理、强制担保（覆盖端点） |

核心闭环：**发布需求 → 寄养人搜索/详情 → 下单 → 确认 → 交接 → 完成 → 双向评价 → 老寄养人担保新人**。

## 技术栈

- **Cloudflare Pages**（静态托管）+ **Pages Functions**（后端 API，zero-build）
- **D1**（SQLite 数据库，12 张表）+ **R2**（头像/宠物/评价图片）
- 前端：纯 HTML/CSS/JS，零构建，Mobile-first，底部 Tab 导航
- 鉴权：HMAC-SHA256 加盐密码 + 32 字节 hex Session Token（24h），`Authorization: Bearer <token>`

## 目录结构

```
warm-host/
├── functions/              # Pages Functions（API）
│   ├── _middleware.js      #   自动建表 + 种子数据（admin/admin123 + 邀请码）+ CORS
│   ├── _shared/            #   helpers / crypto / notify
│   └── api/
│       ├── auth/           #   register login logout me invite-codes
│       ├── users/          #   资料 / 头像 / 实名
│       ├── pets/           #   宠物 CRUD + 照片
│       ├── hosts/          #   apply / search / [id] / reviews / availability / [id]/book
│       ├── needs/          #   需求发布与管理
│       ├── orders/         #   my / [id] / [id]/status / [id]/review
│       ├── sponsors/       #   invite / accept / my（首单担保）
│       ├── blacklist/      #   举报 + 公开黑名单 / my
│       ├── notifications/  #   列表 / 标记已读
│       ├── reviews/        #   评价图片上传 / 读取
│       └── admin/          #   hosts 审核 / users 封禁 / invite-codes / blacklist / sponsor(覆盖)
├── public/                 # 静态前端
│   ├── index.html          #   首页（数据看板 + 搜索 + 信任机制说明）
│   ├── hosts.html          #   寄养人搜索列表
│   ├── host-detail.html    #   寄养人详情 + 评价
│   ├── my.html             #   个人中心（宠物/需求/订单/寄养 4 Tab）
│   ├── admin.html          #   管理后台
│   └── js/                 #   api.js / app.js(底部Tab) / notifications.js / pages/*
├── tests/                  # 集成测试（probe-task*.js + probe.js 总跑器 + 13b 前端静态契约）
├── scripts/                # init-d1.mjs（远端 D1 初始化）/ gen-seed-sql.mjs（生成播种 SQL）
├── tools/                  # reset-dev / seed-dev / seed-demo / gen-icons / health-check /
│                           #   run-suites / live-smoke / fix-pages-branch / clean-css（一次性）
├── docs/                   # design.md（733 行完整设计）+ 实施计划
└── wrangler.toml
```

## 本地开发

前置：Node 18+、wrangler 4.x（`npm i -g wrangler`）。

```bash
cd warm-host
wrangler pages dev --port 8787 --persist-to ./.wrangler-dev
# 打开 http://localhost:8787
```

首次启动自动建表并播种：`admin / admin123` + 10 个邀请码。注册需要邀请码（登录 admin 后台可生成更多）。

> 已知坑：若 `.wrangler/tmp` 目录权限损坏（Access denied），删除整个 `.wrangler` 后重启即可；
> wrangler pages dev 不监听**新建** functions 目录，新增目录需重启。

## 测试

回归套件打真实 HTTP 接口，覆盖注册/审核/下单/状态机/评价/担保/黑名单/通知全链路。

```bash
# 1) 一键重置本地环境（清库 + 预置 schema + 播种 admin/邀请码）
PERSIST=./.wrangler-clean node tools/reset-dev.mjs

# 2) 启动 dev（务必带 DISABLE_RATE_LIMIT，否则 20 次/15 分钟的注册限流会让后半程假红）
node D:/npm-global/node_modules/wrangler/bin/wrangler.js pages dev \
     --port 8787 --persist-to ./.wrangler-clean --binding DISABLE_RATE_LIMIT=1

# 3) 前置种子：把 admin 变成「已通过审核的寄养人」（部分套件的隐含依赖）
node tools/seed-dev.mjs

# 4) 健康检查（区分「端口被僵尸 workerd 占住」）
node tools/health-check.mjs

# 5) 全量 / 单套件
node tests/probe.js             # 16 套件（含 13b 前端静态契约）
node tests/probe-task12.js      # 单套件
node tools/run-suites.mjs 10a   # 逐套件跑 + 打印耗时（诊断卡点用）
```

> **坑 1**：`wrangler pages dev` 被强杀后 workerd 会变孤儿继续占着端口，此时**连静态页都超时**
> 但日志仍显示 Ready —— 用 `tools/health-check.mjs` 一眼看出。
> **坑 2**：worker runtime 崩溃（`crash #1`，多发生在改了 `functions/` 触发热重载后）重启会「假活」，
> 端口在听、请求全超时。两种情况都必须**整棵进程树杀掉重启**，只杀 workerd 不够：
> ```powershell
> Get-CimInstance Win32_Process -Filter "name='node.exe'" |
>   Where-Object { $_.CommandLine -match '--port 8787' } |
>   ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
> ```

## 演示数据

```bash
node tools/seed-demo.mjs                              # 本地
node tools/seed-demo.mjs https://warm-host.pages.dev  # 线上
```

生成内容（走真实 API，故订单状态机、评分聚合、黑名单过滤都是真实链路产物）：

| 内容 | 数量 |
|---|---|
| 账号（5 寄养人 + 6 主人，密码 `demo123456`） | 11 |
| 宠物档案 | 7 |
| 已完成订单 + 评价（5 星为主，含 1 条 4 星） | 8 + 8 |
| 进行中订单 / 待接单需求 | 1 / 3 |
| 举报（1 条确认并封号→公示、1 条待处理） | 2 |

> 脚本**不幂等**，重复运行会新建账号。线上注册限流为同 IP 15 分钟 20 次，脚本注册 11 个账号，一次跑完即可。

## 站点图标

`public/favicon.svg`（手写矢量：木棕圆角底 + 奶油色小屋 + 珊瑚橘爪印）是唯一源文件，
位图由脚本生成，改完后重新执行：

```bash
node tools/gen-icons.mjs     # 需要本机 Chrome，产出 apple-touch-icon.png + favicon.ico(PNG-in-ICO)
```

7 个页面均已引用 `favicon.svg` / `favicon.ico` / `apple-touch-icon.png` 并带 `theme-color`。

## 部署到 Cloudflare

### 方式 A：一键初始化脚本（推荐）

```bash
# 令牌：CLOUDFLARE_API_TOKEN（需 Account → D1 → Edit）或 TOKEN_FILE=<文件路径>
TOKEN_FILE=./.cf-token node scripts/init-d1.mjs --create
```

脚本做的事：建 D1 库（`--create`）→ 按序执行 `migrations/*.sql` → 播种 admin + 10 个邀请码
→ 自检（12 表 / 14 索引 / 行数 / admin 密码哈希回算）。幂等，可重复执行；`--check` 只自检不写库。

> **为什么必须跑它**：`_middleware.js` 的自动建表只在「users 表不存在」时播种 admin。
> 若先用本脚本建好表，middleware 会跳过播种 → 线上没有管理员账号。

### 方式 B：手动 wrangler

```bash
wrangler d1 create warm-host-db          # 把返回的 database_id 填进 wrangler.toml
wrangler r2 bucket create warm-host-images
wrangler pages deploy public --project-name warm-host
```

R2 桶名 `warm-host-images`，D1 库名 `warm-host-db`，`database_id` 已写入 `wrangler.toml`。

> 部署前若 CF API 请求超时，加 `NODE_OPTIONS=--dns-result-order=ipv4first`（本机无 IPv6 出口）。

### 部署后验证

```bash
node tools/live-smoke.mjs                       # 线上只读冒烟：首页/公开接口/401/admin 登录/管理接口/D1
node tools/fix-pages-branch.mjs                 # 查 Pages 项目配置（生产分支、D1/R2 binding、最近部署）
node tools/fix-pages-branch.mjs --fix           # 生产分支不是 master 时修正，然后重新 deploy
```

> **坑**：Pages 项目的 `production_branch` 必须为 `master`（当前项目已修正）。否则 master 上的部署会落进
> **preview 环境**：deployment URL 与 `master.warm-host.pages.dev` 都正常，但生产域名 `warm-host.pages.dev`
> 返回 CF 404 HTML（约 16KB），且生产环境的 D1/R2 binding 为空。

**生产环境首次登录后请立即修改 admin 密码**（当前为 `admin / admin123`）。

## 安全设计要点

- 密码 HMAC-SHA256 + 16 字节盐，Session 24h 过期
- 寄养人实名认证（身份证号存 R2，仅本人与 admin 可见）
- 首单担保：担保人需 `完成 ≥3 单 且 平均评分 ≥4.5`
- 黑名单确认后：搜索/需求列表自动过滤 + 可选封号；公开名单脱敏（手机后 4 位、昵称打码）
- 下单原子性：D1 无事务，用 `INSERT ... SELECT ... WHERE NOT EXISTS` + `meta.changes` 防并发重复接单
- 注册限流：同 IP 15 分钟 20 次

## License

MIT
