// POST /api/hosts/[id]/invite — 主人邀请寄养人接单
// Task 18
//
// 参数 id = host_profiles.id
// Body: { needId }
//
// 校验：
//   - 401 未登录
//   - 403 被封禁
//   - 400 缺 needId / host 不存在 / 邀请自己 / 需求状态非 open / 需求已有订单
//   - 404 host 或 need 不存在
//   - 403 need 不是本人的
//   - 429 24h 内已邀请过
//
// 副作用：写入 notifications（type='order_invite'，link='/needs.html?need=<needId>'）

import { json, fail, readJson, now, requireUser } from "../../../_shared/helpers.js";
import { createNotification } from "../../../_shared/notify.js";

const INVITE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 小时

function isoHoursAgo(hours) {
  const d = new Date(Date.now() - hours * 3600000);
  return d.toISOString();
}

export async function onRequestPost({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);
  if (user.banned) return fail("账号已被封禁", 403);

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const needId = typeof body.needId === "string" ? body.needId.trim() : "";
  if (!needId) return fail("缺少 needId", 400);

  const hostId = params && params.id ? String(params.id).trim() : "";
  if (!hostId) return fail("缺少寄养人 id", 400);

  // 查 host profile
  const hostRow = await env.DB.prepare(
    "SELECT id, user_id FROM host_profiles WHERE id = ?"
  ).bind(hostId).first();
  if (!hostRow) return fail("寄养人不存在", 404);
  const hostUserId = hostRow.user_id;

  // 不能邀请自己
  if (hostUserId === user.id) return fail("不能邀请自己接单", 400);

  // 查需求
  const need = await env.DB.prepare(
    "SELECT id, owner_id, status, pet_id, start_date, end_date FROM needs WHERE id = ?"
  ).bind(needId).first();
  if (!need) return fail("需求不存在", 404);

  // 必须是本人的需求
  if (need.owner_id !== user.id) return fail("只能邀请别人接自己发布的需求", 403);

  // 状态必须是 open
  if (need.status !== "open") {
    return fail("该需求当前状态不是「待接单」，无法邀请", 400);
  }

  // 已有订单 → 400（排除 cancelled）
  const existing = await env.DB.prepare(
    "SELECT id FROM orders WHERE need_id = ? AND status NOT IN ('cancelled')"
  ).bind(needId).first();
  if (existing) return fail("该需求已有订单，无法邀请", 400);

  // 防骚扰：同一主人对同一寄养人的同一需求，24 小时内只能邀请一次
  const cutoff = isoHoursAgo(24);
  const dupInvite = await env.DB.prepare(
    "SELECT id FROM notifications " +
    "WHERE user_id = ? AND type = 'order_invite' AND link LIKE ? AND created_at > ?"
  ).bind(hostUserId, "%need=" + needId, cutoff).first();
  if (dupInvite) return fail("24 小时内已邀请过，请耐心等待", 429);

  // 组装通知 body：查宠物名
  let petName = "宠物";
  try {
    const petRow = await env.DB.prepare("SELECT name FROM pets WHERE id = ?")
      .bind(need.pet_id).first();
    if (petRow && petRow.name) petName = petRow.name;
  } catch { /* ignore */ }

  const ts = now();
  const bodyText = `${user.nickname} 邀请您接单「${petName}」${need.start_date}~${need.end_date}`;
  await createNotification(env, {
    userId: hostUserId,
    type: "order_invite",
    title: "收到寄养邀请",
    body: bodyText,
    link: "/needs.html?need=" + needId,
  });

  return json({ success: true, invitedAt: ts });
}
