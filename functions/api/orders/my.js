// GET /api/orders/my?role=owner|host — 我的订单列表
// Task 10a

import { json, fail, now, requireUser } from "../../_shared/helpers.js";

function parsePet(pet) {
  if (!pet) return null;
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    breed: pet.breed || "",
    gender: pet.gender || "",
    age: pet.age || "",
    coverKey: pet.cover_key || null,
    photos: safeParse(pet.photos, []),
    personality: safeParse(pet.personality, []),
    healthNotes: pet.health_notes || "",
    dailyHabits: pet.daily_habits || "",
    specialNeeds: pet.special_needs || "",
  };
}

function safeParse(s, fallback) {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const url = new URL(request.url);
  const role = url.searchParams.get("role") === "host" ? "host" : "owner";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));
  const offset = (page - 1) * pageSize;

  const whoCol = role === "host" ? "o.host_id" : "o.owner_id";

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM orders o WHERE ${whoCol} = ?`
  ).bind(user.id).first();

  const rows = await env.DB.prepare(
    `SELECT o.*,
            p.id AS pet_id2, p.name, p.species, p.breed, p.gender, p.age, p.weight,
            p.personality, p.health_notes, p.daily_habits, p.special_needs,
            p.cover_key, p.photos,
            uh.id AS peer_host_id, uh.nickname AS host_nickname, uh.avatar_key AS host_avatar_key,
            uo.id AS peer_owner_id, uo.nickname AS owner_nickname, uo.avatar_key AS owner_avatar_key,
            h.district AS host_district, h.address_fuzzy AS host_address_fuzzy,
            h.daily_rate_cents AS host_daily_rate_cents
     FROM orders o
     LEFT JOIN pets p ON o.pet_id = p.id
     LEFT JOIN users uh ON o.host_id = uh.id
     LEFT JOIN users uo ON o.owner_id = uo.id
     LEFT JOIN host_profiles h ON h.user_id = o.host_id
     WHERE ${whoCol} = ?
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...[user.id, pageSize, offset]).all();

  const orders = (rows.results || rows).map((o) => ({
    id: o.id,
    needId: o.need_id,
    status: o.status,
    startDate: o.start_date,
    endDate: o.end_date,
    durationDays: o.duration_days,
    totalPriceCents: o.total_price_cents,
    address: o.address || "",
    notes: o.notes || "",
    acceptedAt: o.accepted_at || null,
    startedAt: o.started_at || null,
    completedAt: o.completed_at || null,
    cancelledAt: o.cancelled_at || null,
    createdAt: o.created_at,
    updatedAt: o.updated_at || null,
    pet: parsePet(o),
    host: {
      id: o.peer_host_id,
      nickname: o.host_nickname || "",
      avatarKey: o.host_avatar_key || null,
      district: o.host_district || "",
      addressFuzzy: o.host_address_fuzzy || "",
      dailyRateCents: o.host_daily_rate_cents || 0,
    },
    owner: {
      id: o.peer_owner_id,
      nickname: o.owner_nickname || "",
      avatarKey: o.owner_avatar_key || null,
    },
    isOwnerView: role === "owner",
  }));

  return json({ orders, total: Number(totalRow.c) || 0, page, pageSize, role });
}
