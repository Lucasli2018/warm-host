// warm-host 全量回归 runner：顺序执行所有 probe-task*.js 套件并汇总
// 用法：先启动 wrangler pages dev（端口 8787），再 node tests/probe.js
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const suites = fs.readdirSync(dir)
  .filter(f => /^probe-task[\dab]+\.js$/.test(f))
  .sort((a, b) => {
    const num = (f) => { const m = f.match(/probe-task(\d+)([ab]?)/); return parseInt(m[1], 10) * 10 + (m[2] === "b" ? 1 : 0); };
    return num(a) - num(b);
  });

console.log("suites:", suites.join(", "));
console.log("");

let allPass = true;
const summary = [];
for (const f of suites) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf-8", timeout: 300000 });
  const out = (r.stdout || "") + (r.stderr || "");
  // 兼容三种摘要格式："PASS x / FAIL y"、"总计: ✅ x 通过, ❌ y 失败"、"Passed: x / Failed: y"
  let m = out.match(/PASS (\d+) \/ FAIL (\d+)/) || out.match(/(\d+)\s*通过[,\s]*❌?\s*(\d+)\s*失败/) || out.match(/Passed:\s*(\d+)[\s\S]*?Failed:\s*(\d+)/);
  const passed = m ? parseInt(m[1], 10) : 0;
  const failed = m ? parseInt(m[2], 10) : -1;
  const ok = r.status === 0 && (failed === 0 || failed === -1);
  if (!ok) allPass = false;
  summary.push({ suite: f, passed, failed, exit: r.status, ok });
  console.log((ok ? "[ OK ]" : "[FAIL]") + " " + f + "  pass=" + passed + (failed >= 0 ? " fail=" + failed : " (no summary)"));
  if (!ok) {
    const tail = out.split(/\r?\n/).filter(l => /FAIL|failures:|✗/.test(l)).slice(0, 20);
    tail.forEach(l => console.log("    " + l));
  }
}

console.log("");
console.log("================ TOTAL ================");
const tp = summary.reduce((s, x) => s + x.passed, 0);
const tf = summary.reduce((s, x) => s + Math.max(0, x.failed), 0);
console.log("suites: " + summary.filter(x => x.ok).length + "/" + summary.length + " green");
console.log("assertions: PASS " + tp + " / FAIL " + tf);
process.exit(allPass ? 0 : 1);
