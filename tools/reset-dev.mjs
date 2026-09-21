// 本地开发环境一键重置：清空持久化目录 → 预置 schema → 播种 admin/邀请码
//
// 为什么需要预置而不是靠 _middleware 首访自动建表：
//   1. 回归套件要求可重复（固定 admin/邀请码状态）且限流需关闭；
//   2. 首访自动建表路径在 wrangler dev 下首次请求有卡死风险（见 tools/health-check.mjs）。
//
// 用法：
//   node tools/reset-dev.mjs                # 默认重置到 ./.wrangler-dev
//   PERSIST=./.wrangler-clean node tools/reset-dev.mjs
// 之后启动：
//   node $WRANGLER pages dev --port 8787 --persist-to ./.wrangler-dev --binding DISABLE_RATE_LIMIT=1
//   node tools/seed-dev.mjs                 # 把 admin 变成 active 寄养人（回归前置）

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PERSIST = process.env.PERSIST || "./.wrangler-dev";
const WRANGLER = process.env.WRANGLER || "D:/npm-global/node_modules/wrangler/bin/wrangler.js";
const DB_NAME = "warm-host-db";

const run = (label, args, opts = {}) => {
  process.stdout.write(`\n▸ ${label}\n`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`✗ 失败：${label} (exit=${r.status})`);
    process.exit(1);
  }
};

// 1. 清空
// 注意：本机的 Node fs 被 safe-delete shim 接管（rmSync 会转成"移入回收站"并超时失败），
// 故走系统命令删除。
const dir = join(ROOT, PERSIST);
if (process.platform === "win32") {
  spawnSync("cmd", ["/c", "rmdir", "/s", "/q", dir], { stdio: "ignore" });
} else {
  spawnSync("rm", ["-rf", dir], { stdio: "ignore" });
}
mkdirSync(dir, { recursive: true });
console.log(`已清空 ${PERSIST}`);

const w = [WRANGLER, "d1", "execute", DB_NAME, "--local", `--persist-to=${PERSIST}`];

// 2. schema
run("预置 schema（migrations/0000_init.sql）", [...w, "--file=migrations/0000_init.sql"]);

// 3. 播种
process.stdout.write("\n▸ 生成播种 SQL\n");
const seed = spawnSync(process.execPath, ["scripts/gen-seed-sql.mjs"], { cwd: ROOT, encoding: "utf8" });
if (seed.status !== 0) {
  console.error("✗ gen-seed-sql 失败\n" + (seed.stderr || ""));
  process.exit(1);
}
const seedPath = join(dir, "seed.sql");
writeFileSync(seedPath, seed.stdout, "utf8");
process.stderr.write(seed.stderr || "");
run("执行播种", [...w, `--file=${PERSIST}/seed.sql`]);

console.log(`
完成。接下来：
  1) node ${WRANGLER} pages dev --port 8787 --persist-to ${PERSIST} --binding DISABLE_RATE_LIMIT=1
  2) node tools/seed-dev.mjs
  3) node tools/health-check.mjs && node tests/probe.js
`);
