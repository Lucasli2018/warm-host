// 修正 Cloudflare Pages 项目的 production_branch（默认要求为 master）
//
// 背景：若 Pages 项目的 production_branch 不是 master，`wrangler pages deploy`
// 在 master 分支上的部署会落进 **preview 环境**：deployment URL 与 <branch>.项目.pages.dev
// 都正常，但生产域名返回 CF 404 页面（约 16KB HTML），极易误判成"部署成功但页面挂了"。
// （event-signin 项目踩过一次，warm-host 又踩一次）
//
// 用法：
//   CLOUDFLARE_API_TOKEN=xxx node tools/fix-pages-branch.mjs            # 查看
//   CLOUDFLARE_API_TOKEN=xxx node tools/fix-pages-branch.mjs --fix      # 改为 master
//   PROJECT=other node tools/fix-pages-branch.mjs --fix
//
// 改完需要重新部署一次，生产环境才会拿到最新产物与 binding。

import { readFileSync } from "node:fs";

const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID || "332b848d9f5d9ec2808bdb855763eb8e";
const PROJECT = process.env.PROJECT || "warm-host";
const BRANCH = process.env.BRANCH || "master";
const FIX = process.argv.includes("--fix");

const token = (process.env.TOKEN_FILE ? readFileSync(process.env.TOKEN_FILE, "utf8").trim() : "")
  || process.env.CLOUDFLARE_API_TOKEN
  || "";
if (!token) { console.error("缺少 CLOUDFLARE_API_TOKEN 或 TOKEN_FILE"); process.exit(1); }

const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/pages/projects/${PROJECT}`;

const get = await (await fetch(base, { headers: H })).json();
if (!get.success) { console.error("查询失败：", JSON.stringify(get.errors)); process.exit(1); }
const p = get.result;

console.log(`project           : ${p.name}`);
console.log(`production_branch : ${p.production_branch}`);
console.log(`domains           : ${(p.domains || []).join(", ")}`);
console.log(`d1 (production)   : ${JSON.stringify(p.deployment_configs?.production?.d1_databases || null)}`);
console.log(`r2 (production)   : ${JSON.stringify(p.deployment_configs?.production?.r2_buckets || null)}`);
console.log(`latest deploy     : ${p.latest_deployment ? `${p.latest_deployment.environment} ${p.latest_deployment.url}` : "none"}`);

if (!FIX) {
  if (p.production_branch !== BRANCH) console.log(`\n⚠️  生产分支应为 ${BRANCH}，加 --fix 修正`);
  process.exit(0);
}
if (p.production_branch === BRANCH) { console.log("\n生产分支已正确，无需修改"); process.exit(0); }

const patch = await (await fetch(base, { method: "PATCH", headers: H, body: JSON.stringify({ production_branch: BRANCH }) })).json();
if (!patch.success) { console.error("修改失败：", JSON.stringify(patch.errors)); process.exit(1); }
console.log(`\n✅ production_branch → ${patch.result.production_branch}，请重新执行 wrangler pages deploy`);
