// Task 11 test: review system (backend + frontend)
// Node 18+ native fetch

const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const BASE = "http://localhost:8787";
const ROOT = path.resolve(__dirname, "..");

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
function hasAll(name, text, subs) {
  for (const s of subs) {
    if (typeof text !== "string" || text.indexOf(s) === -1) {
      fail++; failures.push("FAIL " + name + " missing: " + s);
      return;
    }
  }
  pass++;
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

async function uploadApi(path, file, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: headers,
    body: fd,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

function isoDay(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

// ===== 1x1 PNG (minimal valid) =====
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE,
  0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03,
  0x00, 0x01, 0x77, 0x75, 0xDA, 0x14,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0xAE, 0x42, 0x60, 0x82,
]);

let adminToken = null, adminId = null, codesCache = [];

async function ensureCodes(n) {
  while (codesCache.length < n) {
    const r = await api("POST", "/api/admin/invite-codes", { token: adminToken, body: { count: Math.min(10, n - codesCache.length) } });
    if (r.status !== 200) throw new Error("gen codes fail: " + JSON.stringify(r.data));
    const newCodes = r.data.codes || [];
    codesCache = codesCache.concat(newCodes);
    if (newCodes.length === 0) throw new Error("no codes generated");
  }
}

async function register(nickname) {
  if (codesCache.length === 0) throw new Error("no code for " + nickname);
  const code = codesCache.pop();
  // 11-digit phone: 1[3-9] + 9 digits
  const phone = "1" + (3 + Math.floor(Math.random() * 7)) + String(100000000 + Math.floor(Math.random() * 900000000));
  const r = await api("POST", "/api/auth/register", { body: { phone: phone, password: "pass123456", nickname: nickname, inviteCode: code } });
  if (r.status !== 200) throw new Error("register fail " + nickname + ": " + JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.user.id, nickname: nickname };
}

async function completeOrder(orderId) {
  // helper: advance order to completed (accept → start → complete)
  const accept = await api("POST", "/api/orders/" + orderId + "/status", { token: A.token, body: { action: "accept" } });
  if (accept.status !== 200) throw new Error("accept fail " + orderId + ": " + JSON.stringify(accept.data));
  const start = await api("POST", "/api/orders/" + orderId + "/status", { token: B.token, body: { action: "start" } });
  if (start.status !== 200) throw new Error("start fail " + orderId + ": " + JSON.stringify(start.data));
  const complete = await api("POST", "/api/orders/" + orderId + "/status", { token: B.token, body: { action: "complete" } });
  if (complete.status !== 200) throw new Error("complete fail " + orderId + ": " + JSON.stringify(complete.data));
  return complete.data.status;
}

// globals set during setup
let A, B, C, petId, bProfileId;
let orderIds = []; // all 5 orders created in setup

async function main() {
  console.log("");

  // ===== 0. Admin setup =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  ok("0.1 admin login", adm.status === 200, JSON.stringify(adm.data));
  adminToken = adm.data.token;
  adminId = adm.data.user.id;
  await ensureCodes(6);

  // ===== 1. Register users =====
  A = await register("主人A");
  B = await register("寄养人B");
  C = await register("路人C");
  ok("1.1 three users registered", !!A.token && !!B.token && !!C.token);

  // ===== 2. B becomes host =====
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
  ok("2.1 B apply host", apply.status === 200, JSON.stringify(apply.data));

  const verify = await api("POST", "/api/admin/hosts/" + B.id, { token: adminToken, body: { action: "verify" } });
  ok("2.2 admin verify B", verify.status === 200, JSON.stringify(verify.data));

  const sponsor = await api("POST", "/api/admin/hosts/" + B.id + "/sponsor", { token: adminToken, body: { sponsorUserId: adminId } });
  ok("2.3 admin sponsor B", sponsor.status === 200, JSON.stringify(sponsor.data));

  const myHost = await api("GET", "/api/hosts/me", { token: B.token });
  bProfileId = myHost.data.profile.id;
  ok("2.4 got profileId", !!bProfileId);
  if (!bProfileId) throw new Error("no profileId");

  // ===== 3. Pet + needs + orders =====
  const pet = await api("POST", "/api/pets", { token: A.token, body: { name: "豆豆", species: "狗", breed: "柯基", gender: "母", age: "2岁" } });
  ok("3.1 A create pet", pet.status === 200, JSON.stringify(pet.data));
  petId = pet.data.id;

  const covStart = isoDay(10), covEnd = isoDay(40);
  const avail = await api("PUT", "/api/hosts/me/availability", { token: B.token, body: [{ start_date: covStart, end_date: covEnd, note: "档期" }] });
  ok("3.2 B set availability", avail.status === 200, JSON.stringify(avail.data));

  // Create 5 needs and book them all
  const needIds = [];
  for (let i = 1; i <= 5; i++) {
    const need = await api("POST", "/api/needs", {
      token: A.token,
      body: { petId: petId, startDate: isoDay(11 + (i - 1) * 4), endDate: isoDay(13 + (i - 1) * 4), expectedPriceCents: 12000, expectedArea: "海淀区", description: "need" + i },
    });
    if (need.status !== 200) throw new Error("create need" + i + " fail: " + JSON.stringify(need.data));
    needIds.push(need.data.id);
  }
  ok("3.3 created 5 needs", needIds.length === 5);

  for (let i = 0; i < needIds.length; i++) {
    const book = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: needIds[i] } });
    if (book.status !== 200) throw new Error("book need" + (i + 1) + " fail: " + JSON.stringify(book.data));
    orderIds.push(book.data.id);
  }
  ok("3.4 booked 5 orders", orderIds.length === 5);

  for (const oid of orderIds) {
    const acc = await api("POST", "/api/orders/" + oid + "/status", { token: A.token, body: { action: "accept" } });
    if (acc.status !== 200) throw new Error("accept " + oid + " fail: " + JSON.stringify(acc.data));
  }
  for (const oid of orderIds) {
    const st = await api("POST", "/api/orders/" + oid + "/status", { token: B.token, body: { action: "start" } });
    if (st.status !== 200) throw new Error("start " + oid + " fail: " + JSON.stringify(st.data));
  }
  ok("3.5 all 5 orders in_progress", true);

  // ============================================================
  // Test 1: 未完成订单提交评价 → 400
  // ============================================================
  const t1 = await api("POST", "/api/orders/" + orderIds[0] + "/review", {
    token: A.token,
    body: { rating: 5, content: "好", tags: ["照顾周到"], photos: [] },
  });
  eq("1.1 in_progress review 400", t1.status, 400);

  // B completes order1
  const comp1 = await api("POST", "/api/orders/" + orderIds[0] + "/status", { token: B.token, body: { action: "complete" } });
  eq("1.2 B complete order1", comp1.status, 200);

  // ============================================================
  // Test 2: completed 订单提交评价 → 200
  // ============================================================
  const t2 = await api("POST", "/api/orders/" + orderIds[0] + "/review", {
    token: A.token,
    body: { rating: 5, content: "寄养体验非常好", tags: ["照顾周到", "环境整洁"], photos: [] },
  });
  eq("2.1 review 200", t2.status, 200);
  ok("2.2 has id", !!t2.data && !!t2.data.id);
  eq("2.3 rating", t2.data && t2.data.rating, 5);
  eq("2.4 content", t2.data && t2.data.content, "寄养体验非常好");
  eq("2.5 tags length", t2.data && t2.data.tags.length, 2);
  ok("2.6 tags content", t2.data && t2.data.tags[0] === "照顾周到" && t2.data.tags[1] === "环境整洁");
  ok("2.7 photos empty array", t2.data && Array.isArray(t2.data.photos) && t2.data.photos.length === 0);
  ok("2.8 has createdAt", t2.data && !!t2.data.createdAt);

  // ============================================================
  // Test 3: 重复提交 → 400
  // ============================================================
  const t3 = await api("POST", "/api/orders/" + orderIds[0] + "/review", {
    token: A.token,
    body: { rating: 5, content: "again" },
  });
  eq("3.1 duplicate 400", t3.status, 400);
  ok("3.2 error msg", t3.data && /已评价/.test(t3.data.error || ""));

  // ============================================================
  // Test 9: Aggregation update (right after test 2+3, exactly 2 reviews)
  // ============================================================
  // B completes order5
  await api("POST", "/api/orders/" + orderIds[4] + "/status", { token: B.token, body: { action: "complete" } });

  // A reviews order5 with rating=3
  const t9 = await api("POST", "/api/orders/" + orderIds[4] + "/review", { token: A.token, body: { rating: 3, content: "还可以" } });
  eq("9.1 review order5 200", t9.status, 200);

  // Check aggregation: order1 rated 5, order5 rated 3 → avg=(5+3)/2=4, total=2
  const aggCheck = await api("GET", "/api/hosts/me", { token: B.token });
  eq("9.2 avgRating=4", aggCheck.data.profile.avg_rating, 4);
  eq("9.3 totalReviews=2", aggCheck.data.profile.total_reviews, 2);

  // ============================================================
  // Test 4-7: B completes order2, negative tests then positive
  // ============================================================
  await api("POST", "/api/orders/" + orderIds[1] + "/status", { token: B.token, body: { action: "complete" } });

  // Test 4: rating validation
  const r0 = await api("POST", "/api/orders/" + orderIds[1] + "/review", { token: A.token, body: { rating: 0, content: "x" } });
  eq("4.1 rating=0 400", r0.status, 400);
  const r6 = await api("POST", "/api/orders/" + orderIds[1] + "/review", { token: A.token, body: { rating: 6, content: "x" } });
  eq("4.2 rating=6 400", r6.status, 400);
  const rabc = await api("POST", "/api/orders/" + orderIds[1] + "/review", { token: A.token, body: { rating: "abc", content: "x" } });
  eq("4.3 rating=abc 400", rabc.status, 400);
  const rfloat = await api("POST", "/api/orders/" + orderIds[1] + "/review", { token: A.token, body: { rating: 2.5, content: "x" } });
  eq("4.4 rating=2.5 400", rfloat.status, 400);

  // Test 5: content length
  const c501 = await api("POST", "/api/orders/" + orderIds[1] + "/review", { token: A.token, body: { rating: 5, content: "a".repeat(501) } });
  eq("5.1 content 501 400", c501.status, 400);
  const c500 = await api("POST", "/api/orders/" + orderIds[1] + "/review", { token: A.token, body: { rating: 5, content: "a".repeat(500) } });
  eq("5.2 content 500 200", c500.status, 200);
  eq("5.3 content preserved", c500.data && c500.data.content.length, 500);

  // ============================================================
  // Test 6: Tags — B completes order3
  // ============================================================
  await api("POST", "/api/orders/" + orderIds[2] + "/status", { token: B.token, body: { action: "complete" } });

  // illegal tag
  const tBad = await api("POST", "/api/orders/" + orderIds[2] + "/review", { token: A.token, body: { rating: 5, content: "x", tags: ["照顾周到", "非法标签"] } });
  eq("6.1 illegal tag 400", tBad.status, 400);

  // 7 tags (all valid but exceeds max)
  const sevenTags = ["照顾周到", "沟通顺畅", "环境整洁", "按时接送", "有爱心", "经验丰富", "会拍照"];
  const t7 = await api("POST", "/api/orders/" + orderIds[2] + "/review", { token: A.token, body: { rating: 5, content: "x", tags: sevenTags } });
  eq("6.2 7 tags 400", t7.status, 400);

  // duplicate tags deduped
  const tDup = await api("POST", "/api/orders/" + orderIds[2] + "/review", { token: A.token, body: { rating: 4, content: "有爱心", tags: ["照顾周到", "照顾周到", "沟通顺畅"] } });
  eq("6.3 dup tags 200", tDup.status, 200);
  eq("6.4 deduped to 2", tDup.data && tDup.data.tags.length, 2);

  // ============================================================
  // Test 7: Photos — B completes order4
  // ============================================================
  await api("POST", "/api/orders/" + orderIds[3] + "/status", { token: B.token, body: { action: "complete" } });
  const oid4 = orderIds[3];

  // prefix mismatch
  const tBadPhoto = await api("POST", "/api/orders/" + oid4 + "/review", { token: A.token, body: { rating: 5, content: "x", photos: ["other-review-1-aaa.jpg"] } });
  eq("7.1 prefix mismatch 400", tBadPhoto.status, 400);

  // 7 photos
  const sevenPhotos = Array.from({ length: 7 }, (_, i) => oid4 + "-review-" + i + "-aaa.jpg");
  const t7photo = await api("POST", "/api/orders/" + oid4 + "/review", { token: A.token, body: { rating: 5, content: "x", photos: sevenPhotos } });
  eq("7.2 7 photos 400", t7photo.status, 400);

  // non-string photo
  const tNumPhoto = await api("POST", "/api/orders/" + oid4 + "/review", { token: A.token, body: { rating: 5, content: "x", photos: [123] } });
  eq("7.3 non-string photo 400", tNumPhoto.status, 400);

  // ============================================================
  // Test 8: Auth guards
  // ============================================================
  // unrelated user
  const t8a = await api("POST", "/api/orders/" + orderIds[0] + "/review", { token: C.token, body: { rating: 5 } });
  eq("8.1 unrelated 403", t8a.status, 403);

  // not logged
  const t8b = await api("POST", "/api/orders/" + orderIds[0] + "/review", { body: { rating: 5 } });
  eq("8.2 not logged 401", t8b.status, 401);

  // order not exist
  const t8c = await api("POST", "/api/orders/00000000-0000-0000-0000-000000000000/review", { token: A.token, body: { rating: 5 } });
  eq("8.3 order not exist 404", t8c.status, 404);

  // ============================================================
  // Test 11: Image upload + review with photo
  // ============================================================
  const pngBlob = new Blob([PNG_1X1], { type: "image/png" });
  const up1 = await uploadApi("/api/reviews/upload?orderId=" + encodeURIComponent(oid4), pngBlob, { token: A.token });
  eq("11.1 upload 200", up1.status, 200);
  ok("11.2 has key", !!up1.data && !!up1.data.key);
  ok("11.3 key prefix", up1.data && up1.data.key.startsWith(oid4 + "-"), "key=" + (up1.data && up1.data.key));
  eq("11.4 orderId returned", up1.data && up1.data.orderId, oid4);

  // Submit review with the uploaded photo
  const t11 = await api("POST", "/api/orders/" + oid4 + "/review", { token: A.token, body: { rating: 4, content: "带照片评价", photos: [up1.data.key] } });
  eq("11.5 review with photo 200", t11.status, 200);
  eq("11.6 photo key preserved", t11.data && t11.data.photos.length, 1);
  eq("11.7 photo key matches", t11.data && t11.data.photos[0], up1.data.key);

  // ============================================================
  // Test 12: Upload guards
  // ============================================================
  // not logged
  const upNoAuth = await uploadApi("/api/reviews/upload", pngBlob, {});
  eq("12.1 upload 401", upNoAuth.status, 401);

  // not owner/host (C with order1's orderId)
  const upNotOwner = await uploadApi("/api/reviews/upload?orderId=" + encodeURIComponent(orderIds[0]), pngBlob, { token: C.token });
  eq("12.2 not owner 400", upNotOwner.status, 400);

  // non-completed order: create need6, book, accept (don't complete)
  const need6 = await api("POST", "/api/needs", {
    token: A.token,
    body: { petId: petId, startDate: isoDay(35), endDate: isoDay(37), expectedPriceCents: 12000, expectedArea: "海淀区", description: "need6" },
  });
  const book6 = await api("POST", "/api/hosts/" + bProfileId + "/book", { token: B.token, body: { needId: need6.data.id } });
  const order6 = book6.data.id;
  await api("POST", "/api/orders/" + order6 + "/status", { token: A.token, body: { action: "accept" } });
  const upNotComplete = await uploadApi("/api/reviews/upload?orderId=" + encodeURIComponent(order6), pngBlob, { token: A.token });
  eq("12.3 non-completed 400", upNotComplete.status, 400);

  // over 5MB
  const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);
  const bigBlob = new Blob([bigBuffer], { type: "image/png" });
  const upBig = await uploadApi("/api/reviews/upload", bigBlob, { token: A.token });
  eq("12.4 over 5MB 400", upBig.status, 400);

  // non-image type
  const textBlob = new Blob(["hello world"], { type: "text/plain" });
  const upText = await uploadApi("/api/reviews/upload", textBlob, { token: A.token });
  eq("12.5 non-image 400", upText.status, 400);

  // ============================================================
  // Test 13: Frontend static checks
  // ============================================================
  const html = await fetchText("/my.html");
  eq("13.1 my.html 200", html.status, 200);
  has("13.2 has review-modal", html.text, 'id="review-modal"');
  has("13.3 has review-stars", html.text, 'id="review-stars"');
  has("13.4 has review-tags", html.text, 'id="review-tags"');
  has("13.5 has review-textarea", html.text, 'id="review-textarea"');
  has("13.6 has review-submit", html.text, 'id="review-submit"');
  has("13.7 has review-file-input", html.text, 'id="review-file-input"');
  has("13.8 has review-preview", html.text, 'id="review-preview"');
  has("13.9 has char-count", html.text, 'class="char-count"');

  const js = await fetchText("/js/pages/my.js");
  eq("13.10 my.js 200", js.status, 200);
  has("13.11 has REVIEW_TAGS", js.text, "REVIEW_TAGS");
  has("13.12 has openReviewModal", js.text, "openReviewModal");
  has("13.13 has uploadReviewPhoto", js.text, "uploadReviewPhoto");
  has("13.14 has renderReviewPreview", js.text, "renderReviewPreview");
  has("13.15 has renderReviewStars", js.text, "renderReviewStars");
  has("13.16 has renderReviewTags", js.text, "renderReviewTags");
  has("13.17 has resetReviewState", js.text, "resetReviewState");
  has("13.18 has closeReviewModal", js.text, "closeReviewModal");
  // 8 tag whitelist
  const tags = ["照顾周到", "沟通顺畅", "环境整洁", "按时接送", "有爱心", "经验丰富", "会拍照", "有急救知识"];
  hasAll("13.19 8 tag whitelist", js.text, tags);
  has("13.20 has review-done-badge", js.text, "review-done-badge");

  const css = await fetchText("/css/style.css");
  eq("13.21 style.css 200", css.status, 200);
  const newClasses = [
    ".review-modal-head", ".review-modal-title", ".review-stars", ".star",
    ".star.active", ".review-tags", ".tag-chip", ".tag-chip.active",
    ".review-textarea", ".char-count", ".review-upload", ".review-preview",
    ".review-thumb", ".review-done-badge",
  ];
  hasAll("13.22 CSS new classes", css.text, newClasses);

  // ============================================================
  // Test 14: node --check all modified JS
  // ============================================================
  const checkFiles = [
    "functions/api/orders/[id]/review.js",
    "functions/api/reviews/upload.js",
    "functions/api/reviews/[key].js",
    "functions/api/orders/my.js",
    "public/js/pages/my.js",
  ];
  for (const f of checkFiles) {
    const fullPath = path.join(ROOT, f);
    try {
      execSync('node --check "' + fullPath + '"', { stdio: "pipe" });
      ok("14 " + f + " check", true);
    } catch (e) {
      fail++;
      failures.push("FAIL node --check " + f + ": " + e.message);
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
  console.error("script aborted: " + e.message);
  console.error("current PASS " + pass + " / FAIL " + fail);
  if (failures.length) failures.forEach(function (f) { console.log(f); });
  process.exit(1);
});
