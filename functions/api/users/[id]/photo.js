// GET /api/users/[id]/photo
// 读取用户头像（公开，无需登录）
//
// 从 users.avatar_key 取 R2 对象返回
// 无头像 / 用户不存在 / 用户被封禁 → 404
// Cache-Control: public, max-age=86400

import { fail } from "../../../_shared/helpers.js";

export async function onRequestGet({ env, params }) {
  const { id } = params;
  if (!id) return fail("缺少参数", 400);

  // banned=0 一致性：与 [id].js 公开信息接口保持相同可见性策略
  const row = await env.DB.prepare(
    "SELECT avatar_key FROM users WHERE id = ? AND banned = 0"
  ).bind(id).first();

  if (!row || !row.avatar_key) {
    return new Response("Not Found", { status: 404 });
  }

  const obj = await env.R2.get(row.avatar_key);
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
