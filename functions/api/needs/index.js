// /api/needs
//   POST 创建需求（需登录）
//   GET  公开需求列表（无需登录），status='open'，JOIN pets + owner nickname
//
// 状态机（design.md §6.1）：
//   open → matched（寄养人接单，Task 10 处理）
//   open → cancelled（主人取消，DELETE 触发）
//   open → expired（>30 天未匹配，惰性检查）
//
// 注：使用 requireUser 直接查库，不依赖中间件注入的 request.user

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

// ============ 工具 ============

function toStr(v, max) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (max && s.length > max) return s.slice(0, max);
  return s;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  return !isNaN(d.getTime());
}

// 今天日期 'YYYY-MM-DD'（本地 Asia/Shanghai）
function todayLocal(tz = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ============ 序列化 ============

function serializeNeed(row) {
  return {
    id: row.id,
    owner_id: row.owner_id,
    pet_id: row.pet_id,
    start_date: row.start_date,
    end_date: row.end_date,
    expected_area: row.expected_area || "",
    expected_price_cents: row.expected_price_cents ?? null,
    description: row.description || "",
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pet: {
      id: row.pet_id,
      name: row.pet_name || "",
      species: row.pet_species || "",
      breed: row.pet_breed || "",
      gender: row.pet_gender || "",
      age: row.pet_age || "",
      cover_key: row.pet_cover_key || null,
    },
    owner: {
      id: row.owner_id,
      nickname: row.owner_nickname || "",
    },
  };
}

// ============ POST ============
export async function onRequestPost({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  const petId = toStr(body.petId ?? body.pet_id, 64);
  const startDate = toStr(body.startDate ?? body.start_date, 10);
  const endDate = toStr(body.endDate ?? body.end_date, 10);
  const expectedArea = toStr(body.expectedArea ?? body.expected_area, 100);
  const description = toStr(body.description, 1000);
  const expectedPriceRaw = body.expectedPriceCents ?? body.expected_price_cents;

  // 必填校验
  if (!petId) return fail("petId 为必填", 400);
  if (!startDate) return fail("startDate 为必填", 400);
  if (!endDate) return fail("endDate 为必填", 400);

  // 日期格式
  if (!isValidDate(startDate)) return fail("startDate 格式必须为 YYYY-MM-DD", 400);
  if (!isValidDate(endDate)) return fail("endDate 格式必须为 YYYY-MM-DD", 400);

  // 时间序
  if (startDate >= endDate) return fail("startDate 必须早于 endDate", 400);
  if (startDate < todayLocal()) return fail("startDate 不能早于今天", 400);

  // 日费校验（可选）
  let expectedPriceCents = null;
  if (expectedPriceRaw !== undefined && expectedPriceRaw !== null && expectedPriceRaw !== "") {
    expectedPriceCents = Number(expectedPriceRaw);
    if (!Number.isFinite(expectedPriceCents) || expectedPriceCents < 0 || !Number.isInteger(expectedPriceCents)) {
      return fail("expectedPriceCents 必须为非负整数（分）", 400);
    }
  }

  // 宠物归属校验
  const pet = await env.DB.prepare(
    "SELECT id, owner_id FROM pets WHERE id = ?"
  ).bind(petId).first();
  if (!pet) return fail("宠物不存在", 404);
  if (pet.owner_id !== user.id) return fail("无权为该宠物发布需求", 403);

  const id = crypto.randomUUID();
  const ts = now();

  await env.DB.prepare(
    `INSERT INTO needs (id, owner_id, pet_id, start_date, end_date,
       expected_area, expected_price_cents, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).bind(
    id, user.id, petId, startDate, endDate,
    expectedArea, expectedPriceCents, description, ts, ts
  ).run();

  // 回读完整记录
  const row = await env.DB.prepare(
    `SELECT n.*,
            p.name AS pet_name, p.species AS pet_species, p.breed AS pet_breed,
            p.gender AS pet_gender, p.age AS pet_age, p.cover_key AS pet_cover_key,
            u.nickname AS owner_nickname
     FROM needs n
     JOIN pets p ON n.pet_id = p.id
     JOIN users u ON n.owner_id = u.id
     WHERE n.id = ?`
  ).bind(id).first();

  return json(serializeNeed(row));
}

// ============ GET ============
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSizeRaw = parseInt(url.searchParams.get("pageSize") || "12", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  let pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? pageSizeRaw : 12;
  if (pageSize > 50) pageSize = 50;
  const offset = (page - 1) * pageSize;

  // 惰性检查：将 open 且超过 30 天的 needs 标记为 expired
  // 使用当前时间戳字符串比较（created_at 是 ISO 字符串，SQLite 字符串比较即可）
  const cutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  })();
  await env.DB.prepare(
    "UPDATE needs SET status = 'expired', updated_at = ? WHERE status = 'open' AND created_at < ?"
  ).bind(now(), cutoff).run();

  // 只返回 open 且 owner 未 ban 的
  const { results, meta } = await env.DB.prepare(
    `SELECT n.*,
            p.name AS pet_name, p.species AS pet_species, p.breed AS pet_breed,
            p.gender AS pet_gender, p.age AS pet_age, p.cover_key AS pet_cover_key,
            u.nickname AS owner_nickname
     FROM needs n
     JOIN pets p ON n.pet_id = p.id
     JOIN users u ON n.owner_id = u.id
     WHERE n.status = 'open' AND u.banned = 0
     ORDER BY n.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...[pageSize, offset]).all();

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM needs n
     JOIN users u ON n.owner_id = u.id
     WHERE n.status = 'open' AND u.banned = 0`
  ).first();

  return json({
    needs: (results || []).map(serializeNeed),
    total: totalRow?.total || 0,
    page,
    pageSize,
  });
}
