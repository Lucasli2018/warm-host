// POST /api/reviews/upload — 评价图片上传
// Task 11
//
// multipart/form-data, 字段名 file
// query: orderId (可选) — 若带则校验订单属于本人且 status='completed'
//
// R2 key 格式：
//   带 orderId: <orderId>-review-<ts>-<rand4>.<ext>
//   不带 orderId: <userId>-review-<ts>-<rand4>.<ext>
//
// 限制：jpg/png/webp，单张 ≤5MB
// 返回 { key, orderId }

import { json, fail, now, requireUser } from "../../_shared/helpers.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function genRand4() {
  return Math.random().toString(36).slice(2, 6);
}

export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const ctype = request.headers.get("content-type") || "";
  if (!ctype.startsWith("multipart/form-data")) {
    return fail("Content-Type 必须是 multipart/form-data", 400);
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[reviews/upload] formData error:", err?.message || err);
    return fail("表单解析失败", 400);
  }

  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
    return fail("缺少 file 字段", 400);
  }
  if (file.size > MAX_SIZE) {
    return fail(`图片过大，最大 ${MAX_SIZE / 1024 / 1024}MB`, 400);
  }
  if (!ALLOWED[file.type]) {
    return fail(`不支持的格式：${file.type}，仅支持 jpg/png/webp`, 400);
  }

  // orderId 校验（可选）
  const url = new URL(request.url);
  const orderId = (url.searchParams.get("orderId") || "").trim();
  let orderKey = null;

  if (orderId) {
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
    if (!order) return fail("订单不存在", 404);
    const isOwner = order.owner_id === user.id;
    const isHost = order.host_id === user.id;
    if (!isOwner && !isHost) return fail("该订单不属于您", 400);
    if (order.status !== "completed") return fail("仅已完成的订单可上传评价图片", 400);
    orderKey = orderId;
  }

  const ext = ALLOWED[file.type];
  const prefix = orderKey || user.id;
  const key = `${prefix}-review-${Date.now()}-${genRand4()}.${ext}`;

  const body = await file.arrayBuffer();
  try {
    await env.R2.put(key, body, { httpMetadata: { contentType: file.type } });
  } catch (err) {
    console.error("[reviews/upload] R2 upload failed:", err);
    return fail("上传失败", 500);
  }

  return json({ key, orderId: orderKey || null });
}
