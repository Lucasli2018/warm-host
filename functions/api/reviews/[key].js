// GET /api/reviews/[key] — 读取评价照片
// Task 11
//
// key 格式：<orderId>-review-<ts>-<rand4>.<ext> 或 <userId>-review-<ts>-<rand4>.<ext>
//
// 鉴权：必须登录。key 必须满足以下之一：
//   1. 以 <当前用户id>-review- 开头（用户自己上传，待提交评价）
//   2. 以 <orderId>-review- 开头，且该订单属于当前用户
//   3. key 已存在于某 reviews.photos 中，且当前用户是 reviewer 或 reviewee
//
// Cache-Control: public, max-age=86400

import { json, fail, requireUser } from "../../_shared/helpers.js";

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function onRequestGet({ request, env, params }) {
  const key = params && params.key ? String(params.key).trim() : "";
  if (!key) return fail("缺少参数", 400);

  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  // 匹配 key 模式
  // 模式: <prefix>-review-<ts>-<rand4>.<ext>
  const m = /^([^/]+)-review-\d+-[a-z0-9]{4}\.(jpg|png|webp)$/i.exec(key);
  if (!m) {
    return new Response("Not Found", { status: 404 });
  }
  const prefix = m[1];

  // 1. key 以当前用户 id 开头
  if (prefix === user.id) {
    const obj = await env.R2.get(key);
    if (!obj) return new Response("Not Found", { status: 404 });
    const ct = obj.httpMetadata?.contentType || "image/jpeg";
    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": ct,
        "content-length": String(obj.size),
        "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*",
      },
    });
  }

  // 2. key 以 orderId 开头 — 校验该订单属于当前用户
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(prefix).first();
  if (order) {
    const isOwner = order.owner_id === user.id;
    const isHost = order.host_id === user.id;
    if (isOwner || isHost) {
      const obj = await env.R2.get(key);
      if (!obj) return new Response("Not Found", { status: 404 });
      const ct = obj.httpMetadata?.contentType || "image/jpeg";
      return new Response(obj.body, {
        status: 200,
        headers: {
          "content-type": ct,
          "content-length": String(obj.size),
          "cache-control": "public, max-age=86400",
          "access-control-allow-origin": "*",
        },
      });
    }
  }

  // 3. key 已存在于 reviews.photos 中，且当前用户是 reviewer 或 reviewee
  const reviewRows = await env.DB.prepare("SELECT reviewer_id, reviewee_id, photos FROM reviews").all();
  const list = reviewRows.results || reviewRows;
  for (const r of list) {
    const photos = safeJsonArray(r.photos);
    if (photos.includes(key) && (r.reviewer_id === user.id || r.reviewee_id === user.id)) {
      const obj = await env.R2.get(key);
      if (!obj) return new Response("Not Found", { status: 404 });
      const ct = obj.httpMetadata?.contentType || "image/jpeg";
      return new Response(obj.body, {
        status: 200,
        headers: {
          "content-type": ct,
          "content-length": String(obj.size),
          "cache-control": "public, max-age=86400",
          "access-control-allow-origin": "*",
        },
      });
    }
  }

  return new Response("Not Found", { status: 404 });
}
