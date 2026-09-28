/**
 * Битва факультетов. Неделя — сезон (с понедельника 00:00 по Москве).
 * Очки факультету приносят его студенты:
 *   пост — 3, комментарий — 1, лайк от другого человека на свой пост — 1,
 *   новый участник с факультета — 5.
 * Один человек приносит не больше 30 очков в день: иначе один
 * спамер или пара друзей, лайкающих друг друга, решали бы исход. Скрытое
 * жалобами и удалённое не считается. Анонимные посты считаются, но только
 * суммой — кто их написал, отсюда не узнать.
 *
 * Очки копятся в таблице score: строка на человека и день (сырые очки,
 * потолок применяется при подсчёте). Пост, комментарий, лайк, вступление
 * прибавляют к строке сразу, в той же пачке запросов, что и само действие.
 * Удаление, скрытие, возврат, «стереть всё», смена факультета — редкие
 * события: для них очки человека за две недели пересчитываются заново
 * (rescore). Так таблица лидеров читает строки только этой недели, а не
 * все посты, комментарии и лайки за всё время.
 */

import { FACULTY } from "../public/js/data.js";
import { DAY, now as nowSec } from "./util.js";

export const POINTS = { post: 3, comment: 1, like: 1, member: 5 };
export const DAILY_CAP = 30;
const MSK = 3 * 3600;
const WEEK = 7 * DAY;
// Таблица факультетов меняется медленно: пять минут свежести хватает, а
// «Ваш вклад» считается вживую.
const CACHE_TTL = 300;
const MEMBERS_TTL = 6 * 3600;

/** Номер дня по Москве. */
export const dayOf = (t) => Math.floor((t + MSK) / DAY);

/**
 * Прибавить очки человеку за день — оператор для пакета. fac — текущий
 * факультет; нет факультета — нет и очков.
 */
export function bump(env, uid, fac, t, pts) {
  return env.DB.prepare(
    `INSERT INTO score (d, uid, fac, pts) SELECT ?, ?, ?, ? WHERE ? IS NOT NULL
     ON CONFLICT(d, uid) DO UPDATE SET pts = pts + excluded.pts, fac = excluded.fac`
  ).bind(dayOf(t), uid, fac, pts, fac);
}

/**
 * Пересчитать очки человека за эту и прошлую неделю по самим постам,
 * комментариям и лайкам. Для редких событий: удаление, скрытие, возврат.
 */
export async function rescore(env, uid) {
  if (!uid) return;
  const since = weekStart(nowSec()) - WEEK;
  const [user, posts, comments, likes] = await env.DB.batch([
    env.DB.prepare("SELECT faculty, created_at FROM users WHERE id = ?").bind(uid),
    env.DB.prepare(
      `SELECT (created_at + ${MSK}) / ${DAY} AS d, COUNT(*) AS n FROM posts
       WHERE author_id = ? AND created_at >= ? AND hidden = 0 GROUP BY d`
    ).bind(uid, since),
    env.DB.prepare(
      `SELECT (created_at + ${MSK}) / ${DAY} AS d, COUNT(*) AS n FROM comments
       WHERE author_id = ? AND created_at >= ? AND hidden = 0 GROUP BY d`
    ).bind(uid, since),
    env.DB.prepare(
      `SELECT (l.created_at + ${MSK}) / ${DAY} AS d, COUNT(*) AS n FROM posts p JOIN likes l ON l.post_id = p.id
       WHERE p.author_id = ? AND p.hidden = 0 AND l.user_id != p.author_id AND l.created_at >= ? GROUP BY d`
    ).bind(uid, since),
  ]);
  const u = user.results[0];
  const perDay = new Map();
  const add = (d, pts) => perDay.set(d, (perDay.get(d) || 0) + pts);
  for (const r of posts.results) add(r.d, POINTS.post * r.n);
  for (const r of comments.results) add(r.d, POINTS.comment * r.n);
  for (const r of likes.results) add(r.d, POINTS.like * r.n);
  if (u?.faculty && u.created_at >= since) add(dayOf(u.created_at), POINTS.member);

  const first = dayOf(since);
  const days = Array.from({ length: 15 }, (_, i) => first + i);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM score WHERE uid = ? AND d IN (${days.map(() => "?").join(",")})`).bind(uid, ...days),
    ...(u?.faculty
      ? [...perDay].map(([d, pts]) => env.DB.prepare("INSERT INTO score (d, uid, fac, pts) VALUES (?, ?, ?, ?)").bind(d, uid, u.faculty, pts))
      : []),
  ]);
}

/** Начало недели (понедельник 00:00 МСК), в которую попадает момент t. */
export function weekStart(t) {
  const days = Math.floor((t + MSK) / DAY);
  // 1 января 1970-го — четверг: при неделе с понедельника это день 3.
  const dow = (days + 3) % 7;
  return (days - dow) * DAY - MSK;
}

/**
 * Разовое заполнение score по сырым данным — при первом запуске после
 * выкладки. Пишет абсолютные значения: повторный запуск ничего не портит.
 */
async function backfill(env, start) {
  const end = start + WEEK;
  const [posts, comments, likes, joined] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.author_id AS uid, u.faculty AS fac, (p.created_at + ${MSK}) / ${DAY} AS d, COUNT(*) AS n
       FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.created_at >= ? AND p.created_at < ? AND p.hidden = 0 AND u.faculty IS NOT NULL
       GROUP BY uid, d`
    ).bind(start, end),
    env.DB.prepare(
      `SELECT c.author_id AS uid, u.faculty AS fac, (c.created_at + ${MSK}) / ${DAY} AS d, COUNT(*) AS n
       FROM comments c JOIN users u ON u.id = c.author_id
       WHERE c.created_at >= ? AND c.created_at < ? AND c.hidden = 0 AND u.faculty IS NOT NULL
       GROUP BY uid, d`
    ).bind(start, end),
    env.DB.prepare(
      `SELECT p.author_id AS uid, u.faculty AS fac, (l.created_at + ${MSK}) / ${DAY} AS d, COUNT(*) AS n
       FROM likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = p.author_id
       WHERE l.created_at >= ? AND l.created_at < ? AND l.user_id != p.author_id AND p.hidden = 0 AND u.faculty IS NOT NULL
       GROUP BY uid, d`
    ).bind(start, end),
    env.DB.prepare(
      `SELECT id AS uid, faculty AS fac, (created_at + ${MSK}) / ${DAY} AS d FROM users
       WHERE created_at >= ? AND created_at < ? AND faculty IS NOT NULL`
    ).bind(start, end),
  ]);

  // Очки человека за день — с потолком; вход в Поток идёт в счёт того же дня.
  const perDay = new Map(); // uid:d → { fac, pts }
  const add = (rows, weight, count = (r) => r.n) => {
    for (const r of rows) {
      const key = `${r.uid}:${r.d}`;
      const cur = perDay.get(key) || { uid: r.uid, fac: r.fac, pts: 0 };
      cur.pts += weight * count(r);
      perDay.set(key, cur);
    }
  };
  add(posts.results, POINTS.post);
  add(comments.results, POINTS.comment);
  add(likes.results, POINTS.like);
  add(joined.results, POINTS.member, () => 1);

  const rows = [...perDay.entries()]
    .filter(([, v]) => v.fac)
    .map(([key, v]) =>
      env.DB.prepare("INSERT INTO score (d, uid, fac, pts) VALUES (?, ?, ?, ?) ON CONFLICT(d, uid) DO UPDATE SET pts = excluded.pts, fac = excluded.fac").bind(
        Number(key.split(":")[1]),
        v.uid,
        v.fac,
        v.pts
      )
    );
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
}

async function compute(env, start) {
  const end = start + WEEK;
  const first = dayOf(start);
  const { results } = await env.DB.prepare("SELECT uid, fac, pts FROM score WHERE d >= ? AND d < ? AND pts > 0")
    .bind(first, first + 7)
    .all();
  const members = await memberCounts(env);

  // Потолок — на человека за день.
  const byFac = new Map();
  for (const { uid, fac, pts } of results) {
    if (!FACULTY[fac] || fac === "other") continue;
    const f = byFac.get(fac) || { points: 0, active: new Set() };
    f.points += Math.min(pts, DAILY_CAP);
    f.active.add(uid);
    byFac.set(fac, f);
  }
  const faculties = [...byFac.entries()]
    .map(([id, f]) => {
      const m = members[id] || f.active.size;
      return { id, points: f.points, active: f.active.size, members: m, per_member: Math.round((f.points / Math.max(m, 1)) * 10) / 10 };
    })
    .sort((a, b) => b.points - a.points || b.active - a.active);
  faculties.forEach((f, i) => (f.rank = i + 1));
  return { start, end, faculties };
}

/** Сколько людей на факультетах — меняется медленно, кэш на шесть часов. */
async function memberCounts(env) {
  return cached(env, "members", MEMBERS_TTL, async () => {
    const { results } = await env.DB.prepare("SELECT faculty AS fac, COUNT(*) AS n FROM users WHERE faculty IS NOT NULL GROUP BY faculty").all();
    return Object.fromEntries(results.map((r) => [r.fac, r.n]));
  });
}

async function cached(env, name, ttl, make, ctx) {
  // NO_CACHE — только в разработке (.dev.vars): тестам нужны свежие числа.
  const cache = typeof caches !== "undefined" && !env.NO_CACHE ? caches.default : null;
  const key = new Request(`https://potok.internal/battle/${name}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  const data = await make();
  if (cache) {
    const put = cache.put(key, new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }));
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return data;
}

/** Результаты недели — из кэша, если считали в последние минуты. */
function results(env, start, ctx) {
  const past = start + WEEK < Date.now() / 1000;
  return cached(env, `week/${start}`, past ? DAY : CACHE_TTL, () => compute(env, start), ctx);
}

/** Первый запуск после выкладки: заполнить score за эту и прошлую неделю. */
async function ensureScores(env, start) {
  const done = await env.DB.prepare("SELECT value FROM settings WHERE key = 'score_v1'").first("value");
  if (done) return;
  await backfill(env, start - WEEK);
  await backfill(env, start);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('score_v1', '1') ON CONFLICT(key) DO NOTHING").run();
}

export async function battle(env, user, ctx) {
  const now = Math.floor(Date.now() / 1000);
  const start = weekStart(now);
  await ensureScores(env, start);
  // «Ваш вклад» — вживую, семь точечных чтений по ключу (день, человек).
  const days = Array.from({ length: 7 }, (_, i) => dayOf(start) + i);
  const [week, last, mine] = await Promise.all([
    results(env, start, ctx),
    results(env, start - WEEK, ctx),
    env.DB.prepare(`SELECT COALESCE(SUM(MIN(pts, ${DAILY_CAP})), 0) AS n FROM score WHERE d IN (${days.map(() => "?").join(",")}) AND uid = ?`)
      .bind(...days, user.id)
      .first("n"),
  ]);
  const place = week.faculties.find((f) => f.id === user.faculty) || null;
  return {
    start: week.start,
    end: week.end,
    now,
    faculties: week.faculties,
    total: Object.keys(FACULTY).length - 1,
    me: { faculty: user.faculty, points: mine, rank: place?.rank || null },
    champion: last.faculties[0] ? { id: last.faculties[0].id, points: last.faculties[0].points } : null,
    rules: { ...POINTS, cap: DAILY_CAP },
  };
}
