// GET /api/hosts/search — 寄养人搜索（公开，无需登录）
//
// Query:
//   from        YYYY-MM-DD（可选，与 to 一起使用表示时间匹配）
//   to          YYYY-MM-DD（可选）
//   district    区域模糊匹配
//   species     品种模糊匹配（JSON 数组元素匹配，如 "猫"）
//   size        体型模糊匹配（"小型"/"中型"/"大型"）
//   sort        rating(默认) | price | reviews
//   page        页码（默认 1，最小 1）
//   pageSize    每页条数（默认 12，最小 1，最大 50）
//
// 语义：
//   - WHERE u.host_status='active' AND u.banned=0
//   - from & to 均提供时，EXISTS (availability) 区间覆盖语义：
//       a.start_date <= from AND a.end_date >= to
//   - 无 from/to 时不筛选可接单日期（返回所有 active 寄养人）
//
// 返回：
//   { hosts: [{
//       userId, hostId, nickname, avatarKey, bio, city,
//       capacityCount, capacitySpecies[], capacitySize[], capacityGender[],
//       addressFuzzy, district, experience, specialServices[],
//       dailyRateCents, isVerified, isSponsored,
//       avgRating, totalReviews, availableDays
//     }], total, page, pageSize }

import { json, fail } from "../../_shared/helpers.js";

const SORT_BY = {
  rating:   "ORDER BY h.avg_rating DESC, h.total_reviews DESC",
  price:    "ORDER BY h.daily_rate_cents ASC, h.avg_rating DESC",
  reviews:  "ORDER BY h.total_reviews DESC, h.avg_rating DESC",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ""));
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== mo ||
    dt.getUTCDate() !== d
  ) return null;
  return dt;
}

// 计算在 [from, to] 区间内的可接单天数（对每个 availability 区间取 overlap 天数求和）
// 使用 UTC 毫秒差 +1 天偏移，避免时区问题
function calcAvailableDays(availabilityRows, fromStr, toStr) {
  const fromUTC = Date.UTC(fromStr.slice(0, 4), fromStr.slice(5, 7) - 1, fromStr.slice(8, 10));
  const toUTC = Date.UTC(toStr.slice(0, 4), toStr.slice(5, 7) - 1, toStr.slice(8, 10));
  const DAY_MS = 24 * 60 * 60 * 1000;
  let total = 0;
  for (const row of availabilityRows) {
    if (!row || !row.start_date || !row.end_date) continue;
    const sUTC = Date.UTC(row.start_date.slice(0, 4), row.start_date.slice(5, 7) - 1, row.start_date.slice(8, 10));
    const eUTC = Date.UTC(row.end_date.slice(0, 4), row.end_date.slice(5, 7) - 1, row.end_date.slice(8, 10));
    if (eUTC < sUTC) continue;
    const overlapStart = Math.max(fromUTC, sUTC);
    const overlapEnd = Math.min(toUTC, eUTC);
    if (overlapEnd >= overlapStart) {
      total += Math.floor((overlapEnd - overlapStart) / DAY_MS) + 1;
    }
  }
  return total;
}

function safeJsonArray(v) {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);

  const fromRaw = (url.searchParams.get("from") || "").trim();
  const toRaw = (url.searchParams.get("to") || "").trim();
  const district = (url.searchParams.get("district") || "").trim();
  const species = (url.searchParams.get("species") || "").trim();
  const size = (url.searchParams.get("size") || "").trim();

  let sort = (url.searchParams.get("sort") || "rating").trim().toLowerCase();
  if (!SORT_BY[sort]) sort = "rating";

  const from = fromRaw && DATE_RE.test(fromRaw) && parseDate(fromRaw) ? fromRaw : "";
  const to = toRaw && DATE_RE.test(toRaw) && parseDate(toRaw) ? toRaw : "";
  const hasDateRange = from && to;

  // 参数错误：只给了 from 或 to 之一 → 400
  if ((fromRaw && !toRaw) || (toRaw && !fromRaw)) {
    return fail("from 和 to 必须同时提供或都不提供", 400);
  }
  if (fromRaw && !DATE_RE.test(fromRaw)) return fail("from 格式必须是 YYYY-MM-DD", 400);
  if (toRaw && !DATE_RE.test(toRaw)) return fail("to 格式必须是 YYYY-MM-DD", 400);

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "12", 10) || 12));
  const offset = (page - 1) * pageSize;

  // ---------- 构建 SQL ----------
  // 先构造 WHERE 条件片段，主查询与 count 查询共用
  const whereParts = ["u.host_status = 'active'", "u.banned = 0"];
  const binds = [];

  if (hasDateRange) {
    whereParts.push(`EXISTS (SELECT 1 FROM host_availability a WHERE a.host_id = h.id AND a.active = 1 AND a.start_date <= ? AND a.end_date >= ?)`);
    binds.push(from, to);
  }
  if (district) { whereParts.push(`h.district LIKE ?`); binds.push(`%${district}%`); }
  if (species) { whereParts.push(`h.capacity_species LIKE ?`); binds.push(`%${species}%`); }
  if (size) { whereParts.push(`h.capacity_size LIKE ?`); binds.push(`%${size}%`); }

  const whereSql = " WHERE " + whereParts.join(" AND ");

  const selects = [
    "u.id AS user_id",
    "u.nickname",
    "u.avatar_key",
    "u.bio",
    "u.city",
    "h.id AS host_id",
    "h.bio AS host_bio",
    "h.capacity_count",
    "h.capacity_species",
    "h.capacity_size",
    "h.capacity_gender",
    "h.address_fuzzy",
    "h.district",
    "h.experience",
    "h.special_services",
    "h.daily_rate_cents",
    "h.is_verified",
    "h.is_sponsored",
    "h.avg_rating",
    "h.total_reviews",
  ];

  const sql = `SELECT ${selects.join(", ")} FROM host_profiles h JOIN users u ON h.user_id = u.id${whereSql} ${SORT_BY[sort]} LIMIT ? OFFSET ?`;
  const listBinds = [...binds, pageSize, offset];

  const countSql = `SELECT COUNT(*) AS cnt FROM host_profiles h JOIN users u ON h.user_id = u.id${whereSql}`;

  // ---------- 执行 count ----------
  let total = 0;
  try {
    const countResult = await env.DB.prepare(countSql).bind(...binds).first();
    total = countResult && countResult.cnt ? Number(countResult.cnt) : 0;
  } catch (e) {
    console.error("[search] count query failed:", e?.message || e, "\nSQL:", countSql, "\nBINDS:", JSON.stringify(binds));
  }

  // ---------- 执行主查询 ----------
  let results = [];
  try {
    const r = await env.DB.prepare(sql).bind(...listBinds).all();
    results = r.results || [];
  } catch (e) {
    console.error("[search] query failed:", e?.message || e, "\nSQL:", sql, "\nBINDS:", JSON.stringify(listBinds), "\nlen:", sql.length, "\nbindCount:", listBinds.length);
    return fail("查询失败: " + (e?.message || String(e)), 500);
  }

  // 计算 availableDays（仅当提供日期区间时）
  let availableDaysMap = null;
  if (hasDateRange && results.length > 0) {
    availableDaysMap = new Map();
    for (const row of results) {
      const { results: aRows } = await env.DB.prepare(
        "SELECT start_date, end_date FROM host_availability WHERE host_id = ? AND active = 1"
      ).bind(row.host_id).all();
      availableDaysMap.set(row.host_id, calcAvailableDays(aRows || [], from, to));
    }
  }

  const hosts = results.map(r => ({
    userId: r.user_id,
    hostId: r.host_id,
    nickname: r.nickname || "",
    avatarKey: r.avatar_key || null,
    bio: r.host_bio || r.bio || "",
    city: r.city || "同城",
    capacityCount: r.capacity_count ?? 1,
    capacitySpecies: safeJsonArray(r.capacity_species),
    capacitySize: safeJsonArray(r.capacity_size),
    capacityGender: safeJsonArray(r.capacity_gender),
    addressFuzzy: r.address_fuzzy || "",
    district: r.district || "",
    experience: r.experience || "",
    specialServices: safeJsonArray(r.special_services),
    dailyRateCents: r.daily_rate_cents ?? 0,
    isVerified: !!r.is_verified,
    isSponsored: !!r.is_sponsored,
    avgRating: r.avg_rating ?? 0,
    totalReviews: r.total_reviews ?? 0,
    availableDays: availableDaysMap ? (availableDaysMap.get(r.host_id) || 0) : 0,
  }));

  return json({ hosts, total, page, pageSize });
}
