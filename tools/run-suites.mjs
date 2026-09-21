// 诊断用 runner：按 probe.js 的顺序逐套件跑，实时打印耗时与结果（带单套件超时）
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(ROOT, "tests");
const num = (f) => {
  const m = f.match(/probe-task(\d+)([ab]?)/);
  return parseInt(m[1], 10) * 10 + (m[2] === "b" ? 1 : 0);
};
const suites = readdirSync(dir)
  .filter((f) => /^probe-task[\dab]+\.js$/.test(f))
  .sort((a, b) => num(a) - num(b));

const only = process.argv[2];
const list = only ? suites.filter((s) => s.includes(only)) : suites;

for (const f of list) {
  const t0 = Date.now();
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, f)], { encoding: "utf8" });
    let buf = "";
    const kill = setTimeout(() => { p.kill("SIGKILL"); buf += "\n[[TIMEOUT 120s]]"; }, 120000);
    p.stdout.on("data", (d) => (buf += d));
    p.stderr.on("data", (d) => (buf += d));
    p.on("close", (code) => { clearTimeout(kill); resolve({ buf, code }); });
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const m = out.buf.match(/PASS (\d+) \/ FAIL (\d+)/) || out.buf.match(/(\d+)\s*通过[,\s]*❌?\s*(\d+)\s*失败/);
  const summary = m ? `pass=${m[1]} fail=${m[2]}` : "no-summary";
  console.log(`[${secs}s] ${f}  ${summary}  exit=${out.code}`);
  if (!m || m[2] !== "0") {
    const lines = out.buf.split(/\r?\n/).filter((l) => /❌|FAIL|TIMEOUT/.test(l)).slice(0, 12);
    lines.forEach((l) => console.log("      " + l.trim()));
  }
}
console.log("done");
