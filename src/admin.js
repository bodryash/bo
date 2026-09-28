/**
 * Модерация прямо в приложении — то же, что в боте, но с экрана:
 * очередь жалоб, решения, баны. Только для ADMIN_IDS.
 */

import { banUser, deleteTarget, loadTarget, parseTarget, restoreTarget, unbanUser } from "./moderation.js";
import { AUTHOR_COLUMNS, VERIFIED, authorFromRow, publicUser } from "./users.js";
import { REPORT_REASONS } from "../public/js/data.js";
import { fail, now } from "./util.js";
import { auditStmt } from "./audit.js";

const REASON = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.name]));

export function assertAdmin(user) {
  if (!user.admin) fail(403, "Только для модераторов");
}

/** Что ждёт решения: скрытое жалобами — сверху, затем всё, на что жаловались. */
export async function queue(env, user) {
  assertAdmin(user);
  const [posts, comments, reasons] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.text, p.hidden, p.reports, p.anonymous, p.created_at, ${AUTHOR_COLUMNS}
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.reports > 0 AND p.hidden != 2 ORDER BY p.hidden DESC, p.reports DESC, p.id DESC LIMIT 50`
    ),
    env.DB.prepare(
      `SELECT c.id, c.post_id, c.text, c.hidden, c.reports, c.anonymous, c.created_at, ${AUTHOR_COLUMNS}
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.reports > 0 AND c.hidden != 2 ORDER BY c.hidden DESC, c.reports DESC, c.id DESC LIMIT 50`
    ),
    env.DB.prepare("SELECT target, reason, COUNT(*) AS n FROM reports GROUP BY target, reason"),
  ]);
  const why = new Map();
  for (const r of reasons.results) {
    if (!why.has(r.target)) why.set(r.target, []);
    why.get(r.target).push(`${REASON[r.reason] || r.reason} — ${r.n}`);
  }
  const item = (type) => (r) => ({
    target: `${type}:${r.id}`,
    post_id: type === "p" ? r.id : r.post_id,
    text: r.text,
    hidden: r.hidden,
    reports: r.reports,
    anonymous: !!r.anonymous,
    author: authorFromRow(r),
    reasons: why.get(`${type}:${r.id}`) || [],
    created_at: r.created_at,
  });
  const items = [...posts.results.map(item("p")), ...comments.results.map(item("c"))].sort(
    (a, b) => b.hidden - a.hidden || b.reports - a.reports
  );
  return { items };
}

/** ok — вернуть, del — удалить, ban — удалить и забанить автора на days (0 — навсегда). */
export async function act(env, user, body) {
  assertAdmin(user);
  const target = parseTarget(body.target);
  if (!target) fail(400, "Что именно?");
  const row = await loadTarget(env, target);
  if (!row) fail(404, "Не найдено");
  let result;
  const by = { actorId: user.id, note: "модератором" };
  if (body.action === "ok") result = await restoreTarget(env, target, by);
  else if (body.action === "del") result = await deleteTarget(env, target, by);
  else if (body.action === "ban") {
    if (row.author_id === user.id) fail(400, "Себя забанить нельзя");
    result = await deleteTarget(env, target, by);
    const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
    await banUser(env, row.author_id, days, String(body.reason || "нарушение правил").slice(0, 200), { actorId: user.id });
    result += days ? `, автор забанен на ${days} дн.` : ", автор забанен навсегда";
  } else fail(400, "Нет такого действия");
  return { ok: true, result };
}

export async function banById(env, user, userId, body) {
  assertAdmin(user);
  if (userId === user.id) fail(400, "Себя забанить нельзя");
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!target) fail(404, "Такого человека нет");
  if (body.on === false) {
    await unbanUser(env, userId, { actorId: user.id });
    return { banned_until: 0 };
  }
  const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
  const until = await banUser(env, userId, days, String(body.reason || "нарушение правил").slice(0, 200), { actorId: user.id });
  return { banned_until: until };
}

/** Галочка у имени: выдать или снять. */
export async function verify(env, user, userId, body) {
  assertAdmin(user);
  const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!target) fail(404, "Такого человека нет");
  const on = body.on !== false;
  await env.DB.batch([
    on
      ? env.DB.prepare("INSERT OR IGNORE INTO verified (user_id, granted_by, created_at) VALUES (?, ?, ?)").bind(userId, user.id, now())
      : env.DB.prepare("DELETE FROM verified WHERE user_id = ?").bind(userId),
    auditStmt(env, { kind: on ? "verify" : "unverify", target: `u:${userId}`, actorId: user.id }),
  ]);
  return { verified: on };
}

export async function bans(env, user) {
  assertAdmin(user);
  const { results } = await env.DB.prepare(
    `SELECT u.*, ${VERIFIED} FROM users u WHERE banned_until > ? ORDER BY banned_until DESC LIMIT 100`
  )
    .bind(now())
    .all();
  return {
    users: results.map((u) => ({
      ...publicUser(u),
      username: u.username,
      banned_until: u.banned_until,
      forever: u.banned_until > now() + 50 * 365 * 86400,
      ban_reason: u.ban_reason,
    })),
  };
}
