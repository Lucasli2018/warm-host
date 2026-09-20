// POST /api/orders/[id]/review — 提交评价
// Task 11
//
// body: { rating: 1-5, content?: string, tags?: string[], photos?: string[] }
// - 需登录
// - 仅 owner 或 host 可评价
// - 订单必须 status='completed'
// - 防重复：reviews.order_id UNIQUE
// - rating 必须为 1-5 整数
// - content 可选，trim 后 ≤500 字
// - tags 必须在白名单内，去重，≤6 个
// - photos 必须在白名单内且以 `<orderId>-` 开头，≤6 个
// - 聚合更新 host_profiles（仅当 reviewee 是寄养人）
// - 通知被评价者

import { json, fail, parseBody, now, requireUser } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

const TAG_WHITELIST = [
  "照顾周到", "沟通顺畅", "环境整洁", "按时接送",
  "有爱心", "经验丰富", "会拍照", "有急救知识",
];

const MAX_TAGS = 6;
const MAX_PHOTOS = 6;
const MAX_CONTENT_LEN = 500;

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const orderId = params && params.id ? String(params.id).trim() : "";
  if (!orderId) return fail("缺少订单 ID", 400);

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return fail("订单不存在", 404);

  const isOwner = order.owner_id === user.id;
  const isHost = order.host_id === user.id;
  if (!isOwner && !isHost) return fail("无权评价该订单", 403);

  if (order.status !== "completed") {
    return fail("仅已完成的订单可评价", 400);
  }

  // 防重复
  const existing = await env.DB.prepare(
    "SELECT id FROM reviews WHERE order_id = ?"
  ).bind(orderId).first();
  if (existing) return fail("该订单已评价", 400);

  const body = await parseBody(request);
  if (!body || typeof body !== "object") return fail("请求体格式错误", 400);

  // rating 校验
  const rating = body.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return fail("rating 必须为 1-5 整数", 400);
  }

  // content 校验
  let content = "";
  if (body.content !== undefined && body.content !== null) {
    if (typeof body.content !== "string") return fail("content 必须为字符串", 400);
    content = body.content.trim();
    if (content.length > MAX_CONTENT_LEN) {
      return fail(`content 最多 ${MAX_CONTENT_LEN} 字`, 400);
    }
  }

  // tags 校验
  let tags = [];
  if (body.tags !== undefined && body.tags !== null) {
    if (!Array.isArray(body.tags)) return fail("tags 必须为数组", 400);
    const seen = new Set();
    for (const t of body.tags) {
      if (typeof t !== "string") return fail("tags 元素必须为字符串", 400);
      if (!TAG_WHITELIST.includes(t)) return fail("非法标签：", 400);
      if (seen.has(t)) continue;
      seen.add(t);
      tags.push(t);
    }
    if (tags.length > MAX_TAGS) {
      return fail(`最多选择 ${MAX_TAGS} 个标签`, 400);
    }
  }

  // photos 校验
  let photos = [];
  if (body.photos !== undefined && body.photos !== null) {
    if (!Array.isArray(body.photos)) return fail("photos 必须为数组", 400);
    if (body.photos.length > MAX_PHOTOS) {
      return fail(`最多上传 ${MAX_PHOTOS} 张图片`, 400);
    }
    const prefix = `${orderId}-`;
    for (const k of body.photos) {
      if (typeof k !== "string" || k.length === 0) {
        return fail("photos 元素必须为非空字符串", 400);
      }
      if (!k.startsWith(prefix)) {
        return fail("图片必须属于本订单", 400);
      }
    }
    photos = body.photos;
  }

  const id = crypto.randomUUID();
  const ts = now();

  try {
    await env.DB.prepare(
      `INSERT INTO reviews (id, order_id, reviewer_id, reviewee_id, rating, content, tags, photos, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      orderId,
      user.id,
      isOwner ? order.host_id : order.owner_id,
      rating,
      content,
      JSON.stringify(tags),
      JSON.stringify(photos),
      ts
    ).run();
  } catch (err) {
    // 唯一冲突兜底
    if (err && /unique|constraint/i.test(err.message || "")) {
      return fail("该订单已评价", 400);
    }
    throw err;
  }

  // 聚合更新 host_profiles（仅当 reviewee 是寄养人）
  const revieweeId = isOwner ? order.host_id : order.owner_id;
  const revieweeIsHost = isOwner;
  if (revieweeIsHost) {
    const profile = await env.DB.prepare(
      "SELECT id, avg_rating, total_reviews FROM host_profiles WHERE user_id = ?"
    ).bind(revieweeId).first();
    if (profile) {
      const prevAvg = Number(profile.avg_rating) || 0;
      const prevTotal = Number(profile.total_reviews) || 0;
      const newTotal = prevTotal + 1;
      const newAvg = Math.round((prevAvg * prevTotal + rating) / newTotal * 100) / 100;
      await env.DB.prepare(
        "UPDATE host_profiles SET avg_rating = ?, total_reviews = ?, updated_at = ? WHERE id = ?"
      ).bind(newAvg, newTotal, ts, profile.id).run();
    }
  }

  // 通知被评价者
  let reviewerNickname = user.nickname;
  if (reviewerNickname && reviewerNickname.length > 12) {
    reviewerNickname = reviewerNickname.slice(0, 12);
  }
  await createNotification(env, {
    userId: revieweeId,
    type: "review",
    title: "您收到一条新评价",
    body: `${reviewerNickname || "对方"} 给了您 ${rating} 星`,
    link: "/my.html?tab=host",
  });

  return json({
    id,
    rating,
    content,
    tags,
    photos,
    createdAt: ts,
  });
}
