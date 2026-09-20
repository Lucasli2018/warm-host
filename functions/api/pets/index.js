// POST /api/pets
// 创建宠物档案
//
// Body:
//   name          (必填)  字符串
//   species       (必填)  '猫' | '狗' | '兔' | '其他'
//   breed         (选填)
//   gender        (选填)  '公' | '母' | '未知'
//   age           (选填)
//   weight        (选填)
//   personality   (选填)  string[] 或 string
//   health_notes  (选填)
//   daily_habits  (选填)
//   special_needs (选填)
//
// 返回: { id, ... }
//
// 注：使用 requireUser 直接查库，不依赖中间件注入的 request.user

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

const SPECIES = ["猫", "狗", "兔", "其他"];
const GENDERS = ["公", "母", "未知"];

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

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const name = toStr(body.name, 30);
  const species = toStr(body.species, 10);

  if (!name) return fail("宠物名字为必填", 400);
  if (!species || !SPECIES.includes(species)) {
    return fail("种类必须是：猫 / 狗 / 兔 / 其他", 400);
  }

  let gender = toStr(body.gender, 6);
  if (gender && !GENDERS.includes(gender)) {
    return fail("性别必须是：公 / 母 / 未知", 400);
  }

  const breed = toStr(body.breed, 40);
  const age = toStr(body.age, 20);
  const weight = toStr(body.weight, 20);
  const personality = parsePersonality(body.personality);
  const healthNotes = toStr(body.health_notes ?? body.healthNotes, 500);
  const dailyHabits = toStr(body.daily_habits ?? body.dailyHabits, 500);
  const specialNeeds = toStr(body.special_needs ?? body.specialNeeds, 500);

  const id = crypto.randomUUID();
  const ts = now();

  await env.DB.prepare(
    `INSERT INTO pets (id, owner_id, name, species, breed, gender, age, weight,
      personality, health_notes, daily_habits, special_needs, cover_key, photos,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?)`
  ).bind(
    id, user.id, name, species, breed, gender, age, weight,
    personality, healthNotes, dailyHabits, specialNeeds, ts, ts
  ).run();

  return json({
    id,
    name,
    species,
    breed,
    gender,
    age,
    weight,
    personality: JSON.parse(personality),
    health_notes: healthNotes,
    daily_habits: dailyHabits,
    special_needs: specialNeeds,
    cover_key: null,
    photos: [],
    created_at: ts,
    updated_at: ts,
  });
}
