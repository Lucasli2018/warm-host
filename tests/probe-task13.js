// Task 13 test: blacklist report + admin handling + safety filter
// Node 18+ native fetch
// Backend: functions/api/blacklist/index.js, functions/api/blacklist/my.js,
//          functions/api/admin/blacklist/[id].js
//          functions/api/hosts/search.js (safety filter)
//          functions/api/hosts/apply.js, functions/api/hosts/[id]/book.js (banned check)

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
function contains(name, actual, substr) {
  const s = typeof actual === "string" ? actual : JSON.stringify(actual);
  ok(name, s.indexOf(substr) !== -1, "(got=" + s + " want contains=" + substr + ")");
}
function notContains(name, actual, substr) {
  const s = typeof actual === "string" ? actual : JSON.stringify(actual);
  ok(name, s.indexOf(substr) === -1, "(got=" + s + " must not contain=" + substr + ")");
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
    const r = await api("POST", "/api/admin/invite-codes", { token: adminToken, body: { count: 10 } });
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
  return { token: r.data.token, id: r.data.user.id, nickname: nickname };
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

async function verifyHost(adminToken, userId) {
  const r = await api("POST", "/api/admin/hosts/" + userId, { token: adminToken, body: { action: "verify" } });
  if (r.status !== 200) throw new Error("verify fail " + userId + ": " + JSON.stringify(r.data));
  return r;
}

async function getProfileId(token) {
  const r = await api("GET", "/api/hosts/me", { token: token });
  const prof = r.data && r.data.profile;
  if (!prof || !prof.id) throw new Error("no profile id");
  return prof.id;
}

// 创建 pet + need 供 book 测试用
async function makeOwnerPetNeed(owner) {
  const pet = await api("POST", "/api/pets", { token: owner.token, body: { name: "豆丁", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  if (pet.status !== 200) throw new Error("pet fail: " + JSON.stringify(pet.data));
  const need = await api("POST", "/api/needs", {
    token: owner.token,
    body: { petId: pet.data.id, startDate: isoDay(15), endDate: isoDay(18), expectedPriceCents: 12000, expectedArea: "海淀区", description: "短途寄养" },
  });
  if (need.status !== 200) throw new Error("need fail: " + JSON.stringify(need.data));
  return { petId: pet.data.id, needId: need.data.id };
}

async function main() {
  // ===== 0. admin login + codes =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  ok("0.1 admin login", adm.status === 200, JSON.stringify(adm.data));
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(10);

  // ===== 1. register A/B/C =====
  const A = await register("举报人A");
  const B = await register("被举报寄养人B");
  const C = await register("被举报主人C");
  ok("1.1 three users registered", !!A.token && !!B.token && !!C.token);

  // ===== 2. Test 1: not logged report → 401 =====
  const t1 = await api("POST", "/api/blacklist", {
    body: { targetUserId: B.id, targetType: "host", category: "虚假资料", details: "虚假资料测试" },
  });
  eq("2.1 not-logged report 401", t1.status, 401);

  // ===== 3. Test 2: report self → 400 =====
  const t2 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: A.id, targetType: "owner", category: "其他", details: "自测" },
  });
  eq("3.1 self-report 400", t2.status, 400);
  contains("3.2 self-report msg", t2.data && t2.data.error, "不能举报自己");

  // ===== 4. Test 3: report admin → 400 =====
  const t3 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: adminId, targetType: "host", category: "虚假资料", details: "测 admin" },
  });
  eq("4.1 report-admin 400", t3.status, 400);
  contains("4.2 report-admin msg", t3.data && t3.data.error, "admin");

  // ===== 5. Test 4: report nonexistent → 404 =====
  const t4 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: "00000000-0000-0000-0000-000000000000", targetType: "host", category: "虚假资料", details: "测不存在" },
  });
  eq("5.1 unknown-target 404", t4.status, 404);
  contains("5.2 unknown-target msg", t4.data && t4.data.error, "不存在");

  // ===== 6. Test 5: A report B (valid) → 200 =====
  const t5 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: B.id, targetType: "host", category: "虚假资料", details: "举报 B 资料造假，详情 500 字以内" },
  });
  eq("6.1 valid-report 200", t5.status, 200);
  ok("6.2 valid-report returns id", !!(t5.data && t5.data.id));
  ok("6.3 valid-report status pending", t5.data && t5.data.status === "pending");
  const reportB_id = t5.data.id;

  // ===== 7. Test 6: details > 500 → 400 =====
  const longDetails = "x".repeat(501);
  const t6 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: C.id, targetType: "owner", category: "其他", details: longDetails },
  });
  eq("7.1 details-too-long 400", t6.status, 400);
  contains("7.2 details-too-long msg", t6.data && t6.data.error, "500");

  // ===== 8. Test 7: category not in whitelist → 400 =====
  const t7 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: C.id, targetType: "owner", category: "非法类别", details: "测类别" },
  });
  eq("8.1 bad-category 400", t7.status, 400);
  contains("8.2 bad-category msg", t7.data && t7.data.error, "白名单");

  // ===== 9. Test 8: missing required fields → 400 =====
  const t8a = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: C.id, targetType: "owner" },
  });
  eq("9.1 missing-category 400", t8a.status, 400);
  const t8b = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: C.id, category: "其他", details: "测" },
  });
  eq("9.2 missing-targetType 400", t8b.status, 400);
  const t8c = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetType: "owner", category: "其他", details: "测" },
  });
  eq("9.3 missing-targetUserId 400", t8c.status, 400);

  // ===== 10. Test 9: duplicate report pending → 400 =====
  const t9 = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: B.id, targetType: "host", category: "虚假资料", details: "重复举报" },
  });
  eq("10.1 duplicate-pending 400", t9.status, 400);
  contains("10.2 duplicate-pending msg", t9.data && t9.data.error, "已举报过");

  // ===== 11. Test 10: search filter =====
  // B applies + admin verifies → B in search
  await applyHost(B);
  await verifyHost(adminToken, B.id);
  const bProfileId = await getProfileId(B.token);
  ok("11.0 got B profileId", !!bProfileId);

  // B 在 search 中（此时未 ban，未 blacklist confirmed）
  const searchBefore = await api("GET", "/api/hosts/search?district=海淀区&pageSize=50");
  ok("11.1 search before 200", searchBefore.status === 200);
  const bInSearchBefore = (searchBefore.data.hosts || []).some(h => h.userId === B.id);
  ok("11.2 B in search before", bInSearchBefore);

  // ===== 11b. Test 12 (my-B side) BEFORE confirm+ban (B 的 session 还在) =====
  const myB = await api("GET", "/api/blacklist/my", { token: B.token });
  eq("11b.1 my-B 200", myB.status, 200);
  ok("11b.2 my-B reportedAgainstMe has 1", Array.isArray(myB.data.reportedAgainstMe) && myB.data.reportedAgainstMe.length === 1);
  ok("11b.3 my-B reportedAgainstMe reporter is A", myB.data.reportedAgainstMe && myB.data.reportedAgainstMe[0].reporter.userId === A.id);
  ok("11b.4 my-B reportedAgainstMe status pending", myB.data.reportedAgainstMe && myB.data.reportedAgainstMe[0].status === "pending");

  // ===== 11c. Test 12 (my-A side) =====
  const myA = await api("GET", "/api/blacklist/my", { token: A.token });
  eq("11c.1 my-A 200", myA.status, 200);
  ok("11c.2 my-A reported has 1", Array.isArray(myA.data.reported) && myA.data.reported.length === 1);
  ok("11c.3 my-A reported target is B", myA.data.reported && myA.data.reported[0].target.userId === B.id);
  ok("11c.4 my-A reportedAgainstMe empty", Array.isArray(myA.data.reportedAgainstMe) && myA.data.reportedAgainstMe.length === 0);

  // 未登录 401
  const t12c = await api("GET", "/api/blacklist/my");
  eq("11c.5 my not-logged 401", t12c.status, 401);

  // ===== 11d. admin confirm B 的举报 + banUser=true =====
  const confirmB = await api("POST", "/api/admin/blacklist/" + reportB_id, {
    token: adminToken,
    body: { action: "confirm", banUser: true },
  });
  eq("11d.1 confirm B 200", confirmB.status, 200);
  ok("11d.2 confirm B status confirmed", confirmB.data && confirmB.data.status === "confirmed");
  ok("11d.3 confirm B banUser true", confirmB.data && confirmB.data.banUser === true);

  // B 不在 search 中
  const searchAfter = await api("GET", "/api/hosts/search?district=海淀区&pageSize=50");
  const bInSearchAfter = (searchAfter.data.hosts || []).some(h => h.userId === B.id);
  ok("11d.4 B NOT in search after confirm+ban", !bInSearchAfter);

  // ===== 12. Test 11: public blacklist GET =====
  const t11 = await api("GET", "/api/blacklist");
  eq("12.1 public-list 200 (no login)", t11.status, 200);
  ok("12.2 public-list has items", Array.isArray(t11.data.items) && t11.data.items.length >= 1);
  const bItem = (t11.data.items || []).find(x => x.target.userId === B.id);
  ok("12.3 public-list contains B", !!bItem);
  if (bItem) {
    // 手机后 4 位（不含前 7 位）
    notContains("12.4 public-list masks phone prefix", bItem.target.phone, "139");
    // 昵称脱敏：首字 + **
    contains("12.5 public-list masks nickname", bItem.target.nickname, "**");
    notContains("12.6 public-list no real nickname", bItem.target.nickname, "被举报");
  }

  // ===== 13. Test 13: admin dismiss a new report =====
  // A 举报 C（新举报）
  const reportC = await api("POST", "/api/blacklist", {
    token: A.token,
    body: { targetUserId: C.id, targetType: "owner", category: "失联/放鸽子", details: "举报 C 失联" },
  });
  eq("14.1 A-report-C 200", reportC.status, 200);
  const reportC_id = reportC.data.id;

  // admin dismiss
  const dismissC = await api("POST", "/api/admin/blacklist/" + reportC_id, {
    token: adminToken,
    body: { action: "dismiss" },
  });
  eq("14.2 admin dismiss 200", dismissC.status, 200);
  ok("14.3 dismiss status dismissed", dismissC.data && dismissC.data.status === "dismissed");

  // ===== 15. Test 14: duplicate handling → 400 =====
  const t14 = await api("POST", "/api/admin/blacklist/" + reportC_id, {
    token: adminToken,
    body: { action: "dismiss" },
  });
  eq("15.1 re-handle 400", t14.status, 400);
  contains("15.2 re-handle msg", t14.data && t14.data.error, "已处理");

  // ===== 16. Test 15: non-admin / not-logged / unknown id =====
  const t15a = await api("POST", "/api/admin/blacklist/" + reportB_id, {
    token: A.token,
    body: { action: "dismiss" },
  });
  eq("16.1 non-admin 403", t15a.status, 403);
  const t15b = await api("POST", "/api/admin/blacklist/" + reportB_id, {
    body: { action: "dismiss" },
  });
  eq("16.2 not-logged 401", t15b.status, 401);
  const t15c = await api("POST", "/api/admin/blacklist/00000000-0000-0000-0000-000000000000", {
    token: adminToken,
    body: { action: "dismiss" },
  });
  eq("16.3 unknown-id 404", t15c.status, 404);

  // ===== 17. Test 16: banUser effect on apply/book =====
  // B 已被 ban（sessions 已删除）
  // B 尝试 login → 403
  const bLogin = await api("POST", "/api/auth/login", { body: { phone: B.phone || "", password: "pass123456" } });
  // B 的 phone 我们没记录，用 nickname 找不到；直接测 B 旧 session 失效 + apply 403
  // 用 B 的旧 token 调 apply（session 已被删除 → 401）
  const bApply = await api("POST", "/api/hosts/apply", { token: B.token, body: APPLY_BODY });
  eq("17.1 banned-user apply (old session deleted) 401", bApply.status, 401);

  // 再创建一个新的 C2 用户，先给 ban 再测 apply
  const C2 = await register("测试C2");
  // C2 用正常 token 调 apply → 应该 200
  const c2Apply1 = await api("POST", "/api/hosts/apply", { token: C2.token, body: APPLY_BODY });
  eq("17.2 C2 pre-ban apply 200", c2Apply1.status, 200);
  // admin ban C2 via admin/users/ban
  const banC2 = await api("POST", "/api/admin/users/ban", { token: adminToken, body: { userId: C2.id, banned: 1 } });
  ok("17.3 admin ban C2 success", banC2.status === 200, JSON.stringify(banC2.data));
  // C2 再调 apply → 401（session 被删）或 403（若 session 未删）
  const c2Apply2 = await api("POST", "/api/hosts/apply", { token: C2.token, body: APPLY_BODY });
  ok("17.4 C2 post-ban apply rejected", c2Apply2.status === 401 || c2Apply2.status === 403,
     "got=" + c2Apply2.status + " data=" + JSON.stringify(c2Apply2.data));

  // 用 book 端点测 ban：找一个未 ban 的寄养人 D
  const D = await register("寄养人D");
  await applyHost(D);
  await verifyHost(adminToken, D.id);
  const dProfileId = await getProfileId(D.token);
  // D 需要担保人才能接单（首单担保）
  const dSponsor = await api("POST", "/api/admin/hosts/" + D.id + "/sponsor", { token: adminToken, body: { sponsorUserId: adminId } });
  ok("17.4b admin sponsor D", dSponsor.status === 200, JSON.stringify(dSponsor.data));
  // D 设置可用性（覆盖 10-60 天）
  const dAvail = await api("PUT", "/api/hosts/me/availability", { token: D.token, body: [{ start_date: isoDay(10), end_date: isoDay(60), note: "D 档期" }] });
  ok("17.4c D availability set", dAvail.status === 200, JSON.stringify(dAvail.data));
  // A 创建 pet + need
  const { needId } = await makeOwnerPetNeed(A);
  // D 接单 → 200
  const dBook = await api("POST", "/api/hosts/" + dProfileId + "/book", { token: D.token, body: { needId: needId } });
  eq("17.5 D pre-ban book 200", dBook.status, 200);
  // admin ban D
  await api("POST", "/api/admin/users/ban", { token: adminToken, body: { userId: D.id, banned: 1 } });
  // A 创建新 need
  const { needId: needId2 } = await makeOwnerPetNeed(A);
  // D 再 book → 401（session 删）或 403
  const dBook2 = await api("POST", "/api/hosts/" + dProfileId + "/book", { token: D.token, body: { needId: needId2 } });
  ok("17.6 D post-ban book rejected", dBook2.status === 401 || dBook2.status === 403,
     "got=" + dBook2.status + " data=" + JSON.stringify(dBook2.data));

  // ===== 18. Summary =====
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
