// 线上冒烟测试（只读接口，不写数据）
//
// 用法：
//   node tools/live-smoke.mjs                                  # 默认 https://warm-host.pages.dev
//   node tools/live-smoke.mjs https://master.warm-host.pages.dev
//
// 覆盖：静态页 / 公开接口 / 未登录拒绝 / admin 登录 / 管理接口 / stats。
// admin 初始密码来自 scripts/init-d1.mjs 的播种（生产环境请尽快改密）。

// 本机无 IPv6 出口 + *.pages.dev 有 AAAA 记录 → 不强制 IPv4 会 UND_ERR_CONNECT_TIMEOUT
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const B = (process.argv[2] || "https://warm-host.pages.dev").replace(/\/$/, "");
const ADMIN = { phone: process.env.ADMIN_PHONE || "admin", password: process.env.ADMIN_PASSWORD || "admin123" };

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(B + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

let bad = 0;
const chk = (name, cond, extra = "") => {
  if (!cond) bad++;
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
};

const home = await fetch(B + "/", { signal: AbortSignal.timeout(15000) });
const homeTxt = await home.text();
chk("首页 200 且是应用页面（非 CF 404 页）", (home.status === 200 && homeTxt.includes("暖木家")) || homeTxt.includes("warm-host"));
chk("首页引用了站点图标", homeTxt.includes("/favicon.svg") && homeTxt.includes("apple-touch-icon"));

// 图标资源可达性（含隐式 /favicon.ico 请求）
for (const [path, ctype] of [["/favicon.svg", "svg"], ["/favicon.ico", "icon"], ["/apple-touch-icon.png", "png"]]) {
  const res = await fetch(B + path, { signal: AbortSignal.timeout(15000) });
  chk(`GET ${path}`, res.status === 200 && (res.headers.get("content-type") || "").includes(ctype),
    `${res.status} ${res.headers.get("content-type")}`);
}

const search = await api("GET", "/api/hosts/search");
chk("GET /api/hosts/search（公开）", search.status === 200 && typeof search.data?.total === "number", `total=${search.data?.total}`);

chk("未登录 /api/admin/blacklist → 401", (await api("GET", "/api/admin/blacklist")).status === 401);

const login = await api("POST", "/api/auth/login", { body: ADMIN });
chk(`admin 登录（${ADMIN.phone}）`, login.status === 200 && !!login.data?.token, `status=${login.status}`);
if (login.status !== 200) { console.log("\n登录失败，跳过管理接口检查"); process.exit(1); }
const t = login.data.token;

const me = await api("GET", "/api/auth/me", { token: t });
chk("GET /api/auth/me", me.status === 200 && !!me.data?.user?.id);

const bl = await api("GET", "/api/admin/blacklist?status=all&page=1&pageSize=20", { token: t });
chk("GET /api/admin/blacklist（admin）", bl.status === 200 && Array.isArray(bl.data?.records), `records=${bl.data?.records?.length} pending=${bl.data?.pendingCount}`);

const codes = await api("GET", "/api/admin/invite-codes", { token: t });
chk("GET /api/admin/invite-codes", codes.status === 200, `available=${codes.data?.available}`);

const users = await api("GET", "/api/admin/users?page=1", { token: t });
chk("GET /api/admin/users", users.status === 200 && Array.isArray(users.data?.users), `total=${users.data?.total}`);

const stats = await api("GET", "/api/stats");
chk("GET /api/stats（D1 绑定生效）", stats.status === 200 && typeof stats.data?.hosts === "number", JSON.stringify(stats.data));

console.log(bad ? `\n${bad} 项异常（${B}）` : `\n线上冒烟全部通过（${B}）`);
process.exit(bad ? 1 : 0);
