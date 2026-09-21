# 暖木家 warm-host

> 让每一次寄养都有温度 —— 宠物寄养匹配 MVP

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
├── tests/                  # Node.js 集成测试（probe-task*.js + probe.js 总跑器）
├── docs/                   # design.md（733 行完整设计）+ 实施计划
├── tools/clean-css.js      # style.css 编码清理工具（一次性）
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

```bash
# 保持 wrangler dev 在 8787 运行，然后：
node tests/probe.js        # 全量回归（14 套件，1000+ 断言）
node tests/probe-task12.js # 单套件
```

测试脚本通过 HTTP 打真实 API：注册/审核/下单/状态机/评价/担保/黑名单/通知全链路。

## 部署到 Cloudflare

```bash
# 1. 创建资源
wrangler d1 create warm-host-db          # 把返回的 database_id 填进 wrangler.toml
wrangler r2 bucket create warm-host-images

# 2. 部署（Pages Functions 自动包含 functions/ 目录）
wrangler pages deploy public --project-name warm-host
```

首次访问时 `_middleware.js` 自动建表 + 播种 admin（**生产环境请立即修改 admin 密码**）。

## 安全设计要点

- 密码 HMAC-SHA256 + 16 字节盐，Session 24h 过期
- 寄养人实名认证（身份证号存 R2，仅本人与 admin 可见）
- 首单担保：担保人需 `完成 ≥3 单 且 平均评分 ≥4.5`
- 黑名单确认后：搜索/需求列表自动过滤 + 可选封号；公开名单脱敏（手机后 4 位、昵称打码）
- 下单原子性：D1 无事务，用 `INSERT ... SELECT ... WHERE NOT EXISTS` + `meta.changes` 防并发重复接单
- 注册限流：同 IP 15 分钟 20 次

## License

MIT
