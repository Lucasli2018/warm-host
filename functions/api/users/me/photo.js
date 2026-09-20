// POST /api/users/me/photo
// 上传头像到 R2
//
// Body: multipart/form-data
//   - file: image file (jpg/png/webp, ≤5MB)
//
// R2 key 格式：<userId>-avatar-<ts>-<rand4>.<ext>
// 更新 users.avatar_key
// 返回: { success: true, key }
//
// 注：不依赖中间件注入的 request.user（context 不跨层级共享），
//     改用 requireUser() 直接查库

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
    console.error("[users/me/photo] form() error:", err?.message || err);
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

  const ext = ALLOWED[file.type];
  const key = `${user.id}-avatar-${Date.now()}-${genRand4()}.${ext}`;

  const body = await file.arrayBuffer();

  try {
    await env.R2.put(key, body, { httpMetadata: { contentType: file.type } });
  } catch (err) {
    console.error("[users/me/photo] R2 upload failed:", err);
    return fail("上传失败", 500);
  }

  await env.DB.prepare(
    "UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?"
  ).bind(key, now(), user.id).run();

  return json({ success: true, key });
}
