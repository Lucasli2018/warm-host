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

// ============ Session 解析（供 handler 直接调用） ============
// 从 request 提取 Bearer token → 查 sessions 表 → 返回用户信息
// 返回 null 表示未登录或会话过期
export async function requireUser(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;

  const token = auth.slice(7);
  const session = await env.DB.prepare(
    `SELECT s.token, s.user_id, s.expires_at, u.*
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token = ?`
  ).bind(token).first();

  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;

  // 返回用户信息（不暴露密码等敏感字段）
  return {
    id: session.id,
    phone: session.phone,
    nickname: session.nickname,
    role: session.role,
    isOwner: !!session.is_owner,
    isHost: !!session.is_host,
    hostStatus: session.host_status,
    idCardVerified: !!session.id_card_verified,
    city: session.city || "同城",
    bio: session.bio || "",
    avatarKey: session.avatar_key || null,
    invitedBy: session.invited_by || null,
    createdAt: session.created_at,
  };
}
