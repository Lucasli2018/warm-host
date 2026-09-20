// PUT /api/hosts/me/availability
// 批量替换可接单日期（全删全建）
//
// 前置:
//   - 已登录
//   - 用户是寄养人（is_host=1）
//   - host_status='active'（pending 返回 403）
//
// Body: [{ start_date, end_date, note? }, ...]
//   - start_date/end_date 格式 'YYYY-MM-DD'
//   - start_date <= end_date
//   - end_date 不超过未来 1 年
//
// 返回: { success: true, count }

import { json, fail, readJson, now, requireUser } from "../../../_shared/helpers.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(str) {
  // 严格解析 YYYY-MM-DD（构造 Date 时用 UTC 避免本地时区跨天误差）
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // 校验构造后的日期与输入一致（防止 2026-02-30 之类被静默规整）
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== mo ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

function dateToYMD(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function onRequestPut({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (!user.isHost) return fail("您尚未申请成为寄养人", 403);

  // 仅 active 状态可设置可接单日期
  const userRow = await env.DB.prepare(
    "SELECT host_status FROM users WHERE id = ?"
  ).bind(user.id).first();
  if (!userRow || userRow.host_status !== "active") {
    return fail("审核通过后可设置接单日期", 403);
  }

  // 查 host_profiles（拿 host_id）
  const profile = await env.DB.prepare(
    "SELECT id FROM host_profiles WHERE user_id = ?"
  ).bind(user.id).first();
  if (!profile) return fail("寄养人档案不存在", 404);

  const body = await readJson(request);
  if (!Array.isArray(body)) return fail("请求体必须是数组", 400);

  const ts = now();
  const maxDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const validItems = [];

  // 前置校验：任何一条不合规 → 整体 400（原子性）
  for (let i = 0; i < body.length; i++) {
    const item = body[i];
    if (!item || typeof item !== "object") {
      return fail(`第 ${i + 1} 条记录格式错误`, 400);
    }
    const sd = parseDate(item.start_date);
    const ed = parseDate(item.end_date);
    if (!DATE_RE.test(String(item.start_date || "")) || !sd) {
      return fail(`第 ${i + 1} 条 start_date 格式必须是 YYYY-MM-DD`, 400);
    }
    if (!DATE_RE.test(String(item.end_date || "")) || !ed) {
      return fail(`第 ${i + 1} 条 end_date 格式必须是 YYYY-MM-DD`, 400);
    }
    if (ed < sd) {
      return fail(`第 ${i + 1} 条 start_date 必须早于或等于 end_date`, 400);
    }
    if (ed > maxDate) {
      return fail(`第 ${i + 1} 条日期不能超过未来 1 年`, 400);
    }
    validItems.push({
      start_date: item.start_date,
      end_date: item.end_date,
      note: typeof item.note === "string" ? item.note.slice(0, 100) : "",
    });
  }

  // 全删全建
  try {
    await env.DB.prepare(
      "DELETE FROM host_availability WHERE host_id = ?"
    ).bind(profile.id).run();

    for (const item of validItems) {
      await env.DB.prepare(
        `INSERT INTO host_availability (
           id, host_id, start_date, end_date, note, active, created_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).bind(
        crypto.randomUUID(),
        profile.id,
        item.start_date,
        item.end_date,
        item.note,
        ts
      ).run();
    }
  } catch (err) {
    return fail("保存失败，请重试", 500);
  }

  return json({ success: true, count: validItems.length });
}
