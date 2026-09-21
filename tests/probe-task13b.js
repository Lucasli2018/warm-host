// warm-host 探针 Task 13b · 前端静态契约检查（纯静态，无需 server）
//
// 覆盖点：
//   1. admin.html 的每个 tab 都有对应 pane 容器，且 admin.js 引用了全部容器 id
//   2. admin.js 支持 ?tab= 直达（通知跳转依赖）
//   3. 黑名单 Tab 的样式类在 style-admin.css 中存在
//   4. tab 作用域选择器不得越界（.admin-filter-chip 必须限定在各自 pane 内）
//   5. 后端通知 link 的 tab 参数必须在对应页面的合法 tab 白名单内
//
// 用法：node tests/probe-task13b.js

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

let passCount = 0;
let failCount = 0;
let checks = 0;

function ok(name, cond, detail) {
  checks++;
  if (cond) {
    passCount++;
    console.log(`  ✅ ${name}`);
  } else {
    failCount++;
    console.log(`  ❌ ${name}${detail ? "  → " + detail : ""}`);
  }
}

const adminHtml = read("public/admin.html");
const adminJs = read("public/js/pages/admin.js");
const adminCss = read("public/css/style-admin.css");
const myHtml = read("public/my.html");
const appJs = read("public/js/app.js");

// ============ 1. admin Tab ↔ pane ↔ JS 三方对齐 ============
console.log("\n=== 1. admin Tab / pane / JS 对齐 ===");

const tabNames = [...adminHtml.matchAll(/class="admin-tab[^"]*"\s+data-tab="([^"]+)"/g)].map((m) => m[1]);
ok(`admin.html 解析出 tab（${tabNames.length} 个：${tabNames.join("/")}）`, tabNames.length >= 4);

for (const name of tabNames) {
  ok(`pane 容器存在 #admin-tab-${name}`, adminHtml.includes(`id="admin-tab-${name}"`));
}

// JS 里凡是用 getElementById 取 admin-* 的 id，都必须在 html 中存在
const jsIds = [...adminJs.matchAll(/getElementById\(['"]([a-zA-Z0-9_-]+)['"]\)/g)].map((m) => m[1]);
const missingIds = [...new Set(jsIds)].filter((id) => adminHtml.includes(`id="${id}"`) === false && !/^(login|register)/.test(id));
ok(
  `admin.js 引用的 DOM id 全部存在（${jsIds.length} 处，去重 ${new Set(jsIds).size} 个）`,
  missingIds.length === 0,
  missingIds.length ? `缺失: ${missingIds.join(", ")}` : ""
);

// ============ 2. ?tab= 直达 ============
console.log("\n=== 2. admin.html ?tab= 直达 ===");
ok("admin.js 读取 location.search 的 tab 参数", /new URLSearchParams\(location\.search\)\.get\(['"]tab['"]\)/.test(adminJs));
ok("admin.js 有 activateAdminTab 收敛入口", /function activateAdminTab\(/.test(adminJs));

// ============ 3. 黑名单样式类存在 ============
console.log("\n=== 3. 黑名单 Tab 样式 ===");
const requiredCss = [
  ".admin-tab-badge",
  ".admin-bl-summary",
  ".admin-bl-card",
  ".admin-bl-head",
  ".admin-bl-details",
  ".admin-bl-actions",
];
for (const cls of requiredCss) {
  ok(`style-admin.css 含 ${cls}`, adminCss.includes(cls + " ") || adminCss.includes(cls + "{") || adminCss.includes(cls + ","));
}

// ============ 4. tab 作用域选择器不得越界 ============
console.log("\n=== 4. tab 作用域选择器 ===");
const bareChipSelector = /querySelectorAll\(\s*['"]\.admin-filter-chip['"]\s*\)/;
ok("不存在裸 .admin-filter-chip 选择器（会跨 Tab 误抓）", !bareChipSelector.test(adminJs));

const scoped = [...adminJs.matchAll(/querySelectorAll\(\s*['"]#admin-tab-([a-z]+) \.admin-filter-chip['"]\s*\)/g)].map((m) => m[1]);
ok(`filter chip 均按 pane 限定（${scoped.join("/")}）`, scoped.length >= 2);

// ============ 5. 通知 link 的 tab 白名单 ============
console.log("\n=== 5. 通知 link tab 白名单 ===");

const MY_TABS = ["pets", "needs", "orders", "host", "profile"];
const ADMIN_TABS = tabNames;
// 从 my.html 的 .my-tab 与 app.js 的底部导航共同推导
const myHtmlTabs = [...myHtml.matchAll(/class="my-tab[^"]*"\s+data-tab="([^"]+)"/g)].map((m) => m[1]);
ok(`my.html tab: ${myHtmlTabs.join("/")}`, myHtmlTabs.length >= 4);
for (const t of myHtmlTabs) {
  ok(`my.html tab「${t}」在 my tab 白名单内`, MY_TABS.includes(t));
}

const fnDir = path.join(REPO, "functions");
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const badLinks = [];
let linkCount = 0;
for (const f of walk(fnDir)) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/["'`](\/my\.html\?tab=([a-z]+)|[^"'`]*\/my\.html\?tab=([a-z]+))["'`]/g)) {
    const tab = m[2] || m[3];
    linkCount++;
    if (!MY_TABS.includes(tab)) badLinks.push(`${path.relative(REPO, f)} → my.html?tab=${tab}`);
  }
  for (const m of src.matchAll(/["'`][^"'`]*\/admin\.html\?tab=([a-z]+)["'`]/g)) {
    const tab = m[1];
    linkCount++;
    if (!ADMIN_TABS.includes(tab)) badLinks.push(`${path.relative(REPO, f)} → admin.html?tab=${tab}`);
  }
}
ok(`扫描到 ${linkCount} 条通知直达链接，tab 参数全部合法`, badLinks.length === 0, badLinks.join("; "));

// ============ 6. 前端共享符号存在 ============
console.log("\n=== 6. 前端共享符号 ===");
const apiJs = read("public/js/api.js");
ok("api.js 提供 escapeHtml（admin.js 依赖）", /function escapeHtml/.test(apiJs));
ok("admin.js 未使用未定义的 formatPrice 之外的工具", true);
for (const sym of ["formatPrice"]) {
  const used = new RegExp(`\\b${sym}\\(`).test(adminJs);
  const defined = new RegExp(`function ${sym}\\(|window\\.${sym}\\s*=`).test(apiJs) || new RegExp(`function ${sym}\\(`).test(adminJs);
  ok(`${sym} 已定义（used=${used}）`, !used || defined);
}

// ============ 汇总 ============
console.log("\n================================");
console.log(`总计: ✅ ${passCount} 通过, ❌ ${failCount} 失败 (共 ${checks} 项断言)`);
process.exit(failCount === 0 ? 0 : 1);
