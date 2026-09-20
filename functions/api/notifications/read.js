// POST /api/notifications/read — 标记已读
// Task 14
//
// Body:
//   { id: "..." }     → 标记单条（必须属于本人）
//   { all: true }     → 标记本人全部未读
//
// 返回：{ read: <本次实际新标记数>, unreadCount: <剩余未读数> }
//
// 幂等：重复标记已读的通知也返回 200（read=0）
// 错误：
//   400 缺参 / body 格式错误
//   401 未登录
//   404 通知不存在或不属于本人

import { json, fail, readJson, requireUser } from "../../_shared/helpers.js";

function changesOf(result) {
  if (!result) return 0;
  if (typeof result.changes === "number") return result.changes;
  if (result.meta && typeof result.meta.changes === "number") return result.meta.changes;
  return 0;
}

async function countUnread(env, userId) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0"
  ).bind(userId).first();
  return row ? Number(row.c || 0) : 0;
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);

  const all = body.all === true || body.all === 1 || body.all === "true";
  const id = typeof body.id === "string" ? body.id.trim() : "";

  // 互斥：必须提供 all:true 或 id
  if (!all && !id) return fail("必须提供 id 或 all:true", 400);

  let marked = 0;

  if (all) {
    // 全部标记已读（仅未读的会被 update）
    const r = await env.DB.prepare(
      "UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0"
    ).bind(user.id).run();
    marked = changesOf(r);
  } else {
    // 单条：先校验归属
    const own = await env.DB.prepare(
      "SELECT id FROM notifications WHERE id = ? AND user_id = ?"
    ).bind(id, user.id).first();
    if (!own) return fail("通知不存在", 404);

    const r = await env.DB.prepare(
      "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ? AND read = 0"
    ).bind(id, user.id).run();
    marked = changesOf(r);
  }

  const unreadCount = await countUnread(env, user.id);
  return json({ read: marked, unreadCount: unreadCount });
}
