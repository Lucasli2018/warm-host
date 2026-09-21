// Task 16 test: style.css UTF-8 cleanup + sponsorPhone/targetPhone lookup + frontend static checks + regressions
// Node 18+ native fetch

const fs = require("fs");
const path = require("path");

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

async function api(method, p, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data };
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
    codesCache = codesCache.concat(r.data.codes || r.data.generated || []);
    if (codesCache.length === 0) throw new Error("no codes");
  }
}

async function register(nickname) {
  const code = codesCache.pop();
  const phone = "137" + String(70000000 + Math.floor(Math.random() * 9999999)).slice(0, 8);
  const r = await api("POST", "/api/auth/register", { body: { phone, password: "pass123456", nickname, inviteCode: code } });
  if (r.status !== 200) throw new Error("register fail " + nickname + ": " + JSON.stringify(r.data));
  return { token: r.data.token, id: r.data.user.id, nickname, phone };
}

async function setupActiveHost(user, nickname) {
  // apply + admin verify + sponsor via third active host is complex; use admin override chain like probe-task10a
  const apply = await api("POST", "/api/hosts/apply", {
    token: user.token,
    body: {
      bio: nickname + "的档案", capacity_count: 2,
      capacity_species: ["狗"], capacity_size: ["小型"], capacity_gender: ["母"],
      address_fuzzy: "朝阳区", district: "朝阳区", experience: "3 年",
      special_services: ["可上门接送"], daily_rate_cents: 10000,
    },
  });
  if (apply.status !== 200) throw new Error("apply fail: " + JSON.stringify(apply.data));
  const verify = await api("POST", "/api/admin/hosts/" + user.id, { token: adminToken, body: { action: "verify" } });
  if (verify.status !== 200) throw new Error("verify fail: " + JSON.stringify(verify.data));
  const my = await api("GET", "/api/hosts/me", { token: user.token });
  const profileId = (my.data.profile || {}).id;
  if (!profileId) throw new Error("no profileId");
  return profileId;
}

// 让 H 成为可担保人（完成 3 单 + 5 星），由 owner 下单闭环
async function makeQualifiedSponsor(H, owner, petId) {
  const avail = await api("PUT", "/api/hosts/me/availability", {
    token: H.token,
    body: [{ start_date: isoDay(1), end_date: isoDay(200), note: "长期" }],
  });
  if (avail.status !== 200) throw new Error("avail fail");
  // H 需要先被担保才能接单：用 admin override（临时端点，担保人用一个已 active 的 host）
  const adminHost = await api("GET", "/api/hosts/me", { token: adminToken });
  const adminProfile = (adminHost.data.profile || {});
  // admin 本身可能不是 active host；走 admin override 用 C 作为 sponsor——C 也需 active
  // 简化：用 admin override 端点直接强制担保（该端点要求 sponsor 是 active host）
  // 先让 H 被担保：sponsorUserId 必须 host_status=active —— 用 setupActiveHost 建一个 sponsorC
  return true;
}

async function main() {
  // ===== A. style.css UTF-8 cleanup =====
  const cssPath = path.join(__dirname, "..", "public", "css", "style.css");
  const buf = fs.readFileSync(cssPath);
  ok("A.1 style.css has no BOM", !(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF));
  let decoded = null, decodeErr = null;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { decodeErr = e.message; }
  ok("A.2 style.css is valid UTF-8", !!decoded, decodeErr || "");
  if (decoded) {
    ok("A.3 no U+FFFD replacement chars", !decoded.includes(String.fromCharCode(0xFFFD)));
    ok("A.4 contains primary color", decoded.includes("#8B5E3C"));
    ok("A.5 contains new sponsor/blacklist classes", decoded.includes(".sponsor-card") && decoded.includes(".report-modal"));
  }
  // backup exists and rules preserved: compare rule-text (strip comments) old vs new
  const bakPath = path.join(__dirname, "..", "public", "css", "style.css.bak");
  if (fs.existsSync(bakPath)) {
    const bakBuf = fs.readFileSync(bakPath);
    // old file had GBK bytes; strip comments byte-wise then compare via latin1-safe decode
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
    let oldText;
    try { oldText = new TextDecoder("utf-8", { fatal: false }).decode(bakBuf); } catch (e) { oldText = ""; }
    const rulesMatch = stripComments(decoded).startsWith(stripComments(oldText));
    ok("A.6 CSS rules preserved as prefix after cleanup", rulesMatch);
  }

  // ===== B. sponsorPhone / targetPhone lookup =====
  const adm = await api("POST", "/api/auth/login", { body: { phone: "admin", password: "admin123" } });
  ok("B.1 admin login", adm.status === 200, JSON.stringify(adm.data).slice(0, 120));
  adminToken = adm.data.token; adminId = adm.data.user.id;
  await ensureCodes(6);

  const O = await register("主人O16");
  const S = await register("担保人S16");   // qualified sponsor
  const N = await register("新寄养N16");   // new host to be sponsored
  const T = await register("被举报T16");   // blacklist target

  const sProfileId = await setupActiveHost(S, "S");
  const nProfileId = await setupActiveHost(N, "N");

  // S becomes qualified: admin override sponsor for S (needs an active sponsor user).
  // admin.host_status is pending → cannot sponsor. Use N? N not qualified either.
  // Workaround: grant S orders via admin override sponsor by O? O is not a host.
  // Instead: use admin override endpoint with an existing active host... none exists yet.
  // So: temporarily allow S to book by admin override? It requires active host as sponsor.
  // Fallback: skip qualification for phone-lookup tests — only test lookup resolution paths
  // that fail AFTER user resolution (e.g. not-qualified 400 proves phone lookup worked).

  // B.2 invite by phone: N invites S by phone → should pass lookup then fail qualification (0 orders)
  const invPhone = await api("POST", "/api/sponsors/invite", { token: N.token, body: { sponsorPhone: S.phone } });
  eq("B.2 invite by phone resolves user (fails at qualification)", invPhone.status, 400);
  ok("B.3 error is qualification not lookup", /3\s*单|完成/.test(invPhone.data && invPhone.data.error || ""), JSON.stringify(invPhone.data));

  const invBadPhone = await api("POST", "/api/sponsors/invite", { token: N.token, body: { sponsorPhone: "12345678901" } });
  eq("B.4 invalid phone format 400", invBadPhone.status, 400);

  const invNoUser = await api("POST", "/api/sponsors/invite", { token: N.token, body: { sponsorPhone: "19999999999" } });
  eq("B.5 unregistered phone 404", invNoUser.status, 404);

  // B.6 blacklist by phone: O reports T by phone
  const repPhone = await api("POST", "/api/blacklist", { token: O.token, body: { targetPhone: T.phone, targetType: "owner", category: "其他", details: "task16 测试举报" } });
  eq("B.6 report by phone 200", repPhone.status, 200);

  const repNick = await api("POST", "/api/blacklist", { token: S.token, body: { targetNickname: T.nickname, targetType: "owner", category: "虚假资料", details: "按昵称举报测试" } });
  eq("B.7 report by nickname 200", repNick.status, 200);

  const repBadPhone = await api("POST", "/api/blacklist", { token: O.token, body: { targetPhone: "12345678901", targetType: "owner", category: "其他", details: "x" } });
  eq("B.8 bad phone 400", repBadPhone.status, 400);

  const repNoUser = await api("POST", "/api/blacklist", { token: O.token, body: { targetPhone: "13800000009", targetType: "owner", category: "其他", details: "x" } });
  eq("B.9 unregistered phone 404", repNoUser.status, 404);

  // ===== C. frontend static checks =====
  const myHtml = fs.readFileSync(path.join(__dirname, "..", "public", "my.html"), "utf-8");
  ok("C.1 my.html has sponsor card", /sponsor/i.test(myHtml) || myHtml.includes("担保"));
  ok("C.2 my.html has blacklist/report section", myHtml.includes("举报") || /blacklist|report/i.test(myHtml));
  const myJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "pages", "my.js"), "utf-8");
  ok("C.3 my.js calls sponsors/my", myJs.includes("/sponsors/my") || myJs.includes("sponsors/my"));
  ok("C.4 my.js calls blacklist/my", myJs.includes("blacklist/my"));
  ok("C.5 my.js has report modal logic", /reportModal|report-modal|openReport/i.test(myJs) || myJs.includes("举报"));
  const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "app.js"), "utf-8");
  ok("C.6 app.js desktop logic", appJs.includes("768"));
  const detailJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "pages", "host-detail.js"), "utf-8");
  ok("C.7 host-detail loads reviews", detailJs.includes("/reviews"));
  const css = decoded || "";
  const needClasses = [".sponsor-card", ".report-modal", ".reason-chip", ".badge-bl-pending", ".badge-bl-confirmed", ".badge-bl-dismissed"];
  for (const c of needClasses) ok("C.8 style has " + c, css.includes(c));

  // ===== D. page availability =====
  for (const p of ["/index.html", "/hosts.html", "/my.html", "/host-detail.html", "/admin.html", "/auth.html"]) {
    const r = await fetch(BASE + p);
    eq("D page " + p + " 200", r.status, 200);
  }

  console.log("");
  console.log("================ RESULT ================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (failures.length) { console.log("failures:"); failures.forEach(f => console.log(f)); }
  console.log("========================================");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error("script aborted: " + e.message);
  console.error("current PASS " + pass + " / FAIL " + fail);
  failures.forEach(f => console.log(f));
  process.exit(1);
});
