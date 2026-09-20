// GET /api/admin/users
// 用户列表（分页 + 手机号/昵称模糊搜索）
//
// Query:
//   q        → 手机号或昵称模糊匹配（可选）
//   page     → 页码，1 起，默认 1
//   pageSize → 每页条数，默认 20，上限 100
//
// 返回：
//   {
//     total, page, pageSize, pages,
//     users: [
//       { id, phone, nickname, host_status, is_host, banned, role,
//         city, created_at, order_count, pet_count }
//     ]
//   }
//
// 权限：admin

import { json, fail, requireUser } from "../../_shared/helpers.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const SELECT_FIELDS = `
  u.id, u.phone, u.nickname, u.host_status, u.is_host, u.banned,
  u.role, u.city, u.created_at,
  (SELECT COUNT(*) FROM orders o WHERE o.owner_id = u.id OR o.host_id = u.id) AS order_count,
  (SELECT COUNT(*) FROM pets p WHERE p.owner_id = u.id) AS pet_count
`;

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可访问", 403);

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSizeRaw = parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  // 构建 SQL（有搜索词 → 加 WHERE，否则直接查全表）
  const like = `%${q}%`;
  const where = q ? " WHERE u.phone LIKE ? OR u.nickname LIKE ?" : "";
  const countSql = `SELECT COUNT(*) AS c FROM users u${where}`;
  const listSql = `SELECT ${SELECT_FIELDS} FROM users u${where} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`;

  const countBind = q ? [like, like] : [];
  const listBind = q ? [like, like, pageSize, offset] : [pageSize, offset];

  const countResult = await env.DB.prepare(countSql).bind(...countBind).first();
  const total = countResult && countResult.c ? countResult.c : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const { results } = await env.DB.prepare(listSql).bind(...listBind).all();

  return json({
    total,
    page,
    pageSize,
    totalPages,
    users: results.map(r => ({
      id: r.id,
      phone: r.phone,
      nickname: r.nickname,
      hostStatus: r.host_status,
      isHost: !!r.is_host,
      banned: !!r.banned,
      role: r.role,
      city: r.city,
      createdAt: r.created_at,
      orderCount: r.order_count || 0,
      petCount: r.pet_count || 0,
    })),
  });
}
