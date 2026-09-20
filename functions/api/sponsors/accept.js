// POST /api/sponsors/accept — 担保人接受邀请
// Task 12
//
// body: { sponsorId: "..." }  (sponsors.id)
// 校验：邀请记录存在、当前用户是被邀请的担保人
//      目标 profile 存在、未担保、寄养人身份有效
// 更新 host_profiles SET is_sponsored=1, sponsored_by=当前用户id, updated_at
// 通知被担保者
//
// 返回: { success: true, isSponsored: true }
// 错误: 400/401/403/404

import { json, fail, parseBody, now, requireUser } from "../../_shared/helpers.js";
import { createNotification } from "../../_shared/notify.js";

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const body = await parseBody(request);
  const sponsorId = body && typeof body.sponsorId === "string" ? body.sponsorId.trim() : "";
  if (!sponsorId) return fail("缺少 sponsorId", 400);

  // 查邀请记录
  const row = await env.DB.prepare(
    "SELECT id, sponsor_id, sponsored_host_id, created_at FROM sponsors WHERE id = ?"
  ).bind(sponsorId).first();
  if (!row) return fail("邀请记录不存在", 404);

  // 只有被邀请的担保人能接受
  if (row.sponsor_id !== user.id) {
    return fail("您不是被邀请的担保人", 403);
  }

  // 查目标 profile（sponsored_host_id）
  const targetProfile = await env.DB.prepare(
    "SELECT id, user_id, is_sponsored, sponsored_by FROM host_profiles WHERE id = ?"
  ).bind(row.sponsored_host_id).first();
  if (!targetProfile) {
    return fail("被担保的寄养人不存在", 404);
  }

  // 目标已担保 → 拒绝
  if (targetProfile.is_sponsored) {
    return fail("对方已获得其他担保", 400);
  }

  // 目标寄养人身份有效性
  const targetUser = await env.DB.prepare(
    "SELECT id, nickname, host_status, banned FROM users WHERE id = ?"
  ).bind(targetProfile.user_id).first();
  if (!targetUser) {
    return fail("被担保的寄养人不存在", 404);
  }
  if (targetUser.host_status !== "active") {
    return fail("对方寄养人身份已失效", 400);
  }

  const ts = now();

  await env.DB.prepare(
    "UPDATE host_profiles SET is_sponsored = 1, sponsored_by = ?, updated_at = ? WHERE id = ?"
  ).bind(user.id, ts, targetProfile.id).run();

  // 通知被担保者
  const sponsorNickname = user.nickname || "担保人";
  await createNotification(env, {
    userId: targetProfile.user_id,
    type: "sponsor_accepted",
    title: "首单担保已接受",
    body: `${sponsorNickname} 已接受您的首单担保邀请，现在可以接单了`,
    link: "/my.html?tab=host",
  });

  return json({ success: true, isSponsored: true });
}
