// POST /api/users/me/verify-id
// 上传身份证照片 + 实名（待人工审核）
//
// Body: multipart/form-data
//   - file: image file (jpg/png/webp, ≤5MB)
//   - realName: optional string (2-20 字符)，更新 users.real_name
//
// R2 key 格式：<userId>-idcard-<ts>-<rand4>.<ext>
// 更新 users.id_card_key, id_card_verified = 0（待管理员审核）
//
// 注意：身份证图片不提供公开读取端点（隐私）

import { json, fail, now, requireUser } from "../../../_shared/helpers.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function genRand4() {
  return Math.random().toString(36).slice(2, 6);
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const ctype = request.headers.get("content-type") || "";
  if (!ctype.startsWith("multipart/form-data")) {
    return fail("Content-Type 必须是 multipart/form-data", 400);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[users/me/verify-id] form() error:", err?.message || err);
    return fail("表单解析失败: " + (err?.message || String(err)), 400);
  }

  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return fail("缺少 file 字段", 400);
  }
  if (file.size > MAX_SIZE) {
    return fail(`图片过大，最大 ${MAX_SIZE / 1024 / 1024}MB`, 400);
  }
  if (!ALLOWED[file.type]) {
    return fail(`不支持的格式：${file.type}，仅支持 jpg/png/webp`, 400);
  }

  // 可选 realName
  let realName = null;
  if (form.has("realName")) {
    const v = String(form.get("realName") || "").trim();
    if (v.length >= 2 && v.length <= 20) {
      realName = v;
    }
  }

  const ext = ALLOWED[file.type];
  const key = `${user.id}-idcard-${Date.now()}-${genRand4()}.${ext}`;

  const body = await file.arrayBuffer();
  try {
    await env.R2.put(key, body, { httpMetadata: { contentType: file.type } });
  } catch (err) {
    console.error("[users/me/verify-id] R2 upload failed:", err);
    return fail("上传失败", 500);
  }

  const ts = now();
  if (realName) {
    await env.DB.prepare(
      "UPDATE users SET id_card_key = ?, id_card_verified = 0, real_name = ?, updated_at = ? WHERE id = ?"
    ).bind(key, realName, ts, user.id).run();
  } else {
    await env.DB.prepare(
      "UPDATE users SET id_card_key = ?, id_card_verified = 0, updated_at = ? WHERE id = ?"
    ).bind(key, ts, user.id).run();
  }

  return json({
    success: true,
    key,
    realNameUpdated: !!realName,
    message: "身份证已提交，等待管理员审核",
  });
}
