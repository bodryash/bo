/**
 * Подписки: подписаться, кто подписан, на кого подписан, кого почитать.
 */

import { notify } from "./notify.js";
import { VERIFIED, publicUser } from "./users.js";
import { DAY, fail, now } from "./util.js";
import { checkRate } from "./guard.js";

export async function follow(env, user, targetId, body, ctx) {
  if (targetId === user.id) fail(400, "На себя подписаться нельзя");
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND faculty IS NOT NULL").bind(targetId).first();
  if (!target) fail(404, "Такого человека нет");

  const on = !!body.on;
  if (on) await checkRate(env, user, "follow");
  const t = now();
  const [res, counts] = await env.DB.batch([
    on
      ? env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)").bind(user.id, targetId, t)
      : env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").bind(user.id, targetId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?").bind(targetId),
  ]);

  // «Подписался» — одно уведомление в сутки от одного человека: иначе
  // подписка-отписка туда-сюда превратилась бы в спам уведомлениями.
  if (on && res.meta.changes) {
    const recent = await env.DB.prepare(
      "SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'follow' AND actor_id = ? AND created_at > ?"
    )
      .bind(targetId, user.id, t - DAY)
      .first();
    if (!recent) ctx.waitUntil(notify(env, { kind: "follow", userId: targetId, postId: 0, actorId: user.id }));
  }
  return { following: on, followers: counts.results[0].n };
}

/** Кто подписан на человека (kind = followers) или на кого он (following). */
export async function followList(env, viewerUser, userId, kind) {
  const join = kind === "followers" ? "f.follower_id" : "f.followee_id";
  const where = kind === "followers" ? "f.followee_id" : "f.follower_id";
  const { results } = await env.DB.prepare(
    `SELECT u.*, ${VERIFIED}, EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = ? AND x.followee_id = u.id) AS am_following
     FROM follows f JOIN users u ON u.id = ${join}
     WHERE ${where} = ? ORDER BY f.created_at DESC LIMIT 200`
  )
    .bind(viewerUser.id, userId)
    .all();
  return { users: results.map((u) => ({ ...publicUser(u), following: !!u.am_following, self: u.id === viewerUser.id })) };
}

/**
 * Кого почитать: те, кто чаще пишет открыто за последний месяц, — сначала
 * со своего факультета. Себя и тех, на кого уже подписан, не предлагаем.
 */
export async function suggestions(env, viewerUser) {
  const { results } = await env.DB.prepare(
    `SELECT u.*, ${VERIFIED}, COUNT(p.id) AS n FROM users u JOIN posts p ON p.author_id = u.id
     WHERE p.anonymous = 0 AND p.hidden = 0 AND p.created_at > ? AND u.id != ?
       AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
     GROUP BY u.id ORDER BY (u.faculty = ?) DESC, n DESC LIMIT 12`
  )
    .bind(now() - 30 * DAY, viewerUser.id, viewerUser.id, viewerUser.faculty || "")
    .all();
  return { users: results.map((u) => ({ ...publicUser(u), following: false })) };
}
