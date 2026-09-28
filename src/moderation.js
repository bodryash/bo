import { REPORT_REASONS } from "../public/js/data.js";
import { removeComment } from "./comments.js";
import { appUrl } from "./notify.js";
import { displayName } from "./users.js";
import { DAY, adminIds, callTelegram, clip, escapeHtml, fail, now } from "./util.js";

// Три жалобы от разных людей — и пост прячется до решения модератора.
// Одной мало: её может оставить любой, кто просто не согласен.
const HIDE_AFTER = 3;
const REPORTS_PER_DAY = 30;
const REASON = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.name]));

export function parseTarget(value) {
  const m = /^([pc]):?(\d+)$/i.exec(String(value || "").trim());
  return m ? { type: m[1].toLowerCase(), id: Number(m[2]) } : null;
}

export async function loadTarget(env, target) {
  const table = target.type === "p" ? "posts" : "comments";
  return env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(target.id).first();
}

export async function report(env, user, body, ctx) {
  const target = parseTarget(body.target);
  if (!target) fail(400, "На что жалоба?");
  const reason = REASON[body.reason] ? body.reason : "other";
  const row = await loadTarget(env, target);
  if (!row || row.hidden === 2) fail(404, "Уже удалено");
  if (row.author_id === user.id) fail(400, "Это ваше — его можно просто удалить");

  const t = now();
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND created_at > ?")
    .bind(user.id, t - DAY)
    .first("n");
  if (today >= REPORTS_PER_DAY) fail(429, "Жалоб на сегодня достаточно — спасибо, мы разберёмся");

  const key = `${target.type}:${target.id}`;
  const res = await env.DB.prepare("INSERT OR IGNORE INTO reports (target, user_id, reason, created_at) VALUES (?, ?, ?, ?)")
    .bind(key, user.id, reason, t)
    .run();
  if (!res.meta.changes) return { ok: true, already: true };

  const table = target.type === "p" ? "posts" : "comments";
  const updated = await env.DB.prepare(`UPDATE ${table} SET reports = reports + 1 WHERE id = ? RETURNING reports, hidden`)
    .bind(target.id)
    .first();

  if (updated.hidden === 0 && updated.reports >= HIDE_AFTER) {
    await hideByReports(env, target, row);
    ctx.waitUntil(alertAdmins(env, target));
  }
  return { ok: true };
}

async function hideByReports(env, target, row) {
  if (target.type === "p") {
    await env.DB.prepare("UPDATE posts SET hidden = 1 WHERE id = ? AND hidden = 0").bind(target.id).run();
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE comments SET hidden = 1 WHERE id = ? AND hidden = 0").bind(target.id),
      env.DB.prepare("UPDATE posts SET comments = MAX(comments - 1, 0) WHERE id = ?").bind(row.post_id),
    ]);
  }
}

/** Карточка для модератора: что, кто написал (даже если анонимно), жалобы. */
export async function describeTarget(env, target) {
  const row = await loadTarget(env, target);
  if (!row) return null;
  const author = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.author_id).first();
  const { results: reasons } = await env.DB.prepare(
    "SELECT reason, COUNT(*) AS n FROM reports WHERE target = ? GROUP BY reason ORDER BY n DESC"
  )
    .bind(`${target.type}:${target.id}`)
    .all();

  const label = target.type === "p" ? `Пост p${row.id}` : `Комментарий c${row.id} к посту p${row.post_id}`;
  const state = ["виден", "скрыт жалобами", "удалён"][row.hidden] || "?";
  const who = author
    ? `<a href="tg://user?id=${author.tg_id}">${escapeHtml(displayName(author))}</a>` +
      (author.username ? ` @${escapeHtml(author.username)}` : "") +
      ` · №${author.id}` +
      (row.anonymous ? " · <i>писал анонимно</i>" : "")
    : "неизвестно";
  const complaints = reasons.length ? reasons.map((r) => `${REASON[r.reason] || r.reason} — ${r.n}`).join(", ") : "нет";

  return {
    row,
    author,
    postId: target.type === "p" ? row.id : row.post_id,
    text:
      `<b>${label}</b> · ${state}\n` +
      `Автор: ${who}\n` +
      `Жалобы: ${complaints}\n\n` +
      escapeHtml(clip(row.text, 800)),
  };
}

export function moderationButtons(env, target, postId) {
  const t = `${target.type}:${target.id}`;
  return {
    inline_keyboard: [
      [
        { text: "✅ Вернуть", callback_data: `m:ok:${t}` },
        { text: "🗑 Удалить", callback_data: `m:del:${t}` },
      ],
      [
        { text: "⛔ Удалить и бан на 7 дней", callback_data: `m:ban:${t}` },
      ],
      [{ text: "Открыть пост", web_app: { url: appUrl(env, `#/p/${postId}`) } }],
    ],
  };
}

export async function alertAdmins(env, target) {
  try {
    const card = await describeTarget(env, target);
    if (!card) return;
    for (const chatId of adminIds(env)) {
      await callTelegram(env, "sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: "🚩 Скрыто жалобами\n\n" + card.text,
        reply_markup: moderationButtons(env, target, card.postId),
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (error) {
    console.log("alertAdmins failed", error?.stack || error);
  }
}

/** Вернуть: жалобы обнуляются, чтобы те же трое не спрятали снова. */
export async function restoreTarget(env, target) {
  const row = await loadTarget(env, target);
  if (!row) return "Не найдено";
  if (row.hidden === 0) return "И так виден";
  const key = `${target.type}:${target.id}`;
  if (target.type === "p") {
    await env.DB.batch([
      env.DB.prepare("UPDATE posts SET hidden = 0, reports = 0 WHERE id = ?").bind(target.id),
      env.DB.prepare("DELETE FROM reports WHERE target = ?").bind(key),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare("UPDATE comments SET hidden = 0, reports = 0 WHERE id = ?").bind(target.id),
      env.DB.prepare("UPDATE posts SET comments = comments + 1 WHERE id = ?").bind(row.post_id),
      env.DB.prepare("DELETE FROM reports WHERE target = ?").bind(key),
    ]);
  }
  return "Возвращено";
}

export async function deleteTarget(env, target) {
  const row = await loadTarget(env, target);
  if (!row) return "Не найдено";
  if (row.hidden === 2) return "Уже удалено";
  if (target.type === "p") await env.DB.prepare("UPDATE posts SET hidden = 2 WHERE id = ?").bind(target.id).run();
  else await removeComment(env, row);
  return "Удалено";
}

/** days = 0 — навсегда. */
export async function banUser(env, userId, days, reason) {
  const until = days > 0 ? now() + days * DAY : now() + 100 * 365 * DAY;
  await env.DB.prepare("UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?")
    .bind(until, reason || null, userId)
    .run();
  return until;
}

export async function unbanUser(env, userId) {
  await env.DB.prepare("UPDATE users SET banned_until = 0, ban_reason = NULL WHERE id = ?").bind(userId).run();
}
