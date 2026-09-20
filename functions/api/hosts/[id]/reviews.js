// GET /api/hosts/[id]/reviews — 寄养人评价列表（公开）
//
// params.id = host_profiles.id
// Query: page (默认 1，每页 10)
//
// 注意：reviews.reviewee_id 存的是 user_id（不是 host_profiles.id）
// 先用 host_id 反查 user_id，再按 reviewee_id 查评价
//
// 返回:
//   {
//     reviews: [{
//       id, rating, content, tags[], photos[], createdAt,
//       reviewer: { id, nickname, avatarKey }
//     }],
//     total, avgRating,
//     ratingDistribution: { '1': n, '2': n, '3': n, '4': n, '5': n }
//   }
//
// 404: host 不存在 / banned / 非 active

import { json, fail } from "../../../_shared/helpers.js";

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function onRequestGet({ request, env, params }) {
  const id = params && params.id ? String(params.id).trim() : "";
  if (!id) return fail("缺少参数", 400);

  // 查 host_profiles → 拿 user_id + 校验 active/非 ban
  const profile = await env.DB.prepare(
    "SELECT id, user_id FROM host_profiles WHERE id = ?"
  ).bind(id).first();
  if (!profile) return fail("寄养人不存在", 404);

  const uRow = await env.DB.prepare(
    "SELECT banned, host_status FROM users WHERE id = ?"
  ).bind(profile.user_id).first();
  if (!uRow || uRow.banned === 1 || uRow.host_status !== "active") {
    return fail("寄养人不存在", 404);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = 10;
  const offset = (page - 1) * pageSize;

  // 总数 + 平均评分
  const aggRow = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt, ROUND(AVG(rating), 2) AS avg_rating
     FROM reviews WHERE reviewee_id = ?`
  ).bind(profile.user_id).first();
  const total = Number(aggRow?.cnt || 0);
  const avgRating = Number(aggRow?.avg_rating || 0);

  // 评分分布
  const distRows = await env.DB.prepare(
    `SELECT rating, COUNT(*) AS cnt FROM reviews
     WHERE reviewee_id = ?
     GROUP BY rating`
  ).bind(profile.user_id).all();
  const distMap = new Map((distRows.results || []).map(r => [String(r.rating), Number(r.cnt)]));
  const ratingDistribution = {
    "1": distMap.get("1") || 0,
    "2": distMap.get("2") || 0,
    "3": distMap.get("3") || 0,
    "4": distMap.get("4") || 0,
    "5": distMap.get("5") || 0,
  };

  // 分页取评价（含 reviewer 信息）
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.rating, r.content, r.tags, r.photos, r.created_at,
            u.id AS reviewer_id, u.nickname AS reviewer_nickname, u.avatar_key AS reviewer_avatar
     FROM reviews r
     JOIN users u ON r.reviewer_id = u.id
     WHERE r.reviewee_id = ?
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(profile.user_id, pageSize, offset).all();

  const reviews = (results || []).map(r => ({
    id: r.id,
    rating: r.rating,
    content: r.content || "",
    tags: safeJsonArray(r.tags),
    photos: safeJsonArray(r.photos),
    createdAt: r.created_at,
    reviewer: {
      id: r.reviewer_id,
      nickname: r.reviewer_nickname || "",
      avatarKey: r.reviewer_avatar || null,
    },
  }));

  return json({ reviews, total, avgRating, ratingDistribution });
}
