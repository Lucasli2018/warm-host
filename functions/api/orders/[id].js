// GET /api/orders/[id] — 订单详情
// Task 10a

import { json, fail, requireUser } from "../../_shared/helpers.js";

function safeParse(s, fallback) {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function onRequestGet({ request, env, params }) {
  const user = await requireUser(request, env);
  if (!user) return fail("未登录", 401);

  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(params.id).first();
  if (!order) return fail("订单不存在", 404);

  const isOwner = order.owner_id === user.id;
  const isHost = order.host_id === user.id;
  if (!isOwner && !isHost) return fail("无权查看该订单", 403);

  const pet = await env.DB.prepare("SELECT * FROM pets WHERE id = ?").bind(order.pet_id).first();
  const hostUser = await env.DB.prepare("SELECT id, nickname, avatar_key, bio, city, emergency_contact FROM users WHERE id = ?").bind(order.host_id).first();
  const ownerUser = await env.DB.prepare("SELECT id, nickname, avatar_key, bio, city, emergency_contact FROM users WHERE id = ?").bind(order.owner_id).first();
  const hostProfile = await env.DB.prepare(
    "SELECT district, address_fuzzy, daily_rate_cents, capacity_count, capacity_species, capacity_size, is_verified, is_sponsored, avg_rating, total_reviews FROM host_profiles WHERE user_id = ?"
  ).bind(order.host_id).first();

  const review = await env.DB.prepare("SELECT * FROM reviews WHERE order_id = ?").bind(order.id).first();

  return json({
    order: {
      id: order.id,
      needId: order.need_id,
      ownerId: order.owner_id,
      hostId: order.host_id,
      petId: order.pet_id,
      status: order.status,
      startDate: order.start_date,
      endDate: order.end_date,
      durationDays: order.duration_days,
      totalPriceCents: order.total_price_cents,
      address: order.address || "",
      notes: order.notes || "",
      acceptedAt: order.accepted_at || null,
      startedAt: order.started_at || null,
      completedAt: order.completed_at || null,
      cancelledAt: order.cancelled_at || null,
      createdAt: order.created_at,
      updatedAt: order.updated_at || null,
    },
    pet: pet ? {
      id: pet.id,
      name: pet.name,
      species: pet.species,
      breed: pet.breed || "",
      gender: pet.gender || "",
      age: pet.age || "",
      weight: pet.weight || "",
      personality: safeParse(pet.personality, []),
      healthNotes: pet.health_notes || "",
      dailyHabits: pet.daily_habits || "",
      specialNeeds: pet.special_needs || "",
      coverKey: pet.cover_key || null,
      photos: safeParse(pet.photos, []),
    } : null,
    host: hostUser ? {
      id: hostUser.id,
      nickname: hostUser.nickname,
      avatarKey: hostUser.avatar_key || null,
      bio: hostUser.bio || "",
      city: hostUser.city || "",
      emergencyContact: hostUser.emergency_contact || "",
      district: (hostProfile && hostProfile.district) || "",
      addressFuzzy: (hostProfile && hostProfile.address_fuzzy) || "",
      dailyRateCents: (hostProfile && hostProfile.daily_rate_cents) || 0,
      isVerified: !!(hostProfile && hostProfile.is_verified),
      isSponsored: !!(hostProfile && hostProfile.is_sponsored),
      avgRating: (hostProfile && hostProfile.avg_rating) || 0,
      totalReviews: (hostProfile && hostProfile.total_reviews) || 0,
    } : null,
    owner: ownerUser ? {
      id: ownerUser.id,
      nickname: ownerUser.nickname,
      avatarKey: ownerUser.avatar_key || null,
      bio: ownerUser.bio || "",
      city: ownerUser.city || "",
      emergencyContact: ownerUser.emergency_contact || "",
    } : null,
    // 评价状态：reviewed=true 表示本订单已有评价（order_id UNIQUE，单向）
    review: review ? {
      id: review.id,
      rating: review.rating,
      content: review.content || "",
      tags: safeParse(review.tags, []),
      photos: safeParse(review.photos, []),
      createdAt: review.created_at,
      reviewerId: review.reviewer_id,
      revieweeId: review.reviewee_id,
    } : null,
    reviewed: !!review,
    // 待评价对象：owner 评 host，host 评 owner
    revieweeId: isOwner ? order.host_id : order.owner_id,
    canReview: order.status === "completed" && !review,
    viewerRole: isOwner ? "owner" : "host",
  });
}
