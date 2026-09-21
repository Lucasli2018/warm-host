// 本地/远程健康检查：确认 dev server 真的能响应（区分「端口被僵尸进程占住」）
//
// 用法：
//   node tools/health-check.mjs                 # 默认 http://127.0.0.1:8787
//   node tools/health-check.mjs https://warm-host.pages.dev
//
// 背景：wrangler pages dev 被强杀后 workerd 会变孤儿继续监听端口，
// 此时 / 与 /api/* 全部超时（静态页也超时），但日志显示 Ready。

// 本机无 IPv6 出口 + *.pages.dev 有 AAAA 记录 → 不强制 IPv4 会 UND_ERR_CONNECT_TIMEOUT
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

const B = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");

async function hit(path, ms = 8000) {
  const t0 = Date.now();
  try {
    const r = await fetch(B + path, { signal: AbortSignal.timeout(ms) });
    const txt = await r.text();
    return { ok: r.ok, line: `${path} → ${r.status} ${((Date.now() - t0) / 1000).toFixed(1)}s len=${txt.length}` };
  } catch (e) {
    return { ok: false, line: `${path} → ERROR ${e.name} (${((Date.now() - t0) / 1000).toFixed(1)}s)` };
  }
}

const paths = [
  ["/", 200],
  ["/hosts.html", 200],
  ["/api/stats", 200],
  ["/api/auth/me", 401], // 未登录：能返回 401 就说明 API 链路通
];
let bad = 0;
for (const [p, expect] of paths) {
  const r = await hit(p);
  const okStatus = r.line.includes(`→ ${expect} `);
  if (!okStatus) bad++;
  console.log((okStatus ? "✅ " : "❌ ") + r.line + (okStatus ? "" : `（期望 ${expect}）`));
}
console.log(bad ? `\n${bad}/${paths.length} 项异常` : "\n全部正常");
process.exit(0);
