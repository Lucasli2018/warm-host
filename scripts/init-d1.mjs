// warm-host · D1 远端初始化脚本
//
// 用法：
//   node scripts/init-d1.mjs            # 应用 migrations/*.sql + 播种 admin/邀请码
//   node scripts/init-d1.mjs --create   # D1 库不存在时自动创建
//   node scripts/init-d1.mjs --check    # 只做自检，不写库
//
// 令牌来源（按优先级）：
//   TOKEN_FILE=<path>  →  文件内容
//   CLOUDFLARE_API_TOKEN  →  环境变量（需 Account → D1 → Edit 权限）
//
// 幂等：迁移全部为 CREATE ... IF NOT EXISTS；播种仅在缺失时执行。
//
// 为什么需要它：functions/_middleware.js 的自动建表只在「users 表不存在」时播种 admin，
// 若表已由本脚本建好，middleware 会跳过播种 → 线上没有管理员账号。本脚本补这一步。

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hashPassword, genSalt, generateInviteCode } from "../functions/_shared/crypto.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID || "332b848d9f5d9ec2808bdb855763eb8e";
const CREATE = process.argv.includes("--create");
const CHECK_ONLY = process.argv.includes("--check");
const SEED_INVITE_COUNT = 10;

// ---------- 读 wrangler.toml ----------
const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");
const DB_NAME = (toml.match(/database_name\s*=\s*"([^"]+)"/) || [])[1];
let DB_ID_TOML = (toml.match(/database_id\s*=\s*"([^"]+)"/) || [])[1] || "";
if (!DB_NAME) {
  console.error("wrangler.toml 缺少 database_name");
  process.exit(1);
}
if (/PLACEHOLDER|REPLACE|YOUR_/i.test(DB_ID_TOML)) DB_ID_TOML = "";

// ---------- 令牌 ----------
const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "")
  || process.env.CLOUDFLARE_API_TOKEN
  || "";
if (!token) {
  console.error("缺少 CLOUDFLARE_API_TOKEN 或 TOKEN_FILE");
  process.exit(1);
}

// 本机到 CF 的链路会间歇抖动，统一重试
const api = async (path, opts = {}, retries = 8) => {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}${path}`, {
        ...opts,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
      });
      const j = await r.json();
      if (j.success) return j.result;
      lastErr = new Error(JSON.stringify(j.errors));
      throw lastErr;
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 800 * (i + 1)));
      process.stderr.write(`  retry ${i + 1}/${retries}\n`);
    }
  }
  throw lastErr;
};

// ---------- 定位 D1 数据库 ----------
let dbId = DB_ID_TOML;
if (!dbId || CREATE) {
  const dbs = await api("/d1/database");
  const found = dbs.find(d => d.name === DB_NAME);
  if (found) {
    dbId = found.uuid;
    console.log(`D1 数据库 ${DB_NAME} → ${dbId}`);
  } else if (CREATE) {
    const created = await api("/d1/database", {
      method: "POST",
      body: JSON.stringify({ name: DB_NAME }),
    });
    dbId = created.uuid;
    console.log(`已创建 D1 数据库 ${DB_NAME} → ${dbId}`);
  } else {
    console.error(`未找到 D1 数据库 ${DB_NAME}，请加 --create 自动创建`);
    process.exit(1);
  }
}
if (DB_ID_TOML && dbId !== DB_ID_TOML) {
  console.log(`提示：wrangler.toml 的 database_id=${DB_ID_TOML} 与远端不一致`);
}

const run = async (sql) => {
  const res = await api(`/d1/database/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  // REST 返回 [{ results, success, meta }]
  const first = Array.isArray(res) ? res[0] : res;
  if (first && first.success === false) {
    throw new Error(JSON.stringify(first.error || first.results));
  }
  return (first && first.results) || [];
};

// ---------- SQL 拆分 ----------
function splitStatements(sql) {
  const out = [];
  let buf = [];
  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--")) continue;
    buf.push(line);
    if (line.endsWith(";")) {
      const stmt = buf.join(" ").replace(/;\s*$/, "").trim();
      if (stmt) out.push(stmt);
      buf = [];
    }
  }
  const tail = buf.join(" ").trim();
  if (tail) out.push(tail);
  return out;
}

// ---------- 应用迁移 ----------
const migDir = join(ROOT, "migrations");
const files = readdirSync(migDir).filter(f => f.endsWith(".sql")).sort();

console.log(`\n[migrate] ${files.length} 个迁移文件`);
let ok = 0;
let fail = 0;
if (!CHECK_ONLY) {
  for (const f of files) {
    const stmts = splitStatements(readFileSync(join(migDir, f), "utf8"));
    for (const s of stmts) {
      try {
        await run(s);
        ok++;
      } catch (e) {
        if (/already exists|duplicate/i.test(e.message)) {
          ok++;
        } else {
          fail++;
          console.error(`  FAIL ${f}: ${e.message}\n    SQL: ${s.slice(0, 90)}`);
        }
      }
    }
    console.log(`  ${ok ? "✓" : " "} ${f}（累计 ${ok} 条语句）`);
  }
  console.log(`[migrate] ok=${ok} fail=${fail}`);
  if (fail) process.exit(1);
}

// ---------- 播种 ----------
const nowIso = new Date().toISOString();

if (!CHECK_ONLY) {
  // 1) admin：仅当 phone='admin' 不存在时插入
  const existingAdmin = await run("SELECT id FROM users WHERE phone = 'admin'");
  if (existingAdmin.length === 0) {
    const salt = genSalt(16);
    const hash = await hashPassword("admin123", salt);
    const id = crypto.randomUUID();
    await run(
      `INSERT INTO users (id, phone, password_hash, password_salt, nickname, role, created_at, updated_at)
       VALUES ('${id}', 'admin', '${hash}', '${salt}', '管理员', 'admin', '${nowIso}', '${nowIso}')`
    );
    console.log(`[seed] admin 账号已创建 (admin / admin123)`);
  } else {
    console.log(`[seed] admin 账号已存在，跳过`);
  }

  // 2) 邀请码：仅当没有任何「未被使用」的邀请码时补种
  const avail = await run("SELECT COUNT(*) AS c FROM invite_codes WHERE used_by IS NULL");
  const availCount = (avail[0] && avail[0].c) || 0;
  if (availCount < SEED_INVITE_COUNT) {
    const need = SEED_INVITE_COUNT - availCount;
    const codes = [];
    for (let i = 0; i < need; i++) {
      const code = generateInviteCode();
      codes.push(code);
      await run(
        `INSERT INTO invite_codes (code, owner_id, created_at) VALUES ('${code}', NULL, '${nowIso}')`
      );
    }
    console.log(`[seed] 补种 ${need} 个邀请码`);
    console.log(`       ${codes.join("  ")}`);
  } else {
    console.log(`[seed] 已有 ${availCount} 个可用邀请码，跳过`);
  }
}

// ---------- 自检 ----------
const tables = await run(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
);
const indexes = await run(
  "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
);
const counts = {};
for (const t of ["users", "host_profiles", "pets", "needs", "orders", "reviews", "blacklist", "sponsors", "notifications", "invite_codes", "sessions", "host_availability"]) {
  const r = await run(`SELECT COUNT(*) AS c FROM ${t}`);
  counts[t] = (r[0] && r[0].c) || 0;
}

const EXPECTED_TABLES = [
  "blacklist", "host_availability", "host_profiles", "invite_codes", "needs",
  "notifications", "orders", "pets", "reviews", "sessions", "sponsors", "users",
];
const got = tables.map(r => r.name);
const missing = EXPECTED_TABLES.filter(t => !got.includes(t));

console.log(`\n[check] 表 ${got.length}/${EXPECTED_TABLES.length}｜索引 ${indexes.length}`);
console.log(`[check] 行数 ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);

// admin 密码自检：用库里存的 salt/hash 反算一次
const adminRow = await run("SELECT password_hash, password_salt FROM users WHERE phone = 'admin'");
let pwdOk = false;
if (adminRow.length) {
  const recomputed = await hashPassword("admin123", adminRow[0].password_salt);
  pwdOk = recomputed === adminRow[0].password_hash;
}
console.log(`[check] admin 密码校验：${adminRow.length ? (pwdOk ? "通过" : "失败 ⚠️") : "账号缺失 ⚠️"}`);

if (missing.length) {
  console.error(`[check] 缺失表：${missing.join(", ")}`);
  process.exit(1);
}
if (adminRow.length && !pwdOk) {
  console.error("[check] admin 密码哈希不匹配，请检查 crypto.js 实现");
  process.exit(1);
}

console.log(`\n完成。database_id = ${dbId}`);
console.log(`请确认 wrangler.toml 中 database_id 为上述值。`);
