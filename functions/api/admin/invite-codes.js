// /api/admin/invite-codes
// 邀请码池管理（admin）
//
// GET  → 邀请码池统计 + 最近 50 个可用码
//   { total, used, available, recent: [{code, createdAt}] }
//
// POST body: { count: 1-100 } → 批量生成（owner_id=NULL）
//   { success: true, generated: n, codes: [...] }

import { json, fail, now, requireUser, readJson } from "../../_shared/helpers.js";
import { generateInviteCode } from "../../_shared/crypto.js";

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可访问", 403);

  const totalRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM invite_codes"
  ).first();
  const usedRow = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM invite_codes WHERE used_by IS NOT NULL"
  ).first();
  const total = totalRow && totalRow.c ? totalRow.c : 0;
  const used = usedRow && usedRow.c ? usedRow.c : 0;
  const available = total - used;

  const { results } = await env.DB.prepare(
    "SELECT code, created_at FROM invite_codes WHERE used_by IS NULL ORDER BY created_at DESC LIMIT 50"
  ).all();

  return json({
    total,
    used,
    available,
    recent: results.map(r => ({ code: r.code, createdAt: r.created_at })),
  });
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.role !== "admin") return fail("仅 admin 可操作", 403);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);
  const count = parseInt(body.count, 10);
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    return fail("count 必须是 1-100 之间的整数", 400);
  }

  const ts = now();
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code;
    let attempts = 0;
    // 重试避免主键冲突（generateInviteCode 6 位，冲突概率极低）
    do {
      code = generateInviteCode();
      attempts++;
    } while (attempts < 5 && await env.DB.prepare(
      "SELECT code FROM invite_codes WHERE code = ?"
    ).bind(code).first());
    await env.DB.prepare(
      "INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?, ?, ?)"
    ).bind(code, null, ts).run();
    codes.push(code);
  }

  return json({ success: true, generated: codes.length, codes });
}
