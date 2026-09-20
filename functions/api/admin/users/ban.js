// POST /api/admin/users/ban
// Ban / Unban 用户
//
// Body: { userId: string, banned: 0|1, reason?: string }
//   banned=1 → 标记禁用 + 删除全部 sessions（强制下线） + 通知 type='banned'
//   banned=0 → 解除禁用
//
// 约束：
//   - 不能 Ban 自己（400）
//   - 不能 Ban 其他 admin（400）
//   - 目标用户不存在 → 404
//   - 幂等：ban 已 banned 用户返回 success 但 changed=false
//
// 返回：{ success: true, userId, banned, changed }

import { json, fail, now, requireUser, readJson } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可操作", 403);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);

  const targetId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!targetId) return fail("缺少 userId", 400);
  const bannedNum = Number(body.banned);
  if (!Number.isInteger(bannedNum) || (bannedNum !== 0 && bannedNum !== 1)) {
    return fail("banned 必须是 0 或 1", 400);
  }
  const banned = bannedNum;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "";

  // 目标用户存在性 + 保护检查
  const target = await env.DB.prepare(
    "SELECT id, role, banned FROM users WHERE id = ?"
  ).bind(targetId).first();
  if (!target) return fail("用户不存在", 404);

  if (target.role === "admin") {
    return fail("不能禁用 admin 账号", 400);
  }
  if (targetId === user.id) {
    return fail("不能禁用自己", 400);
  }

  const changed = target.banned !== banned;
  const ts = now();

  await env.DB.prepare(
    "UPDATE users SET banned = ?, updated_at = ? WHERE id = ?"
  ).bind(banned, ts, targetId).run();

  // Ban 时强制下线：删除该用户全部 sessions
  if (banned === 1) {
    await env.DB.prepare(
      "DELETE FROM sessions WHERE user_id = ?"
    ).bind(targetId).run();

    // 通知（用户被 Ban 后无法登录，通知仅存档；未来若解封可查看）
    const bodyText = reason ? `您已被平台禁用。原因：${reason}` : "您已被平台禁用。如有疑问请联系客服。";
    await createNotification(env, {
      userId: targetId,
      type: "banned",
      title: "账号已被禁用",
      body: bodyText,
      link: "/auth.html",
    });
  }

  return json({ success: true, userId: targetId, banned, changed });
}
