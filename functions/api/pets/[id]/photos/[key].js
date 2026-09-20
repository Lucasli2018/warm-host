// GET /api/pets/[id]/photos/[key]
// 公开读取宠物照片
//
// 防越权：key 必须以 <petId>-photo- 开头，且
// 存在于 pets.photos 数组或等于 cover_key
//
// Cache-Control: public, max-age=86400

import { fail } from "../../../../_shared/helpers.js";

export async function onRequestGet({ env, params }) {
  const { id, key } = params;
  if (!id || !key) return fail("缺少参数", 400);

  // 1. 校验 key 以 <petId>-photo- 开头（防跨宠物 key 读取）
  const prefix = `${id}-photo-`;
  if (!key.startsWith(prefix)) {
    return new Response("Not Found", { status: 404 });
  }

  // 2. 校验 key 属于该宠物
  const row = await env.DB.prepare(
    "SELECT cover_key, photos FROM pets WHERE id = ?"
  ).bind(id).first();
  if (!row) return new Response("Not Found", { status: 404 });

  const photos = (() => {
    if (!row.photos) return [];
    try {
      const p = JSON.parse(row.photos);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  })();

  const isCover = row.cover_key === key;
  const isInPhotos = photos.includes(key);
  if (!isCover && !isInPhotos) {
    return new Response("Not Found", { status: 404 });
  }

  // 3. 从 R2 读取
  const obj = await env.R2.get(key);
  if (!obj) return new Response("Not Found", { status: 404 });

  const contentType = obj.httpMetadata?.contentType || "image/jpeg";
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(obj.size),
      "cache-control": "public, max-age=86400",
      "access-control-allow-origin": "*",
    },
  });
}
