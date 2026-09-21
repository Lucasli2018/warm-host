// /api/blacklist
//   POST 举报（需登录）
//   GET  公开黑名单列表（脱敏，无需登录）
//
// POST body: { targetUserId, targetType:'owner'|'host', category, details }
//   - targetUserId 必填（用户 id）
//   - targetType 必填，'owner' 或 'host'
//   - category 必填，白名单之一
//   - details 必填，1-500 字
//
// GET query: page=1, pageSize=20 (max 50)
//   返回 status='confirmed' 且 target 用户 banned=1 的脱敏列表

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";
import { createNotification } from "../../_shared/notify.js";

// 举报类别白名单
export const BLACKLIST_CATEGORIES = [
  "人身安全问题",
  "虐待宠物",
  "私自转卖",
  "失联/放鸽子",
  "虚假资料",
  "言语骚扰",
  "其他",
];

const DETAIL_MAX = 500;

// ============ 脱敏工具 ============
// 昵称：首字 + **
export function maskNickname(name) {
  if (!name) return "";
  const s = String(name);
  return s.slice(0, 1) + "**";
}

// 手机号：后 4 位
export function maskPhone(phone) {
  if (!phone) return "";
  const p = String(phone);
  return p.length >= 4 ? p.slice(-4) : p;
}

// ============ POST 举报 ============
export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);

  const targetUserIdRaw = String(body.targetUserId ?? body.target_user_id ?? "").trim();
  const targetPhone = String(body.targetPhone ?? body.target_phone ?? "").trim();
  const targetNickname = String(body.targetNickname ?? body.target_nickname ?? "").trim();
  const targetType = String(body.targetType ?? body.target_type ?? "").trim().toLowerCase();
  const category = String(body.category ?? "").trim();
  const details = String(body.details ?? "").trim();

  // 解析目标用户：targetUserId 直接给出，或用 targetPhone/targetNickname 反查
  let targetUserId = targetUserIdRaw;
  if (!targetUserId && targetPhone) {
    if (!/^[1][3-9]\d{9}$/.test(targetPhone)) {
      return fail("手机号格式不正确", 400);
    }
    const byPhone = await env.DB.prepare(
      "SELECT id FROM users WHERE phone = ?"
    ).bind(targetPhone).first();
    if (!byPhone) return fail("该手机号未注册", 404);
    targetUserId = byPhone.id;
  } else if (!targetUserId && targetNickname) {
    const byName = await env.DB.prepare(
      "SELECT id FROM users WHERE nickname = ?"
    ).bind(targetNickname).first();
    if (!byName) return fail("该昵称未找到用户", 404);
    targetUserId = byName.id;
  }

  if (!targetUserId) return fail("缺少 targetUserId 或 targetPhone", 400);
  if (!targetType) return fail("缺少 targetType", 400);
  if (targetType !== "owner" && targetType !== "host") {
    return fail("targetType 必须是 owner 或 host", 400);
  }
  if (!category) return fail("缺少 category", 400);
  if (!BLACKLIST_CATEGORIES.includes(category)) {
    return fail("category 不在白名单内", 400);
  }
  if (!details) return fail("缺少 details", 400);
  if (details.length > DETAIL_MAX) {
    return fail(`details 最多 ${DETAIL_MAX} 字`, 400);
  }

  // 不能举报自己
  if (targetUserId === user.id) return fail("不能举报自己", 400);

  // 目标用户存在性 + admin 保护
  const target = await env.DB.prepare(
    "SELECT id, role, banned, nickname FROM users WHERE id = ?"
  ).bind(targetUserId).first();
  if (!target) return fail("目标用户不存在", 404);
  if (target.role === "admin") return fail("不能举报 admin", 400);

  // 去重：同一 reporter 对同一 target 在 pending 状态只能举报一次
  const dup = await env.DB.prepare(
    "SELECT id FROM blacklist WHERE reporter_id = ? AND target_user_id = ? AND status = 'pending'"
  ).bind(user.id, targetUserId).first();
  if (dup) return fail("您已举报过该用户，请等待处理", 400);

  const id = crypto.randomUUID();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO blacklist (id, reporter_id, target_user_id, target_type, category, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(id, user.id, targetUserId, targetType, category, details, ts).run();

  // 通知目标用户
  await createNotification(env, {
    userId: targetUserId,
    type: "blacklist_report",
    title: "收到举报",
    body: `您收到一条举报（类别：${category}）。如有异议可联系平台管理员核实。`,
    link: "/my.html?tab=host",
  });

  // 通知所有 admin
  const admins = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  for (const a of (admins.results || [])) {
    await createNotification(env, {
      userId: a.id,
      type: "blacklist_report",
      title: "新举报待处理",
      body: `有用户举报了 ${target.nickname || "某用户"}（类别：${category}）`,
      link: "/admin.html?tab=blacklist",
    });
  }

  return json({ id, status: "pending" });
}

// ============ GET 公开黑名单 ============
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSizeRaw = parseInt(url.searchParams.get("pageSize") || "20", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  let pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? pageSizeRaw : 20;
  if (pageSize > 50) pageSize = 50;
  const offset = (page - 1) * pageSize;

  // 只返回 status='confirmed' 且 target 用户 banned=1
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.category, b.status, b.created_at, b.handled_at,
            u.id AS target_user_id, u.nickname, u.phone
     FROM blacklist b
     JOIN users u ON b.target_user_id = u.id
     WHERE b.status = 'confirmed' AND u.banned = 1
     ORDER BY b.handled_at DESC, b.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(pageSize, offset).all();

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM blacklist b
     JOIN users u ON b.target_user_id = u.id
     WHERE b.status = 'confirmed' AND u.banned = 1`
  ).first();

  const items = (results || []).map(r => ({
    id: r.id,
    category: r.category,
    status: r.status,
    target: {
      userId: r.target_user_id,
      nickname: maskNickname(r.nickname),
      phone: maskPhone(r.phone),
    },
    createdAt: r.created_at,
    handledAt: r.handled_at,
  }));

  return json({ items, total: totalRow?.c || 0, page, pageSize });
}
