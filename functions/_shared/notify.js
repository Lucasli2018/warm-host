// warm-host 共享通知工具
// Task 6 提前实现，Task 10/12/14 复用
//
// createNotification(env, { userId, type, title, body, link })
//   - 写入 notifications 表（read=0）
//   - crypto.randomUUID() 在 workerd 中全局可用
//   - 静默失败：通知生成不应阻塞主流程

import { now } from "./helpers.js";

export async function createNotification(env, { userId, type, title, body, link }) {
  if (!env || !env.DB || !userId || !type) return null;
  const ts = now();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, type, title, body, link, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
    ).bind(id, userId, type, title || "", body || "", link || "", ts).run();
    return id;
  } catch (err) {
    console.error("[notify] createNotification failed:", err && err.message);
    return null;
  }
}
