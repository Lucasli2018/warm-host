// POST /api/admin/hosts/[id]/sponsor — 临时管理员担保端点
// Task 10a 临时实现（Task 12 会替换为正式担保流程：sponsors/invite.js + accept.js）
// params.id = users.id（与 admin/hosts/[id] 审核端点一致）
// body: { sponsorUserId: "..." } | { clear: true }
// 仅 admin 可用。写 sponsors 表 + 更新 host_profiles.is_sponsored / sponsored_by。

import { json, fail, parseBody, now, requireUser } from "../../../../_shared/helpers.js";
import { createNotification } from "../../../../_shared/notify.js";

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);
  if (user.role !== "admin") return fail("需要管理员权限", 403);

  const body = await parseBody(request);
  const ts = now();

  // 取目标用户 + 寄养人档案
  const targetUser = await env.DB.prepare("SELECT id, nickname, host_status, banned FROM users WHERE id = ?")
    .bind(params.id).first();
  if (!targetUser) return fail("寄养人不存在", 404);

  const profile = await env.DB.prepare(
    "SELECT id, user_id, is_sponsored, sponsored_by FROM host_profiles WHERE user_id = ?"
  ).bind(targetUser.id).first();
  if (!profile) return fail("该用户无寄养人档案", 404);

  // 清除担保（测试用）
  if (body && body.clear === true) {
    await env.DB.prepare("DELETE FROM sponsors WHERE sponsored_host_id = ?").bind(profile.id).run();
    await env.DB.prepare("UPDATE host_profiles SET is_sponsored = 0, sponsored_by = NULL, updated_at = ? WHERE id = ?")
      .bind(ts, profile.id).run();
    return json({ success: true, isSponsored: false });
  }

  const sponsorUserId = body && body.sponsorUserId;
  if (!sponsorUserId) return fail("缺少 sponsorUserId", 400);
  if (sponsorUserId === profile.user_id) return fail("不能自己担保自己", 400);

  const sponsor = await env.DB.prepare("SELECT id, nickname, host_status, banned FROM users WHERE id = ?")
    .bind(sponsorUserId).first();
  if (!sponsor) return fail("担保人不存在", 404);
  if (sponsor.banned) return fail("担保人已被封禁", 400);
  // 管理员覆盖端点：允许 admin 以「平台担保」身份直接担保，豁免「担保人须是 active 寄养人」校验。
  // 正常担保流程（老寄养人担保新人）的资格校验在 sponsors/invite.js 中。
  const isPlatformSponsor = sponsor.id === user.id;
  if (!isPlatformSponsor && sponsor.host_status !== "active") {
    return fail("担保人必须是通过审核的寄养人", 400);
  }

  // 写入 sponsors 表
  await env.DB.prepare(
    "INSERT INTO sponsors (id, sponsor_id, sponsored_host_id, created_at) VALUES (?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), sponsor.id, profile.id, ts).run();

  await env.DB.prepare(
    "UPDATE host_profiles SET is_sponsored = 1, sponsored_by = ?, updated_at = ? WHERE id = ?"
  ).bind(sponsor.id, ts, profile.id).run();

  await createNotification(env, {
    userId: profile.user_id,
    type: "sponsor_accepted",
    title: isPlatformSponsor ? "平台已为您的首单担保" : "已获得担保人",
    body: isPlatformSponsor
      ? "平台已为您的首单担保，现在可以接单了"
      : `${sponsor.nickname} 已为您的首单担保，现在可以接单了`,
    link: `/my.html?tab=host`,
  });

  return json({ success: true, isSponsored: true, sponsoredBy: sponsor.id });
}
