// /api/pets/[id]
//   GET    公开读（banned 用户不返回）
//   PUT    更新（仅 owner）
//   DELETE 删除（仅 owner，硬删）
//
// 注：使用 requireUser 直接查库，不依赖中间件注入的 request.user

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

const SPECIES = ["猫", "狗", "兔", "其他"];
const GENDERS = ["公", "母", "未知"];

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

function toStr(v, max) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (max && s.length > max) return s.slice(0, max);
  return s;
}

function parsePersonality(input) {
  if (input === undefined || input === null || input === "") return JSON.stringify([]);
  let arr = [];
  if (Array.isArray(input)) arr = input.map(x => String(x).trim()).filter(Boolean);
  else if (typeof input === "string") {
    try {
      const v = JSON.parse(input);
      if (Array.isArray(v)) arr = v.map(x => String(x).trim()).filter(Boolean);
    } catch {
      arr = input.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
    }
  }
  arr = arr.slice(0, 12);
  return JSON.stringify(arr);
}

// ============ GET ============
export async function onRequestGet({ env, params }) {
  const id = params.id;
  if (!id) return fail("缺少参数", 400);

  const row = await env.DB.prepare(
    `SELECT p.*, u.banned AS owner_banned
     FROM pets p
     JOIN users u ON p.owner_id = u.id
     WHERE p.id = ?`
  ).bind(id).first();

  if (!row) return fail("宠物不存在", 404);
  if (row.owner_banned) return fail("宠物不存在", 404);

  return json(serialize(row));
}

// ============ PUT ============
export async function onRequestPut({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const id = params.id;
  if (!id) return fail("缺少参数", 400);

  const existing = await env.DB.prepare(
    "SELECT id, owner_id FROM pets WHERE id = ?"
  ).bind(id).first();
  if (!existing) return fail("宠物不存在", 404);
  if (existing.owner_id !== user.id) return fail("无权操作此宠物", 403);

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  // 只更新前端可修改字段
  const updatable = {
    name: toStr(body.name, 30),
    species: toStr(body.species, 10),
    breed: toStr(body.breed, 40),
    gender: toStr(body.gender, 6),
    age: toStr(body.age, 20),
    weight: toStr(body.weight, 20),
    personality: parsePersonality(body.personality),
    health_notes: toStr(body.health_notes ?? body.healthNotes, 500),
    daily_habits: toStr(body.daily_habits ?? body.dailyHabits, 500),
    special_needs: toStr(body.special_needs ?? body.specialNeeds, 500),
  };

  if (!updatable.name) return fail("宠物名字为必填", 400);
  if (!SPECIES.includes(updatable.species)) {
    return fail("种类必须是：猫 / 狗 / 兔 / 其他", 400);
  }
  if (updatable.gender && !GENDERS.includes(updatable.gender)) {
    return fail("性别必须是：公 / 母 / 未知", 400);
  }

  const ts = now();
  await env.DB.prepare(
    `UPDATE pets SET
       name = ?, species = ?, breed = ?, gender = ?, age = ?, weight = ?,
       personality = ?, health_notes = ?, daily_habits = ?, special_needs = ?,
       updated_at = ?
     WHERE id = ?`
  ).bind(
    updatable.name, updatable.species, updatable.breed, updatable.gender,
    updatable.age, updatable.weight, updatable.personality,
    updatable.health_notes, updatable.daily_habits, updatable.special_needs,
    ts, id
  ).run();

  const updated = await env.DB.prepare("SELECT * FROM pets WHERE id = ?").bind(id).first();
  return json(serialize(updated));
}

// ============ DELETE ============
export async function onRequestDelete({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const id = params.id;
  if (!id) return fail("缺少参数", 400);

  const existing = await env.DB.prepare(
    "SELECT id, owner_id FROM pets WHERE id = ?"
  ).bind(id).first();
  if (!existing) return fail("宠物不存在", 404);
  if (existing.owner_id !== user.id) return fail("无权操作此宠物", 403);

  await env.DB.prepare("DELETE FROM pets WHERE id = ?").bind(id).run();

  return json({ success: true });
}
