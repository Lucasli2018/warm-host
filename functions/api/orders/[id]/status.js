// POST /api/orders/[id]/status — 订单状态机
// Task 10a
// body: { action: accept|start|complete|cancel|dispute }

import { json, fail, parseBody, now, requireUser } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

// 合法转换表
const TRANSITIONS = {
  pending: ["accepted", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["completed", "disputed"],
  completed: [],
  cancelled: [],
  disputed: [],
};

// action → 目标状态
const ACTION_MAP = {
  accept: "accepted",
  start: "in_progress",
  complete: "completed",
  cancel: "cancelled",
  dispute: "disputed",
};

// action → 允许的角色（'both' | 'owner' | 'host'）
const ACTION_ROLE = {
  accept: "owner",      // 主人确认接单
  start: "host",        // 寄养人开始寄养
  complete: "host",     // 寄养人完成
  cancel: "both",
  dispute: "both",
};

const TIMESTAMP_FIELD = {
  accepted: "accepted_at",
  in_progress: "started_at",
  completed: "completed_at",
  cancelled: "cancelled_at",
};

const STATE_LABEL = {
  accepted: "已确认",
  in_progress: "已交接开始寄养",
  completed: "已完成",
  cancelled: "已取消",
  disputed: "已申诉",
};

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(params.id).first();
  if (!order) return fail("订单不存在", 404);

  const isOwner = order.owner_id === user.id;
  const isHost = order.host_id === user.id;
  if (!isOwner && !isHost) return fail("无权操作该订单", 403);

  const body = await parseBody(request);
  const action = body && body.action;
  const nextStatus = ACTION_MAP[action];
  if (!nextStatus) return fail("无效操作", 400);

  // 角色约束
  const allowedRole = ACTION_ROLE[action];
  if (allowedRole === "owner" && !isOwner) return fail("仅宠物主人可执行此操作", 403);
  if (allowedRole === "host" && !isHost) return fail("仅寄养人可执行此操作", 403);

  // 状态机校验
  const allowed = TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    return fail(`当前状态「${order.status}」不可执行「${action}」`, 400);
  }

  const ts = now();
  const field = TIMESTAMP_FIELD[nextStatus];

  // disputed 等无独立时间戳的状态：不拼时间戳列，避免拼进 undefined 列名
  let update;
  if (field) {
    update = await env.DB.prepare(
      `UPDATE orders SET status = ?, updated_at = ?, ${field} = ? WHERE id = ?`
    ).bind(nextStatus, ts, ts, order.id).run();
  } else {
    update = await env.DB.prepare(
      `UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`
    ).bind(nextStatus, ts, order.id).run();
  }
  if (!update || Number(update.changes) === 0) return fail("状态更新失败", 500);

  const peerId = isOwner ? order.host_id : order.owner_id;
  const peerRole = isOwner ? "host" : "owner";

  // 同步 needs 状态
  if (nextStatus === "completed") {
    await env.DB.prepare("UPDATE needs SET status = 'filled', updated_at = ? WHERE id = ?")
      .bind(ts, order.need_id).run();
    await createNotification(env, {
      userId: order.owner_id,
      type: "order_completed",
      title: "寄养服务已完成",
      body: "服务已完成，请为本次寄养留下评价",
      link: `/my.html?tab=orders&order=${order.id}`,
    });
  } else if (nextStatus === "cancelled") {
    // pending 阶段取消 → 释放需求回 open；已确认/进行中取消 → needs 记 cancelled
    if (order.status === "pending") {
      await env.DB.prepare("UPDATE needs SET status = 'open', updated_at = ? WHERE id = ? AND status = 'matched'")
        .bind(ts, order.need_id).run();
    } else {
      await env.DB.prepare("UPDATE needs SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .bind(ts, order.need_id).run();
    }
    await createNotification(env, {
      userId: peerId,
      type: "order_cancelled",
      title: "订单已取消",
      body: `对方已取消本次寄养订单（${order.start_date} ~ ${order.end_date}）`,
      link: `/my.html?tab=orders&order=${order.id}`,
    });
  } else if (nextStatus === "accepted") {
    await createNotification(env, {
      userId: order.host_id,
      type: "order_accepted",
      title: "主人已确认订单",
      body: `主人已确认本次寄养（${order.start_date} ~ ${order.end_date}），请做好交接准备`,
      link: `/my.html?tab=orders&order=${order.id}`,
    });
  } else if (nextStatus === "in_progress") {
    await createNotification(env, {
      userId: order.owner_id,
      type: "order_started",
      title: "寄养已开始",
      body: "寄养人已确认交接并开始照看您的宠物",
      link: `/my.html?tab=orders&order=${order.id}`,
    });
  } else if (nextStatus === "disputed") {
    // 通知全部 admin
    const admins = await env.DB.prepare("SELECT id, nickname FROM users WHERE role = 'admin' AND banned = 0").all();
    const list = admins.results || admins;
    for (const a of list) {
      await createNotification(env, {
        userId: a.id,
        type: "order_disputed",
        title: "有新订单申诉",
        body: `订单 ${order.id}（${order.start_date} ~ ${order.end_date}）被申诉，需人工介入`,
        link: `/my.html?tab=orders&order=${order.id}`,
      });
    }
    await createNotification(env, {
      userId: peerId,
      type: "order_disputed",
      title: "对方已发起申诉",
      body: "订单已标记申诉，请等待管理员处理",
      link: `/my.html?tab=orders&order=${order.id}`,
    });
  }

  return json({ success: true, status: nextStatus, action, label: STATE_LABEL[nextStatus] || nextStatus });
}
