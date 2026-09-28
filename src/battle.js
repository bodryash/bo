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
 * Считается на лету по данным недели и кэшируется на пару минут.
 */

import { FACULTY } from "../public/js/data.js";
import { DAY } from "./util.js";

export const POINTS = { post: 3, comment: 1, like: 1, member: 5 };
export const DAILY_CAP = 30;
const MSK = 3 * 3600;
const WEEK = 7 * DAY;
const CACHE_TTL = 120;

/** Начало недели (понедельник 00:00 МСК), в которую попадает момент t. */
export function weekStart(t) {
  const days = Math.floor((t + MSK) / DAY);
  // 1 января 1970-го — четверг: при неделе с понедельника это день 3.
  const dow = (days + 3) % 7;
  return (days - dow) * DAY - MSK;
}

async function compute(env, start) {
  const end = start + WEEK;
  const [posts, comments, likes, joined, members] = await env.DB.batch([
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
    env.DB.prepare("SELECT faculty AS fac, COUNT(*) AS n FROM users WHERE faculty IS NOT NULL GROUP BY faculty"),
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

  const byFac = new Map();
  const byUser = new Map();
  for (const { uid, fac, pts } of perDay.values()) {
    if (!FACULTY[fac] || fac === "other") continue;
    const capped = Math.min(pts, DAILY_CAP);
    const f = byFac.get(fac) || { points: 0, active: new Set() };
    f.points += capped;
    f.active.add(uid);
    byFac.set(fac, f);
    byUser.set(uid, (byUser.get(uid) || 0) + capped);
  }
  const memberCount = new Map(members.results.map((r) => [r.fac, r.n]));

  const faculties = [...byFac.entries()]
    .map(([id, f]) => {
      const m = memberCount.get(id) || f.active.size;
      return { id, points: f.points, active: f.active.size, members: m, per_member: Math.round((f.points / Math.max(m, 1)) * 10) / 10 };
    })
    .sort((a, b) => b.points - a.points || b.active - a.active);
  faculties.forEach((f, i) => (f.rank = i + 1));
  return { start, end, faculties, users: Object.fromEntries(byUser) };
}

/** Результаты недели — из кэша, если считали в последние пару минут. */
async function results(env, start, ctx) {
  // NO_CACHE — только в разработке (.dev.vars): тестам нужны свежие числа.
  const cache = typeof caches !== "undefined" && !env.NO_CACHE ? caches.default : null;
  const key = new Request(`https://potok.internal/battle/${start}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit.json();
  }
  const data = await compute(env, start);
  const past = start + WEEK < Date.now() / 1000;
  if (cache) {
    const res = new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json", "cache-control": `max-age=${past ? 3600 : CACHE_TTL}` },
    });
    ctx?.waitUntil(cache.put(key, res));
  }
  return data;
}

export async function battle(env, user, ctx) {
  const now = Math.floor(Date.now() / 1000);
  const start = weekStart(now);
  const [week, last] = await Promise.all([results(env, start, ctx), results(env, start - WEEK, ctx)]);
  const mine = week.faculties.find((f) => f.id === user.faculty) || null;
  return {
    start: week.start,
    end: week.end,
    now,
    faculties: week.faculties,
    total: Object.keys(FACULTY).length - 1,
    me: { faculty: user.faculty, points: week.users[user.id] || 0, rank: mine?.rank || null },
    champion: last.faculties[0] ? { id: last.faculties[0].id, points: last.faculties[0].points } : null,
    rules: { ...POINTS, cap: DAILY_CAP },
  };
}
