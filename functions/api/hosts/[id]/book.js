// POST /api/hosts/[id]/book — 寄养人接单（下单）
// Task 10a
// 调用方必须是已审核通过的寄养人；校验需求状态/首单担保/时间覆盖/防重复接单

import { json, fail, parseBody, now, requireUser } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

const DATE_RE_OK = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(start, end) {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  if (!user.isHost) return fail("仅寄养人可接单", 403);
  if (user.hostStatus !== "active") return fail("寄养人审核通过后才可接单", 403);

  const body = await parseBody(request);
  const needId = body && body.needId;
  if (!needId) return fail("缺少 needId", 400);

  // 确认 params.id 是当前用户的寄养档案
  const hostProfile = await env.DB.prepare(
    "SELECT id, user_id, is_sponsored, capacity_count FROM host_profiles WHERE id = ?"
  ).bind(params.id).first();
  if (!hostProfile) return fail("寄养人不存在", 404);
  if (hostProfile.user_id !== user.id) return fail("无权为该寄养人接单", 403);

  // 首单担保校验
  if (!hostProfile.is_sponsored) {
    return fail("首单需要担保人，请在「我的-寄养」中邀请担保人后再接单", 400);
  }

  // 需求校验
  const need = await env.DB.prepare("SELECT * FROM needs WHERE id = ?").bind(needId).first();
  if (!need) return fail("需求不存在", 404);
  if (need.status !== "open") {
    // matched = 已有寄养人接单（并发/重复接单）→ 409；其它终态 → 400
    if (need.status === "matched") return fail("该需求已有寄养人接单", 409);
    return fail(`该需求当前状态为「${need.status}」，不可接单`, 400);
  }
  if (need.owner_id === user.id) return fail("不能接受自己发布的需求", 400);

  if (!DATE_RE_OK.test(need.start_date) || !DATE_RE_OK.test(need.end_date)) {
    return fail("需求日期格式异常", 400);
  }
  const durationDays = daysBetween(need.start_date, need.end_date);
  if (durationDays < 1) return fail("需求日期区间无效", 400);

  // 时间覆盖校验：needs 区间必须被某个 active availability 区间完整覆盖
  const coverage = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM host_availability
     WHERE host_id = ? AND active = 1 AND start_date <= ? AND end_date >= ?`
  ).bind(params.id, need.start_date, need.end_date).first();
  if (!coverage || Number(coverage.c) === 0) {
    return fail("该需求的日期不在您的可接单区间内", 400);
  }

  const ts = now();
  const orderId = crypto.randomUUID();
  const dailyRate = Number(need.expected_price_cents) || 0;
  const totalPrice = dailyRate * durationDays;

  // 原子插入防并发重复接单
  const insert = await env.DB.prepare(
    `INSERT INTO orders (id, need_id, owner_id, host_id, pet_id, start_date, end_date, duration_days, total_price_cents, status, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM orders WHERE need_id = ? AND status IN ('pending', 'accepted', 'in_progress', 'completed')
     )`
  ).bind(
    orderId, need.id, need.owner_id, user.id, need.pet_id,
    need.start_date, need.end_date, durationDays, totalPrice, ts, ts, need.id
  ).run();

  if (!insert || Number(insert.changes) === 0) {
    return fail("该需求已有寄养人接单，请刷新列表", 409);
  }

  await env.DB.prepare("UPDATE needs SET status = 'matched', updated_at = ? WHERE id = ?")
    .bind(ts, need.id).run();

  await createNotification(env, {
    userId: need.owner_id,
    type: "order_pending",
    title: "有新寄养人接单",
    body: `寄养人 ${user.nickname} 申请为您的宠物寄养服务，请尽快确认`,
    link: `/my.html?tab=orders&order=${orderId}`,
  });

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  return json({ id: order.id, status: "pending", needId: order.need_id, durationDays: order.duration_days, totalPriceCents: order.total_price_cents });
}
