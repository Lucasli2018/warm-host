// Task 18 test: POST /api/hosts/[id]/invite + needs square page + CTA wiring
// Node 18+ native fetch

const BASE = "http://localhost:8787";
let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push("FAIL " + name + " " + (extra || "")); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, "(got=" + JSON.stringify(actual) + " want=" + JSON.stringify(expected) + ")");
}

async function api(method, path, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: method,
    headers: headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

function isoDay(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function needsList(data) {
  return (data && (Array.isArray(data) ? data : data.needs)) || [];
}

let adminToken = null, adminId = null, codesCache = [];

async function ensureCodes(n) {
  while (codesCache.length < n) {
    const r = await api("POST", "/api/admin/invite-codes", { token: adminToken, body: { count: 5 } });
    if (r.status !== 200) throw new Error("gen codes fail: " + JSON.stringify(r.data));
    codesCache = codesCache.concat(r.data.codes || r.data.generated || r.data.available || []);
    if (codesCache.length < n) {
      const g = await api("GET", "/api/admin/invite-codes", { token: adminToken });
      codesCache = codesCache.concat(g.data.available || g.data.codes || []);
    }
    if (codesCache.length === 0) throw new Error("no codes available");
  }
}

async function register(nickname) {
  if (codesCache.length === 0) throw new Error("no code for " + nickname);
  const code = codesCache.pop();
  const phone = "139" + String(90000000 + Math.floor(Math.random() * 9999999)).slice(0, 8);
  const r = await api("POST", "/api/auth/register", { body: { phone: phone, password: "pass123456", nickname: nickname, inviteCode: code } });
  if (r.status !== 200) throw new Error("register fail " + nickname + ": " + JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.user.id, nickname: nickname };
}

const APPLY_BODY = {
  bio: "家有院子，养过 5 年柯基",
  capacity_count: 2,
  capacity_species: ["狗", "猫"],
  capacity_size: ["小型", "中型"],
  capacity_gender: ["公", "母"],
  address_fuzzy: "海淀区学院路某小区",
  district: "海淀区",
  experience: "5 年养宠经验",
  special_services: ["可上门接送"],
  daily_rate_cents: 12000,
};

async function applyHost(user) {
  const r = await api("POST", "/api/hosts/apply", { token: user.token, body: APPLY_BODY });
  if (r.status !== 200) throw new Error("apply fail " + user.nickname + ": " + JSON.stringify(r.data));
}

async function verifyHost(user) {
  const r = await api("POST", "/api/admin/hosts/" + user.id, { token: adminToken, body: { action: "verify" } });
  if (r.status !== 200) throw new Error("verify fail " + user.nickname + ": " + JSON.stringify(r.data));
}

async function sponsorHost(hostUser, sponsorUserId) {
  const r = await api("POST", "/api/admin/hosts/" + hostUser.id + "/sponsor", { token: adminToken, body: { sponsorUserId: sponsorUserId } });
  if (r.status !== 200) throw new Error("sponsor fail " + hostUser.nickname + ": " + JSON.stringify(r.data));
}

async function getHostProfileId(user) {
  const r = await api("GET", "/api/hosts/me", { token: user.token });
  if (r.status !== 200) throw new Error("hosts/me fail: " + JSON.stringify(r.data));
  const p = r.data.profile || r.data.hostProfile || {};
  return p.id;
}

function readFileSync(p) {
  const fs = require("fs");
  return fs.readFileSync(p, "utf8");
}

async function main() {
  // ===== 0. admin =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  ok("0.1 admin login", adm.status === 200, JSON.stringify(adm.data));
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(5);

  // ===== 1. users =====
  const A = await register("主人A");
  const B = await register("寄养人B");
  const S = await register("担保人S");
  const C = await register("路人C");
  ok("1.1 four users registered", !!A.token && !!B.token && !!S.token && !!C.token);

  // ===== 2. B & S become active hosts =====
  await applyHost(B);
  await verifyHost(B);
  const bProfileId = await getHostProfileId(B);
  ok("2.1 B host profileId", !!bProfileId, JSON.stringify(bProfileId));

  await applyHost(S);
  await verifyHost(S);
  ok("2.2 S host active", !!S.token);

  // S sponsors B
  await sponsorHost(B, S.id);
  ok("2.3 B sponsored", true);

  // ===== 3. B set availability =====
  const covStart = isoDay(10), covEnd = isoDay(40);
  const avail = await api("PUT", "/api/hosts/me/availability", { token: B.token, body: [{ start_date: covStart, end_date: covEnd, note: "国庆档期" }] });
  ok("3.1 B set availability", avail.status === 200, JSON.stringify(avail.data));

  // ===== 4. A create pet + needs =====
  const pet = await api("POST", "/api/pets", { token: A.token, body: { name: "豆豆", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  ok("4.1 A create pet", pet.status === 200, JSON.stringify(pet.data));
  const petId = pet.data.id;

  async function mkNeed(sOff, eOff) {
    return api("POST", "/api/needs", {
      token: A.token,
      body: { petId: petId, startDate: isoDay(sOff), endDate: isoDay(eOff), expectedPriceCents: 12000, expectedArea: "海淀区", description: "节假日寄养" },
    });
  }

  const need1 = await mkNeed(12, 16);
  ok("5.1 create need1", need1.status === 200, JSON.stringify(need1.data));
  const need1Id = need1.data.id;

  // ===== 6. invite tests =====
  // 6.1 未登录 invite → 401
  const inv1 = await api("POST", "/api/hosts/" + bProfileId + "/invite", { body: { needId: need1Id } });
  eq("6.1 unauth invite 401", inv1.status, 401);

  // 6.2 缺 needId → 400
  const inv2 = await api("POST", "/api/hosts/" + bProfileId + "/invite", { token: A.token, body: {} });
  eq("6.2 missing needId 400", inv2.status, 400);

  // 6.3 needId 不存在 → 404
  const inv3 = await api("POST", "/api/hosts/" + bProfileId + "/invite", { token: A.token, body: { needId: "00000000-0000-0000-0000-000000000000" } });
  eq("6.3 unknown need 404", inv3.status, 404);

  // 6.4 邀请自己 → 400（B 邀请自己）
  const inv4 = await api("POST", "/api/hosts/" + bProfileId + "/invite", { token: B.token, body: { needId: need1Id } });
  eq("6.4 self invite 400", inv4.status, 400);

  // 6.5 别人的需求 → 403（B 拿 A 的 needId 邀请 S）
  const sProfileId = await getHostProfileId(S);
  const inv5 = await api("POST", "/api/hosts/" + sProfileId + "/invite", { token: B.token, body: { needId: need1Id } });
  eq("6.5 someone else need 403", inv5.status, 403);

  // 6.6 正常邀请 → 200
  const inv6 = await api("POST", "/api/hosts/" + bProfileId + "/invite", { token: A.token, body: { needId: need1Id } });
  eq("6.6 normal invite 200", inv6.status, 200);

  // 6.7 24h 内重复邀请 → 429
  const inv7 = await api("POST", "/api/hosts/" + bProfileId + "/invite", { token: A.token, body: { needId: need1Id } });
  eq("6.7 dup invite 429", inv7.status, 429);

  // 6.8 host 不存在 → 404
  const inv8 = await api("POST", "/api/hosts/nonexistent-profile-id/invite", { token: A.token, body: { needId: need1Id } });
  eq("6.8 unknown host 404", inv8.status, 404);

  // 6.9 需求非 open → 400
  // 先建一个 open 需求，让 B 接单变 matched，再邀请 → 400
  const need2 = await mkNeed(18, 22);
  ok("6.9.1 create need2", need2.status === 200);
  const book2 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need2.data.id } });
  eq("6.9.2 B book need2 200", book2.status, 200);
  // 现在 need2 已 matched，再邀请 → 400
  const inv9 = await api("POST", "/api/hosts/" + sProfileId + "/invite", { token: A.token, body: { needId: need2.data.id } });
  eq("6.9.3 invite matched need 400", inv9.status, 400);

  // ===== 7. Static checks =====
  // 7.1 needs.html 静态检查
  const needsHtml = readFileSync("F:/LLM/warm-host/public/needs.html");
  ok("7.1.1 needs.html has needs-list container", needsHtml.indexOf('id="needs-list"') >= 0);
  ok("7.1.2 needs.html has book confirm modal", needsHtml.indexOf('book-confirm-modal') >= 0);
  ok("7.1.3 needs.html has load more", needsHtml.indexOf('btn-load-more') >= 0);
  ok("7.1.4 needs.html has empty state", needsHtml.indexOf('empty-state') >= 0);

  // 7.2 needs.js 含 book 调用、profileId 获取、open 过滤
  const needsJs = readFileSync("F:/LLM/warm-host/public/js/pages/needs.js");
  ok("7.2.1 needs.js calls /book", needsJs.indexOf("/book") >= 0 && needsJs.indexOf("book") >= 0);
  ok("7.2.2 needs.js gets profileId", needsJs.indexOf("profileId") >= 0 && needsJs.indexOf("/hosts/me") >= 0);
  ok("7.2.3 needs.js filters open", needsJs.indexOf("status === 'open'") >= 0 || needsJs.indexOf('status === "open"') >= 0 || needsJs.indexOf("state.needs") >= 0);
  ok("7.2.4 needs.js handles ?need= param", needsJs.indexOf("highlightId") >= 0 && needsJs.indexOf("scrollIntoView") >= 0);
  ok("7.2.5 needs.js has own need tag", needsJs.indexOf("need-own-tag") >= 0 || needsJs.indexOf("isMine") >= 0);

  // 7.3 host-detail.js 含 invite 调用 + needs/my 检查 + 自我主页判断
  const hostDetailJs = readFileSync("F:/LLM/warm-host/public/js/pages/host-detail.js");
  ok("7.3.1 host-detail.js calls /invite", hostDetailJs.indexOf("/invite") >= 0);
  ok("7.3.2 host-detail.js checks /needs/my", hostDetailJs.indexOf("/needs/my") >= 0);
  ok("7.3.3 host-detail.js checks self page", hostDetailJs.indexOf("host.userId") >= 0 || hostDetailJs.indexOf("userId === me.id") >= 0);
  ok("7.3.4 host-detail.js uses /auth/me", hostDetailJs.indexOf("/auth/me") >= 0);

  // 7.4 notifications.js 含 order_invite 映射
  const notifJs = readFileSync("F:/LLM/warm-host/public/js/notifications.js");
  ok("7.4.1 notifications.js has order_invite", notifJs.indexOf("order_invite") >= 0 && notifJs.indexOf("💌") >= 0);

  // 7.5 app.js 底部 Tab 需求指向 needs.html
  const appJs = readFileSync("F:/LLM/warm-host/public/js/app.js");
  ok("7.5.1 app.js needs tab → /needs.html", appJs.indexOf("needs.html") >= 0 && appJs.indexOf("needs") >= 0);
  ok("7.5.2 app.js no longer points needs to my.html?tab=needs", appJs.indexOf("/my.html?tab=needs") < 0);
  ok("7.5.3 app.js currentTabKey recognizes needs.html", appJs.indexOf("/needs.html") >= 0);

  // 7.6 hosts.html segment toggle
  const hostsHtml = readFileSync("F:/LLM/warm-host/public/hosts.html");
  ok("7.6.1 hosts.html has segment toggle", hostsHtml.indexOf("hosts-top-segment") >= 0);
  ok("7.6.2 hosts.html segment links to needs.html", hostsHtml.indexOf("/needs.html") >= 0);

  // 7.7 index.html entry card
  const indexHtml = readFileSync("F:/LLM/warm-host/public/index.html");
  ok("7.7.1 index.html has entry card", indexHtml.indexOf("home-entry-card") >= 0);
  ok("7.7.2 index.html entry links to needs.html", indexHtml.indexOf("/needs.html") >= 0);

  // 7.8 style.css has new classes
  const styleCss = readFileSync("F:/LLM/warm-host/public/css/style.css");
  ok("7.8.1 style.css has needs-banner", styleCss.indexOf("needs-banner") >= 0);
  ok("7.8.2 style.css has need-card-highlight", styleCss.indexOf("need-card-highlight") >= 0);
  ok("7.8.3 style.css has hosts-top-segment", styleCss.indexOf("hosts-top-segment") >= 0);
  ok("7.8.4 style.css has home-entry-card", styleCss.indexOf("home-entry-card") >= 0);
  ok("7.8.5 style.css has invite-need-item", styleCss.indexOf("invite-need-item") >= 0);

  // ===== 8. node --check all changed JS =====
  const { execSync } = require("child_process");
  const jsFiles = [
    "F:/LLM/warm-host/functions/api/hosts/[id]/invite.js",
    "F:/LLM/warm-host/public/js/pages/needs.js",
    "F:/LLM/warm-host/public/js/pages/host-detail.js",
    "F:/LLM/warm-host/public/js/app.js",
    "F:/LLM/warm-host/public/js/notifications.js",
  ];
  for (const f of jsFiles) {
    try {
      execSync(`node --check "${f}"`, { stdio: "pipe" });
      ok("8 node --check pass: " + f.split("/").pop(), true);
    } catch (e) {
      ok("8 node --check pass: " + f.split("/").pop(), false, e.stderr ? e.stderr.toString().slice(0, 200) : e.message);
    }
  }

  console.log("");
  console.log("================ RESULT ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (failures.length) {
    console.log("");
    console.log("failures:");
    for (const f of failures) console.log(f);
  }
  console.log("========================================");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error("script aborted: " + e.message);
  console.error(e.stack);
  console.error("current PASS " + pass + " / FAIL " + fail);
  if (failures.length) failures.forEach(function (f) { console.log(f); });
  process.exit(1);
});
