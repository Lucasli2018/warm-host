// POST /api/sponsors/invite — 寄养人邀请担保人
// Task 12
//
// 调用方必须是已审核通过的寄养人（is_host=1 且 host_status='active'）
// body: { sponsorUserId: "..." }
// 校验：不能自己担保、目标存在/未封禁/active/完成≥3单/评分≥4.5、自己未担保、未重复邀请
// 写入 sponsors 表（sponsor_id=users.id, sponsored_host_id=host_profiles.id）+ 通知担保人
//
// 返回: { id, sponsorUserId, status: 'invited' }
// 错误: 400/401/403/404

import { json, fail, parseBody, now, requireUser } from "../../_shared/helpers.js";
import { createNotification } from "../../_shared/notify.js";

const MIN_COMPLETED_ORDERS = 3;
const MIN_AVG_RATING = 4.5;

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  // 必须是寄养人且已通过审核
  if (!user.isHost) return fail("仅寄养人可邀请担保人", 403);
  if (user.hostStatus !== "active") return fail("寄养人审核通过后才可邀请担保人", 403);

  const body = await parseBody(request);
  const sponsorUserId = body && typeof body.sponsorUserId === "string" ? body.sponsorUserId.trim() : "";
  if (!sponsorUserId) return fail("缺少 sponsorUserId", 400);

  // 不能自己担保自己
  if (sponsorUserId === user.id) return fail("不能邀请自己担保", 400);

  // 目标用户
  const targetUser = await env.DB.prepare(
    "SELECT id, nickname, host_status, banned FROM users WHERE id = ?"
  ).bind(sponsorUserId).first();
  if (!targetUser) return fail("目标用户不存在", 404);
  if (targetUser.banned) return fail("该用户已被封禁", 400);
  if (targetUser.host_status !== "active") {
    return fail("担保人必须是通过审核的寄养人", 400);
  }

  // 完成订单数
  const orderCount = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE host_id = ? AND status = 'completed'"
  ).bind(targetUser.id).first();
  const completedOrders = orderCount && orderCount.c ? Number(orderCount.c) : 0;
  if (completedOrders < MIN_COMPLETED_ORDERS) {
    return fail(`担保人需完成至少 ${MIN_COMPLETED_ORDERS} 单`, 400);
  }

  // 目标 profile + 评分
  const targetProfile = await env.DB.prepare(
    "SELECT id, avg_rating, total_reviews FROM host_profiles WHERE user_id = ?"
  ).bind(targetUser.id).first();
  if (!targetProfile) {
    return fail("担保人评分需 ≥ 4.5", 400);
  }
  const avgRating = targetProfile.avg_rating ? Number(targetProfile.avg_rating) : 0;
  if (avgRating < MIN_AVG_RATING) {
    return fail(`担保人评分需 ≥ ${MIN_AVG_RATING}`, 400);
  }

  // 自己的 profile（查 is_sponsored + profileId）
  const myProfile = await env.DB.prepare(
    "SELECT id, is_sponsored FROM host_profiles WHERE user_id = ?"
  ).bind(user.id).first();
  if (!myProfile) return fail("寄养人档案不存在", 404);
  if (myProfile.is_sponsored) {
    return fail("您已获得担保，无需重复邀请", 400);
  }

  // 重复邀请检查（同一 sponsor↔sponsored 对已存在）
  const existing = await env.DB.prepare(
    "SELECT id FROM sponsors WHERE sponsor_id = ? AND sponsored_host_id = ?"
  ).bind(sponsorUserId, myProfile.id).first();
  if (existing) {
    return fail("已发送过邀请，等待对方接受", 400);
  }

  const id = crypto.randomUUID();
  const ts = now();

  await env.DB.prepare(
    "INSERT INTO sponsors (id, sponsor_id, sponsored_host_id, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, sponsorUserId, myProfile.id, ts).run();

  // 通知担保人
  const inviteeNickname = user.nickname || "某寄养人";
  await createNotification(env, {
    userId: sponsorUserId,
    type: "sponsor_invite",
    title: "首单担保邀请",
    body: `${inviteeNickname} 邀请您为 TA 的首单担保`,
    link: "/my.html?tab=host",
  });

  return json({ id, sponsorUserId, status: "invited" });
}
