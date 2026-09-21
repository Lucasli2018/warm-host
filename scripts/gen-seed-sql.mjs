// 生成播种 SQL（admin 账号 + N 个邀请码）到 stdout，供 d1 execute --file 使用
//
// 用法：
//   node scripts/gen-seed-sql.mjs > seed.sql
//   node D:/npm-global/node_modules/wrangler/bin/wrangler.js d1 execute warm-host-db \
//        --local --persist-to ./.wrangler-dev --file=seed.sql
//
// 幂等：INSERT OR IGNORE + 固定唯一键（users.phone 唯一、invite_codes.code 主键）。
// 远端初始化请用 scripts/init-d1.mjs（走 REST，自带自检）。

import { hashPassword, genSalt, generateInviteCode } from "../functions/_shared/crypto.js";

const COUNT = parseInt(process.argv[2] || "10", 10);
const ts = new Date().toISOString();

const salt = genSalt(16);
const hash = await hashPassword("admin123", salt);
const adminId = crypto.randomUUID();

const lines = [
  `INSERT OR IGNORE INTO users (id, phone, password_hash, password_salt, nickname, role, created_at, updated_at)
   VALUES ('${adminId}', 'admin', '${hash}', '${salt}', '管理员', 'admin', '${ts}', '${ts}');`,
];

const codes = [];
for (let i = 0; i < COUNT; i++) {
  const code = generateInviteCode();
  codes.push(code);
  lines.push(`INSERT OR IGNORE INTO invite_codes (code, owner_id, created_at) VALUES ('${code}', NULL, '${ts}');`);
}

process.stdout.write(lines.join("\n") + "\n");
process.stderr.write(`-- admin / admin123，${COUNT} 个邀请码：${codes.join(" ")}\n`);
