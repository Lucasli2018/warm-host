// /api/needs/[id]
//   GET    公开读
//   PUT    仅 owner；仅 open 状态可改
//   DELETE 仅 owner；open → status='cancelled'（软取消）；matched → 400
//
// 状态机（design.md §6.1）：
//   open → cancelled（主人取消，DELETE）
//   open → matched（寄养人接单，Task 10 处理）
//   open → expired（>30 天未匹配，惰性检查）
//   matched → filled（主人确认成交，创建 order，Task 10 处理）
//   matched → cancelled（Task 10 处理，此处不允许直接 DELETE matched）

import { json, fail, readJson, now, requireUser } from "../../_shared/helpers.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (!DATE_RE.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  return !isNaN(d.getTime());
}

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

function toStr(v, max) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (max && s.length > max) return s.slice(0, max);
  return s;
}

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

// 公共查询（JOIN pets + owner）
async function fetchNeed(env, id) {
  return await env.DB.prepare(
    `SELECT n.*,
            p.name AS pet_name, p.species AS pet_species, p.breed AS pet_breed,
            p.gender AS pet_gender, p.age AS pet_age, p.cover_key AS pet_cover_key,
            u.nickname AS owner_nickname,
            u.banned AS owner_banned
     FROM needs n
     LEFT JOIN pets p ON n.pet_id = p.id
     LEFT JOIN users u ON n.owner_id = u.id
     WHERE n.id = ?`
  ).bind(id).first();
}

// ============ GET ============
export async function onRequestGet({ env, params }) {
  const id = params.id;
  if (!id) return fail("缺少参数", 400);

  const row = await fetchNeed(env, id);
  if (!row) return fail("需求不存在", 404);
  if (row.owner_banned) return fail("需求不存在", 404);

  return json(serializeNeed(row));
}

// ============ PUT ============
export async function onRequestPut({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const id = params.id;
  if (!id) return fail("缺少参数", 400);

  const existing = await fetchNeed(env, id);
  if (!existing) return fail("需求不存在", 404);
  if (existing.owner_id !== user.id) return fail("无权操作此需求", 403);
  if (existing.status !== "open") {
    return fail("仅 open 状态的需求可修改", 400);
  }

  const body = await readJson(request);
  if (!body) return fail("请求体格式错误", 400);

  // 合并现有值与请求值
  let startDate = existing.start_date;
  let endDate = existing.end_date;
  let expectedArea = existing.expected_area || "";
  let description = existing.description || "";
  let expectedPriceCents = existing.expected_price_cents ?? null;

  if (body.startDate !== undefined || body.start_date !== undefined) {
    startDate = toStr(body.startDate ?? body.start_date, 10);
  }
  if (body.endDate !== undefined || body.end_date !== undefined) {
    endDate = toStr(body.endDate ?? body.end_date, 10);
  }
  if (body.expectedArea !== undefined || body.expected_area !== undefined) {
    expectedArea = toStr(body.expectedArea ?? body.expected_area, 100);
  }
  if (body.description !== undefined) {
    description = toStr(body.description, 1000);
  }
  if (body.expectedPriceCents !== undefined || body.expected_price_cents !== undefined) {
    const raw = body.expectedPriceCents ?? body.expected_price_cents;
    if (raw === null || raw === undefined || raw === "") {
      expectedPriceCents = null;
    } else {
      expectedPriceCents = Number(raw);
      if (!Number.isFinite(expectedPriceCents) || expectedPriceCents < 0 || !Number.isInteger(expectedPriceCents)) {
        return fail("expectedPriceCents 必须为非负整数（分）", 400);
      }
    }
  }

  // 日期校验（仅在改动时）
  if (!isValidDate(startDate)) return fail("startDate 格式必须为 YYYY-MM-DD", 400);
  if (!isValidDate(endDate)) return fail("endDate 格式必须为 YYYY-MM-DD", 400);
  if (startDate >= endDate) return fail("startDate 必须早于 endDate", 400);
  if (startDate < todayLocal()) return fail("startDate 不能早于今天", 400);

  const ts = now();
  await env.DB.prepare(
    `UPDATE needs SET
       start_date = ?, end_date = ?,
       expected_area = ?, expected_price_cents = ?, description = ?,
       updated_at = ?
     WHERE id = ?`
  ).bind(startDate, endDate, expectedArea, expectedPriceCents, description, ts, id).run();

  const updated = await fetchNeed(env, id);
  return json(serializeNeed(updated));
}

// ============ DELETE ============
export async function onRequestDelete({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  const id = params.id;
  if (!id) return fail("缺少参数", 400);

  const existing = await fetchNeed(env, id);
  if (!existing) return fail("需求不存在", 404);
  if (existing.owner_id !== user.id) return fail("无权操作此需求", 403);

  if (existing.status === "matched") {
    return fail("已有寄养人接单，请联系对方或走订单取消", 400);
  }
  if (existing.status === "cancelled") {
    return json({ success: true, status: "cancelled" });
  }
  if (existing.status === "filled") {
    return fail("该需求已成交，无法取消", 400);
  }
  // 其他状态（open / expired）都软取消
  const ts = now();
  await env.DB.prepare(
    "UPDATE needs SET status = 'cancelled', updated_at = ? WHERE id = ?"
  ).bind(ts, id).run();

  return json({ success: true, status: "cancelled" });
}
