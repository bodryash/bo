import { LIMITS } from "../public/js/data.js";
import { notify } from "./notify.js";
import { loadPost } from "./posts.js";
import { AUTHOR_COLUMNS, assertCanWrite, authorFromRow } from "./users.js";
import { DAY, charCount, cleanText, fail, now } from "./util.js";

const COMMENTS_PER_DAY = 150;
const MAX_COMMENTS = 500;

/**
 * Комментарии поста одним списком. Ответ ссылается на комментарий, но
 * дерево не строим: в узком окне телефона вложенность в три уровня уже
 * нечитаема, поэтому ответ показывается цитатой, как в Telegram.
 */
export async function listComments(env, viewerUser, postId) {
  const post = await loadPost(env, postId);
  const { results } = await env.DB.prepare(
    `SELECT c.*, ${AUTHOR_COLUMNS} FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.post_id = ? AND c.hidden = 0 ORDER BY c.id LIMIT ?`
  )
    .bind(postId, MAX_COMMENTS)
    .all();
  return results.map((c) => serialize(c, post, viewerUser));
}

function serialize(c, post, viewerUser) {
  const mine = c.author_id === viewerUser.id;
  return {
    id: c.id,
    author: c.anonymous ? null : authorFromRow(c),
    anonymous: !!c.anonymous,
    anon_no: c.anonymous ? c.anon_no : null,
    // «Автор» у открытого поста — по совпадению, у анонимного — только если
    // человек сам остался анонимом (anon_no = 0): иначе он уже раскрылся.
    is_op: c.anonymous ? c.anon_no === 0 : !post.anonymous && c.author_id === post.author_id,
    mine,
    reply_to: c.reply_to,
    text: c.text,
    created_at: c.created_at,
    can_delete: mine || !!viewerUser.admin,
  };
}

export async function addComment(env, user, postId, body, ctx) {
  assertCanWrite(user);
  const post = await loadPost(env, postId);
  if (post.hidden) fail(403, "Пост скрыт — комментировать нельзя");

  const text = cleanText(body.text);
  if (!text) fail(400, "Пустой комментарий");
  if (charCount(text) > LIMITS.commentText) fail(400, `Комментарий длиннее ${LIMITS.commentText} знаков`);

  const t = now();
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND created_at > ?")
    .bind(user.id, t - DAY)
    .first("n");
  if (count >= COMMENTS_PER_DAY) fail(429, "На сегодня комментариев достаточно");

  let replyTo = null;
  if (body.reply_to) {
    replyTo = await env.DB.prepare("SELECT id, author_id FROM comments WHERE id = ? AND post_id = ? AND hidden = 0")
      .bind(Number(body.reply_to), postId)
      .first();
    if (!replyTo) fail(400, "Комментарий, на который вы отвечаете, удалён");
  }

  const anonymous = body.anonymous ? 1 : 0;
  let anonNo = null;
  if (anonymous) {
    if (post.anonymous && post.author_id === user.id) {
      anonNo = 0;
    } else {
      const prev = await env.DB.prepare(
        "SELECT anon_no FROM comments WHERE post_id = ? AND author_id = ? AND anonymous = 1 AND anon_no > 0 LIMIT 1"
      )
        .bind(postId, user.id)
        .first("anon_no");
      anonNo =
        prev ??
        (await env.DB.prepare("SELECT COALESCE(MAX(anon_no), 0) + 1 AS n FROM comments WHERE post_id = ?")
          .bind(postId)
          .first("n"));
    }
  }

  const row = await env.DB.prepare(
    `INSERT INTO comments (post_id, author_id, anonymous, anon_no, reply_to, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
    .bind(postId, user.id, anonymous, anonNo, replyTo?.id ?? null, text, t)
    .first();
  await env.DB.prepare("UPDATE posts SET comments = comments + 1 WHERE id = ?").bind(postId).run();

  // Автору поста — «ответ на пост», автору комментария — «ответ вам».
  // Если это один и тот же человек, хватит одного уведомления.
  const base = { postId, commentId: row.id, actorId: user.id, anonymous: !!anonymous };
  if (replyTo && replyTo.author_id !== user.id) {
    ctx.waitUntil(notify(env, { ...base, kind: "reply", userId: replyTo.author_id, text }));
  }
  if (post.author_id !== user.id && post.author_id !== replyTo?.author_id) {
    ctx.waitUntil(notify(env, { ...base, kind: "comment", userId: post.author_id, text }));
  }

  const withAuthor = { ...row, a_id: user.id, a_first_name: user.first_name, a_last_name: user.last_name,
    a_username: user.username, a_show_username: user.show_username, a_photo_url: user.photo_url,
    a_faculty: user.faculty, a_level: user.level, a_course: user.course };
  return { comment: serialize(withAuthor, post, user) };
}

export async function deleteComment(env, user, id) {
  const c = await env.DB.prepare("SELECT * FROM comments WHERE id = ?").bind(id).first();
  if (!c || c.hidden === 2) fail(404, "Комментарий уже удалён");
  if (c.author_id !== user.id && !user.admin) fail(403, "Удалить можно только свой комментарий");
  await removeComment(env, c);
  return { ok: true };
}

/** Удаление с поправкой счётчика — общее для автора, модератора и бота. */
export async function removeComment(env, c) {
  await env.DB.batch([
    env.DB.prepare("UPDATE comments SET hidden = 2 WHERE id = ?").bind(c.id),
    // Скрытый жалобами уже вычтен из счётчика — второй раз не вычитаем.
    ...(c.hidden === 0
      ? [env.DB.prepare("UPDATE posts SET comments = MAX(comments - 1, 0) WHERE id = ?").bind(c.post_id)]
      : []),
  ]);
}
