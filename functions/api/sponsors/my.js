// GET /api/sponsors/my — 我的担保关系
// Task 12
//
// 调用方必须是寄养人（is_host=1）
// 返回：
//   pendingInvites  : 我发出的待接受邀请
//   receivedInvites : 别人邀请我的（未接受）
//   sponsoredBy     : 当前担保关系（null 表示未担保）
//   sponsored       : 是否已担保（host_profiles.is_sponsored）
//
// 错误: 401/403

import { json, fail, requireUser } from "../../_shared/helpers.js";

const MIN_COMPLETED_ORDERS = 3;
const MIN_AVG_RATING = 4.5;

// 序列化担保人信息（pendingInvites 用）
function sponsorInfo(row) {
  return {
    id: row.id,
    nickname: row.nickname || "",
    avatarKey: row.avatar_key || null,
    avgRating: row.avg_rating ? Number(row.avg_rating) : 0,
    completedOrders: row.completed_orders ? Number(row.completed_orders) : 0,
  };
}

// 序列化被邀请人信息（receivedInvites 用）
function inviteeInfo(row) {
  return {
    id: row.id,
    nickname: row.nickname || "",
  };
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);
  if (!user.isHost) return fail("仅寄养人可查看担保关系", 403);

  // 自己的 profile
  const myProfile = await env.DB.prepare(
    "SELECT id, is_sponsored, sponsored_by, updated_at FROM host_profiles WHERE user_id = ?"
  ).bind(user.id).first();

  const sponsored = !!(myProfile && myProfile.is_sponsored);

  // 当前担保关系（sponsoredBy）
  let sponsoredBy = null;
  if (myProfile && myProfile.is_sponsored && myProfile.sponsored_by) {
    const sp = await env.DB.prepare(
      "SELECT id, nickname FROM users WHERE id = ?"
    ).bind(myProfile.sponsored_by).first();
    sponsoredBy = {
      sponsorId: myProfile.sponsored_by,
      sponsoredAt: myProfile.updated_at || null,
      sponsor: sp ? { id: sp.id, nickname: sp.nickname || "" } : null,
    };
  }

  // pendingInvites：我发出的待接受邀请
  // sponsors.sponsored_host_id = myProfile.id AND myProfile.is_sponsored = 0
  // （若我已担保，所有发出的邀请都不再是「待接受」）
  const pendingInvites = [];
  if (myProfile && !myProfile.is_sponsored) {
    const { results: pendingRows } = await env.DB.prepare(
      `SELECT s.id AS sponsor_row_id, s.created_at AS created_at,
              u.id, u.nickname, u.avatar_key,
              hp.avg_rating,
              (SELECT COUNT(*) FROM orders o WHERE o.host_id = u.id AND o.status = 'completed') AS completed_orders
         FROM sponsors s
         JOIN users u ON u.id = s.sponsor_id
         LEFT JOIN host_profiles hp ON hp.user_id = u.id
         WHERE s.sponsored_host_id = ?
         ORDER BY s.created_at DESC`
    ).bind(myProfile.id).all();
    for (const r of pendingRows || []) {
      pendingInvites.push({
        sponsorId: r.sponsor_row_id,
        sponsor: sponsorInfo(r),
        createdAt: r.created_at,
      });
    }
  }

  // receivedInvites：别人邀请我的（sponsor_id = my.id），且我尚未接受
  // 判定接受：target profile.is_sponsored=1 AND sponsored_by=my.id → 已接受，排除
  const receivedInvites = [];
  const { results: recvRows } = await env.DB.prepare(
    `SELECT s.id AS sponsor_row_id, s.sponsored_host_id, s.created_at AS created_at,
            hp.user_id AS target_user_id, hp.is_sponsored AS target_is_sponsored, hp.sponsored_by AS target_sponsored_by,
            u.id, u.nickname
       FROM sponsors s
       JOIN host_profiles hp ON hp.id = s.sponsored_host_id
       JOIN users u ON u.id = hp.user_id
       WHERE s.sponsor_id = ?
       ORDER BY s.created_at DESC`
  ).bind(user.id).all();
  for (const r of recvRows || []) {
    // 若我已接受（目标 profile.is_sponsored=1 且 sponsored_by=my.id）→ 排除
    if (r.target_is_sponsored && r.target_sponsored_by === user.id) continue;
    receivedInvites.push({
      sponsorId: r.sponsor_row_id,
      invitee: inviteeInfo(r),
      createdAt: r.created_at,
    });
  }

  return json({
    sponsored,
    sponsoredBy,
    pendingInvites,
    receivedInvites,
  });
}
