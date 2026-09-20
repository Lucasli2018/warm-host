// GET /api/blacklist/my — 我的举报
// 需登录
//
// 返回：
//   {
//     reported: [...],              // 我举报的（含 target 脱敏信息）
//     reportedAgainstMe: [...],     // 别人举报我的（含 reporter 脱敏信息）
//     myReportedStatus: [...]       // 我举报的每条状态（便于前端聚合展示）
//   }

import { json, fail, requireUser } from "../../_shared/helpers.js";
import { maskNickname, maskPhone } from "./index.js";

function serializeReported(r) {
  return {
    id: r.id,
    category: r.category,
    details: r.details,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    targetType: r.target_type,
    target: {
      userId: r.target_user_id,
      nickname: maskNickname(r.target_nickname),
      phone: maskPhone(r.target_phone),
    },
  };
}

function serializeReportedAgainstMe(r) {
  return {
    id: r.id,
    category: r.category,
    details: r.details,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    targetType: r.target_type,
    reporter: {
      userId: r.reporter_id,
      nickname: maskNickname(r.reporter_nickname),
      phone: maskPhone(r.reporter_phone),
    },
  };
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录或会话已过期", 401);

  // 我举报的
  const { results: reportedRows } = await env.DB.prepare(
    `SELECT b.id, b.category, b.details, b.status, b.created_at, b.handled_at,
            b.target_user_id, b.target_type,
            u.nickname AS target_nickname, u.phone AS target_phone
     FROM blacklist b
     JOIN users u ON b.target_user_id = u.id
     WHERE b.reporter_id = ?
     ORDER BY b.created_at DESC`
  ).bind(user.id).all();

  // 别人举报我的
  const { results: againstRows } = await env.DB.prepare(
    `SELECT b.id, b.category, b.details, b.status, b.created_at, b.handled_at,
            b.reporter_id, b.target_type,
            u.nickname AS reporter_nickname, u.phone AS reporter_phone
     FROM blacklist b
     JOIN users u ON b.reporter_id = u.id
     WHERE b.target_user_id = ?
     ORDER BY b.created_at DESC`
  ).bind(user.id).all();

  const reported = (reportedRows || []).map(serializeReported);
  const reportedAgainstMe = (againstRows || []).map(serializeReportedAgainstMe);

  return json({
    reported,
    reportedAgainstMe,
    myReportedStatus: reported.map(x => x.status),
  });
}
