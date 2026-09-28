/**
 * Журнал действий: правки (с текстом до правки), удаления, решения
 * модераторов, баны, галочки. Смотрят его только модераторы.
 */

import { AUTHOR_COLUMNS, authorFromRow } from "./users.js";
import { fail, now } from "./util.js";

const KINDS = {
  edit: "правка",
  delete: "удаление",
  hide: "скрыто жалобами",
  restore: "возвращено",
  ban: "бан",
  unban: "снят бан",
  verify: "галочка",
  unverify: "галочка снята",
};

export function auditStmt(env, { kind, target, actorId = null, oldText = null, note = null }) {
  return env.DB.prepare("INSERT INTO audit (kind, target, actor_id, old_text, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(
    kind,
    target,
    actorId,
    oldText,
    note,
    now()
  );
}

export const audit = (env, entry) => auditStmt(env, entry).run();

const admin = (user) => {
  if (!user.admin) fail(403, "Только для модераторов");
};

/** История поста или комментария: все версии текста и удаление. */
export async function history(env, user, target) {
  admin(user);
  if (!/^[pcu]:\d+$/.test(target || "")) fail(400, "Что именно?");
  const [type, id] = target.split(":");
  const table = type === "p" ? "posts" : type === "c" ? "comments" : null;
  const [rows, current] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.*, ${AUTHOR_COLUMNS} FROM audit a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target = ? ORDER BY a.id`
    ).bind(target),
    table ? env.DB.prepare(`SELECT text, hidden, created_at FROM ${table} WHERE id = ?`).bind(Number(id)) : env.DB.prepare("SELECT 1"),
  ]);
  return {
    current: table ? current.results[0] || null : null,
    events: rows.results.map(entry),
  };
}

function entry(r) {
  return {
    id: r.id,
    kind: r.kind,
    label: KINDS[r.kind] || r.kind,
    target: r.target,
    actor: r.a_id ? authorFromRow(r) : null,
    old_text: r.old_text,
    note: r.note,
    created_at: r.created_at,
  };
}

// Фильтры журнала: правки, удаления (и всё про жалобы), люди (баны, галочки).
const GROUPS = {
  edit: ["edit"],
  delete: ["delete", "hide", "restore"],
  people: ["ban", "unban", "verify", "unverify"],
};

/** Последние события — для экрана «Модерация → Журнал». */
export async function log(env, user, before, group) {
  admin(user);
  const where = [];
  const args = [];
  if (before) {
    where.push("a.id < ?");
    args.push(Number(before));
  }
  const kinds = GROUPS[group];
  if (kinds) {
    where.push(`a.kind IN (${kinds.map(() => "?").join(",")})`);
    args.push(...kinds);
  }
  const { results } = await env.DB.prepare(
    `SELECT a.*, ${AUTHOR_COLUMNS} FROM audit a LEFT JOIN users u ON u.id = a.actor_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY a.id DESC LIMIT 50`
  )
    .bind(...args)
    .all();

  // Тексты постов и комментариев и имена людей — отдельным пакетом по
  // номерам: так база идёт по ключу, а не перебирает таблицы.
  const ids = { p: new Set(), c: new Set(), u: new Set() };
  for (const r of results) {
    const [t, id] = r.target.split(":");
    ids[t]?.add(Number(id));
  }
  const list = (set) => [...set].map(() => "?").join(",") || "NULL";
  const [posts, comments, people] = await env.DB.batch([
    env.DB.prepare(`SELECT id, text FROM posts WHERE id IN (${list(ids.p)})`).bind(...ids.p),
    env.DB.prepare(`SELECT id, post_id, text FROM comments WHERE id IN (${list(ids.c)})`).bind(...ids.c),
    env.DB.prepare(`SELECT ${AUTHOR_COLUMNS} FROM users u WHERE u.id IN (${list(ids.u)})`).bind(...ids.u),
  ]);
  const pText = new Map(posts.results.map((r) => [r.id, r]));
  const cText = new Map(comments.results.map((r) => [r.id, r]));
  const users = new Map(people.results.map((r) => [r.a_id, authorFromRow(r)]));
  return {
    events: results.map((r) => {
      const [t, id] = r.target.split(":");
      const ref = t === "p" ? pText.get(Number(id)) : t === "c" ? cText.get(Number(id)) : null;
      return {
        ...entry(r),
        target_text: ref?.text ?? null,
        target_user: t === "u" ? users.get(Number(id)) || null : null,
        post_id: t === "p" ? Number(id) : ref?.post_id ?? null,
      };
    }),
    next: results.length === 50 ? results[results.length - 1].id : null,
  };
}
