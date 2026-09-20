// PUT /api/users/me
// 更新资料：nickname / bio / city / emergency_contact
//
// Body (JSON): { nickname?, bio?, city?, emergency_contact? }
// 只允许这 4 个字段，其他字段忽略
// 返回: { success: true }
//
// 注：不依赖中间件注入的 request.user（context 不跨层级共享），
//     改用 requireUser() 直接查库

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

const MAX_NICKNAME = 20;
const MAX_BIO = 200;
const MAX_CITY = 30;
const MAX_CONTACT = 50;

export async function onRequestPut({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("请求体格式错误", 400);
  }

  const fields = [];
  const values = [];

  // --- nickname ---
  if (body.nickname !== undefined) {
    const v = String(body.nickname).trim();
    if (v.length < 2 || v.length > MAX_NICKNAME) {
      return fail("昵称需 2-20 个字符", 400);
    }
    fields.push("nickname = ?");
    values.push(v);
  }

  // --- bio ---
  if (body.bio !== undefined) {
    const v = String(body.bio).trim();
    if (v.length > MAX_BIO) {
      return fail(`简介最多 ${MAX_BIO} 字`, 400);
    }
    fields.push("bio = ?");
    values.push(v);
  }

  // --- city ---
  if (body.city !== undefined) {
    const v = String(body.city).trim();
    if (v.length > MAX_CITY) {
      return fail(`城市最多 ${MAX_CITY} 字`, 400);
    }
    fields.push("city = ?");
    values.push(v);
  }

  // --- emergency_contact ---
  if (body.emergency_contact !== undefined) {
    const v = String(body.emergency_contact).trim();
    if (v.length > MAX_CONTACT) {
      return fail(`紧急联系人最多 ${MAX_CONTACT} 字`, 400);
    }
    fields.push("emergency_contact = ?");
    values.push(v);
  }

  if (fields.length === 0) return fail("无可更新字段", 400);

  fields.push("updated_at = ?");
  values.push(now());
  values.push(user.id);

  await env.DB.prepare(
    `UPDATE users SET ${fields.join(", ")} WHERE id = ?`
  ).bind(...values).run();

  return json({ success: true });
}
