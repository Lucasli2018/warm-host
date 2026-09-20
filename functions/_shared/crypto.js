// 共享加密工具：密码哈希、token 生成、邀请码
// 从 shop-booking 复制，新增 generateInviteCode + generateSalt/generateToken 别名
// 设计：
// - 密码用 HMAC-SHA256(password, salt) 保护。salt 每账户随机生成，避免彩虹表。
// - 账号密码的暴力破解防线靠 auth 端点的 rate-limit；
//   HMAC 本身提供的是"泄露 DB 后密码不被还原"的保护。
// - 会话 token 用 32 字节加密随机数，64 位 hex。
// - 邀请码用 6 位大写字母+数字（不含易混淆字符 O/0/I/1）。

export async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(password));
  return uint8ToHex(new Uint8Array(sig));
}

// 校验密码：恒定时间比较，避免时序侧信道
export async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  if (!expectedHash || actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

// 32 字节随机 hex（默认）
export function genToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}

// 16 字节随机 hex（默认）
export function genSalt(bytes = 16) {
  return genToken(bytes);
}

// 别名：generateSalt / generateToken（计划文档中使用的命名）
export const generateSalt = genSalt;
export const generateToken = genToken;

// 生成 6 位邀请码（大写字母+数字，不含易混淆字符 O/0/I/1）
export function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(arr, b => chars[b % chars.length]).join("");
}

function uint8ToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
