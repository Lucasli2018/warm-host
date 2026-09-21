// 本地开发/回归种子：把 admin 变成「已通过审核的寄养人」
//
// 为什么需要：回归套件隐含依赖「admin 既是管理员、又是有档案的 active 寄养人」——
//   · probe-task7a 断言 /api/hosts/search 的 total = 非 admin 数 + 1
//   · probe-task10a/10b/11/12/13/14/16/18 用 admin 作为担保人（要求 sponsor.host_status==='active'）
// 生产初始化（scripts/init-d1.mjs）不会这么造数据，所以本地跑回归前先执行本脚本。
//
// 用法（dev server 需先启动）：
//   node tools/seed-dev.mjs [baseUrl]

const B = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(B + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data };
}

const login = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
if (login.status !== 200) {
  console.error("admin 登录失败：", login.status, JSON.stringify(login.data));
  process.exit(1);
}
const token = login.data.token;

const me = await api("GET", "/api/auth/me", { token });
const u = me.data && me.data.user;
if (!u) { console.error("读取 /api/auth/me 失败"); process.exit(1); }

console.log(`admin: id=${u.id} is_host=${u.is_host} host_status=${u.host_status}`);

if (u.host_status === "active") {
  console.log("admin 已是 active 寄养人，无需处理");
  process.exit(0);
}

if (!u.is_host || u.host_status === "rejected" || u.host_status === "suspended") {
  const apply = await api("POST", "/api/hosts/apply", {
    token,
    body: {
      bio: "平台管理员账号（回归测试用）",
      capacity_count: 3,
      capacity_species: ["猫", "狗"],
      capacity_size: ["小型", "中型", "大型"],
      capacity_gender: ["公", "母", "未知"],
      address_fuzzy: "平台自营",
      district: "平台",
      experience: "平台管理员账号，用于回归测试与兜底担保",
      special_services: ["有隔离空间"],
      daily_rate_cents: 10000,
    },
  });
  if (apply.status !== 200) {
    console.error("apply 失败：", apply.status, JSON.stringify(apply.data));
    process.exit(1);
  }
  console.log("已提交寄养人申请");
}

const verify = await api("POST", `/api/admin/hosts/${encodeURIComponent(u.id)}`, {
  token,
  body: { action: "verify" },
});
if (verify.status !== 200) {
  console.error("自审失败：", verify.status, JSON.stringify(verify.data));
  process.exit(1);
}
console.log(`已通过审核：host_status=${verify.data.hostStatus || verify.data.status || "active"}`);

const search = await api("GET", "/api/hosts/search");
const inList = (search.data && search.data.hosts || []).some((h) => h.userId === u.id);
console.log(`/api/hosts/search 命中 admin：${inList ? "是" : "否（回归会失败，请检查）"}`);
process.exit(inList ? 0 : 1);
