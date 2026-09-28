import { LIMITS } from "../public/js/data.js";
import { notify } from "./notify.js";
import { loadPost, postQuery } from "./posts.js";
import { AUTHOR_COLUMNS, assertCanWrite, authorFromRow } from "./users.js";
import { DAY, charCount, cleanText, fail, now } from "./util.js";

const COMMENTS_PER_DAY = 150;
const MAX_COMMENTS = 500;

/**
 * Комментарии поста одним списком. Ответ ссылается на комментарий, но
 * дерево не строим: в узком окне телефона вложенность в три уровня уже
 * нечитаема, поэтому ответ показывается цитатой, как в Telegram.
 */
export const commentsQuery = (env, postId) =>
  env.DB.prepare(
    `SELECT c.*, ${AUTHOR_COLUMNS} FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.post_id = ? AND c.hidden = 0 ORDER BY c.id LIMIT ?`
  ).bind(postId, MAX_COMMENTS);

export async function listComments(env, viewerUser, postId, preloaded) {
  const post = preloaded?.post || (await loadPost(env, postId));
  const results = preloaded?.comments || (await commentsQuery(env, postId).all()).results;
  return results.map((c) => serialize(c, post, viewerUser));
}

function serialize(c, post, viewerUser) {
  const mine = c.author_id === viewerUser.id;
  return {
    id: c.id,
    author: c.anonymous ? null : authorFromRow(c),
    mod_author: c.anonymous && viewerUser.admin ? authorFromRow(c) : undefined,
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
  const text = cleanText(body.text);
  if (!text) fail(400, "Пустой комментарий");
  if (charCount(text) > LIMITS.commentText) fail(400, `Комментарий длиннее ${LIMITS.commentText} знаков`);
  const t = now();
  const replyId = body.reply_to ? Number(body.reply_to) : 0;

  // Всё, что нужно проверить, — одним пакетом: пост, лимит, на что ответ,
  // под каким номером этот человек уже писал анонимно.
  const [p, count, reply, prevAnon, maxAnon] = await env.DB.batch([
    postQuery(env, postId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE author_id = ? AND created_at > ?").bind(user.id, t - DAY),
    env.DB.prepare("SELECT id, author_id FROM comments WHERE id = ? AND post_id = ? AND hidden = 0").bind(replyId, postId),
    env.DB.prepare(
      "SELECT anon_no FROM comments WHERE post_id = ? AND author_id = ? AND anonymous = 1 AND anon_no > 0 LIMIT 1"
    ).bind(postId, user.id),
    env.DB.prepare("SELECT COALESCE(MAX(anon_no), 0) + 1 AS n FROM comments WHERE post_id = ?").bind(postId),
  ]);
  const post = p.results[0];
  if (!post || post.hidden === 2) fail(404, "Пост удалён или его не было");
  if (post.hidden) fail(403, "Пост скрыт — комментировать нельзя");
  if (count.results[0].n >= COMMENTS_PER_DAY) fail(429, "На сегодня комментариев достаточно");
  const replyTo = replyId ? reply.results[0] : null;
  if (replyId && !replyTo) fail(400, "Комментарий, на который вы отвечаете, удалён");

  const anonymous = body.anonymous ? 1 : 0;
  let anonNo = null;
  if (anonymous) {
    anonNo = post.anonymous && post.author_id === user.id ? 0 : prevAnon.results[0]?.anon_no ?? maxAnon.results[0].n;
  }

  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO comments (post_id, author_id, anonymous, anon_no, reply_to, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(postId, user.id, anonymous, anonNo, replyTo?.id ?? null, text, t),
    env.DB.prepare("UPDATE posts SET comments = comments + 1 WHERE id = ?").bind(postId),
  ]);
  const row = inserted.results[0];

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
