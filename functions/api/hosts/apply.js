// POST /api/hosts/apply
// 申请成为寄养人
//
// Body: {
//   bio, capacity_count, capacity_species[], capacity_size[], capacity_gender[],
//   address_fuzzy, district, experience, special_services[], daily_rate_cents
// }
//
// 副作用:
//   - INSERT host_profiles（表单数据）
//   - UPDATE users SET is_host=1, host_status='pending'
//   - 任一失败回滚（DELETE profile）
//
// 返回: { success: true, hostStatus: 'pending' }
//
// 已申请过（is_host=1 且 host_status in (pending, active)）→ 400
// 未登录 → 401

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

function parseArrayField(input, allowed, maxLen) {
  let arr = [];
  if (Array.isArray(input)) arr = input.map(x => String(x).trim()).filter(Boolean);
  else if (typeof input === "string" && input.trim()) {
    try {
      const v = JSON.parse(input);
      if (Array.isArray(v)) arr = v.map(x => String(x).trim()).filter(Boolean);
    } catch {
      arr = input.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
    }
  }
  // 去重 + 过滤非法值 + 截断
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (allowed && !allowed.includes(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= maxLen) break;
  }
  return JSON.stringify(out);
}

function validateFields(body) {
  // capacity_count 1-10
  const count = parseInt(body.capacity_count, 10);
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    return { error: "同时寄养数量需在 1-10 之间" };
  }
  // capacity_species 非空
  const speciesRaw = Array.isArray(body.capacity_species) ? body.capacity_species : [];
  const speciesValid = speciesRaw.filter(v => SPECIES.includes(v));
  if (speciesValid.length === 0) return { error: "请至少选择一种可寄养品种" };
  // capacity_size 非空
  const sizeRaw = Array.isArray(body.capacity_size) ? body.capacity_size : [];
  const sizeValid = sizeRaw.filter(v => SIZES.includes(v));
  if (sizeValid.length === 0) return { error: "请至少选择一种可寄养体型" };
  // capacity_gender 非空
  const genderRaw = Array.isArray(body.capacity_gender) ? body.capacity_gender : [];
  const genderValid = genderRaw.filter(v => GENDERS.includes(v));
  if (genderValid.length === 0) return { error: "请至少选择一种可寄养性别" };
  // district 非空
  const district = toStr(body.district, 20);
  if (!district) return { error: "请填写所在区域" };
  // daily_rate_cents 非负整数
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

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  // 安全兜底：被禁用账号不可申请
  if (user.banned) return fail("账号已被封禁", 403);

  // 已申请过（is_host=1 且 status 非 rejected/suspended）→ 拒绝重复申请
  if (user.isHost && (user.hostStatus === "pending" || user.hostStatus === "active")) {
    return fail("您已申请成为寄养人，请勿重复提交", 400);
  }

  // 若用户已被标记为 host 但状态为 rejected/suspended：允许重新申请
  // （此处会 upsert profile + reset host_status）
  // 先查是否已有 profile
  const existing = await env.DB.prepare(
    "SELECT id, user_id FROM host_profiles WHERE user_id = ?"
  ).bind(user.id).first();

  // 校验字段
  const parsed = validateFields(await readJson(request));
  if (parsed.error) return fail(parsed.error, 400);
  const fields = parsed.fields;
  const ts = now();

  let profileId;
  try {
    if (existing) {
      // 更新已有 profile
      profileId = existing.id;
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
        fields.daily_rate_cents, ts, profileId
      ).run();
    } else {
      // 新建 profile
      profileId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO host_profiles (
           id, user_id, bio, capacity_count, capacity_species, capacity_size,
           capacity_gender, address_fuzzy, district, experience,
           special_services, daily_rate_cents, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        profileId, user.id, fields.bio, fields.capacity_count,
        fields.capacity_species, fields.capacity_size, fields.capacity_gender,
        fields.address_fuzzy, fields.district, fields.experience,
        fields.special_services, fields.daily_rate_cents, ts, ts
      ).run();
    }

    // 更新 users: is_host=1, host_status='pending'
    await env.DB.prepare(
      "UPDATE users SET is_host = 1, host_status = 'pending', updated_at = ? WHERE id = ?"
    ).bind(ts, user.id).run();
  } catch (err) {
    // 回滚 profile（若已创建/更新）
    if (profileId) {
      try {
        await env.DB.prepare("DELETE FROM host_profiles WHERE id = ?").bind(profileId).run();
      } catch {}
    }
    return fail("提交失败，请重试", 500);
  }

  return json({ success: true, hostStatus: "pending" });
}
