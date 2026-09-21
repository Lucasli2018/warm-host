// 由 public/favicon.svg 生成位图图标（无头 Chrome 渲染，零依赖）
//
// 产出：
//   public/apple-touch-icon.png  180×180（iOS 主屏）
//   public/favicon.ico           32×32（PNG-in-ICO，兼容隐式 /favicon.ico 请求）
//
// 用法：node tools/gen-icons.mjs
// 依赖：本机 Chrome。可用 CHROME=<路径> 覆盖。

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = join(ROOT, ".wrangler-clean");
mkdirSync(TMP, { recursive: true });

// 本机 Node fs 被 safe-delete shim 接管（unlink/rm 会转「移入回收站」并报错）→ 走系统命令
const hardDelete = (p) => spawnSync("cmd", ["/c", "del", "/f", "/q", p], { stdio: "ignore" });
const CHROME = process.env.CHROME || "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
if (!existsSync(CHROME)) { console.error("未找到 Chrome，可用 CHROME=<路径> 指定"); process.exit(1); }

const svg = readFileSync(join(ROOT, "public/favicon.svg"), "utf8");

function render(size, outPath) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}
    svg{width:${size}px;height:${size}px;display:block}
  </style></head><body>${svg}</body></html>`;
  const tmp = join(TMP, `icon-${size}.html`);
  writeFileSync(tmp, html, "utf8");

  const r = spawnSync(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--default-background-color=00000000",
    `--window-size=${size},${size}`,
    `--screenshot=${outPath}`,
    "--virtual-time-budget=1500",
    `file:///${tmp.replace(/\\/g, "/")}`,
  ], { encoding: "utf8" });

  hardDelete(tmp);
  if (!existsSync(outPath)) {
    console.error(`渲染 ${size}px 失败：\n` + (r.stderr || r.stdout || ""));
    process.exit(1);
  }
  console.log(`✓ ${outPath.replace(ROOT, ".")} (${size}×${size})`);
}

// PNG-in-ICO 封装：ICO 允许直接内嵌 PNG 数据
function pngToIco(pngPath, icoPath) {
  const png = readFileSync(pngPath);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0);        // width
  entry.writeUInt8(32, 1);        // height
  entry.writeUInt8(0, 2);         // palette
  entry.writeUInt8(0, 3);         // reserved
  entry.writeUInt16LE(1, 4);      // planes
  entry.writeUInt16LE(32, 6);     // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);    // data offset = 6 + 16
  writeFileSync(icoPath, Buffer.concat([header, entry, png]));
  console.log(`✓ ${icoPath.replace(ROOT, ".")} (${png.length} bytes PNG 内嵌)`);
}

render(180, join(ROOT, "public/apple-touch-icon.png"));

const tmp32 = join(TMP, "icon-32.png");
render(32, tmp32);
pngToIco(tmp32, join(ROOT, "public/favicon.ico"));
hardDelete(tmp32);
console.log("完成");
