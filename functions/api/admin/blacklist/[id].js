// POST /api/admin/blacklist/[id] — 管理员处理举报
// 需 admin（user.role === 'admin'）
//
// Body: { action: 'confirm' | 'dismiss', banUser?: boolean }
//   confirm + banUser=true → status='confirmed' + users.banned=1 + DELETE sessions
//   confirm + banUser=false → status='confirmed'
//   dismiss → status='dismissed'
//
// 校验：
//   404 → 记录不存在
//   400 → status 已处理（非 pending）或 action 非法
//   401 → 未登录
//   403 → 非 admin
//
// 通知：目标用户收到处理结果（confirmed → type='blacklist_confirmed'；dismissed → type='blacklist_dismissed'）

import { json, fail, readJson, now, requireUser } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

const VALID_ACTIONS = ["confirm", "dismiss"];

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可操作", 403);

  const id = (params && params.id) || "";
  if (!id) return fail("缺少 id", 400);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);

  const action = String(body.action || "").trim().toLowerCase();
  const banUser = !!body.banUser;

  if (!VALID_ACTIONS.includes(action)) {
    return fail(`action 必须是 ${VALID_ACTIONS.join("/")}`, 400);
  }

  // 记录存在性
  const record = await env.DB.prepare(
    "SELECT id, status, reporter_id, target_user_id, target_type, category FROM blacklist WHERE id = ?"
  ).bind(id).first();
  if (!record) return fail("记录不存在", 404);

  // 状态校验（终态不可重处理）
  if (record.status !== "pending") {
    return fail("已处理", 400);
  }

  const ts = now();
  const newStatus = action === "confirm" ? "confirmed" : "dismissed";

  // 更新 blacklist 记录
  await env.DB.prepare(
    "UPDATE blacklist SET status = ?, handled_at = ?, handled_by = ? WHERE id = ?"
  ).bind(newStatus, ts, user.id, id).run();

  // confirm + banUser=true → 禁用目标用户
  let actuallyBanned = false;
  if (action === "confirm" && banUser) {
    await env.DB.prepare(
      "UPDATE users SET banned = 1, updated_at = ? WHERE id = ?"
    ).bind(ts, record.target_user_id).run();
    // 强制下线：删除该用户全部 sessions（与 admin/users/ban.js 保持一致）
    await env.DB.prepare(
      "DELETE FROM sessions WHERE user_id = ?"
    ).bind(record.target_user_id).run();
    actuallyBanned = true;
  }

  // 通知目标用户
  const isConfirm = action === "confirm";
  const notifType = isConfirm ? "blacklist_confirmed" : "blacklist_dismissed";
  const title = isConfirm ? "举报已确认" : "举报已驳回";
  let bodyText;
  if (isConfirm) {
    bodyText = actuallyBanned
      ? `您的账号已被平台禁用。原因：${record.category}`
      : `该举报已被平台确认（类别：${record.category}）。请遵守平台规则。`;
  } else {
    bodyText = `该举报已被平台驳回（类别：${record.category}）。`;
  }

  await createNotification(env, {
    userId: record.target_user_id,
    type: notifType,
    title,
    body: bodyText,
    link: "/my.html?tab=host",
  });

  // 通知举报人
  await createNotification(env, {
    userId: record.reporter_id,
    type: notifType,
    title,
    body: `您提交的举报（类别：${record.category}）已处理：${isConfirm ? "已确认" : "已驳回"}`,
    link: "/my.html?tab=host",
  });

  return json({
    id,
    status: newStatus,
    banUser: actuallyBanned,
    handledBy: user.id,
  });
}
