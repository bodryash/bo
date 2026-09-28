import { displayName } from "./users.js";
import { callTelegram, clip, escapeHtml, now } from "./util.js";

// Не чаще одного сообщения от бота в пять минут: оживлённое обсуждение
// иначе превратилось бы в поток уведомлений, и бота заглушили бы целиком.
// Всё, что пропущено, видно в приложении на вкладке уведомлений.
const PUSH_COOLDOWN = 300;

/**
 * Записывает уведомление и, если человек разрешил, пишет ему в бота.
 * Лайки одного поста копятся в одной строке: «и ещё 12».
 */
export async function notify(env, { kind, userId, postId, commentId = null, actorId, anonymous = false, text = "" }) {
  try {
    const t = now();
    if (kind === "like") {
      const res = await env.DB.prepare(
        `UPDATE notifications SET count = count + 1, actor_id = ?, created_at = ?
         WHERE user_id = ? AND post_id = ? AND kind = 'like'`
      )
        .bind(actorId, t, userId, postId)
        .run();
      if (!res.meta.changes) {
        await env.DB.prepare(
          "INSERT INTO notifications (user_id, kind, post_id, actor_id, created_at) VALUES (?, 'like', ?, ?, ?)"
        )
          .bind(userId, postId, actorId, t)
          .run();
      }
      // О лайках в бота не пишем: это повод заглянуть, а не срочная новость.
      return;
    }

    await env.DB.prepare(
      `INSERT INTO notifications (user_id, kind, post_id, comment_id, actor_id, anonymous, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(userId, kind, postId, commentId, actorId, anonymous ? 1 : 0, t)
      .run();

    const [target, actor] = await Promise.all([
      env.DB.prepare("SELECT tg_id, notify, can_dm, pushed_at FROM users WHERE id = ?").bind(userId).first(),
      env.DB.prepare("SELECT first_name, last_name FROM users WHERE id = ?").bind(actorId).first(),
    ]);
    if (!target?.notify || !target.can_dm || t - target.pushed_at < PUSH_COOLDOWN) return;

    const who = anonymous ? "Аноним" : escapeHtml(displayName(actor));
    const what = kind === "reply" ? "ответил(а) на ваш комментарий" : "прокомментировал(а) ваш пост";
    const res = await callTelegram(env, "sendMessage", {
      chat_id: target.tg_id,
      parse_mode: "HTML",
      text: `💬 <b>${who}</b> ${what}:\n\n${escapeHtml(clip(text, 300))}`,
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть", web_app: { url: appUrl(env, `#/p/${postId}${commentId ? `/c${commentId}` : ""}`) } }]],
      },
      disable_notification: false,
    });

    if (res.ok) {
      await env.DB.prepare("UPDATE users SET pushed_at = ? WHERE id = ?").bind(t, userId).run();
    } else if (res.status === 403) {
      // Бот заблокирован — больше не пытаемся, пока человек не нажмёт /start.
      await env.DB.prepare("UPDATE users SET can_dm = 0 WHERE id = ?").bind(userId).run();
    }
  } catch (error) {
    console.log("notify failed", error?.stack || error);
  }
}

export function appUrl(env, hash = "") {
  return String(env.APP_URL || "").replace(/\/?$/, "/") + hash;
}

/** Уведомления для вкладки в приложении: последние 60, с началом поста. */
export async function listNotifications(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT n.*, p.text AS post_text, p.hidden AS post_hidden, p.likes AS post_likes, c.text AS comment_text,
            a.id AS a_id, a.first_name AS a_first_name, a.last_name AS a_last_name, a.photo_url AS a_photo_url
     FROM notifications n
     JOIN posts p ON p.id = n.post_id
     LEFT JOIN comments c ON c.id = n.comment_id
     LEFT JOIN users a ON a.id = n.actor_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 60`
  )
    .bind(user.id)
    .all();

  const seenBefore = user.notif_seen_at;
  user.notif_seen_at = now();
  await env.DB.prepare("UPDATE users SET notif_seen_at = ? WHERE id = ?").bind(user.notif_seen_at, user.id).run();

  return {
    items: results
      .filter((n) => n.post_hidden !== 2)
      .map((n) => ({
        id: n.id,
        kind: n.kind,
        post_id: n.post_id,
        comment_id: n.comment_id,
        // Лайк могли снять и поставить снова — счётчик уведомления это
        // посчитал бы дважды, а у поста число честное.
        count: n.kind === "like" ? Math.max(n.post_likes, 1) : n.count,
        actor: n.anonymous || !n.a_id ? null : { id: n.a_id, name: displayName({ first_name: n.a_first_name, last_name: n.a_last_name }), photo: n.a_photo_url },
        post_text: clip(n.post_text, 120),
        comment_text: n.comment_text ? clip(n.comment_text, 200) : null,
        created_at: n.created_at,
        unread: n.created_at > seenBefore,
      })),
  };
}
