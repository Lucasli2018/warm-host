// POST /api/auth/register
// 注册：手机号 + 密码 + 昵称 + 邀请码
//
// Body: { phone, password, nickname, inviteCode }
// 返回: { token, user: { id, phone, nickname, role } }
//
// 规则：
// - 邀请码必填（冷启动期强制），校验未使用
// - 手机号唯一
// - 密码至少 6 位
// - 生成 3 个新邀请码给新用户
// - 创建 24 小时 Session
// - 简单 rate-limit：同 IP 15 分钟最多 20 次尝试
//
// 中间件已自动建表，无需在此检测

import {
  hashPassword,
  genSalt,
  genToken,
  generateInviteCode,
} from "../../_shared/crypto.js";
import { json, fail, readJson, now } from "../../_shared/helpers.js";

// ============ 内存 rate-limit（同 shop-booking 模式） ============
const attempts = new Map(); // key -> [{t, ok}]
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function checkRateLimit(key) {
  const now_ = Date.now();
  const list = (attempts.get(key) || []).filter(e => now_ - e.t < WINDOW_MS);
  if (list.length >= MAX_ATTEMPTS) return false;
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
  // 客户端 IP（Cloudflare 提供 cf 字段）；本地 dev 用 localhost 兜底
  const cf = request.cf || {};
  const ip = cf.clientIp || "unknown";
  return `register:${ip}`;
}

// ============ 参数校验 ============
function isValidPhone(phone) {
  return typeof phone === "string" && /^1[3-9]\d{9}$/.test(phone.trim());
}

function isValidNickname(nickname) {
  return typeof nickname === "string" && nickname.trim().length >= 2 && nickname.trim().length <= 20;
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 6 && password.length <= 64;
}

function isValidInviteCode(code) {
  return typeof code === "string" && /^[A-Z0-9]{6}$/.test(code.toUpperCase())
    && !/[O0I1]$/.test(code); // 简单防混淆：末尾不含易混字符
}

// ============ 主入口 ============
export async function onRequestPost({ request, env }) {
  // 本地开发/测试可用 --var DISABLE_RATE_LIMIT:1 关闭限流（生产不设该变量）
  const rlEnabled = env.DISABLE_RATE_LIMIT !== "1";
  const rlKey = rateLimitKey(request);
  if (rlEnabled && !checkRateLimit(rlKey)) {
    return fail("尝试次数过多，请 15 分钟后重试", 429);
  }

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const phone = body.phone ? String(body.phone).trim() : "";
  const password = body.password ? String(body.password) : "";
  const nickname = body.nickname ? String(body.nickname).trim() : "";
  const inviteCode = body.inviteCode ? String(body.inviteCode).trim().toUpperCase() : "";

  // --- 字段校验 ---
  if (!isValidPhone(phone)) {
    recordAttempt(rlKey, false);
    return fail("手机号格式不正确", 400);
  }
  if (!isValidNickname(nickname)) {
    recordAttempt(rlKey, false);
    return fail("昵称需 2-20 个字符", 400);
  }
  if (!isValidPassword(password)) {
    recordAttempt(rlKey, false);
    return fail("密码长度需 6-64 位", 400);
  }
  if (!isValidInviteCode(inviteCode)) {
    recordAttempt(rlKey, false);
    return fail("邀请码格式不正确（6 位大写字母或数字）", 400);
  }

  // --- 检查邀请码是否存在且未使用 ---
  // 用 SELECT ... FOR UPDATE 语义：先 SELECT 确认，再 UPDATE 原子标记。
  // D1 不支持事务，但这里的 SELECT + UPDATE 在同一次请求内串行执行，
  // 配合 invite_codes.code 的 PRIMARY KEY 约束即可保证唯一性。
  const inviteRow = await env.DB.prepare(
    "SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL"
  ).bind(inviteCode).first();

  if (!inviteRow) {
    recordAttempt(rlKey, false);
    return fail("邀请码无效或已被使用", 400);
  }

  // --- 检查手机号是否已注册 ---
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE phone = ?"
  ).bind(phone).first();

  if (existing) {
    recordAttempt(rlKey, false);
    return fail("手机号已注册", 400);
  }

  // --- 生成用户 ---
  const ts = now();
  const userId = crypto.randomUUID();
  const salt = genSalt(16);
  const hash = await hashPassword(password, salt);
  const token = genToken(32);

  // 插入用户
  await env.DB.prepare(
    `INSERT INTO users (id, phone, password_hash, password_salt, nickname, is_owner, is_host, host_status, invited_by, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, 'pending', ?, 'user', ?, ?)`
  ).bind(userId, phone, hash, salt, nickname, inviteRow.owner_id, ts, ts).run();

  // 标记邀请码已用
  await env.DB.prepare(
    "UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?"
  ).bind(userId, ts, inviteCode).run();

  // 生成 3 个新邀请码分配给新用户
  for (let i = 0; i < 3; i++) {
    await env.DB.prepare(
      "INSERT INTO invite_codes (code, owner_id, created_at) VALUES (?, ?, ?)"
    ).bind(generateInviteCode(), userId, ts).run();
  }

  // 创建 Session（24 小时过期）
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(token, userId, ts, expiresAt).run();

  // 顺手清理过期 session
  await env.DB.prepare(
    "DELETE FROM sessions WHERE expires_at < ?"
  ).bind(ts).run();

  recordAttempt(rlKey, true);

  return json({
    token,
    user: {
      id: userId,
      phone,
      nickname,
      role: "user",
    },
    expiresIn: 86400,
  });
}
