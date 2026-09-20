// 共享工具：JSON 响应、参数解析、时间工具
// 从 shop-booking 复制并裁剪（移除店铺相关），新增 parseBody/now 别名

// ============ JSON helpers ============
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function fail(message, status = 400) {
  return json({ error: message }, status);
}

// 解析 JSON 请求体（失败返回 null）
export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 别名：parseBody（计划文档中使用的命名）
export const parseBody = readJson;

// ============ 时间工具 ============
// 返回 ISO 时间戳字符串（D1 存储用）
export function now() {
  return new Date().toISOString();
}

// 返回本地时间字符串 'YYYY-MM-DD HH:MM'（Asia/Shanghai）
export function nowLocalString(tz = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// ============ 参数解析 ============
export function getString(params, key, fallback = "") {
  return typeof params[key] === "string" ? params[key] : fallback;
}

export function getInt(params, key, fallback = 0) {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : fallback;
}
