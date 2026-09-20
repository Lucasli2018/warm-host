// POST /api/admin/_debug-set-host-status
// 本地测试用 debug 端点：调整用户 host_status / is_host
//
// ⚠️ 仅本地开发用（wrangler pages dev），不应部署到生产。
// Task 6 会被正式的 admin 审核 API 替换。
// 文件名带下划线前缀，避免与正式路由混淆。
//
// Body: { userId?, hostStatus?, isHost? }
//   - userId 缺省时用当前用户 id（供 admin 调整自己的状态，用于测试）
//   - hostStatus: 'pending' | 'active' | 'rejected' | 'suspended'
//   - isHost: 0 | 1（缺省 1，若 hostStatus='none' 则视为 0）
//
// 特殊值: hostStatus='none' → 重置为 is_host=0, host_status='pending'
//
// 权限: 当前用户 role='admin'
//
// 返回: { success: true, userId, hostStatus, isHost }

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

const VALID_STATUSES = ["pending", "active", "rejected", "suspended"];

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可操作", 403);

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const userId = typeof body.userId === "string" && body.userId.trim()
    ? body.userId.trim()
    : user.id;
  let status = String(body.hostStatus || "").trim();
  let isHost = body.isHost;

  // 特殊值 'none'：重置为未申请状态
  if (status === "none") {
    isHost = 0;
    status = "pending";
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return fail(`hostStatus 必须是 ${VALID_STATUSES.join("/")} 或 'none'`, 400);
  }

  const target = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ?"
  ).bind(userId).first();
  if (!target) return fail("用户不存在", 404);

  // 决定 is_host
  if (isHost === undefined || isHost === null) {
    isHost = status === "none" ? 0 : 1;
  } else {
    isHost = isHost ? 1 : 0;
  }

  const ts = now();
  await env.DB.prepare(
    "UPDATE users SET host_status = ?, is_host = ?, updated_at = ? WHERE id = ?"
  ).bind(status, isHost, ts, userId).run();

  return json({ success: true, userId, hostStatus: status, isHost });
}
