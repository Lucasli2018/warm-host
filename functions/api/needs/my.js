// GET /api/needs/my
// 当前用户全部 needs（所有状态），JOIN pets + owner nickname
// 额外返回 hostId（若已 matched/filled，从 orders 表查关联的 host_id）

import { json, fail, now, requireUser } from "../../_shared/helpers.js";

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
    hostId: row.host_id || null,
  };
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  // 惰性检查：将 open 且超过 30 天的 needs 标记为 expired
  const cutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  })();
  await env.DB.prepare(
    "UPDATE needs SET status = 'expired', updated_at = ? WHERE owner_id = ? AND status = 'open' AND created_at < ?"
  ).bind(now(), user.id, cutoff).run();

  const { results } = await env.DB.prepare(
    `SELECT n.*,
            p.name AS pet_name, p.species AS pet_species, p.breed AS pet_breed,
            p.gender AS pet_gender, p.age AS pet_age, p.cover_key AS pet_cover_key,
            u.nickname AS owner_nickname,
            o.host_id AS host_id
     FROM needs n
     LEFT JOIN pets p ON n.pet_id = p.id
     LEFT JOIN users u ON n.owner_id = u.id
     LEFT JOIN orders o ON o.need_id = n.id
     WHERE n.owner_id = ?
     ORDER BY n.created_at DESC`
  ).bind(user.id).all();

  return json((results || []).map(serializeNeed));
}
