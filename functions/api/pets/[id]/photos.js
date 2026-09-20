// /api/pets/[id]/photos
//   POST    multipart 上传（字段名 file，单张），追加到 pets.photos；若 cover_key 为空则设为主图
//   PUT     body { coverKey }，设主图（仅 owner，coverKey 必须在 photos 内）
//   DELETE  body { photoKey }，从数组移除 + R2 删除；若删的是 cover 则重置 cover
//
// R2 key 格式：<petId>-photo-<ts>-<rand4>.<ext>
// 限制：jpg/png/webp、单张 ≤5MB、总数 < 9
//
// 注：使用 requireUser 直接查库，不依赖中间件注入的 request.user

import { json, fail, readJson, now, requireUser } from "../../../_shared/helpers.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_PHOTOS = 9;
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function genRand4() {
  return Math.random().toString(36).slice(2, 6);
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

// 加载宠物并校验 owner 权限
async function loadOwnedPet(db, petId, userId) {
  const row = await db.prepare("SELECT * FROM pets WHERE id = ?").bind(petId).first();
  if (!row) return { error: "宠物不存在", status: 404 };
  if (row.owner_id !== userId) return { error: "无权操作此宠物", status: 403 };
  return { row };
}

// ============ POST: 上传照片 ============
export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const petId = params.id;
  if (!petId) return fail("缺少参数", 400);

  const loaded = await loadOwnedPet(env.DB, petId, user.id);
  if (loaded.error) return fail(loaded.error, loaded.status);
  const pet = loaded.row;

  const photos = safeJsonArray(pet.photos);
  if (photos.length >= MAX_PHOTOS) {
    return fail(`最多上传 ${MAX_PHOTOS} 张照片`, 400);
  }

  const ctype = request.headers.get("content-type") || "";
  if (!ctype.startsWith("multipart/form-data")) {
    return fail("Content-Type 必须是 multipart/form-data", 400);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[pets/[id]/photos] formData error:", err?.message || err);
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
  const key = `${petId}-photo-${Date.now()}-${genRand4()}.${ext}`;

  const body = await file.arrayBuffer();
  try {
    await env.R2.put(key, body, { httpMetadata: { contentType: file.type } });
  } catch (err) {
    console.error("[pets/[id]/photos] R2 upload failed:", err);
    return fail("上传失败", 500);
  }

  const newPhotos = photos.concat([key]);
  const coverKey = pet.cover_key || key; // 若未设主图，自动设为当前
  const ts = now();

  await env.DB.prepare(
    "UPDATE pets SET photos = ?, cover_key = ?, updated_at = ? WHERE id = ?"
  ).bind(JSON.stringify(newPhotos), coverKey, ts, petId).run();

  const updated = await env.DB.prepare("SELECT * FROM pets WHERE id = ?").bind(petId).first();
  return json(serialize(updated));
}

// ============ PUT: 设主图 ============
export async function onRequestPut({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const petId = params.id;
  if (!petId) return fail("缺少参数", 400);

  const loaded = await loadOwnedPet(env.DB, petId, user.id);
  if (loaded.error) return fail(loaded.error, loaded.status);
  const pet = loaded.row;

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const coverKey = typeof body.coverKey === "string" ? body.coverKey.trim() : "";
  if (!coverKey) return fail("coverKey 必填", 400);

  const photos = safeJsonArray(pet.photos);
  if (!photos.includes(coverKey)) {
    return fail("该照片不属于此宠物", 400);
  }

  const ts = now();
  await env.DB.prepare(
    "UPDATE pets SET cover_key = ?, updated_at = ? WHERE id = ?"
  ).bind(coverKey, ts, petId).run();

  const updated = await env.DB.prepare("SELECT * FROM pets WHERE id = ?").bind(petId).first();
  return json(serialize(updated));
}

// ============ DELETE: 删照片 ============
export async function onRequestDelete({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const petId = params.id;
  if (!petId) return fail("缺少参数", 400);

  const loaded = await loadOwnedPet(env.DB, petId, user.id);
  if (loaded.error) return fail(loaded.error, loaded.status);
  const pet = loaded.row;

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const photoKey = typeof body.photoKey === "string" ? body.photoKey.trim() : "";
  if (!photoKey) return fail("photoKey 必填", 400);

  const photos = safeJsonArray(pet.photos);
  if (!photos.includes(photoKey)) {
    return fail("该照片不属于此宠物", 400);
  }

  const newPhotos = photos.filter(k => k !== photoKey);
  let newCover = pet.cover_key;
  if (newCover === photoKey) {
    newCover = newPhotos.length > 0 ? newPhotos[0] : null;
  }

  // R2 同步删除对象
  try {
    await env.R2.delete(photoKey);
  } catch (err) {
    console.error("[pets/[id]/photos] R2 delete failed:", err?.message || err);
    // R2 删失败不阻塞 DB 更新
  }

  const ts = now();
  await env.DB.prepare(
    "UPDATE pets SET photos = ?, cover_key = ?, updated_at = ? WHERE id = ?"
  ).bind(JSON.stringify(newPhotos), newCover, ts, petId).run();

  const updated = await env.DB.prepare("SELECT * FROM pets WHERE id = ?").bind(petId).first();
  return json(serialize(updated));
}
