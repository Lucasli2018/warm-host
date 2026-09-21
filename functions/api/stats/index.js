// GET /api/stats — 首页数据看板（公开，无需登录）
//
// 返回 6 个计数：
//   hosts       已认证寄养人（host_profiles.is_verified = 1）
//   pets        已登记宠物总数
//   needs       正在招募/已接单的寄养需求（status in ('open','matched')）
//   orders      有效订单（status != 'cancelled'）
//   reviews     评价总数
//   todayOrders 今日新建订单（按 localtime 计日）
//
// 所有查询相互独立，失败不影响其他字段（fallback 为 0），
// 便于前端在未迁移/字段缺失场景下展示 "—" 或 0。

import { json, fail } from "../../_shared/helpers.js";

async function count(db, sql) {
  try {
    const row = await db.prepare(sql).first();
    if (!row) return 0;
    const v = row.value;
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    return 0;
  }
}

export async function GET(request, env) {
  const db = env.DB;
  if (!db) return fail("database unavailable", 500);

  const [hosts, pets, needs, orders, reviews, todayOrders] = await Promise.all([
    count(db, `SELECT COUNT(*) AS value FROM host_profiles WHERE is_verified = 1`),
    count(db, `SELECT COUNT(*) AS value FROM pets`),
    count(db, `SELECT COUNT(*) AS value FROM needs WHERE status = 'open' OR status = 'matched'`),
    count(db, `SELECT COUNT(*) AS value FROM orders WHERE status != 'cancelled'`),
    count(db, `SELECT COUNT(*) AS value FROM reviews`),
    count(db, `SELECT COUNT(*) AS value FROM orders WHERE date(created_at) = date('now','localtime')`),
  ]);

  return json({
    hosts,
    pets,
    needs,
    orders,
    reviews,
    todayOrders,
    today: todayOrders, // 别名：首页看板「今日新单」历史字段名
  });
}