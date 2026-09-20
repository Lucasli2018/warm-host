// GET /api/notifications — 通知列表
// Task 14
//
// Query: page=1, pageSize=20 (default 20, max 50, min 1)
// Response:
//   {
//     notifications: [{ id, type, title, body, link, read, createdAt }],
//     total: <int>,        // 该用户全部通知数
//     unreadCount: <int>,  // 未读数
//     page: <int>,
//     pageSize: <int>
//   }
//
// 惰性清理：删除 90 天前且已读的通知
// 错误: 401 未登录

import { json, fail, requireUser } from "../../_shared/helpers.js";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CLEANUP_DAYS = 90;

function clampInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function serialize(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title || "",
    body: row.body || "",
    link: row.link || "",
    read: !!row.read,
    createdAt: row.created_at,
  };
}

function daysAgoISO(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const url = new URL(request.url);
  const page = clampInt(url.searchParams.get("page") || DEFAULT_PAGE, 1, 1_000_000, DEFAULT_PAGE);
  const pageSize = clampInt(url.searchParams.get("pageSize") || DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  // 惰性清理：已读且 90 天前的通知
  try {
    await env.DB.prepare(
      "DELETE FROM notifications WHERE user_id = ? AND read = 1 AND created_at < ?"
    ).bind(user.id, daysAgoISO(CLEANUP_DAYS)).run();
  } catch (err) {
    console.error("[notifications] cleanup failed:", err && err.message);
  }

  // total
  const totalRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?"
  ).bind(user.id).first();
  const total = totalRow ? Number(totalRow.c || 0) : 0;

  // unreadCount
  const unreadRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0"
  ).bind(user.id).first();
  const unreadCount = unreadRow ? Number(unreadRow.c || 0) : 0;

  // 分页列表
  const { results: rows } = await env.DB.prepare(
    "SELECT id, type, title, body, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).bind(user.id, pageSize, offset).all();

  const notifications = (rows || []).map(serialize);

  return json({
    notifications,
    total,
    unreadCount,
    page,
    pageSize,
  });
}
