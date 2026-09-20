// POST /api/auth/login
// 登录：手机号 + 密码
//
// Body: { phone, password }
// 返回: { token, user: { id, phone, nickname, role, isOwner, isHost, hostStatus }, expiresIn }
//
// 简单 rate-limit：同 IP 15 分钟最多 20 次失败尝试（成功尝试不计入）
// 用内存 Map（每个 Worker 实例独立），Cloudflare 免费够用

import {
  verifyPassword,
  genToken,
} from "../../_shared/crypto.js";
import { json, fail, readJson, now } from "../../_shared/helpers.js";

// ============ 内存 rate-limit ============
const attempts = new Map(); // key -> [{t, ok}]
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAIL_ATTEMPTS = 20;

function checkRateLimit(key) {
  const now_ = Date.now();
  const list = (attempts.get(key) || []).filter(e => now_ - e.t < WINDOW_MS);
  // 只统计失败次数
  const fails = list.filter(e => !e.ok);
  if (fails.length >= MAX_FAIL_ATTEMPTS) return false;
  attempts.set(key, list);
  return true;
}

function recordAttempt(key, ok) {
  const now_ = Date.now();
  const list = (attempts.get(key) || []).filter(e => now_ - e.t < WINDOW_MS);
  list.push({ t: now_, ok });
  attempts.set(key, list);
}

function rateLimitKey(request) {
  const cf = request.cf || {};
  const ip = cf.clientIp || "unknown";
  return `login:${ip}`;
}

function isValidPhone(phone) {
  // 允许手机号 或 admin 账号（admin 用 'admin' 作为 phone 值）
  return phone === "admin" || /^1[3-9]\d{9}$/.test(phone.trim());
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 64;
}

export async function onRequestPost({ request, env }) {
  const rlKey = rateLimitKey(request);
  if (!checkRateLimit(rlKey)) {
    return fail("尝试次数过多，请 15 分钟后重试", 429);
  }

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const phone = body.phone ? String(body.phone).trim() : "";
  const password = body.password ? String(body.password) : "";

  if (!isValidPhone(phone)) {
    recordAttempt(rlKey, false);
    return fail("手机号格式不正确", 400);
  }
  if (!isValidPassword(password)) {
    recordAttempt(rlKey, false);
    return fail("密码长度需 6-64 位", 400);
  }

  // 查用户
  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE phone = ?"
  ).bind(phone).first();

  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    recordAttempt(rlKey, false);
    return fail("手机号或密码错误", 401);
  }

  // 检查是否被封禁
  if (user.banned) {
    return fail("账号已被封禁，请联系管理员", 403);
  }

  recordAttempt(rlKey, true);

  // 创建 Session（24 小时过期）
  const ts = now();
  const token = genToken(32);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, user.id, ts, expiresAt).run();

  // 顺手清理过期 session
  await env.DB.prepare(
    "DELETE FROM sessions WHERE expires_at < ?"
  ).bind(ts).run();

  return json({
    token,
    user: {
      id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      role: user.role,
      isOwner: !!user.is_owner,
      isHost: !!user.is_host,
      hostStatus: user.host_status,
      idCardVerified: !!user.id_card_verified,
      city: user.city,
    },
    expiresIn: 86400,
  });
}
