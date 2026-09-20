// /api/hosts/me
//   GET  我的寄养人档案（含 profile + availability 列表 + user.host_status）
//   POST 更新我的档案字段（不改 host_status）
//
// 前置：用户 is_host=1
//
// GET 返回:
//   {
//     profile: { id, bio, capacity_count, capacity_species[], capacity_size[],
//                capacity_gender[], address_fuzzy, district, experience,
//                special_services[], daily_rate_cents, is_verified,
//                is_sponsored, sponsored_by, total_reviews, avg_rating,
//                created_at, updated_at } | null,
//     availability: [{ id, start_date, end_date, note, active, created_at }],
//     user: { host_status, is_sponsored, is_verified }
//   }

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

const SPECIES = ["猫", "狗", "兔", "其他"];
const SIZES = ["小型", "中型", "大型"];
const GENDERS = ["公", "母", "未知"];
const SERVICES = ["可上门接送", "宠物医院合作", "有隔离空间", "24小时监控"];

function toStr(v, max) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function serializeProfile(row) {
  return {
    id: row.id,
    bio: row.bio || "",
    capacity_count: row.capacity_count,
    capacity_species: safeJsonArray(row.capacity_species),
    capacity_size: safeJsonArray(row.capacity_size),
    capacity_gender: safeJsonArray(row.capacity_gender),
    address_fuzzy: row.address_fuzzy || "",
    district: row.district || "",
    experience: row.experience || "",
    special_services: safeJsonArray(row.special_services),
    daily_rate_cents: row.daily_rate_cents,
    is_verified: !!row.is_verified,
    is_sponsored: !!row.is_sponsored,
    sponsored_by: row.sponsored_by || null,
    total_reviews: row.total_reviews || 0,
    avg_rating: row.avg_rating || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeAvailability(row) {
  return {
    id: row.id,
    start_date: row.start_date,
    end_date: row.end_date,
    note: row.note || "",
    active: !!row.active,
    created_at: row.created_at,
  };
}

function validateProfileFields(body) {
  const count = parseInt(body.capacity_count, 10);
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    return { error: "同时寄养数量需在 1-10 之间" };
  }
  const speciesRaw = Array.isArray(body.capacity_species) ? body.capacity_species : [];
  const speciesValid = speciesRaw.filter(v => SPECIES.includes(v));
  if (speciesValid.length === 0) return { error: "请至少选择一种可寄养品种" };
  const sizeRaw = Array.isArray(body.capacity_size) ? body.capacity_size : [];
  const sizeValid = sizeRaw.filter(v => SIZES.includes(v));
  if (sizeValid.length === 0) return { error: "请至少选择一种可寄养体型" };
  const genderRaw = Array.isArray(body.capacity_gender) ? body.capacity_gender : [];
  const genderValid = genderRaw.filter(v => GENDERS.includes(v));
  if (genderValid.length === 0) return { error: "请至少选择一种可寄养性别" };
  const district = toStr(body.district, 20);
  if (!district) return { error: "请填写所在区域" };
  const rate = parseInt(body.daily_rate_cents, 10);
  if (!Number.isFinite(rate) || rate < 0) {
    return { error: "日费必须为非负整数（分）" };
  }
  return {
    fields: {
      bio: toStr(body.bio, 500),
      capacity_count: count,
      capacity_species: JSON.stringify(speciesValid),
      capacity_size: JSON.stringify(sizeValid),
      capacity_gender: JSON.stringify(genderValid),
      address_fuzzy: toStr(body.address_fuzzy, 100),
      district,
      experience: toStr(body.experience, 500),
      special_services: JSON.stringify(
        (Array.isArray(body.special_services) ? body.special_services : [])
          .filter(v => SERVICES.includes(v))
      ),
      daily_rate_cents: rate,
    },
  };
}

// ============ GET ============
export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  // user 信息（含 host_status, is_sponsored, is_verified 需从 host_profiles 拿）
  const profile = await env.DB.prepare(
    "SELECT * FROM host_profiles WHERE user_id = ?"
  ).bind(user.id).first();

  // 查询 availability 列表
  let availability = [];
  if (profile) {
    const { results } = await env.DB.prepare(
      "SELECT * FROM host_availability WHERE host_id = ? AND active = 1 ORDER BY start_date ASC"
    ).bind(profile.id).all();
    availability = (results || []).map(serializeAvailability);
  }

  return json({
    profile: profile ? serializeProfile(profile) : null,
    availability,
    user: {
      host_status: user.hostStatus || (profile ? "active" : "pending"),
      is_sponsored: profile ? !!profile.is_sponsored : false,
      is_verified: profile ? !!profile.is_verified : false,
    },
  });
}

// ============ POST ============
export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (!user.isHost) return fail("您尚未申请成为寄养人", 403);

  const profile = await env.DB.prepare(
    "SELECT id FROM host_profiles WHERE user_id = ?"
  ).bind(user.id).first();
  if (!profile) return fail("寄养人档案不存在", 404);

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const parsed = validateProfileFields(body);
  if (parsed.error) return fail(parsed.error, 400);
  const fields = parsed.fields;
  const ts = now();

  await env.DB.prepare(
    `UPDATE host_profiles SET
       bio = ?, capacity_count = ?, capacity_species = ?, capacity_size = ?,
       capacity_gender = ?, address_fuzzy = ?, district = ?, experience = ?,
       special_services = ?, daily_rate_cents = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    fields.bio, fields.capacity_count, fields.capacity_species,
    fields.capacity_size, fields.capacity_gender, fields.address_fuzzy,
    fields.district, fields.experience, fields.special_services,
    fields.daily_rate_cents, ts, profile.id
  ).run();

  return json({ success: true, id: profile.id });
}
