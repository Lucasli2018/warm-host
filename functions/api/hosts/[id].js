// GET /api/hosts/[id] — 寄养人详情（公开）
//
// params.id = host_profiles.id
//
// 返回:
//   { host: {
//       userId, hostId, nickname, avatarKey, bio, city,
//       capacityCount, capacitySpecies[], capacitySize[], capacityGender[],
//       addressFuzzy, district, experience, specialServices[],
//       dailyRateCents, isVerified, isSponsored,
//       avgRating, totalReviews
//     },
//     availability: [{ startDate, endDate, note }]  // active + start_date >= today
//   }
//
// 404: 不存在 / banned / 非 active

import { json, fail } from "../../_shared/helpers.js";

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function onRequestGet({ env, params }) {
  const id = params && params.id ? String(params.id).trim() : "";
  if (!id) return fail("缺少参数", 400);

  // 用 UTC 午夜计算今天，避免本地时区在 UTC 存储字段上跨天
  const todayStr = new Date().toISOString().slice(0, 10);

  const row = await env.DB.prepare(
    `SELECT u.id AS user_id, u.nickname, u.avatar_key, u.bio, u.city,
            h.id AS host_id, h.bio AS host_bio, h.capacity_count,
            h.capacity_species, h.capacity_size, h.capacity_gender,
            h.address_fuzzy, h.district, h.experience, h.special_services,
            h.daily_rate_cents, h.is_verified, h.is_sponsored,
            h.avg_rating, h.total_reviews
     FROM host_profiles h
     JOIN users u ON h.user_id = u.id
     WHERE h.id = ?`
  ).bind(id).first();

  if (!row) return fail("寄养人不存在", 404);
  // 查是否 banned / 非 active
  const uRow = await env.DB.prepare(
    "SELECT banned, host_status FROM users WHERE id = ?"
  ).bind(row.user_id).first();
  if (!uRow || uRow.banned === 1 || uRow.host_status !== "active") {
    return fail("寄养人不存在", 404);
  }

  // 可接单区间：active=1 且 start_date >= today（升序）
  const { results } = await env.DB.prepare(
    `SELECT start_date, end_date, note FROM host_availability
     WHERE host_id = ? AND active = 1 AND start_date >= ?
     ORDER BY start_date ASC`
  ).bind(row.host_id, todayStr).all();

  const host = {
    userId: row.user_id,
    hostId: row.host_id,
    nickname: row.nickname || "",
    avatarKey: row.avatar_key || null,
    bio: row.host_bio || row.bio || "",
    city: row.city || "同城",
    capacityCount: row.capacity_count ?? 1,
    capacitySpecies: safeJsonArray(row.capacity_species),
    capacitySize: safeJsonArray(row.capacity_size),
    capacityGender: safeJsonArray(row.capacity_gender),
    addressFuzzy: row.address_fuzzy || "",
    district: row.district || "",
    experience: row.experience || "",
    specialServices: safeJsonArray(row.special_services),
    dailyRateCents: row.daily_rate_cents ?? 0,
    isVerified: !!row.is_verified,
    isSponsored: !!row.is_sponsored,
    avgRating: row.avg_rating ?? 0,
    totalReviews: row.total_reviews ?? 0,
  };

  const availability = (results || []).map(a => ({
    startDate: a.start_date,
    endDate: a.end_date,
    note: a.note || "",
  }));

  return json({ host, availability });
}
