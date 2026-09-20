// POST /api/admin/hosts/[id]
// 寄养人审核操作（单一路由 + action 分派，避免多端点）
//
// Body: { action: 'verify' | 'reject' | 'suspend' | 'activate' }
//   verify   → host_status='active' + host_profiles.is_verified=1
//              + 通知 type='host_approved'
//   reject   → host_status='rejected' + 通知 type='host_rejected'
//   suspend  → host_status='suspended' + 通知 type='host_suspended'
//   activate → host_status='active'（从 suspended 恢复） + 通知 type='host_activated'
//
// 返回：{ success: true, status }
//
// 错误：
//   400 → 非法 action
//   401 → 未登录
//   403 → 非 admin
//   404 → 目标用户不存在或无寄养人档案
//
// 说明：id 是 users.id（不是 host_profiles.id）；前端在 admin/hosts 列表拿到的就是 users.id。

import { json, fail, now, requireUser, readJson } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

const ACTIONS = {
  verify:   { status: "active",    notifType: "host_approved",   title: "寄养申请已通过", body: "恭喜！您已成为正式寄养人，可以开始接单了。", link: "/my.html?tab=host", setVerified: true },
  reject:   { status: "rejected",  notifType: "host_rejected",   title: "寄养申请未通过", body: "很抱歉，您的寄养申请未通过审核。请完善资料后重新申请。", link: "/my.html?tab=host" },
  suspend:  { status: "suspended", notifType: "host_suspended",  title: "寄养人账号已暂停", body: "您的寄养人账号已被暂停。如有疑问请联系管理员。", link: "/my.html?tab=host" },
  activate: { status: "active",    notifType: "host_activated",  title: "寄养人账号已恢复", body: "您的寄养人账号已恢复，可以重新接单。", link: "/my.html?tab=host", setVerified: true },
};

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可操作", 403);

  const targetId = (params && params.id) || "";
  if (!targetId) return fail("缺少目标用户 ID", 400);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);
  const action = String(body.action || "").trim().toLowerCase();
  const cfg = ACTIONS[action];
  if (!cfg) {
    return fail(`action 必须是 ${Object.keys(ACTIONS).join("/")}`, 400);
  }

  // 目标用户 + 档案必须存在
  const target = await env.DB.prepare(
    "SELECT id, nickname, host_status FROM users WHERE id = ?"
  ).bind(targetId).first();
  if (!target) return fail("目标用户不存在", 404);

  const profile = await env.DB.prepare(
    "SELECT id, user_id FROM host_profiles WHERE user_id = ?"
  ).bind(targetId).first();
  if (!profile) return fail("目标用户无寄养人档案", 404);

  // activate 仅允许从 suspended 恢复
  if (action === "activate" && target.host_status !== "suspended") {
    return fail("仅暂停中的寄养人可恢复", 400);
  }

  const ts = now();

  // 更新 users.host_status
  await env.DB.prepare(
    "UPDATE users SET host_status = ?, updated_at = ? WHERE id = ?"
  ).bind(cfg.status, ts, targetId).run();

  // verify / activate：标记 is_verified=1
  if (cfg.setVerified) {
    await env.DB.prepare(
      "UPDATE host_profiles SET is_verified = 1, updated_at = ? WHERE user_id = ?"
    ).bind(ts, targetId).run();
  }

  // 通知目标用户（静默失败）
  await createNotification(env, {
    userId: targetId,
    type: cfg.notifType,
    title: cfg.title,
    body: cfg.body,
    link: cfg.link,
  });

  return json({ success: true, status: cfg.status, userId: targetId });
}
