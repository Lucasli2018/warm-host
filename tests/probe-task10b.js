// Task 10b test: my.html orders Tab frontend
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
function has(name, text, sub) {
  ok(name, typeof text === "string" && text.indexOf(sub) !== -1, "missing substring: " + sub);
}

async function fetchText(path) {
  const res = await fetch(BASE + path, { redirect: "follow" });
  const text = await res.text();
  return { status: res.status, text: text };
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

async function main() {
  console.log("");

  // ===== 1. my.html static content =====
  const html = await fetchText("/my.html");
  eq("1.1 my.html 200", html.status, 200);
  has("1.2 has orders tab container", html.text, 'id="tab-orders"');
  has("1.3 has role seg-control", html.text, 'seg-control');
  has("1.4 has orders-list container", html.text, 'id="orders-list"');
  has("1.5 has order-confirm-modal", html.text, 'id="order-confirm-modal"');
  has("1.6 has owner seg-btn", html.text, 'data-role="owner"');
  has("1.7 has host seg-btn", html.text, 'data-role="host"');

  // ===== 2. my.js static content =====
  const js = await fetchText("/js/pages/my.js");
  eq("2.1 my.js 200", js.status, 200);
  has("2.2 has loadOrders function", js.text, "loadOrders");
  has("2.3 has renderOrderCard function", js.text, "renderOrderCard");
  has("2.4 has role param parse", js.text, "params.get('role')");
  has("2.5 has tab param parse", js.text, "params.get('tab')");
  has("2.6 has accept action", js.text, 'data-action="accept"');
  has("2.7 has start action", js.text, 'data-action="start"');
  has("2.8 has complete action", js.text, 'data-action="complete"');
  has("2.9 has cancel action", js.text, 'data-action="cancel"');
  has("2.10 has dispute action", js.text, 'data-action="dispute"');
  has("2.11 has badge-order-amber", js.text, "badge-order-amber");
  has("2.12 has badge-order-blue", js.text, "badge-order-blue");
  has("2.13 has badge-order-green", js.text, "badge-order-green");
  has("2.14 has badge-order-done", js.text, "badge-order-done");
  has("2.15 has badge-order-gray", js.text, "badge-order-gray");
  has("2.16 has badge-order-red", js.text, "badge-order-red");
  has("2.17 has status POST call", js.text, "/orders/${orderId}/status");
  has("2.18 has confirm modal ok button", js.text, "order-confirm-ok");
  has("2.19 has toggle detail", js.text, "data-toggle-detail");

  // ===== 3. style.css content =====
  const css = await fetchText("/css/style.css");
  eq("3.1 style.css 200", css.status, 200);
  has("3.2 has badge-order-amber", css.text, ".badge-order-amber");
  has("3.3 has badge-order-blue", css.text, ".badge-order-blue");
  has("3.4 has badge-order-green", css.text, ".badge-order-green");
  has("3.5 has badge-order-done", css.text, ".badge-order-done");
  has("3.6 has badge-order-gray", css.text, ".badge-order-gray");
  has("3.7 has badge-order-red", css.text, ".badge-order-red");
  has("3.8 has .order-card", css.text, ".order-card");
  has("3.9 has .seg-control", css.text, ".seg-control");
  has("3.10 has .order-tabs-role", css.text, ".order-tabs-role");
  has("3.11 has .order-card-pet", css.text, ".order-card-pet");
  has("3.12 has .order-card-peer", css.text, ".order-card-peer");
  has("3.13 has .order-card-amount", css.text, ".order-card-amount");
  has("3.14 has .order-card-actions", css.text, ".order-card-actions");
  has("3.15 has .order-detail-expand", css.text, ".order-detail-expand");
  has("3.16 has .order-timeline", css.text, ".order-timeline");
  has("3.17 has .order-empty", css.text, ".order-empty");
  has("3.18 has .order-hint", css.text, ".order-hint");

  // ===== 4. node --check (via subprocess) =====
  const { execSync } = require("child_process");
  const files = ["F:\\LLM\\warm-host\\public\\js\\pages\\my.js"];
  for (const f of files) {
    try {
      execSync("node --check " + f, { stdio: "pipe" });
      ok("4.x node --check " + f, true);
    } catch (e) {
      ok("4.x node --check " + f, false, e.stderr.toString());
    }
  }

  // ===== 5. E2E: register + book + my.html?tab=orders =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  eq("5.1 admin login", adm.status, 200);
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(3);

  const A = await register("主人A");
  const B = await register("寄养人B");
  ok("5.2 users registered", !!A.token && !!B.token);

  const applyBody = {
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
  const apply = await api("POST", "/api/hosts/apply", { token: B.token, body: applyBody });
  eq("5.3 B apply host", apply.status, 200);

  const verify = await api("POST", "/api/admin/hosts/" + B.id, { token: adminToken, body: { action: "verify" } });
  eq("5.4 admin verify B", verify.status, 200);

  const myHost = await api("GET", "/api/hosts/me", { token: B.token });
  const bProfileId = (myHost.data.profile || {}).id;
  ok("5.5 got bProfileId", !!bProfileId);

  const pet = await api("POST", "/api/pets", { token: A.token, body: { name: "豆豆", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  eq("5.6 A create pet", pet.status, 200);
  const petId = pet.data.id;

  // availability
  const covStart = isoDay(10), covEnd = isoDay(40);
  const avail = await api("PUT", "/api/hosts/me/availability", { token: B.token, body: [{ start_date: covStart, end_date: covEnd, note: "国庆档期" }] });
  eq("5.7 B set availability", avail.status, 200);

  // sponsor
  const need = await api("POST", "/api/needs", { token: A.token, body: { petId: petId, startDate: isoDay(12), endDate: isoDay(16), expectedPriceCents: 12000, expectedArea: "海淀区" } });
  eq("5.8 create need", need.status, 200);
  const sponsor = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: { sponsorUserId: adminId } });
  eq("5.9 admin sponsor", sponsor.status, 200);

  const book = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need.data.id } });
  eq("5.10 book 200", book.status, 200);
  eq("5.11 status pending", book.data && book.data.status, "pending");

  // A owner-view orders should contain 1
  const ownOrders = await api("GET", "/api/orders/my?role=owner", { token: A.token });
  eq("5.12 owner orders 200", ownOrders.status, 200);
  eq("5.13 owner orders count 1", ownOrders.data.orders.length, 1);
  eq("5.14 isOwnerView true", ownOrders.data.orders[0].isOwnerView, true);

  // my.html?tab=orders returns 200
  const e2ePage = await fetchText("/my.html?tab=orders&role=host");
  eq("5.15 my.html?tab=orders&role=host 200", e2ePage.status, 200);

  // 状态操作端到端（accept 后再拉列表确认按钮分支切换）
  const acceptRes = await api("POST", "/api/orders/" + book.data.id + "/status", { token: A.token, body: { action: "accept" } });
  eq("5.16 accept 200", acceptRes.status, 200);
  eq("5.17 accepted status", acceptRes.data.status, "accepted");
  const ownAfter = await api("GET", "/api/orders/my?role=owner", { token: A.token });
  eq("5.18 accepted in list", ownAfter.data.orders[0].status, "accepted");

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
  console.error("current PASS " + pass + " / FAIL " + fail);
  if (failures.length) failures.forEach(function (f) { console.log(f); });
  process.exit(1);
});
