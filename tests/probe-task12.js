// Task 12 test: sponsor invite + accept + my flow
// Node 18+ native fetch
// Backend: functions/api/sponsors/{invite,accept,my}.js
//
// Setup notes:
//   - H1 = new host, invite originator (needs sponsorship)
//   - H2 = qualified sponsor (3 completed + 5-star reviews)
//   - H3 = registered only (not a host) — for test 5 + test 11
//   - A  = owner (creates pets + needs)
//
// H2's 3 completed orders require is_sponsored=1 (book endpoint checks it).
// We use the admin override endpoint for H2 ONLY (setup), not for H1.
// H1 goes through the formal invite/accept flow end-to-end.

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

// Run one full order lifecycle: book → accept → start → complete → review
// Returns the order id.
async function runOrder(adminToken, ownerId, ownerToken, hostProfileId, hostToken, needId, reviewRating) {
  // Host books
  const b = await api("POST", "/api/hosts/" + hostProfileId + "/book", { token: hostToken, body: { needId: needId } });
  if (b.status !== 200) throw new Error("book fail: " + JSON.stringify(b.data) + " needId=" + needId);
  const orderId = b.data.id;
  // Owner accepts
  const a = await api("POST", "/api/orders/" + orderId + "/status", { token: ownerToken, body: { action: "accept" } });
  if (a.status !== 200) throw new Error("accept fail: " + JSON.stringify(a.data));
  // Host starts
  const s = await api("POST", "/api/orders/" + orderId + "/status", { token: hostToken, body: { action: "start" } });
  if (s.status !== 200) throw new Error("start fail: " + JSON.stringify(s.data));
  // Host completes
  const c = await api("POST", "/api/orders/" + orderId + "/status", { token: hostToken, body: { action: "complete" } });
  if (c.status !== 200) throw new Error("complete fail: " + JSON.stringify(c.data));
  // Owner reviews (optional)
  if (reviewRating) {
    const rv = await api("POST", "/api/orders/" + orderId + "/review", {
      token: ownerToken,
      body: { rating: reviewRating, content: "非常好", tags: ["照顾周到", "沟通顺畅"] },
    });
    if (rv.status !== 200) throw new Error("review fail: " + JSON.stringify(rv.data));
  }
  return orderId;
}

async function main() {
  // ===== 0. admin =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  ok("0.1 admin login", adm.status === 200, JSON.stringify(adm.data));
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(10);

  // ===== 1. users =====
  const A = await register("主人A");
  const H1 = await register("新寄养人H1");
  const H2 = await register("老寄养人H2");
  const H3 = await register("路人H3");
  ok("1.1 four users registered", !!A.token && !!H1.token && !!H2.token && !!H3.token);

  // ===== 2. Test 1: non-host invite → 403 =====
  const t1 = await api("POST", "/api/sponsors/invite", { token: A.token, body: { sponsorUserId: H2.id } });
  eq("2.1 non-host invite 403", t1.status, 403);

  // ===== 3. H1 + H2 apply (not yet verified) =====
  await applyHost(H1);
  await applyHost(H2);

  // Test 2: pending host invite → 403
  const t2 = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H2.id } });
  eq("3.1 pending-host invite 403", t2.status, 403);

  // ===== 4. verify H1 + H2 =====
  await verifyHost(adminToken, H1.id);
  await verifyHost(adminToken, H2.id);
  const h1ProfileId = await getProfileId(H1.token);
  const h2ProfileId = await getProfileId(H2.token);
  ok("4.1 got H1 profileId", !!h1ProfileId);
  ok("4.2 got H2 profileId", !!h2ProfileId);

  // ===== 5. Test 3: H1 invite self → 400 =====
  const t3 = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H1.id } });
  eq("5.1 self-invite 400", t3.status, 400);

  // ===== 6. Test 4: invite nonexistent → 404 =====
  const t4 = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: "00000000-0000-0000-0000-000000000000" } });
  eq("6.1 unknown target 404", t4.status, 404);

  // ===== 7. Test 5: invite non-active host → 400 =====
  // H3 is registered only, not a host
  const t5 = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H3.id } });
  eq("7.1 non-active target 400", t5.status, 400);

  // ===== 8. Test 6a: H2 has 0 completed orders → 400 =====
  const t6a = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H2.id } });
  eq("8.1 zero-orders sponsor 400", t6a.status, 400);
  contains("8.2 zero-orders msg", t6a.data && t6a.data.error, "3 单");

  // ===== 9. H2 setup: admin sponsor (setup only) + 3 orders =====
  // Admin override: sponsor H2 (so H2 can book orders). NOT used for H1.
  const h2sp = await api("POST", "/api/admin/hosts/" + H2.id + "/sponsor", { token: adminToken, body: { sponsorUserId: adminId } });
  ok("9.1 admin sponsor H2 (setup)", h2sp.status === 200 && h2sp.data.isSponsored === true, JSON.stringify(h2sp.data));

  // H2 sets availability covering 10-60 days
  const covStart = isoDay(10), covEnd = isoDay(60);
  const avail2 = await api("PUT", "/api/hosts/me/availability", { token: H2.token, body: [{ start_date: covStart, end_date: covEnd, note: "覆盖全部需求" }] });
  ok("9.2 H2 availability set", avail2.status === 200, JSON.stringify(avail2.data));

  // A creates 1 pet + 3 needs
  const pet = await api("POST", "/api/pets", { token: A.token, body: { name: "豆豆", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  ok("9.3 A created pet", pet.status === 200, JSON.stringify(pet.data));
  const petId = pet.data.id;

  const mkNeed = function (sOff, eOff) {
    return api("POST", "/api/needs", {
      token: A.token,
      body: { petId: petId, startDate: isoDay(sOff), endDate: isoDay(eOff), expectedPriceCents: 12000, expectedArea: "海淀区", description: "节假日寄养" },
    });
  };

  const need1 = await mkNeed(12, 16);
  const need2 = await mkNeed(20, 24);
  const need3 = await mkNeed(30, 34);
  ok("9.4 three needs created", need1.status === 200 && need2.status === 200 && need3.status === 200);

  // H2 books + completes 3 orders (NO reviews yet — for test 6b)
  const o1 = await runOrder(adminToken, A.id, A.token, h2ProfileId, H2.token, need1.data.id, 0);
  const o2 = await runOrder(adminToken, A.id, A.token, h2ProfileId, H2.token, need2.data.id, 0);
  const o3 = await runOrder(adminToken, A.id, A.token, h2ProfileId, H2.token, need3.data.id, 0);
  ok("9.5 H2 completed 3 orders", !!o1 && !!o2 && !!o3);

  // ===== 10. Test 6b: H2 has 3 orders but avg_rating=0 → 400 rating =====
  const t6b = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H2.id } });
  eq("10.1 low-rating sponsor 400", t6b.status, 400);
  contains("10.2 low-rating msg", t6b.data && t6b.data.error, "4.5");

  // ===== 11. A reviews H2 with 5 stars x3 =====
  for (const oid of [o1, o2, o3]) {
    const rv = await api("POST", "/api/orders/" + oid + "/review", {
      token: A.token,
      body: { rating: 5, content: "非常好", tags: ["照顾周到", "沟通顺畅", "环境整洁"] },
    });
    if (rv.status !== 200) throw new Error("review fail: " + JSON.stringify(rv.data));
  }
  ok("11.1 A gave H2 5-star reviews x3", true);

  // ===== 12. Test 7: H1 invite H2 → 200 =====
  const t7 = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H2.id } });
  eq("12.1 successful invite 200", t7.status, 200);
  ok("12.2 invite returns sponsorId", !!(t7.data && t7.data.id));
  ok("12.3 invite returns status invited", t7.data && t7.data.status === "invited");
  const sponsorRowId = t7.data.id;

  // ===== 13. Test 8: duplicate invite → 400 =====
  const t8 = await api("POST", "/api/sponsors/invite", { token: H1.token, body: { sponsorUserId: H2.id } });
  eq("13.1 duplicate invite 400", t8.status, 400);
  contains("13.2 duplicate invite msg", t8.data && t8.data.error, "已发送过邀请");

  // ===== 14. Test 9: missing body → 400; not logged → 401 =====
  const t9a = await api("POST", "/api/sponsors/invite", { token: H1.token, body: {} });
  eq("14.1 missing sponsorUserId 400", t9a.status, 400);
  const t9b = await api("POST", "/api/sponsors/invite", { body: { sponsorUserId: H2.id } });
  eq("14.2 not-logged invite 401", t9b.status, 401);

  // ===== 15. Test 10: H1 book before accept → 400 =====
  const need4 = await mkNeed(40, 44);
  ok("15.0 need4 created", need4.status === 200);
  const t10 = await api("POST", "/api/hosts/" + h1ProfileId + "/book", { token: H1.token, body: { needId: need4.data.id } });
  eq("15.1 book before sponsor 400", t10.status, 400);
  contains("15.2 book msg mentions sponsor", t10.data && t10.data.error, "担保");

  // ===== 16. Test 11: H3 accepts H1's invite → 403 =====
  const t11 = await api("POST", "/api/sponsors/accept", { token: H3.token, body: { sponsorId: sponsorRowId } });
  eq("16.1 wrong-recipient accept 403", t11.status, 403);

  // ===== 17. Test 12: H2 accepts → 200 =====
  const t12 = await api("POST", "/api/sponsors/accept", { token: H2.token, body: { sponsorId: sponsorRowId } });
  eq("17.1 accept 200", t12.status, 200);
  ok("17.2 accept returns success", t12.data && t12.data.success === true);
  ok("17.3 accept returns isSponsored true", t12.data && t12.data.isSponsored === true);

  // GET /sponsors/my (H1) → sponsored=true, sponsoredBy has value
  const my1 = await api("GET", "/api/sponsors/my", { token: H1.token });
  eq("17.4 my 200", my1.status, 200);
  ok("17.5 my sponsored=true", my1.data && my1.data.sponsored === true);
  ok("17.6 my sponsoredBy present", my1.data && my1.data.sponsoredBy && my1.data.sponsoredBy.sponsorId === H2.id);
  ok("17.7 my sponsoredAt set", my1.data && my1.data.sponsoredBy && !!my1.data.sponsoredBy.sponsoredAt);

  // ===== 18. Test 13: H1 book → 200 =====
  // H1 needs availability covering need4
  const h1Avail = await api("PUT", "/api/hosts/me/availability", { token: H1.token, body: [{ start_date: isoDay(38), end_date: isoDay(48), note: "H1 档期" }] });
  ok("18.1 H1 availability set", h1Avail.status === 200);
  const t13 = await api("POST", "/api/hosts/" + h1ProfileId + "/book", { token: H1.token, body: { needId: need4.data.id } });
  eq("18.2 H1 book after sponsor 200", t13.status, 200);
  ok("18.3 book returns pending status", t13.data && t13.data.status === "pending");

  // ===== 19. Test 14: accept edge cases =====
  // Duplicate accept same sponsorId → 400 (already sponsored)
  const t14a = await api("POST", "/api/sponsors/accept", { token: H2.token, body: { sponsorId: sponsorRowId } });
  eq("19.1 duplicate accept 400", t14a.status, 400);
  contains("19.2 duplicate accept msg", t14a.data && t14a.data.error, "已获得其他担保");
  // Accept nonexistent sponsorId → 404
  const t14b = await api("POST", "/api/sponsors/accept", { token: H2.token, body: { sponsorId: "00000000-0000-0000-0000-000000000000" } });
  eq("19.3 unknown sponsorId 404", t14b.status, 404);
  // Not logged → 401
  const t14c = await api("POST", "/api/sponsors/accept", { body: { sponsorId: sponsorRowId } });
  eq("19.4 not-logged accept 401", t14c.status, 401);

  // ===== 20. Test 15: GET /sponsors/my edge cases =====
  // Non-host → 403
  const t15a = await api("GET", "/api/sponsors/my", { token: A.token });
  eq("20.1 non-host my 403", t15a.status, 403);
  // Not logged → 401
  const t15b = await api("GET", "/api/sponsors/my");
  eq("20.2 not-logged my 401", t15b.status, 401);
  // H2 side: pendingInvites=[], receivedInvites=[]
  const my2 = await api("GET", "/api/sponsors/my", { token: H2.token });
  eq("20.3 H2 my 200", my2.status, 200);
  ok("20.4 H2 pendingInvites empty", Array.isArray(my2.data.pendingInvites) && my2.data.pendingInvites.length === 0);
  ok("20.5 H2 receivedInvites empty (accepted filtered)", Array.isArray(my2.data.receivedInvites) && my2.data.receivedInvites.length === 0);
  // H1 side: pendingInvites empty (already sponsored)
  ok("20.6 H1 pendingInvites empty", Array.isArray(my1.data.pendingInvites) && my1.data.pendingInvites.length === 0);
  // H1 side: receivedInvites empty (H1 is not a sponsor of anyone)
  ok("20.7 H1 receivedInvites empty", Array.isArray(my1.data.receivedInvites) && my1.data.receivedInvites.length === 0);

  // ===== 21. Summary =====
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
