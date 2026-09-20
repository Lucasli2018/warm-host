// GET /api/pets/my
// 我的宠物列表（按 created_at DESC）
//
// 返回: [{ id, name, species, breed, gender, age, weight,
//           personality: [...], health_notes, daily_habits, special_needs,
//           cover_key, photos: [...], created_at, updated_at }]
//
// 注：使用 requireUser 直接查库

import { json, fail, now, requireUser } from "../../_shared/helpers.js";

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    species: row.species,
    breed: row.breed || "",
    gender: row.gender || "",
    age: row.age || "",
    weight: row.weight || "",
    personality: safeJsonArray(row.personality),
    health_notes: row.health_notes || "",
    daily_habits: row.daily_habits || "",
    special_needs: row.special_needs || "",
    cover_key: row.cover_key || null,
    photos: safeJsonArray(row.photos),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const { results } = await env.DB.prepare(
    "SELECT * FROM pets WHERE owner_id = ? ORDER BY created_at DESC"
  ).bind(user.id).all();

  return json((results || []).map(serialize));
}
