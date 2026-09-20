// GET /api/admin/hosts
// 寄养人审核列表
//
// Query: status = pending|active|rejected|suspended (默认 pending)
//
// 返回：
//   [
//     {
//       id, phone, nickname, avatar_key, host_status,
//       real_name, id_card_key, is_host, banned, city, bio,
//       host_profile: { id, bio, capacity_count, capacity_species, capacity_size,
//                       capacity_gender, address_fuzzy, district, experience,
//                       special_services, daily_rate_cents, is_verified, is_sponsored,
//                       avg_rating, total_reviews },
//       applied_at   // host_profiles.created_at
//     },
//     ...
//   ]
//
// 说明：仅返回 id_card_key 是否存在（存在即返回 key，前端不请求图片），不返回图片内容。
// 权限：admin

import { json, fail, now, requireUser } from "../../_shared/helpers.js";

const VALID_STATUSES = ["pending", "active", "rejected", "suspended"];

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可访问", 403);

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "pending").trim().toLowerCase();
  if (!VALID_STATUSES.includes(status)) {
    return fail(`status 必须是 ${VALID_STATUSES.join("/")}`, 400);
  }

  const { results } = await env.DB.prepare(
    `SELECT u.id, u.phone, u.nickname, u.avatar_key, u.host_status,
            u.real_name, u.id_card_key, u.is_host, u.banned, u.city, u.bio,
            u.created_at AS user_created_at,
            h.id AS host_id, h.bio AS host_bio, h.capacity_count,
            h.capacity_species, h.capacity_size, h.capacity_gender,
            h.address_fuzzy, h.district, h.experience, h.special_services,
            h.daily_rate_cents, h.is_verified, h.is_sponsored,
            h.avg_rating, h.total_reviews,
            h.created_at AS applied_at, h.updated_at AS profile_updated_at
      FROM users u
      JOIN host_profiles h ON h.user_id = u.id
      WHERE u.host_status = ?
      ORDER BY h.created_at DESC`
  ).bind(status).all();

  const list = results.map(r => ({
    id: r.id,
    phone: r.phone,
    nickname: r.nickname,
    avatarKey: r.avatar_key,
    hasAvatar: !!r.avatar_key,
    hostStatus: r.host_status,
    realName: r.real_name,
    hasIdCard: !!r.id_card_key,
    idCardKey: r.id_card_key,
    isHost: !!r.is_host,
    banned: !!r.banned,
    city: r.city,
    bio: r.bio,
    userCreatedAt: r.user_created_at,
    hostProfile: {
      id: r.host_id,
      bio: r.host_bio,
      capacity_count: r.capacity_count,
      capacity_species: parseArr(r.capacity_species),
      capacity_size: parseArr(r.capacity_size),
      capacity_gender: parseArr(r.capacity_gender),
      address_fuzzy: r.address_fuzzy,
      district: r.district,
      experience: r.experience,
      special_services: parseArr(r.special_services),
      daily_rate_cents: r.daily_rate_cents,
      is_verified: !!r.is_verified,
      is_sponsored: !!r.is_sponsored,
      avg_rating: r.avg_rating,
      total_reviews: r.total_reviews,
      updated_at: r.profile_updated_at,
    },
    appliedAt: r.applied_at,
  }));

  return json(list);
}

function parseArr(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
