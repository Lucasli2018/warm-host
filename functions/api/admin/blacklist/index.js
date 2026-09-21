// GET /api/admin/blacklist — 管理员查看举报列表
//
// Query:
//   status   → pending / confirmed / dismissed / all（默认 pending；all 表示不限）
//   page     → 1 起，默认 1
//   pageSize → 默认 20，上限 100
//
// 返回：
//   {
//     records: [
//       { id, targetUserId, targetType, reporterId, reporterNickname,
//         targetNickname, targetPhoneMasked, category, details,
//         status, createdAt, handledAt, handledByNickname }
//     ],
//     total, page, pageSize, pendingCount
//   }
//
// 权限：admin
// 脱敏：target 手机号中间打码（138****2345）；昵称完整显示（admin 可见全）

import { json, fail, requireUser } from "../../../_shared/helpers.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const VALID_STATUSES = ["pending", "confirmed", "dismissed"];

// 手机号：前 3 位 + **** + 后 4 位（11 位号码保持原长度）
function maskPhone(phone) {
  if (!phone) return "";
  const p = String(phone);
  if (p.length < 7) return p;
  return p.slice(0, 3) + "****" + p.slice(-4);
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可访问", 403);

  const url = new URL(request.url);
  const statusRaw = (url.searchParams.get("status") || "pending").trim().toLowerCase();
  const status = statusRaw === "all" ? "" : (VALID_STATUSES.includes(statusRaw) ? statusRaw : "pending");

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSizeRaw = parseInt(url.searchParams.get("pageSize") || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(pageSizeRaw) ? pageSizeRaw : DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  // 列表：按 status 过滤（可选）
  const where = status ? " WHERE b.status = ?" : "";
  const bindArgs = status ? [status, pageSize, offset] : [pageSize, offset];

  const { results } = await env.DB.prepare(
    `SELECT b.id, b.reporter_id, b.target_user_id, b.target_type,
            b.category, b.details, b.status, b.created_at,
            b.handled_at, b.handled_by,
            ur.nickname AS reporter_nickname,
            ut.nickname AS target_nickname, ut.phone AS target_phone,
            uh.nickname AS handled_by_nickname
     FROM blacklist b
     LEFT JOIN users ur ON b.reporter_id = ur.id
     LEFT JOIN users ut ON b.target_user_id = ut.id
     LEFT JOIN users uh ON b.handled_by = uh.id
     ${where}
     ORDER BY b.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...bindArgs).all();

  // 总数（按同一 status 过滤）
  const countBind = status ? [status] : [];
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM blacklist b${where}`
  ).bind(...countBind).first();
  const total = (totalRow && totalRow.c) || 0;

  // pending 数量（供 Tab 红点使用）
  const pendingRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM blacklist WHERE status = 'pending'"
  ).first();
  const pendingCount = (pendingRow && pendingRow.c) || 0;

  const records = (results || []).map(r => ({
    id: r.id,
    targetUserId: r.target_user_id,
    targetType: r.target_type,
    reporterId: r.reporter_id,
    reporterNickname: r.reporter_nickname || "",
    targetNickname: r.target_nickname || "",
    targetPhoneMasked: maskPhone(r.target_phone),
    category: r.category,
    details: r.details,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledByNickname: r.handled_by_nickname || "",
  }));

  return json({ records, total, page, pageSize, pendingCount });
}
