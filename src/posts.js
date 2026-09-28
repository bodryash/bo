import { FACULTY, LIMITS, RUBRIC } from "../public/js/data.js";
import { notify } from "./notify.js";
import { AUTHOR_COLUMNS, VERIFIED, assertCanWrite, authorFromRow, publicUser } from "./users.js";
import { DAY, charCount, cleanText, fail, now, searchKey } from "./util.js";
import { audit, auditStmt } from "./audit.js";
import { assertRate, rateQuery, sameKey, scan, strike } from "./guard.js";
import { alertAdmins } from "./moderation.js";
import { bump, dayOf, rescore } from "./battle.js";

const PAGE = 20;

// Сколько можно за сутки. Анонимных меньше: за ними не стоит имя, и спам
// под маской обходится автору дешевле всего.
const POSTS_PER_DAY = 15;
const ANON_PER_DAY = 5;

// «Горячее» считается по постам последней недели: старше — уже не новость,
// сколько бы лайков ни набрали.
const HOT_WINDOW = 7 * DAY;
const HOT_POOL = 500;
const SEARCH_DEPTH = 5000;

const POST_SELECT = `SELECT p.*, ${AUTHOR_COLUMNS} FROM posts p JOIN users u ON u.id = p.author_id`;

/**
 * Приводит строки постов к тому, что видит конкретный человек: фото,
 * свой лайк, свой голос в опросе. Автор анонимного поста не уходит из
 * воркера вообще — даже id.
 */
export async function hydrate(env, rows, viewerUser) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");

  const [media, liked, votes, myVotes] = await env.DB.batch([
    env.DB.prepare(`SELECT post_id, key, w, h FROM media WHERE post_id IN (${marks}) ORDER BY post_id, pos`).bind(
      ...ids
    ),
    env.DB.prepare(`SELECT post_id FROM likes WHERE user_id = ? AND post_id IN (${marks})`).bind(viewerUser.id, ...ids),
    env.DB.prepare(
      `SELECT post_id, option, COUNT(*) AS n FROM votes WHERE post_id IN (${marks}) GROUP BY post_id, option`
    ).bind(...ids),
    env.DB.prepare(`SELECT post_id, option FROM votes WHERE user_id = ? AND post_id IN (${marks})`).bind(
      viewerUser.id,
      ...ids
    ),
  ]);

  const mediaBy = group(media.results, (m) => ({ key: m.key, w: m.w, h: m.h }));
  const likedSet = new Set(liked.results.map((r) => r.post_id));
  const votesBy = group(votes.results, (v) => v);
  const myVote = new Map(myVotes.results.map((v) => [v.post_id, v.option]));

  return rows.map((r) => {
    let poll = null;
    if (r.poll) {
      const options = JSON.parse(r.poll);
      const counts = options.map(() => 0);
      for (const v of votesBy.get(r.id) || []) if (v.option < counts.length) counts[v.option] = v.n;
      poll = { options, counts, total: counts.reduce((a, b) => a + b, 0), mine: myVote.get(r.id) ?? null };
    }
    const mine = r.author_id === viewerUser.id;
    return {
      id: r.id,
      author: r.anonymous ? null : authorFromRow(r),
      // Модератор видит, кто стоит за анонимкой, — чтобы не хулиганили.
      // Больше никто: поле просто не попадает в ответ.
      mod_author: r.anonymous && viewerUser.admin ? authorFromRow(r) : undefined,
      anonymous: !!r.anonymous,
      mine,
      scope: r.scope,
      rubric: r.rubric,
      text: r.text,
      price: r.price,
      event_at: r.event_at,
      place: r.place,
      poll,
      closed: !!r.closed,
      edited: !!r.edited_at,
      media: mediaBy.get(r.id) || [],
      likes: r.likes,
      comments: r.comments,
      liked: likedSet.has(r.id),
      hidden: r.hidden,
      created_at: r.created_at,
      can_delete: mine || !!viewerUser.admin,
    };
  });
}

function group(rows, map) {
  const out = new Map();
  for (const row of rows) {
    if (!out.has(row.post_id)) out.set(row.post_id, []);
    out.get(row.post_id).push(map(row));
  }
  return out;
}

function resolveScope(scope, viewerUser) {
  if (scope === "msu") return "msu";
  if (!scope || scope === "fac") {
    if (!viewerUser.faculty) fail(400, "Сначала заполните профиль", "profile");
    return viewerUser.faculty;
  }
  if (!FACULTY[scope]) fail(404, "Нет такого факультета");
  return scope;
}

/**
 * Лента. Три порядка: новое (по id с курсором), горячее (счёт в памяти по
 * постам недели) и «скоро» для событий — по дате события.
 */
export async function feed(env, viewerUser, params) {
  const author = params.get("author");
  if (author) return authorFeed(env, viewerUser, Number(author), params);

  const rubric = params.get("rubric") || "";
  if (rubric && !RUBRIC[rubric]) fail(400, "Нет такой рубрики");
  const sort = params.get("sort") || "new";

  let where;
  let args;
  if (params.get("scope") === "subs") {
    // Подписки: открытые посты тех, на кого подписан, со всего МГУ.
    where = ["p.hidden = 0", "p.anonymous = 0", "p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)"];
    args = [viewerUser.id];
  } else {
    where = ["p.scope = ?", "p.hidden = 0"];
    args = [resolveScope(params.get("scope"), viewerUser)];
  }
  if (rubric) {
    where.push("p.rubric = ?");
    args.push(rubric);
  }

  if (sort === "soon") {
    // Событие остаётся в «скоро» ещё три часа после начала — оно идёт.
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    where.push("p.event_at >= ?");
    args.push(now() - 3 * 3600);
    const { results } = await env.DB.prepare(
      `${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.event_at, p.id LIMIT ? OFFSET ?`
    )
      .bind(...args, PAGE, offset)
      .all();
    return { posts: await hydrate(env, results, viewerUser), next: results.length === PAGE ? String(offset + PAGE) : null };
  }

  if (sort === "hot") {
    const offset = Math.max(0, Number(params.get("offset")) || 0);
    const t = now();
    const { results: pool } = await env.DB.prepare(
      `SELECT p.id, p.likes, p.comments, p.created_at FROM posts p
       WHERE ${where.join(" AND ")} AND p.created_at > ? ORDER BY p.id DESC LIMIT ?`
    )
      .bind(...args, t - HOT_WINDOW, HOT_POOL)
      .all();
    // Как на Hacker News: взаимодействия делятся на возраст в степени 1.5,
    // поэтому вчерашний пост с десятью лайками уступает утреннему с пятью.
    const score = (p) => (p.likes + 2 * p.comments + 1) / Math.pow((t - p.created_at) / 3600 + 2, 1.5);
    const page = pool.sort((a, b) => score(b) - score(a)).slice(offset, offset + PAGE);
    const rows = await byIds(env, page.map((p) => p.id));
    return {
      posts: await hydrate(env, rows, viewerUser),
      next: offset + PAGE < pool.length ? String(offset + PAGE) : null,
    };
  }

  const before = Number(params.get("before")) || 0;
  if (before) {
    where.push("p.id < ?");
    args.push(before);
  }
  const { results } = await env.DB.prepare(`${POST_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT ?`)
    .bind(...args, PAGE)
    .all();
  return {
    posts: await hydrate(env, results, viewerUser),
    next: results.length === PAGE ? String(results[results.length - 1].id) : null,
  };
}

async function byIds(env, ids) {
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(`${POST_SELECT} WHERE p.id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all();
  const byId = new Map(results.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** Посты человека. Свои анонимные он видит у себя, чужие — никто. */
async function authorFeed(env, viewerUser, authorId, params) {
  const self = authorId === viewerUser.id;
  const before = Number(params.get("before")) || 0;
  const { results } = await env.DB.prepare(
    `${POST_SELECT} WHERE p.author_id = ? AND p.hidden = 0 ${self ? "" : "AND p.anonymous = 0"}
     ${before ? "AND p.id < ?" : ""} ORDER BY p.id DESC LIMIT ?`
  )
    .bind(...[authorId, ...(before ? [before] : []), PAGE])
    .all();
  return {
    posts: await hydrate(env, results, viewerUser),
    next: results.length === PAGE ? String(results[results.length - 1].id) : null,
  };
}

export const postQuery = (env, id) => env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id);

export async function loadPost(env, id) {
  const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first();
  if (!row || row.hidden === 2) fail(404, "Пост удалён или его не было");
  return row;
}

export async function getPostView(env, viewerUser, id, preloaded) {
  const row = preloaded || (await postQuery(env, id).first());
  // Удалённый пост модератор открыть может — чтобы видеть, что было.
  if (!row || (row.hidden === 2 && !viewerUser.admin)) fail(404, "Пост удалён или его не было");
  // Скрытый жалобами пост видят только автор и модераторы — чтобы понимать,
  // что с ним случилось.
  if (row.hidden === 1 && row.author_id !== viewerUser.id && !viewerUser.admin) {
    fail(404, "Пост скрыт по жалобам и ждёт модератора");
  }
  const [post] = await hydrate(env, [row], viewerUser);
  if (row.hidden && viewerUser.admin) post.removal = await removalInfo(env, `p:${id}`);
  return post;
}

/** Кто и когда удалил или скрыл — для модератора. */
export async function removalInfo(env, target) {
  const r = await env.DB.prepare(
    `SELECT a.kind, a.note, a.created_at, ${AUTHOR_COLUMNS} FROM audit a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.target = ? AND a.kind IN ('delete', 'hide') ORDER BY a.id DESC LIMIT 1`
  )
    .bind(target)
    .first();
  return r ? { kind: r.kind, note: r.note, at: r.created_at, by: r.a_id ? authorFromRow(r) : null } : { kind: "delete", note: null, at: null, by: null };
}

/**
 * Правка поста — только автором. Прежний текст уходит в журнал: модератор
 * видит всю историю, остальные — пометку «изменено».
 */
export async function editPost(env, user, id, body) {
  assertCanWrite(user);
  const row = await loadPost(env, id);
  if (row.author_id !== user.id) fail(403, "Править можно только свой пост");
  if (row.hidden) fail(403, "Пост скрыт — править нельзя");
  const text = cleanText(body.text);
  const hasMedia = await env.DB.prepare("SELECT 1 FROM media WHERE post_id = ? LIMIT 1").bind(id).first();
  if (!text && (!hasMedia || row.poll)) fail(400, "Напишите что-нибудь");
  if (charCount(text) > LIMITS.postText) fail(400, `Пост длиннее ${LIMITS.postText} знаков`);
  const flag = user.admin ? null : scan(text);
  if (flag) {
    await strike(env, user, flag, text, "правка поста");
    fail(400, `Так нельзя: похоже на ${flag.label}`);
  }
  if (text !== row.text) {
    await env.DB.batch([
      auditStmt(env, { kind: "edit", target: `p:${id}`, actorId: user.id, oldText: row.text }),
      env.DB.prepare("UPDATE posts SET text = ?, search = ?, edited_at = ? WHERE id = ?").bind(
        text,
        searchKey([text, row.place].filter(Boolean).join(" ")),
        now(),
        id
      ),
    ]);
  }
  return { post: await getPostView(env, user, id) };
}

export async function createPost(env, user, body, ctx) {
  assertCanWrite(user);

  const rubric = RUBRIC[body.rubric];
  if (!rubric) fail(400, "Выберите рубрику");
  const scope = body.scope === "msu" ? "msu" : user.faculty;
  const anonymous = rubric.anonymous || body.anonymous ? 1 : 0;

  const text = cleanText(body.text);
  const mediaKeys = Array.isArray(body.media) ? body.media.slice(0, LIMITS.photos + 1).map(String) : [];
  if (mediaKeys.length > LIMITS.photos) fail(400, `Не больше ${LIMITS.photos} фото`);
  if (!text && !mediaKeys.length) fail(400, "Напишите что-нибудь");
  if (charCount(text) > LIMITS.postText) fail(400, `Пост длиннее ${LIMITS.postText} знаков`);

  let price = null;
  if (rubric.id === "market" && body.price !== undefined && body.price !== null && body.price !== "") {
    price = Number(body.price);
    if (!Number.isInteger(price) || price < 0 || price > 10_000_000) fail(400, "Цена — целое число рублей");
  }

  let eventAt = null;
  let place = null;
  if (rubric.id === "event") {
    eventAt = Number(body.event_at);
    const t = now();
    if (!Number.isInteger(eventAt) || eventAt < t - DAY || eventAt > t + 365 * DAY) fail(400, "Укажите дату события");
    place = cleanText(body.place).replace(/\s+/g, " ") || null;
    if (place && charCount(place) > LIMITS.place) fail(400, "Место — короче, пожалуйста");
  }

  let poll = null;
  if (Array.isArray(body.poll) && body.poll.length) {
    const options = body.poll.map((o) => cleanText(o).replace(/\s+/g, " ")).filter(Boolean);
    if (options.length < 2) fail(400, "В опросе нужно хотя бы два варианта");
    if (options.length > LIMITS.pollOptions) fail(400, `В опросе не больше ${LIMITS.pollOptions} вариантов`);
    if (options.some((o) => charCount(o) > LIMITS.pollOption)) fail(400, "Вариант ответа слишком длинный");
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) fail(400, "Варианты повторяются");
    if (!text) fail(400, "Напишите вопрос для опроса");
    poll = JSON.stringify(options);
  }

  const t = now();
  // Лимиты за сутки и за последние минуты, и свои посты за сутки — чтобы
  // не опубликовать один и тот же текст дважды. Одним пакетом.
  const [day, burst, mine] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(anonymous), 0) AS anon FROM posts WHERE author_id = ? AND created_at > ?").bind(
      user.id,
      t - DAY
    ),
    rateQuery(env, "post", user.id),
    env.DB.prepare("SELECT text FROM posts WHERE author_id = ? AND created_at > ? AND hidden != 2").bind(user.id, t - DAY),
  ]);
  const recent = day.results[0];
  if (!user.admin && recent.n >= POSTS_PER_DAY) fail(429, "На сегодня постов достаточно — продолжим завтра");
  if (!user.admin && anonymous && recent.anon >= ANON_PER_DAY) fail(429, "Анонимных постов на сегодня достаточно");
  assertRate(env, user, "post", burst.results);
  const key = sameKey(text);
  if (key.length > 3 && mine.results.some((r) => sameKey(r.text) === key)) fail(409, "Такой пост у вас уже есть — повторять не нужно");

  // Подозрительное публикуется, но сразу уходит на проверку: видят только
  // автор и модераторы. Третий такой случай за сутки — автобан.
  let flag = user.admin ? null : scan([text, place, ...(poll ? JSON.parse(poll) : [])].filter(Boolean).join("\n"));

  let photoFlag = null;
  if (mediaKeys.length) {
    const marks = mediaKeys.map(() => "?").join(",");
    const [owned, flagged] = await env.DB.batch([
      env.DB.prepare(`SELECT key FROM media WHERE owner_id = ? AND post_id IS NULL AND key IN (${marks})`).bind(user.id, ...mediaKeys),
      env.DB.prepare(`SELECT key FROM media_flags WHERE key IN (${marks})`).bind(...mediaKeys),
    ]);
    if (owned.results.length !== new Set(mediaKeys).size) fail(400, "Фото не загрузились — добавьте их ещё раз");
    if (flagged.results.length) photoFlag = { id: "photo", label: "фото 18+ (нейросеть)" };
  }
  flag = flag || photoFlag;

  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO posts (author_id, anonymous, scope, rubric, text, price, event_at, place, poll, search, hidden, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).bind(user.id, anonymous, scope, rubric.id, text, price, eventAt, place, poll, searchKey([text, place].filter(Boolean).join(" ")), flag ? 1 : 0, t),
    // Очки факультету — в той же пачке. Пост на проверке очков не приносит.
    ...(flag ? [] : [bump(env, user.id, user.faculty, t, 3)]),
  ]);
  const post = inserted.results[0];

  if (flag) {
    await Promise.all([
      audit(env, { kind: "hide", target: `p:${post.id}`, note: `фильтр: ${flag.label}` }),
      strike(env, user, flag, text, "пост"),
    ]);
    ctx.waitUntil(alertAdmins(env, { type: "p", id: post.id }, `🤖 На проверке — ${flag.label}`));
  }

  if (mediaKeys.length) {
    await env.DB.batch(
      mediaKeys.map((key, pos) =>
        env.DB.prepare("UPDATE media SET post_id = ?, pos = ? WHERE key = ? AND owner_id = ?").bind(
          post.id,
          pos,
          key,
          user.id
        )
      )
    );
  }

  return { post: await getPostView(env, user, post.id), review: flag?.label || null };
}

export async function deletePost(env, user, id) {
  const row = await loadPost(env, id);
  if (row.author_id !== user.id && !user.admin) fail(403, "Удалить можно только свой пост");
  await env.DB.batch([
    env.DB.prepare("UPDATE posts SET hidden = 2 WHERE id = ?").bind(id),
    auditStmt(env, { kind: "delete", target: `p:${id}`, actorId: user.id, note: row.author_id === user.id ? "автором" : "модератором" }),
  ]);
  await rescore(env, row.author_id);
  return { ok: true };
}

/** «Продано», «нашлось», «сосед найден» — пост остаётся, но гаснет. */
export async function closePost(env, user, id, body) {
  const row = await loadPost(env, id);
  if (row.author_id !== user.id) fail(403, "Это не ваш пост");
  await env.DB.prepare("UPDATE posts SET closed = ? WHERE id = ?")
    .bind(body.closed ? 1 : 0, id)
    .run();
  return { closed: !!body.closed };
}

/**
 * Лайк — одним походом в базу: запись, пересчёт и ответ пакетом. Раньше
 * это были четыре запроса подряд, и каждый — лишняя задержка.
 */
export async function likePost(env, user, id, body, ctx) {
  const on = !!body.on;
  const t = now();
  // Очко автору — только за чужой лайк и только если лайк правда добавился
  // (changes() — число строк, изменённых предыдущим оператором пакета).
  // Снятый лайк вычитается из того дня, когда его поставили.
  const score = on
    ? env.DB.prepare(
        `INSERT INTO score (d, uid, fac, pts)
         SELECT ?, p.author_id, u.faculty, 1 FROM posts p JOIN users u ON u.id = p.author_id
         WHERE changes() = 1 AND p.id = ? AND p.hidden = 0 AND p.author_id != ? AND u.faculty IS NOT NULL
         ON CONFLICT(d, uid) DO UPDATE SET pts = pts + 1`
      ).bind(dayOf(t), id, user.id)
    : env.DB.prepare(
        `UPDATE score SET pts = pts - 1
         WHERE d = (SELECT (created_at + 10800) / 86400 FROM likes WHERE post_id = ? AND user_id = ?) -- день по Москве
           AND uid = (SELECT author_id FROM posts WHERE id = ? AND hidden = 0 AND author_id != ?)`
      ).bind(id, user.id, id, user.id);
  const write = on
    ? env.DB.prepare(
        `INSERT OR IGNORE INTO likes (post_id, user_id, created_at)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM posts WHERE id = ? AND hidden = 0)`
      ).bind(id, user.id, t, id)
    : env.DB.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").bind(id, user.id);
  const [res, , , info] = await env.DB.batch([
    on ? write : score,
    on ? score : write,
    env.DB.prepare("UPDATE posts SET likes = (SELECT COUNT(*) FROM likes WHERE post_id = ?) WHERE id = ?").bind(id, id),
    env.DB.prepare("SELECT likes, author_id, hidden FROM posts WHERE id = ?").bind(id),
  ]);
  const row = info.results[0];
  if (!row || row.hidden) fail(404, "Пост скрыт или удалён");
  if (on && res.meta.changes && row.author_id !== user.id) {
    ctx.waitUntil(notify(env, { kind: "like", userId: row.author_id, postId: id, actorId: user.id }));
  }
  return { liked: on, likes: row.likes };
}

/**
 * Голос в опросе. Можно переголосовать (другой вариант) и отменить
 * (option: null) — как в опросах Telegram с кнопкой «Отменить голос».
 * Два похода в базу: проверить опрос, затем записать и пересчитать разом.
 */
export async function votePost(env, user, id, body) {
  const row = await env.DB.prepare("SELECT poll, hidden FROM posts WHERE id = ?").bind(id).first();
  if (!row || row.hidden === 2) fail(404, "Пост удалён или его не было");
  if (!row.poll || row.hidden) fail(400, "Здесь нет опроса");
  const options = JSON.parse(row.poll);

  let write;
  if (body.option === null || body.option === undefined) {
    write = env.DB.prepare("DELETE FROM votes WHERE post_id = ? AND user_id = ?").bind(id, user.id);
  } else {
    const option = Number(body.option);
    if (!Number.isInteger(option) || option < 0 || option >= options.length) fail(400, "Нет такого варианта");
    write = env.DB.prepare(
      `INSERT INTO votes (post_id, user_id, option) VALUES (?, ?, ?)
       ON CONFLICT(post_id, user_id) DO UPDATE SET option = excluded.option`
    ).bind(id, user.id, option);
  }

  const [, counted, mine] = await env.DB.batch([
    write,
    env.DB.prepare("SELECT option, COUNT(*) AS n FROM votes WHERE post_id = ? GROUP BY option").bind(id),
    env.DB.prepare("SELECT option FROM votes WHERE post_id = ? AND user_id = ?").bind(id, user.id),
  ]);
  const counts = options.map(() => 0);
  for (const r of counted.results) if (r.option < counts.length) counts[r.option] = r.n;
  return {
    poll: {
      options,
      counts,
      total: counts.reduce((a, b) => a + b, 0),
      mine: mine.results[0]?.option ?? null,
    },
  };
}

/**
 * Поиск по постам и людям. LIKE, а не полнотекстовый индекс: на объёмах
 * одного университета это быстро, а FTS в D1 пришлось бы держать в
 * согласии с основной таблицей вручную.
 */
export async function search(env, viewerUser, q) {
  const query = searchKey(cleanText(q).replace(/^@/, "")).slice(0, 64);
  if (charCount(query) < 2) return { users: [], posts: [] };
  const like = `%${query.replace(/[%_\\]/g, (c) => "\\" + c)}%`;

  const [users, posts] = await env.DB.batch([
    env.DB.prepare(
      `SELECT u.*, ${VERIFIED} FROM users u WHERE faculty IS NOT NULL AND search LIKE ? ESCAPE '\\' ORDER BY seen_at DESC LIMIT 20`
    ).bind(like),
    // Посты — среди последних пяти тысяч: LIKE читает строки подряд, и без
    // границы редкое слово заставляло бы перебирать всю историю.
    env.DB.prepare(
      `${POST_SELECT} WHERE p.id > (SELECT MAX(id) FROM posts) - ${SEARCH_DEPTH} AND p.hidden = 0 AND p.search LIKE ? ESCAPE '\\'
       ORDER BY p.id DESC LIMIT 30`
    ).bind(like),
  ]);

  return {
    users: users.results.map(publicUser),
    posts: await hydrate(env, posts.results, viewerUser),
  };
}
