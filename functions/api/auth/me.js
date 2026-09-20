// GET /api/auth/me
// 获取当前登录用户信息
//
// 请求头：Authorization: Bearer <token>
// 返回: { user: {...} } 或 401 未登录
//
// 注：不依赖中间件注入 request.user（context 不跨层级共享），
//     改用 requireUser() 直接查库

import { json, fail, requireUser } from "../../_shared/helpers.js";

export async function onRequestGet(ctx) {
  const { request, env } = ctx;

  const user = await requireUser(request, env);
  if (!user) {
    return fail("未登录或会话已过期", 401);
  }

  return json({ user });
}
