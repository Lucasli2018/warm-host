// POST /api/auth/logout
// 退出登录：删除当前 Session
//
// 请求头：Authorization: Bearer <token>
// 返回: { success: true }
//
// 注：未登录调用也返回 success（幂等），因为前端清 token 即可

import { json } from "../../_shared/helpers.js";

export async function onRequestPost({ request, env }) {
  // 从 request 里提取 token（支持 header 或 query）
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  // 若没有 token，也允许调用（前端只是清本地状态）
  if (token) {
    await env.DB.prepare(
      "DELETE FROM sessions WHERE token = ?"
    ).bind(token).run();
  }

  return json({ success: true });
}
