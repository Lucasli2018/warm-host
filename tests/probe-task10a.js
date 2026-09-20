// Task 10a test: booking + state machine + my orders + order detail
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

// /api/needs/my 返回裸数组，兼容 {needs:[]} 包装
function needsList(data) {
  return (data && (data.needs || data)) || [];
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
  // ===== 0. admin =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  ok("0.1 admin login", adm.status === 200, JSON.stringify(adm.data));
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(4);

  // ===== 1. users =====
  const A = await register("主人A");
  const B = await register("寄养人B");
  const C = await register("路人C");
  ok("1.1 three users registered", !!A.token && !!B.token && !!C.token);

  // ===== 2. B becomes host =====
  const applyBody = {
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
  const apply = await api("POST", "/api/hosts/apply", { token: B.token, body: applyBody });
  ok("2.1 B apply host", apply.status === 200, JSON.stringify(apply.data));

  const verify = await api("POST", "/api/admin/hosts/" + B.id, { token: adminToken, body: { action: "verify" } });
  ok("2.2 admin verify B", verify.status === 200, JSON.stringify(verify.data));

  const myHost = await api("GET", "/api/hosts/me", { token: B.token });
  const prof = myHost.data.profile || myHost.data.hostProfile || {};
  const bProfileId = prof.id;
  ok("2.3 got profileId", !!bProfileId, JSON.stringify(myHost.data).slice(0, 200));
  if (!bProfileId) throw new Error("no profileId");

  // ===== 3. pet + need =====
  const pet = await api("POST", "/api/pets", { token: A.token, body: { name: "豆豆", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  ok("3.1 A create pet", pet.status === 200, JSON.stringify(pet.data));
  const petId = pet.data.id;

  const mkNeed = function (sOff, eOff) {
    return api("POST", "/api/needs", {
      token: A.token,
      body: { petId: petId, startDate: isoDay(sOff), endDate: isoDay(eOff), expectedPriceCents: 12000, expectedArea: "海淀区", description: "节假日寄养" },
    });
  };

  // ===== 4. availability =====
  const covStart = isoDay(10), covEnd = isoDay(40);
  const avail = await api("PUT", "/api/hosts/me/availability", { token: B.token, body: [{ start_date: covStart, end_date: covEnd, note: "国庆档期" }] });
  ok("4.1 B set availability", avail.status === 200, JSON.stringify(avail.data));

  // ===== 5. sponsor gate =====
  const need1 = await mkNeed(12, 16);
  ok("5.1 create need1", need1.status === 200, JSON.stringify(need1.data));
  const need1Id = need1.data.id;

  const book1 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need1Id } });
  eq("5.2 no-sponsor book rejected 400", book1.status, 400);

  const sponsor = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: { sponsorUserId: adminId } });
  ok("5.3 admin sponsor B", sponsor.status === 200 && sponsor.data.isSponsored === true, JSON.stringify(sponsor.data));

  // ===== 6. booking =====
  const book2 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need1Id } });
  eq("6.1 book 200", book2.status, 200);
  eq("6.2 status pending", book2.data && book2.data.status, "pending");
  eq("6.3 duration 5 days", book2.data && book2.data.durationDays, 5);
  eq("6.4 total 60000 cents", book2.data && book2.data.totalPriceCents, 60000);
  const order1 = book2.data.id;

  const myNeeds = await api("GET", "/api/needs/my", { token: A.token });
  const n1 = needsList(myNeeds.data).find(function (n) { return n.id === need1Id; });
  eq("6.5 need -> matched", n1 && n1.status, "matched");

  const dup = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need1Id } });
  eq("6.6 duplicate book 409", dup.status, 409);

  const selfBook = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: A.token, body: { needId: need1Id } });
  ok("6.7 non-host book 403", selfBook.status === 403, JSON.stringify(selfBook.data));

  const noBody = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: {} });
  eq("6.8 missing needId 400", noBody.status, 400);

  const badHost = await api("POST", "/api/hosts/nonexistent/book", { token: B.token, body: { needId: need1Id } });
  eq("6.9 unknown host 404", badHost.status, 404);

  // ===== 7. coverage =====
  const need2 = await mkNeed(50, 54);
  ok("7.1 create need2 outside coverage", need2.status === 200, JSON.stringify(need2.data));
  const book3 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need2.data.id } });
  eq("7.2 coverage mismatch 400", book3.status, 400);

  // ===== 8. my orders =====
  const ownOrders = await api("GET", "/api/orders/my?role=owner", { token: A.token });
  eq("8.1 A orders count 1", ownOrders.data.orders.length, 1);
  eq("8.2 owner view flag", ownOrders.data.orders[0].isOwnerView, true);
  const hostOrders = await api("GET", "/api/orders/my?role=host", { token: B.token });
  eq("8.3 B orders count 1", hostOrders.data.orders.length, 1);
  eq("8.4 host view flag", hostOrders.data.orders[0].isOwnerView, false);
  eq("8.5 order has pet", hostOrders.data.orders[0].pet.name, "豆豆");
  eq("8.6 order has peer nickname", hostOrders.data.orders[0].owner.nickname, "主人A");
  const myNoAuth = await api("GET", "/api/orders/my");
  eq("8.7 my orders 401", myNoAuth.status, 401);

  // ===== 9. detail =====
  const det = await api("GET", "/api/orders/" + order1, { token: A.token });
  eq("9.1 detail 200", det.status, 200);
  eq("9.2 viewerRole owner", det.data.viewerRole, "owner");
  eq("9.3 canReview false", det.data.canReview, false);
  eq("9.4 revieweeId = host", det.data.revieweeId, B.id);
  ok("9.5 pet personality array", Array.isArray(det.data.pet.personality));
  ok("9.6 host profile fields", !!det.data.host && det.data.host.dailyRateCents === 12000);

  const detHost = await api("GET", "/api/orders/" + order1, { token: B.token });
  eq("9.7 host view revieweeId = owner", detHost.data.revieweeId, A.id);

  const detOther = await api("GET", "/api/orders/" + order1, { token: C.token });
  eq("9.8 unrelated user 403", detOther.status, 403);

  const det404 = await api("GET", "/api/orders/00000000-0000-0000-0000-000000000000", { token: A.token });
  eq("9.9 unknown order 404", det404.status, 404);

  // ===== 10. state machine =====
  const st = function (action, token) {
    return api("POST", "/api/orders/" + order1 + "/status", { token: token, body: { action: action } });
  };

  const s1 = await st("accept", B.token);
  eq("10.1 host cannot accept 403", s1.status, 403);

  const s2 = await st("accept", A.token);
  eq("10.2 owner accept 200", s2.status, 200);
  eq("10.3 status accepted", s2.data.status, "accepted");
  const d2 = await api("GET", "/api/orders/" + order1, { token: A.token });
  ok("10.4 accepted_at set", !!d2.data.order.acceptedAt);

  const s3 = await st("start", A.token);
  eq("10.5 owner cannot start 403", s3.status, 403);

  const s4 = await st("start", B.token);
  eq("10.6 host start 200", s4.status, 200);
  const d4 = await api("GET", "/api/orders/" + order1, { token: B.token });
  ok("10.7 started_at set", !!d4.data.order.startedAt);

  const s5 = await st("complete", A.token);
  eq("10.8 owner cannot complete 403", s5.status, 403);

  const s6 = await st("complete", B.token);
  eq("10.9 host complete 200", s6.status, 200);
  const d6 = await api("GET", "/api/orders/" + order1, { token: A.token });
  ok("10.10 completed_at set", !!d6.data.order.completedAt);
  ok("10.11 canReview true after complete", d6.data.canReview === true);
  const nm2 = await api("GET", "/api/needs/my", { token: A.token });
  const n1after = needsList(nm2.data).find(function (n) { return n.id === need1Id; });
  eq("10.12 need -> filled", n1after.status, "filled");

  const s7 = await st("start", B.token);
  eq("10.13 terminal reject 400", s7.status, 400);
  const s8 = await st("cancel", A.token);
  eq("10.14 terminal cancel 400", s8.status, 400);

  // ===== 11. pending -> cancel releases need =====
  const need3 = await mkNeed(20, 24);
  const b4 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need3.data.id } });
  eq("11.1 book 200", b4.status, 200);
  const c1 = await api("POST", "/api/orders/" + b4.data.id + "/status", { token: A.token, body: { action: "cancel" } });
  eq("11.2 cancel at pending 200", c1.status, 200);
  eq("11.3 status cancelled", c1.data.status, "cancelled");
  const nm3 = await api("GET", "/api/needs/my", { token: A.token });
  const n3 = needsList(nm3.data).find(function (n) { return n.id === need3.data.id; });
  eq("11.4 need released to open", n3.status, "open");
  const d11 = await api("GET", "/api/orders/" + b4.data.id, { token: A.token });
  ok("11.5 cancelled_at set", !!d11.data.order.cancelledAt);

  // ===== 12. accepted -> cancel =====
  const need4 = await mkNeed(26, 29);
  const b5 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need4.data.id } });
  eq("12.1 book 200", b5.status, 200);
  const a1 = await api("POST", "/api/orders/" + b5.data.id + "/status", { token: A.token, body: { action: "accept" } });
  eq("12.2 accept 200", a1.status, 200);
  const c2 = await api("POST", "/api/orders/" + b5.data.id + "/status", { token: B.token, body: { action: "cancel" } });
  eq("12.3 cancel at accepted 200", c2.status, 200);
  const nm4 = await api("GET", "/api/needs/my", { token: A.token });
  const n4 = needsList(nm4.data).find(function (n) { return n.id === need4.data.id; });
  eq("12.4 need -> cancelled", n4.status, "cancelled");

  // ===== 13. dispute =====
  const need5 = await mkNeed(32, 35);
  const b6 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need5.data.id } });
  eq("13.1 book 200", b6.status, 200);
  await api("POST", "/api/orders/" + b6.data.id + "/status", { token: A.token, body: { action: "accept" } });
  await api("POST", "/api/orders/" + b6.data.id + "/status", { token: B.token, body: { action: "start" } });
  const ds = await api("POST", "/api/orders/" + b6.data.id + "/status", { token: A.token, body: { action: "dispute" } });
  eq("13.2 dispute 200", ds.status, 200);
  eq("13.3 status disputed", ds.data.status, "disputed");
  const after = await api("POST", "/api/orders/" + b6.data.id + "/status", { token: B.token, body: { action: "cancel" } });
  eq("13.4 no cancel after dispute 400", after.status, 400);

  // ===== 14. invalid / unauthorized =====
  const bad = await api("POST", "/api/orders/" + order1 + "/status", { token: A.token, body: { action: "fly" } });
  eq("14.1 invalid action 400", bad.status, 400);
  const noAct = await api("POST", "/api/orders/" + order1 + "/status", { token: A.token, body: {} });
  eq("14.2 missing action 400", noAct.status, 400);
  const other = await api("POST", "/api/orders/" + order1 + "/status", { token: C.token, body: { action: "cancel" } });
  eq("14.3 unrelated user 403", other.status, 403);
  const unauth = await api("POST", "/api/orders/" + order1 + "/status", { body: { action: "cancel" } });
  eq("14.4 not logged 401", unauth.status, 401);

  // ===== 15. sponsor endpoint guards =====
  const spNoAuth = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { body: { sponsorUserId: adminId } });
  eq("15.1 sponsor 401", spNoAuth.status, 401);
  const spNoRole = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: A.token, body: { sponsorUserId: adminId } });
  eq("15.2 sponsor non-admin 403", spNoRole.status, 403);
  const spNoBody = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: {} });
  eq("15.3 sponsor missing body 400", spNoBody.status, 400);
  const spBad = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: { sponsorUserId: C.id } });
  eq("15.4 sponsor not active host 400", spBad.status, 400);
  const spMissing = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: { sponsorUserId: "00000000-0000-0000-0000-000000000000" } });
  eq("15.5 sponsor unknown 404", spMissing.status, 404);
  const spNoProfile = await api("POST", "/api/admin/hosts/" + C.id + "/sponsor", { token: adminToken, body: { sponsorUserId: adminId } });
  eq("15.6 target no profile 404", spNoProfile.status, 404);
  const spClear = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: { clear: true } });
  eq("15.7 clear sponsor 200", spClear.status, 200);
  ok("15.8 isSponsored false after clear", spClear.data.isSponsored === false);

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
