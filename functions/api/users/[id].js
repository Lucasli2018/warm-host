// GET /api/users/[id]
// 用户公开信息（无需登录）
//
// 返回: id, nickname, avatar_key, bio, city, review_count, host_status, is_verified
// banned=0 才返回（否则 404）
//
// is_verified 来自 host_profiles（左连接，非寄养人时为 0）
// review_count 为 reviews 表中 reviewee_id = ? 的记录数

import { json, fail } from "../../_shared/helpers.js";

export async function onRequestGet({ env, params }) {
  const { id } = params;
  if (!id) return fail("缺少参数", 400);

  const row = await env.DB.prepare(
    `SELECT u.id,
            u.nickname,
            u.avatar_key,
            u.bio,
            u.city,
            u.host_status,
            COALESCE(h.is_verified, 0) AS is_verified,
            (SELECT COUNT(*) FROM reviews r WHERE r.reviewee_id = u.id) AS review_count
     FROM users u
     LEFT JOIN host_profiles h ON h.user_id = u.id
     WHERE u.id = ? AND u.banned = 0`
  ).bind(id).first();

  if (!row) return fail("用户不存在", 404);

  // 转为 boolean 便于前端使用
  return json({
    id: row.id,
    nickname: row.nickname,
    avatar_key: row.avatar_key,
    bio: row.bio || "",
    city: row.city || "同城",
    review_count: row.review_count,
    host_status: row.host_status,
    is_verified: !!row.is_verified,
  });
}
