// Task 14 test: notifications list + mark read + frontend static check
// Node 18+ native fetch
// Backend: functions/api/notifications/index.js, functions/api/notifications/read.js
// Frontend: public/js/notifications.js + 4 pages + style.css

const BASE = "http://localhost:8787";
const ROOT = "F:/LLM/warm-host";
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push("FAIL " + name + " " + (extra || "")); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, "(got=" + JSON.stringify(actual) + " want=" + JSON.stringify(expected) + ")");
}
function contains(name, actual, substr) {
  const s = typeof actual === "string" ? actual : JSON.stringify(actual);
  ok(name, s.indexOf(substr) !== -1, "(got=" + s + " want contains=" + substr + ")");
}

function matchesRegex(name, actual, re) {
  ok(name, re.test(actual), "(got does not match " + re + ")");
}

async function api(method, p, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + p, {
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

// ============ setup helpers ============
let adminToken = null, adminId = null, codesCache = [];

async function ensureCodes(n) {
  while (codesCache.length < n) {
    const r = await api("POST", "/api/admin/invite-codes", { token: adminToken, body: { count: 5 } });
    if (r.status !== 200) throw new Error("gen codes fail: " + JSON.stringify(r.data));
    codesCache = codesCache.concat(r.data.codes || []);
  }
}

async function register(nickname) {
  if (codesCache.length === 0) throw new Error("no code for " + nickname);
  const code = codesCache.pop();
  const phone = "139" + String(90000000 + Math.floor(Math.random() * 9999999)).slice(0, 8);
  const r = await api("POST", "/api/auth/register", { body: { phone: phone, password: "pass123456", nickname: nickname, inviteCode: code } });
  if (r.status !== 200) throw new Error("register fail " + nickname + ": " + JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.user.id, phone: phone, nickname: nickname };
}

const APPLY_BODY = {
  bio: "家有院子，养过 5 年柯基，可上门接送",
  capacity_count: 2,
  capacity_species: ["狗", "猫"],
  capacity_size: ["小型", "中型"],
  capacity_gender: ["公", "母"],
  address_fuzzy: "海淀区学院路某小区",
  district: "海淀区",
  experience: "5 年养宠经验",
  special_services: ["可上门接送", "宠物医院合作"],
  daily_rate_cents: 12000,
};

async function applyHost(user) {
  const r = await api("POST", "/api/hosts/apply", { token: user.token, body: APPLY_BODY });
  if (r.status !== 200) throw new Error("apply fail " + user.nickname + ": " + JSON.stringify(r.data));
  return r;
}

async function verifyHost(userId) {
  const r = await api("POST", "/api/admin/hosts/" + userId, { token: adminToken, body: { action: "verify" } });
  if (r.status !== 200) throw new Error("verify fail " + userId + ": " + JSON.stringify(r.data));
  return r;
}

async function sponsorHost(hostUserId) {
  const r = await api("POST", "/api/admin/hosts/" + hostUserId + "/sponsor", {
    token: adminToken,
    body: { sponsorUserId: adminId },
  });
  if (r.status !== 200) throw new Error("sponsor fail " + hostUserId + ": " + JSON.stringify(r.data));
  return r;
}

// 用指定用户作为担保人（admin 临时担保端点）
async function sponsorHostWith(hostUserId, sponsorId) {
  const r = await api("POST", "/api/admin/hosts/" + hostUserId + "/sponsor", {
    token: adminToken,
    body: { sponsorUserId: sponsorId },
  });
  if (r.status !== 200) throw new Error("sponsor fail " + hostUserId + " by " + sponsorId + ": " + JSON.stringify(r.data));
  return r;
}

async function getProfileId(token) {
  const r = await api("GET", "/api/hosts/me", { token: token });
  const prof = r.data && r.data.profile;
  if (!prof || !prof.id) throw new Error("no profile id: " + JSON.stringify(r.data));
  return prof.id;
}

async function setAvailability(token, fromDay, toDay) {
  const r = await api("PUT", "/api/hosts/me/availability", {
    token: token,
    body: [{ start_date: isoDay(fromDay), end_date: isoDay(toDay), note: "T14" }],
  });
  if (r.status !== 200) throw new Error("avail fail: " + JSON.stringify(r.data));
}

async function makePetNeed(owner) {
  const pet = await api("POST", "/api/pets", { token: owner.token, body: { name: "豆丁", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  if (pet.status !== 200) throw new Error("pet fail: " + JSON.stringify(pet.data));
  const need = await api("POST", "/api/needs", {
    token: owner.token,
    body: { petId: pet.data.id, startDate: isoDay(15), endDate: isoDay(18), expectedPriceCents: 12000, expectedArea: "海淀区", description: "短途寄养" },
  });
  if (need.status !== 200) throw new Error("need fail: " + JSON.stringify(need.data));
  return { petId: pet.data.id, needId: need.data.id };
}

async function bookAndFlow(hostToken, needId, profileId) {
  const book = await api("POST", "/api/hosts/" + profileId + "/book", { token: hostToken, body: { needId: needId } });
  if (book.status !== 200) throw new Error("book fail: " + JSON.stringify(book.data));
  return book.data.id;
}

async function orderAction(orderId, action, token) {
  const r = await api("POST", "/api/orders/" + orderId + "/status", { token: token, body: { action: action } });
  if (r.status !== 200) throw new Error("orderAction " + action + " fail: " + JSON.stringify(r.data));
  return r;
}

async function getUnreadCount(token) {
  const r = await api("GET", "/api/notifications?page=1&pageSize=1", { token: token });
  return r.data && r.data.unreadCount;
}

// ============ main ============
async function main() {
  // ===== 0. admin login + codes =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  eq("0.1 admin login 200", adm.status, 200);
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(6);

  // ===== 1. Test 1: not-logged GET → 401 =====
  const t1 = await api("GET", "/api/notifications");
  eq("1.1 not-logged GET 401", t1.status, 401);

  // ===== 2. Test 2: trigger events, then GET → 200 with notifications + unreadCount > 0 =====
  const A = await register("主人A-T14");
  const B = await register("寄养人B-T14");
  const C = await register("担保人C-T14");
  // B + C 都成为 active host（C 用作 B 的担保人）
  await applyHost(B);
  await applyHost(C);
  await verifyHost(B.id);
  await verifyHost(C.id);
  // admin 用 C 担保 B
  await sponsorHostWith(B.id, C.id);
  const bProfileId = await getProfileId(B.token);
  await setAvailability(B.token, 10, 60);
  const { needId } = await makePetNeed(A);
  const orderId = await bookAndFlow(B.token, needId, bProfileId);
  await orderAction(orderId, "accept", A.token);
  await orderAction(orderId, "start", B.token);
  await orderAction(orderId, "complete", B.token);
  // A 评价
  const review = await api("POST", "/api/orders/" + orderId + "/review", {
    token: A.token,
    body: { rating: 5, content: "非常满意", tags: ["照顾周到", "沟通顺畅"] },
  });
  eq("2.1 review 200", review.status, 200);

  // 等一小段，确保所有通知都已落库（createNotification 是 await 的）
  await new Promise(r => setTimeout(r, 100));

  const t2 = await api("GET", "/api/notifications", { token: A.token });
  eq("2.2 A GET notifications 200", t2.status, 200);
  ok("2.3 A notifications array", Array.isArray(t2.data.notifications));
  ok("2.4 A has at least 3 notifications", t2.data.notifications.length >= 3,
     "got=" + (t2.data.notifications || []).length);
  ok("2.5 A unreadCount > 0", t2.data.unreadCount > 0, "got=" + t2.data.unreadCount);
  ok("2.6 A total >= 3", t2.data.total >= 3, "got=" + t2.data.total);
  ok("2.7 A page=1", t2.data.page === 1);
  ok("2.8 A pageSize=20 default", t2.data.pageSize === 20);

  // B 也应该有通知（order_accepted, review 等）
  const bNotif = await api("GET", "/api/notifications", { token: B.token });
  eq("2.9 B GET 200", bNotif.status, 200);
  ok("2.10 B unreadCount > 0", bNotif.data.unreadCount > 0);

  // ===== 3. Test 3: pagination =====
  const t3a = await api("GET", "/api/notifications?page=1&pageSize=2", { token: A.token });
  eq("3.1 page=1&pageSize=2 → 200", t3a.status, 200);
  eq("3.2 returns 2 items", t3a.data.notifications.length, 2);
  eq("3.3 pageSize echoed", t3a.data.pageSize, 2);
  eq("3.4 page echoed", t3a.data.page, 1);

  const t3b = await api("GET", "/api/notifications?pageSize=100", { token: A.token });
  eq("3.5 pageSize=100 capped to 50", t3b.data.pageSize, 50);

  const t3c = await api("GET", "/api/notifications?page=2&pageSize=2", { token: A.token });
  eq("3.6 page=2 pageSize=2 → 200", t3c.status, 200);
  ok("3.7 page=2 different items", t3c.data.notifications.length > 0);
  // page 1 vs page 2 should not overlap
  const p1ids = t3a.data.notifications.map(n => n.id);
  const p2ids = t3c.data.notifications.map(n => n.id);
  const overlap = p1ids.filter(id => p2ids.indexOf(id) !== -1).length;
  eq("3.8 no overlap between page 1 and 2", overlap, 0);

  // ===== 4. Test 4: sort newest first =====
  const t4 = await api("GET", "/api/notifications?pageSize=50", { token: A.token });
  const sorted = t4.data.notifications;
  for (let i = 1; i < sorted.length; i++) {
    ok("4.sort[" + i + "] newer than previous",
       new Date(sorted[i - 1].createdAt).getTime() >= new Date(sorted[i].createdAt).getTime(),
       "prev=" + sorted[i - 1].createdAt + " cur=" + sorted[i].createdAt);
  }

  // ===== 5. Test 5: POST read {id} single → 200, read=1, unreadCount -1 =====
  const before = await getUnreadCount(A.token);
  const target = t4.data.notifications[0];
  const t5 = await api("POST", "/api/notifications/read", { token: A.token, body: { id: target.id } });
  eq("5.1 read single 200", t5.status, 200);
  eq("5.2 read=1", t5.data.read, 1);
  eq("5.3 unreadCount decremented", t5.data.unreadCount, before - 1);

  // ===== 6. Test 6: idempotent re-read → read=0 =====
  const t6 = await api("POST", "/api/notifications/read", { token: A.token, body: { id: target.id } });
  eq("6.1 re-read 200", t6.status, 200);
  eq("6.2 re-read read=0", t6.data.read, 0);
  eq("6.3 re-read unreadCount same", t6.data.unreadCount, t5.data.unreadCount);

  // ===== 7. Test 7: mark another's notification → 404 =====
  // Use B's notification id, A tries to mark it
  const bAll = await api("GET", "/api/notifications?pageSize=50", { token: B.token });
  const bNotifId = bAll.data.notifications[0].id;
  const t7 = await api("POST", "/api/notifications/read", { token: A.token, body: { id: bNotifId } });
  ok("7.1 mark other's → 404 or 403", t7.status === 404 || t7.status === 403,
     "got=" + t7.status + " data=" + JSON.stringify(t7.data));

  // ===== 8. Test 8: {all:true} mark all → unreadCount=0 =====
  const t8 = await api("POST", "/api/notifications/read", { token: A.token, body: { all: true } });
  eq("8.1 mark all 200", t8.status, 200);
  eq("8.2 unreadCount=0", t8.data.unreadCount, 0);
  ok("8.3 read >= previous unread", t8.data.read >= (before - 1),
     "read=" + t8.data.read + " before-1=" + (before - 1));

  // 再 GET 确认 unreadCount=0
  const t8v = await api("GET", "/api/notifications", { token: A.token });
  eq("8.4 GET confirms unreadCount=0", t8v.data.unreadCount, 0);
  // 所有条目 read=true
  for (const n of t8v.data.notifications) {
    eq("8.5 notif " + n.id + " read=true", n.read, true);
  }

  // ===== 9. Test 9: missing params / not-logged =====
  const t9a = await api("POST", "/api/notifications/read", { token: A.token, body: {} });
  eq("9.1 missing params 400", t9a.status, 400);
  const t9b = await api("POST", "/api/notifications/read", { body: { id: "x" } });
  eq("9.2 not-logged POST 401", t9b.status, 401);
  const t9c = await api("POST", "/api/notifications/read", { token: A.token, body: { foo: "bar" } });
  eq("9.3 unknown field 400", t9c.status, 400);

  // ===== 10. Test 10: serialization fields complete =====
  const t10 = await api("GET", "/api/notifications?pageSize=50", { token: B.token });
  ok("10.1 B has notifications", t10.data.notifications.length > 0);
  const REQUIRED_FIELDS = ["id", "type", "title", "body", "link", "read", "createdAt"];
  for (const n of t10.data.notifications) {
    for (const f of REQUIRED_FIELDS) {
      ok("10.field " + f + " on " + n.id, f in n, "missing " + f + " in " + JSON.stringify(n));
    }
    // read is boolean
    ok("10.read boolean " + n.id, typeof n.read === "boolean", "got=" + typeof n.read);
    // createdAt is ISO string
    ok("10.createdAt ISO " + n.id, /^\d{4}-\d{2}-\d{2}T/.test(n.createdAt || ""), "got=" + n.createdAt);
  }

  // ===== 11. Test 11: admin notified in dispute flow =====
  // 新流程：A 再建 need → B book → A accept → B start → A dispute
  // 记录 admin 的 unreadCount 变化
  const adminBefore = await getUnreadCount(adminToken);
  ok("11.0 admin has baseline unread", typeof adminBefore === "number", "got=" + adminBefore);

  const { needId: needId2 } = await makePetNeed(A);
  const orderId2 = await bookAndFlow(B.token, needId2, bProfileId);
  await orderAction(orderId2, "accept", A.token);
  await orderAction(orderId2, "start", B.token);
  const dispute = await api("POST", "/api/orders/" + orderId2 + "/status", {
    token: A.token,
    body: { action: "dispute" },
  });
  eq("11.1 A dispute 200", dispute.status, 200);

  // 等一小段
  await new Promise(r => setTimeout(r, 150));

  const adminAfter = await getUnreadCount(adminToken);
  ok("11.2 admin unreadCount increased", adminAfter > adminBefore,
     "before=" + adminBefore + " after=" + adminAfter);

  // admin 有一条 order_disputed 类型的通知
  const adminNotif = await api("GET", "/api/notifications?pageSize=50", { token: adminToken });
  const hasDispute = adminNotif.data.notifications.some(n => n.type === "order_disputed");
  ok("11.3 admin has order_disputed notif", hasDispute);

  // ===== 12. Test 12: frontend static check =====
  const notifJs = fs.readFileSync(path.join(ROOT, "public/js/notifications.js"), "utf8");
  ok("12.1 notifications.js exists", notifJs.length > 0);
  // type→icon map
  const typeIconChecks = ["order_pending", "order_accepted", "order_started", "order_completed", "order_cancelled", "order_disputed", "review", "sponsor_invite", "sponsor_accepted", "host_approved", "host_rejected", "host_suspended", "host_activated", "blacklist_report"];
  for (const t of typeIconChecks) {
    contains("12.2 icon for " + t, notifJs, t);
  }
  matchesRegex("12.3 emoji in map (any 4-byte)", notifJs, /[\u{1F000}-\u{1FFFF}]/u);
  matchesRegex("12.4 order_pending has emoji", notifJs, /order_pending:\s*'[\u{1F000}-\u{1FFFF}]/u);
  matchesRegex("12.5 ICON_DEFAULT bell", notifJs, /ICON_DEFAULT\s*=\s*'[\u{1F000}-\u{1FFFF}]/u);
  // polling
  contains("12.6 setInterval for polling", notifJs, "setInterval");
  contains("12.7 POLL_INTERVAL 60000", notifJs, "60000");
  contains("12.8 visibilityState visible check", notifJs, "visibilityState");
  contains("12.9 visibilitychange listener", notifJs, "visibilitychange");
  // markRead
  contains("12.10 markOneRead function", notifJs, "markOneRead");
  contains("12.11 markAllRead function", notifJs, "markAllRead");
  // injection logic
  contains("12.12 ensureBell function", notifJs, "ensureBell");
  contains("12.13 .header query", notifJs, ".header");
  contains("12.14 header-placeholder", notifJs, "header-placeholder");
  contains("12.15 fixed fallback", notifJs, "fixed");
  // badge
  contains("12.16 notif-badge class", notifJs, "notif-badge");
  contains("12.17 MAX_BADGE = 9", notifJs, "MAX_BADGE = 9");
  matchesRegex("12.17b 9+ overflow logic", notifJs, /MAX_BADGE\s*\+\s*'/);
  // panel
  contains("12.18 notif-panel class", notifJs, "notif-panel");
  contains("12.19 notif-item class", notifJs, "notif-item");
  contains("12.20 notif-dot class", notifJs, "notif-dot");
  contains("12.21 notif-empty class", notifJs, "notif-empty");
  contains("12.22 全部已读 button", notifJs, "全部已读");
  contains("12.23 查看全部通知 button", notifJs, "查看全部通知");
  contains("12.24 暂无通知 empty", notifJs, "暂无通知");
  contains("12.25 relativeTime 分钟前", notifJs, "分钟前");
  contains("12.26 relativeTime 小时前", notifJs, "小时前");
  contains("12.27 relativeTime 天前", notifJs, "天前");
  contains("12.28 relativeTime 刚刚", notifJs, "刚刚");

  // 4 pages reference notifications.js
  const pagesToCheck = ["my.html", "hosts.html", "host-detail.html", "admin.html"];
  for (const p of pagesToCheck) {
    const html = fs.readFileSync(path.join(ROOT, "public/" + p), "utf8");
    contains("12.page " + p + " loads notifications.js", html, "/js/notifications.js");
    // api.js before notifications.js
    const apiIdx = html.indexOf("/js/api.js");
    const notifIdx = html.indexOf("/js/notifications.js");
    ok("12.page " + p + " api.js before notifications.js", apiIdx !== -1 && notifIdx !== -1 && apiIdx < notifIdx,
       "api=" + apiIdx + " notif=" + notifIdx);
  }

  // style.css contains new classes
  // 用 GBK 容忍的方式读取：用 latin1 拿原始字节内容
  const styleBytes = fs.readFileSync(path.join(ROOT, "public/css/style.css"));
  const styleText = Buffer.from(styleBytes).toString("latin1");
  const newClasses = [".notif-bell", ".notif-badge", ".notif-panel", ".notif-panel-head", ".notif-item", ".notif-dot", ".notif-item-icon", ".notif-item-body", ".notif-item-title", ".notif-item-desc", ".notif-item-time", ".notif-empty", ".notif-read-all"];
  for (const c of newClasses) {
    contains("12.css " + c, styleText, c);
  }
  contains("12.css unread modifier", styleText, ".notif-item.unread");
  contains("12.css keyframes notif-panel-in", styleText, "notif-panel-in");

  // ===== 13. Test 13: node --check =====
  // 用子进程调用 node --check（Node 18+ 支持 --check）
  const { execFileSync } = require("child_process");
  const jsFiles = [
    "functions/api/notifications/index.js",
    "functions/api/notifications/read.js",
    "public/js/notifications.js",
  ];
  for (const f of jsFiles) {
    try {
      execFileSync("node", ["--check", path.join(ROOT, f)], { stdio: "pipe" });
      ok("13.check " + f, true);
    } catch (e) {
      ok("13.check " + f, false, "stderr=" + e.stderr);
    }
  }

  // ===== Summary =====
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
  console.error("script aborted: " + (e && e.stack || e));
  console.error("current PASS " + pass + " / FAIL " + fail);
  if (failures.length) failures.forEach(function (f) { console.log(f); });
  process.exit(1);
});
