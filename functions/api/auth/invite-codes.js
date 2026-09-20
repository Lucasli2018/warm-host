// /api/auth/invite-codes
// 我的邀请码管理
//
// GET  → 返回当前用户的邀请码列表（含已用/未用状态）
// POST → 重新生成邀请码（已用完时申请补充，有配额限制）
//
// 配额规则：每个用户最多持有 5 个未使用邀请码；已用完时 POST 补充 3 个，
//          但每日最多补充 1 次（简单防滥用）。

import { json, fail, now, requireUser } from "../../_shared/helpers.js";
import { generateInviteCode } from "../../_shared/crypto.js";

// POST /api/auth/invite-codes  body: { reason?: "refill" }
export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const userId = user.id;
  const ts = now();

  // 检查未使用邀请码数量
  const unused = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM invite_codes WHERE owner_id = ? AND used_by IS NULL"
  ).bind(userId).first();

  if (unused && unused.c >= 5) {
    return fail("你已有 5 个可用邀请码，请分享后再申请", 400);
  }

  // 每日补充配额：检查今天是否已补充
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = dayStart.toISOString();

  const todaySupply = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM invite_codes WHERE owner_id = ? AND created_at >= ?"
  ).bind(userId, todayStartIso).first();

  if (todaySupply && todaySupply.c >= 3) {
    return fail("今日已达补充上限（3 个），请明日再试", 400);
  }

  // 补充 3 个
  const codes = [];
  for (let i = 0; i < 3; i++) {
    const code = generateInviteCode();
    await env.DB.prepare(
      "INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?, ?, ?)"
    ).bind(code, userId, ts).run();
    codes.push(code);
  }

  return json({
    success: true,
    codes,
    message: "已为你补充 3 个邀请码",
  });
}

// GET /api/auth/invite-codes
// 返回当前用户的所有邀请码，附邀请者昵称（便于分享说明）
export async function onRequestGet(ctx) {
  const { request, env } = ctx;

  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const userId = user.id;

  const { results } = await env.DB.prepare(
    `SELECT ic.code, ic.used_by, ic.used_at, ic.created_at,
            u.nickname AS user_nickname
     FROM invite_codes ic
     LEFT JOIN users u ON ic.used_by = u.id
     WHERE ic.owner_id = ?
     ORDER BY ic.used_at IS NULL DESC, ic.created_at DESC`
  ).bind(userId).all();

  // 统计
  const unusedCount = results.filter(r => !r.used_by).length;
  const usedCount = results.length - unusedCount;

  return json({
    codes: results.map(r => ({
      code: r.code,
      status: r.used_by ? "used" : "unused",
      usedByNickname: r.user_nickname || null,
      usedAt: r.used_at || null,
      createdAt: r.created_at,
    })),
    total: results.length,
    unusedCount,
    usedCount,
    quota: 5,
    dailySupplyLimit: 3,
  });
}
